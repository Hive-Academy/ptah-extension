/**
 * Boots the CLI DI container and serves the code-execution HTTP MCP from it,
 * inside a process the bench launcher isolated. Shared by the `cli-headless`
 * bench host (`bench-host.entry.ts`) and by other bench host scripts that need
 * the same engine with seeded state or replaced services (TASK_2026_620's
 * memory-skills host).
 *
 * Boot order, each step awaited before the next:
 *   1. `assertIsolatedEnvironment()`: refuse unless every state path is inside
 *      the launcher's temp home.
 *   2. `beforeEngineBoot(context)`: no engine exists yet; seed fixtures into
 *      the isolated home here.
 *   3. `withEngine` full boot (`mode: 'full'`, `requireSdk: false`,
 *      `thoth: 'oneshot'`), then the `TOKENS.CODE_EXECUTION_MCP` check.
 *   4. `afterContainerReady(container, context)`: the container is resolved
 *      and the MCP server is NOT listening yet, so a registration made here
 *      (for example a record/replay double for a curator or lane runner) is in
 *      place before any tool call can arrive.
 *   5. `ptah.mcpPort = 0` in the isolated config, `startCodeExecutionMcp`, and
 *      the `getPort()` check.
 *
 * Failure: any step that throws rejects `bootCodeExecutionHost` with a
 * {@link BenchIsolationError} (step 1) or a {@link BenchHostBootError} naming
 * the step. A failure after step 3 began rejects only once the `withEngine`
 * teardown has finished, so no engine is left running; the MCP server is never
 * started after a failed hook. This module never calls `process.exit`: exit
 * codes and the wire lines belong to the host script.
 *
 * Shutdown: `handle.stop()` disposes the MCP server under a drain timeout and
 * resolves only after the `withEngine` teardown has finished (the teardown
 * stays inside `withEngine`: `stop()` releases the callback it awaits).
 *
 * Known shutdown crash (TASK_2026_619 Task 4d.1, a product finding): after a
 * run that wrote embeddings into the sqlite-vec `vec0` tables, the engine
 * teardown's `SqliteConnectionService.close()` dies in its
 * `wal_checkpoint(TRUNCATE)` with the fail-fast status 0xC0000409 in about
 * half the runs on win32. The teardown order here is not the cause (leaving the
 * connection open still crashes at exit, in better-sqlite3's own cleanup), so
 * the launcher classifies it as `crash-on-shutdown` instead.
 *
 * Diagnostics: {@link BENCH_BISECT_ENV} turns single subsystems off in this
 * bench host only, or traces the teardown steps, to attribute a shutdown
 * crash. The launcher never sets it.
 */

import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

import {
  CliDIContainer,
  withEngine,
  type CliBootstrapOptions,
  type CliBootstrapResult,
} from '@ptah-extension/cli-engine';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import {
  TOKENS,
  startCodeExecutionMcp,
  type Logger,
} from '@ptah-extension/vscode-core';
import type { DependencyContainer } from 'tsyringe';

import { isPathInside, isSamePath } from '../bench-data';

/** State paths the launcher isolated; all lie inside `home`. */
export interface IsolatedPaths {
  /** `PTAH_BENCH_ISOLATED_HOME`, which `os.homedir()` must resolve to. */
  readonly home: string;
  /** `PTAH_CONFIG_PATH`: the Ptah data directory (`withEngine` `config`). */
  readonly userDataPath: string;
  /** `PTAH_DB_PATH`: the SQLite file the engine opens. */
  readonly dbPath: string;
}

/** The DI container the engine booted (tsyringe). */
export type BenchHostContainer = DependencyContainer;

/** What `beforeEngineBoot` receives. No engine or container exists yet. */
export interface BeforeEngineBootContext {
  /** Absolute workspace the engine will serve. */
  readonly workspace: string;
  readonly isolation: IsolatedPaths;
}

/**
 * Runs after the isolation check and before the engine boots. Seed fixtures
 * into the isolated home here (`isolation.userDataPath`, `isolation.dbPath`).
 * A throw (or rejection) aborts the boot with a `BenchHostBootError` of step
 * `beforeEngineBoot`; the engine is never started.
 */
export type BeforeEngineBootHook = (
  context: BeforeEngineBootContext,
) => void | Promise<void>;

/** What `afterContainerReady` receives besides the container. */
export interface AfterContainerReadyContext {
  /** The workspace root the engine reports (falls back to the requested one). */
  readonly workspaceRoot: string;
  readonly isolation: IsolatedPaths;
}

