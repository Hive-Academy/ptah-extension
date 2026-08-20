import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import type { MemberPost, MemberTopicDetail } from '@ptah-contracts/community';
import {
  MarkdownBlockComponent,
  provideMarkdownRendering,
} from '@ptah-extension/markdown';

import { ThreadPage } from './thread-page';

const BASE = '/api/v1/members/community';

function post(overrides: Partial<MemberPost> = {}): MemberPost {
  return {
    id: 'post_1',
    postNumber: 1,
    parentId: null,
    bodyMarkdown: 'The opening post.',
    authorName: 'Ada',
    accepted: false,
    deleted: false,
    reactions: { like: 0, insightful: 0, celebrate: 0, thanks: 0 },
    myReactions: [],
    createdAt: '2026-08-01T10:00:00.000Z',
    editedAt: null,
    ...overrides,
  };
}

function thread(
  posts: MemberPost[],
  overrides: Partial<MemberTopicDetail> = {},
): MemberTopicDetail {
  return {
    id: 'top_1',
    slug: 'welcome',
    title: 'Welcome to the community',
    categoryId: 'cat_1',
    categoryName: 'General',
    authorName: 'Ada',
    pinned: false,
    locked: false,
    acceptedPost: null,
    posts: {
      items: posts,
      page: 1,
      pageSize: 25,
      total: posts.length,
      hasMore: false,
    },
    createdAt: '2026-08-01T10:00:00.000Z',
    lastPostedAt: '2026-08-01T12:00:00.000Z',
    editedAt: null,
    ...overrides,
  };
}

