import type { DependencyContainer } from 'tsyringe';
import type { BrowserWindow } from 'electron';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import {
  TOKENS,
  bringUpSubsystems,
  armDiagnostics,
} from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
import { setPtahMcpPort } from '@ptah-extension/agent-sdk';
import {
  AGENT_GENERATION_TOKENS,
  EnhancedPromptsService,
} from '@ptah-extension/agent-generation';
import type { IMultiPhaseAnalysisReader } from '@ptah-extension/agent-generation';
import { registerRpcSurface } from '@ptah-extension/rpc-handlers';
import { createElectronRpcHostProfile } from '../rpc-host-profile';
import { createApplicationMenu } from '../menu/application-menu';
import { propagateHarness } from './plugin-activation';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';
import type { EmbedderWorkerClient } from '@ptah-extension/memory-curator';
import type { DependencyGraphService } from '@ptah-extension/workspace-intelligence';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { CLI_AGENT_RUNTIME_TOKENS } from '@ptah-extension/cli-agent-runtime';

import type { BootCoordinator } from './boot-coordinator';
import { createHeavyServicesBooter } from './boot-heavy-services';

/**
 * How much heap the embedder warmup may ADD to the Electron MAIN process.
 *
 * ### What the old check actually measured (C3, TASK_2026_315)
 *
 * This replaces an inline `200` that appeared twice — once in the comparison,
 * once in the message it printed — under the label "Worker heap after warmup".
 * That label was wrong in the way that matters: the embedder runs in a separate
 * Electron `utilityProcess` (`build-embedder-worker` → `embedder-worker.mjs`),
 * so `process.memoryUsage()` here reports the MAIN process and knows nothing
 * about the worker's memory at all.
 *
 * Three captures of that ABSOLUTE figure:
 *
 * | capture                    | workspace                  | heap after warmup |
 * | -------------------------- | -------------------------- | ----------------- |
 * | `tmp/logs/b2-trace.log`    | small (few hundred files)  | 56.3 MB           |
 * | `tmp/logs/log.log`         | property-hub (15 445 files)| 246.0 MB          |
 * | `tmp/logs/coldstart-306.log` | large                    | 272.0 MB          |
 *
 * The spread tracks WORKSPACE SIZE — the file index and symbol index — not the
 * embedder. So the old threshold fired on any ordinary large project and stayed
 * quiet on any small one, which is a false alarm dressed as a budget: it could
 * not be exceeded for the reason it named, and could not be raised to a number
 * that meant anything, because the quantity is not attributable to warmup.
 *
 * The fix is to measure something the number can legitimately bound: the heap
 * DELTA across `warmup()`. That is attributable — it is what the warmup call
 * retained in main — and it is stable across workspace sizes, because whatever
 * the index already cost is on both sides of the subtraction.
 *
 * ### What the budget is FOR
 *
 * It is an architectural assertion, not a capacity limit. The model, tokenizer
 * and ONNX session are supposed to live entirely in the utilityProcess; main
 * should retain only the client proxy and one round of `Float32Array` results.
 * A delta in the tens of MB means that boundary holds. A delta above this
 * budget means main is holding worker payloads — the failure this seam exists
 * to catch, and the one the absolute-heap version could never distinguish from
 * "the user opened a big repo".
 *
 * Measured at **+0.1 MB** on the verification boot (2026-08-23,
 * `tmp/logs/b4-verify.log`: `main heap +0.1 MB, now 53.8 MB`) — i.e. the
 * boundary holds today and the old check was reporting the 53.8 MB the rest of
 * the process already owned. One capture, deliberately: the figure is expected
 * to be workspace-independent by construction, because whatever the file and
 * symbol indexes cost appears on both sides of the subtraction.
 *
 * 48 MB is chosen to sit far above sampling noise (GC timing moves `heapUsed`
 * by single-digit MB between two adjacent reads) and below the in-heap
 * footprint of any embedding model Ptah ships, so a model that landed in main
 * cannot hide under the budget while ordinary variance cannot trip it.
 *
 * ### Why exceeding it only logs
 *
 * There is no reclaim lever at this seam: `EmbedderWorkerClient` exposes
 * `embed`/`rerank`/`warmup`/`dispose` and nothing else, and disposing the
 * worker is precisely what warmup exists to avoid. Acting on this would need
 * the worker's own RSS reported back over `embedder-worker-protocol.ts`, which
 * is a memory-curator change and not this file's to make. Recorded as the
 * follow-up rather than faked here.
 */
