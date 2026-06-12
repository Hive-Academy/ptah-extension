/**
 * `withEngine` — deterministic DI bootstrap + dispose helper.
 *
 * Every CLI command calls `withEngine(globals, { mode }, fn)` to bootstrap
 * the DI container, run its work inside `fn`, and tear the container down
 * deterministically in `finally` — including the throw path.
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
} from '../container.js';
import type { CliMessageTransport } from '../transport/cli-message-transport.js';
import type { CliWebviewManagerAdapter } from '../transport/cli-webview-manager-adapter.js';
import { emitFatalError } from '../output/stderr-json.js';
import { SETTINGS_TOKENS } from '@ptah-extension/settings-core';
import type { MigrationRunner } from '@ptah-extension/settings-core';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  activateThoth,
  disposeThoth,
  type ThothRefs,
  type ThothTierOption,
} from './thoth-runtime.js';

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
  getHealth?(): { errorMessage?: string } | undefined;
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
 * Used by the `--auto-approve` / `PTAH_AUTO_APPROVE=true` wiring to elevate
 * the permission level to `'yolo'` post DI bootstrap so headless `ptah run` /
 * `ptah session start` invocations don't hang at the `canUseTool` gate
 * waiting for a webview that never connects.
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

/**
 * Symbol token for the workspace provider binding registered by
 * `CliDIContainer.setup`. Resolved by `Symbol.for('WorkspaceProvider')` to
 * match `PLATFORM_TOKENS.WORKSPACE_PROVIDER` from `@ptah-extension/platform-core`
 * without taking a dependency on that import here.
 *
 * Used by the `authMethod` value migration shim (CLI bug batch item #12) to
 * normalize legacy camelCase tokens (`'claudeCli'`) to their kebab-case
 * canonical form (`'claude-cli'`) on bootstrap.
 */
const WORKSPACE_PROVIDER_TOKEN = Symbol.for('WorkspaceProvider');

/**
 * Symbol token for the Logger binding registered by `CliDIContainer.setup`
 * (`TOKENS.LOGGER` from `@ptah-extension/vscode-core`). Resolved by
 * `Symbol.for('Logger')` to keep `with-engine.ts` dependency-light, matching
 * `AGENT_ADAPTER_TOKEN`. Passed into `activateThoth`/`disposeThoth` for the
 * structured per-subsystem degradation warnings.
 */
const LOGGER_TOKEN = Symbol.for('Logger');

/**
 * Lightweight read/write contract for the workspace provider as resolved out
 * of the DI container. Mirrors the slice used by the auth + config commands
 * without pulling in the full `IWorkspaceProvider` interface, which carries
 * VS Code-specific overloads we never exercise from the CLI.
 */
interface WorkspaceProviderLite {
  getConfiguration<T>(
    section: string,
    key: string,
    defaultValue?: T,
  ): T | undefined;
  setConfiguration?(
    section: string,
    key: string,
    value: unknown,
  ): Promise<void>;
}

/** Subset of resolved `GlobalOptions` `withEngine` cares about. */
export interface WithEngineGlobals {
  /** When true, propagated to `CliBootstrapOptions.verbose` for `debug.di.phase` events. */
  verbose?: boolean;
  /** Override workspace path (matches `--cwd`). */
  cwd?: string;
  /** Override Ptah data directory (matches `--config <dir>`). */
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
   * Thoth activation tier (default `'off'`). `'off'` opens no SQLite handle —
   * plain commands pay nothing. `'oneshot'` runs `openAndMigrate()` only so
   * store-backed commands and memory injection work. `'runtime'` additionally
   * starts triggers, the cron loop, and gateway adapters for long-running
   * hosts (`ptah interact`, interactive `ptah session start`).
   */
  thoth?: ThothTierOption;
  pushAdapter?: CliWebviewManagerAdapter;
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
  /**
   * Thoth lifecycle handles populated when `opts.thoth !== 'off'`. Undefined
   * for plain commands. Disposed LIFO in `withEngine`'s `finally` before the
   * container teardown.
   */
  thothRefs?: ThothRefs;
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
  if (opts.pushAdapter !== undefined)
    bootOptions.pushAdapter = opts.pushAdapter;
  const ptahDirOverride =
    globals.config ?? process.env['PTAH_CONFIG_PATH'] ?? undefined;
  if (ptahDirOverride) bootOptions.userDataPath = ptahDirOverride;

