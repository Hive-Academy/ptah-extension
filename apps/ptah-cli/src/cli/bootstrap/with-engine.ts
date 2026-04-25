/**
 * `withEngine` — deterministic DI bootstrap + dispose helper.
 *
 * TASK_2026_104 Batch 4 (Discovery D12, implementation-plan.md § 7).
 *
 * Every CLI command from Batch 5 onward calls `withEngine(globals, { mode },
 * fn)` to bootstrap the DI container, run its work inside `fn`, and tear the
 * container down deterministically in `finally` — including the throw path.
 *
 * The helper is intentionally small and dependency-light:
 *   - It does not import commander, the formatter, or the JSON-RPC server.
 *   - It does not own the event-pipe wiring; the caller subscribes to
 *     `ctx.pushAdapter` if it wants notifications streamed to stdout.
 *   - The `bootstrap` function pointer is overridable (tests pass a fake) so
 *     the spec can exercise minimal/full + dispose ordering without paying
 *     the real DI bootstrap cost.
 */

import type { DependencyContainer } from 'tsyringe';

// Type-only imports — we lazy-load the real `CliDIContainer` value inside
// `withEngine` so test runners (ts-jest) do not eagerly compile the entire
// DI module graph at spec-load time. Tests inject a `bootstrap` override
// and never touch the production class.
import type {
  CliBootstrapOptions,
  CliBootstrapResult,
} from '../../di/container.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';
import type { CliWebviewManagerAdapter } from '../../transport/cli-webview-manager-adapter.js';

/** Subset of resolved `GlobalOptions` `withEngine` cares about. */
export interface WithEngineGlobals {
  /** When true, propagated to `CliBootstrapOptions.verbose` for `debug.di.phase` events. */
  verbose?: boolean;
  /** Override workspace path (matches `--cwd`). */
  cwd?: string;
  /** Override config file path (matches `--config`). */
  config?: string;
}

export interface WithEngineOptions {
  /** Bootstrap depth — `'minimal'` skips Phase 4.x; `'full'` registers all RPC handlers. */
  mode: 'minimal' | 'full';
  /**
   * Override hook for tests — replaces `CliDIContainer.setup`. Production
   * callers omit this; the default invokes the real bootstrap.
   */
  bootstrap?: (options: CliBootstrapOptions) => CliBootstrapResult;
  /**
   * Override hook for tests — replaces the dispose path. Production callers
   * omit this; the default calls `container.clearInstances()` and disposes
   * the push adapter's listener set.
   */
  dispose?: (ctx: EngineContext) => void | Promise<void>;
}

/** Context passed to the user-supplied work function. */
export interface EngineContext {
  container: DependencyContainer;
  transport: CliMessageTransport;
  pushAdapter: CliWebviewManagerAdapter;
}

/**
 * Bootstrap the DI container, run `fn(ctx)`, dispose deterministically.
 *
 * - On success: `fn`'s resolved value is returned, dispose runs, value is
 *   delivered to the caller.
 * - On throw: dispose runs in the `finally`, the original error is re-thrown
 *   without modification.
 *
 * The dispose step never throws. If a user-supplied `dispose` override
 * rejects, the rejection is swallowed and logged to stderr; the original
 * error (if any) takes precedence in the surface.
 */
export async function withEngine<T>(
  globals: WithEngineGlobals,
  opts: WithEngineOptions,
  fn: (ctx: EngineContext) => Promise<T>,
): Promise<T> {
  const bootstrap = opts.bootstrap ?? (await loadDefaultBootstrap());

  const bootOptions: CliBootstrapOptions = {
    bootstrapMode: opts.mode,
    verbose: globals.verbose === true,
  };
  if (globals.cwd !== undefined) bootOptions.workspacePath = globals.cwd;

  const result = bootstrap(bootOptions);
  const ctx: EngineContext = {
    container: result.container,
    transport: result.transport,
    pushAdapter: result.pushAdapter,
  };

  try {
    return await fn(ctx);
  } finally {
    await runDispose(opts, ctx);
  }
}

/**
 * Lazy ESM import of the real DI container. Production callers hit this
 * path; tests inject `opts.bootstrap` and never load the heavy module graph.
 */
async function loadDefaultBootstrap(): Promise<
  (options: CliBootstrapOptions) => CliBootstrapResult
> {
  const mod = await import('../../di/container.js');
  return mod.CliDIContainer.setup.bind(mod.CliDIContainer);
}

/**
 * Default dispose path — clear the global tsyringe registry and remove all
 * listeners from the push adapter. Symmetric with `CliDIContainer.setup`,
 * which uses the global container; tests may pass their own dispose to
 * scope cleanup to a sub-container.
 */
function defaultDispose(ctx: EngineContext): void {
  try {
    ctx.pushAdapter.removeAllListeners();
  } catch {
    /* swallow — adapter cleanup is best-effort */
  }
  try {
    ctx.container.clearInstances();
  } catch {
    /* swallow — container cleanup is best-effort */
  }
}

async function runDispose(
  opts: WithEngineOptions,
  ctx: EngineContext,
): Promise<void> {
  const dispose = opts.dispose ?? defaultDispose;
  try {
    await dispose(ctx);
  } catch (disposeError) {
    // Surface dispose errors to stderr so they are visible in CI logs but do
    // not mask the original `fn` error (if any). The `finally` path here
    // returns void; callers see only the original throw.
    process.stderr.write(
      `[ptah] dispose failed: ${
        disposeError instanceof Error
          ? disposeError.message
          : String(disposeError)
      }\n`,
    );
  }
}