const WARMUP_HEAP_DELTA_BUDGET_MB = 48;

/** Current main-process V8 heap in MB. */
function heapUsedMb(): number {
  return process.memoryUsage().heapUsed / (1024 * 1024);
}

export interface WireRuntimeOptions {
  container: DependencyContainer;
  getMainWindow: () => BrowserWindow | null;
  startupWorkspaceRoot: string | undefined;
  /**
   * Owns the stable refs object, the abort signal and the warmup barrier. Every
   * long-lived handle produced below is written into `coordinator.refs`.
   */
  coordinator: BootCoordinator;
  /**
   * `app.getPath('logs')`, where `.cpuprofile` captures are written. Passed in
   * rather than read here for the same reason every other Electron API in this
   * activation path is passed in — this module must stay importable without an
   * Electron runtime.
   */
  logsPath?: string;
}

export interface WireRuntimePreWindowResult {
  /**
   * Window-bounds persistence. Also mirrored into `coordinator.refs`; returned
   * here because `registerPostWindow` needs it as an argument, before the
   * window exists.
   */
  resolvedStateStorage: IStateStorage | undefined;
  /**
   * The post-window phase. Call it AFTER `registerPostWindow` has created and
   * loaded the main window; it opens the boot gate and awaits the heavy work.
   *
   * `main.ts` hands this to `coordinator.startPostWindow`, which catches every
   * rejection — do not await it on the activation path.
   */
  postWindow: () => Promise<void>;
}

/**
 * The pre-window half of Electron activation (TASK_2026_331 B1.T3).
 *
 * Everything here must finish before the window can usefully appear:
 * diagnostics (so the window's own creation is instrumented), the RPC surface
 * (the renderer issues RPCs during its own bootstrap), and MCP bring-up (the
 * memory boot scan issues LLM queries and must see a live MCP port).
 *
 * Everything else moved into {@link WireRuntimePreWindowResult.postWindow}.
 */
