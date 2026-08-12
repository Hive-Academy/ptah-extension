import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@ptah-api/core';
import type { PrismaService } from '@ptah-api/core';
import type { MemberContext } from '@ptah-api/membership';
import {
  NOTIFICATION_KINDS,
  memberNotificationSchema,
  type NotificationKind,
} from '@ptah-contracts/community';

import { buildNotificationRoute } from './notification-kinds';
import {
  NotificationsService,
  UNNAMED_ACTOR,
  toMemberNotification,
  type NotificationRow,
} from './notifications.service';

/**
 * `NotificationsService` — R10.2, R10.3, R10.4, NFR-S4, NFR-S7, NFR-S8, NFR-P5,
 * RISK-AH, RISK-AI, ASSUMPTION-22, ground truth 3.
 *
 * ── WHY THE DOUBLE IS STATEFUL ────────────────────────────────────────────
 * Three of the properties under test are about WHO a write reaches: identity B
 * must not be able to mark identity A's notification read, a second `markRead`
 * must not move an existing `readAt`, and `markAllRead` must touch exactly one
 * member's rows. A double that only records its arguments can assert the SHAPE
 * of the `where` — which is worth something — but it cannot assert that A's row
 * is still unread afterwards, and that is the assertion RISK-AH actually asks
 * for. So the store below applies the `where` and mutates rows.
 *
 * It understands scalar equality and `null`, and nothing else. An implementation
 * that reached for an operator it does not model would match no rows and fail
 * loudly rather than pass quietly.
 */

interface Row {
  id: string;
  userId: string;
  kind: string;
  actorId: string | null;
  targetType: string;
  targetId: string;
  title: string;
  bodyPreview: string | null;
  route: string;
  readAt: Date | null;
  createdAt: Date;
}

type Where = Record<string, unknown>;

const ALICE = 'aaaaaaaa-0000-4000-8000-000000000001';
const BOB = 'bbbbbbbb-0000-4000-8000-000000000002';

const ACTORS: Record<
  string,
  { firstName: string | null; lastName: string | null }
> = {
  [ALICE]: { firstName: 'Alice', lastName: 'Ng' },
  [BOB]: { firstName: 'Bob', lastName: null },
  'cccccccc-0000-4000-8000-000000000003': { firstName: null, lastName: null },
};

const NAMELESS = 'cccccccc-0000-4000-8000-000000000003';

function ctxFor(userId: string): MemberContext {
  return {
    userId,
    email: `${userId}@example.com`,
    entitled: true,
    cohortKeys: [],
    isAdmin: false,
  };
}

function seedRow(overrides: Partial<Row> = {}): Row {
  return {
    id: `n_${Math.random().toString(36).slice(2, 10)}`,
    userId: ALICE,
    kind: 'topic.reply',
    actorId: BOB,
    targetType: 'Topic',
    targetId: 'topic_1',
    title: 'Bob replied to your topic',
    bodyPreview: 'I ran into the same thing last week…',
    route: '/members/community/topics/a-topic',
    readAt: null,
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    ...overrides,
  };
}

/**
 * The one Prisma OPERATOR this store models — `{ in: [...] }`, set membership.
 *
 * 🔴 IT IS MODELLED RATHER THAN COLLAPSED TO EQUALITY BECAUSE OF WHAT AN
 * EMPTY LIST MEANS. `in: []` matches NOTHING; `undefined` in the same position
 * means NO CONSTRAINT and would match EVERYTHING. `markManyRead` depends on the
 * first of those, and the difference between them is the difference between an
 * empty selection doing nothing and an empty selection marking a member's
 * entire inbox read, irreversibly. A double that treated the whole `where` as
 * equality could not tell those two apart.
 */
function isInFilter(value: unknown): value is { in: readonly unknown[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { in?: unknown }).in)
  );
}