/**
 * Runs once the container is booted and `TOKENS.CODE_EXECUTION_MCP` is
 * registered, before the MCP server is started. Replace or register services
 * here (for example `container.register(TOKEN, { useValue: double })`).
 * A throw (or rejection) aborts the boot with a `BenchHostBootError` of step
 * `afterContainerReady`, after the engine teardown; the MCP server never starts.
 */
export type AfterContainerReadyHook = (
  container: BenchHostContainer,
  context: AfterContainerReadyContext,
) => void | Promise<void>;

export interface BootCodeExecutionHostOptions {
  /** Absolute workspace (corpus) root the MCP server serves. */
  readonly workspace: string;
  readonly beforeEngineBoot?: BeforeEngineBootHook;
  readonly afterContainerReady?: AfterContainerReadyHook;
}

/** A booted host. Its MCP server is listening on `port`. */
export interface BenchHostHandle {
  readonly port: number;
  readonly workspaceRoot: string;
  readonly isolation: IsolatedPaths;
  readonly container: BenchHostContainer;
  /**
   * Dispose the MCP server (bounded by the drain timeout), then let the
   * `withEngine` teardown run; resolves once it has finished. Idempotent.
   * Rejects only when the engine's own teardown path rejects.
   */
  stop(): Promise<void>;
}

/** The boot step a {@link BenchHostBootError} came from. */
export type BenchHostBootStep =
  | 'options'
  | 'beforeEngineBoot'
  | 'engine-boot'
  | 'afterContainerReady'
  | 'mcp-start';

/** The launcher did not isolate this process; the host refuses to boot. */
export class BenchIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BenchIsolationError';
  }
}

/** A boot step failed; the engine (if it had started) was torn down. */
export class BenchHostBootError extends Error {
  constructor(
    message: string,
    readonly step: BenchHostBootStep,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'BenchHostBootError';
  }
}

/** The slice of `CodeExecutionMCP` the host drives (structural, as subsystem-bringup does). */
interface CodeExecutionMcpHandle {
  getPort(): number | null;
  disposeAsync(): Promise<void>;
}

interface WorkspaceProviderHandle {
  getWorkspaceRoot(): string | undefined;
  setConfiguration(section: string, key: string, value: unknown): Promise<void>;
}

/** Overrides for the isolation check; production callers pass none. */
export interface IsolationProbe {
  /** The home this process resolves. Default `os.homedir()`. */
  readonly homedir?: string;
  /** Case folding and path semantics. Default `process.platform`. */
  readonly platform?: NodeJS.Platform;
}

export const ENGINE_DRAIN_TIMEOUT_MS = 10_000;

/**
 * Comma-separated {@link BenchBisectFlag}s. A diagnostic for this bench host
 * only, never set by the launcher: each flag turns one subsystem off (or
 * traces the teardown) so a shutdown crash can be attributed. An unknown flag
 * refuses the boot (step `options`). With no flag the boot is unchanged.
 */
export const BENCH_BISECT_ENV = 'PTAH_BENCH_BISECT';

/**
 * - `no-embedder`: the embedder worker factory throws, so no onnxruntime
 *   worker thread starts and no embedding is written (search runs BM25-only).
 * - `no-sqlite-vec`: the sqlite-vec extension is not loaded (no `vec0`
 *   tables, so no vector writes either).
 * - `no-sqlite-close`: the engine's SQLite close is skipped, leaving the
 *   connection to better-sqlite3's own cleanup at `process.exit`.
 * - `trace`: stderr markers around the MCP dispose, the embedder dispose, the
 *   close's WAL checkpoint (run on its own first) and the close itself.
 */
export type BenchBisectFlag =
  'no-embedder' | 'no-sqlite-vec' | 'no-sqlite-close' | 'trace';

const BISECT_FLAGS: readonly BenchBisectFlag[] = [
  'no-embedder',
  'no-sqlite-vec',
  'no-sqlite-close',
  'trace',
];

function traceStep(flags: ReadonlySet<BenchBisectFlag>, step: string): void {
  if (flags.has('trace')) process.stderr.write(`[bench-host] trace ${step}\n`);
}

// The registration keys `register-thoth-libraries.ts` uses, by `Symbol.for`
// (as `with-engine.ts` does) so this module stays off those libs' imports.
const EMBEDDER_WORKER_PROCESS_FACTORY = Symbol.for(
  'PtahEmbedderWorkerProcessFactory',
);
const SQLITE_CONNECTION = Symbol.for('PtahSqliteConnection');
const EMBEDDER = Symbol.for('PtahEmbedder');

interface EmbedderHandle {
  dispose(): Promise<void>;
}

interface EmbedderWorkerFactoryHandle {
  spawn(): unknown;
}

interface SqliteConnectionHandle {
  configure(options: { vecPathResolver?: null }): void;
  close(): void;
  readonly isOpen: boolean;
  readonly db: { pragma(source: string): unknown };
}

