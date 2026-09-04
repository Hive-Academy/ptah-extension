/**
 * Electron DI — Phase 2: Library registrations.
 *
 * Registers (in order):
 *   - Phase 2.1: workspace-intelligence
 *   - Phase 2.2: agent-sdk + TOKENS.AGENT_ADAPTER factory
 *   - Phase 2.2.5: WEBVIEW_MESSAGE_HANDLER / WEBVIEW_HTML_GENERATOR stubs
 *   - Phase 2.3: agent-generation
 *   - Phase 2.3.5: SETUP_WIZARD_SERVICE override (ElectronSetupWizardService)
 *   - Phase 2.5: llm-abstraction
 */

import type { DependencyContainer } from 'tsyringe';

import {
  TOKENS,
  type Logger,
  type WorkspaceAwareStateStorage,
} from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type ContentDownloadService,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { SessionId, type IAgentAdapter } from '@ptah-extension/shared';
import {
  registerWorkspaceIntelligenceServices,
  TypeScriptDiagnosticsProvider,
} from '@ptah-extension/workspace-intelligence';
import {
  registerSdkServices,
  wireAgentAdapterAliases,
  SDK_TOKENS,
  HARNESS_PREFLIGHT_TOKEN,
} from '@ptah-extension/agent-sdk';
import {
  registerHarnessSyncServices,
  ALL_HARNESS_TARGET_FACTORIES,
  createPluginConfigSourceResolver,
  HARNESS_SYNC_TOKENS,
  type HarnessPluginConfigReader,
} from '@ptah-extension/harness-sync';
import {
  registerAuthProvidersServices,
  registerCuratorAuthServices,
} from '@ptah-extension/auth-providers';
import {
  registerCliAgentRuntimeServices,
  createHarnessCliDetector,
  type HarnessCliDetectionReader,
} from '@ptah-extension/cli-agent-runtime';
import {
  registerAgentGenerationServices,
  AGENT_GENERATION_TOKENS,
} from '@ptah-extension/agent-generation';
import {
  registerPersistenceSqliteServices,
  PERSISTENCE_TOKENS,
  resolvePtahDbPath,
  resolveVecPackageName,
  resolveVecBinaryName,
  type SqliteConnectionService,
  type SqliteVecPathResolver,
} from '@ptah-extension/persistence-sqlite';
import * as fs from 'node:fs';
import { app } from 'electron';
import {
  registerMemoryCuratorServices,
  MEMORY_TOKENS,
} from '@ptah-extension/memory-curator';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  registerSkillSynthesisServices,
  SKILL_REPROPAGATION_TOKEN,
} from '@ptah-extension/skill-synthesis';
import {
  registerTaskSpecsServices,
  startTaskSpecsIndex,
} from '@ptah-extension/task-specs';
import { registerOutputStyleServices } from '@ptah-extension/output-styles';
import { registerPluginMarketplaceServices } from '@ptah-extension/plugin-marketplace';
import { registerCronSchedulerServices } from '@ptah-extension/cron-scheduler';
import {
  registerMessagingGatewayServices,
  GATEWAY_TOKENS,
  type ISessionActivityProbe,
} from '@ptah-extension/messaging-gateway';
import {
  registerVoiceProviderServices,
  VOICE_TOKENS,
} from '@ptah-extension/voice-providers';
import { VOICE_CONTRACT_TOKENS } from '@ptah-extension/voice-contracts';
import { registerGatewayChatBridge } from '@ptah-extension/gateway-chat-bridge';
import { ElectronSafeStorageVault } from '../services/platform/electron-safe-storage-vault';
import { ElectronVoiceWorkerFactory } from '../services/platform/electron-voice-worker-factory';
import { ElectronEmbedderWorkerFactory } from '../services/platform/electron-embedder-worker-factory';
import { MetadataGatewaySessionLister } from '../services/gateway/metadata-gateway-session-lister';
import { ElectronSetupWizardService } from '../services/electron-setup-wizard.service';
import { ElectronSkillRepropagation } from '../activation/skill-repropagation';
import {
  createUserLayerRefresher,
  readDormantSkillSlugs,
} from '../activation/plugin-activation';

