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

import {
  CliDIContainer,
  type CliBootstrapOptions,
  type CliBootstrapResult,
} from '../../di/container.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';
import type { CliWebviewManagerAdapter } from '../../transport/cli-webview-manager-adapter.js';
import { emitFatalError } from '../output/stderr-json.js';

/**
 * Lightweight contract for the SDK agent adapter as resolved out of the DI
 * container. We only need the lifecycle hooks here — the streaming surface
 * lives on the same instance but is consumed elsewhere.
 *
 * Mirrors the slice used by `apps/ptah-electron/src/activation/bootstrap.ts`
 * so the CLI initialization path stays symmetric with Electron.
 */
interface SdkAgentLifecycle {
  initialize(): Promise<boolean>;
  dispose?(): void | Promise<void>;
}

/**
 * Symbol token for the agent adapter binding registered by
 * `CliDIContainer.setup`. Resolved here as `Symbol.for('AgentAdapter')` rather
 * than imported from `@ptah-extension/vscode-core` to keep `with-engine.ts`
 * dependency-light (tests mock the bootstrap entirely and never reach this
 * resolution path).
 */
const AGENT_ADAPTER_TOKEN = Symbol.for('AgentAdapter');

/**
 * Symbol token for the SDK permission handler binding registered by
 * `registerSdkServices` (see `libs/backend/agent-sdk/src/lib/di/tokens.ts`
 * — `SDK_TOKENS.SDK_PERMISSION_HANDLER`). Resolved by `Symbol.for(...)` to
 * keep `with-engine.ts` dependency-light, mirroring `AGENT_ADAPTER_TOKEN`.
 *
 * Used by the `--auto-approve` / `PTAH_AUTO_APPROVE=true` wiring (Bug 2 in
 * PTAH_CLI_BUGS.md) to elevate the permission level to `'yolo'` post DI
 * bootstrap so headless `ptah run` / `ptah session start` invocations don't
 * hang at the `canUseTool` gate waiting for a webview that never connects.
 */
const SDK_PERMISSION_HANDLER_TOKEN = Symbol.for('SdkPermissionHandler');

/**
 * Permission level union accepted by `SdkPermissionHandler.setPermissionLevel`.
 * Mirrors `PermissionLevel` from `@ptah-extension/shared`
 * (`libs/shared/src/lib/types/model-autopilot.types.ts`) — kept inline here
 * to preserve `with-engine.ts`'s zero-shared-imports posture.
 */
type PermissionLevelLite = 'ask' | 'auto-edit' | 'yolo' | 'plan';

/**
 * Lightweight contract for the SDK permission handler as resolved out of the
 * DI container. We only need `setPermissionLevel` here; the rest of the
 * surface (canUseTool callback factory, rule store, request emitter) is
 * consumed elsewhere.
 */
interface SdkPermissionHandlerLifecycle {
  setPermissionLevel(level: PermissionLevelLite): void;
}

/** Subset of resolved `GlobalOptions` `withEngine` cares about. */
export interface WithEngineGlobals {
  /** When true, propagated to `CliBootstrapOptions.verbose` for `debug.di.phase` events. */
  verbose?: boolean;
  /** Override workspace path (matches `--cwd`). */
  cwd?: string;
  /** Override config file path (matches `--config`). */
  config?: string;
  /**
   * When true (matches `--auto-approve` global flag), the SDK permission
   * handler's level is elevated to `'yolo'` after DI bootstrap so unattended
   * runs (e.g. `ptah --auto-approve run --task "..."`) don't hang at the
   * `canUseTool` gate waiting for a webview response that will never arrive.
   *
   * The env var `PTAH_AUTO_APPROVE=true` is honored with the same semantics
   * (parity with `approval-bridge.ts`).
   */
  autoApprove?: boolean;
}

export interface WithEngineOptions {
  /** Bootstrap depth — `'minimal'` skips Phase 4.x; `'full'` registers all RPC handlers. */
  mode: 'minimal' | 'full';
  /**
   * When `false`, skip the SDK agent adapter `initialize()` step under
   * `mode === 'full'`. Defaults to `true` for backward compatibility.
   *
   * Auth-bootstrap commands (`ptah provider set-key`, `ptah auth login`,
   * `ptah config ...`) need the full DI graph (Phase 4 RPC registration) but
   * MUST run before auth is configured. Without this opt-out, `initialize()`
   * returns `false` and `withEngine` throws `sdk_init_failed`, making it
   * impossible to bootstrap auth via the CLI (chicken-and-egg).
   *
   * Commands that actually exercise the agent (chat, session, run,
   * execute-spec, interact) should leave this unset / `true`.
   */
  requireSdk?: boolean;
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
  const bootstrap = opts.bootstrap ?? defaultBootstrap;

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

