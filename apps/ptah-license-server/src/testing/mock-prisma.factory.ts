/**
 * MockPrisma factory for NestJS unit tests.
 *
 * Provides a fully typed, per-model Prisma mock covering every model in
 * `apps/ptah-license-server/prisma/schema.prisma`:
 *   - user, subscription, license, failedWebhook, trialReminder,
 *     sessionRequest, adminAuditLog, marketingCampaignTemplate,
 *     marketingCampaign
 *
 * Each delegate exposes the read/write verbs we commonly use
 * (`findUnique`, `findMany`, `findFirst`, `create`, `update`, `delete`,
 * `upsert`, `count`, `deleteMany`, `updateMany`) as `jest.fn()` instances.
 *
 * `$transaction` is stubbed to immediately invoke its callback with the same
 * mock instance, which matches real Prisma semantics for the
 * `prisma.$transaction(cb => ...)` variant — the variant every service in
 * this app uses. Array-style transactions are supported too and simply
 * `Promise.all` the promises.
 *
 * Pattern exemplar: `apps/ptah-license-server/src/audit/audit-log.service.spec.ts`.
 * Cast helper `asTx(mock)` lets specs pass the mock into services that
 * expect a `Prisma.TransactionClient`.
 */

import type { Prisma } from '../generated-prisma-client/client';
import type { PrismaService } from '../prisma/prisma.service';

/** Deep partial for override objects. */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/** Verbs mocked on every model delegate. */
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
 * MockPrisma — one-to-one with the Prisma schema's models. Keep this list
 * in lock-step with `prisma/schema.prisma`. If a new model is added, add
 * the key here AND to MODEL_KEYS below.
 */
export interface MockPrisma {
  user: MockModelDelegate;
  subscription: MockModelDelegate;
  license: MockModelDelegate;
  failedWebhook: MockModelDelegate;
  trialReminder: MockModelDelegate;
  sessionRequest: MockModelDelegate;
  adminAuditLog: MockModelDelegate;
  marketingCampaignTemplate: MockModelDelegate;
  marketingCampaign: MockModelDelegate;
  $transaction: jest.Mock;
  $connect: jest.Mock;
  $disconnect: jest.Mock;
  $queryRaw: jest.Mock;
  $executeRaw: jest.Mock;
}

/** Canonical list of mocked models — must match MockPrisma keys. */
export const MODEL_KEYS = [
  'user',
  'subscription',
  'license',
  'failedWebhook',
  'trialReminder',
  'sessionRequest',
  'adminAuditLog',
  'marketingCampaignTemplate',
  'marketingCampaign',
] as const;

export type MockPrismaModel = (typeof MODEL_KEYS)[number];

function createMockDelegate(): MockModelDelegate {
  return {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findFirstOrThrow: jest.fn(),
    create: jest.fn(),
    createMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
    aggregate: jest.fn(),
    groupBy: jest.fn(),
  };
}

/**
 * Create a fresh MockPrisma with every model delegate and every $-method
 * mocked. Optional `overrides` are merged shallow-per-model.
 *
 * `$transaction` defaults to the "callback" variant of Prisma transactions:
 *   prisma.$transaction(async (tx) => { ... })
 * The callback is invoked synchronously with the same mock instance so
 * services that look up models off `tx` hit the same jest.fn spies.
 * Array-style `$transaction([p1, p2])` is supported by detecting the
 * argument shape.
 */
export function createMockPrisma(
  overrides?: DeepPartial<MockPrisma>,
): MockPrisma {
  const mock: Partial<MockPrisma> = {};

  for (const key of MODEL_KEYS) {
    mock[key] = createMockDelegate();
  }

  mock.$transaction = jest.fn(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: MockPrisma) => Promise<unknown>)(mock as MockPrisma);
    }
    if (Array.isArray(arg)) {
      return Promise.all(arg);
    }
    return arg;
  });
  mock.$connect = jest.fn(async () => undefined);
  mock.$disconnect = jest.fn(async () => undefined);
  mock.$queryRaw = jest.fn();
  mock.$executeRaw = jest.fn();

  if (overrides) {
    for (const [key, value] of Object.entries(overrides) as Array<
      [keyof MockPrisma, unknown]
    >) {
      const existing = (mock as Record<string, unknown>)[key as string];
      if (
        existing &&
        typeof existing === 'object' &&
        value &&
        typeof value === 'object'
      ) {
        (mock as Record<string, unknown>)[key as string] = {
          ...(existing as object),
          ...(value as object),
        };
      } else {
        (mock as Record<string, unknown>)[key as string] = value;
      }
    }
  }

  return mock as MockPrisma;
}

/**
 * Cast helper: treat the mock as a real `Prisma.TransactionClient` for
 * services that accept one. The cast is localised here so test files stay
 * cast-free.
 */
export function asTx(mock: MockPrisma): Prisma.TransactionClient {
  return mock as unknown as Prisma.TransactionClient;
}

/**
 * Cast helper: treat the mock as the concrete PrismaService type so it can
 * be injected via `useValue` in NestJS test modules.
 */
export function asPrismaService(mock: MockPrisma): PrismaService {
  return mock as unknown as PrismaService;
}