/**
 * `harness.preflightTimeoutMs` — how long a session start may wait for the
 * harness check. `undefined` (unset, unreadable, or non-positive) means "use
 * the lib default", which is deliberately NOT restated as a literal here: two
 * hosts disagreeing about the default is exactly the drift a single default in
 * `harness-sync` exists to prevent.
 *
 * Section `'ptah'` with a DOTTED key: `FILE_BASED_SETTINGS_KEYS` routes only
 * that section to `~/.ptah/settings.json` (TASK_2026_278 Batch 4).
 */
function readPreflightTimeoutMs(
  container: DependencyContainer,
): number | undefined {
  try {
    const workspace = container.resolve<IWorkspaceProvider>(
      PLATFORM_TOKENS.WORKSPACE_PROVIDER,
    );
    const value = workspace.getConfiguration<number>(
      'ptah',
      'harness.preflightTimeoutMs',
    );
    return typeof value === 'number' && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `harness.manageGitignore`, or `undefined` to take the lib default (on).
 * The default lives in `harness-sync`; answering `true` here would be a second
 * copy of it.
 */
function readManageGitignore(
  container: DependencyContainer,
): boolean | undefined {
  try {
    const workspace = container.resolve<IWorkspaceProvider>(
      PLATFORM_TOKENS.WORKSPACE_PROVIDER,
    );
    const value = workspace.getConfiguration<boolean>(
      'ptah',
      'harness.manageGitignore',
    );
    return typeof value === 'boolean' ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Phase 2: Register library services in the order required by inter-library deps.
 *
 * Prerequisites: Phase 1 shims (FILE_SYSTEM_MANAGER, CONFIG_MANAGER,
 * EXTENSION_CONTEXT) must already be registered — workspace-intelligence,
 * agent-sdk, and llm-abstraction resolve them at registration time.
 */
export function registerPhase2Libraries(
  container: DependencyContainer,
  logger: Logger,
): void {
  registerWorkspaceIntelligenceServices(container, logger);
  // Override the Phase 0 diagnostics stub with the real TypeScript compiler
  // provider. Must come AFTER workspace-intelligence so IFileSystemProvider is
  // registered. PtahAPIBuilder resolves DIAGNOSTICS_PROVIDER in Phase 4 (later).
  const tsDiagsProvider = new TypeScriptDiagnosticsProvider(
    container.resolve(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER),
  );
  container.register(PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER, {
    useValue: tsDiagsProvider,
  });
  logger.info(
    '[Phase 2] Overrode DIAGNOSTICS_PROVIDER with TypeScriptDiagnosticsProvider',
  );
  registerAuthProvidersServices(container, logger);
  // MUST precede registerSdkServices: PluginLoaderService injects the external
  // consent store as its allowlist source. Its late `initialize()` runs from
  // plugin activation, next to `pluginLoader.initialize()`.
  registerPluginMarketplaceServices(container, logger);
  registerSdkServices(container, logger);
  // harness-sync AFTER registerSdkServices so the plugin loader token exists.
  // The resolver lambda is lazy anyway — the loader is only usable after
  // `initialize()` runs in plugin activation, long after this phase.
  //
  // Every target, in every host: a workspace is populated for the tools the
  // USER has, not for the one running Ptah. Undetected CLIs are skipped at
  // reconcile time, so the detector lambda below is the only host-specific
  // part — and it is lazy too, because `registerCliAgentRuntimeServices` (which
  // owns `CLI_DETECTION_SERVICE`) runs a few lines further down.
  registerHarnessSyncServices(container, logger, {
    targets: ALL_HARNESS_TARGET_FACTORIES,
    cliDetector: createHarnessCliDetector(() =>
      container.isRegistered(TOKENS.CLI_DETECTION_SERVICE)
        ? container.resolve<HarnessCliDetectionReader>(
            TOKENS.CLI_DETECTION_SERVICE,
          )
        : null,
    ),
    sourceResolver: createPluginConfigSourceResolver(() => {
      if (!container.isRegistered(SDK_TOKENS.SDK_PLUGIN_LOADER)) return null;
      const loader = container.resolve<HarnessPluginConfigReader>(
        SDK_TOKENS.SDK_PLUGIN_LOADER,
      );
      // Every wrapper forwards `workspaceRoot`. Electron is the ONE host that
      // can have two folders open at once, so it is the one host where the
      // active workspace and the root being reconciled are routinely different
      // — dropping the argument here is how folder B's overlay was written into
      // folder A and reaped again on the way back (TASK_2026_346).
      return {
        resolveCurrentPluginPaths: (workspaceRoot) =>
          loader.resolveCurrentPluginPaths(workspaceRoot),
        // Dormant promoted skills are folded into the disabled channel here,
        // once, rather than at every reconcile call site. The residency
        // budget's decision is "this skill must not occupy prompt budget",
        // which is precisely what `disabledSkillIds` means to the builder.
        // Electron-only: the candidate store is a Thoth (SQLite) service.
        //
        // `readDormantSkillSlugs` takes no root and is NOT widened to take one:
        // `SkillCandidateStore` is backed by the single machine-level
        // `~/.ptah/ptah.db`, and dormancy is a residency-budget decision about
        // the model's prompt, not about a folder. Giving it a workspace
        // argument it does not honour would be a scope this side cannot keep.
        getDisabledSkillIds: (workspaceRoot) => [
          ...loader.getDisabledSkillIds(workspaceRoot),
          ...readDormantSkillSlugs(container),
        ],
        getWorkspacePluginConfig: (workspaceRoot) =>
          loader.getWorkspacePluginConfig(workspaceRoot),
      };
    }),
    // Batch 3. `HarnessPropagationService` runs this before each reconcile, so
    // a trigger that changed an upstream source is visible in `~/.ptah/user`
    // before the reconciler reads it. Lazy by construction — the mirror service
    // is registered by `registerAgentGenerationServices`, which runs below.
    userLayerRefresher: createUserLayerRefresher(container),
    gitignore: { readManageGitignore: () => readManageGitignore(container) },
    preflight: {
      readTimeoutMs: () => readPreflightTimeoutMs(container),
      contentGate: {
        awaitContentReady: (timeoutMs) =>
          container
            .resolve<ContentDownloadService>(PLATFORM_TOKENS.CONTENT_DOWNLOAD)
            .awaitContentReady(timeoutMs),
      },
    },
  });
  // The one line that lets a session path reach the reconciler without
  // `agent-sdk` importing `harness-sync`. See
  // `agent-sdk/src/lib/harness/harness-preflight.port.ts`.
  container.register(HARNESS_PREFLIGHT_TOKEN, {
    useToken: HARNESS_SYNC_TOKENS.PREFLIGHT,
  });
  registerCuratorAuthServices(container, logger);
  registerCliAgentRuntimeServices(container, logger);

  wireAgentAdapterAliases(container);
  try {
    container.register(TOKENS.WEBVIEW_MESSAGE_HANDLER, { useValue: {} });
    container.register(TOKENS.WEBVIEW_HTML_GENERATOR, { useValue: {} });
    logger.info(
      '[Electron DI] WEBVIEW_MESSAGE_HANDLER and WEBVIEW_HTML_GENERATOR stubs registered (TASK_2025_214)',
    );
  } catch (error) {
    logger.error(
      '[Electron DI] Failed to register webview stubs for WizardWebviewLifecycleService',
      { error: error instanceof Error ? error.message : String(error) },
    );
  }
  registerAgentGenerationServices(container, logger);
  container.register(AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE, {
    useClass: ElectronSetupWizardService,
  });
  logger.info(
    '[Electron DI] ElectronSetupWizardService registered (overrides SetupWizardService) (TASK_2025_214)',
  );
  try {
    const dbPath = resolvePtahDbPath();
    container.register(PERSISTENCE_TOKENS.SQLITE_DB_PATH, {
      useValue: dbPath,
    });
    const dirnameGlobal = (globalThis as unknown as { __dirname?: string })
      .__dirname;
    const workerEntry = path.join(
      dirnameGlobal ?? path.join(os.homedir(), '.ptah'),
      'embedder-worker.mjs',
    );

    const modelCacheDir = path.join(os.homedir(), '.ptah', 'models');
    try {
      fs.mkdirSync(modelCacheDir, { recursive: true });
    } catch (error) {
      logger.warn(
        '[Electron DI] Failed to create embedder model cache dir (non-fatal)',
        { error: error instanceof Error ? error.message : String(error) },
      );
    }

    // Embedder worker now runs in an Electron utilityProcess behind a
    // host-implemented factory port (mirrors voice). The client owns respawn /
    // idle-teardown / crash-loop; the factory owns fork + init config. Absent
    // this factory (VS Code / CLI) the embedder degrades to unavailable.
    container.register(MEMORY_TOKENS.EMBEDDER_WORKER_PROCESS_FACTORY, {
      useValue: new ElectronEmbedderWorkerFactory(workerEntry, modelCacheDir),
    });

    registerPersistenceSqliteServices(container, logger);
    try {
      const sqliteConnection = container.resolve<SqliteConnectionService>(
        PERSISTENCE_TOKENS.SQLITE_CONNECTION,
      );
      const electronVecResolver = createElectronVecPathResolver(logger);
      sqliteConnection.configure({
        vecPathResolver: electronVecResolver,
      });
    } catch (error) {
      logger.warn(
        '[Electron DI] Failed to wire electron vec resolver (non-fatal)',
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
    registerMemoryCuratorServices(container, logger);
    logger.info('[Electron DI] Memory curator services registered (Track 1)', {
      dbPath,
      workerEntry,
      modelCacheDir,
    });
  } catch (error) {
    logger.warn(
      '[Electron DI] Memory curator registration skipped (non-fatal)',
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
  registerSkillSynthesisServices(container, logger);
  registerTaskSpecsServices(container, logger);
  // Warm the index at activation (TASK_2026_179 step 11) so `.ptah/specs/
  // README.md` lands even for a user who never opens the Tasks board. Electron
  // restores its workspace AFTER DI, so the helper also re-attempts on
  // `onDidChangeWorkspaceFolders`. Non-blocking and failure-swallowing.
  startTaskSpecsIndex(container, logger);
  // output-styles registered in all three hosts: OutputStyleRpcHandlers is a
  // `requires: []` manifest entry, so every host resolves it. Its services
  // depend only on the Phase 1 platform adapters (FILE_SYSTEM_PROVIDER,
  // WORKSPACE_PROVIDER) and are consumed by Phase 3/4 handlers.
  registerOutputStyleServices(container, logger);
  container.registerInstance(
    SKILL_REPROPAGATION_TOKEN,
    new ElectronSkillRepropagation(container),
  );
  try {
    registerCronSchedulerServices(container, logger);
    logger.info('[Electron DI] Cron scheduler services registered (Track 3)');
  } catch (error) {
    logger.warn(
      '[Electron DI] Cron scheduler registration skipped (non-fatal)',
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
  try {
    container.register(GATEWAY_TOKENS.GATEWAY_TOKEN_VAULT, {
      useClass: ElectronSafeStorageVault,
    });
    // Host-implemented command-plane collaborators (TASK_2026_156 §4.3) —
    // registered before registerMessagingGatewayServices per its doc contract.
    container.register(GATEWAY_TOKENS.GATEWAY_SESSION_LISTER, {
      useFactory: (c) =>
        new MetadataGatewaySessionLister(
          c.resolve<WorkspaceAwareStateStorage>(
            PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE,
          ),
        ),
    });
    container.register<ISessionActivityProbe>(
      GATEWAY_TOKENS.GATEWAY_SESSION_ACTIVITY_PROBE,
      {
        useFactory: (c) => ({
          isActive: (sessionUuid: string): boolean => {
            try {
              const adapter = c.resolve<IAgentAdapter>(TOKENS.AGENT_ADAPTER);
              return adapter.isSessionActive(SessionId.from(sessionUuid));
            } catch (error: unknown) {
              // No resolvable adapter / invalid uuid → nothing can be running.
              logger.warn(
                '[Electron DI] session activity probe fell back to inactive',
                {
                  error: error instanceof Error ? error.message : String(error),
                },
              );
              return false;
            }
          },
        }),
      },
    );
    // Voice providers must be registered before GatewayService resolves — it
    // now injects VOICE_PROVIDER_SELECTOR for voice-note transcription.
    configureElectronVoiceProviders(container, logger);
    registerMessagingGatewayServices(container, logger);
    registerGatewayChatBridge(container, logger);
    logger.info(
      '[Electron DI] Messaging gateway services registered (Track 4)',
    );
  } catch (error) {
    logger.warn(
      '[Electron DI] Messaging gateway registration skipped (non-fatal)',
      { error: error instanceof Error ? error.message : String(error) },
    );
  }
}

// Native ffmpeg cannot spawn from inside app.asar (the archive is a file).
// Returns the unpacked node_modules dir when packaged, or null in
// dev/unpacked builds where the library's own resolution already works.
function resolveUnpackedNodeModulesDir(): string | null {
  const candidates: string[] = [];
  if (
    typeof process.resourcesPath === 'string' &&
    process.resourcesPath.length > 0
  ) {
    candidates.push(
      path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules'),
    );
  }
  try {
    const appPath = app.getAppPath();
    if (appPath.endsWith('app.asar')) {
      candidates.push(path.join(appPath + '.unpacked', 'node_modules'));
    }
  } catch {
    /* app.getAppPath() unavailable — fall through to resourcesPath candidate */
  }
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

// Native ffmpeg cannot spawn from inside app.asar. When packaged, resolve the
// unpacked binary; in dev/unpacked builds fall back to ffmpeg-static's own
// resolution (require) so the worker still receives a usable path.
function resolveElectronFfmpegPath(logger: Logger): string | null {
  const unpacked = resolveUnpackedNodeModulesDir();
  const ffmpegBinary = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  if (unpacked) {
    return path.join(unpacked, 'ffmpeg-static', ffmpegBinary);
  }
  try {
    const resolved = require('ffmpeg-static') as string | { default?: string };
    if (typeof resolved === 'string') return resolved;
    if (resolved && typeof resolved.default === 'string') {
      return resolved.default;
    }
  } catch (error) {
    logger.warn('[Electron DI] ffmpeg-static resolution failed (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return null;
}

function configureElectronVoiceProviders(
  container: DependencyContainer,
  logger: Logger,
): void {
  const dirnameGlobal = (globalThis as unknown as { __dirname?: string })
    .__dirname;
  const workerPath = path.join(
    dirnameGlobal ?? path.join(os.homedir(), '.ptah'),
    'voice-worker.mjs',
  );
  const modelCacheDir = path.join(os.homedir(), '.ptah', 'models');
  const ffmpegPath = resolveElectronFfmpegPath(logger);

  container.register(VOICE_TOKENS.VOICE_WORKER_PATH, { useValue: workerPath });
  container.register(VOICE_TOKENS.VOICE_MODEL_CACHE_DIR, {
    useValue: modelCacheDir,
  });
  container.register(VOICE_TOKENS.VOICE_WORKER_PROCESS_FACTORY, {
    useValue: new ElectronVoiceWorkerFactory(
      workerPath,
      ffmpegPath,
      modelCacheDir,
    ),
  });
  // Dual-register the SAME vault under the voice port token (D4 — structural
  // twin, no adapter class needed).
  container.register(VOICE_CONTRACT_TOKENS.VOICE_TOKEN_VAULT, {
    useFactory: (c) => c.resolve(GATEWAY_TOKENS.GATEWAY_TOKEN_VAULT),
  });

  registerVoiceProviderServices(container, logger);
  logger.info('[Electron DI] Voice providers registered', {
    workerPath,
    modelCacheDir,
    ffmpegConfigured: ffmpegPath !== null,
  });
}

function createElectronVecPathResolver(logger: Logger): SqliteVecPathResolver {
  return () => {
    const packageName = resolveVecPackageName();
    if (!packageName) {
      throw new Error(
        `[Electron DI] no sqlite-vec package mapping for ${process.platform}/${process.arch}`,
      );
    }
    const binaryName = resolveVecBinaryName();
    const candidates: string[] = [];
    if (
      typeof process.resourcesPath === 'string' &&
      process.resourcesPath.length > 0
    ) {
      candidates.push(
        path.join(
          process.resourcesPath,
          'app.asar.unpacked',
          'node_modules',
          packageName,
          binaryName,
        ),
      );
    }
    let appPath: string | undefined;
    try {
      appPath = app.getAppPath();
    } catch (error: unknown) {
      logger.warn(
        '[Electron DI] app.getAppPath() unavailable during vec fallback resolution',
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
    if (appPath && appPath.endsWith('app.asar')) {
      candidates.push(
        path.join(
          appPath + '.unpacked',
          'node_modules',
          packageName,
          binaryName,
        ),
      );
    }
    if (appPath) {
      candidates.push(
        path.join(appPath, 'node_modules', packageName, binaryName),
      );
    }
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch (error: unknown) {
        logger.warn('[Electron DI] fs.existsSync threw for vec candidate', {
          candidate,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    throw new Error(
      `[Electron DI] no sqlite-vec binary found among electron-host candidates: ${candidates.join(' | ')}`,
    );
  };
}
