import type { PrismaService } from '@ptah-api/core';

/**
 * A Prisma mock covering the FIVE course models — the test double every spec in
 * `libs/api/learning` builds on.
 *
 * ⚠️ WHY THIS EXISTS RATHER THAN `@ptah-api/core`'s `createMockPrisma()`.
 *
 * The shared factory at `libs/api/core/src/testing/mock-prisma.factory.ts`
 * carries NINE models and none of the course models, and its own spec
 * (`mock-prisma.factory.spec.ts:51`) asserts `MODEL_KEYS` by EXACT EQUALITY:
 *
 *   expect([...MODEL_KEYS].sort()).toEqual(['adminAuditLog', … 'user'].sort());
 *
 * so adding `course` / `courseModule` / `lesson` / `lessonProgress` /
 * `lessonComment` there turns `api-core:test` red unless that assertion is
 * edited in the same change. `libs/api/core` is outside this batch's territory,
 * and that assertion is a census of the same kind as
 * `NAMED_PRIMITIVE_PARAM_COUNT` — editing another lib's census to make this
 * lib's tests compile is not a change to make unilaterally.
 *
 * `libs/api/forum/src/testing/mock-forum-prisma.ts` made exactly this call one
 * phase earlier, for exactly these reasons. This file follows it.
 *
 * ⚠️ SEPARATELY, THE SHARED FACTORY'S DOCBLOCK CLAIM TO COVER "every model in
 * schema.prisma" WAS ALREADY STALE BEFORE PHASE 2 — `Pack`, `MemberGroup` and
 * `Waitlist` are absent from it too. That is worth a follow-up and it is not
 * this batch's.
 *
 * ⚠️ IT LIVES IN `src/testing/`, WHICH `tsconfig.lib.json` EXCLUDES. It is
 * compiled and type-checked by `ts-jest` under `tsconfig.spec.json` (where
 * `@types/jest` is available) and is never part of the published lib surface.
 *
 * ⚠️ IT IS NOT EXPORTED FROM `src/index.ts`. A test double is not part of a
 * lib's public API.
 *
 * ⚠️ IT CARRIES A WORKING `$transaction` STUB, and that is the main reason it is
 * hoisted out of any one spec. Every write path in this batch uses one, and
 * nine slightly different inline stubs that disagree about whether the callback
 * receives the same mock instance is the failure this file exists to prevent.
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
 * The five course models, plus:
 * - `user` for the ONE batched author-name lookup on a comment thread (the
 *   same NFR-P4 shape the forum uses).
 * - `memberGroup` for the `cohortKeys` write-time validation on a course, which
 *   mirrors `CategoriesService`.
 */
export const LEARNING_MODEL_KEYS = [
  'course',
  'courseModule',
  'lesson',
  'lessonProgress',
  'lessonComment',
  'user',
  'memberGroup',
] as const;

export type LearningModelKey = (typeof LEARNING_MODEL_KEYS)[number];

export type MockLearningPrisma = Record<LearningModelKey, MockModelDelegate> & {
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
 * instance, so a service that reaches for `tx.lesson.update` hits the same spy
 * the spec asserted on. The array variant is supported too.
 */
export function createMockPrisma(): MockLearningPrisma {
  const mock = {} as MockLearningPrisma;

  for (const key of LEARNING_MODEL_KEYS) {
    mock[key] = createMockDelegate();
  }

  mock.$transaction = jest.fn(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: MockLearningPrisma) => Promise<unknown>)(mock);
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
 * counted — it is a wrapper, not a round trip; the statements inside it are
 * counted individually, which is the honest number.
 *
 * A course tree is the natural home of an N+1 in this lib: "for each module,
 * fetch its lessons" is the obvious way to write the read model and the wrong
 * one.
 */
export function countQueries(prisma: MockLearningPrisma): number {
  let total = 0;

  for (const key of LEARNING_MODEL_KEYS) {
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
export function queryBreakdown(prisma: MockLearningPrisma): string[] {
  const calls: string[] = [];

  for (const key of LEARNING_MODEL_KEYS) {
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
export function asPrismaService(mock: MockLearningPrisma): PrismaService {
  return mock as unknown as PrismaService;
}