/** Parse {@link BENCH_BISECT_ENV}; throws a step `options` error on an unknown flag. */
export function readBisectFlags(
  env: NodeJS.ProcessEnv = process.env,
): ReadonlySet<BenchBisectFlag> {
  const raw = env[BENCH_BISECT_ENV] ?? '';
  const flags = new Set<BenchBisectFlag>();
  for (const item of raw.split(',')) {
    const name = item.trim();
    if (name === '') continue;
    const flag = BISECT_FLAGS.find((known) => known === name);
    if (flag === undefined) {
      throw new BenchHostBootError(
        `${BENCH_BISECT_ENV}: unknown flag ${name} (known: ${BISECT_FLAGS.join(', ')})`,
        'options',
      );
    }
    flags.add(flag);
  }
  return flags;
}

/** The CLI bootstrap with the bisect flags applied before Thoth opens the DB. */
function bisectBootstrap(
  flags: ReadonlySet<BenchBisectFlag>,
): (options: CliBootstrapOptions) => CliBootstrapResult {
  return (options) => {
    const result = CliDIContainer.setup(options);
    const container = result.container;
    if (
      flags.has('no-embedder') &&
      container.isRegistered(EMBEDDER_WORKER_PROCESS_FACTORY)
    ) {
      // The embedder client is a singleton the bootstrap has already built
      // around this factory instance, so the instance itself is switched off
      // (a re-registration would reach no one).
      const factory = container.resolve<EmbedderWorkerFactoryHandle>(
        EMBEDDER_WORKER_PROCESS_FACTORY,
      );
      factory.spawn = (): never => {
        throw new Error(`disabled by ${BENCH_BISECT_ENV}=no-embedder`);
      };
    }
    if (flags.has('trace') && container.isRegistered(EMBEDDER)) {
      const embedder = container.resolve<EmbedderHandle>(EMBEDDER);
      const dispose = embedder.dispose.bind(embedder);
      embedder.dispose = async (): Promise<void> => {
        traceStep(flags, 'embedder dispose begins');
        await dispose();
        traceStep(flags, 'embedder dispose done');
      };
    }
    if (container.isRegistered(SQLITE_CONNECTION)) {
      const connection =
        container.resolve<SqliteConnectionHandle>(SQLITE_CONNECTION);
      if (flags.has('no-sqlite-vec')) {
        connection.configure({ vecPathResolver: null });
      }
      const close = connection.close.bind(connection);
      connection.close = (): void => {
        if (flags.has('no-sqlite-close')) return;
        if (flags.has('trace') && connection.isOpen) {
          // Split the close: its WAL checkpoint first, on its own.
          traceStep(flags, 'sqlite wal_checkpoint(TRUNCATE) begins');
          connection.db.pragma('wal_checkpoint(TRUNCATE)');
          traceStep(flags, 'sqlite wal_checkpoint(TRUNCATE) done');
        }
        traceStep(flags, 'sqlite close begins');
        close();
        traceStep(flags, 'sqlite close done');
      };
    }
    return result;
  };
}

/**
 * Refuse to run unless every state path is inside the launcher's temp home:
 * `PTAH_BENCH_ISOLATED_HOME`, `PTAH_CONFIG_PATH` and `PTAH_DB_PATH` set,
 * `os.homedir()` equal to the isolated home, and the config and DB paths
 * strictly inside it (case-insensitive on win32). Throws {@link BenchIsolationError}.
 */
export function assertIsolatedEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  probe: IsolationProbe = {},
): IsolatedPaths {
  const platform = probe.platform ?? process.platform;
  const home = env['PTAH_BENCH_ISOLATED_HOME'];
  const userDataPath = env['PTAH_CONFIG_PATH'];
  const dbPath = env['PTAH_DB_PATH'];
  if (!home || !userDataPath || !dbPath) {
    throw new BenchIsolationError(
      'refusing to boot: PTAH_BENCH_ISOLATED_HOME, PTAH_CONFIG_PATH and PTAH_DB_PATH must all be set by the launcher',
    );
  }
  const currentHome = probe.homedir ?? homedir();
  if (!isSamePath(currentHome, home, platform)) {
    throw new BenchIsolationError(
      `refusing to boot: os.homedir() is ${currentHome}, not the isolated home ${home}`,
    );
  }
  if (
    !isPathInside(userDataPath, home, platform) ||
    !isPathInside(dbPath, home, platform)
  ) {
    throw new BenchIsolationError(
      'refusing to boot: PTAH_CONFIG_PATH and PTAH_DB_PATH must lie inside the isolated home',
    );
  }
  return { home, userDataPath, dbPath };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runStep<T>(
  step: BenchHostBootStep,
  work: () => T | Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error: unknown) {
    if (error instanceof BenchHostBootError) throw error;
    throw new BenchHostBootError(
      `bench host boot failed in ${step}: ${messageOf(error)}`,
      step,
      { cause: error },
    );
  }
}

