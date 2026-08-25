import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import type {
  MemberSearchResults,
  SearchPostHit,
  SearchTopicHit,
} from '@ptah-contracts/community';

import { SearchPage } from './search-page';

const SEARCH_URL = '/api/v1/members/search';
const emptyPage = {
  items: [],
  page: 1,
  pageSize: 25,
  total: 0,
  hasMore: false,
};

function topicHit(overrides: Partial<SearchTopicHit> = {}): SearchTopicHit {
  return {
    id: 'top_1',
    slug: 'the-bug',
    titleExcerpt: {
      text: 'the bug in the parser',
      matches: [{ start: 4, length: 3 }],
    },
    categoryName: 'Help',
    authorName: 'Ada',
    replyCount: 2,
    lastPostedAt: '2026-08-05T10:00:00.000Z',
    ...overrides,
  };
}

function postHit(overrides: Partial<SearchPostHit> = {}): SearchPostHit {
  return {
    id: 'post_1',
    postNumber: 3,
    topicId: 'top_1',
    topicSlug: 'the-bug',
    topicTitle: 'The bug',
    categoryName: 'Help',
    bodyExcerpt: {
      text: 'I hit the same bug last week',
      matches: [{ start: 15, length: 3 }],
    },
    authorName: 'Grace',
    createdAt: '2026-08-04T10:00:00.000Z',
    ...overrides,
  };
}

function results(
  overrides: Partial<MemberSearchResults> = {},
): MemberSearchResults {
  return {
    topics: { ...emptyPage },
    posts: { ...emptyPage },
    lessons: { ...emptyPage },
    ...overrides,
  };
}

