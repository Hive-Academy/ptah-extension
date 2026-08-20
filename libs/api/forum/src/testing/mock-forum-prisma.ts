import type { PrismaService } from '@ptah-api/core';

/**
 * A Prisma mock covering the FIVE forum models — the test double every spec in
 * `libs/api/forum` builds on.
 *
 * ⚠️ WHY THIS EXISTS RATHER THAN `@ptah-api/core`'s `createMockPrisma()`.
 *
 * Task 6.9 names `createMockPrisma()` as the instrument for the NFR-P4 query
 * budget. The shared factory at
 * `libs/api/core/src/testing/mock-prisma.factory.ts` does NOT carry `category`,
 * `topic`, `post`, `postReaction` or `topicReadState` — its `MODEL_KEYS` lists
 * nine models and its own spec asserts that list by EXACT EQUALITY:
 *
 *   expect([...MODEL_KEYS].sort()).toEqual(['adminAuditLog', … 'user'].sort());
 *
 * so adding the forum models there turns `api-core:test` red unless that
 * assertion is edited in the same change. `libs/api/core` is outside this
 * batch's territory, and that assertion is a census of the same kind as
 * `NAMED_PRIMITIVE_PARAM_COUNT` — editing it to make a different lib's tests
 * compile is not a change this batch should be making unilaterally.
 *
 * The repo already has a precedent for the alternative: `packs.service.spec.ts`
 * and `member-groups.service.spec.ts` both hand-roll a local mock for a model
 * the shared factory does not carry, and both name the local factory
 * `createMockPrisma`. This file is that pattern, hoisted out of one spec so the
 * lib's nine services share ONE double instead of nine slightly different ones
 * whose `$transaction` stubs disagree.
 *
 * ⚠️ IT LIVES IN `src/testing/`, WHICH `tsconfig.lib.json` EXCLUDES — mirroring
 * `libs/api/core/src/testing/`. It is compiled and type-checked by `ts-jest`
 * under `tsconfig.spec.json` (where `@types/jest` is available), and it is
 * never part of the published lib surface.
 *
 * ⚠️ IT IS NOT EXPORTED FROM `src/index.ts`. The barrel stays at three symbols
 * (plan §2.5); a test double is not part of a lib's public API.
 */

/** Every verb this lib's services call, on every model. */
export interface MockModelDelegate {
  findUnique: jest.Mock;
  findUniqueOrThrow: jest.Mock;
  findMany: jest.Mock;
  findFirst: jest.Mock;
  findFirstOrThrow: jest.Mock;
  create: jest.Mock;
  createMany: jest.Mock;
  update: jest.Mock;
  updateMany: jest.Mock;
  upsert: jest.Mock;
  delete: jest.Mock;
  deleteMany: jest.Mock;
  count: jest.Mock;
  aggregate: jest.Mock;
  groupBy: jest.Mock;
}

/**
 * The models this lib touches.
 *
 * `user` and `memberGroup` are here because forum services read them:
 * `user` for the ONE batched author-name lookup (NFR-P4), `memberGroup` for the
 * `cohortKeys` write-time validation in `CategoriesService`.
 */
export const FORUM_MODEL_KEYS = [
  'category',
  'topic',
  'post',
  'postReaction',
  'topicReadState',
  'user',
  'memberGroup',
] as const;

export type ForumModelKey = (typeof FORUM_MODEL_KEYS)[number];

export type MockForumPrisma = Record<ForumModelKey, MockModelDelegate> & {
  $transaction: jest.Mock;
  $queryRaw: jest.Mock;
  $executeRaw: jest.Mock;
};

/** Every verb name, in one place, so the counter below cannot miss one. */
const VERBS = [
  'findUnique',
  'findUniqueOrThrow',
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
] as const;

function createMockDelegate(): MockModelDelegate {
  const delegate = {} as MockModelDelegate;
  for (const verb of VERBS) {
    delegate[verb] = jest.fn();
  }
  return delegate;
}

/**
 * A fresh mock. `$transaction` implements the CALLBACK variant — the only
 * variant this lib's services use — by invoking the callback with the same mock
 * instance, so a service that reaches for `tx.topic.update` hits the same spy
 * the spec asserted on. The array variant is supported too.
 */
export function createMockPrisma(): MockForumPrisma {
  const mock = {} as MockForumPrisma;

  for (const key of FORUM_MODEL_KEYS) {
    mock[key] = createMockDelegate();
  }

  mock.$transaction = jest.fn(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: MockForumPrisma) => Promise<unknown>)(mock);
    }
    if (Array.isArray(arg)) return Promise.all(arg);
    return arg;
  });
  mock.$queryRaw = jest.fn();
  mock.$executeRaw = jest.fn();

  return mock;
}

/**
 * TOTAL DATABASE ROUND TRIPS recorded on the mock — the instrument NFR-P4's
 * ≤ 5 assertion reads (Task 6.9, §8.2 P2 exit gate).
 *
 * ⚠️ IT COUNTS EVERY VERB ON EVERY MODEL, PLUS RAW QUERIES. Counting only
 * `findMany` would score an N+1 built out of `findFirst` as zero queries, which
 * is the exact failure the budget exists to catch. `$transaction` itself is NOT
 * counted — it is a wrapper, not a round trip; the statements inside it are
 * counted individually, which is the honest number.
 */
export function countQueries(prisma: MockForumPrisma): number {
  let total = 0;

  for (const key of FORUM_MODEL_KEYS) {
    for (const verb of VERBS) {
      total += prisma[key][verb].mock.calls.length;
    }
  }

  total += prisma.$queryRaw.mock.calls.length;
  total += prisma.$executeRaw.mock.calls.length;

  return total;
}

/**
 * A per-call breakdown, so a failing budget assertion says WHICH query was the
 * sixth rather than only that there was one.
 */
export function queryBreakdown(prisma: MockForumPrisma): string[] {
  const calls: string[] = [];

  for (const key of FORUM_MODEL_KEYS) {
    for (const verb of VERBS) {
      const count = prisma[key][verb].mock.calls.length;
      if (count > 0) calls.push(`${key}.${verb} x${count}`);
    }
  }
  if (prisma.$queryRaw.mock.calls.length > 0) {
    calls.push(`$queryRaw x${prisma.$queryRaw.mock.calls.length}`);
  }

  return calls.sort();
}

/** Inject the mock where a service expects the concrete `PrismaService`. */
export function asPrismaService(mock: MockForumPrisma): PrismaService {
  return mock as unknown as PrismaService;
}