async function withTimeout(work: Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      work,
      new Promise<void>((done) => {
        timer = setTimeout(done, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Isolation check, hooks, engine boot and MCP start in the order in the module
 * header. Resolves with a handle once the MCP server listens.
 */
export async function bootCodeExecutionHost(
  options: BootCodeExecutionHostOptions,
): Promise<BenchHostHandle> {
  const isolation = assertIsolatedEnvironment();
  if (!isAbsolute(options.workspace)) {
    throw new BenchHostBootError(
      `workspace must be an absolute directory, got ${options.workspace}`,
      'options',
    );
  }
  const workspace = resolve(options.workspace);
  const bisect = readBisectFlags();

  await runStep('beforeEngineBoot', () =>
    options.beforeEngineBoot?.({ workspace, isolation }),
  );

  let released!: () => void;
  const stopRequested = new Promise<void>((done) => {
    released = done;
  });
  let announce!: (handle: BenchHostHandle) => void;
  let abort!: (error: unknown) => void;
  const booted = new Promise<BenchHostHandle>((done, fail) => {
    announce = done;
    abort = fail;
  });

  let stopping: Promise<void> | undefined;
  const engine = withEngine(
    { cwd: workspace, config: isolation.userDataPath },
    // `oneshot` opens and migrates the (isolated) SQLite file so the symbol
    // and memory layers resolve, without the cron loop, the gateway or the
    // memory triggers a bench run must not start.
    {
      mode: 'full',
      requireSdk: false,
      thoth: 'oneshot',
      ...(bisect.size > 0 ? { bootstrap: bisectBootstrap(bisect) } : {}),
    },
    async (ctx) => {
      const container = ctx.container;
      if (!container.isRegistered(TOKENS.CODE_EXECUTION_MCP)) {
        throw new BenchHostBootError(
          'BLOCKER: TOKENS.CODE_EXECUTION_MCP is not registered in the CLI container',
          'engine-boot',
        );
      }
      const logger = container.resolve<Logger>(TOKENS.LOGGER);
      const workspaceProvider = container.resolve<WorkspaceProviderHandle>(
        PLATFORM_TOKENS.WORKSPACE_PROVIDER,
      );
      const workspaceRoot = workspaceProvider.getWorkspaceRoot() ?? workspace;

      await runStep('afterContainerReady', () =>
        options.afterContainerReady?.(container, { workspaceRoot, isolation }),
      );

      const mcp = await runStep('mcp-start', async () => {
        // Port 0: the OS picks a free port, so a running desktop Ptah holding
        // 51820 is never displaced and never answers in our place. Written to
        // the isolated config only.
        await workspaceProvider.setConfiguration('ptah', 'mcpPort', 0);
        await startCodeExecutionMcp({ container, logger });
        return container.resolve<CodeExecutionMcpHandle>(
          TOKENS.CODE_EXECUTION_MCP,
        );
      });
      const port = mcp.getPort();
      if (port === null) {
        // `startCodeExecutionMcp` never throws; its warning is on stderr.
        throw new BenchHostBootError(
          'the code-execution MCP server did not start (see stderr)',
          'mcp-start',
        );
      }

      announce({
        port,
        workspaceRoot,
        isolation,
        container,
        stop: () => {
          stopping ??= (async () => {
            released();
            await engine;
            traceStep(bisect, 'withEngine teardown done');
          })();
          return stopping;
        },
      });
      await stopRequested;
      traceStep(bisect, 'mcp dispose begins');
      await withTimeout(mcp.disposeAsync(), ENGINE_DRAIN_TIMEOUT_MS);
      traceStep(bisect, 'mcp dispose done; withEngine teardown begins');
    },
  );
  // Settles `booted` when the engine ends without announcing: the callback
  // threw (after the teardown), or the bootstrap itself failed. After the
  // announce both calls are no-ops; `stop()` awaits `engine` itself.
  engine.then(
    () =>
      abort(
        new BenchHostBootError(
          'the engine ended before the MCP server was ready',
          'engine-boot',
        ),
      ),
    (error: unknown) =>
      abort(
        error instanceof BenchHostBootError
          ? error
          : new BenchHostBootError(
              `bench host boot failed in engine-boot: ${messageOf(error)}`,
              'engine-boot',
              { cause: error },
            ),
      ),
  );
  return booted;
}