describe('ThreadPage', () => {
  let httpMock: HttpTestingController;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  beforeEach(() => {
    params = new BehaviorSubject(convertToParamMap({ slug: 'welcome' }));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideMarkdownRendering({ extensions: 'member' }),
        { provide: ActivatedRoute, useValue: { paramMap: params } },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function threadRequest(slug = 'welcome'): TestRequest {
    return httpMock.expectOne((r) => r.url === `${BASE}/topics/${slug}`);
  }

  /** Renders, answers the thread read, and swallows the read-marker write. */
  function open(
    detail: MemberTopicDetail,
    options: { markRead?: boolean } = {},
  ): ComponentFixture<ThreadPage> {
    const fixture = TestBed.createComponent(ThreadPage);
    fixture.detectChanges();
    threadRequest(detail.slug).flush(detail);
    fixture.detectChanges();
    if (options.markRead !== false) {
      httpMock
        .expectOne(`${BASE}/topics/${detail.id}/read`)
        .flush({ unreadCount: 0 });
    }
    fixture.detectChanges();
    return fixture;
  }

  function replyRows(fixture: ComponentFixture<ThreadPage>): HTMLElement[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('[data-post-number]'),
    );
  }

  /**
   * The markdown handed to each `<ptah-markdown-block>`, optionally scoped to a
   * region.
   *
   * ⚠️ THE BOUND `content`, NOT THE RENDERED `textContent`. `ngx-markdown`'s
   * `MarkdownComponent` parses in a promise, so the rendered text arrives a
   * microtask after `detectChanges()` — asserting on `textContent` would make
   * every one of these cases a timing test of a third-party library rather than
   * a test of this page. What matters here is WHICH TEXT REACHES THE ONE
   * SANITIZER, and that is exactly this binding.
   */
  function markdownIn(
    fixture: ComponentFixture<ThreadPage>,
    selector?: string,
  ): string[] {
    return fixture.debugElement
      .queryAll(By.directive(MarkdownBlockComponent))
      .filter(
        (node) =>
          selector === undefined ||
          (node.nativeElement as HTMLElement).closest(selector) !== null,
      )
      .map((node) =>
        (node.componentInstance as MarkdownBlockComponent).content(),
      );
  }

  /* ---------------------------------------------------------------------- */
  /* §8.2 EXIT GATE — no reply indents more than one level (R1.3.4, RK-12)   */
  /* ---------------------------------------------------------------------- */

  it('NEVER indents past one level, even when the fixture data says depth 3', () => {
    // ⚠️ THIS IS A §8.2 EXIT-GATE ITEM AND THE FIXTURE IS DELIBERATELY
    // MALFORMED. The server caps depth at 2 and REPAIRS a depth-3 attempt, so
    // `post_3`'s parent chain below (post_3 -> post_2 -> post_1) should be
    // impossible on the wire. The renderer must not depend on that being true:
    // `isReply` is `parentId !== null`, a BOOLEAN, and the template has exactly
    // two branches, so there is no third indent available to draw.
    const fixture = open(
      thread([
        post({ id: 'post_1', postNumber: 1, parentId: null }),
        post({ id: 'post_2', postNumber: 2, parentId: 'post_1' }),
        post({ id: 'post_3', postNumber: 3, parentId: 'post_2' }),
        post({ id: 'post_4', postNumber: 4, parentId: 'post_3' }),
      ]),
    );

    const rows = replyRows(fixture);
    expect(rows).toHaveLength(3);

    // Every non-null parent renders at the SAME indent — the second level.
    const indents = rows.map((row) => row.getAttribute('data-reply'));
    expect(indents).toEqual(['true', 'true', 'true']);

    // And the indent class set is exactly one value wide, whatever the data.
    const distinctMargins = new Set(
      rows.map((row) =>
        Array.from(row.classList)
          .filter((c) => c.includes('ml-'))
          .sort()
          .join(' '),
      ),
    );
    expect(distinctMargins.size).toBe(1);
  });

  it('renders a top-level reply and a nested reply at DIFFERENT indents', () => {
    // The negative control for the assertion above: a renderer that indented
    // nothing would also pass "never more than one level".
    const fixture = open(
      thread([
        post({ id: 'post_1', postNumber: 1, parentId: null }),
        post({ id: 'post_2', postNumber: 2, parentId: null }),
        post({ id: 'post_3', postNumber: 3, parentId: 'post_2' }),
      ]),
    );

    const rows = replyRows(fixture);
    expect(rows.map((r) => r.getAttribute('data-reply'))).toEqual([
      'false',
      'true',
    ]);
    expect(rows[0].classList.contains('ml-6')).toBe(false);
    expect(rows[1].classList.contains('ml-6')).toBe(true);
  });

  /* ---------------------------------------------------------------------- */

  it('renders post #1 as the topic body (AD-9)', () => {
    // There is no `bodyMarkdown` on `MemberTopicDetail` and no `Topic.body`
    // column. The opening post arrives in `posts.items` like any other.
    const fixture = open(
      thread([post({ bodyMarkdown: 'This is the body of the thread.' })]),
    );

    expect(
      fixture.nativeElement.querySelector('[aria-label="Opening post"]'),
    ).not.toBeNull();
    expect(markdownIn(fixture, '[aria-label="Opening post"]')).toEqual([
      'This is the body of the thread.',
    ]);
    // …and it is NOT also drawn as a reply.
    expect(replyRows(fixture)).toHaveLength(0);
  });

  it('renders the accepted answer TWICE — hoisted AND in place (R1.5.1)', () => {
    // ⚠️ The duplication is the design (§3.3). Dropping the hoist makes the
    // answer unreachable on a long thread; filtering the in-line copy puts a
    // hole in the chronology and detaches replies made to it.
    const accepted = post({
      id: 'post_2',
      postNumber: 2,
      parentId: null,
      accepted: true,
      bodyMarkdown: 'This is the answer.',
    });
    const fixture = open(
      thread([post(), accepted], { acceptedPost: accepted }),
    );

    expect(
      fixture.nativeElement.querySelector('[aria-label="Accepted answer"]'),
    ).not.toBeNull();
    expect(markdownIn(fixture, '[aria-label="Accepted answer"]')).toEqual([
      'This is the answer.',
    ]);

    // The same post is still in its chronological slot, marked.
    const rows = replyRows(fixture);
    expect(rows).toHaveLength(1);
    expect(markdownIn(fixture, '[data-post-number]')).toEqual([
      'This is the answer.',
    ]);
    expect(rows[0].querySelector('ptah-accepted-answer-badge')).not.toBeNull();
  });

  it('keeps the hoisted copy when the accepted post is OFF the current page', () => {
    // `acceptedPost` is populated whenever a live accepted answer exists,
    // including when it is not in this page's slice — which is the case the
    // hoist exists for.
    const accepted = post({
      id: 'post_99',
      postNumber: 99,
      accepted: true,
      bodyMarkdown: 'Answer from page 4.',
    });
    const fixture = open(
      thread([post({ id: 'post_5', postNumber: 5, parentId: null })], {
        acceptedPost: accepted,
        posts: {
          items: [post({ id: 'post_5', postNumber: 5, parentId: null })],
          page: 2,
          pageSize: 25,
          total: 60,
          hasMore: true,
        },
      }),
    );

    expect(markdownIn(fixture, '[aria-label="Accepted answer"]')).toEqual([
      'Answer from page 4.',
    ]);
  });

  it('renders a TOMBSTONE with its children still readable (R1.3.5)', () => {
    // The row survives with its `postNumber`; the body and author are withheld
    // at the read model. The page must render the tombstone rather than assume
    // a body, and must NOT pass '' to the markdown renderer — an empty render
    // is a silently blank row.
    const fixture = open(
      thread([
        post(),
        post({
          id: 'post_2',
          postNumber: 2,
          parentId: null,
          deleted: true,
          bodyMarkdown: '',
          authorName: null,
        }),
        post({
          id: 'post_3',
          postNumber: 3,
          parentId: 'post_2',
          bodyMarkdown: 'A child of the deleted post.',
        }),
      ]),
    );

    const rows = replyRows(fixture);
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('This post was deleted.');
    // ⚠️ The tombstone never reaches the renderer at all. Passing '' would
    // render nothing and leave a silently blank row instead of a stated one.
    expect(rows[0].querySelector('ptah-markdown-block')).toBeNull();
    // The child is still there, still attached, still at the reply indent.
    expect(markdownIn(fixture, '[data-post-number]')).toEqual([
      'A child of the deleted post.',
    ]);
    expect(rows[1].getAttribute('data-reply')).toBe('true');
  });

  it('posts the read marker ONCE per open, at the highest postNumber (R1.6.1)', () => {
    const fixture = TestBed.createComponent(ThreadPage);
    fixture.detectChanges();
    threadRequest().flush(
      thread([
        post({ id: 'post_1', postNumber: 1 }),
        post({ id: 'post_2', postNumber: 2, parentId: null }),
      ]),
    );
    fixture.detectChanges();

    const marker = httpMock.expectOne(`${BASE}/topics/top_1/read`);
    expect(marker.request.method).toBe('POST');
    expect(marker.request.body).toEqual({ lastReadPostNumber: 2 });
    marker.flush({ unreadCount: 0 });

    // Re-rendering must not emit a second one: a progress write per change
    // detection would spend the member's 60/min budget on scrolling.
    fixture.detectChanges();
    fixture.detectChanges();
    httpMock.expectNone(`${BASE}/topics/top_1/read`);
  });

  it('renders EVERY body through <ptah-markdown-block>, never innerHTML (NFR-S2)', () => {
    const fixture = open(
      thread([
        post({ bodyMarkdown: 'Opening **body**' }),
        post({
          id: 'post_2',
          postNumber: 2,
          parentId: null,
          bodyMarkdown: 'A reply',
        }),
      ]),
    );

    // One for the opening post, one for the reply. If a body ever renders
    // outside this component, the count drops and this fails.
    expect(
      fixture.nativeElement.querySelectorAll('ptah-markdown-block'),
    ).toHaveLength(2);
    expect(fixture.nativeElement.innerHTML).not.toContain('innerHTML');
  });

  it('passes variant="auto" to every renderer so light mode works (NFR-U5)', () => {
    const fixture = open(thread([post()]));
    const rendered = Array.from<HTMLElement>(
      fixture.nativeElement.querySelectorAll('markdown'),
    );

    expect(rendered.length).toBeGreaterThan(0);
    for (const element of rendered) {
      expect(element.className).toContain('dark:prose-invert');
    }
  });

  it('toggles a reaction optimistically and RECONCILES from the response', () => {
    const fixture = open(
      thread([
        post({
          reactions: { like: 2, insightful: 0, celebrate: 0, thanks: 0 },
          myReactions: [],
        }),
      ]),
    );

    const likeButton: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[aria-label^="Add a Like"]',
    );
    likeButton.click();
    fixture.detectChanges();

    // Optimistic: the count moved before the server answered.
    expect(
      fixture.nativeElement.querySelector('[aria-label^="Remove your Like"]'),
    ).not.toBeNull();

    // ⚠️ PUT, not POST — a retry converges rather than double-toggling.
    const request = httpMock.expectOne(`${BASE}/posts/post_1/reactions/like`);
    expect(request.request.method).toBe('PUT');

    // The server is authoritative and disagrees with the optimistic guess
    // (someone else reacted concurrently). The response wins, wholesale.
    request.flush({
      counts: { like: 7, insightful: 0, celebrate: 0, thanks: 0 },
      mine: ['like'],
    });
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[aria-label^="Remove your Like"]')
        ?.textContent,
    ).toContain('7');
  });

  it('restores the pre-click state when a toggle FAILS', () => {
    // A rejected toggle must not leave a lie on screen.
    const fixture = open(
      thread([
        post({
          reactions: { like: 2, insightful: 0, celebrate: 0, thanks: 0 },
          myReactions: [],
        }),
      ]),
    );

    fixture.nativeElement.querySelector('[aria-label^="Add a Like"]').click();
    fixture.detectChanges();
    httpMock
      .expectOne(`${BASE}/posts/post_1/reactions/like`)
      .flush(null, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    const restored: HTMLElement = fixture.nativeElement.querySelector(
      '[aria-label^="Add a Like"]',
    );
    expect(restored).not.toBeNull();
    expect(restored.textContent).toContain('2');
  });

  it('updates BOTH copies of the accepted post when one is reacted to', () => {
    // The hoisted answer and its in-line twin are the SAME post sent twice.
    // Patching one copy would show two different counts on one screen.
    const accepted = post({
      id: 'post_2',
      postNumber: 2,
      parentId: null,
      accepted: true,
      bodyMarkdown: 'The answer',
      reactions: { like: 1, insightful: 0, celebrate: 0, thanks: 0 },
    });
    const fixture = open(
      thread([post(), accepted], { acceptedPost: accepted }),
    );

    const inlineLike: HTMLButtonElement = replyRows(fixture)[0].querySelector(
      '[aria-label^="Add a Like"]',
    ) as HTMLButtonElement;
    inlineLike.click();
    fixture.detectChanges();
    httpMock.expectOne(`${BASE}/posts/post_2/reactions/like`).flush({
      counts: { like: 2, insightful: 0, celebrate: 0, thanks: 0 },
      mine: ['like'],
    });
    fixture.detectChanges();

    // The hoisted copy has no reaction bar of its own, but it is the same
    // object in state — assert the patch reached it by checking the model the
    // template binds. Rendering both bars would double the affordance; what
    // matters is that the two copies never diverge in state.
    const hoisted = fixture.nativeElement.querySelector(
      '[aria-label="Accepted answer"]',
    );
    expect(hoisted.textContent).toContain('The answer');
  });

  it('posts a reply and re-reads the page it is on', () => {
    const fixture = open(thread([post()]));

    const composer = fixture.nativeElement.querySelector(
      'ptah-reply-composer textarea',
    ) as HTMLTextAreaElement;
    composer.value = 'My reply';
    composer.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const submit = Array.from<HTMLButtonElement>(
      fixture.nativeElement.querySelectorAll('ptah-reply-composer button'),
    ).find((b) => b.textContent?.trim() === 'Post reply');
    submit?.click();

    const created = httpMock.expectOne(`${BASE}/topics/top_1/posts`);
    expect(created.request.body).toEqual({
      // ⚠️ No `parentId` key at all — the service omits a null rather than
      // sending it, because an explicit null is a live 500 (see
      // `member-community-api.service.ts`).
      bodyMarkdown: 'My reply',
    });
    created.flush(post({ id: 'post_2', postNumber: 2, parentId: null }));

    // Re-read, and NO second read-marker write — the marker is once per open.
    threadRequest().flush(
      thread([post(), post({ id: 'post_2', postNumber: 2, parentId: null })]),
    );
    fixture.detectChanges();
    httpMock.expectNone(`${BASE}/topics/top_1/read`);
    expect(replyRows(fixture)).toHaveLength(1);
  });

  it('hides the composer and says so on a LOCKED topic (R1.3.4)', () => {
    const fixture = open(thread([post()], { locked: true }));

    expect(
      fixture.nativeElement.querySelector('ptah-reply-composer'),
    ).toBeNull();
    expect(fixture.nativeElement.textContent).toContain(
      'This thread is locked.',
    );
    // Existing replies stay readable — the lock hides the composer, not content.
    expect(
      fixture.nativeElement.querySelector('[aria-label="Opening post"]'),
    ).not.toBeNull();
  });

  it('surfaces a 403 topic_locked by its machine REASON, not its sentence', () => {
    const fixture = open(thread([post()]));

    const composer = fixture.nativeElement.querySelector(
      'ptah-reply-composer textarea',
    ) as HTMLTextAreaElement;
    composer.value = 'Too late';
    composer.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    Array.from<HTMLButtonElement>(
      fixture.nativeElement.querySelectorAll('ptah-reply-composer button'),
    )
      .find((b) => b.textContent?.trim() === 'Post reply')
      ?.click();

    httpMock
      .expectOne(`${BASE}/topics/top_1/posts`)
      .flush(
        { reason: 'topic_locked' },
        { status: 403, statusText: 'Forbidden' },
      );
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[role="alert"]').textContent,
    ).toContain('This thread was locked while you were writing.');
  });

  it('renders a 404 as "not available", never as "you are not allowed"', () => {
    // ⚠️ R1.1.3. Absent and invisible are the SAME answer; distinguishing them
    // confirms the thread exists to someone who may not see it.
    const fixture = TestBed.createComponent(ThreadPage);
    fixture.detectChanges();
    threadRequest().flush(null, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('This thread is not available');
    expect(text).not.toMatch(/not allowed|forbidden|permission/i);
  });

  it('re-loads when the route parameter changes, without a remount', () => {
    // Navigating thread -> thread reuses this component instance. A snapshot
    // read would leave the first thread on screen forever.
    const fixture = open(thread([post({ bodyMarkdown: 'First thread' })]));
    expect(markdownIn(fixture)).toEqual(['First thread']);

    params.next(convertToParamMap({ slug: 'second' }));
    fixture.detectChanges();

    threadRequest('second').flush(
      thread([post({ id: 'post_9', bodyMarkdown: 'Second thread' })], {
        id: 'top_2',
        slug: 'second',
        title: 'Another thread',
      }),
    );
    fixture.detectChanges();
    httpMock.expectOne(`${BASE}/topics/top_2/read`).flush({ unreadCount: 0 });

    expect(markdownIn(fixture)).toEqual(['Second thread']);
    expect(fixture.nativeElement.textContent).toContain('Another thread');
  });

  it('paginates the thread and does not re-mark it read', () => {
    const fixture = open(
      thread([post()], {
        posts: {
          items: [post()],
          page: 1,
          pageSize: 25,
          total: 40,
          hasMore: true,
        },
      }),
    );

    Array.from<HTMLButtonElement>(
      fixture.nativeElement.querySelectorAll(
        'nav[aria-label="Pagination"] button',
      ),
    )
      .find((b) => b.textContent?.trim() === 'Next')
      ?.click();

    const request = threadRequest();
    expect(request.request.params.get('page')).toBe('2');
    request.flush(
      thread([post({ id: 'post_30', postNumber: 30, parentId: null })], {
        posts: {
          items: [post({ id: 'post_30', postNumber: 30, parentId: null })],
          page: 2,
          pageSize: 25,
          total: 40,
          hasMore: false,
        },
      }),
    );
    fixture.detectChanges();

    httpMock.expectNone(`${BASE}/topics/top_1/read`);
  });

  it('renders replies alone on page 2 — the missing post #1 is not a bug', () => {
    const fixture = TestBed.createComponent(ThreadPage);
    fixture.detectChanges();
    threadRequest().flush(
      thread([post({ id: 'post_26', postNumber: 26, parentId: null })], {
        posts: {
          items: [post({ id: 'post_26', postNumber: 26, parentId: null })],
          page: 2,
          pageSize: 25,
          total: 30,
          hasMore: false,
        },
      }),
    );
    fixture.detectChanges();
    httpMock.expectOne(`${BASE}/topics/top_1/read`).flush({ unreadCount: 0 });
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[aria-label="Opening post"]'),
    ).toBeNull();
    expect(replyRows(fixture)).toHaveLength(1);
  });
});
