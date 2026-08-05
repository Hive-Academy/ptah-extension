import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import type {
  MemberCategory,
  MemberPost,
  MemberTopicDetail,
  MemberTopicSummary,
} from '@ptah-contracts/community';
import { isMembershipRequiredError } from '@ptah-web/core';

import { MemberCommunityApiService } from './member-community-api.service';

const BASE = '/api/v1/members/community';

function category(overrides: Partial<MemberCategory> = {}): MemberCategory {
  return {
    id: 'cat_1',
    slug: 'announcements',
    name: 'Announcements',
    description: null,
    visibility: 'member',
    sortOrder: 0,
    topicCount: 3,
    unreadCount: 1,
    ...overrides,
  };
}

function topicSummary(
  overrides: Partial<MemberTopicSummary> = {},
): MemberTopicSummary {
  return {
    id: 'top_1',
    slug: 'welcome',
    title: 'Welcome',
    categoryId: 'cat_1',
    categoryName: 'Announcements',
    authorName: 'Ada',
    replyCount: 2,
    unreadCount: 0,
    pinned: true,
    locked: false,
    hasAcceptedAnswer: false,
    lastPostedAt: '2026-08-05T10:00:00.000Z',
    createdAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

function post(overrides: Partial<MemberPost> = {}): MemberPost {
  return {
    id: 'post_1',
    postNumber: 1,
    parentId: null,
    bodyMarkdown: 'Hello **there**',
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

function topicDetail(
  overrides: Partial<MemberTopicDetail> = {},
): MemberTopicDetail {
  return {
    id: 'top_1',
    slug: 'welcome',
    title: 'Welcome',
    categoryId: 'cat_1',
    categoryName: 'Announcements',
    authorName: 'Ada',
    pinned: false,
    locked: false,
    acceptedPost: null,
    posts: {
      items: [post()],
      page: 1,
      pageSize: 25,
      total: 1,
      hasMore: false,
    },
    createdAt: '2026-08-01T10:00:00.000Z',
    lastPostedAt: '2026-08-01T10:00:00.000Z',
    editedAt: null,
    ...overrides,
  };
}

describe('MemberCommunityApiService', () => {
  let httpMock: HttpTestingController;
  let api: MemberCommunityApiService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    api = TestBed.inject(MemberCommunityApiService);
  });

  afterEach(() => httpMock.verify());

  describe('categories', () => {
    it('GETs the category list and returns the parsed array', async () => {
      const pending = firstValueFrom(api.listCategories());
      const request = httpMock.expectOne(`${BASE}/categories`);

      expect(request.request.method).toBe('GET');
      request.flush([category()]);

      await expect(pending).resolves.toEqual([category()]);
    });

    it('THROWS on a category missing a required field', async () => {
      // Anti-decoration: without this, `validate()` could be a no-op and every
      // "returns the parsed body" case above would still pass.
      const pending = firstValueFrom(api.listCategories());
      httpMock
        .expectOne(`${BASE}/categories`)
        .flush([{ id: 'cat_1', slug: 'announcements' }]);

      await expect(pending).rejects.toThrow(
        /GET \/members\/community\/categories/,
      );
    });

    it('strips a field the client schema does not declare, rather than failing', async () => {
      // `z.object()` STRIPS unknown keys. That asymmetry is what lets the
      // server ship a new field before the client knows about it. It does NOT
      // work the other way, which is why a required field is never added to a
      // client schema before the server sends it.
      const pending = firstValueFrom(api.listCategories());
      httpMock
        .expectOne(`${BASE}/categories`)
        .flush([{ ...category(), somethingNewTheServerAdded: true }]);

      await expect(pending).resolves.toEqual([category()]);
    });
  });

  describe('topics — read', () => {
    it('GETs the feed with categoryId, sort and pagination', async () => {
      const pending = firstValueFrom(
        api.listTopics({
          categoryId: 'cat_1',
          sort: 'unread',
          page: 2,
          pageSize: 10,
        }),
      );
      const request = httpMock.expectOne(
        (r) => r.url === `${BASE}/topics` && r.params.get('sort') === 'unread',
      );

      expect(request.request.params.get('categoryId')).toBe('cat_1');
      expect(request.request.params.get('page')).toBe('2');
      expect(request.request.params.get('pageSize')).toBe('10');

      request.flush({
        items: [topicSummary()],
        page: 2,
        pageSize: 10,
        total: 1,
        hasMore: false,
      });

      await expect(pending).resolves.toEqual({
        items: [topicSummary()],
        page: 2,
        pageSize: 10,
        total: 1,
        hasMore: false,
      });
    });

    it('sends ?mine=true for the "My Threads" filter (R9.2)', () => {
      firstValueFrom(api.listTopics({ mine: true }));
      const request = httpMock.expectOne(
        (r) => r.url === `${BASE}/topics` && r.params.get('mine') === 'true',
      );

      // ⚠️ THE SPELLING IS EXACT. `forbidNonWhitelisted: true` is on, so an
      // invented parameter is a 400 rather than an ignored one, and the DTO's
      // transform accepts only `true` / `'true'` / `'1'`.
      expect(request.request.params.keys()).toEqual(['mine']);
      request.flush({
        items: [],
        page: 1,
        pageSize: 25,
        total: 0,
        hasMore: false,
      });
    });

    it('OMITS `mine` when it is false — it is not sent as mine=false', () => {
      // The server accepts only the affirmative spellings BECAUSE Express hands
      // query values over as strings and `'false'` is a truthy string. So
      // `?mine=false` already resolves to `false` and is identical to omitting
      // it (measured live: both return the same unfiltered total). Sending it
      // would decorate every ordinary feed request with a parameter that reads
      // like a toggle someone could flip and expect the opposite of.
      firstValueFrom(api.listTopics({ mine: false, categoryId: 'cat_1' }));
      const request = httpMock.expectOne((r) => r.url === `${BASE}/topics`);

      expect(request.request.params.has('mine')).toBe(false);
      expect(request.request.params.get('categoryId')).toBe('cat_1');
      request.flush({
        items: [],
        page: 1,
        pageSize: 25,
        total: 0,
        hasMore: false,
      });
    });

    it('composes `mine` with categoryId, sort and paging on ONE request', () => {
      // It is a `where` clause, not a route: there is no
      // `GET .../community/my-threads` (that path is a 404), so every filter
      // stacks on the same endpoint and the feed's five-query budget is unmoved.
      firstValueFrom(
        api.listTopics({
          mine: true,
          categoryId: 'cat_1',
          sort: 'unread',
          page: 2,
        }),
      );
      const request = httpMock.expectOne((r) => r.url === `${BASE}/topics`);

      expect(request.request.params.get('mine')).toBe('true');
      expect(request.request.params.get('categoryId')).toBe('cat_1');
      expect(request.request.params.get('sort')).toBe('unread');
      expect(request.request.params.get('page')).toBe('2');
      request.flush({
        items: [],
        page: 2,
        pageSize: 25,
        total: 0,
        hasMore: false,
      });
    });

    it('sends NO author identity of any kind — the server knows who is asking', () => {
      // `ListTopicsQueryDto` declares no `authorId` / `userId` / `authorEmail`,
      // and `forbidNonWhitelisted` makes one a 400. That is an AUTHORISATION
      // property, not an ergonomic one: a named-author parameter would let any
      // entitled member enumerate any other member's threads, and no downstream
      // visibility filter would refuse it. Asserting the absence here is what
      // stops a future "convenience" from being added to the query interface.
      firstValueFrom(api.listTopics({ mine: true, page: 3 }));
      const request = httpMock.expectOne((r) => r.url === `${BASE}/topics`);

      expect(request.request.params.keys().sort()).toEqual(['mine', 'page']);
      request.flush({
        items: [],
        page: 3,
        pageSize: 25,
        total: 0,
        hasMore: false,
      });
    });

    it('sends NO pagination params when the caller omits them', async () => {
      // The server's defaults (page 1, pageSize 25) are then the effective ones
      // and are echoed back in the envelope, so the client never hard-codes 25.
      firstValueFrom(api.listTopics());
      const request = httpMock.expectOne(`${BASE}/topics`);

      expect(request.request.params.keys()).toEqual([]);
      request.flush({
        items: [],
        page: 1,
        pageSize: 25,
        total: 0,
        hasMore: false,
      });
    });

    it('REFUSES to express a pageSize above the NFR-P5 cap', () => {
      // The server rejects >50 with a 400 rather than clamping. Throwing here
      // surfaces the client bug one frame from its cause; a clamp would make a
      // caller that asked for 500 rows believe it got them all.
      expect(() => api.listTopics({ pageSize: 51 })).toThrow(RangeError);
      expect(() => api.listTopics({ pageSize: 51 })).toThrow(/NFR-P5/);
      expect(() => api.listTopics({ page: 0 })).toThrow(RangeError);
    });

    it('accepts exactly the cap — the boundary is inclusive', () => {
      firstValueFrom(api.listTopics({ pageSize: 50 }));
      const request = httpMock.expectOne(
        (r) => r.url === `${BASE}/topics` && r.params.get('pageSize') === '50',
      );
      request.flush({
        items: [],
        page: 1,
        pageSize: 50,
        total: 0,
        hasMore: false,
      });
    });

    it('GETs one thread by SLUG (R1.2.2 — a title edit never changes it)', async () => {
      const pending = firstValueFrom(api.getTopic('welcome', 2));
      const request = httpMock.expectOne(
        (r) => r.url === `${BASE}/topics/welcome`,
      );

      expect(request.request.method).toBe('GET');
      expect(request.request.params.get('page')).toBe('2');
      request.flush(topicDetail());

      await expect(pending).resolves.toEqual(topicDetail());
    });

    it('parses a thread whose accepted answer is BOTH hoisted and in-line', async () => {
      // The duplication is the design (§3.3, R1.5.1) and the schema must accept
      // it. A client that "fixed" it by filtering would put a hole in the
      // chronology and detach the replies made to that post.
      const accepted = post({ id: 'post_2', postNumber: 2, accepted: true });
      const detail = topicDetail({
        acceptedPost: accepted,
        posts: {
          items: [post(), accepted],
          page: 1,
          pageSize: 25,
          total: 2,
          hasMore: false,
        },
      });

      const pending = firstValueFrom(api.getTopic('welcome'));
      httpMock.expectOne(`${BASE}/topics/welcome`).flush(detail);

      const result = await pending;
      expect(result.acceptedPost?.id).toBe('post_2');
      expect(result.posts.items.map((p) => p.id)).toEqual(['post_1', 'post_2']);
    });

    it('parses a TOMBSTONE — empty body, null author, still in the list', async () => {
      const tombstone = post({
        id: 'post_2',
        postNumber: 2,
        deleted: true,
        bodyMarkdown: '',
        authorName: null,
      });
      const pending = firstValueFrom(api.getTopic('welcome'));
      httpMock.expectOne(`${BASE}/topics/welcome`).flush(
        topicDetail({
          posts: {
            items: [post(), tombstone],
            page: 1,
            pageSize: 25,
            total: 2,
            hasMore: false,
          },
        }),
      );

      const result = await pending;
      expect(result.posts.items[1]).toEqual(tombstone);
    });

    it('THROWS on a thread missing a required field', async () => {
      const pending = firstValueFrom(api.getTopic('welcome'));
      httpMock
        .expectOne(`${BASE}/topics/welcome`)
        .flush({ id: 'top_1', slug: 'welcome' });

      await expect(pending).rejects.toThrow(
        /GET \/members\/community\/topics\/welcome/,
      );
    });
  });

  describe('topics — write', () => {
    it('POSTs a new topic and parses the composed detail back', async () => {
      const body = {
        categoryId: 'cat_1',
        title: 'A new thread',
        bodyMarkdown: 'Body',
      };
      const pending = firstValueFrom(api.createTopic(body));
      const request = httpMock.expectOne(`${BASE}/topics`);

      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual(body);
      request.flush(topicDetail({ title: 'A new thread' }));

      await expect(pending).resolves.toMatchObject({ title: 'A new thread' });
    });

    it('DELETEs a topic and parses the ack', async () => {
      const pending = firstValueFrom(api.deleteTopic('top_1'));
      const request = httpMock.expectOne(`${BASE}/topics/top_1`);

      expect(request.request.method).toBe('DELETE');
      request.flush({ deleted: true });

      await expect(pending).resolves.toEqual({ deleted: true });
    });
  });

  describe('posts', () => {
    it('POSTs a reply with its parentId', async () => {
      const pending = firstValueFrom(
        api.createPost('top_1', {
          bodyMarkdown: 'A reply',
          parentId: 'post_1',
        }),
      );
      const request = httpMock.expectOne(`${BASE}/topics/top_1/posts`);

      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({
        bodyMarkdown: 'A reply',
        parentId: 'post_1',
      });
      request.flush(post({ id: 'post_2', postNumber: 2, parentId: 'post_1' }));

      await expect(pending).resolves.toMatchObject({ parentId: 'post_1' });
    });

    it('OMITS parentId rather than sending null — an explicit null 500s (live)', async () => {
      // ⚠️ Verified against the running server on 2026-08-05:
      //   { bodyMarkdown, parentId: null } → 500 Internal server error
      //   { bodyMarkdown }                 → 201
      // `CreatePostDto.parentId` is `@IsOptional()`, and class-validator's
      // `@IsOptional()` skips BOTH `undefined` and `null`, so an explicit null
      // passes the DTO and then fails below it. Omitting the key is also simply
      // the right way to say "no parent" in JSON.
      const pending = firstValueFrom(
        api.createPost('top_1', { bodyMarkdown: 'A reply', parentId: null }),
      );
      const request = httpMock.expectOne(`${BASE}/topics/top_1/posts`);

      expect(request.request.body).toEqual({ bodyMarkdown: 'A reply' });
      expect('parentId' in (request.request.body as object)).toBe(false);
      request.flush(post({ id: 'post_2', postNumber: 2 }));
      await pending;
    });

    it('omits parentId when the caller leaves it undefined too', async () => {
      const pending = firstValueFrom(
        api.createPost('top_1', { bodyMarkdown: 'A reply' }),
      );
      const request = httpMock.expectOne(`${BASE}/topics/top_1/posts`);

      expect(request.request.body).toEqual({ bodyMarkdown: 'A reply' });
      request.flush(post({ id: 'post_2', postNumber: 2 }));
      await pending;
    });

    it('reports the parent the SERVER assigned, not the one requested', async () => {
      // RK-12 / R1.3.3: a depth-3 attempt is REPAIRED to depth 2 rather than
      // rejected, and the response says where the reply actually landed. A
      // client that echoed its own request would draw the wrong tree.
      const pending = firstValueFrom(
        api.createPost('top_1', {
          bodyMarkdown: 'Third level',
          parentId: 'post_2',
        }),
      );
      httpMock
        .expectOne(`${BASE}/topics/top_1/posts`)
        .flush(post({ id: 'post_3', postNumber: 3, parentId: 'post_1' }));

      await expect(pending).resolves.toMatchObject({ parentId: 'post_1' });
    });
  });

  describe('reactions', () => {
    it('uses PUT, not POST, so a retry converges (§3.3)', async () => {
      const pending = firstValueFrom(
        api.toggleReaction('post_1', 'insightful'),
      );
      const request = httpMock.expectOne(
        `${BASE}/posts/post_1/reactions/insightful`,
      );

      expect(request.request.method).toBe('PUT');
      request.flush({
        counts: { like: 0, insightful: 1, celebrate: 0, thanks: 0 },
        mine: ['insightful'],
      });

      await expect(pending).resolves.toEqual({
        counts: { like: 0, insightful: 1, celebrate: 0, thanks: 0 },
        mine: ['insightful'],
      });
    });

    it('THROWS on a sparse counts map', async () => {
      // `ReactionCounts` is TOTAL, never partial — that totality is what lets a
      // renderer read `counts.thanks` without `?? 0`. A server that started
      // sending a sparse map must fail here, not render `undefined`.
      const pending = firstValueFrom(api.toggleReaction('post_1', 'like'));
      httpMock
        .expectOne(`${BASE}/posts/post_1/reactions/like`)
        .flush({ counts: { like: 1 }, mine: ['like'] });

      await expect(pending).rejects.toThrow(/reactions\/like/);
    });
  });

  describe('read state', () => {
    it('POSTs the read marker (R1.6.1)', async () => {
      const pending = firstValueFrom(api.markRead('top_1', 7));
      const request = httpMock.expectOne(`${BASE}/topics/top_1/read`);

      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ lastReadPostNumber: 7 });
      request.flush({ unreadCount: 0 });

      await expect(pending).resolves.toEqual({ unreadCount: 0 });
    });
  });

  describe('the membership gate', () => {
    it('is recognised by the SHARED helper, not by a second parser', async () => {
      // `isMembershipRequiredError` already exists in `@ptah-web/core` and
      // parses `403 { reason: 'membership_required' }`. This service invents
      // neither a second error shape nor a second parser.
      const pending = firstValueFrom(api.listCategories()).catch(
        (error: unknown) => error,
      );
      httpMock
        .expectOne(`${BASE}/categories`)
        .flush(
          { reason: 'membership_required' },
          { status: 403, statusText: 'Forbidden' },
        );

      const error = await pending;
      expect(error).toBeInstanceOf(HttpErrorResponse);
      expect(isMembershipRequiredError(error)).toBe(true);
    });

    it('does NOT mistake a locked-topic 403 for the membership gate', async () => {
      // Both are 403. `topic_locked` is a stable machine value a UI matches on;
      // conflating the two would bounce a member to /pricing for replying to a
      // closed thread.
      const pending = firstValueFrom(
        api.createPost('top_1', { bodyMarkdown: 'nope' }),
      ).catch((error: unknown) => error);
      httpMock
        .expectOne(`${BASE}/topics/top_1/posts`)
        .flush(
          { reason: 'topic_locked' },
          { status: 403, statusText: 'Forbidden' },
        );

      expect(isMembershipRequiredError(await pending)).toBe(false);
    });
  });
});
