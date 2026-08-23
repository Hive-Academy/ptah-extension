import type { DependencyContainer } from 'tsyringe';
import type { BrowserWindow } from 'electron';
import {
  PLATFORM_TOKENS,
  ContentDownloadService,
} from '@ptah-extension/platform-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import { TOKENS, bringUpSubsystems } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
import { SDK_TOKENS, setPtahMcpPort } from '@ptah-extension/agent-sdk';
import { AUTH_PROVIDERS_TOKENS } from '@ptah-extension/auth-providers';
import {
  AGENT_GENERATION_TOKENS,
  EnhancedPromptsService,
} from '@ptah-extension/agent-generation';
import type { IMultiPhaseAnalysisReader } from '@ptah-extension/agent-generation';
import { registerRpcSurface } from '@ptah-extension/rpc-handlers';
import { createElectronRpcHostProfile } from '../rpc-host-profile';
import { createApplicationMenu } from '../menu/application-menu';
import {
  initPluginLoader,
  mirrorUserLayer,
  propagateHarness,
  reconcileHarness,
  reconcileUserLayer,
  syncSkillRegistryCatalog,
} from './plugin-activation';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';
import type { EmbedderWorkerClient } from '@ptah-extension/memory-curator';
import type { DependencyGraphService } from '@ptah-extension/workspace-intelligence';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { GatewayService } from '@ptah-extension/messaging-gateway';
import { CLI_AGENT_RUNTIME_TOKENS } from '@ptah-extension/cli-agent-runtime';
import {
  bootThothRuntime,
  startThothCron,
  type ThothRuntimeRefs,
} from '@ptah-extension/thoth-runtime';

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
}

export interface WireRuntimeResult {
  resolvedStateStorage: IStateStorage | undefined;
  /**
   * Call this AFTER the main BrowserWindow fires `did-finish-load` to trigger
   * the 3-second idle warmup of the embedder + cross-encoder models.
   * The delay is intentionally anchored to window-ready so warmup I/O does not
   * overlap with the renderer's first render burst.
   * No-op when memory-curator was not started (null workspace or start failure).
   */
  scheduleWarmup: () => void;
  /**
   * Thoth handles (SQLite / memory / skills / cron / status bridges) come
   * straight from `@ptah-extension/thoth-runtime` — see {@link ThothRuntimeRefs}
   * for their null semantics. The extra fields below are host-owned.
   */
  refs: ThothRuntimeRefs & {
    gitWatcher: {
      stop: () => void;
      switchWorkspace: (p: string) => void;
    } | null;
    /**
     * Messaging gateway service handle for orderly shutdown. Null when
     * persistence-sqlite is unavailable or `gateway.enabled` is `false` —
     * caller's LIFO will-quit chain must tolerate null.
     */
    messagingGateway: GatewayService | null;
    /**
     * Ptah CLI registry handle for orderly shutdown. Resolved eagerly here
     * (while the container is healthy) so `will-quit` can dispose the captured
     * instance instead of resolving it from the container mid-teardown — a
     * first-time lazy construction during shutdown races with DI teardown and
     * can hang or throw. Null when the CLI agent runtime is not registered.
     */
    cliRegistry: { disposeAll: () => void } | null;
  };
}

