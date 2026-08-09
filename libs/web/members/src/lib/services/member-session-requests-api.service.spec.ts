import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { SESSION_REQUEST_STATUSES } from '@ptah-contracts/community';
import { isMembershipRequiredError } from '@ptah-web/core';

import {
  memberSessionRequest,
  scheduledSessionRequest,
} from '../live/live-fixtures';
import {
  MemberSessionRequestsApiService,
  isNotCancellableError,
} from './member-session-requests-api.service';

const REQUESTS = '/api/v1/members/session-requests';

/** The nine keys `MemberSessionRequest` declares, and no others (NFR-S4). */
const CONTRACT_KEYS = [
  'additionalNotes',
  'createdAt',
  'declineReason',
  'durationMinutes',
  'id',
  'meetLink',
  'scheduledAt',
  'sessionTopicId',
  'status',
];

/** Never reachable by a member, on any response (NFR-S4). */
const FORBIDDEN_KEYS = [
  'calendarEventId',
  'paymentStatus',
  'paddleTransactionId',
  'isFreeSession',
  'userId',
  'requester',
];

describe('MemberSessionRequestsApiService', () => {
  let service: MemberSessionRequestsApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MemberSessionRequestsApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /* ---------------------------------------------------------------------- */
  /* The boundary parse                                                      */
  /* ---------------------------------------------------------------------- */

  describe('the schema parse at the HTTP boundary', () => {
    it('a well-formed list parses', async () => {
      const promise = firstValueFrom(service.list());
      http.expectOne(REQUESTS).flush([memberSessionRequest()]);

      await expect(promise).resolves.toEqual([memberSessionRequest()]);
    });

    it('a response MISSING a required field throws — the parse is live', async () => {
      const wire: Record<string, unknown> = { ...memberSessionRequest() };
      delete wire['status'];

      const promise = firstValueFrom(service.list());
      http.expectOne(REQUESTS).flush([wire]);

      await expect(promise).rejects.toThrow(/GET \/members\/session-requests/);
      await expect(promise).rejects.toThrow(/status/);
    });

    it('rejects a status outside SESSION_REQUEST_STATUSES', async () => {
      // RISK-X's client twin. `SessionRequest.status` is a bare Postgres String
      // and a typo'd 'sheduled' writes cleanly server-side; the client's enum
      // is the last place it can be caught before a badge renders nothing.
      const promise = firstValueFrom(service.list());
      http
        .expectOne(REQUESTS)
        .flush([{ ...memberSessionRequest(), status: 'sheduled' }]);

      await expect(promise).rejects.toThrow(/GET \/members\/session-requests/);
    });

    it('accepts every one of the four declared statuses', async () => {
      for (const status of SESSION_REQUEST_STATUSES) {
        const promise = firstValueFrom(service.list());
        http.expectOne(REQUESTS).flush([memberSessionRequest({ status })]);
        await expect(promise).resolves.toHaveLength(1);
      }
    });
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 NFR-S4 — field absence, asserted rather than trusted                 */
  /* ---------------------------------------------------------------------- */

  describe('🔴 NFR-S4 — what a member may never receive', () => {
    it('the parsed row has EXACTLY the nine contract keys', async () => {
      const promise = firstValueFrom(service.list());
      http.expectOne(REQUESTS).flush([scheduledSessionRequest()]);

      const [row] = await promise;
      expect(Object.keys(row).sort()).toEqual(CONTRACT_KEYS);
    });

    it.each(FORBIDDEN_KEYS)(
      'strips `%s` even when a future server sends it',
      async (forbidden) => {
        // `z.object()` STRIPS unknown keys, so this client would tolerate a
        // server that started leaking one. That tolerance is correct at the
        // parse and dangerous at the render, which is why the absence is
        // asserted here rather than assumed from the contract's docblock.
        const promise = firstValueFrom(service.list());
        http.expectOne(REQUESTS).flush([
          {
            ...scheduledSessionRequest(),
            [forbidden]: 'leaked-value-that-must-not-survive',
          },
        ]);

        const [row] = await promise;
        expect(forbidden in row).toBe(false);
        expect(JSON.stringify(row)).not.toContain('leaked-value');
      },
    );

    it('still carries every field the member DOES need on an accepted row', async () => {
      const promise = firstValueFrom(service.list());
      http.expectOne(REQUESTS).flush([scheduledSessionRequest()]);

      const [row] = await promise;
      expect(row.status).toBe('scheduled');
      expect(row.scheduledAt).not.toBeNull();
      expect(row.meetLink).toBe('https://meet.google.com/ope-zmee-szb');
      expect(row.durationMinutes).toBe(30);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* list                                                                    */
  /* ---------------------------------------------------------------------- */

  describe('list', () => {
    it('issues ONE unpaged GET with no query parameters at all', async () => {
      // `MemberSessionRequestsController.list` declares no `@Query()`; a page
      // parameter would be a 400 under forbidNonWhitelisted.
      const promise = firstValueFrom(service.list());
      const request = http.expectOne(REQUESTS);

      expect(request.request.method).toBe('GET');
      expect(request.request.params.keys()).toEqual([]);

      request.flush([]);
      await promise;
    });

    it('an empty list is an empty array, not an error', async () => {
      // Measured live: a member with no requests receives `[]`. Rendering that
      // as a failure would tell a member the feature is broken on their very
      // first visit.
      const promise = firstValueFrom(service.list());
      http.expectOne(REQUESTS).flush([]);

      await expect(promise).resolves.toEqual([]);
    });

    it('preserves SERVER ORDER', async () => {
      const wire = [
        memberSessionRequest({
          id: 'newest',
          createdAt: '2026-08-09T00:00:00.000Z',
        }),
        memberSessionRequest({
          id: 'oldest',
          createdAt: '2026-07-01T00:00:00.000Z',
        }),
      ];

      const promise = firstValueFrom(service.list());
      http.expectOne(REQUESTS).flush(wire);

      await expect(promise).resolves.toMatchObject([
        { id: 'newest' },
        { id: 'oldest' },
      ]);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* submit — the wire body is the assertion                                 */
  /* ---------------------------------------------------------------------- */

  describe('submit', () => {
    it('🔴 sends EXACTLY sessionTopicId and additionalNotes', async () => {
      // forbidNonWhitelisted is LIVE — measured 2026-08-09, a `status` key
      // answered 400. A third key here is a rejection, not an ignored field.
      const promise = firstValueFrom(
        service.submit({
          sessionTopicId: 'orchestration-workflow',
          additionalNotes: 'Architect handoff, please.',
        }),
      );
      const request = http.expectOne(REQUESTS);

      expect(request.request.method).toBe('POST');
      expect(Object.keys(request.request.body as object).sort()).toEqual([
        'additionalNotes',
        'sessionTopicId',
      ]);

      request.flush(memberSessionRequest());
      await promise;
    });

    it('🔴 OMITS additionalNotes entirely when it is absent', async () => {
      const promise = firstValueFrom(
        service.submit({ sessionTopicId: 'getting-started-ptah' }),
      );
      const request = http.expectOne(REQUESTS);

      expect(request.request.body).toEqual({
        sessionTopicId: 'getting-started-ptah',
      });
      expect('additionalNotes' in (request.request.body as object)).toBe(false);

      request.flush(memberSessionRequest());
      await promise;
    });

    it.each([null, '', '   ', '\n\t '])(
      'omits additionalNotes for %p rather than sending it',
      async (notes) => {
        // `@IsOptionalNotNull()` + `@NullMeansAbsent()`: "no notes" and "the key
        // was omitted" are the same request, and an explicit empty-ish value is
        // a 400 on the sibling comment DTO. One conversion, in one place.
        const promise = firstValueFrom(
          service.submit({
            sessionTopicId: 'nx-monorepo-mastery',
            additionalNotes: notes,
          }),
        );
        const request = http.expectOne(REQUESTS);

        expect(request.request.body).toEqual({
          sessionTopicId: 'nx-monorepo-mastery',
        });

        request.flush(memberSessionRequest());
        await promise;
      },
    );

    it('trims surrounding whitespace off notes it does send', async () => {
      const promise = firstValueFrom(
        service.submit({
          sessionTopicId: 'nx-monorepo-mastery',
          additionalNotes: '  real notes  ',
        }),
      );
      const request = http.expectOne(REQUESTS);

      expect(request.request.body).toEqual({
        sessionTopicId: 'nx-monorepo-mastery',
        additionalNotes: 'real notes',
      });

      request.flush(memberSessionRequest());
      await promise;
    });

    it('parses the 201 body as a MemberSessionRequest', async () => {
      const promise = firstValueFrom(
        service.submit({ sessionTopicId: 'orchestration-workflow' }),
      );
      http
        .expectOne(REQUESTS)
        .flush(memberSessionRequest(), { status: 201, statusText: 'Created' });

      await expect(promise).resolves.toMatchObject({ status: 'pending' });
    });

    it('propagates a 429 rather than swallowing it', async () => {
      // The create is throttled at 10/min. A rate limit is a different
      // sentence from a validation failure and the page needs to tell them
      // apart.
      const promise = firstValueFrom(
        service.submit({ sessionTopicId: 'orchestration-workflow' }),
      );
      http
        .expectOne(REQUESTS)
        .flush(
          { message: 'Too Many Requests' },
          { status: 429, statusText: 'Too Many Requests' },
        );

      await expect(promise).rejects.toMatchObject({ status: 429 });
    });
  });

  /* ---------------------------------------------------------------------- */
  /* cancel                                                                  */
  /* ---------------------------------------------------------------------- */

  describe('cancel', () => {
    it('issues a DELETE against the encoded id and parses the ack', async () => {
      const promise = firstValueFrom(service.cancel('6affc65b-5103'));
      const request = http.expectOne(`${REQUESTS}/6affc65b-5103`);

      expect(request.request.method).toBe('DELETE');
      request.flush({ canceled: true });

      await expect(promise).resolves.toEqual({ canceled: true });
    });

    it('encodes an id that would otherwise change the path', async () => {
      const promise = firstValueFrom(service.cancel('a/b'));
      http.expectOne(`${REQUESTS}/a%2Fb`).flush({ canceled: true });
      await promise;
    });

    it('rejects an ack that is not the documented envelope', async () => {
      const promise = firstValueFrom(service.cancel('x'));
      http.expectOne(`${REQUESTS}/x`).flush({ deleted: true });

      await expect(promise).rejects.toThrow(
        /DELETE \/members\/session-requests\/x/,
      );
    });
  });

  /* ---------------------------------------------------------------------- */
  /* isNotCancellableError — and what it is NOT                              */
  /* ---------------------------------------------------------------------- */

  describe('isNotCancellableError', () => {
    it('recognises the 403 a withdraw answers', () => {
      expect(
        isNotCancellableError(
          new HttpErrorResponse({ status: 403, error: { message: 'nope' } }),
        ),
      ).toBe(true);
    });

    it.each([400, 404, 409, 429, 500])('is false for %p', (status) => {
      expect(isNotCancellableError(new HttpErrorResponse({ status }))).toBe(
        false,
      );
    });

    it('is false for a non-HTTP error', () => {
      expect(isNotCancellableError(new Error('boom'))).toBe(false);
      expect(isNotCancellableError(null)).toBe(false);
    });

    it('🔴 a membership_required 403 is recognised by BOTH — the page must check the entitlement gate FIRST', () => {
      // Both are 403s and they have OPPOSITE dispositions: one sends a member
      // to /pricing, the other means "your request was already accepted,
      // reload the list". This assertion records the overlap deliberately so
      // the ordering in the page is a stated requirement rather than an
      // accident.
      const gate = new HttpErrorResponse({
        status: 403,
        error: { reason: 'membership_required' },
      });

      expect(isMembershipRequiredError(gate)).toBe(true);
      expect(isNotCancellableError(gate)).toBe(true);
    });
  });
});
