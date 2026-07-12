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
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { SessionId, type IAgentAdapter } from '@ptah-extension/shared';
import { registerWorkspaceIntelligenceServices } from '@ptah-extension/workspace-intelligence';
import {
  registerSdkServices,
  wireAgentAdapterAliases,
} from '@ptah-extension/agent-sdk';
import {
  registerAuthProvidersServices,
  registerCuratorAuthServices,
} from '@ptah-extension/auth-providers';
import { registerCliAgentRuntimeServices } from '@ptah-extension/cli-agent-runtime';
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
import { registerMemoryCuratorServices } from '@ptah-extension/memory-curator';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  registerSkillSynthesisServices,
  SKILL_REPROPAGATION_TOKEN,
} from '@ptah-extension/skill-synthesis';
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
import { MetadataGatewaySessionLister } from '../services/gateway/metadata-gateway-session-lister';
import { ElectronSetupWizardService } from '../services/electron-setup-wizard.service';
import { ElectronSkillRepropagation } from '../activation/skill-repropagation';

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
  registerAuthProvidersServices(container, logger);
  registerSdkServices(container, logger);
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
    container.register(PERSISTENCE_TOKENS.EMBEDDER_WORKER_PATH, {
      useValue: workerEntry,
    });

    const modelCacheDir = path.join(os.homedir(), '.ptah', 'models');
    try {
      fs.mkdirSync(modelCacheDir, { recursive: true });
    } catch (error) {
      logger.warn(
        '[Electron DI] Failed to create embedder model cache dir (non-fatal)',
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
    container.register(PERSISTENCE_TOKENS.EMBEDDER_MODEL_CACHE_DIR, {
      useValue: modelCacheDir,
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
