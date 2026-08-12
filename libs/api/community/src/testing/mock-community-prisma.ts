import type { PrismaService } from '@ptah-api/core';

/**
 * A Prisma mock covering the models the PHASE-4 community services touch — the
 * test double every `live-sessions/` and `session-requests` spec builds on.
 *
 * ⚠️ WHY THIS EXISTS RATHER THAN `@ptah-api/core`'s `createMockPrisma()`.
 * The shared factory at `libs/api/core/src/testing/mock-prisma.factory.ts`
 * carries nine models, none of them `liveSession`, and its OWN spec asserts
 * `MODEL_KEYS` by EXACT EQUALITY — so adding one there turns `api-core:test` red
 * unless that assertion is edited in the same change. `libs/api/core` is outside
 * this batch's territory, and that assertion is a census of the same kind as
 * `NAMED_PRIMITIVE_PARAM_COUNT`: editing another lib's census to make this lib's
 * tests compile is not a change to make unilaterally.
 * `libs/api/forum/src/testing/mock-forum-prisma.ts` and
 * `libs/api/learning/src/testing/mock-learning-prisma.ts` made exactly this call
 * in the two preceding phases. This file follows them.
 *
 * ⚠️ IT LIVES IN `src/testing/`, WHICH `tsconfig.lib.json` NOW EXCLUDES — the
 * one line this batch adds to that file, matching `libs/api/learning`'s. It is
 * compiled and type-checked by `ts-jest` under `tsconfig.spec.json` (where
 * `@types/jest` is available) and is never part of the published lib surface.
 *
 * ⚠️ IT IS NOT EXPORTED FROM `src/index.ts`. A test double is not part of a
 * lib's public API.
 *
 * ⚠️ IT CARRIES A WORKING `$transaction` STUB, and that is the main reason it is
 * hoisted out of any one spec. Every write path in this batch uses one, and
 * several slightly different inline stubs that disagree about whether the
 * callback receives the same mock instance is the failure this file prevents.
 * The pre-Phase-4 specs in this lib (`packs`, `member-groups`) keep their own
 * inline mocks — they are green, they are not in this batch's file set, and
 * rewriting them would put unrelated churn in this diff.
 */

/** Every verb the Phase-4 services call, on every model. */
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
 * The models the Phase-4 surfaces touch.
 *
 * - `liveSession`     — R3, the only soft-deletable model in this directory.
 * - `sessionRequest`  — R4. NO `deletedAt`; see `common/soft-delete.ts`.
 * - `user`            — the requester projection on the admin queue (R4.4).
 * - `memberGroup`     — the AD-10 `cohortKeys` write-time validation.
 */
export const COMMUNITY_MODEL_KEYS = [
  'liveSession',
  'sessionRequest',
  'user',
  'memberGroup',
] as const;

export type CommunityModelKey = (typeof COMMUNITY_MODEL_KEYS)[number];

export type MockCommunityPrisma = Record<
  CommunityModelKey,
  MockModelDelegate
> & {
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
 * variant these services use — by invoking the callback with the same mock
 * instance, so a service that reaches for `tx.liveSession.update` hits the same
 * spy the spec asserted on. The array variant is supported too.
 */
export function createMockPrisma(): MockCommunityPrisma {
  const mock = {} as MockCommunityPrisma;

  for (const key of COMMUNITY_MODEL_KEYS) {
    mock[key] = createMockDelegate();
  }

  mock.$transaction = jest.fn(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: MockCommunityPrisma) => Promise<unknown>)(mock);
    }
    if (Array.isArray(arg)) return Promise.all(arg);
    return arg;
  });
  mock.$queryRaw = jest.fn();
  mock.$executeRaw = jest.fn();

  return mock;
}

/**
 * TOTAL DATABASE ROUND TRIPS recorded on the mock — the instrument a query
 * budget assertion reads.
 *
 * ⚠️ IT COUNTS EVERY VERB ON EVERY MODEL, PLUS RAW QUERIES. Counting only
 * `findMany` would score an N+1 built out of `findFirst` as zero queries, which
 * is the exact failure a budget exists to catch. `$transaction` itself is NOT
 * counted — it is a wrapper, not a round trip.
 *
 * The Live feed is the natural home of an N+1 here: "for each session, resolve
 * its cohort names" is the obvious way to build the admin list and the wrong
 * one.
 */
export function countQueries(prisma: MockCommunityPrisma): number {
  let total = 0;

  for (const key of COMMUNITY_MODEL_KEYS) {
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
 * fifth rather than only that there was one.
 */
export function queryBreakdown(prisma: MockCommunityPrisma): string[] {
  const calls: string[] = [];

  for (const key of COMMUNITY_MODEL_KEYS) {
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
export function asPrismaService(mock: MockCommunityPrisma): PrismaService {
  return mock as unknown as PrismaService;
}