function matches(row: Row, where: Where): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = (row as unknown as Record<string, unknown>)[key];
    if (expected === null) return actual === null;
    if (isInFilter(expected)) return expected.in.includes(actual);
    if (typeof expected === 'object') {
      // ⚠️ LOUD, NOT QUIET. An implementation reaching for an operator this
      // store does not model (`not`, `gte`, `contains`, …) would otherwise
      // match zero rows and let an assertion pass for the wrong reason.
      throw new Error(
        `The notification store models scalar equality, null and { in: [...] } ` +
          `only. The where clause used an unmodelled operator on "${key}": ` +
          `${JSON.stringify(expected)}. Model it here before relying on it.`,
      );
    }
    return actual === expected;
  });
}

function createStore(seed: Row[] = []) {
  const rows: Row[] = seed.map((r) => ({ ...r }));
  const calls = {
    findMany: [] as unknown[],
    count: [] as unknown[],
    updateMany: [] as unknown[],
    create: [] as unknown[],
  };

  const notification = {
    create: jest.fn(async (args: { data: Record<string, unknown> }) => {
      calls.create.push(args);
      const created: Row = {
        ...seedRow(),
        ...(args.data as unknown as Partial<Row>),
        readAt: null,
        createdAt: new Date(),
        id: `n_${rows.length + 1}`,
      };
      rows.push(created);
      return { id: created.id };
    }),
    findMany: jest.fn(
      async (args: {
        where: Where;
        orderBy?: unknown;
        skip?: number;
        take?: number;
        include?: unknown;
      }) => {
        calls.findMany.push(args);
        const hits = rows
          .filter((r) => matches(r, args.where))
          .sort(
            (a, b) =>
              b.createdAt.getTime() - a.createdAt.getTime() ||
              b.id.localeCompare(a.id),
          )
          .slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? rows.length));

        return hits.map((r) => ({
          ...r,
          actor: r.actorId ? (ACTORS[r.actorId] ?? null) : null,
        }));
      },
    ),
    count: jest.fn(async (args: { where: Where }) => {
      calls.count.push(args);
      return rows.filter((r) => matches(r, args.where)).length;
    }),
    updateMany: jest.fn(
      async (args: { where: Where; data: { readAt: Date } }) => {
        calls.updateMany.push(args);
        const hits = rows.filter((r) => matches(r, args.where));
        for (const hit of hits) hit.readAt = args.data.readAt;
        return { count: hits.length };
      },
    ),
    findFirst: jest.fn(
      async (args: { where: Where; select?: Record<string, boolean> }) => {
        const hit = rows.find((r) => matches(r, args.where));
        return hit ? { readAt: hit.readAt } : null;
      },
    ),
  };

  const prisma = { notification } as unknown as PrismaService;
  return { prisma, rows, notification, calls };
}

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'PRISMA-INTERNAL-DETAIL: Foreign key constraint violated on the ' +
      'constraint: `member_notifications_user_id_fkey`',
    { code, clientVersion: '7.7.0' },
  );
}