describe('SearchPage', () => {
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

  function create(): ComponentFixture<SearchPage> {
    const fixture = TestBed.createComponent(SearchPage);
    fixture.detectChanges();
    return fixture;
  }

  function typeQuery(
    fixture: ComponentFixture<SearchPage>,
    value: string,
  ): void {
    const input: HTMLInputElement = fixture.nativeElement.querySelector(
      'input[type="search"]',
    );
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function search(
    fixture: ComponentFixture<SearchPage>,
    query = 'bug',
  ): TestRequest {
    typeQuery(fixture, query);
    fixture.nativeElement
      .querySelector('form')
      .dispatchEvent(new Event('submit'));
    return httpMock.expectOne((r) => r.url === SEARCH_URL);
  }

  it('issues NO request until the member searches', () => {
    create();
    httpMock.expectNone(() => true);
  });

  it('shows a prompt, not an empty result, before the first search', () => {
    // "0 results" before anything has been asked is a lie about a query that
    // never ran.
    const fixture = create();

    expect(
      fixture.nativeElement.querySelector('ptah-empty-state'),
    ).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain(
      'Search the community.',
    );
  });

  it('disables the button under two characters (the server MinLength)', () => {
    const fixture = create();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector(
      'button[type="submit"]',
    );

    expect(button.disabled).toBe(true);
    typeQuery(fixture, 'b');
    expect(button.disabled).toBe(true);
    typeQuery(fixture, 'bu');
    expect(button.disabled).toBe(false);
  });

  it('sends `q` exactly as typed, trimmed, with page 1', () => {
    const request = search(create(), '  bug  ');

    expect(request.request.params.get('q')).toBe('bug');
    expect(request.request.params.get('page')).toBe('1');
    request.flush(results());
  });

  it('renders MULTIPLE matches in one excerpt as sibling spans', () => {
    const fixture = create();
    search(fixture).flush(
      results({
        topics: {
          items: [
            topicHit({
              titleExcerpt: {
                text: 'bug here and bug there',
                matches: [
                  { start: 0, length: 3 },
                  { start: 13, length: 3 },
                ],
              },
            }),
          ],
          page: 1,
          pageSize: 25,
          total: 1,
          hasMore: false,
        },
      }),
    );
    fixture.detectChanges();

    const spans = Array.from<HTMLElement>(
      fixture.nativeElement.querySelectorAll('#search-topics ~ ul span'),
    );
    const highlighted = spans.filter((s) => s.className.includes('bg-primary'));

    expect(highlighted.map((s) => s.textContent)).toEqual(['bug', 'bug']);
  });

  it('renders zero matches as one unhighlighted run', () => {
    const fixture = create();
    search(fixture).flush(
      results({
        topics: {
          items: [
            topicHit({
              titleExcerpt: { text: 'matched on another field', matches: [] },
            }),
          ],
          page: 1,
          pageSize: 25,
          total: 1,
          hasMore: false,
        },
      }),
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.bg-primary')).toHaveLength(
      0,
    );
    expect(fixture.nativeElement.textContent).toContain(
      'matched on another field',
    );
  });

  it('renders OUT-OF-RANGE offsets as plain text rather than throwing', () => {
    // A page that can crash on a boundary case is worse than one that renders
    // the excerpt un-highlighted.
    const fixture = create();
    search(fixture).flush(
      results({
        topics: {
          items: [
            topicHit({
              titleExcerpt: {
                text: 'short',
                matches: [{ start: 40, length: 9 }],
              },
            }),
          ],
          page: 1,
          pageSize: 25,
          total: 1,
          hasMore: false,
        },
      }),
    );

    expect(() => fixture.detectChanges()).not.toThrow();
    expect(fixture.nativeElement.textContent).toContain('short');
    expect(fixture.nativeElement.querySelectorAll('.bg-primary')).toHaveLength(
      0,
    );
  });

  it('emits NO HTML string anywhere — hostile excerpt text stays text (R1.7.5)', () => {
    // ⚠️ THE SECURITY PROPERTY. An excerpt containing markup must reach the DOM
    // as escaped text. If this page ever bound `[innerHTML]`, the script tag
    // below would be parsed as an element instead of appearing as characters.
    const fixture = create();
    search(fixture).flush(
      results({
        posts: {
          items: [
            postHit({
              bodyExcerpt: {
                text: 'try <img src=x onerror=alert(1)> and a bug',
                matches: [{ start: 38, length: 3 }],
              },
            }),
          ],
          page: 1,
          pageSize: 25,
          total: 1,
          hasMore: false,
        },
      }),
    );
    fixture.detectChanges();

    const root: HTMLElement = fixture.nativeElement;
    // The characters are visible…
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
    // …and no element was created from them.
    expect(root.querySelector('img')).toBeNull();
    expect(root.innerHTML).toContain('&lt;img');
  });

  it('groups results by kind (R1.7.1)', () => {
    const fixture = create();
    search(fixture).flush(
      results({
        topics: {
          items: [topicHit()],
          page: 1,
          pageSize: 25,
          total: 1,
          hasMore: false,
        },
        posts: {
          items: [postHit()],
          page: 1,
          pageSize: 25,
          total: 4,
          hasMore: false,
        },
      }),
    );
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('#search-topics').textContent,
    ).toContain('Threads (1)');
    expect(
      fixture.nativeElement.querySelector('#search-posts').textContent,
    ).toContain('Replies (4)');
    expect(
      fixture.nativeElement.querySelector('#search-lessons'),
    ).not.toBeNull();
  });

  it('renders the LESSONS group as an EmptyState in phase 2, not hidden', () => {
    // The server already returns the key. Hiding the group now would mean
    // adding it back later, which is a shape change; showing it empty is a
    // value change when Batch 10 lands.
    const fixture = create();
    search(fixture).flush(
      results({
        topics: {
          items: [topicHit()],
          page: 1,
          pageSize: 25,
          total: 1,
          hasMore: false,
        },
      }),
    );
    fixture.detectChanges();

    const lessons = fixture.nativeElement.querySelector('#search-lessons')
      .parentElement as HTMLElement;
    expect(lessons.querySelector('ptah-empty-state')).not.toBeNull();
    expect(lessons.textContent).toContain('No lessons to search yet.');
  });

  it('renders EmptyState on no results, never "0 results" (R1.7.3)', () => {
    const fixture = create();
    search(fixture, 'zzzz').flush(results());
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('ptah-empty-state'),
    ).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain(
      'Nothing matched “zzzz”.',
    );
    expect(fixture.nativeElement.textContent).not.toContain('0 results');
  });

  it('deep-links a topic hit by slug and a post hit by its TOPIC slug', () => {
    const fixture = create();
    search(fixture).flush(
      results({
        topics: {
          items: [topicHit({ slug: 'the-bug' })],
          page: 1,
          pageSize: 25,
          total: 1,
          hasMore: false,
        },
        posts: {
          items: [postHit({ topicSlug: 'another-thread' })],
          page: 1,
          pageSize: 25,
          total: 1,
          hasMore: false,
        },
      }),
    );
    fixture.detectChanges();

    const hrefs = Array.from<HTMLAnchorElement>(
      fixture.nativeElement.querySelectorAll('a[href]'),
    ).map((a) => a.getAttribute('href'));

    expect(hrefs).toContain('/members/community/topics/the-bug');
    expect(hrefs).toContain('/members/community/topics/another-thread');
  });

  it('a failed search shows an error, not an empty state', () => {
    // "Nothing matched" and "we could not search" are different facts.
    const fixture = create();
    search(fixture).flush(null, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[role="alert"]').textContent,
    ).toContain('We could not run that search.');
    expect(fixture.nativeElement.querySelector('ptah-empty-state')).toBeNull();
  });

  it('clears stale results when a later search fails', () => {
    // Leaving the previous hits on screen under a new query's error shows a
    // member results for something they did not ask for.
    const fixture = create();
    search(fixture, 'bug').flush(
      results({
        topics: {
          items: [topicHit()],
          page: 1,
          pageSize: 25,
          total: 1,
          hasMore: false,
        },
      }),
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('the parser');

    search(fixture, 'other').flush(null, {
      status: 500,
      statusText: 'Server Error',
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('the parser');
  });

  it('renders NO markdown block — an excerpt is displayed as-is', () => {
    // R1.7.5: highlighting must never be applied to markdown output, so this
    // page runs no second rendering pipeline at all.
    const fixture = create();
    search(fixture).flush(
      results({
        posts: {
          items: [
            postHit({
              bodyExcerpt: { text: 'a **bold** excerpt', matches: [] },
            }),
          ],
          page: 1,
          pageSize: 25,
          total: 1,
          hasMore: false,
        },
      }),
    );
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('ptah-markdown-block'),
    ).toBeNull();
    // The markdown syntax is shown literally, which is the documented behaviour.
    expect(fixture.nativeElement.textContent).toContain('a **bold** excerpt');
  });
});