  const result = bootstrap(bootOptions);
  const ctx: EngineContext = {
    container: result.container,
    transport: result.transport,
    pushAdapter: result.pushAdapter,
  };
  await (async () => {
    try {
      const migrationRunner = ctx.container.resolve<MigrationRunner>(
        SETTINGS_TOKENS.MIGRATION_RUNNER,
      );
      await migrationRunner.runMigrations();
      if (globals.verbose === true) {
        process.stderr.write(
          '[ptah] withEngine: file-settings migrations applied\n',
        );
      }
    } catch (settingsError) {
      const message =
        settingsError instanceof Error
          ? settingsError.message
          : String(settingsError);
      process.stderr.write(
        `[ptah] withEngine: file-settings migration failed (non-fatal): ${message}\n`,
      );
    }
  })();
  if (opts.mode === 'full') {
    await migrateLegacyAuthMethod(ctx.container).catch((migrationErr) => {
      if (globals.verbose === true) {
        process.stderr.write(
          `[ptah] withEngine: authMethod migration skipped: ${
            migrationErr instanceof Error
              ? migrationErr.message
              : String(migrationErr)
          }\n`,
        );
      }
    });
  }
  let sdkAdapter: SdkAgentLifecycle | undefined;
  if (opts.mode === 'full' && opts.requireSdk !== false) {
    if (globals.verbose === true) {
      process.stderr.write('[ptah] withEngine: initializing SDK adapter\n');
    }

    const sdkResult = await initializeSdkAdapter(ctx.container);
    sdkAdapter = sdkResult.adapter;

    if (!sdkResult.initialized) {
      const message =
        sdkResult.errorMessage ??
        'SDK agent adapter initialize() returned false (auth not configured)';
      if (sdkResult.adapter) {
        emitFatalError('sdk_init_failed', message, {
          command: 'engine.bootstrap',
          bootstrap_mode: opts.mode,
        });
      }
      await runDispose(opts, ctx);
      throw new SdkInitFailedError(message);
    }
  }
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
        const message =
          resolveErr instanceof Error ? resolveErr.message : String(resolveErr);
        process.stderr.write(
          `[ptah] withEngine: failed to resolve SdkPermissionHandler for auto-approve: ${message}\n`,
        );
      }
    }
  }

  const thothTier = opts.thoth ?? 'off';
  if (thothTier !== 'off') {
    try {
      const logger = ctx.container.resolve<Logger>(LOGGER_TOKEN);
      ctx.thothRefs = await activateThoth(ctx.container, thothTier, logger);
    } catch (activationErr) {
      process.stderr.write(
        `[ptah] withEngine: Thoth activation failed (non-fatal): ${
          activationErr instanceof Error
            ? activationErr.message
            : String(activationErr)
        }\n`,
      );
    }
  }

  try {
    return await fn(ctx);
  } finally {
    if (ctx.thothRefs) {
      try {
        const logger = ctx.container.resolve<Logger>(LOGGER_TOKEN);
        await disposeThoth(ctx.thothRefs, logger);
      } catch (thothDisposeErr) {
        process.stderr.write(
          `[ptah] withEngine: Thoth dispose failed (non-fatal): ${
            thothDisposeErr instanceof Error
              ? thothDisposeErr.message
              : String(thothDisposeErr)
          }\n`,
        );
      }
    }
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

export interface InitializeSdkAdapterResult {
  initialized: boolean;
  errorMessage?: string;
  adapter?: SdkAgentLifecycle;
}

export async function initializeSdkAdapter(
  container: DependencyContainer,
): Promise<InitializeSdkAdapterResult> {
  let adapter: SdkAgentLifecycle;
  try {
    adapter = container.resolve<SdkAgentLifecycle>(AGENT_ADAPTER_TOKEN);
  } catch (resolveErr) {
    const message =
      resolveErr instanceof Error ? resolveErr.message : String(resolveErr);
    return { initialized: false, errorMessage: message };
  }

  let initialized = false;
  let initErrorMessage: string | undefined;
  try {
    initialized = await adapter.initialize();
  } catch (initErr) {
    initErrorMessage =
      initErr instanceof Error ? initErr.message : String(initErr);
  }

  if (initialized) {
    return { initialized: true, adapter };
  }

  let healthMessage: string | undefined;
  try {
    healthMessage = adapter.getHealth?.()?.errorMessage;
  } catch {
    healthMessage = undefined;
  }

  return {
    initialized: false,
    errorMessage: initErrorMessage ?? healthMessage,
    adapter,
  };
}

/**
 * Read `authMethod` from the workspace provider; if it is the legacy camelCase
 * `'claudeCli'`, rewrite it to `'claude-cli'` on disk and return. Idempotent —
 * subsequent boots see the canonical value and skip the write.
 *
 * Note: `'oauth'` and `'apiKey'` are unaffected (kept camelCase for backward
 * compatibility with persisted Electron configs); only the `'claudeCli'`
 * spelling drifted from the provider-id format used elsewhere.
 */
export async function migrateLegacyAuthMethod(
  container: DependencyContainer,
): Promise<void> {
  let provider: WorkspaceProviderLite;
  try {
    provider = container.resolve<WorkspaceProviderLite>(
      WORKSPACE_PROVIDER_TOKEN,
    );
  } catch {
    return;
  }

  const current = provider.getConfiguration<string>('ptah', 'authMethod');
  if (current !== 'claudeCli') return;

  if (typeof provider.setConfiguration !== 'function') return;

  await provider.setConfiguration('ptah', 'authMethod', 'claude-cli');
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
  ctx.pushAdapter.removeAllListeners();

  ctx.container.clearInstances();
}

async function runDispose(
  opts: WithEngineOptions,
  ctx: EngineContext,
): Promise<void> {
  const dispose = opts.dispose ?? defaultDispose;
  try {
    await dispose(ctx);
  } catch (disposeError) {
    process.stderr.write(
      `[ptah] dispose failed: ${
        disposeError instanceof Error
          ? disposeError.message
          : String(disposeError)
      }\n`,
    );
  }
}
