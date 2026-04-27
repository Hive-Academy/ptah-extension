/**
 * License-server test harness barrel.
 *
 * Public surface:
 *   - `createMockPrisma()` / `asTx()` / `asPrismaService()` — typed
 *     Prisma mock with every model delegate.
 *   - `createTestingNestModule()` — NestJS TestingModule wrapper with
 *     pre-registered Prisma + Config seams.
 *   - `startPostgresContainer()` — testcontainers-backed integration
 *     harness (postgres:16-alpine). Dynamic-imports the dep so missing
 *     installation does not break compilation.
 *   - `paddle` fixtures — signed-webhook loader for Paddle Billing v2.
 */

export * from './mock-prisma.factory';
export * from './nest-module-builder';
export * from './testcontainers/postgres';
export * from './fixtures/paddle';
