import type { INestApplicationContext, Type } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '@ptah-api/core';
import { asPrismaService, createMockPrisma } from '@ptah-api/core/testing';

/**
 * THE BOOT SMOKE TEST — does the real `AppModule` DI graph actually resolve?
 *
 * ── THE GAP THIS CLOSES ────────────────────────────────────────────────────
 * TASK_2026_177 Batch 3 shipped `MemberHubModule` with a full, green unit
 * suite and a defect that only a live run found: `JwtAuthGuard` has constructor
 * dependencies, and a guard referenced by `@UseGuards(SomeGuard)` is
 * instantiated in the CONSUMING module's injector — so `MemberHubModule` had to
 * import `IdentityModule`. Omitting it fails at BOOT with
 * `Nest can't resolve dependencies of the JwtAuthGuard (?)`.
 *
 * Every controller spec passed straight through that bug because unit specs
 * `new` their subject directly and never touch Nest's injector at all. This is
 * a STRUCTURAL blind spot, not an oversight: no amount of per-module unit
 * testing can see a missing module import, because the missing import is the
 * thing that composes the modules.
 *
 * ── WHY `.compile()` AND DELIBERATELY NOT `.init()` ────────────────────────
 * `compile()` runs the scanner and the instance loader: every provider
 * constructor, every `useFactory`, and every enhancer (guards/pipes/filters
 * referenced by class) is instantiated in its owning module's injector. That is
 * EXACTLY the phase the Batch 3 bug failed in, and it is where "Nest can't
 * resolve dependencies of X" is thrown.
 *
 * `init()` would additionally fire `onModuleInit`, and `PrismaService`'s hook
 * calls `$connect()` and then `user.count()` against real Postgres. That would
 * make this test require docker, which would get it excluded from the fast CI
 * lane — and a boot test that does not run on every commit is not a boot test.
 * The DI graph is fully validated without it.
 *
 * ── HOW MUCH REAL GRAPH THIS EXERCISES, STATED HONESTLY ────────────────────
 * All 24 of `AppModule`'s imports, their transitive modules, every provider,
 * and every class-referenced enhancer are really constructed. Precisely TWO
 * things are faked, both leaves:
 *
 *   1. `PrismaService` is replaced by the shared mock. This removes ZERO edges:
 *      Nest still resolves `@Inject(PrismaService)` on every dependent, so a
 *      module that injects Prisma without `PrismaModule` in scope still fails
 *      here. Only the driver behind the token is fake.
 *   2. Five secrets are given hermetic dummy values, because four `useFactory`
 *      providers THROW on a missing key (`JWT_SECRET`, `WORKOS_API_KEY`,
 *      `PADDLE_API_KEY`, `RESEND_API_KEY`). They construct SDK client objects;
 *      none opens a socket. The providers themselves stay REAL and stay in the
 *      graph.
 *
 * Nothing else is mocked, overridden, or stubbed. If this test is ever made to
 * pass by widening that list, it stops being a boot test and becomes theatre —
 * the honest move at that point is to say so rather than to keep the green tick.
 *
 * What it does NOT cover, so nobody mistakes its scope: lifecycle hooks, route
 * registration (`src/common/route-map.spec.ts` owns that), request-time guard
 * behaviour, and anything requiring a database.
 *
 * ── HERMETIC ───────────────────────────────────────────────────────────────
 * No Postgres, no Google credentials, no network. The env below is assigned
 * BEFORE `app.module` is imported, which is why the import is dynamic:
 * `ConfigModule.forRoot()` merges the workspace `.env` into `process.env` at
 * module-evaluation time, and it does NOT overwrite keys already present. So
 * assigning first is what makes this test read the same in CI (no `.env`) and
 * on a developer machine (a 13 KB `.env` full of real secrets). Getting that
 * backwards is how `3d5484f40` recorded a false pass.
 */

/**
 * Dummy secrets for the four provider factories that throw on a missing key.
 *
 * Shaped like the real thing (Paddle's SDK sniffs the `test_`/`live_` prefix to
 * pick an environment) but valid for nothing. These are constructor arguments
 * to SDK clients; no request is made with them at compile time.
 */
const HERMETIC_ENV: Readonly<Record<string, string>> = {
  JWT_SECRET: 'boot-smoke-test-jwt-secret-not-a-real-key',
  WORKOS_API_KEY: 'sk_test_boot_smoke',
  WORKOS_CLIENT_ID: 'client_boot_smoke',
  PADDLE_API_KEY: 'pdl_sdbx_apikey_boot_smoke',
  RESEND_API_KEY: 're_boot_smoke',
};

describe('AppModule — boot smoke test', () => {
  let moduleRef: TestingModule;
  let compileError: unknown;

  beforeAll(async () => {
    // `PkceService` and `MagicLinkService` both start a `setInterval` in their
    // CONSTRUCTOR, so both fire during `compile()`. `MagicLinkService` never
    // clears its handle, which would keep Jest's event loop alive after the
    // suite. Fake timers keep those intervals off the real loop; this is a
    // test-runner concern only and does not touch the DI graph.
    jest.useFakeTimers();

    for (const [key, value] of Object.entries(HERMETIC_ENV)) {
      process.env[key] = value;
    }

    // Dynamic so the assignments above land BEFORE `ConfigModule.forRoot()`
    // evaluates. A static `import` is hoisted above them and would make this
    // test depend on whatever `.env` happens to be on disk.
    const { AppModule } = (await import('./app.module')) as {
      AppModule: Type<unknown>;
    };

    try {
      moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue(asPrismaService(createMockPrisma()))
        .compile();
    } catch (error: unknown) {
      // Captured rather than rethrown so the failure is reported by the
      // assertion below WITH Nest's own message — which names the unresolvable
      // provider and the module it was requested from. A raw throw out of
      // `beforeAll` reports every test in the file as failed and buries it.
      compileError = error;
    }
  });

  afterAll(async () => {
    await moduleRef?.close();
    jest.useRealTimers();
  });

  it('resolves every provider in the real module graph', () => {
    // THE ASSERTION. A missing module import, a provider that is injected but
    // never registered, a guard whose dependencies are not visible from the
    // module that uses it — all of them land here, and only here.
    const message =
      compileError instanceof Error
        ? compileError.message
        : String(compileError);

    expect(compileError ? message : null).toBeNull();
    expect(moduleRef).toBeDefined();
  });

  it('produces a usable application context', () => {
    // Cheap corroboration that `compile()` returned a real container rather
    // than something that merely did not throw.
    expect(compileError).toBeUndefined();

    const context: INestApplicationContext = moduleRef;
    expect(typeof context.get).toBe('function');
    expect(moduleRef.get(PrismaService, { strict: false })).toBeDefined();
  });
});