describe('NotificationsService', () => {
  /* ---------------------------------------------------------------------- */
  /* R10.2 — exit-gate clause 2                                             */
  /* ---------------------------------------------------------------------- */

  describe('🔴 R10.2 — a member is never notified about their own action', () => {
    it('returns null and writes NOTHING when recipientId === actorId', async () => {
      const { prisma, notification, rows } = createStore();
      const service = new NotificationsService(prisma);

      const result = await service.create({
        recipientId: ALICE,
        actorId: ALICE,
        kind: 'topic.reply',
        targetType: 'Topic',
        targetId: 'topic_1',
        title: 'You replied to your own topic',
        route: buildNotificationRoute('Topic', { topicSlug: 'a-topic' }),
      });

      expect(result).toBeNull();
      // Not "wrote and then filtered" — the row was never created.
      expect(notification.create).not.toHaveBeenCalled();
      expect(rows).toHaveLength(0);
    });

    it('does not throw — self-action is the NORMAL case, not an error', async () => {
      const { prisma } = createStore();
      const service = new NotificationsService(prisma);

      // A member replying to their own topic is ordinary behaviour. An
      // exception here would make every producer wrap the call in a `try`, and
      // one of them would eventually swallow a real failure with it.
      await expect(
        service.create({
          recipientId: ALICE,
          actorId: ALICE,
          kind: 'post.child_reply',
          targetType: 'Post',
          targetId: 'p1',
          title: 't',
          route: '/members/community/topics/x#post-p1',
        }),
      ).resolves.toBeNull();
    });

    it('DOES write when the actor is someone else', async () => {
      const { prisma, rows } = createStore();
      const service = new NotificationsService(prisma);

      const id = await service.create({
        recipientId: ALICE,
        actorId: BOB,
        kind: 'topic.reply',
        targetType: 'Topic',
        targetId: 'topic_1',
        title: 'Bob replied to your topic',
        route: '/members/community/topics/a-topic',
      });

      expect(id).not.toBeNull();
      expect(rows).toHaveLength(1);
    });

    it('DOES write when the actor is null — a system row is not a self-action', async () => {
      // The suppression must compare a REAL actor to the recipient. A naive
      // `recipientId === actorId` on two nulls, or a truthiness check, would
      // suppress every announcement in the product.
      const { prisma, rows } = createStore();
      const service = new NotificationsService(prisma);

      const id = await service.create({
        recipientId: ALICE,
        actorId: null,
        kind: 'announcement',
        targetType: 'LiveSession',
        targetId: 'ls_1',
        title: 'A new session was published',
        route: buildNotificationRoute('LiveSession'),
      });

      expect(id).not.toBeNull();
      expect(rows).toHaveLength(1);
    });

    it('the suppression lives in create() and in no producer — one call site', () => {
      // R10.2 is enforced by concentration: if this branch is here, no producer
      // can forget it; if a producer copies it, the copy is what drifts. Pinned
      // as source text so a "defensive" second check is visible in review.
      const { readFileSync } = require('node:fs') as typeof import('node:fs');
      const { join } = require('node:path') as typeof import('node:path');
      const source = readFileSync(
        join(__dirname, 'notifications.service.ts'),
        'utf8',
      );

      const occurrences = source.match(
        /recipientId === input\.actorId|input\.recipientId === input\.actorId/g,
      );
      expect(occurrences).toHaveLength(1);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* ASSUMPTION-21 — the producer's transaction                              */
  /* ---------------------------------------------------------------------- */

  describe('ASSUMPTION-21 — the write enlists in the producer transaction', () => {
    it('uses the supplied tx client instead of the service prisma', async () => {
      const { prisma, notification } = createStore();
      const tx = createStore();
      const service = new NotificationsService(prisma);

      await service.create({
        recipientId: ALICE,
        actorId: BOB,
        kind: 'post.accepted',
        targetType: 'Post',
        targetId: 'p1',
        title: 'Your reply was accepted',
        route: '/members/community/topics/x#post-p1',
        tx: tx.notification
          ? (tx.prisma as unknown as Prisma.TransactionClient)
          : undefined,
      });

      expect(tx.rows).toHaveLength(1);
      expect(notification.create).not.toHaveBeenCalled();
    });

    it('falls back to its own client when no tx is supplied', async () => {
      const { prisma, notification } = createStore();
      const service = new NotificationsService(prisma);

      await service.create({
        recipientId: ALICE,
        actorId: BOB,
        kind: 'session_request.status',
        targetType: 'SessionRequest',
        targetId: 'sr_1',
        title: 'Your session request was accepted',
        route: buildNotificationRoute('SessionRequest'),
      });

      expect(notification.create).toHaveBeenCalledTimes(1);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* R10.3 — the list                                                        */
  /* ---------------------------------------------------------------------- */

  describe('R10.3 — the inbox', () => {
    it("is scoped to the caller and never leaks another member's rows", async () => {
      const { prisma } = createStore([
        seedRow({ id: 'a1', userId: ALICE, title: "Alice's" }),
        seedRow({ id: 'b1', userId: BOB, title: "Bob's" }),
      ]);
      const service = new NotificationsService(prisma);

      const page = await service.list(ctxFor(ALICE), { page: 1, pageSize: 25 });

      expect(page.items.map((i) => i.id)).toEqual(['a1']);
      // `total` runs under the SAME `where`, so it can never count rows the
      // member cannot read.
      expect(page.total).toBe(1);
    });

    it('is newest first', async () => {
      const { prisma } = createStore([
        seedRow({ id: 'old', createdAt: new Date('2026-01-01T00:00:00.000Z') }),
        seedRow({ id: 'new', createdAt: new Date('2026-08-01T00:00:00.000Z') }),
      ]);
      const service = new NotificationsService(prisma);

      const page = await service.list(ctxFor(ALICE), { page: 1, pageSize: 25 });

      expect(page.items.map((i) => i.id)).toEqual(['new', 'old']);
    });

    it('breaks ties on id so two identical requests return the same page', async () => {
      // Two notifications out of ONE event share a millisecond (RISK-AF), so
      // `createdAt desc` alone is not a total order.
      const { prisma, notification } = createStore([seedRow()]);
      const service = new NotificationsService(prisma);

      await service.list(ctxFor(ALICE), { page: 1, pageSize: 25 });

      const args = notification.findMany.mock.calls[0]?.[0] as {
        orderBy: unknown;
      };
      expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    });

    it('echoes the EFFECTIVE paging and computes hasMore from the total', async () => {
      const { prisma } = createStore(
        Array.from({ length: 7 }, (_, i) =>
          seedRow({
            id: `n${i}`,
            createdAt: new Date(2026, 0, i + 1),
          }),
        ),
      );
      const service = new NotificationsService(prisma);

      const page1 = await service.list(ctxFor(ALICE), { page: 1, pageSize: 3 });
      expect(page1).toMatchObject({
        page: 1,
        pageSize: 3,
        total: 7,
        hasMore: true,
      });
      expect(page1.items).toHaveLength(3);

      const page3 = await service.list(ctxFor(ALICE), { page: 3, pageSize: 3 });
      expect(page3).toMatchObject({ page: 3, total: 7, hasMore: false });
      expect(page3.items).toHaveLength(1);
    });

    it('does not clamp pageSize — the DTO owns that bound (NFR-P5)', async () => {
      // A second clamp here would make the DTO's 400 unobservable: a client
      // that asked for 500 would silently receive 50 and believe it had them
      // all. The service trusts the validated input.
      const { prisma, notification } = createStore([seedRow()]);
      const service = new NotificationsService(prisma);

      await service.list(ctxFor(ALICE), { page: 1, pageSize: 500 });

      const args = notification.findMany.mock.calls[0]?.[0] as { take: number };
      expect(args.take).toBe(500);
    });

    it('every one of the five kinds round-trips through the contract schema', async () => {
      const { prisma } = createStore(
        NOTIFICATION_KINDS.map((kind, i) =>
          seedRow({
            id: `k${i}`,
            kind,
            // `announcement` is deliberately actor-less and has NO producer
            // (ASSUMPTION-20) — it is exercised here anyway, because the
            // service accepts it and the client must be able to render it.
            actorId: kind === 'announcement' ? null : BOB,
            targetType:
              kind === 'announcement'
                ? 'LiveSession'
                : kind === 'session_request.status'
                  ? 'SessionRequest'
                  : kind === 'topic.reply'
                    ? 'Topic'
                    : 'Post',
            createdAt: new Date(2026, 0, i + 1),
          }),
        ),
      );
      const service = new NotificationsService(prisma);

      const page = await service.list(ctxFor(ALICE), { page: 1, pageSize: 50 });

      expect(page.items).toHaveLength(NOTIFICATION_KINDS.length);
      for (const item of page.items) {
        expect(() => memberNotificationSchema.parse(item)).not.toThrow();
      }
      expect(page.items.map((i) => i.kind).sort()).toEqual(
        [...NOTIFICATION_KINDS].sort(),
      );
    });

    it('skips a row whose kind is outside the vocabulary rather than breaking the page', async () => {
      // The client parses the WHOLE page with `memberNotificationSchema`, whose
      // `z.enum` would reject the entire response. One bad row must not cost a
      // member their whole inbox.
      const { prisma } = createStore([
        seedRow({
          id: 'good',
          createdAt: new Date('2026-08-02T00:00:00.000Z'),
        }),
        seedRow({
          id: 'bad',
          kind: 'topic.deleted',
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
        }),
      ]);
      const service = new NotificationsService(prisma);

      const page = await service.list(ctxFor(ALICE), { page: 1, pageSize: 25 });

      expect(page.items.map((i) => i.id)).toEqual(['good']);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* NFR-S4 — the wire shape                                                 */
  /* ---------------------------------------------------------------------- */

  describe('NFR-S4 — the response identifies nobody', () => {
    it('carries no userId and no actorId own key', async () => {
      const { prisma } = createStore([seedRow()]);
      const service = new NotificationsService(prisma);

      const [item] = (
        await service.list(ctxFor(ALICE), { page: 1, pageSize: 25 })
      ).items;

      expect(Object.keys(item ?? {}).sort()).toEqual([
        'actorName',
        'bodyPreview',
        'createdAt',
        'id',
        'kind',
        'readAt',
        'route',
        'targetId',
        'targetType',
        'title',
      ]);
      expect(JSON.stringify(item)).not.toContain(BOB);
      expect(JSON.stringify(item)).not.toContain(ALICE);
    });

    it('never carries an email address', async () => {
      const { prisma } = createStore([seedRow()]);
      const service = new NotificationsService(prisma);

      const page = await service.list(ctxFor(ALICE), { page: 1, pageSize: 25 });

      expect(JSON.stringify(page)).not.toContain('@example.com');
      expect(JSON.stringify(page)).not.toContain('@');
    });
  });

  describe('ASSUMPTION-22 / ground truth 3 — actorName', () => {
    const base: NotificationRow = {
      id: 'n1',
      kind: 'topic.reply',
      actorId: BOB,
      targetType: 'Topic',
      targetId: 't1',
      title: 'x',
      bodyPreview: null,
      route: '/members/community/topics/x',
      readAt: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    };

    it('composes firstName + lastName — User has no name column', () => {
      const mapped = toMemberNotification({
        ...base,
        actor: { firstName: 'Alice', lastName: 'Ng' },
      });

      expect(mapped?.actorName).toBe('Alice Ng');
    });

    it('uses whichever half exists', () => {
      expect(
        toMemberNotification({
          ...base,
          actor: { firstName: 'Bob', lastName: null },
        })?.actorName,
      ).toBe('Bob');
      expect(
        toMemberNotification({
          ...base,
          actor: { firstName: null, lastName: 'Ng' },
        })?.actorName,
      ).toBe('Ng');
    });

    it('falls back to the constant when an actor exists with NO name on file', () => {
      // Both-null is a REAL row in this database. Rendering "replied to your
      // topic" with a blank subject is worse than a generic one.
      const mapped = toMemberNotification({
        ...base,
        actor: { firstName: null, lastName: null },
      });

      expect(mapped?.actorName).toBe(UNNAMED_ACTOR);
      expect(mapped?.actorName).not.toBeNull();
    });

    it('treats whitespace-only names as absent', () => {
      expect(
        toMemberNotification({
          ...base,
          actor: { firstName: '   ', lastName: '' },
        })?.actorName,
      ).toBe(UNNAMED_ACTOR);
    });

    it('is null ONLY for a genuinely actor-less row', () => {
      const mapped = toMemberNotification({
        ...base,
        kind: 'announcement',
        targetType: 'LiveSession',
        actorId: null,
        actor: null,
      });

      // `null` is the signal the client branches on to render a subject-less
      // sentence. A nameless member must not collapse into this case.
      expect(mapped?.actorName).toBeNull();
    });

    it('never falls back to an email, even when one is on the row', async () => {
      const { prisma } = createStore([seedRow({ actorId: NAMELESS })]);
      const service = new NotificationsService(prisma);

      const [item] = (
        await service.list(ctxFor(ALICE), { page: 1, pageSize: 25 })
      ).items;

      expect(item?.actorName).toBe(UNNAMED_ACTOR);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* RISK-AH — ownership-scoped writes                                       */
  /* ---------------------------------------------------------------------- */

  describe('🔴 RISK-AH — every write is ownership-scoped in the WHERE', () => {
    it('markRead puts userId in the where, not in a post-read check', async () => {
      const { prisma, notification } = createStore([seedRow({ id: 'a1' })]);
      const service = new NotificationsService(prisma);

      await service.markRead(ctxFor(ALICE), 'a1');

      const args = notification.updateMany.mock.calls[0]?.[0] as {
        where: unknown;
      };
      expect(args.where).toEqual({ id: 'a1', userId: ALICE, readAt: null });
      // Never findUnique → check → update: that has a window and reads as
      // correct.
      expect(
        (notification as unknown as Record<string, unknown>)['findUnique'],
      ).toBeUndefined();
    });

    it("identity B cannot mark identity A's notification read", async () => {
      const store = createStore([seedRow({ id: 'a1', userId: ALICE })]);
      const service = new NotificationsService(store.prisma);

      const result = await service.markRead(ctxFor(BOB), 'a1');

      // Indistinguishable from a notification that never existed.
      expect(result).toEqual({ readAt: null });
      // 🔴 AND A'S ROW IS UNTOUCHED — the half an argument-shape assertion
      // cannot make.
      expect(store.rows[0]?.readAt).toBeNull();
    });

    it('a not-found id answers exactly what a not-yours id answers', async () => {
      const store = createStore([seedRow({ id: 'a1', userId: ALICE })]);
      const service = new NotificationsService(store.prisma);

      const notYours = await service.markRead(ctxFor(BOB), 'a1');
      const notFound = await service.markRead(ctxFor(BOB), 'does-not-exist');

      // A distinguishable answer is an existence oracle over guessable cuids.
      expect(notYours).toEqual(notFound);
    });

    it('marks an own unread notification read and returns the timestamp', async () => {
      const store = createStore([seedRow({ id: 'a1' })]);
      const service = new NotificationsService(store.prisma);

      const result = await service.markRead(ctxFor(ALICE), 'a1');

      expect(result.readAt).toEqual(expect.any(String));
      expect(store.rows[0]?.readAt).toBeInstanceOf(Date);
    });

    it('re-reading an already-read notification does NOT move readAt', async () => {
      // Every navigation to the inbox re-issues this call. Without the
      // `readAt: null` clause the member's history would say they read a
      // three-week-old notification today.
      const original = new Date('2026-07-01T09:00:00.000Z');
      const store = createStore([seedRow({ id: 'a1', readAt: original })]);
      const service = new NotificationsService(store.prisma);

      const result = await service.markRead(ctxFor(ALICE), 'a1');

      expect(result.readAt).toBe(original.toISOString());
      expect(store.rows[0]?.readAt).toEqual(original);
    });

    /* -------------------------------------------------------------------- */
    /* markManyRead — the bulk write, and the property it exists to preserve  */
    /* -------------------------------------------------------------------- */

    it('markManyRead puts userId AND the id set in one where', async () => {
      const { prisma, notification } = createStore([
        seedRow({ id: 'a1' }),
        seedRow({ id: 'a2' }),
      ]);
      const service = new NotificationsService(prisma);

      await service.markManyRead(ctxFor(ALICE), ['a1', 'a2']);

      const args = notification.updateMany.mock.calls[0]?.[0] as {
        where: unknown;
      };
      expect(args.where).toEqual({
        id: { in: ['a1', 'a2'] },
        userId: ALICE,
        readAt: null,
      });
      // ONE statement, not N. And never findMany → filter → update: that shape
      // has a window between the read and the write and READS as correct.
      expect(notification.updateMany).toHaveBeenCalledTimes(1);
      expect(notification.findMany).not.toHaveBeenCalled();
    });

    it("🔴 identity B cannot mark identity A's notifications read in bulk", async () => {
      // THE SINGLE MOST IMPORTANT ASSERTION IN THIS ENDPOINT. B names three
      // ids: one of A's, one that never existed, and one of B's own.
      const store = createStore([
        seedRow({ id: 'a1', userId: ALICE }),
        seedRow({ id: 'a2', userId: ALICE }),
        seedRow({ id: 'b1', userId: BOB }),
      ]);
      const service = new NotificationsService(store.prisma);

      const result = await service.markManyRead(ctxFor(BOB), [
        'a1',
        'does-not-exist',
        'b1',
      ]);

      // Only B's own row moved. `marked` does not distinguish A's real id from
      // an id that never existed — both simply are not counted, so the response
      // is not an existence oracle over guessable cuids.
      expect(result).toEqual({ marked: 1 });
      expect(store.rows.find((r) => r.id === 'a1')?.readAt).toBeNull();
      expect(store.rows.find((r) => r.id === 'a2')?.readAt).toBeNull();
      expect(store.rows.find((r) => r.id === 'b1')?.readAt).toBeInstanceOf(
        Date,
      );
    });

    it("naming ONLY another member's ids answers exactly what naming nothing real answers", async () => {
      const store = createStore([seedRow({ id: 'a1', userId: ALICE })]);
      const service = new NotificationsService(store.prisma);

      const notYours = await service.markManyRead(ctxFor(BOB), ['a1']);
      const notFound = await service.markManyRead(ctxFor(BOB), ['nope']);

      expect(notYours).toEqual(notFound);
      expect(notYours).toEqual({ marked: 0 });
      expect(store.rows[0]?.readAt).toBeNull();
    });

    it('marks exactly the named rows and leaves the UNNAMED ones unread', async () => {
      // The whole point of the endpoint: a partial selection must not become
      // `read-all`. `a3` is unread, unselected, and must stay that way.
      const store = createStore([
        seedRow({ id: 'a1' }),
        seedRow({ id: 'a2' }),
        seedRow({ id: 'a3' }),
      ]);
      const service = new NotificationsService(store.prisma);

      await expect(
        service.markManyRead(ctxFor(ALICE), ['a1', 'a2']),
      ).resolves.toEqual({ marked: 2 });

      expect(store.rows.find((r) => r.id === 'a3')?.readAt).toBeNull();
    });

    it('🔴 an EMPTY selection marks NOTHING — it does not mark everything', async () => {
      // `in: []` matches no rows. The tempting `ids.length ? { in: ids } :
      // undefined` would make this same call mark A's entire inbox read, with
      // a 200, irreversibly. The DTO rejects an empty array before it reaches
      // here; this asserts the service is safe even if that rejection were
      // removed.
      const store = createStore([seedRow({ id: 'a1' }), seedRow({ id: 'a2' })]);
      const service = new NotificationsService(store.prisma);

      await expect(service.markManyRead(ctxFor(ALICE), [])).resolves.toEqual({
        marked: 0,
      });
      expect(store.rows.every((r) => r.readAt === null)).toBe(true);
    });

    it('does not rewrite an already-read timestamp inside the selection', async () => {
      const original = new Date('2026-07-01T09:00:00.000Z');
      const store = createStore([
        seedRow({ id: 'a1', readAt: original }),
        seedRow({ id: 'a2' }),
      ]);
      const service = new NotificationsService(store.prisma);

      await expect(
        service.markManyRead(ctxFor(ALICE), ['a1', 'a2']),
      ).resolves.toEqual({ marked: 1 });

      expect(store.rows.find((r) => r.id === 'a1')?.readAt).toEqual(original);
    });

    it('counts a duplicated id once — `in` is set membership', async () => {
      const store = createStore([seedRow({ id: 'a1' })]);
      const service = new NotificationsService(store.prisma);

      await expect(
        service.markManyRead(ctxFor(ALICE), ['a1', 'a1', 'a1']),
      ).resolves.toEqual({ marked: 1 });
    });

    it('returns the same field and meaning markAllRead returns', async () => {
      // The three writes stay consistent: `marked` is "rows this call moved",
      // never "the new unread count". A client conflating the two would zero a
      // badge that should not have moved.
      const store = createStore([seedRow({ id: 'a1' }), seedRow({ id: 'a2' })]);
      const service = new NotificationsService(store.prisma);

      const many = await service.markManyRead(ctxFor(ALICE), ['a1']);
      const all = await service.markAllRead(ctxFor(ALICE));

      expect(Object.keys(many)).toEqual(Object.keys(all));
      expect(many).toEqual({ marked: 1 });
      expect(all).toEqual({ marked: 1 });
    });

    it("markAllRead touches exactly one member's unread rows", async () => {
      const store = createStore([
        seedRow({ id: 'a1', userId: ALICE }),
        seedRow({ id: 'a2', userId: ALICE }),
        seedRow({ id: 'b1', userId: BOB }),
      ]);
      const service = new NotificationsService(store.prisma);

      await expect(service.markAllRead(ctxFor(ALICE))).resolves.toEqual({
        marked: 2,
      });
      expect(store.rows.find((r) => r.id === 'b1')?.readAt).toBeNull();
    });

    it('markAllRead by a member with nothing unread reports { marked: 0 }', async () => {
      const store = createStore([seedRow({ id: 'a1', userId: ALICE })]);
      const service = new NotificationsService(store.prisma);

      await expect(service.markAllRead(ctxFor(BOB))).resolves.toEqual({
        marked: 0,
      });
      expect(store.rows[0]?.readAt).toBeNull();
    });

    it('markAllRead does not rewrite already-read timestamps', async () => {
      const original = new Date('2026-07-01T09:00:00.000Z');
      const store = createStore([
        seedRow({ id: 'a1', readAt: original }),
        seedRow({ id: 'a2' }),
      ]);
      const service = new NotificationsService(store.prisma);

      await expect(service.markAllRead(ctxFor(ALICE))).resolves.toEqual({
        marked: 1,
      });
      expect(store.rows.find((r) => r.id === 'a1')?.readAt).toEqual(original);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* RISK-AI — the badge                                                     */
  /* ---------------------------------------------------------------------- */

  describe('🔴 RISK-AI — unreadCount is a count, and nothing else', () => {
    it('issues prisma.notification.count with { userId, readAt: null }', async () => {
      const { prisma, notification } = createStore([
        seedRow({ id: 'a1' }),
        seedRow({ id: 'a2', readAt: new Date() }),
        seedRow({ id: 'b1', userId: BOB }),
      ]);
      const service = new NotificationsService(prisma);

      await expect(service.unreadCount(ctxFor(ALICE))).resolves.toEqual({
        unreadCount: 1,
      });

      const args = notification.count.mock.calls[0]?.[0] as { where: unknown };
      expect(args.where).toEqual({ userId: ALICE, readAt: null });
    });

    it('does NOT fetch rows — this is the most-called endpoint in the product', async () => {
      // `findMany().length` transfers a member's whole inbox to compute one
      // integer, every 60 seconds, for every open tab.
      const { prisma, notification } = createStore([seedRow()]);
      const service = new NotificationsService(prisma);

      await service.unreadCount(ctxFor(ALICE));

      expect(notification.findMany).not.toHaveBeenCalled();
      expect(notification.count).toHaveBeenCalledTimes(1);
    });

    it('returns the envelope, not a bare number (R6.6)', async () => {
      const { prisma } = createStore();
      const service = new NotificationsService(prisma);

      const result = await service.unreadCount(ctxFor(ALICE));

      expect(result).toEqual({ unreadCount: 0 });
    });
  });

  /* ---------------------------------------------------------------------- */
  /* NFR-S7 — sanitized failures                                             */
  /* ---------------------------------------------------------------------- */

  describe('NFR-S7 — no raw Prisma message reaches a client', () => {
    it('maps a foreign-key violation to a sanitized 400', async () => {
      const { prisma, notification } = createStore();
      notification.create.mockRejectedValueOnce(prismaError('P2003'));
      const service = new NotificationsService(prisma);

      const thrown = await service
        .create({
          recipientId: 'no-such-user',
          actorId: BOB,
          kind: 'topic.reply',
          targetType: 'Topic',
          targetId: 't1',
          title: 'x',
          route: '/members/community/topics/x',
        })
        .catch((error: unknown) => error);

      expect(thrown).toBeInstanceOf(BadRequestException);
      const message = (thrown as BadRequestException).message;
      expect(message).not.toContain('PRISMA-INTERNAL-DETAIL');
      expect(message).not.toContain('member_notifications_user_id_fkey');
    });

    it('rethrows an unmapped failure rather than inventing a friendly sentence', async () => {
      const { prisma, notification } = createStore();
      notification.create.mockRejectedValueOnce(prismaError('P2024'));
      const service = new NotificationsService(prisma);

      await expect(
        service.create({
          recipientId: ALICE,
          actorId: BOB,
          kind: 'topic.reply' as NotificationKind,
          targetType: 'Topic',
          targetId: 't1',
          title: 'x',
          route: '/members/community/topics/x',
        }),
      ).rejects.not.toBeInstanceOf(BadRequestException);
    });
  });
});