  // ---- P0 Fix 1: initialize the SDK agent adapter under `mode === 'full'` --
  //
  // Without this, `chat:start` RPCs throw `SdkAgentAdapter not initialized`
  // inside the chat-session service, the throw is swallowed by an inner
  // catch, and `ptah session start` / `ptah interact + task.submit` hang
  // forever waiting for events that will never arrive.
  //
  // Mirrors `apps/ptah-electron/src/activation/bootstrap.ts:240`. We only run
  // this for `'full'` because `'minimal'` skips Phase 4.x RPC registrations
  // and is used by introspection commands (e.g. `--help`, `--version`,
  // metadata-only queries) that never hit the chat surface.
  let sdkAdapter: SdkAgentLifecycle | undefined;
  if (opts.mode === 'full' && opts.requireSdk !== false) {
    try {
      sdkAdapter =
        ctx.container.resolve<SdkAgentLifecycle>(AGENT_ADAPTER_TOKEN);
    } catch (resolveErr) {
      // Container did not register the adapter (older bootstrap variants or
      // a partial test harness). Treat as a non-recoverable init failure so
      // JSON-RPC clients see a deterministic error instead of a hang.
      const message =
        resolveErr instanceof Error ? resolveErr.message : String(resolveErr);
      await runDispose(opts, ctx);
      throw new SdkInitFailedError(message);
    }

    if (globals.verbose === true) {
      // Dev-mode breadcrumb confirming the bootstrap path actually reached
      // `initialize()`. Visible only with `--verbose`; never on the default
      // hot path.
      process.stderr.write('[ptah] withEngine: initializing SDK adapter\n');
    }

    let initialized = false;
    let initErrorMessage: string | undefined;
    try {
      initialized = await sdkAdapter.initialize();
    } catch (initErr) {
      initErrorMessage =
        initErr instanceof Error ? initErr.message : String(initErr);
    }

    if (!initialized) {
      const message =
        initErrorMessage ??
        'SDK agent adapter initialize() returned false (auth not configured)';
      // Emit the structured stderr NDJSON line BEFORE we tear down so
      // supervisors per cli-shift.md see the deterministic error code even
      // if the JSON-RPC stdout channel is closed.
      emitFatalError('sdk_init_failed', message, {
        command: 'engine.bootstrap',
        bootstrap_mode: opts.mode,
      });
      // Symmetric teardown — `initialize()` may have partially mutated
      // adapter state. The container clear + push-adapter listener cleanup
      // run before we propagate so the caller doesn't observe a half-booted
      // engine.
      await runDispose(opts, ctx);
      throw new SdkInitFailedError(message);
    }
  }

  // ---- Bug 2 Fix: wire `--auto-approve` / `PTAH_AUTO_APPROVE` to YOLO -----
  //
  // The `--auto-approve` global flag (router.ts:188) was resolved into
  // `globals.autoApprove` (router.ts:94) but no code path consulted it to
  // elevate the SdkPermissionHandler's permission level. Tools outside the
  // safe-tool whitelist hung indefinitely at the `canUseTool` gate waiting
  // for a webview response that never arrives in headless mode.
  //
  // We wire post DI Phase 4 RPC registration AND post `SdkAgentAdapter.
  // initialize()` so the permission handler singleton is guaranteed to be
  // resolvable. The handler is only registered in `'full'` mode bootstrap
  // (via `registerSdkServices`); `'minimal'` skips Phase 4 entirely.
  //
  // The env var `PTAH_AUTO_APPROVE=true` is honored with the same semantics
  // for parity with `approval-bridge.ts` (which already consults it).
  //
  // Refs: PTAH_CLI_BUGS.md Bug 2.
  if (opts.mode === 'full') {
    const autoApproveRequested =
      globals.autoApprove === true ||
      process.env['PTAH_AUTO_APPROVE'] === 'true';

    if (autoApproveRequested) {
      try {
        const permissionHandler =
          ctx.container.resolve<SdkPermissionHandlerLifecycle>(
            SDK_PERMISSION_HANDLER_TOKEN,
          );
        permissionHandler.setPermissionLevel('yolo');
        if (globals.verbose === true) {
          process.stderr.write(
            '[ptah] withEngine: auto-approve enabled, permission level set to yolo\n',
          );
        }
      } catch (resolveErr) {
        // Resolving the permission handler should never fail in `'full'`
        // mode bootstrap (registerSdkServices runs unconditionally), but
        // surface a stderr breadcrumb instead of crashing — the command
        // body can still execute; tools will simply hit the default `'ask'`
        // gate as before this fix.
        const message =
          resolveErr instanceof Error ? resolveErr.message : String(resolveErr);
        process.stderr.write(
          `[ptah] withEngine: failed to resolve SdkPermissionHandler for auto-approve: ${message}\n`,
        );
      }
    }
  }

  try {
    return await fn(ctx);
  } finally {
    // Dispose the SDK adapter symmetrically with `initialize()` — mirrors the
    // electron shutdown path. Errors here are swallowed; the user-supplied
    // `dispose` and `clearInstances()` still run below.
    if (sdkAdapter && typeof sdkAdapter.dispose === 'function') {
      try {
        await sdkAdapter.dispose();
      } catch (disposeErr) {
        process.stderr.write(
          `[ptah] sdk adapter dispose failed: ${
            disposeErr instanceof Error
              ? disposeErr.message
              : String(disposeErr)
          }\n`,
        );
      }
    }
    await runDispose(opts, ctx);
  }
}

/**
 * Tagged error thrown by `withEngine` when `initialize()` returns false or
 * throws under `mode === 'full'`. Carries the `ptah_code: 'sdk_init_failed'`
 * marker that command-level catch blocks (e.g. `session.execute`) can pattern-
 * match on to emit a deterministic JSON-RPC `task.error` notification instead
 * of the generic `internal_failure` fallback.
 */
export class SdkInitFailedError extends Error {
  readonly ptahCode = 'sdk_init_failed' as const;
  constructor(message: string) {
    super(message);
    this.name = 'SdkInitFailedError';
  }
}

function defaultBootstrap(options: CliBootstrapOptions): CliBootstrapResult {
  return CliDIContainer.setup(options);
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
