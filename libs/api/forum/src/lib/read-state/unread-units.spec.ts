import 'reflect-metadata';

import type { MemberContext } from '@ptah-api/membership';

import {
  asPrismaService,
  countQueries,
  createMockPrisma,
  type MockForumPrisma,
} from '../../testing/mock-forum-prisma';
import { CategoriesService } from '../categories/categories.service';
import { ReactionsService } from '../reactions/reactions.service';
import { ListTopicsQueryDto } from '../topics/dto/list-topics.query.dto';
import { TopicsReadService } from '../topics/topics-read.service';

import { ReadStateService, unreadCount } from './read-state.service';

/**
 * R1.6.2 / R1.6.3 — UNREAD IS A SUBTRACTION BETWEEN TWO DIFFERENT UNITS, AND
 * THIS FILE IS THE ONLY THING THAT CHECKS THE UNITS AGREE.
 *
 * ── THE DEFECT THIS FILE EXISTS FOR (TASK_2026_177 F-1) ─────────────────────
 * `Topic.postCount` is a count of REPLIES: post #1 is the topic body (AD-9) and
 * is excluded (AD-11). `TopicReadState.lastReadPostNumber` is a POST NUMBER,
 * and post numbers start at 1 — at the body. Subtracting one from the other is
 * a category error, and it under-reported every unread badge by exactly one on
 * every topic that had ever been opened. Measured live against the running
 * server before the fix:
 *
 *   TRUE UNREAD | server unreadCount | post_count | marker
 *        1      |         0          |     2      |   2
 *        2      |         1          |     3      |   2
 *        3      |         2          |     4      |   2
 *
 * With no marker at all the default `0` made the arithmetic ACCIDENTALLY
 * correct, which is why R1.6.3's "a never-opened topic reports its whole reply
 * count" passed and the defect shipped behind 436 green tests.
 *
 * ── WHY THE EXISTING SPECS COULD NOT SEE IT, AND WHAT CHANGED HERE ──────────
 * `read-state.service.spec.ts` asserted `unreadCount(10, 4) === 6` and
 * `topics-read.service.spec.ts` asserted "unread is postCount -
 * lastReadPostNumber". Both picked TWO INDEPENDENT INTEGERS and then restated
 * the implementation's arithmetic as the expected value. A test written that way
 * cannot detect a unit mismatch, because the units never appear in it: `10` and
 * `4` are just numbers, and any subtraction of them looks as right as any other.
 * The mock, likewise, returned whatever the service asked for — so the marker
 * the service read back was the marker the spec invented, never a marker some
 * OTHER part of the system had written.
 *
 * The shape here is different in three ways, and all three are the point:
 *
 *   1. THERE IS ONE SOURCE OF TRUTH PER CASE — a {@link Thread}, which is a list
 *      of real post numbers plus the marker. `postCount` and the expected answer
 *      are both DERIVED from it by {@link postCountOf} and {@link trueUnreadOf},
 *      so they cannot silently be in different units. The expected value is a
 *      COUNT OF POSTS, obtained by filtering the thread — never a subtraction.
 *
 *   2. THE DOMAIN FACT IS RESTATED INDEPENDENTLY. {@link BODY_POST_NUMBER} is
 *      declared here rather than imported from the code under test. Importing it
 *      would make the spec inherit the very assumption it is checking; a spec
 *      that derives its expectation from the implementation's constants can only
 *      ever confirm the implementation is self-consistent.
 *
 *   3. IT CHECKS ALL FOUR SITES THAT TOUCH THE TWO UNITS, and it checks them
 *      against the SAME threads. Under the old convention the four were
 *      consistent with one another and all wrong, so any test scoped to one site
 *      would have passed. In particular {@link ReadStateService.markCategoryRead}
 *      WRITES a marker computed from `postCount`, and a fix applied only to
 *      `unreadCount` would leave "mark all read" reporting 1 unread on every
 *      topic — a NEW visible defect created by the obvious one-line repair. The
 *      round-trip case below is what refuses that fix.
 */

const CTX: MemberContext = {
  userId: 'user-1',
  email: 'member@example.com',
  entitled: true,
  cohortKeys: [],
  isAdmin: false,
};

const NOW = new Date('2026-08-05T12:00:00.000Z');

/**
 * Post #1 is the topic BODY (AD-9), not a reply.
 *
 * ⚠️ DECLARED HERE, NOT IMPORTED. See point 2 of the file docblock — the whole
 * value of this spec is that its expectations do not come from the code it is
 * testing.
 */
const BODY_POST_NUMBER = 1;

