import 'reflect-metadata';

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  asPrismaService,
  createMockPrisma,
  type MockForumPrisma,
} from '../../testing/mock-forum-prisma';

import { AdminTopicsReadService } from './admin-topics-read.service';
import {
  ListAdminTopicsQueryDto,
  resolveAdminTopicQuery,
} from './dto/list-admin-topics.query.dto';

/**
 * `AdminTopicsReadService` — the moderation list, and the ONLY place in this lib
 * that may return a soft-deleted row (AD-5, `EXPECTED_EXEMPTIONS`).
 *
 * ⚠️ THE TWO ASSERTIONS THAT MATTER MOST HERE ARE ABOUT THE `where`.
 * `?includeDeleted=false` must genuinely filter, and `?includeDeleted=true` must
 * genuinely not. The structural census proves an exemption was DECLARED; only a
 * behavioural test proves the declared exemption does what its reason says.
 */

function topicRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 't-1',
    slug: 'a-topic',
    title: 'A topic',
    categoryId: 'c-1',
    authorId: 'u-1',
    pinned: false,
    locked: false,
    postCount: 3,
    acceptedPostId: null,
    deletedAt: null,
    deletedBy: null,
    lastPostedAt: new Date('2026-02-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-02-01T00:00:00.000Z'),
    editedAt: null,
    ...overrides,
  };
}

function harness(): {
  service: AdminTopicsReadService;
  prisma: MockForumPrisma;
} {
  const prisma = createMockPrisma();
  prisma.topic.findMany.mockResolvedValue([]);
  prisma.topic.count.mockResolvedValue(0);
  prisma.category.findMany.mockResolvedValue([]);
  prisma.user.findMany.mockResolvedValue([]);

  return {
    service: new AdminTopicsReadService(asPrismaService(prisma)),
    prisma,
  };
}

/** The `where` the page query was actually issued with. */
function pageWhere(prisma: MockForumPrisma): Record<string, unknown> {
  return prisma.topic.findMany.mock.calls[0][0].where as Record<
    string,
    unknown
  >;
}