export async function wireRuntimePreWindow(
  options: WireRuntimeOptions,
): Promise<WireRuntimePreWindowResult> {
  const { container, getMainWindow, startupWorkspaceRoot, logsPath } = options;
  const coordinator = options.coordinator;
  const refs = coordinator.refs;

  // FIRST, before anything heavy. In Electron the backend shares its event loop
  // with BrowserWindow management, so a synchronous burst anywhere below this
  // line freezes the whole app — and everything below this line is a candidate
  // (plugin loading, SQLite open, memory curator, harness reconcile). Arming
  // the monitor after the boot it is meant to observe would be instrumentation
  // that is blind to the most expensive stretch of the process's life.
  refs.diagnostics = armDiagnostics({ container, logsPath });

  let resolvedStateStorage: IStateStorage | undefined;
  try {
    const enhancedPrompts = container.resolve<EnhancedPromptsService>(
      AGENT_GENERATION_TOKENS.ENHANCED_PROMPTS_SERVICE,
    );
    const analysisStorage = container.resolve<IMultiPhaseAnalysisReader>(
      AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE,
    );
    enhancedPrompts.setAnalysisReader(analysisStorage);
  } catch (error: unknown) {
    console.warn(
      '[Ptah Electron] Failed to wire multi-phase analysis reader:',
      error instanceof Error ? error.message : String(error),
    );
  }
  const rpcLogger = container.resolve<Logger>(TOKENS.LOGGER);
  registerRpcSurface(
    container,
    createElectronRpcHostProfile(container, rpcLogger),
  );

  console.log(
    '[Ptah Electron] IPC bridge, WebviewManager, and RPC methods initialized',
  );

  // Autocomplete discovery watchers. `autocomplete:*` has no capability
  // requirement in `RPC_HANDLER_MANIFEST`, so this host has always SERVED the
  // `@` and `/` pickers — it just never armed their invalidation, which only
  // the VS Code bootstrap did. Without it the per-workspace cache had no way to
  // learn that `.claude/agents` or `.claude/commands` changed, and since it has
  // no TTL the picker served the list captured at first use for the rest of the
  // session. Each service arms one watcher per open folder and re-arms them on
  // `onDidChangeWorkspaceFolders`, which is exactly what this host needs: the
  // active workspace changes at runtime here, unlike in a VS Code window.
  for (const [label, token] of [
    ['agents', TOKENS.AGENT_DISCOVERY_SERVICE],
    ['commands', TOKENS.COMMAND_DISCOVERY_SERVICE],
  ] as const) {
    try {
      const service = container.resolve(token) as {
        initializeWatchers: () => void;
      };
      service.initializeWatchers();
    } catch (error: unknown) {
      // A missing watcher degrades the pickers to "refreshes on workspace
      // switch", never to a failed boot.
      console.warn(
        `[Ptah Electron] Could not arm ${label} discovery watcher:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  try {
    resolvedStateStorage = container.resolve<IStateStorage>(
      PLATFORM_TOKENS.STATE_STORAGE,
    );
    refs.resolvedStateStorage = resolvedStateStorage;
  } catch (error: unknown) {
    console.warn(
      '[Ptah Electron] Could not resolve STATE_STORAGE for window persistence:',
      error instanceof Error ? error.message : String(error),
    );
  }

  const booter = createHeavyServicesBooter({ container, coordinator });

  createApplicationMenu(container, getMainWindow);

  // B1 (TASK_2026_315) — MCP comes up BEFORE the heavy boot, not after it.
  //
  // The heavy boot → `bootThothRuntime` starts the memory and skill boot scans,
  // and the memory scan dials a real LLM query per unscanned session. With
  // bring-up below that call those queries were issued against
  // `mcpServerRunning: false` and ran tool-less (`[SdkQueryRunner] MCP disabled`
  // in the captured log), while the identical query minutes later — after
  // bring-up — got `mcpServerRunning: true, mcpPort: 51820`. Same work, two
  // different tool surfaces, decided by activation ordering alone.
  //
  // Nothing in `bringUpSubsystems` depends on the Thoth boot: it resolves
  // `CODE_EXECUTION_MCP`, binds a local port and writes the `ptah` entry into
  // `{ws}/.mcp.json`. The dependency runs the other way, which is the bug.
  //
  // Placement is also what keeps the workspace-change listener honest. It is
  // registered AFTER this await and immediately before the startup boot
  // RESERVATION below, with no await between the two, so a folder-change event
  // cannot interleave and win the one-shot latch out from under it.
  try {
    const logger = container.resolve<Logger>(TOKENS.LOGGER);

    await bringUpSubsystems({
      container,
      logger,
      onMcpPortChange: (port) => {
        setPtahMcpPort(port ?? 0);
      },
    });
    console.log('[Ptah Electron] Subsystems brought up');
  } catch (bringUpError: unknown) {
    console.warn(
      '[Ptah Electron] Subsystem bring-up failed (non-fatal):',
      bringUpError instanceof Error
        ? bringUpError.message
        : String(bringUpError),
    );
  }

  const workspaceProvider = container.resolve<IWorkspaceProvider>(
    PLATFORM_TOKENS.WORKSPACE_PROVIDER,
  );
  workspaceProvider.onDidChangeWorkspaceFolders(() => {
    // Drop cached dependency graphs for workspaces that are no longer open so
    // their nodes/edges don't linger in memory after a folder is closed. The
    // event carries no removed path, so retaining the currently-open set is the
    // race-free way to evict closed workspaces. Non-fatal.
    try {
      const depGraph = container.resolve<DependencyGraphService>(
        TOKENS.DEPENDENCY_GRAPH_SERVICE,
      );
      depGraph.retainOnly(workspaceProvider.getWorkspaceFolders());
    } catch (err: unknown) {
      console.warn(
        '[Ptah Electron] Dependency graph eviction skipped (non-fatal):',
        err,
      );
    }

    const active = workspaceProvider.getWorkspaceRoot();
    if (active) {
      booter.startOrJoin(active).catch((err: unknown) => {
        console.error(
          '[Ptah Electron] Failed to boot heavy services lazily:',
          err,
        );
      });
      // The NEW workspace gets a FULL pass — user-layer refresh, then reconcile
      // — because one of the user layer's sources is `{ws}/.claude/agents`, and
      // that directory belongs to the workspace we just switched to. A bare
      // reconcile here mirrored nothing and therefore propagated the PREVIOUS
      // workspace's agents into the new one while reporting a clean pass. The
      // heavy boot is one-shot per root, so this call is what covers the second
      // and subsequent switches. The outgoing workspace is deliberately left
      // untouched (E12): `SkillJunctionService` reaped it on every folder
      // switch, which broke every other host still working in that directory.
      void propagateHarness(container, active, 'workspace-folders-changed');
    }
  });
  // RESERVED HERE, in the same synchronous block as the listener above — no
  // `await` may sit between the two. The reservation is what makes the one-shot
  // latch honest: a folder-change event arriving before it would create the
  // entry for its own root first and the startup root would then start a SECOND
  // boot. The body does not run until `openWindowGate()` below.
  if (startupWorkspaceRoot) {
    void booter.startOrJoin(startupWorkspaceRoot).catch(() => undefined);
  }

  // The barrier replaces the old `if (refs.memoryCurator === null) return;`
  // early return. With a window-first boot `did-finish-load` fires long before
  // the curator exists, so sampling it once at that moment skipped warmup on
  // every single launch.
  coordinator.armWarmup(() => runEmbedderWarmup(container));

  const postWindow = async (): Promise<void> => {
    booter.openWindowGate();
    if (startupWorkspaceRoot) {
      await booter.startOrJoin(startupWorkspaceRoot);
    }
    captureShutdownHandles(container, coordinator);
  };

  return { resolvedStateStorage, postWindow };
}

/**
 * Eagerly construct the two disposal handles whose dependency graphs must NOT
 * be built during teardown.
 *
 * Resolving either of these in `will-quit` forces a first-time lazy build
 * mid-teardown, which races with DI shutdown and can hang or throw (observed in
 * the auto-updater e2e: production build, blocked network). Non-fatal: a null
 * ref simply means `will-quit` has nothing to dispose.
 */
function captureShutdownHandles(
  container: DependencyContainer,
  coordinator: BootCoordinator,
): void {
  try {
    coordinator.refs.cliRegistry = container.resolve<{
      disposeAll: () => void;
    }>(CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_REGISTRY);
  } catch (cliRegistryError: unknown) {
    console.warn(
      '[Ptah Electron] CLI registry eager resolve failed (non-fatal):',
      cliRegistryError instanceof Error
        ? cliRegistryError.message
        : String(cliRegistryError),
    );
    coordinator.refs.cliRegistry = null;
  }

  // Same eager-capture rationale. Resolving the agent process manager during
  // will-quit would build its dependency graph at exactly the moment its job is
  // to tear things down.
  try {
    coordinator.refs.agentProcessManager = container.resolve<{
      disposeAll: () => Promise<void>;
    }>(TOKENS.AGENT_PROCESS_MANAGER);
  } catch (agentManagerError: unknown) {
    console.warn(
      '[Ptah Electron] Agent process manager eager resolve failed (non-fatal):',
      agentManagerError instanceof Error
        ? agentManagerError.message
        : String(agentManagerError),
    );
    coordinator.refs.agentProcessManager = null;
  }
}

/**
 * Pre-warm the embedder + reranker.
 *
 * Invoked by {@link BootCoordinator} once the warmup barrier opens — the window
 * has finished loading AND the memory curator exists. Fire-and-forget and
 * non-fatal; the coordinator owns the 3-second idle delay.
 */
async function runEmbedderWarmup(
  container: DependencyContainer,
): Promise<void> {
  try {
    const embedderClient = container.resolve<EmbedderWorkerClient>(
      PERSISTENCE_TOKENS.EMBEDDER,
    );
    const heapBeforeMb = heapUsedMb();
    await embedderClient.warmup();
    const heapAfterMb = heapUsedMb();
    const deltaMb = heapAfterMb - heapBeforeMb;
    if (deltaMb > WARMUP_HEAP_DELTA_BUDGET_MB) {
      console.warn(
        `[Ptah Electron] Embedder warmup added ${deltaMb.toFixed(1)} MB to the main-process heap ` +
          `(budget: ${WARMUP_HEAP_DELTA_BUDGET_MB} MB; heap ${heapBeforeMb.toFixed(1)} → ${heapAfterMb.toFixed(1)} MB). ` +
          'The model should live in the utilityProcess — this much retained in main means something is holding worker payloads.',
      );
    } else {
      console.log(
        `[Ptah Electron] Embedder warmup complete (main heap +${deltaMb.toFixed(1)} MB, now ${heapAfterMb.toFixed(1)} MB)`,
      );
    }
  } catch (err: unknown) {
    console.warn(
      '[Ptah Electron] Embedder warmup failed (non-fatal):',
      err instanceof Error ? err.message : String(err),
    );
  }
}