/** A topic modelled as what it actually is: a list of posts, plus a marker. */
interface Thread {
  readonly id: string;
  /** Every post number in the topic, ascending. `[1]` is a topic with no replies. */
  readonly postNumbers: readonly number[];
  /** The highest post number this member has read. `0` = never opened (R1.6.3). */
  readonly marker: number;
}

/** A topic with `replyCount` replies, read up to `marker` (a POST NUMBER). */
function thread(id: string, replyCount: number, marker: number): Thread {
  return {
    id,
    postNumbers: Array.from(
      { length: replyCount + 1 },
      (_, i) => BODY_POST_NUMBER + i,
    ),
    marker,
  };
}

/** `Topic.postCount` as AD-11 defines it: replies only, body excluded. */
function postCountOf(t: Thread): number {
  return t.postNumbers.filter((n) => n > BODY_POST_NUMBER).length;
}

/**
 * The answer, COUNTED rather than computed: how many REPLIES sit above the
 * marker. This is the number a member would get by scrolling the thread.
 */
function trueUnreadOf(t: Thread): number {
  return t.postNumbers.filter((n) => n > BODY_POST_NUMBER && n > t.marker)
    .length;
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The boundary set the fix has to satisfy, each stated in the units a reader
 * can check by hand.
 */
const CASES: ReadonlyArray<{ label: string; thread: Thread }> = [
  {
    label: 'never opened (no read-state row at all) — R1.6.3',
    thread: thread('t-none', 4, 0),
  },
  {
    label: 'read the BODY only — post #1 is not a reply, so nothing is read',
    thread: thread('t-body', 4, 1),
  },
  { label: 'read one reply of four', thread: thread('t-one', 4, 2) },
  { label: 'read three replies of four', thread: thread('t-three', 4, 4) },
  {
    label: 'read the highest post number — fully caught up',
    thread: thread('t-all', 4, 5),
  },
  {
    label: 'marker ABOVE the highest post number — clamps at 0 (R1.6.2)',
    thread: thread('t-over', 4, 99),
  },
  {
    label: 'a topic with no replies is never unread',
    thread: thread('t-empty', 0, 0),
  },
  {
    label: 'one reply, one unread — the case that rendered NO badge at all',
    thread: thread('t-single', 1, 1),
  },
];

function feedQuery(
  overrides: Partial<ListTopicsQueryDto> = {},
): ListTopicsQueryDto {
  return Object.assign(new ListTopicsQueryDto(), overrides);
}

function topicRow(t: Thread) {
  return {
    id: t.id,
    slug: t.id,
    title: t.id,
    categoryId: 'cat-1',
    authorId: null,
    postCount: postCountOf(t),
    pinned: false,
    locked: false,
    acceptedPostId: null,
    lastPostedAt: NOW,
    createdAt: NOW,
  };
}

/** Read-state rows for the threads that have a marker; absent = never read. */
function readStateRows(threads: readonly Thread[]) {
  return threads
    .filter((t) => t.marker > 0)
    .map((t) => ({ topicId: t.id, lastReadPostNumber: t.marker }));
}

function buildRead(prisma: MockForumPrisma): TopicsReadService {
  const categories = new CategoriesService(asPrismaService(prisma));
  return new TopicsReadService(
    asPrismaService(prisma),
    new ReadStateService(asPrismaService(prisma), categories),
    new ReactionsService(asPrismaService(prisma)),
  );
}

/* -------------------------------------------------------------------------- */

describe('R1.6.2 / R1.6.3 — unread, in units', () => {
  let prisma: MockForumPrisma;

  beforeEach(() => {
    prisma = createMockPrisma();
    prisma.category.findMany.mockResolvedValue([
      { id: 'cat-1', name: 'General' },
    ]);
    prisma.user.findMany.mockResolvedValue([]);
  });

  /* ------------------------------------------------------------------------ */
  /* Site 1 — the pure function                                                */
  /* ------------------------------------------------------------------------ */

  describe('unreadCount() — the calculation itself', () => {
    it.each(CASES.map((c) => [c.label, c.thread] as const))(
      '%s',
      (_label, t) => {
        expect({
          postCount: postCountOf(t),
          marker: t.marker,
          unread: unreadCount(postCountOf(t), t.marker),
        }).toEqual({
          postCount: postCountOf(t),
          marker: t.marker,
          unread: trueUnreadOf(t),
        });
      },
    );

    it('is never negative, for any marker at all', () => {
      for (let marker = 0; marker <= 20; marker++) {
        expect(unreadCount(3, marker)).toBeGreaterThanOrEqual(0);
      }
    });

    it('the LIVE F-1 table now reads correctly', () => {
      // The exact rows measured against the running server before the fix, where
      // the right-hand column read 0, 1, 2 instead of 1, 2, 3.
      expect([unreadCount(2, 2), unreadCount(3, 2), unreadCount(4, 2)]).toEqual(
        [1, 2, 3],
      );
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Site 2 — the feed's unread column                                         */
  /* ------------------------------------------------------------------------ */

  describe('TopicsReadService.listFeed — the badge a member actually sees', () => {
    it('every row reports the replies above its marker', async () => {
      const threads = CASES.map((c) => c.thread);
      prisma.topic.findMany.mockResolvedValue(threads.map(topicRow));
      prisma.topic.count.mockResolvedValue(threads.length);
      prisma.topicReadState.findMany.mockResolvedValue(readStateRows(threads));

      const page = await buildRead(prisma).listFeed(CTX, feedQuery());

      expect(
        page.items.map((item) => ({
          id: item.id,
          unread: item.unreadCount,
        })),
      ).toEqual(threads.map((t) => ({ id: t.id, unread: trueUnreadOf(t) })));
    });

    it('a thread with exactly ONE unread reply reports 1, not 0', async () => {
      // The frontend-visible half of F-1: `UnreadPill` renders nothing at 0, so
      // this thread showed NO badge at all.
      const t = thread('t-single', 1, 1);
      prisma.topic.findMany.mockResolvedValue([topicRow(t)]);
      prisma.topic.count.mockResolvedValue(1);
      prisma.topicReadState.findMany.mockResolvedValue(readStateRows([t]));

      const page = await buildRead(prisma).listFeed(CTX, feedQuery());

      expect(page.items[0]?.unreadCount).toBe(1);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Site 3 — the `sort=unread` WHERE clause                                   */
  /* ------------------------------------------------------------------------ */

  describe('sort=unread — the FILTER must agree with the COUNT', () => {
    it('selects exactly the threads whose unread count is greater than 0', async () => {
      const threads = CASES.map((c) => c.thread);
      prisma.topicReadState.findMany.mockResolvedValue(readStateRows(threads));
      prisma.topic.findMany.mockResolvedValue([]);
      prisma.topic.count.mockResolvedValue(0);

      await buildRead(prisma).listFeed(CTX, feedQuery({ sort: 'unread' }));

      const where = prisma.topic.findMany.mock.calls[0]?.[0]?.where as {
        OR?: Array<{
          id?: string | { notIn: string[] };
          postCount: { gt: number };
        }>;
      };

      // Evaluate the built clause against each thread the way Postgres would,
      // and compare with the unread count the feed would print. A thread that
      // has unread replies but is filtered OUT is the defect: it disappears from
      // the "show me what's new" control while still carrying a badge elsewhere.
      const selected = threads.filter((t) =>
        (where.OR ?? []).some((branch) => {
          const idMatches =
            typeof branch.id === 'string'
              ? branch.id === t.id
              : branch.id === undefined || !branch.id.notIn.includes(t.id);
          return idMatches && postCountOf(t) > branch.postCount.gt;
        }),
      );

      expect(selected.map((t) => t.id).sort()).toEqual(
        threads
          .filter((t) => trueUnreadOf(t) > 0)
          .map((t) => t.id)
          .sort(),
      );
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Site 4 — the category rail's "topics with unread activity"                */
  /* ------------------------------------------------------------------------ */

  describe('CategoriesService.listForMember — unread TOPICS per category', () => {
    it('counts exactly the topics whose unread reply count is greater than 0', async () => {
      const threads = CASES.map((c) => c.thread);
      prisma.category.findMany.mockResolvedValue([
        {
          id: 'cat-1',
          slug: 'general',
          name: 'General',
          description: null,
          visibility: 'member',
          sortOrder: 100,
        },
      ]);
      prisma.topic.findMany.mockResolvedValue(
        threads.map((t) => ({
          id: t.id,
          categoryId: 'cat-1',
          postCount: postCountOf(t),
        })),
      );
      prisma.topicReadState.findMany.mockResolvedValue(readStateRows(threads));

      const list = await new CategoriesService(
        asPrismaService(prisma),
      ).listForMember(CTX);

      expect(list[0]?.unreadCount).toBe(
        threads.filter((t) => trueUnreadOf(t) > 0).length,
      );
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Site 5 — the marker WRITE path, which is where a naive fix breaks         */
  /* ------------------------------------------------------------------------ */

  describe('markCategoryRead — the round trip that refuses a one-line fix', () => {
    it('leaves EVERY topic at 0 unread (R1.6.5)', async () => {
      // ⚠️ THIS IS THE CASE A ONE-LINE `unreadCount` FIX FAILS. `markCategoryRead`
      // WRITES a marker derived from `postCount`, so the write and the read must
      // convert between the two units in opposite directions. Repairing only the
      // read leaves "mark all read" reporting 1 unread on every topic that has
      // replies — a new, more visible defect than the one being fixed.
      const threads = [
        thread('t1', 4, 0),
        thread('t2', 0, 0),
        thread('t3', 9, 3),
        thread('t4', 1, 0),
      ];
      prisma.category.findFirst.mockResolvedValue({
        id: 'cat-1',
        name: 'General',
      });
      prisma.topic.findMany.mockResolvedValue(
        threads.map((t) => ({ id: t.id, postCount: postCountOf(t) })),
      );
      prisma.topicReadState.deleteMany.mockResolvedValue({ count: 0 });
      prisma.topicReadState.createMany.mockResolvedValue({
        count: threads.length,
      });

      const service = new ReadStateService(
        asPrismaService(prisma),
        new CategoriesService(asPrismaService(prisma)),
      );
      await service.markCategoryRead(CTX, 'cat-1');

      const written = prisma.topicReadState.createMany.mock.calls[0]?.[0]
        ?.data as Array<{ topicId: string; lastReadPostNumber: number }>;

      // The written markers, fed straight back through the read path. Zipped by
      // looking each marker up by topic id rather than by index, so the case
      // still asserts something if `markCategoryRead` ever reorders its rows.
      const markerFor = new Map(
        written.map((row) => [row.topicId, row.lastReadPostNumber]),
      );

      expect(
        threads.map((t) => ({
          topicId: t.id,
          unread: unreadCount(postCountOf(t), markerFor.get(t.id) ?? 0),
        })),
      ).toEqual(threads.map((t) => ({ topicId: t.id, unread: 0 })));
    });

    it('the written marker is a POST NUMBER, above every reply in the topic', async () => {
      // Stated in the unit rather than as a magic number: whatever the encoding,
      // it must be a post number the member could genuinely have read.
      const t = thread('t1', 4, 0);
      prisma.category.findFirst.mockResolvedValue({
        id: 'cat-1',
        name: 'General',
      });
      prisma.topic.findMany.mockResolvedValue([
        { id: t.id, postCount: postCountOf(t) },
      ]);
      prisma.topicReadState.deleteMany.mockResolvedValue({ count: 0 });
      prisma.topicReadState.createMany.mockResolvedValue({ count: 1 });

      await new ReadStateService(
        asPrismaService(prisma),
        new CategoriesService(asPrismaService(prisma)),
      ).markCategoryRead(CTX, 'cat-1');

      const written = prisma.topicReadState.createMany.mock.calls[0]?.[0]
        ?.data as Array<{ lastReadPostNumber: number }>;

      expect(written[0]?.lastReadPostNumber).toBe(
        Math.max(...t.postNumbers.map((n) => n)),
      );
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Site 6 — markRead's echoed count                                          */
  /* ------------------------------------------------------------------------ */

  describe('markRead — the count it echoes back matches the feed', () => {
    it.each(
      CASES.filter((c) => c.thread.marker > 0).map(
        (c) => [c.label, c.thread] as const,
      ),
    )('%s', async (_label, t) => {
      prisma.topic.findFirst.mockResolvedValue({
        id: t.id,
        postCount: postCountOf(t),
      });
      prisma.topicReadState.upsert.mockResolvedValue({});
      prisma.topicReadState.updateMany.mockResolvedValue({ count: 1 });
      prisma.topicReadState.findUnique.mockResolvedValue({
        lastReadPostNumber: t.marker,
      });

      const result = await new ReadStateService(
        asPrismaService(prisma),
        new CategoriesService(asPrismaService(prisma)),
      ).markRead(CTX, t.id, t.marker);

      expect(result).toEqual({ unreadCount: trueUnreadOf(t) });
    });
  });

  /* ------------------------------------------------------------------------ */
  /* NFR-P4 — the unit conversion is arithmetic, not a query                    */
  /* ------------------------------------------------------------------------ */

  it('costs no extra database round trip (NFR-P4)', async () => {
    const threads = CASES.map((c) => c.thread);
    prisma.topic.findMany.mockResolvedValue(threads.map(topicRow));
    prisma.topic.count.mockResolvedValue(threads.length);
    prisma.topicReadState.findMany.mockResolvedValue(readStateRows(threads));

    await buildRead(prisma).listFeed(CTX, feedQuery());

    expect(countQueries(prisma)).toBeLessThanOrEqual(5);
  });
});
