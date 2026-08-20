import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import type { WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import {
  SESSION_REQUEST_STATUSES,
  type MemberSessionRequest,
} from '@ptah-contracts/community';
import { SESSION_TOPICS } from '@ptah-web/core';

import {
  BORDER_FILL_MISUSE,
  MUTED_TOO_FAINT,
  memberSessionRequest,
  scheduledSessionRequest,
} from './live-fixtures';
import { RequestSessionPage } from './request-session-page';

const REQUESTS = '/api/v1/members/session-requests';

describe('RequestSessionPage', () => {
  let fixture: ComponentFixture<RequestSessionPage>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RequestSessionPage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(RequestSessionPage);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const settle = (rows: MemberSessionRequest[] = []): void => {
    fixture.detectChanges();
    http.expectOne(REQUESTS).flush(rows);
    fixture.detectChanges();
  };

  const text = (): string =>
    (fixture.nativeElement as HTMLElement).textContent ?? '';

  const select = (): HTMLSelectElement =>
    fixture.debugElement.query(By.css('select')).nativeElement;

  const textarea = (): HTMLTextAreaElement =>
    fixture.debugElement.query(By.css('textarea')).nativeElement;

  const buttonWith = (label: string): HTMLButtonElement | undefined =>
    Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((button) => button.textContent?.includes(label));

  const chooseTopic = (id: string): void => {
    const element = select();
    element.value = id;
    element.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  };

  const type = (value: string): void => {
    const element = textarea();
    element.value = value;
    element.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  /* ---------------------------------------------------------------------- */
  /* 🔴 The copy — no price, no promise                                      */
  /* ---------------------------------------------------------------------- */

  describe('🔴 the copy quotes no price and promises no free session', () => {
    it('renders no currency symbol and no amount', () => {
      // This endpoint runs NO eligibility check and takes NO payment
      // (`is_free_session` defaults false, `payment_status` defaults 'none').
      // The OTHER request path — the marketing site's — is the one that charges.
      // Promising either outcome here would be this screen inventing a policy
      // it does not implement.
      settle([memberSessionRequest(), scheduledSessionRequest()]);

      expect(text()).not.toContain('$');
      expect(text()).not.toContain('€');
      expect(text()).not.toContain('£');
      expect(text()).not.toMatch(/\b100\b/);
    });

    it('does not use the word "free"', () => {
      settle();
      expect(text().toLowerCase()).not.toContain('free');
    });

    it('says the team reviews and replies with a time and a link', () => {
      settle();
      expect(text()).toContain(
        'We review every request and reply with a confirmed time and a video link.',
      );
    });
  });

  /* ---------------------------------------------------------------------- */
  /* The topic catalogue                                                     */
  /* ---------------------------------------------------------------------- */

  describe('the topic select', () => {
    it('offers exactly the SESSION_TOPICS catalogue plus a placeholder', () => {
      settle();
      const options = fixture.debugElement
        .queryAll(By.css('option'))
        .map((element) => element.nativeElement.getAttribute('value'));

      expect(options).toEqual(['', ...SESSION_TOPICS.map((topic) => topic.id)]);
    });

    it('drives its choice through [selected] per option, not [value] on the select', () => {
      // Options come from an `@for` in the same change-detection pass, so a
      // `[value]` binding on the select runs before they exist and silently
      // resets to the first one (B7's finding).
      //
      // 🔴 THE STATE IS PUSHED FROM THE SIGNAL, NOT THROUGH THE DOM, AND THAT
      // IS THE WHOLE POINT OF THIS TEST. The obvious version of it —
      // `chooseTopic('…')` then assert the matching option's `.selected` — is
      // VACUOUS, and Batch 13 proved it by deleting the `[selected]` binding
      // and watching all 34 tests stay green. `element.value = id` is a NATIVE
      // `HTMLSelectElement` setter: the browser marks the matching option
      // selected itself, with no Angular involvement, so the assertion passes
      // whether the template binds `[selected]` per option, `[value]` on the
      // select, or nothing at all.
      //
      // Writing the signal instead means the ONLY thing that can move the DOM
      // is the template binding under test. With `[selected]` the expression
      // flips false -> true on that option and Angular writes it; with a
      // `[value]` binding on the select — or with nothing — the select stays on
      // the placeholder and this fails.
      settle();

      const component = fixture.componentInstance as unknown as {
        topicId: WritableSignal<string>;
      };
      component.topicId.set('orchestration-workflow');
      fixture.detectChanges();

      expect(select().value).toBe('orchestration-workflow');

      const chosen = fixture.debugElement
        .queryAll(By.css('option'))
        .find(
          (element) =>
            element.nativeElement.getAttribute('value') ===
            'orchestration-workflow',
        );

      expect(chosen?.nativeElement.selected).toBe(true);
    });

    it('reflects a topic change back to the DOM when the signal moves again', () => {
      // The second move matters independently: a binding that only ever writes
      // once would satisfy the test above and still strand the select on the
      // first topic a member picked.
      settle();

      const component = fixture.componentInstance as unknown as {
        topicId: WritableSignal<string>;
      };

      component.topicId.set('orchestration-workflow');
      fixture.detectChanges();
      component.topicId.set('getting-started-ptah');
      fixture.detectChanges();

      expect(select().value).toBe('getting-started-ptah');
    });

    it('shows the chosen topic description', () => {
      settle();
      chooseTopic('getting-started-ptah');

      const topic = SESSION_TOPICS.find(
        (candidate) => candidate.id === 'getting-started-ptah',
      );
      expect(text()).toContain(topic?.description as string);
    });

    it('disables submit until a topic is chosen', () => {
      settle();
      expect(buttonWith('Send request')?.disabled).toBe(true);

      chooseTopic('nx-monorepo-mastery');
      expect(buttonWith('Send request')?.disabled).toBe(false);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* The wire body                                                           */
  /* ---------------------------------------------------------------------- */

  describe('submitting', () => {
    it('🔴 posts EXACTLY the topic id when no notes were typed', () => {
      settle();
      chooseTopic('nx-monorepo-mastery');

      buttonWith('Send request')?.click();
      fixture.detectChanges();

      const request = http.expectOne(
        (candidate) =>
          candidate.method === 'POST' && candidate.url === REQUESTS,
      );
      expect(request.request.body).toEqual({
        sessionTopicId: 'nx-monorepo-mastery',
      });

      request.flush(memberSessionRequest(), {
        status: 201,
        statusText: 'Created',
      });
      fixture.detectChanges();
      http.expectOne(REQUESTS).flush([memberSessionRequest()]);
      fixture.detectChanges();
    });

    it('posts the notes when they were typed', () => {
      settle();
      chooseTopic('orchestration-workflow');
      type('Stuck on the architect handoff.');

      buttonWith('Send request')?.click();
      fixture.detectChanges();

      const request = http.expectOne(
        (candidate) =>
          candidate.method === 'POST' && candidate.url === REQUESTS,
      );
      expect(request.request.body).toEqual({
        sessionTopicId: 'orchestration-workflow',
        additionalNotes: 'Stuck on the architect handoff.',
      });

      request.flush(memberSessionRequest(), {
        status: 201,
        statusText: 'Created',
      });
      fixture.detectChanges();
      http.expectOne(REQUESTS).flush([memberSessionRequest()]);
      fixture.detectChanges();
    });

    it('bounds the notes field at the DTO maximum', () => {
      settle();
      // `[attr.maxlength]`, not `[maxlength]` — the latter is a FormsModule
      // directive input and fails with NG0303 (B7's finding).
      expect(textarea().getAttribute('maxlength')).toBe('5000');
    });

    it('🔴 RE-READS the list rather than splicing the response in', () => {
      settle();
      chooseTopic('nx-monorepo-mastery');
      buttonWith('Send request')?.click();
      fixture.detectChanges();

      http
        .expectOne((candidate) => candidate.method === 'POST')
        .flush(memberSessionRequest(), { status: 201, statusText: 'Created' });
      fixture.detectChanges();

      // The GET is the assertion: the list is the only authority on what the
      // server now holds.
      http.expectOne(REQUESTS).flush([memberSessionRequest()]);
      fixture.detectChanges();

      expect(text()).toContain('Request sent.');
      expect(
        fixture.debugElement.queryAll(By.css('[data-request-id]')).length,
      ).toBe(1);
    });

    it('clears the form after a successful submit', () => {
      settle();
      chooseTopic('nx-monorepo-mastery');
      type('some notes');

      buttonWith('Send request')?.click();
      fixture.detectChanges();
      http
        .expectOne((candidate) => candidate.method === 'POST')
        .flush(memberSessionRequest(), { status: 201, statusText: 'Created' });
      fixture.detectChanges();
      http.expectOne(REQUESTS).flush([memberSessionRequest()]);
      fixture.detectChanges();

      expect(textarea().value).toBe('');
      expect(buttonWith('Send request')?.disabled).toBe(true);
    });

    it('gives a 429 its OWN sentence rather than "try again"', () => {
      // "Please try again" is actively wrong advice for a rate limit: it
      // invites the one action that keeps it firing.
      settle();
      chooseTopic('nx-monorepo-mastery');
      buttonWith('Send request')?.click();
      fixture.detectChanges();

      http
        .expectOne((candidate) => candidate.method === 'POST')
        .flush({}, { status: 429, statusText: 'Too Many Requests' });
      fixture.detectChanges();

      expect(text()).toContain('Please wait a minute');
    });

    it('never shows a raw 400 body to the member', () => {
      // `forbidNonWhitelisted` produces "property status should not exist",
      // which names a wire field the member never typed.
      settle();
      chooseTopic('nx-monorepo-mastery');
      buttonWith('Send request')?.click();
      fixture.detectChanges();

      http
        .expectOne((candidate) => candidate.method === 'POST')
        .flush(
          { message: ['property status should not exist'] },
          { status: 400, statusText: 'Bad Request' },
        );
      fixture.detectChanges();

      expect(text()).not.toContain('should not exist');
      expect(text()).toContain('We could not send that request.');
    });
  });

  /* ---------------------------------------------------------------------- */
  /* The list                                                                */
  /* ---------------------------------------------------------------------- */

  describe('the request list', () => {
    it('renders an empty state, not an error, for a member with no requests', () => {
      settle([]);

      expect(text()).toContain('You have not requested a session yet.');
      expect(
        (fixture.nativeElement as HTMLElement).querySelectorAll(
          '[role="alert"]',
        ).length,
      ).toBe(0);
    });

    it.each(SESSION_REQUEST_STATUSES)(
      'renders a %s row with a badge',
      (status) => {
        settle([memberSessionRequest({ status })]);

        const row = fixture.debugElement.query(By.css('[data-request-status]'));
        expect(row.nativeElement.getAttribute('data-request-status')).toBe(
          status,
        );
        expect(
          fixture.debugElement.query(By.css('ptah-status-badge')),
        ).not.toBeNull();
      },
    );

    it('shows the scheduled time, duration and Meet link on an accepted row', () => {
      settle([scheduledSessionRequest()]);

      expect(text()).toContain('30 min');
      const anchor = fixture.debugElement.query(By.css('a'));
      expect(anchor.nativeElement.getAttribute('href')).toBe(
        'https://meet.google.com/ope-zmee-szb',
      );
      expect(anchor.nativeElement.getAttribute('rel')).toBe(
        'noopener noreferrer',
      );
    });

    it('shows the admin decline reason (R4.8)', () => {
      settle([
        memberSessionRequest({
          status: 'canceled',
          declineReason: 'We are booked through August — try September.',
        }),
      ]);

      expect(text()).toContain('We are booked through August — try September.');
    });

    it('renders an unknown topic id verbatim rather than blank', () => {
      // `sessionTopicId` is a free string with no foreign key; a request from
      // the other path can carry an id this build does not know.
      settle([memberSessionRequest({ sessionTopicId: 'legacy-topic-42' })]);
      expect(text()).toContain('legacy-topic-42');
    });

    it('a failed list is a retryable alert that clears the rows', () => {
      fixture.detectChanges();
      http
        .expectOne(REQUESTS)
        .flush({}, { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();

      expect(text()).toContain('We could not load your requests.');
      expect(text()).not.toContain('You have not requested a session yet.');
      expect(
        fixture.debugElement.queryAll(By.css('[data-request-id]')).length,
      ).toBe(0);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Withdraw                                                                */
  /* ---------------------------------------------------------------------- */

  describe('withdraw', () => {
    it('is offered on a pending row', () => {
      settle([memberSessionRequest({ status: 'pending' })]);
      expect(buttonWith('Withdraw')).toBeDefined();
    });

    it.each(['scheduled', 'completed', 'canceled'] as const)(
      'is NOT offered on a %s row',
      (status) => {
        // A withdraw on a scheduled request is a 403 the member cannot act on;
        // offering the button would make the product look broken rather than
        // making the state clear.
        settle([memberSessionRequest({ status })]);
        expect(buttonWith('Withdraw')).toBeUndefined();
      },
    );

    it('DELETEs by id and re-reads the list', () => {
      settle([memberSessionRequest({ id: 'req-1' })]);

      buttonWith('Withdraw')?.click();
      fixture.detectChanges();

      http.expectOne(`${REQUESTS}/req-1`).flush({ canceled: true });
      fixture.detectChanges();

      http.expectOne(REQUESTS).flush([]);
      fixture.detectChanges();

      expect(text()).toContain('You have not requested a session yet.');
    });

    it('🔴 a 403 says the request was already answered — never "permission"', () => {
      settle([memberSessionRequest({ id: 'req-1' })]);

      buttonWith('Withdraw')?.click();
      fixture.detectChanges();
      http
        .expectOne(`${REQUESTS}/req-1`)
        .flush({}, { status: 403, statusText: 'Forbidden' });
      fixture.detectChanges();
      http.expectOne(REQUESTS).flush([scheduledSessionRequest()]);
      fixture.detectChanges();

      expect(text()).toContain('has already been answered');
      for (const word of ['permission', 'not allowed', 'forbidden']) {
        expect(text().toLowerCase()).not.toContain(word);
      }
    });

    it('🔴 a membership_required 403 is NOT treated as "already answered"', () => {
      // Both are 403s with opposite dispositions. The entitlement gate is
      // checked first; conflating them tells a member whose membership lapsed
      // that their request was answered.
      settle([memberSessionRequest({ id: 'req-1' })]);

      buttonWith('Withdraw')?.click();
      fixture.detectChanges();
      http
        .expectOne(`${REQUESTS}/req-1`)
        .flush(
          { reason: 'membership_required' },
          { status: 403, statusText: 'Forbidden' },
        );
      fixture.detectChanges();

      expect(text()).toContain('membership could not be confirmed');
      expect(text()).not.toContain('has already been answered');
      // And it does NOT re-read — there is nothing to re-read as an
      // unentitled caller.
      http.expectNone(REQUESTS);
    });

    it('🔴 refuses a SECOND withdraw while the first is still in flight', () => {
      // `withdrawing` holds a SINGLE id and is the disabled-state source for
      // every row, so a click on row B used to overwrite it — which re-enabled
      // row A's button and permitted a second DELETE for the same request
      // before the first had answered. `http.verify()` in `afterEach` is what
      // makes a stray second request fail this test.
      settle([
        memberSessionRequest({ id: 'req-1' }),
        memberSessionRequest({ id: 'req-2' }),
      ]);

      const buttons = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
      ).filter((button) => button.textContent?.includes('Withdraw'));
      expect(buttons.length).toBe(2);

      buttons[0].click();
      fixture.detectChanges();

      // The first DELETE is open and deliberately NOT flushed yet.
      const first = http.expectOne(`${REQUESTS}/req-1`);

      buttons[1].click();
      fixture.detectChanges();

      // No second DELETE was issued.
      http.expectNone(`${REQUESTS}/req-2`);

      first.flush({ canceled: true });
      fixture.detectChanges();
      http.expectOne(REQUESTS).flush([]);
      fixture.detectChanges();
    });

    it('🔴 a stale withdraw notice does not survive a later successful submit', () => {
      // The notice was cleared ONLY at the top of `withdraw()`, so it outlived
      // every unrelated change to the list. A member who failed to withdraw one
      // request and then successfully submitted another kept reading "That
      // request has already been answered" under a list that had just changed
      // for a completely different reason.
      settle([memberSessionRequest({ id: 'req-1' })]);

      buttonWith('Withdraw')?.click();
      fixture.detectChanges();
      http
        .expectOne(`${REQUESTS}/req-1`)
        .flush({}, { status: 403, statusText: 'Forbidden' });
      fixture.detectChanges();
      http.expectOne(REQUESTS).flush([scheduledSessionRequest()]);
      fixture.detectChanges();

      expect(text()).toContain('has already been answered');

      chooseTopic('orchestration-workflow');
      buttonWith('Send request')?.click();
      fixture.detectChanges();
      http.expectOne(REQUESTS).flush(memberSessionRequest());
      fixture.detectChanges();
      http.expectOne(REQUESTS).flush([memberSessionRequest()]);
      fixture.detectChanges();

      expect(text()).not.toContain('has already been answered');
    });

    it('🔴 a stale withdraw notice does not sit under a failed reload', () => {
      // Its copy ends "The list below is up to date", which a failed reload
      // makes untrue — and the notice block sits OUTSIDE the
      // error/loading/list chain, so both used to render at once.
      settle([memberSessionRequest({ id: 'req-1' })]);

      buttonWith('Withdraw')?.click();
      fixture.detectChanges();
      http
        .expectOne(`${REQUESTS}/req-1`)
        .flush({}, { status: 403, statusText: 'Forbidden' });
      fixture.detectChanges();
      http
        .expectOne(REQUESTS)
        .flush({}, { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();

      expect(text()).not.toContain('has already been answered');
      expect(text()).toContain('We could not load your requests.');
    });
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 No renderer, and the tokens                                          */
  /* ---------------------------------------------------------------------- */

  describe('🔴 ASSUMPTION-17 — member text is escaped, never rendered', () => {
    it('renders markdown in notes as literal characters', () => {
      const notes = '**bold** <img src=x onerror=alert(1)> [l](javascript:1)';
      settle([memberSessionRequest({ additionalNotes: notes })]);

      // Open the drawer, which is where the full notes live.
      buttonWith('Details')?.click();
      fixture.detectChanges();

      const root = fixture.nativeElement as HTMLElement;

      // The markdown is inert: the asterisks are characters, not emphasis.
      expect(text()).toContain('**bold**');
      expect(root.querySelector('strong')).toBeNull();

      // 🔴 THE ASSERTION IS OVER THE DOM, NOT OVER THE HTML STRING, AND THAT
      // IS A CORRECTION. The first version searched `innerHTML` for the
      // substring "onerror" and failed — because Angular had escaped the input
      // correctly and the serialised form of the ESCAPED TEXT NODE legitimately
      // reads `&lt;img src=x onerror=alert(1)&gt;`. Those are the member's own
      // characters, rendered as characters. A substring search cannot tell an
      // escaped payload from a live one; asking the DOM whether the element and
      // the attribute actually exist can.
      expect(root.querySelector('img')).toBeNull();
      expect(root.querySelector('[onerror]')).toBeNull();
      expect(root.querySelector('a[href^="javascript:"]')).toBeNull();

      // Anti-vacuity: the escape really did happen, rather than the payload
      // simply never reaching the DOM.
      expect(root.innerHTML).toContain('&lt;img');
    });

    it('renders a decline reason as literal characters too', () => {
      settle([
        memberSessionRequest({
          status: 'canceled',
          declineReason: '<script>alert(1)</script> **not bold**',
        }),
      ]);

      expect(text()).toContain('**not bold**');
      expect((fixture.nativeElement as HTMLElement).innerHTML).not.toContain(
        '<script',
      );
    });

    it('mounts no markdown component anywhere', () => {
      settle([scheduledSessionRequest()]);
      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          'ptah-markdown-block',
        ),
      ).toBeNull();
    });

    it('🔴 uses base-300 only as a FILL, and no muted token below the AA floor', () => {
      settle([scheduledSessionRequest()]);
      const html = (fixture.nativeElement as HTMLElement).innerHTML;
      expect(html).not.toContain(BORDER_FILL_MISUSE);
      expect(html).not.toContain(MUTED_TOO_FAINT);
    });
  });
});
