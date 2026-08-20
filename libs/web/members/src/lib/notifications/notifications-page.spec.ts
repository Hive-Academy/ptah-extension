import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { MemberNotificationsStore } from '../state/member-notifications.store';
import { NotificationsPage } from './notifications-page';
import {
  emptyNotificationPage,
  memberNotification,
  notificationPage,
} from './notification-fixtures';

const NOTIFICATIONS = '/api/v1/members/notifications';
const UNREAD_COUNT = `${NOTIFICATIONS}/unread-count`;
const READ_ALL = `${NOTIFICATIONS}/read-all`;
/**
 * `POST notifications/read` — "mark THESE".
 *
 * ⚠️ FOUR SEGMENTS, NOT FIVE, AND THAT IS THE ONE THING THAT COULD GO WRONG
 * HERE. `${NOTIFICATIONS}/read` and `${NOTIFICATIONS}/<id>/read` are different
 * URLs; the server proved live that they route to different handlers. Writing
 * this as a template beside `READ_ALL` keeps the three write URLs visible
 * together — one / these / all.
 */
const BULK_READ = `${NOTIFICATIONS}/read`;

/** See the note in `packs-page.spec.ts` — assembled so Task 4.7's rule allows it. */
const BORDER_FILL_MISUSE = ['border', 'base-300'].join('-');
const LOW_CONTRAST_TEXT = ['text', 'base-content/40'].join('-');

