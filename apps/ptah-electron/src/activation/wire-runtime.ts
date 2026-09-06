import type { DependencyContainer } from 'tsyringe';
import type { BrowserWindow } from 'electron';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import {
  TOKENS,
  bringUpSubsystems,
  armDiagnostics,
} from '@ptah-extension/vscode-core';
import type {
  DegradationReporter,
  DegradationSnapshot,
  Logger,
} from '@ptah-extension/vscode-core';
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

/**
 * How many distinct codes the boot summary names before it says "and N more".
 *
 * The whole point of the summary is that it is ONE line: a boot with forty
 * degradations that printed forty lines would reproduce the invisibility this
 * exists to remove. Five is enough to identify what actually went wrong while
 * the total and the code count carry the rest.
 */
const MAX_SUMMARISED_DEGRADATION_CODES = 5;

/**
 * The one-line, human-readable form of a non-empty degradation tally.
 *
 * `snapshot.entries` arrives sorted count-desc then code-asc, so "the top
 * codes" is a `slice` and needs no re-sorting here.
 */
export function formatDegradationSummary(
  snapshot: DegradationSnapshot,
): string {
  const shown = snapshot.entries.slice(0, MAX_SUMMARISED_DEGRADATION_CODES);
  const hidden = snapshot.entries.length - shown.length;
  const codes = shown
    .map((entry) => `${entry.code} x${entry.count}`)
    .join(', ');
  const plural = (n: number): string => (n === 1 ? '' : 's');

  let line =
    `[Degradation] Boot summary: ${snapshot.total} degradation${plural(snapshot.total)} ` +
    `across ${snapshot.entries.length} code${plural(snapshot.entries.length)} — ${codes}` +
    `${hidden > 0 ? `, and ${hidden} more` : ''}.`;
  if (snapshot.droppedReports > 0) {
    line += ` ${snapshot.droppedReports} report${plural(snapshot.droppedReports)} dropped past the code cap.`;
  }
  if (snapshot.broadcastFailures > 0) {
    line += ` ${snapshot.broadcastFailures} push${snapshot.broadcastFailures === 1 ? '' : 'es'} never reached the renderer.`;
  }
  return line;
}

/**
 * Emit the once-per-boot degradation summary (TASK_2026_383, component 3).
 *
 * Armed on the coordinator beside the warmup barrier and fired at the boot's
 * terminal transition. `info` at zero, `warn` otherwise — the LEVEL is the
 * signal a human scanning a log file reads first, and it is derived from the
 * count here rather than from any single report's `severity`, which is the call
 * site's own judgement about one capability and not about the boot.
 *
 * Both the reporter and the logger are resolved lazily and behind
 * `isRegistered`, the idiom `DegradationReporter` itself uses for the webview
 * manager: a host that registered neither (a test container, a stripped CLI
 * boot) must get silence, not a throw.
 *
 * ## The two limits of what this line covers
 *
 * - **It narrates the AWAITED chain, not everything the boot started.** The
 *   summary fires from the `.finally()` of the promise `postWindow()` returns,
 *   so a report issued from a detached continuation — `boot-heavy-services.ts`
 *   has two, `prefetchPricing().catch(...)` and
 *   `cliDetection.detectAll().then(...)` — lands after the line was already
 *   printed. Such a report is still tallied by the reporter, but no summary
 *   ever names it, and there is no second summary per process. A later batch
 *   that converts one of those `console.warn` sites to `reporter.report(...)`
 *   must either move the report inside the awaited chain or accept that it is
 *   counted and never narrated.
 * - **`snapshot().total` is cumulative since process start**, not scoped to
 *   this boot (`degradation-reporter.ts`: "every report accepted this
 *   process"). Today nothing reports before the post-window boot — every
 *   pre-window fallback in this file logs and nothing more — so the two are the
 *   same number. Convert a pre-window site to a report and the "boot summary"
 *   silently starts counting work that happened before the boot.
 */
