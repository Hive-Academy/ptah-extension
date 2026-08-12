import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import type {
  MemberCategory,
  MemberTopicSummary,
  Paged,
} from '@ptah-contracts/community';
import { provideMarkdownRendering } from '@ptah-extension/markdown';

import { FeedPage } from './feed-page';

const CATEGORIES_URL = '/api/v1/members/community/categories';
const TOPICS_URL = '/api/v1/members/community/topics';

function category(overrides: Partial<MemberCategory> = {}): MemberCategory {
  return {
    id: 'cat_1',
    slug: 'general',
    name: 'General',
    description: null,
    visibility: 'member',
    sortOrder: 0,
    topicCount: 2,
    unreadCount: 0,
    ...overrides,
  };
}

function topic(
  overrides: Partial<MemberTopicSummary> = {},
): MemberTopicSummary {
  return {
    id: 'top_1',
    slug: 'welcome',
    title: 'Welcome to the community',
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

describe('FeedPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideMarkdownRendering({ extensions: 'member' }),
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function create(): ComponentFixture<FeedPage> {
    const fixture = TestBed.createComponent(FeedPage);
    fixture.detectChanges();
    return fixture;
  }

  function topicsRequest(): TestRequest {
    return httpMock.expectOne((r) => r.url === TOPICS_URL);
  }

  function settle(
    fixture: ComponentFixture<FeedPage>,
    categories: MemberCategory[],
    page: Paged<MemberTopicSummary>,
  ): void {
    httpMock.expectOne(CATEGORIES_URL).flush(categories);
    topicsRequest().flush(page);
    fixture.detectChanges();
  }

  it('issues exactly two requests on load — the rail and the page', () => {
    // ⚠️ NOT R6.2. That one-request budget is the HUB's. Two here is the
    // deliberate design (see the class docblock); asserting the count pins it so
    // a future card that fetches for itself shows up as a diff, not a surprise.
    create();
    const all = httpMock.match(() => true);

    expect(all.map((r) => r.request.url).sort()).toEqual([
      CATEGORIES_URL,
      TOPICS_URL,
    ]);
    all[0].flush([category()]);
    all[1].flush(paged([]));
  });

  it('renders categories in the order the SERVER returned (R1.1.4)', () => {
    // The list is already in admin-defined `sortOrder`. Re-sorting here would
    // reorder only what is on screen and would drift from the admin's intent.
    const fixture = create();
    settle(
      fixture,
      [
        category({ id: 'cat_1', name: 'Announcements', sortOrder: 0 }),
        category({ id: 'cat_2', name: 'Show and tell', sortOrder: 1 }),
        category({ id: 'cat_3', name: 'Help', sortOrder: 2 }),
      ],
      paged([topic()]),
    );

    const rail = Array.from<HTMLElement>(
      fixture.nativeElement.querySelectorAll(
        'nav[aria-label="Categories"] .truncate',
      ),
    ).map((el) => el.textContent?.trim());

    expect(rail).toEqual(['Announcements', 'Show and tell', 'Help']);
  });

  it('renders topics in the order the SERVER returned, pinned first (R1.2.5)', () => {
    const fixture = create();
    settle(
      fixture,
      [category()],
      paged([
        topic({ id: 'top_pin', title: 'Read me first', pinned: true }),
        topic({ id: 'top_2', title: 'A newer thread' }),
      ]),
    );

    const titles = Array.from<HTMLElement>(
      fixture.nativeElement.querySelectorAll('ptah-thread-row'),
    ).map((row) => row.textContent ?? '');

    expect(titles[0]).toContain('Read me first');
    expect(titles[1]).toContain('A newer thread');
    expect(
      fixture.nativeElement.querySelector('[aria-label="Pinned"]'),
    ).not.toBeNull();
  });

  it('binds unread counts from the wire, with the right noun on each (R1.6.2)', () => {
    // `MemberCategory.unreadCount` counts TOPICS; `MemberTopicSummary.unreadCount`
    // counts POSTS. Both render "N new"; only the accessible label disambiguates,
    // and binding them the wrong way round is invisible without this assertion.
    const fixture = create();
    settle(
      fixture,
      [category({ unreadCount: 2 })],
      paged([topic({ unreadCount: 5 })]),
    );

    const labels = Array.from<HTMLElement>(
      fixture.nativeElement.querySelectorAll(
        '[aria-label$="threads"], [aria-label$="replies"]',
      ),
    ).map((el) => el.getAttribute('aria-label'));

    expect(labels).toContain('2 unread threads');
    expect(labels).toContain('5 unread replies');
  });

  it('links each row to its thread by SLUG', () => {
    const fixture = create();
    settle(fixture, [category()], paged([topic({ slug: 'welcome' })]));

    const link: HTMLAnchorElement = fixture.nativeElement.querySelector(
      'section[aria-label="Threads"] a',
    );
    expect(link.getAttribute('href')).toBe('/members/community/topics/welcome');
  });

  it('renders EmptyState on an empty feed, never a bare zero (R1.7.3, R6.3)', () => {
    const fixture = create();
    settle(fixture, [category()], paged([]));

    expect(
      fixture.nativeElement.querySelector('ptah-empty-state'),
    ).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('0 results');
    // The copy points at the composer rather than reporting a count.
    expect(fixture.nativeElement.textContent).toContain(
      'Start the first thread',
    );
  });

  it('names the filter in the empty copy so "nothing here" is not ambiguous', () => {
    const fixture = create();
    settle(
      fixture,
      [category({ id: 'cat_1', name: 'Help' })],
      paged([topic()]),
    );

    fixture.nativeElement
      .querySelectorAll('nav[aria-label="Categories"] button')[1]
      .click();
    topicsRequest().flush(paged([]));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'No threads in Help yet.',
    );
  });

  it('filters by category and RESETS to page 1', () => {
    // Page 4 of "All threads" is not page 4 of one category — keeping the
    // number lands the member on an empty page.
    const fixture = create();
    settle(fixture, [category({ id: 'cat_1' })], paged([topic()]));

    fixture.nativeElement
      .querySelectorAll('nav[aria-label="Categories"] button')[1]
      .click();

    const request = topicsRequest();
    expect(request.request.params.get('categoryId')).toBe('cat_1');
    expect(request.request.params.get('page')).toBe('1');
    request.flush(paged([]));
  });

  it('paginates rather than accumulating (NFR-U6)', () => {
    const fixture = create();
    settle(
      fixture,
      [category()],
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
    request.flush(
      paged([topic({ id: 'b', title: 'Page two row' })], {
        page: 2,
        total: 30,
        hasMore: false,
      }),
    );
    fixture.detectChanges();

    // The old page is GONE, not appended. Unbounded DOM growth is the failure
    // NFR-U6 names.
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Page two row');
    expect(text).not.toContain('Page one row');
  });

  it('hides the pager on a single page', () => {
    const fixture = create();
    settle(fixture, [category()], paged([topic()]));

    expect(
      fixture.nativeElement.querySelector('nav[aria-label="Pagination"]'),
    ).toBeNull();
  });

  it('creates a topic and re-reads BOTH lists', () => {
    // The new topic changes the feed and the category `topicCount`. Patching
    // either locally would be a second derivation of a number the server owns.
    const fixture = create();
    settle(fixture, [category()], paged([]));

    fixture.componentInstance['createTopic']({
      categoryId: 'cat_1',
      title: 'A new thread',
      bodyMarkdown: 'Body',
    });

    const create$ = httpMock.expectOne(TOPICS_URL);
    expect(create$.request.method).toBe('POST');
    create$.flush({
      id: 'top_new',
      slug: 'a-new-thread',
      title: 'A new thread',
      categoryId: 'cat_1',
      categoryName: 'General',
      authorName: 'Ada',
      pinned: false,
      locked: false,
      acceptedPost: null,
      posts: { items: [], page: 1, pageSize: 25, total: 0, hasMore: false },
      createdAt: '2026-08-05T10:00:00.000Z',
      lastPostedAt: '2026-08-05T10:00:00.000Z',
      editedAt: null,
    });

    httpMock.expectOne(CATEGORIES_URL).flush([category({ topicCount: 3 })]);
    topicsRequest().flush(paged([topic({ title: 'A new thread' })]));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('A new thread');
  });

  it('a failed RAIL does not blank the feed', () => {
    // The topic list is the content; a nav sidebar failing must degrade the
    // sidebar, not the page (the section-status principle `HubPage` documents).
    const fixture = create();
    httpMock
      .expectOne(CATEGORIES_URL)
      .flush(null, { status: 500, statusText: 'Server Error' });
    topicsRequest().flush(paged([topic({ title: 'Still here' })]));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Still here');
    expect(fixture.nativeElement.textContent).not.toContain(
      'We could not load the community feed',
    );
  });

  it('a failed FEED shows a retryable error, not an empty state', () => {
    // "No threads yet" after a 500 tells a member the community is empty. It is
    // not; we failed. The two must never render the same.
    const fixture = create();
    httpMock.expectOne(CATEGORIES_URL).flush([category()]);
    topicsRequest().flush(null, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[role="alert"]').textContent,
    ).toContain('We could not load the community feed.');
    expect(fixture.nativeElement.querySelector('ptah-empty-state')).toBeNull();

    fixture.nativeElement.querySelector('[role="alert"] button').click();
    topicsRequest().flush(paged([topic()]));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('renders `visibility` as a LABEL and never hides a category for it', () => {
    const fixture = create();
    settle(
      fixture,
      [
        category({ id: 'cat_1', name: 'General', visibility: 'member' }),
        category({ id: 'cat_2', name: 'Cohort Lounge', visibility: 'cohort' }),
      ],
      paged([topic()]),
    );

    const rail: string = fixture.nativeElement.querySelector(
      'nav[aria-label="Categories"]',
    ).textContent;
    expect(rail).toContain('Cohort Lounge');
    expect(rail).toContain('Cohort');
  });

  it('renders NO markdown of its own — the feed is titles and metadata', () => {
    // NFR-S2 in its cheapest form: a list row has no body to render, so it must
    // not acquire a renderer. The composer's preview is the only markdown path
    // on this page, and it is `<ptah-markdown-block>`.
    const fixture = create();
    settle(fixture, [category()], paged([topic()]));

    expect(
      fixture.nativeElement.querySelector(
        'section[aria-label="Threads"] ptah-markdown-block',
      ),
    ).toBeNull();
  });
});
