import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import {
  MAX_BULK_MARK_READ_IDS,
  MAX_PAGE_SIZE,
} from '@ptah-contracts/community';

import {
  emptyNotificationPage,
  memberNotification,
  notificationPage,
} from '../notifications/notification-fixtures';
import { MemberNotificationsApiService } from './member-notifications-api.service';

const NOTIFICATIONS = '/api/v1/members/notifications';
const UNREAD_COUNT = `${NOTIFICATIONS}/unread-count`;
const READ_ALL = `${NOTIFICATIONS}/read-all`;
/** "Mark THESE" — four segments. `${NOTIFICATIONS}/<id>/read` is five. */
const BULK_READ = `${NOTIFICATIONS}/read`;

describe('MemberNotificationsApiService (R10.3, R10.4, R10.5, NFR-P5, NFR-S4)', () => {
  let service: MemberNotificationsApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MemberNotificationsApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /* ---------------------------------------------------------------------- */
  /* The four URLs and methods                                               */
  /* ---------------------------------------------------------------------- */

  describe('the four endpoints', () => {
    it('list GETs the collection URL with no parameters when none are supplied', async () => {
      const promise = firstValueFrom(service.list());
      const request = http.expectOne(NOTIFICATIONS);

      expect(request.request.method).toBe('GET');
      // Omitted parameters are NOT sent, so the server's echoed page/pageSize
      // stay the authority rather than being shadowed by a client default.
      expect(request.request.params.keys()).toEqual([]);

      request.flush(emptyNotificationPage());
      await promise;
    });

    it('unreadCount GETs the dedicated count URL', async () => {
      const promise = firstValueFrom(service.unreadCount());
      const request = http.expectOne(UNREAD_COUNT);

      expect(request.request.method).toBe('GET');

      request.flush({ unreadCount: 3 });
      await expect(promise).resolves.toEqual({ unreadCount: 3 });
    });

    it('🔴 markRead POSTs to :id/read and expects a 200, not a 201', async () => {
      // The server pins this with `@HttpCode(200)` because nothing is CREATED —
      // it is a state transition on an existing row. A client that treated
      // `201` as the success code would report every successful mark-read as a
      // failure the day the decorator was removed.
      const promise = firstValueFrom(service.markRead('n1'));
      const request = http.expectOne(`${NOTIFICATIONS}/n1/read`);

      expect(request.request.method).toBe('POST');

      request.flush(
        { readAt: '2026-08-10T14:02:49.470Z' },
        { status: 200, statusText: 'OK' },
      );

      await expect(promise).resolves.toBeUndefined();
    });

    it('markAllRead POSTs to read-all — ONE request, not one per row', async () => {
      const promise = firstValueFrom(service.markAllRead());
      const request = http.expectOne(READ_ALL);

      expect(request.request.method).toBe('POST');

      request.flush({ marked: 4 }, { status: 200, statusText: 'OK' });
      await expect(promise).resolves.toBeUndefined();
      http.verify();
    });

    it('markRead percent-encodes the id rather than splicing it raw', async () => {
      // Ids are server-minted cuids today, so this cannot bite now. It is
      // asserted anyway because the failure mode of the alternative is a
      // request to a DIFFERENT path, and nothing else in the stack would
      // notice.
      const promise = firstValueFrom(service.markRead('a/b'));
      http
        .expectOne(`${NOTIFICATIONS}/a%2Fb/read`)
        .flush({ readAt: null }, { status: 200, statusText: 'OK' });

      await promise;
    });
  });

  /* ---------------------------------------------------------------------- */
  /* The write bodies are deliberately unparsed                              */
  /* ---------------------------------------------------------------------- */

  describe('🔴 the two writes are FIRE-AND-REFETCH', () => {
    it('markRead resolves even when the body is a shape nothing declared', async () => {
      // `member-notification.contract.ts` declares NO schema for either write
      // and says why: the client decrements optimistically and re-reads
      // `unread-count`, which is the only writer of the badge. A parse here
      // would turn an undeclared body into a client-side failure of an
      // operation the server actually performed.
      const promise = firstValueFrom(service.markRead('n1'));
      http
        .expectOne(`${NOTIFICATIONS}/n1/read`)
        .flush({ totally: 'unexpected' }, { status: 200, statusText: 'OK' });

      await expect(promise).resolves.toBeUndefined();
    });

    it('markAllRead does not hand `marked` back as a count', async () => {
      // Measured live: `read-all` answered `{"marked":0}` immediately after the
      // one unread row had already been marked read individually. `marked` is
      // "rows this call touched", NOT "the new unread count", and a caller that
      // conflated the two would zero a badge that should not have moved. The
      // method resolves `undefined` so there is nothing to conflate.
      const promise = firstValueFrom(service.markAllRead());
      http
        .expectOne(READ_ALL)
        .flush({ marked: 0 }, { status: 200, statusText: 'OK' });

      await expect(promise).resolves.toBeUndefined();
    });
  });

  /* ---------------------------------------------------------------------- */
  /* The boundary parse is LIVE                                              */
  /* ---------------------------------------------------------------------- */

  describe('the schema parse at the HTTP boundary', () => {
    it('the live one-item page parses unchanged', async () => {
      const wire = notificationPage();

      const promise = firstValueFrom(service.list());
      http.expectOne(NOTIFICATIONS).flush(wire);

      await expect(promise).resolves.toEqual(wire);
    });

    it('🔴 a body MISSING route throws — the parse is live', async () => {
      // Without this case the schema could be `z.any()`. `route` is the field
      // chosen because R10.3's whole "opening one navigates to the source"
      // behaviour keys off it, and because it is the field RISK-AO guards: a
      // response that silently lost it would leave the store navigating to
      // `undefined`.
      const item: Record<string, unknown> = { ...memberNotification() };
      delete item['route'];

      const promise = firstValueFrom(service.list());
      http.expectOne(NOTIFICATIONS).flush(notificationPage([item] as never));

      await expect(promise).rejects.toThrow(/GET \/members\/notifications/);
      await expect(promise).rejects.toThrow(/route/);
    });

    it('an unknown notification kind is REJECTED, not silently accepted', async () => {
      // `kind` is a `z.enum`, so a server that grew a sixth kind fails here
      // loudly rather than reaching a template that has no branch for it.
      const promise = firstValueFrom(service.list());
      http
        .expectOne(NOTIFICATIONS)
        .flush(
          notificationPage([
            memberNotification({ kind: 'not.a.kind' as never }),
          ]),
        );

      await expect(promise).rejects.toThrow(/kind/);
    });

    it('a missing envelope field (hasMore) throws', async () => {
      const page: Record<string, unknown> = { ...notificationPage() };
      delete page['hasMore'];

      const promise = firstValueFrom(service.list());
      http.expectOne(NOTIFICATIONS).flush(page);

      await expect(promise).rejects.toThrow(/hasMore/);
    });

    it('unreadCount rejects a body whose count is missing', async () => {
      const promise = firstValueFrom(service.unreadCount());
      http.expectOne(UNREAD_COUNT).flush({});

      await expect(promise).rejects.toThrow(
        /GET \/members\/notifications\/unread-count/,
      );
      await expect(promise).rejects.toThrow(/unreadCount/);
    });

    it('unreadCount rejects a NON-INTEGER count', async () => {
      // `z.number().int()`. A fractional badge is a server bug and the badge is
      // the one number a member reads at a glance.
      const promise = firstValueFrom(service.unreadCount());
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 1.5 });

      await expect(promise).rejects.toThrow(/unreadCount/);
    });

    it('an UNKNOWN extra field is stripped rather than rejected', async () => {
      const promise = firstValueFrom(service.unreadCount());
      http
        .expectOne(UNREAD_COUNT)
        .flush({ unreadCount: 2, perKind: { 'topic.reply': 2 } });

      const result = await promise;
      expect(result).toEqual({ unreadCount: 2 });
      expect('perKind' in result).toBe(false);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* NFR-S4 — no identifiers on the wire                                     */
  /* ---------------------------------------------------------------------- */

  describe('🔴 NFR-S4 — neither userId nor actorId reaches the client', () => {
    it('both are stripped even when a body carries them', async () => {
      // The row HAS both columns; `member_notifications.user_id` and
      // `.actor_id` are uuids. The server maps explicit fields so neither is
      // sent — measured live, the real body carried `actorName` and no ids at
      // all. This asserts the client half: the day a widening puts them back on
      // the wire, they still do not reach a component.
      const promise = firstValueFrom(service.list());
      http.expectOne(NOTIFICATIONS).flush(
        notificationPage([
          {
            ...memberNotification(),
            userId: 'b15a0000-0000-4000-8000-00000000000a',
            actorId: 'b15a0000-0000-4000-8000-00000000000b',
          } as never,
        ]),
      );

      const [item] = (await promise).items;

      expect(Object.keys(item)).not.toContain('userId');
      expect(Object.keys(item)).not.toContain('actorId');
      expect(JSON.stringify(item)).not.toContain('b15a0000');
    });

    it('actorName survives, because it is the field that replaced them', async () => {
      // The negative assertions above would pass on an empty object. This is
      // the anti-vacuity half: the display name IS present, so "no ids" is a
      // statement about a populated row.
      const promise = firstValueFrom(service.list());
      http.expectOne(NOTIFICATIONS).flush(notificationPage());

      const [item] = (await promise).items;
      expect(item.actorName).toBe('Grace');
      expect(item.actorName).not.toMatch(/@/);
    });

    it('a system notification with a null actor parses', async () => {
      // `announcement` is declared with no producer today, but `actorName` is
      // nullable precisely for it. A schema that required a name would reject
      // the first announcement ever sent.
      const promise = firstValueFrom(service.list());
      http
        .expectOne(NOTIFICATIONS)
        .flush(notificationPage([memberNotification({ actorName: null })]));

      const [item] = (await promise).items;
      expect(item.actorName).toBeNull();
    });
  });

  /* ---------------------------------------------------------------------- */
  /* NFR-P5 — the client-side page guard                                     */
  /* ---------------------------------------------------------------------- */

  describe('🔴 NFR-P5 — an over-cap request is refused BEFORE it is issued', () => {
    it('sends page and pageSize when supplied', async () => {
      const promise = firstValueFrom(service.list(2, 10));
      const request = http.expectOne(`${NOTIFICATIONS}?page=2&pageSize=10`);

      expect(request.request.params.get('page')).toBe('2');
      expect(request.request.params.get('pageSize')).toBe('10');

      // The server ECHOES what it used — measured live for exactly this pair.
      request.flush(notificationPage([], { page: 2, pageSize: 10, total: 1 }));

      const result = await promise;
      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(10);
    });

    it(`throws for pageSize > ${MAX_PAGE_SIZE} and issues NO request`, () => {
      // The server answers `400` and does NOT clamp — measured live at
      // `?pageSize=51`. Throwing here keeps the failure at the call site
      // instead of turning a programming error into a rendered error banner.
      expect(() => service.list(1, MAX_PAGE_SIZE + 1)).toThrow(RangeError);
      http.verify();
    });

    it('throws for page 0 and issues NO request', () => {
      // 1-based. `?page=0` is `@Min(FIRST_PAGE)` server-side.
      expect(() => service.list(0)).toThrow(RangeError);
      http.verify();
    });

    it('throws for a fractional page size and issues NO request', () => {
      expect(() => service.list(1, 2.5)).toThrow(RangeError);
      http.verify();
    });

    it(`accepts exactly ${MAX_PAGE_SIZE} — the boundary is inclusive`, async () => {
      // Off-by-one at the cap would silently make the largest legal page
      // unreachable, and no other test in this file would notice.
      const promise = firstValueFrom(service.list(1, MAX_PAGE_SIZE));
      http
        .expectOne(`${NOTIFICATIONS}?page=1&pageSize=${MAX_PAGE_SIZE}`)
        .flush(notificationPage([], { pageSize: MAX_PAGE_SIZE, total: 0 }));

      await promise;
    });
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 markManyRead — "mark THESE" (R9.7, Batch 15B)                        */
  /* ---------------------------------------------------------------------- */

  describe('🔴 markManyRead — the bulk endpoint', () => {
    it('POSTs the ids to the four-segment URL, not to :id/read', async () => {
      // 🔴 THE URL IS THE ONE THING THAT COULD GO WRONG SILENTLY.
      // `${NOTIFICATIONS}/read` and `${NOTIFICATIONS}/<id>/read` differ by one
      // segment; the server proved live that they reach different handlers, and
      // a client that hit the wrong one would mark exactly ONE row read and
      // report success for N.
      const promise = firstValueFrom(service.markManyRead(['n1', 'n2']));
      const request = http.expectOne(BULK_READ);

      expect(request.request.method).toBe('POST');
      expect(request.request.url).toBe(BULK_READ);
      expect(request.request.body).toEqual({ ids: ['n1', 'n2'] });

      request.flush({ marked: 2 });
      await promise;
    });

    it('the ids travel in the BODY — the URL carries no query string', () => {
      // A query string is bounded by the server's URL limit rather than by
      // `@ArrayMaxSize`, and every proxy in the path logs one.
      void firstValueFrom(service.markManyRead(['n1']));
      const request = http.expectOne(BULK_READ);

      expect(request.request.params.keys()).toEqual([]);
      expect(request.request.urlWithParams).toBe(BULK_READ);
      request.flush({ marked: 1 });
    });

    it('resolves to void — `{ marked }` is never parsed', async () => {
      // `marked` is "rows this call moved", NOT the new unread count. A caller
      // that read it as a count would zero a badge that should not have moved.
      const promise = firstValueFrom(service.markManyRead(['n1']));
      http.expectOne(BULK_READ).flush({ marked: 99 });

      await expect(promise).resolves.toBeUndefined();
    });

    it('resolves even against a body no contract declares', async () => {
      const promise = firstValueFrom(service.markManyRead(['n1']));
      http.expectOne(BULK_READ).flush({ anything: true });

      await expect(promise).resolves.toBeUndefined();
    });

    it('🔴 an EMPTY array throws and issues NO request', () => {
      // 🔴 "Mark these, where THESE is empty" is the one phrasing that could be
      // re-read as "mark ALL". The server refuses it with a `400`; swallowing
      // that here as a no-op would re-open the door from the client side, and
      // sending it would be a `400` the member sees as a broken button.
      expect(() => service.markManyRead([])).toThrow(RangeError);
      http.verify();
    });

    it(`throws above ${MAX_BULK_MARK_READ_IDS} ids and issues NO request`, () => {
      const tooMany = Array.from(
        { length: MAX_BULK_MARK_READ_IDS + 1 },
        (_, i) => `n${i}`,
      );

      expect(() => service.markManyRead(tooMany)).toThrow(RangeError);
      http.verify();
    });

    it(`accepts exactly ${MAX_BULK_MARK_READ_IDS} — the boundary is inclusive`, () => {
      const atCap = Array.from(
        { length: MAX_BULK_MARK_READ_IDS },
        (_, i) => `n${i}`,
      );

      void firstValueFrom(service.markManyRead(atCap));
      const request = http.expectOne(BULK_READ);

      expect((request.request.body as { ids: string[] }).ids).toHaveLength(
        MAX_BULK_MARK_READ_IDS,
      );
      request.flush({ marked: MAX_BULK_MARK_READ_IDS });
    });

    it('🔴 the cap is DERIVED from MAX_PAGE_SIZE, not copied', () => {
      // If these ever disagree, a member could tick every row on the largest
      // page the API serves and be refused by their own client.
      expect(MAX_BULK_MARK_READ_IDS).toBe(MAX_PAGE_SIZE);
    });

    it('the caller’s array is COPIED, not retained', () => {
      // The store hands over an array it derives from a signal. Retaining the
      // reference would let a later mutation change a request already sent.
      const ids = ['n1', 'n2'];
      void firstValueFrom(service.markManyRead(ids));
      const request = http.expectOne(BULK_READ);

      ids.push('n3');

      expect(request.request.body).toEqual({ ids: ['n1', 'n2'] });
      request.flush({ marked: 2 });
    });
  });
});
