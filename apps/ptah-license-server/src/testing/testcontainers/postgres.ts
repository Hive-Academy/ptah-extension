/**
 * Testcontainers-backed PostgreSQL harness for integration specs.
 *
 * Starts a real `postgres:16-alpine` container, runs `prisma migrate
 * deploy` against it, and yields a connected Prisma client. Use this for
 * spec files that need real SQL semantics (window functions, constraint
 * behaviour, transaction isolation). Prefer the in-memory `MockPrisma`
 * factory for unit tests.
 *
 * **Dependency note**: `testcontainers` is not yet in the workspace's
 * package.json. We use a dynamic import + null-guard so this file
 * compiles and imports cleanly even when the package is missing. If the
 * caller runs `startPostgresContainer()` without the dep installed, we
 * throw a descriptive error rather than a module-resolution failure.
 *
 * Usage:
 * ```ts
 * const { prisma, stop } = await startPostgresContainer();
 * try {
 *   // run your spec against real Postgres
 * } finally {
 *   await stop();
 * }
 * ```
 */

import { execSync } from 'node:child_process';
import * as path from 'node:path';

/** Result of starting the container. */
export interface PostgresContainerHandle {
  /** The raw testcontainers container handle (opaque for callers). */
  container: unknown;
  /** Connection string for the running database. */
  connectionString: string;
  /**
   * A lazy-initialised Prisma client. Tests typically don't need the
   * real Prisma types here; the handle is exposed so integration specs
   * can wire it into their NestJS module via `useValue`.
   */
  prisma: unknown;
  /** Stop and dispose the container. Idempotent. */
  stop(): Promise<void>;
}

export interface StartPostgresOptions {
  /** Pinned image tag — keep in lock-step with production Postgres version. */
  image?: string;
  /** Database name inside the container. */
  databaseName?: string;
  /** Username inside the container. */
  username?: string;
  /** Password inside the container. */
  password?: string;
  /**
   * Absolute path to the Prisma schema to apply. Defaults to this app's
   * schema at `apps/ptah-license-server/prisma/schema.prisma`.
   */
  schemaPath?: string;
  /** Skip running `prisma migrate deploy` on startup. */
  skipMigrations?: boolean;
  /** Milliseconds to wait for Postgres readiness. */
  startupTimeoutMs?: number;
}

const DEFAULT_IMAGE = 'postgres:16-alpine';
const DEFAULT_DB = 'ptah_test';
const DEFAULT_USER = 'ptah_test';
const DEFAULT_PASSWORD = 'ptah_test_password';

/**
 * Start a pinned `postgres:16-alpine` container and run migrations.
 *
 * Uses a dynamic `require()` so the file compiles without the
 * `testcontainers` dependency installed. The error message on missing
 * dep is explicit so CI failures are actionable.
 */
export async function startPostgresContainer(
  options: StartPostgresOptions = {},
): Promise<PostgresContainerHandle> {
  const image = options.image ?? DEFAULT_IMAGE;
  const databaseName = options.databaseName ?? DEFAULT_DB;
  const username = options.username ?? DEFAULT_USER;
  const password = options.password ?? DEFAULT_PASSWORD;
  const startupTimeoutMs = options.startupTimeoutMs ?? 60_000;

  let testcontainers: {
    GenericContainer: new (image: string) => unknown;
  };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    testcontainers = require('testcontainers') as {
      GenericContainer: new (image: string) => unknown;
    };
  } catch (err) {
    throw new Error(
      `[startPostgresContainer] The 'testcontainers' package is not installed. ` +
        `Add it as a devDependency of the workspace before using this helper. ` +
        `Original error: ${(err as Error).message}`,
    );
  }

  // We bind late to avoid typing the whole testcontainers surface.
  interface TcContainer {
    withEnvironment(env: Record<string, string>): TcContainer;
    withExposedPorts(port: number): TcContainer;
    withStartupTimeout(ms: number): TcContainer;
    withWaitStrategy(strategy: unknown): TcContainer;
    start(): Promise<TcStartedContainer>;
  }
  interface TcStartedContainer {
    getHost(): string;
    getMappedPort(port: number): number;
    stop(): Promise<void>;
  }

  const GenericContainer = testcontainers.GenericContainer as unknown as new (
    image: string,
  ) => TcContainer;

  const builder = new GenericContainer(image)
    .withEnvironment({
      POSTGRES_DB: databaseName,
      POSTGRES_USER: username,
      POSTGRES_PASSWORD: password,
    })
    .withExposedPorts(5432)
    .withStartupTimeout(startupTimeoutMs);

  const started = await builder.start();
  const host = started.getHost();
  const port = started.getMappedPort(5432);
  const connectionString = `postgresql://${username}:${password}@${host}:${port}/${databaseName}?schema=public`;

  // Run Prisma migrations against the fresh DB.
  if (!options.skipMigrations) {
    const schemaPath =
      options.schemaPath ??
      path.resolve(__dirname, '..', '..', '..', 'prisma', 'schema.prisma');
    try {
      execSync(`npx prisma migrate deploy --schema="${schemaPath}"`, {
        env: { ...process.env, DATABASE_URL: connectionString },
        stdio: 'inherit',
      });
    } catch (err) {
      await started.stop();
      throw new Error(
        `[startPostgresContainer] prisma migrate deploy failed: ${(err as Error).message}`,
      );
    }
  }

  // Lazy prisma client — require it dynamically so the file doesn't
  // tie this helper's type graph to generated Prisma output.
  let prismaClient: unknown = null;
  let stopped = false;

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    try {
      if (
        prismaClient &&
        typeof (prismaClient as { $disconnect?: () => Promise<void> })
          .$disconnect === 'function'
      ) {
        await (
          prismaClient as { $disconnect: () => Promise<void> }
        ).$disconnect();
      }
    } finally {
      await started.stop();
    }
  };

  return {
    container: started,
    connectionString,
    get prisma(): unknown {
      if (prismaClient) return prismaClient;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { PrismaClient } =
          require('../../generated-prisma-client/client') as {
            PrismaClient: new (options: unknown) => unknown;
          };
        prismaClient = new PrismaClient({
          datasourceUrl: connectionString,
        });
      } catch (err) {
        throw new Error(
          `[startPostgresContainer] Unable to instantiate Prisma client: ${(err as Error).message}`,
        );
      }
      return prismaClient;
    },
    stop,
  };
}