describe('NotificationsPage (R10.3, R10.4, R9.7, NFR-S2, ASSUMPTION-28)', () => {
  let fixture: ComponentFixture<NotificationsPage>;
  let http: HttpTestingController;
  let navigate: jest.SpyInstance;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [NotificationsPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        // Provided HERE, at the TestBed root, exactly as the `/members` route
        // provides it — one instance for the page under test. The page itself
        // must NOT list it in `providers`, or the badge and the inbox would be
        // reading two different objects.
        MemberNotificationsStore,
      ],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    navigate = jest
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);

    fixture = TestBed.createComponent(NotificationsPage);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  function root(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return (root().textContent ?? '').replace(/\s+/g, ' ');
  }

  function html(): string {
    return root().innerHTML;
  }

  function flush(body: unknown, opts?: { status: number }): void {
    const request = http.expectOne((r) => r.url === NOTIFICATIONS);
    if (opts) {
      request.flush(body, { status: opts.status, statusText: 'Error' });
    } else {
      request.flush(body);
    }
    fixture.detectChanges();
  }

  function rows(): HTMLElement[] {
    return Array.from(root().querySelectorAll('[data-notification-id]'));
  }

  function checkbox(id: string): HTMLInputElement {
    const element = root().querySelector<HTMLInputElement>(
      `[data-select-id="${id}"]`,
    );
    if (element === null) throw new Error(`no checkbox for ${id}`);
    return element;
  }

  function select(id: string): void {
    checkbox(id).dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function toolbar(): HTMLElement | null {
    return root().querySelector('[role="region"][aria-label="Bulk actions"]');
  }

  /* ---------------------------------------------------------------------- */
  /* The four cells                                                          */
  /* ---------------------------------------------------------------------- */

  describe('error, loading, empty and list are four different renders', () => {
    it('LOADING: a resolving busy state', () => {
      expect(root().querySelector('[aria-busy="true"]')).not.toBeNull();
      expect(text()).toContain('Loading your notifications');

      flush(emptyNotificationPage());
    });

    it('EMPTY: an EmptyState, not an error', () => {
      flush(emptyNotificationPage());

      expect(text()).toContain('You have no notifications yet.');
      expect(root().querySelector('[role="alert"]')).toBeNull();
      expect(text()).not.toContain('We could not load your notifications.');
    });

    it('ERROR: a DIFFERENT sentence from empty, with an alert role', () => {
      flush(null, { status: 500 });

      expect(text()).toContain('We could not load your notifications.');
      // The collapsed-branch assertion: on a 500 the rows are cleared, so a
      // page testing the row count first says "you are all caught up".
      expect(text()).not.toContain('You have no notifications yet.');
      expect(root().querySelector('[role="alert"]')).not.toBeNull();
    });

    it('ERROR is retryable', () => {
      flush(null, { status: 500 });

      root().querySelector<HTMLButtonElement>('[role="alert"] button')?.click();
      fixture.detectChanges();

      flush(notificationPage());
      expect(rows()).toHaveLength(1);
    });

    it('LIST: rows render in the SERVER’S order, never re-sorted', () => {
      flush(
        notificationPage([
          memberNotification({ id: 'n1', title: 'First' }),
          memberNotification({ id: 'n2', title: 'Second' }),
        ]),
      );

      expect(
        rows().map((row) => row.getAttribute('data-notification-id')),
      ).toEqual(['n1', 'n2']);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 R10.3 — read/unread, and what drives it                              */
  /* ---------------------------------------------------------------------- */

  describe('🔴 R10.3 — the unread marker is driven by readAt === null and nothing else', () => {
    it('an unread row is marked and a read row is not', () => {
      flush(
        notificationPage([
          memberNotification({ id: 'n1', readAt: null }),
          memberNotification({
            id: 'n2',
            readAt: '2026-08-10T00:00:00.000Z',
          }),
        ]),
      );

      const [unread, read] = rows();
      expect(unread.getAttribute('data-unread')).toBe('true');
      expect(read.getAttribute('data-unread')).toBe('false');
    });

    it('the state is not carried by colour alone', () => {
      // A coloured dot is invisible to a screen reader and to anyone who
      // cannot distinguish it. The state is also in the accessible text.
      flush(
        notificationPage([
          memberNotification({ id: 'n1', readAt: null }),
          memberNotification({
            id: 'n2',
            readAt: '2026-08-10T00:00:00.000Z',
          }),
        ]),
      );

      expect(rows()[0].textContent).toContain('(unread)');
      expect(rows()[1].textContent).toContain('(read)');
    });

    it('selection does NOT change the read marker', () => {
      // The failure this rules out: an implementation that treats "I ticked
      // it" as "I read it". Selection is an intent to act, not an act.
      flush(notificationPage([memberNotification({ id: 'n1' })]));

      select('n1');

      expect(rows()[0].getAttribute('data-unread')).toBe('true');
      http.verify();
    });

    it('opening a notification delegates to the store — mark read then navigate', () => {
      flush(notificationPage([memberNotification({ id: 'n1' })]));

      root().querySelector<HTMLButtonElement>('[data-open-id="n1"]')?.click();
      fixture.detectChanges();

      http.expectOne(`${NOTIFICATIONS}/n1/read`).flush({ readAt: 'x' });
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 0 });

      expect(navigate).toHaveBeenCalledWith(
        '/members/community/topics/b15a-topic',
      );
    });

    it('🔴 the page does not inspect item.route itself', () => {
      // RISK-AO's guard has exactly one home. A page that navigated itself
      // would be a second door into the same open-redirect hole — and this
      // asserts the hostile value is refused when it arrives through the page,
      // not only through a direct store call.
      const quiet = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);

      flush(
        notificationPage([
          memberNotification({ id: 'n1', route: '//evil.example' }),
        ]),
      );

      root().querySelector<HTMLButtonElement>('[data-open-id="n1"]')?.click();
      fixture.detectChanges();

      http.expectOne(`${NOTIFICATIONS}/n1/read`).flush({ readAt: 'x' });
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 0 });

      expect(navigate).toHaveBeenCalledWith('/members/notifications');
      quiet.mockRestore();
    });
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 ASSUMPTION-28 — read on open ONLY                                    */
  /* ---------------------------------------------------------------------- */

  describe('🔴 ASSUMPTION-28 — read on OPEN only, never on scroll or on view', () => {
    it('rendering an unread row writes nothing', () => {
      // A read-on-view implementation empties the inbox for a member who
      // merely glanced at it, and it is unfalsifiable server-side: the rows
      // are read and nobody can say whether anyone read them.
      flush(
        notificationPage([
          memberNotification({ id: 'n1' }),
          memberNotification({ id: 'n2' }),
          memberNotification({ id: 'n3' }),
        ]),
      );

      expect(rows()).toHaveLength(3);
      http.verify();
    });

    it('the page source contains no IntersectionObserver', () => {
      const { readFileSync } = require('node:fs') as typeof import('node:fs');
      const source = readFileSync(`${__dirname}/notifications-page.ts`, 'utf8');
      const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

      expect(code).not.toContain('IntersectionObserver');
      expect(code).not.toContain('scroll');

      flush(emptyNotificationPage());
    });
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 R9.7 — SelectionToolbar, reused                                      */
  /* ---------------------------------------------------------------------- */

  describe('🔴 R9.7 — bulk mark-read through the shared SelectionToolbar', () => {
    it('the toolbar is hidden until something is selected', () => {
      flush(notificationPage([memberNotification({ id: 'n1' })]));

      expect(toolbar()).toBeNull();
    });

    it('it appears on selection, with the pluralised noun', () => {
      flush(
        notificationPage([
          memberNotification({ id: 'n1' }),
          memberNotification({ id: 'n2' }),
        ]),
      );

      select('n1');
      expect(toolbar()?.textContent).toContain('1 notification selected');

      select('n2');
      expect(toolbar()?.textContent).toContain('2 notifications selected');
    });

    it('Clear empties the selection and hides the bar', () => {
      flush(notificationPage([memberNotification({ id: 'n1' })]));

      select('n1');
      expect(toolbar()).not.toBeNull();

      const clear = Array.from(
        toolbar()?.querySelectorAll('button') ?? [],
      ).find((button) => button.textContent?.includes('Clear'));
      clear?.click();
      fixture.detectChanges();

      expect(toolbar()).toBeNull();
    });

    it('it is the SHARED component, not a local re-implementation', () => {
      flush(notificationPage([memberNotification({ id: 'n1' })]));
      select('n1');

      expect(root().querySelector('ptah-selection-toolbar')).not.toBeNull();
    });

    it('🔴 selecting EVERY unread row on a whole-inbox page issues ONE read-all', () => {
      // The common case, and the one Task 15.6's note is about: one request,
      // not N. It is only safe because the loaded page IS the whole inbox —
      // page 1, `hasMore: false`, `total === items.length`.
      flush(
        notificationPage([
          memberNotification({ id: 'n1' }),
          memberNotification({ id: 'n2' }),
        ]),
      );

      select('n1');
      select('n2');
      markRead();

      http.expectOne(READ_ALL).flush({ marked: 2 });
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 0 });
      http.verify();
    });

    it('🔴 a PARTIAL selection does NOT issue read-all — it names the ids', () => {
      // 🔴 THE ASSERTION THAT MATTERS MOST IN THIS FILE, AND ITS NEGATIVE HALF
      // IS UNCHANGED. `read-all` marks the ENTIRE INBOX read, and there is NO
      // "mark unread" endpoint — so using it for a partial selection would
      // irreversibly destroy unread state the member never selected, from a
      // control that said it acted on a selection.
      //
      // ⚠️ THE POSITIVE HALF MOVED FROM N REQUESTS TO ONE (Batch 15B). Until
      // `POST notifications/read` existed the only safe implementation was one
      // `:id/read` per row; this now costs a single request that names exactly
      // the selected ids. The BODY is asserted, not just the URL — a bulk call
      // that posted the wrong ids would look identical at the routing layer and
      // would mark the wrong rows read, permanently.
      flush(
        notificationPage([
          memberNotification({ id: 'n1' }),
          memberNotification({ id: 'n2' }),
          memberNotification({ id: 'n3' }),
        ]),
      );

      select('n1');
      select('n2');
      markRead();

      http.expectNone(READ_ALL);
      http.expectNone(`${NOTIFICATIONS}/n1/read`);
      http.expectNone(`${NOTIFICATIONS}/n2/read`);

      const bulk = http.expectOne(BULK_READ);
      expect(bulk.request.method).toBe('POST');
      // The unselected `n3` must be ABSENT — that absence is the whole point.
      expect(bulk.request.body).toEqual({ ids: ['n1', 'n2'] });
      bulk.flush({ marked: 2 });

      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 1 });
      http.verify();
    });

    it('🔴 selecting every row on a page that is NOT the whole inbox avoids read-all', () => {
      // `hasMore: true` means unread rows exist on pages the member has never
      // seen. `read-all` would mark those read too — so even a "select all on
      // this page" gesture has to travel as "these two ids".
      flush(
        notificationPage(
          [memberNotification({ id: 'n1' }), memberNotification({ id: 'n2' })],
          { total: 30, hasMore: true },
        ),
      );

      select('n1');
      select('n2');
      markRead();

      http.expectNone(READ_ALL);

      const bulk = http.expectOne(BULK_READ);
      expect(bulk.request.body).toEqual({ ids: ['n1', 'n2'] });
      bulk.flush({ marked: 2 });

      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 28 });
      http.verify();
    });

    it('marking read clears the selection', () => {
      flush(notificationPage([memberNotification({ id: 'n1' })]));

      select('n1');
      markRead();

      http.expectOne(READ_ALL).flush({ marked: 1 });
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 0 });
      fixture.detectChanges();

      expect(toolbar()).toBeNull();
    });

    /* -- 🔴 The selection outlives the round trip ------------------------- */

    it('🔴 a FAILED bulk write KEEPS the selection and the toolbar', () => {
      // 🔴 THE REGRESSION THIS PINS. The page used to clear the selection
      // synchronously on click. The store rolls the rows and the count back on
      // a 500 — but the checkboxes were already unticked and the toolbar
      // already hidden by then, so the member watched the rows silently
      // un-strike-through with NO CONTROL LEFT TO RETRY FROM.
      flush(
        notificationPage(
          [memberNotification({ id: 'n1' }), memberNotification({ id: 'n2' })],
          { total: 30, hasMore: true },
        ),
      );

      select('n1');
      markRead();

      const bulk = http.expectOne(BULK_READ);
      // It is still selected while the write is in the air — the member has not
      // been told anything yet.
      expect(toolbar()).not.toBeNull();

      bulk.flush(null, { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();

      expect(toolbar()?.textContent).toContain('1 notification selected');
      expect(checkbox('n1').checked).toBe(true);
      // The store restored the row, and the toolbar is still there to retry
      // from — one click, not a re-selection from scratch.
      expect(rows()[0].getAttribute('data-unread')).toBe('true');
      expect(markReadButton()?.disabled).toBe(false);
    });

    it('a failed read-all keeps the selection too', () => {
      // The other branch of `markSelectedRead`. The equivalence guard routes a
      // whole-inbox selection to `read-all`, and the outcome has to reach the
      // page through that path as well.
      flush(notificationPage([memberNotification({ id: 'n1' })]));

      select('n1');
      markRead();

      http
        .expectOne(READ_ALL)
        .flush(null, { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();

      expect(toolbar()?.textContent).toContain('1 notification selected');
    });

    it('🔴 the Mark read button is disabled while the write is in flight', () => {
      // The selection now survives the round trip, so without this the member
      // could submit the same rows again while the first request is still out.
      flush(
        notificationPage(
          [memberNotification({ id: 'n1' }), memberNotification({ id: 'n2' })],
          { total: 30, hasMore: true },
        ),
      );

      select('n1');
      expect(markReadButton()?.disabled).toBe(false);

      markRead();
      const bulk = http.expectOne(BULK_READ);
      expect(markReadButton()?.disabled).toBe(true);

      bulk.flush({ marked: 1 });
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 29 });
      fixture.detectChanges();

      // Success: exactly the submitted row is dropped, so the bar goes.
      expect(toolbar()).toBeNull();
    });

    it('🔴 rows ticked WHILE the write is in flight survive its success', () => {
      // Success drops exactly the ids that were SUBMITTED. Clearing wholesale
      // would silently throw away a selection the completed write knew nothing
      // about.
      flush(
        notificationPage(
          [
            memberNotification({ id: 'n1' }),
            memberNotification({ id: 'n2' }),
            memberNotification({ id: 'n3' }),
          ],
          { total: 30, hasMore: true },
        ),
      );

      select('n1');
      markRead();

      const bulk = http.expectOne(BULK_READ);
      expect(bulk.request.body).toEqual({ ids: ['n1'] });

      select('n2');

      bulk.flush({ marked: 1 });
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 29 });
      fixture.detectChanges();

      expect(toolbar()?.textContent).toContain('1 notification selected');
      expect(checkbox('n2').checked).toBe(true);
    });

    it('selecting an ALREADY-READ row alone writes nothing', () => {
      flush(
        notificationPage([
          memberNotification({ id: 'n1', readAt: '2026-08-10T00:00:00.000Z' }),
        ]),
      );

      select('n1');
      markRead();

      http.verify();
    });

    function markReadButton(): HTMLButtonElement | undefined {
      return Array.from(toolbar()?.querySelectorAll('button') ?? []).find(
        (candidate) => candidate.textContent?.includes('Mark read'),
      );
    }

    function markRead(): void {
      markReadButton()?.click();
      fixture.detectChanges();
    }
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 NFR-S2 — bodyPreview is an escaped text node                         */
  /* ---------------------------------------------------------------------- */

  describe('🔴 NFR-S2 — bodyPreview is an ESCAPED TEXT NODE', () => {
    it('markdown in the preview shows LITERALLY', () => {
      // Measured live: the real body was `**Grace here** — a real reply…`.
      // The contract states this string is NOT sanitized, so it must never
      // reach a renderer.
      flush(notificationPage());

      expect(text()).toContain('**Grace here**');
      expect(root().querySelector('strong')).toBeNull();
    });

    it('an injected script or image tag arrives as characters', () => {
      flush(
        notificationPage([
          memberNotification({
            id: 'n1',
            bodyPreview:
              '<img src=x onerror=alert(1)><script>alert(2)</script>',
          }),
        ]),
      );

      expect(root().querySelector('img')).toBeNull();
      expect(root().querySelector('script')).toBeNull();
      expect(
        root().querySelector('[data-body-preview="n1"]')?.textContent,
      ).toContain('<img src=x onerror=alert(1)>');
    });

    it('no markdown block is rendered on this page', () => {
      // The chokepoint importer list stays at SIX.
      flush(notificationPage());

      expect(html()).not.toContain('ptah-markdown-block');
    });

    it('the page source names no bypass or innerHTML binding', () => {
      const { readFileSync } = require('node:fs') as typeof import('node:fs');
      const source = readFileSync(`${__dirname}/notifications-page.ts`, 'utf8');
      const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

      expect(code).not.toContain('innerHTML');
      expect(code).not.toContain('bypassSecurityTrust');
      expect(code).not.toContain('@ptah-extension/markdown');

      flush(emptyNotificationPage());
    });

    it('a null preview renders no empty element', () => {
      flush(
        notificationPage([memberNotification({ id: 'n1', bodyPreview: null })]),
      );

      expect(root().querySelector('[data-body-preview="n1"]')).toBeNull();
      expect(rows()).toHaveLength(1);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Paging, and the accessibility floor                                     */
  /* ---------------------------------------------------------------------- */

  describe('paging is the server’s', () => {
    it('renders the server’s echoed page window, not a hard-coded 25', () => {
      flush(
        notificationPage([memberNotification()], {
          page: 2,
          pageSize: 10,
          total: 30,
          hasMore: true,
        }),
      );

      // 🔴 THE UPPER BOUND IS THE ROWS ACTUALLY RENDERED, NOT page * pageSize.
      // A short page — a last page, or one thinned by a concurrent delete —
      // makes the arithmetic version claim rows that are not on screen. One
      // item at page 2 of size 10 is row 11, and row 11 only.
      expect(
        root().querySelector('[data-page-label]')?.textContent?.trim(),
      ).toBe('Showing 11–11 of 30');
    });

    it('a FULL page reports the whole window', () => {
      // Anti-vacuity for the case above: with a full page the two derivations
      // agree, so this pins that the fix did not simply always report one row.
      flush(
        notificationPage(
          Array.from({ length: 10 }, (_, index) =>
            memberNotification({ id: `n${index}` }),
          ),
          { page: 2, pageSize: 10, total: 30, hasMore: true },
        ),
      );

      expect(
        root().querySelector('[data-page-label]')?.textContent?.trim(),
      ).toBe('Showing 11–20 of 30');
    });

    it('renders no page label for an empty inbox', () => {
      flush(emptyNotificationPage());

      expect(root().querySelector('[data-page-label]')).toBeNull();
    });
  });

  describe('NFR-U — the accessibility and token floor', () => {
    it('every checkbox names its notification', () => {
      flush(
        notificationPage([
          memberNotification({ id: 'n1', title: 'First' }),
          memberNotification({ id: 'n2', title: 'Second' }),
        ]),
      );

      expect(checkbox('n1').getAttribute('aria-label')).toBe('Select: First');
      expect(checkbox('n2').getAttribute('aria-label')).toBe('Select: Second');
    });

    it('opening is a real button, so it is keyboard reachable', () => {
      // A clickable `div` is not focusable and not activatable by Enter.
      flush(notificationPage([memberNotification({ id: 'n1' })]));

      const open = root().querySelector('[data-open-id="n1"]');
      expect(open?.tagName.toLowerCase()).toBe('button');
      expect(open?.getAttribute('type')).toBe('button');
    });

    it('decorative marks are hidden from assistive tech', () => {
      flush(notificationPage());

      for (const icon of Array.from(
        root().querySelectorAll('lucide-angular'),
      )) {
        expect(icon.getAttribute('aria-hidden')).toBe('true');
      }
    });

    it(`emits no ${BORDER_FILL_MISUSE} and no ${LOW_CONTRAST_TEXT}`, () => {
      // Checked on the POPULATED and the EMPTY cell — B13's F-1 hid on the
      // empty one for three phases. `/40` on `EmptyState`'s `aria-hidden`
      // glyph is legal and is excluded by the text-bearing walk.
      flush(notificationPage());
      expect(html()).not.toContain(BORDER_FILL_MISUSE);
      expectNoLowContrastText();

      fixture.componentInstance['reload']();
      fixture.detectChanges();
      flush(emptyNotificationPage());
      expect(html()).not.toContain(BORDER_FILL_MISUSE);
      expectNoLowContrastText();
    });

    it('the page has exactly one h1', () => {
      flush(notificationPage());
      expect(root().querySelectorAll('h1')).toHaveLength(1);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 R9.3 — the page does not read the count                              */
  /* ---------------------------------------------------------------------- */

  it('🔴 the page never reads unreadCount() — the badge has ONE reader', () => {
    // `member-nav-badge.spec.ts` asserts this across the whole lib. It is
    // asserted here too, on the file most likely to acquire the second read,
    // because "the inbox already knows the count" is the reasoning that
    // creates the second source of truth R9.3 forbids.
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const source = readFileSync(`${__dirname}/notifications-page.ts`, 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

    expect(code).not.toContain('unreadCount');

    flush(emptyNotificationPage());
  });

  function textBearingElements(): HTMLElement[] {
    return Array.from(root().querySelectorAll<HTMLElement>('*')).filter(
      (element) => {
        if (element.closest('[aria-hidden="true"]')) return false;
        if (element.closest('svg')) return false;
        return Array.from(element.childNodes).some(
          (node) =>
            node.nodeType === Node.TEXT_NODE &&
            (node.textContent ?? '').trim().length > 0,
        );
      },
    );
  }

  function expectNoLowContrastText(): void {
    for (const element of textBearingElements()) {
      expect(element.className).not.toContain(LOW_CONTRAST_TEXT);
    }
  }
});