export function logBootDegradationSummary(
  container: DependencyContainer,
): void {
  try {
    if (!container.isRegistered(TOKENS.DEGRADATION_REPORTER)) return;
    if (!container.isRegistered(TOKENS.LOGGER)) return;
    const snapshot = container
      .resolve<DegradationReporter>(TOKENS.DEGRADATION_REPORTER)
      .snapshot();
    const logger = container.resolve<Logger>(TOKENS.LOGGER);

    if (snapshot.total === 0) {
      logger.info(
        '[Degradation] Boot summary: no capability degraded during this boot.',
      );
      return;
    }
    logger.warn(formatDegradationSummary(snapshot));
  } catch (error: unknown) {
    // A summary is a diagnostic. It is already fired after the boot's terminal
    // transition, but swallowing here as well means a broken logger cannot turn
    // the narration of a boot into a second failure inside it.
    console.warn(
      '[Ptah Electron] Degradation summary skipped (non-fatal):',
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Handle a rejected startup-workspace boot reservation (TASK_2026_383, task 2.2).
 *
 * This replaces `.catch(() => undefined)`. That swallow and the sibling
 * workspace-change call a few lines above were the SAME method with two
 * different error contracts — and the silent one covered the startup root, i.e.
 * the boot that owns SQLite, the harness and session import for the workspace
 * the user actually opened. A failure there left no trace anywhere.
 *
 * The log is the sibling's form. The report is what makes the failure
 * countable: `severity: 'critical'` because nothing about the app works
 * normally afterwards, and the code is a string literal so the tally means
 * something.
 */
export function reportStartupBootFailure(
  container: DependencyContainer,
  error: unknown,
): void {
  console.error(
    '[Ptah Electron] Failed to boot heavy services for the startup workspace:',
    error,
  );
  try {
    if (!container.isRegistered(TOKENS.DEGRADATION_REPORTER)) return;
    container.resolve<DegradationReporter>(TOKENS.DEGRADATION_REPORTER).report({
      source: 'boot',
      code: 'electron.boot.startOrJoin-failed',
      severity: 'critical',
      summary:
        'The startup workspace never finished booting its heavy services.',
      detail: error instanceof Error ? error.message : String(error),
    });
  } catch (reportError: unknown) {
    // The reporter never throws by contract; this covers a container that
    // cannot resolve it at all. The `console.error` above already happened, so
    // the failure is not lost — only its tally is.
    console.warn(
      '[Ptah Electron] Could not record the startup boot failure:',
      reportError instanceof Error ? reportError.message : String(reportError),
    );
  }
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
      // Read BEFORE reserving, synchronously: `startOrJoin` creates the entry,
      // so asking afterwards always answers "yes".
      const alreadyBooted = booter.isReserved(active);
      // This log-only handler and `reportStartupBootFailure` at the startup
      // reservation below are the SAME method with two error contracts, and the
      // asymmetry is deliberate: TASK_2026_383 named only the startup swallow
      // (which reported nothing at all) as the defect to fix. This path already
      // logs, so it is out of that task's scope. Whoever gives it a degradation
      // code should reuse `reportStartupBootFailure`'s shape with its own code.
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
      // outgoing workspace is deliberately left untouched (E12):
      // `SkillJunctionService` reaped it on every folder switch, which broke
      // every other host still working in that directory.
      //
      // Only when the root has booted BEFORE (TASK_2026_345). A first switch to
      // a root reserves its heavy boot on the line above, and that boot already
      // performs the identical full pass and its own `activation` harness
      // reconcile. Firing this beside it is what put two `mirrorAll` and two
      // `reconcile` passes on the same tree at the same time — the log shows
      // one of them reporting `fastForwarded: 15` while its twin reported `0`
      // for the same clones (`tmp/logs/log.log:1206-1223`). The second and every
      // later switch back to a root finds its boot latched and needs this.
      if (alreadyBooted) {
        void propagateHarness(container, active, 'workspace-folders-changed');
      }
    }
  });
  // RESERVED HERE, in the same synchronous block as the listener above — no
  // `await` may sit between the two. The reservation is what makes the one-shot
  // latch honest: a folder-change event arriving before it would create the
  // entry for its own root first and the startup root would then start a SECOND
  // boot. The body does not run until `openWindowGate()` below.
  if (startupWorkspaceRoot) {
    // Held in a local so the reservation call stays one unbroken expression:
    // `wire-runtime.boot-order.spec.ts` pins the ordering by searching this
    // file for `booter.startOrJoin(startupWorkspaceRoot)` verbatim, and a
    // formatter breaking the chain across lines would silently unpin it.
    const reserved = booter.startOrJoin(startupWorkspaceRoot);
    void reserved.catch((error: unknown) => {
      reportStartupBootFailure(container, error);
    });
  }

  // The barrier replaces the old `if (refs.memoryCurator === null) return;`
  // early return. With a window-first boot `did-finish-load` fires long before
  // the curator exists, so sampling it once at that moment skipped warmup on
  // every single launch.
  coordinator.armWarmup(() => runEmbedderWarmup(container));

  // One line per boot, at the coordinator's terminal transition. Armed here
  // rather than emitted from `boot-coordinator.ts` because that module holds
  // no container and imports nothing at runtime by design.
  coordinator.armBootSummary(() => {
    logBootDegradationSummary(container);
  });

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