export async function wireRuntime(
  options: WireRuntimeOptions,
): Promise<WireRuntimeResult> {
  const { container, getMainWindow, startupWorkspaceRoot } = options;

  const refs: WireRuntimeResult['refs'] = {
    gitWatcher: null,
    sqliteConnection: null,
    memoryCurator: null,
    memoryTrigger: null,
    skillSynthesis: null,
    skillTrigger: null,
    cronScheduler: null,
    messagingGateway: null,
    symbolWatcher: null,
    statusBridgeDisposables: null,
    cliRegistry: null,
  };

  let resolvedStateStorage: IStateStorage | undefined;
  try {
    const enhancedPrompts = container.resolve<EnhancedPromptsService>(
      AGENT_GENERATION_TOKENS.ENHANCED_PROMPTS_SERVICE,
    );
    const analysisStorage = container.resolve<IMultiPhaseAnalysisReader>(
      AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE,
    );
    enhancedPrompts.setAnalysisReader(analysisStorage);
  } catch (error) {
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
  try {
    resolvedStateStorage = container.resolve<IStateStorage>(
      PLATFORM_TOKENS.STATE_STORAGE,
    );
  } catch (error) {
    console.warn(
      '[Ptah Electron] Could not resolve STATE_STORAGE for window persistence:',
      error instanceof Error ? error.message : String(error),
    );
  }

  /**
   * The in-flight (or settled) heavy-boot, or `null` before the first call.
   *
   * This is deliberately the PROMISE and not a boolean. A boolean latch is set
   * on entry, so it answers "has one started" — but every caller here needs
   * "has one finished". `onDidChangeWorkspaceFolders` (registered below) can
   * fire while the startup boot is still awaiting, and under a boolean the
   * second caller returns instantly; if that second caller is the awaited one,
   * `wireRuntime` returns with every `refs.*` field still null, and `main.ts`'s
   * `will-quit` LIFO chain has nothing to dispose while the services it should
   * have stopped are running. Handing back the same promise makes the second
   * caller WAIT, which is what "one-shot" has to mean when the body is async.
   *
   * A rejected boot is NOT retried, matching the previous boolean exactly: the
   * latch is assigned before the body runs and is never cleared.
   */
  let heavyServicesBoot: Promise<void> | null = null;

  const bootHeavyServicesOnce = async (workspaceRoot: string | undefined) => {
    console.log(
      '[Ptah Electron] Booting deferred backend services for workspace...',
    );
    const thoth = await bootThothRuntime(container, {
      workspaceRoot,
      logPrefix: '[Ptah Electron]',
    });
    refs.sqliteConnection = thoth.sqliteConnection;
    refs.memoryCurator = thoth.memoryCurator;
    refs.memoryTrigger = thoth.memoryTrigger;
    refs.skillSynthesis = thoth.skillSynthesis;
    refs.skillTrigger = thoth.skillTrigger;
    refs.symbolWatcher = thoth.symbolWatcher;
    refs.statusBridgeDisposables = thoth.statusBridgeDisposables;

    const contentDownload = container.resolve<ContentDownloadService>(
      PLATFORM_TOKENS.CONTENT_DOWNLOAD,
    );
    initPluginLoader(container, contentDownload.getPluginsPath());
    await mirrorUserLayer(container, workspaceRoot);
    const sqliteOpen =
      refs.sqliteConnection !== null && refs.sqliteConnection.isOpen;
    // Pre-network, so a warm start detects divergence and reaps deleted
    // upstreams with no download at all. The post-download callback below runs
    // the same pass again against the refreshed sources; this one is what makes
    // an offline or fully-cached start still notice a clone the user edited
    // (defect 8). Both passes are a directory walk plus a content hash.
    await reconcileUserLayer(container, workspaceRoot, sqliteOpen);
    if (sqliteOpen) {
      void syncSkillRegistryCatalog(container);
    }
    contentDownload
      .ensureContent()
      .then(async (result) => {
        if (!result.success) {
          console.warn(
            '[Ptah Electron] Content download failed (non-blocking):',
            result.error ?? 'Unknown error',
          );
        }
        await mirrorUserLayer(container, workspaceRoot);
        // Unconditional: the `!result.fromCache` gate that used to sit here is
        // defect 8. A cached download still needs the sweep, because what
        // changed may be the CLONE (a user edit) or the upstream's absence,
        // neither of which the download result knows anything about.
        await reconcileUserLayer(container, workspaceRoot, sqliteOpen);
        // Re-reconcile against the post-download user layer. The pass below
        // this block runs before the network is done — so on a cold first run
        // it sees an empty user layer and copies nothing, and on a content
        // update it copies the previous revision. Both leave the workspace
        // without skills until the NEXT app start (TASK_2026_278). Running it
        // here for cached downloads too is deliberate: the branch that "already
        // has everything" is exactly the one where this is a cheap hash-compare
        // no-op, and skipping it would leave the fromCache path depending on
        // the initial call having raced correctly.
        await reconcileHarness(
          container,
          workspaceRoot,
          'content-download-complete',
        );
      })
      .catch((err: unknown) => {
        console.warn(
          '[Ptah Electron] Post-download reconcile failed (non-fatal):',
          err instanceof Error ? err.message : String(err),
        );
      });
    // First pass, not awaiting the network, so a warm start has skills before
    // the window even opens. `downloadPending` only changes how an empty user
    // layer is REPORTED; the callback above corrects the content.
    await reconcileHarness(container, workspaceRoot, 'activation', {
      downloadPending: true,
    });
    try {
      const providerModels = container.resolve(
        AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_MODELS,
      ) as { prefetchPricing: () => Promise<number> };
      providerModels.prefetchPricing().catch((err) => {
        console.warn(
          '[Ptah Electron] Pricing pre-fetch failed (using bundled defaults):',
          err instanceof Error ? err.message : String(err),
        );
      });
      console.log('[Ptah Electron] Pricing pre-fetch initiated (background)');
    } catch (error) {
      console.warn(
        '[Ptah Electron] Pricing pre-fetch setup failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }
    try {
      const cliDetection = container.resolve(TOKENS.CLI_DETECTION_SERVICE) as {
        detectAll: () => Promise<
          Array<{ cli: string; installed: boolean; version?: string }>
        >;
        refreshCliTokens: () => Promise<void>;
      };

      cliDetection
        .detectAll()
        .then(async (results) => {
          const installed = results.filter((r) => r.installed);
          console.log(
            `[Ptah Electron] CLI detection complete: ${installed.length}/${results.length} CLIs found`,
          );
          if (installed.some((r) => r.cli === 'codex')) {
            try {
              await cliDetection.refreshCliTokens();
            } catch (refreshErr) {
              console.warn(
                '[Ptah Electron] CLI token refresh failed (non-blocking):',
                refreshErr instanceof Error
                  ? refreshErr.message
                  : String(refreshErr),
              );
            }
          }
        })
        .catch((err) => {
          console.warn(
            '[Ptah Electron] CLI detection failed (non-blocking):',
            err instanceof Error ? err.message : String(err),
          );
        });
    } catch (cliDetectError) {
      console.warn(
        '[Ptah Electron] CLI detection setup failed (non-blocking):',
        cliDetectError instanceof Error
          ? cliDetectError.message
          : String(cliDetectError),
      );
    }
    if (workspaceRoot) {
      try {
        const sessionImporter = container.resolve(
          SDK_TOKENS.SDK_SESSION_IMPORTER,
        ) as {
          scanAndImport: (path: string, limit?: number) => Promise<number>;
        };
        const imported = await sessionImporter.scanAndImport(workspaceRoot, 50);
        if (imported > 0) {
          console.log(
            `[Ptah Electron] Imported ${imported} existing Claude session(s)`,
          );
        }
      } catch (importError) {
        console.warn(
          '[Ptah Electron] Session import skipped (non-fatal):',
          importError instanceof Error
            ? importError.message
            : String(importError),
        );
      }
    }
    if (workspaceRoot) {
      try {
        const { GitWatcherService } =
          await import('../services/git-watcher.service');
        const gitInfoSvc = container.resolve(
          TOKENS.GIT_INFO_SERVICE,
        ) as InstanceType<
          typeof import('@ptah-extension/vscode-core').GitInfoService
        >;
        const webviewManager = container.resolve(TOKENS.WEBVIEW_MANAGER) as {
          broadcastMessage: (type: string, payload: unknown) => Promise<void>;
        };

        const logger = container.resolve<
          import('@ptah-extension/vscode-core').Logger
        >(TOKENS.LOGGER);
        const watcher = new GitWatcherService(gitInfoSvc, logger);
        watcher.start(workspaceRoot, (type, payload) => {
          webviewManager.broadcastMessage(type, payload);
        });
        refs.gitWatcher = watcher;
        console.log('[Ptah Electron] Git file system watcher started');
      } catch (error) {
        console.warn(
          '[Ptah Electron] Git watcher setup failed (non-fatal):',
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    await startThothCron(container, thoth, {
      logPrefix: '[Ptah Electron]',
    });
    refs.cronScheduler = thoth.cronScheduler;
  }; // end of bootHeavyServicesOnce

  /** One-shot entry point. See {@link heavyServicesBoot} for why it is a promise. */
  const bootHeavyServices = (
    workspaceRoot: string | undefined,
  ): Promise<void> => {
    heavyServicesBoot ??= bootHeavyServicesOnce(workspaceRoot);
    return heavyServicesBoot;
  };

  createApplicationMenu(container, getMainWindow);

  // B1 (TASK_2026_315) — MCP comes up BEFORE the heavy boot, not after it.
  //
  // `bootHeavyServices` → `bootThothRuntime` starts the memory and skill boot
  // scans, and the memory scan dials a real LLM query per unscanned session.
  // With bring-up below that call those queries were issued against
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
  // registered AFTER this await and immediately before the startup boot below,
  // with no await between the two, so a folder-change event cannot interleave
  // and win the one-shot latch out from under the awaited call.
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
    } catch (err) {
      console.warn(
        '[Ptah Electron] Dependency graph eviction skipped (non-fatal):',
        err,
      );
    }

    const active = workspaceProvider.getWorkspaceRoot();
    if (active) {
      bootHeavyServices(active).catch((err) => {
        console.error(
          '[Ptah Electron] Failed to boot heavy services lazily:',
          err,
        );
      });
      // The NEW workspace gets a FULL pass — user-layer refresh, then reconcile
      // — because one of the user layer's sources is `{ws}/.claude/agents`, and
      // that directory belongs to the workspace we just switched to. A bare
      // reconcile here mirrored nothing and therefore propagated the PREVIOUS
      // workspace's agents into the new one while reporting a clean pass.
      // `bootHeavyServices` is one-shot, so this call is what covers the second
      // and subsequent switches. The outgoing workspace is deliberately left
      // untouched (E12): `SkillJunctionService` reaped it on every folder
      // switch, which broke every other host still working in that directory.
      void propagateHarness(container, active, 'workspace-folders-changed');
    }
  });

  if (startupWorkspaceRoot) {
    await bootHeavyServices(startupWorkspaceRoot);
  }

  // Eagerly construct the Ptah CLI registry now that all subsystems (including
  // the SDK singletons it injects) are wired, and capture it for orderly
  // shutdown. Deferring this to will-quit forces a first-time lazy build of its
  // dependency graph mid-teardown, which races with DI shutdown and can hang or
  // throw (blocked-network production case). Non-fatal: a null ref simply means
  // will-quit has nothing to dispose.
  try {
    refs.cliRegistry = container.resolve<{ disposeAll: () => void }>(
      CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_REGISTRY,
    );
  } catch (cliRegistryError) {
    console.warn(
      '[Ptah Electron] CLI registry eager resolve failed (non-fatal):',
      cliRegistryError instanceof Error
        ? cliRegistryError.message
        : String(cliRegistryError),
    );
    refs.cliRegistry = null;
  }

  /**
   * PHASE 4.96: Pre-warm embedder + reranker.
   *
   * Called by post-window.ts AFTER mainWindow fires `did-finish-load` so
   * warmup I/O does not overlap with the renderer's first render burst.
   * Fire-and-forget, non-fatal.
   */
  function scheduleWarmup(): void {
    if (refs.memoryCurator === null) return;
    setTimeout(() => {
      void (async () => {
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
      })();
    }, 3000);
  }

  return {
    resolvedStateStorage,
    scheduleWarmup,
    refs,
  };
}
