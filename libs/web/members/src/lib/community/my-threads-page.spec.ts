import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import type { MemberTopicSummary, Paged } from '@ptah-contracts/community';

import { MyThreadsPage } from './my-threads-page';

const TOPICS_URL = '/api/v1/members/community/topics';

function topic(
  overrides: Partial<MemberTopicSummary> = {},
): MemberTopicSummary {
  return {
    id: 'top_1',
    slug: 'my-first-thread',
    title: 'Wiring a second provider tree',
    categoryId: 'cat_1',
    categoryName: 'General',
    authorName: 'Ada',
    replyCount: 3,
    unreadCount: 0,
    pinned: false,
    locked: false,
    hasAcceptedAnswer: false,
    lastPostedAt: '2026-08-05T10:00:00.000Z',
    createdAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

function paged(
  items: MemberTopicSummary[],
  overrides: Partial<Paged<MemberTopicSummary>> = {},
): Paged<MemberTopicSummary> {
  return {
    items,
    page: 1,
    pageSize: 25,
    total: items.length,
    hasMore: false,
    ...overrides,
  };
}

/**
 * MyThreadsPage — R9.2, R1.7.3, R6.4, NFR-U6, NFR-S2.
 *
 * ⚠️ THE INTERESTING ASSERTIONS HERE ARE ABOUT WHAT THIS PAGE DOES *NOT* DO.
 * It does not re-filter the server's answer, it does not carry an author id, it
 * does not render an `EmptyState` for a failure, and it does not accumulate
 * pages. Each of those is a plausible, well-intentioned addition that would be
 * a defect, and none of them is visible in a screenshot.
 */
describe('MyThreadsPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function create(): ComponentFixture<MyThreadsPage> {
    const fixture = TestBed.createComponent(MyThreadsPage);
    fixture.detectChanges();
    return fixture;
  }

  function topicsRequest(): TestRequest {
    return httpMock.expectOne((r) => r.url === TOPICS_URL);
  }

  function settle(
    fixture: ComponentFixture<MyThreadsPage>,
    page: Paged<MemberTopicSummary>,
  ): TestRequest {
    const request = topicsRequest();
    request.flush(page);
    fixture.detectChanges();
    return request;
  }

  /* ---------------------------------------------------------------------- */
  /* The request                                                             */
  /* ---------------------------------------------------------------------- */

  it('issues exactly ONE request, on the shared feed endpoint, with ?mine=true', () => {
    // ⚠️ ONE, not two. `FeedPage` issues two because it renders a category
    // rail; this page renders none, so a second request would buy nothing and
    // would spend budget the server's NFR-P4 five-query ceiling accounts for.
    // ⚠️ AND THE SAME ENDPOINT. There is no `GET .../community/my-threads` —
    // that path is a 404. `mine` is a `where` clause on the existing feed.
    create();
    const all = httpMock.match(() => true);

    expect(all).toHaveLength(1);
    expect(all[0].request.url).toBe(TOPICS_URL);
    expect(all[0].request.method).toBe('GET');
    expect(all[0].request.params.get('mine')).toBe('true');
    all[0].flush(paged([]));
  });

  it('sends NO author identity — the id comes from MemberGuard, server-side', () => {
    // `ListTopicsQueryDto` declares no `authorId`, and `forbidNonWhitelisted`
    // makes one a 400. That is deliberate: a named-author parameter would let
    // any entitled member enumerate any other member's threads and nothing
    // downstream would refuse it, because those topics genuinely are visible to
    // them. The browser holds no user id and must never need one here.
    create();
    const request = topicsRequest();
    const params = request.request.params;

    expect(params.has('authorId')).toBe(false);
    expect(params.has('userId')).toBe(false);
    expect(params.has('authorEmail')).toBe(false);
    expect(params.keys().sort()).toEqual(['mine', 'page']);
    request.flush(paged([]));
  });

  /* ---------------------------------------------------------------------- */
  /* Composition — the client re-filters nothing                             */
  /* ---------------------------------------------------------------------- */

  it('renders exactly the rows the SERVER returned and re-filters none of them', () => {
    // ⚠️ THE COMPOSITION PROPERTY, STATED FROM THE CLIENT SIDE. `mine` is
    // spread into the same `where` as `NOT_DELETED` and the visible-category
    // restriction, so a soft-deleted topic and a topic in a now-invisible
    // category are already absent from this payload — verified live against the
    // running server. The client's job is to add NOTHING: a second copy of an
    // access rule in a browser is a rule that can be turned off with devtools,
    // and a client-side filter would also make the pager's totals lie.
    const fixture = create();
    settle(
      fixture,
      paged([
        topic({ id: 'a', title: 'Mine, in a member category' }),
        topic({
          id: 'b',
          title: 'Mine, in a staff category',
          categoryName: 'Staff',
        }),
      ]),
    );

    const rows = Array.from<HTMLElement>(
      fixture.nativeElement.querySelectorAll('ptah-thread-row'),
    ).map((row) => row.textContent ?? '');

    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('Mine, in a member category');
    expect(rows[1]).toContain('Mine, in a staff category');
  });

  it('preserves the SERVER ordering — pinned first, then last activity', () => {
    const fixture = create();
    settle(
      fixture,
      paged([
        topic({ id: 'pin', title: 'A pinned thread of mine', pinned: true }),
        topic({ id: 'new', title: 'A newer thread of mine' }),
      ]),
    );

    const rows = Array.from<HTMLElement>(
      fixture.nativeElement.querySelectorAll('ptah-thread-row'),
    ).map((row) => row.textContent ?? '');

    expect(rows[0]).toContain('A pinned thread of mine');
    expect(rows[1]).toContain('A newer thread of mine');
    expect(
      fixture.nativeElement.querySelector('[aria-label="Pinned"]'),
    ).not.toBeNull();
  });

  /* ---------------------------------------------------------------------- */
  /* Empty vs unavailable (R6.4)                                             */
  /* ---------------------------------------------------------------------- */

  it('RESOLVES to an EmptyState when the member has authored nothing', () => {
    // ⚠️ THE EXPECTED STATE ON A NEW ACCOUNT, NOT AN EDGE CASE — and it must
    // RESOLVE. A spinner that never stops is the failure mode a "my stuff"
    // page invites, because zero rows looks like "still loading".
    const fixture = create();
    settle(fixture, paged([]));

    expect(
      fixture.nativeElement.querySelector('ptah-empty-state'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[aria-busy="true"]'),
    ).toBeNull();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('the empty copy points at the composer and never reports a zero (R1.7.3)', () => {
    const fixture = create();
    settle(fixture, paged([]));

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('You have not started a thread yet.');
    expect(text).toContain('Start your first thread');
    expect(text).not.toContain('0 results');
    expect(text).not.toContain('0 threads');

    // The composer lives on the feed — one composer, one place a thread is
    // written — so the CTA links there rather than duplicating it.
    const cta: HTMLAnchorElement = Array.from<HTMLAnchorElement>(
      fixture.nativeElement.querySelectorAll('ptah-empty-state a'),
    )[0];
    expect(cta.getAttribute('href')).toBe('/members/community');
  });

  it('a FAILED load renders a retryable alert, never an EmptyState (R6.4)', () => {
    // ⚠️ "You have not started a thread yet" after a 500 tells a member their
    // writing is gone. `'empty'` and `'unavailable'` are different facts and a
    // member acts on them differently; collapsing them destroys the signal.
    const fixture = create();
    topicsRequest().flush(null, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    const alert: HTMLElement =
      fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert.textContent).toContain('We could not load your threads.');
    expect(fixture.nativeElement.querySelector('ptah-empty-state')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain(
      'You have not started a thread yet.',
    );
  });

  it('retrying after a failure re-sends ?mine=true and clears the alert', () => {
    const fixture = create();
    topicsRequest().flush(null, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    fixture.nativeElement.querySelector('[role="alert"] button').click();
    const retry = topicsRequest();
    expect(retry.request.params.get('mine')).toBe('true');
    retry.flush(paged([topic({ title: 'It came back' })]));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('It came back');
  });

  it('a failure CLEARS the previous page rather than leaving stale rows', () => {
    // Rows sitting under an error banner read as "these are current". They are
    // not — they are whatever loaded before the thing that failed.
    const fixture = create();
    settle(fixture, paged([topic({ title: 'Loaded before the failure' })]));

    fixture.componentInstance['reload']();
    topicsRequest().flush(null, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain(
      'Loaded before the failure',
    );
    expect(
      fixture.nativeElement.querySelector('[role="alert"]'),
    ).not.toBeNull();
  });

  /* ---------------------------------------------------------------------- */
  /* Rows                                                                    */
  /* ---------------------------------------------------------------------- */

  it('links each row to its thread by SLUG', () => {
    const fixture = create();
    settle(fixture, paged([topic({ slug: 'wiring-a-provider-tree' })]));

    const link: HTMLAnchorElement = fixture.nativeElement.querySelector(
      'section[aria-label="My threads"] a',
    );
    expect(link.getAttribute('href')).toBe(
      '/members/community/topics/wiring-a-provider-tree',
    );
  });

  it('binds unread as REPLIES, the noun a row commits to (R1.6.2)', () => {
    // `ThreadRow.unreadCount` counts POSTS inside one topic;
    // `MemberCategory.unreadCount` counts TOPICS. Both chips render "N new" and
    // only the accessible label tells them apart — this page has no category
    // rail, so the row noun is the only one it can get wrong.
    const fixture = create();
    settle(fixture, paged([topic({ unreadCount: 1 })]));

    const label: HTMLElement = fixture.nativeElement.querySelector(
      '[aria-label="1 unread reply"]',
    );
    expect(label).not.toBeNull();
    expect(label.textContent).toContain('1 new');
  });

  it('shows the category on the row, since there is no rail to show it', () => {
    const fixture = create();
    settle(fixture, paged([topic({ categoryName: 'Site feedback' })]));

    expect(
      fixture.nativeElement.querySelector('ptah-tag-chip').textContent,
    ).toContain('Site feedback');
  });

  it('reuses ThreadRow from @ptah-web/panel-ui rather than a third row', () => {
    // §5.3's promotion rule cuts both ways: a primitive is promoted when a
    // second panel renders it, and having been promoted it is what the third
    // consumer uses. A local copy here would be the duplication the promotion
    // was for.
    const fixture = create();
    settle(fixture, paged([topic()]));

    expect(
      fixture.nativeElement.querySelector('ptah-thread-row'),
    ).not.toBeNull();
  });

  /* ---------------------------------------------------------------------- */
  /* Pagination (NFR-U6)                                                     */
  /* ---------------------------------------------------------------------- */

  it('paginates rather than accumulating, and carries ?mine=true to page 2', () => {
    const fixture = create();
    settle(
      fixture,
      paged([topic({ id: 'a', title: 'Page one row' })], {
        total: 30,
        hasMore: true,
      }),
    );

    const next = Array.from<HTMLButtonElement>(
      fixture.nativeElement.querySelectorAll(
        'nav[aria-label="Pagination"] button',
      ),
    ).find((b) => b.textContent?.trim() === 'Next');
    next?.click();

    const request = topicsRequest();
    expect(request.request.params.get('page')).toBe('2');
    // ⚠️ Losing the filter on page 2 would silently show a member everyone
    // else's threads under a heading that says "My threads".
    expect(request.request.params.get('mine')).toBe('true');
    request.flush(
      paged([topic({ id: 'b', title: 'Page two row' })], {
        page: 2,
        total: 30,
        hasMore: false,
      }),
    );
    fixture.detectChanges();

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Page two row');
    expect(text).not.toContain('Page one row');
  });

  it('hides the pager on a single page', () => {
    const fixture = create();
    settle(fixture, paged([topic()]));

    expect(
      fixture.nativeElement.querySelector('nav[aria-label="Pagination"]'),
    ).toBeNull();
  });

  it('keeps "Previous" reachable on the last page', () => {
    // `hasMore` alone is not enough — a member on the last page of three still
    // needs a way back.
    const fixture = create();
    settle(
      fixture,
      paged([topic()], { page: 3, total: 60, hasMore: false, pageSize: 25 }),
    );

    const pager: HTMLElement = fixture.nativeElement.querySelector(
      'nav[aria-label="Pagination"]',
    );
    expect(pager).not.toBeNull();
    const buttons = Array.from<HTMLButtonElement>(
      pager.querySelectorAll('button'),
    );
    expect(
      buttons.find((b) => b.textContent?.trim() === 'Previous')?.disabled,
    ).toBe(false);
    expect(
      buttons.find((b) => b.textContent?.trim() === 'Next')?.disabled,
    ).toBe(true);
  });

  /* ---------------------------------------------------------------------- */
  /* NFR-S2                                                                  */
  /* ---------------------------------------------------------------------- */

  it('renders NO markdown at all — a row is a title and metadata', () => {
    // NFR-S2 in its cheapest form. `MemberTopicSummary` carries no body, so
    // there is nothing here to render and nothing here may acquire a renderer.
    const fixture = create();
    settle(fixture, paged([topic({ title: 'A **bold** looking title' })]));

    expect(
      fixture.nativeElement.querySelector('ptah-markdown-block'),
    ).toBeNull();
    // The title is a TEXT NODE: markdown syntax shows as characters, and an
    // HTML-looking title cannot become an element.
    expect(fixture.nativeElement.textContent).toContain('A **bold** looking');
  });

  it('a hostile title reaches the DOM as text, never as markup', () => {
    const fixture = create();
    settle(fixture, paged([topic({ title: '<img src=x onerror=alert(1)>' })]));

    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    expect(fixture.nativeElement.innerHTML).toContain('&lt;img');
  });
});
