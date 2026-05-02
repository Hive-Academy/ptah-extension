/**
 * Electron DI — Phase 2: Library registrations.
 *
 * TASK_2025_291 Wave C1 Step 2b: Split from the monolithic container.ts.
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

import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { registerWorkspaceIntelligenceServices } from '@ptah-extension/workspace-intelligence';
import {
  registerSdkServices,
  SDK_TOKENS,
  SdkAgentAdapter,
} from '@ptah-extension/agent-sdk';
import {
  registerAgentGenerationServices,
  AGENT_GENERATION_TOKENS,
} from '@ptah-extension/agent-generation';
// === TRACK_1_MEMORY_CURATOR_BEGIN ===
import {
  registerPersistenceSqliteServices,
  PERSISTENCE_TOKENS,
} from '@ptah-extension/persistence-sqlite';
import { registerMemoryCuratorServices } from '@ptah-extension/memory-curator';
import * as path from 'node:path';
import * as os from 'node:os';
// === TRACK_1_MEMORY_CURATOR_END ===
// === TRACK_2_SKILL_SYNTHESIS_BEGIN ===
import { registerSkillSynthesisServices } from '@ptah-extension/skill-synthesis';
// === TRACK_2_SKILL_SYNTHESIS_END ===
// === TRACK_4_MESSAGING_GATEWAY_BEGIN ===
import {
  registerMessagingGatewayServices,
  GATEWAY_TOKENS,
} from '@ptah-extension/messaging-gateway';
import { ElectronSafeStorageVault } from '../services/platform/electron-safe-storage-vault';
// === TRACK_4_MESSAGING_GATEWAY_END ===
import { ElectronSetupWizardService } from '../services/electron-setup-wizard.service';

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
  // ========================================
  // PHASE 2.1: Workspace Intelligence
  // ========================================
  registerWorkspaceIntelligenceServices(container, logger);

  // ========================================
  // PHASE 2.2: Agent SDK (Claude Agent SDK integration)
  // ========================================
  // NOTE: registerVsCodeLmToolsServices is called in Phase 3 (TASK_2025_226 decoupled it from VS Code)
  registerSdkServices(container, logger);

  // TOKENS.AGENT_ADAPTER -> SdkAgentAdapter (direct binding, deep-agent removed TASK_2025_293)
  // NOTE: tsyringe rejects Lifecycle.Singleton with factory providers. The factory
  // delegates to SDK_TOKENS.SDK_AGENT_ADAPTER which is already registered as a
  // singleton (useClass + Lifecycle.Singleton in registerSdkServices), so every
  // call returns the same cached instance.
  container.register(TOKENS.AGENT_ADAPTER, {
    useFactory: (c) => c.resolve<SdkAgentAdapter>(SDK_TOKENS.SDK_AGENT_ADAPTER),
  });

  // ========================================
  // PHASE 2.2.5: WEBVIEW_MESSAGE_HANDLER and WEBVIEW_HTML_GENERATOR stubs (TASK_2025_214)
  // ========================================
  // These tokens are required by WizardWebviewLifecycleService which is registered
  // unconditionally inside registerAgentGenerationServices(). In Electron, the wizard
  // uses ElectronSetupWizardService instead, so these are no-op stubs to prevent
  // DI resolution failures.
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

  // ========================================
  // PHASE 2.3: Agent Generation (template storage, setup wizard)
  // ========================================
  registerAgentGenerationServices(container, logger);

  // ========================================
  // PHASE 2.3.5: Override SETUP_WIZARD_SERVICE with Electron-specific implementation (TASK_2025_214)
  // ========================================
  // ElectronSetupWizardService uses IPC navigation (broadcastMessage) instead of
  // VS Code webview panels. Registered AFTER registerAgentGenerationServices() so
  // it overrides the default SetupWizardService at AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE.
  container.register(AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE, {
    useClass: ElectronSetupWizardService,
  });
  logger.info(
    '[Electron DI] ElectronSetupWizardService registered (overrides SetupWizardService) (TASK_2025_214)',
  );

  // Phase 2.4: Wire multi-phase analysis reader into EnhancedPromptsService
  // DEFERRED to main.ts Phase 4.6 (after WebviewManager registration).
  // Resolving EnhancedPromptsService here fails because the dependency chain
  // reaches SdkPermissionHandler which requires TOKENS.WEBVIEW_MANAGER,
  // and that is only registered in main.ts after IPC bridge initialization.

  // TASK_2025_291 Wave C5: CLI agent services (CliDetectionService,
  // AgentProcessManager, CliPluginSyncService) are now registered by
  // registerSdkServices (called earlier in Phase 2). The llm-abstraction
  // library has been deleted.

  // === TRACK_1_MEMORY_CURATOR_BEGIN ===
  // ========================================
  // PHASE 2.55: Persistence-SQLite + Memory Curator (TASK_2026_HERMES Track 1)
  // ========================================
  // Registers SqliteConnectionService (Track 0) and the memory curator
  // services (MemoryStore, MemorySearchService, MemoryCuratorService,
  // EmbedderWorkerClient bound to PERSISTENCE_TOKENS.EMBEDDER, etc.).
  //
  // SQLite DB path: ~/.ptah/state/ptah.sqlite (created by openAndMigrate).
  // Embedder worker path: dist/apps/ptah-electron/embedder-worker.mjs.
  //
  // The connection itself is opened lazily in wire-runtime Phase 4.51 so
  // that DI registration cannot fail on a missing better-sqlite3 binding.
  try {
    const dbPath = path.join(os.homedir(), '.ptah', 'state', 'ptah.sqlite');
    container.register(PERSISTENCE_TOKENS.SQLITE_DB_PATH, {
      useValue: dbPath,
    });

    // Resolve the embedder worker entry from the same dist directory as
    // main.mjs (build-embedder-worker target emits embedder-worker.mjs).
    // `__dirname` is provided by the esbuild CommonJS banner in the
    // bundled main.mjs and natively in ts-jest, so a runtime probe via
    // `(globalThis as { __dirname?: string }).__dirname` keeps us
    // tsconfig-agnostic.
    const dirnameGlobal = (globalThis as unknown as { __dirname?: string })
      .__dirname;
    const workerEntry = path.join(
      dirnameGlobal ?? path.join(os.homedir(), '.ptah'),
      'embedder-worker.mjs',
    );
    container.register(PERSISTENCE_TOKENS.EMBEDDER_WORKER_PATH, {
      useValue: workerEntry,
    });

    registerPersistenceSqliteServices(container, logger);
    registerMemoryCuratorServices(container, logger);
    logger.info('[Electron DI] Memory curator services registered (Track 1)', {
      dbPath,
      workerEntry,
    });
  } catch (error) {
    logger.warn(
      '[Electron DI] Memory curator registration skipped (non-fatal)',
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
  // === TRACK_1_MEMORY_CURATOR_END ===

  // === TRACK_2_SKILL_SYNTHESIS_BEGIN ===
  // ========================================
  // PHASE 2.6: Skill Synthesis (TASK_2026_HERMES Track 2)
  // ========================================
  // Registers SkillSynthesisService, SkillPromotionService,
  // SkillInvocationTracker, SkillCandidateStore, SkillMdGenerator,
  // TrajectoryExtractor + symbol tokens. Depends on persistence-sqlite
  // (Track 0) for SQLite + vec0 storage and on agent-sdk's JsonlReader
  // for trajectory extraction; both are registered earlier in Phase 2.
  registerSkillSynthesisServices(container, logger);
  // === TRACK_2_SKILL_SYNTHESIS_END ===

  // === TRACK_4_MESSAGING_GATEWAY_BEGIN ===
  // ========================================
  // PHASE 2.7: Messaging Gateway (TASK_2026_HERMES Track 4)
  // ========================================
  // Registers GatewayService, BindingStore, MessageStore, three adapters
  // (Telegram/Discord/Slack), voice pipeline (FfmpegDecoder, WhisperTranscriber).
  // The vault binding (GATEWAY_TOKEN_VAULT → ElectronSafeStorageVault) is wired
  // here as well so the service can be constructed even before Phase 3 runs.
  // Depends on persistence-sqlite (Track 0) for binding/message storage —
  // SqliteConnectionService is resolved lazily on first inbound message, so
  // the registration itself does not fail when Track 0 isn't yet wired.
  try {
    container.register(GATEWAY_TOKENS.GATEWAY_TOKEN_VAULT, {
      useClass: ElectronSafeStorageVault,
    });
    registerMessagingGatewayServices(container, logger);
    logger.info(
      '[Electron DI] Messaging gateway services registered (Track 4)',
    );
  } catch (error) {
    logger.warn(
      '[Electron DI] Messaging gateway registration skipped (non-fatal)',
      { error: error instanceof Error ? error.message : String(error) },
    );
  }
  // === TRACK_4_MESSAGING_GATEWAY_END ===
}