describe('AdminTopicsReadService', () => {
  describe('AD-5 — the tombstone switch', () => {
    it('FILTERS soft-deleted topics by default', async () => {
      const { service, prisma } = harness();

      await service.list({});

      // The safe direction is the default. A moderator who did not ask for
      // tombstones must not be shown deleted content.
      expect(pageWhere(prisma)).toMatchObject({ deletedAt: null });
    });

    it('omits the filter entirely when includeDeleted is true', async () => {
      const { service, prisma } = harness();

      await service.list({ includeDeleted: true });

      expect(pageWhere(prisma)).not.toHaveProperty('deletedAt');
    });

    it('computes total under the IDENTICAL where', async () => {
      const { service, prisma } = harness();

      await service.list({ includeDeleted: true, categoryId: 'c-9' });

      // If the count used a different `where`, a moderator paging tombstones
      // would be told a total that excludes them — which is exactly the failure
      // that makes the second AD-5 exemption necessary rather than avoidable.
      expect(prisma.topic.count.mock.calls[0][0].where).toEqual(
        pageWhere(prisma),
      );
    });

    it('carries the exemption markers on BOTH tombstone-capable queries', () => {
      // The census in `soft-delete-filter.spec.ts` asserts the exemption KEYS;
      // this asserts that the two markers live in this file and that there are
      // exactly two of them, so a third unfiltered read cannot be added here
      // without the census diffing.
      const source = readFileSync(
        join(__dirname, 'admin-topics-read.service.ts'),
        'utf8',
      );
      const markers = source.match(/^\s*\/\/ AD-5-EXEMPT: .+$/gm) ?? [];

      expect(markers).toHaveLength(2);
      for (const marker of markers) {
        // A bare marker with no reason is an unfiltered read with a comment on
        // it; `RULE-REASON` rejects it, and so does this.
        expect(marker.length).toBeGreaterThan(60);
      }
    });

    it('is the ONLY *.service.ts in the lib carrying a marker', () => {
      // The isolation this file exists for: if a member-facing service ever
      // takes an exemption, it lands on a NEW census key rather than an
      // already-approved one.
      const libRoot = join(__dirname, '..');
      const marked = collectServices(libRoot).filter((file) =>
        /^\s*\/\/ AD-5-EXEMPT:/m.test(readFileSync(file, 'utf8')),
      );

      expect(marked.map((f) => f.split(/[\\/]/).pop())).toEqual([
        'admin-topics-read.service.ts',
      ]);
    });
  });

  describe('the filters', () => {
    it('applies categoryId and a case-insensitive title search', async () => {
      const { service, prisma } = harness();

      await service.list({ categoryId: 'c-1', search: 'ptah' });

      expect(pageWhere(prisma)).toMatchObject({
        categoryId: 'c-1',
        title: { contains: 'ptah', mode: 'insensitive' },
      });
    });

    it('searches TITLES, never bodies', async () => {
      const { service, prisma } = harness();

      await service.list({ search: 'ptah' });

      // A `contains` over `body_markdown` here would be a sequential scan of
      // every post in the forum on an admin keystroke. Body search is
      // `/v1/members/search`, which is trigram-indexed.
      expect(JSON.stringify(pageWhere(prisma))).not.toContain('bodyMarkdown');
    });

    it('drops a whitespace-only search rather than matching everything', async () => {
      const { service, prisma } = harness();

      await service.list({ search: '   ' });

      expect(pageWhere(prisma)).not.toHaveProperty('title');
    });
  });

  describe('the projection', () => {
    it('maps a tombstone with its deletedAt and deletedBy intact', async () => {
      const { service, prisma } = harness();
      prisma.topic.findMany.mockResolvedValue([
        topicRow({
          deletedAt: new Date('2026-03-01T00:00:00.000Z'),
          deletedBy: 'admin-user-1',
          acceptedPostId: 'p-9',
        }),
      ]);
      prisma.topic.count.mockResolvedValue(1);
      prisma.category.findMany.mockResolvedValue([
        { id: 'c-1', name: 'General' },
      ]);
      prisma.user.findMany.mockResolvedValue([
        {
          id: 'u-1',
          firstName: 'Ada',
          lastName: 'L',
          email: 'ada@example.com',
        },
      ]);

      const page = await service.list({ includeDeleted: true });

      expect(page.items[0]).toMatchObject({
        deletedAt: '2026-03-01T00:00:00.000Z',
        deletedBy: 'admin-user-1',
        categoryName: 'General',
        authorName: 'Ada L',
        // NFR-S4's counterpart: the ADMIN contract declares `authorEmail`, and
        // this is the surface it belongs to. The member read model's `select`
        // omits `email` entirely so it cannot leak by a spread.
        authorEmail: 'ada@example.com',
        replyCount: 3,
        hasAcceptedAnswer: true,
      });
    });

    it('costs four queries for a page, not one per row', async () => {
      const { service, prisma } = harness();
      prisma.topic.findMany.mockResolvedValue([
        topicRow({ id: 't-1', authorId: 'u-1' }),
        topicRow({ id: 't-2', authorId: 'u-2' }),
        topicRow({ id: 't-3', authorId: 'u-1' }),
      ]);
      prisma.topic.count.mockResolvedValue(3);

      await service.list({});

      expect(prisma.topic.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.topic.count).toHaveBeenCalledTimes(1);
      expect(prisma.category.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
      // Deduplicated: three rows, two distinct authors, ONE `id: { in: [...] }`.
      expect(
        (
          prisma.user.findMany.mock.calls[0][0].where as {
            id: { in: string[] };
          }
        ).id.in,
      ).toEqual(['u-1', 'u-2']);
    });

    it('skips the author query entirely when nothing on the page has an author', async () => {
      const { service, prisma } = harness();
      prisma.topic.findMany.mockResolvedValue([topicRow({ authorId: null })]);
      prisma.topic.count.mockResolvedValue(1);
      prisma.category.findMany.mockResolvedValue([
        { id: 'c-1', name: 'General' },
      ]);

      const page = await service.list({});

      // Migrated content (A-4) and deleted accounts both carry a null authorId,
      // so this is a real case rather than a micro-optimisation.
      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(page.items[0].authorName).toBeNull();
      expect(page.items[0].authorEmail).toBeNull();
    });

    it('returns the total on an empty page without querying names', async () => {
      const { service, prisma } = harness();
      prisma.topic.count.mockResolvedValue(40);

      const page = await service.list({ page: 5 });

      expect(page).toMatchObject({ items: [], total: 40, page: 5 });
      expect(prisma.category.findMany).not.toHaveBeenCalled();
    });
  });

  describe('ordering and paging', () => {
    it('orders by lastPostedAt descending, WITHOUT the pinned hoist', async () => {
      const { service, prisma } = harness();

      await service.list({});

      // Pinning is a member-facing display rule (R1.2.5). A moderation queue
      // that reordered itself because someone pinned a thread would be actively
      // unhelpful.
      expect(prisma.topic.findMany.mock.calls[0][0].orderBy).toEqual({
        lastPostedAt: 'desc',
      });
    });

    it('applies the 1-based skip correctly', async () => {
      const { service, prisma } = harness();

      await service.list({ page: 3, pageSize: 10 });

      expect(prisma.topic.findMany.mock.calls[0][0]).toMatchObject({
        skip: 20,
        take: 10,
      });
    });
  });

  describe('resolveAdminTopicQuery', () => {
    it('defaults includeDeleted to false', () => {
      expect(resolveAdminTopicQuery({}).includeDeleted).toBe(false);
    });

    it('applies the shared page defaults', () => {
      expect(resolveAdminTopicQuery({})).toMatchObject({
        page: 1,
        pageSize: 25,
      });
    });

    it('is a class the controller can bind with dtoPipe', () => {
      // Anti-vacuity for PRE-1: `dtoPipe(X)` needs a CLASS, and a type-only DTO
      // would compile everywhere and validate nothing.
      expect(typeof ListAdminTopicsQueryDto).toBe('function');
      expect(new ListAdminTopicsQueryDto()).toBeInstanceOf(
        ListAdminTopicsQueryDto,
      );
    });
  });
});

/** Mirrors the census's own walk, so "the only marked service" means the same thing. */
function collectServices(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectServices(full, acc);
    else if (entry.name.endsWith('.service.ts')) acc.push(full);
  }
  return acc;
}
