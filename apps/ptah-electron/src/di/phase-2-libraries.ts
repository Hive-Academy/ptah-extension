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

import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { registerWorkspaceIntelligenceServices } from '@ptah-extension/workspace-intelligence';
import {
  registerSdkServices,
  wireAgentAdapterAliases,
} from '@ptah-extension/agent-sdk';
import { registerAuthProvidersServices } from '@ptah-extension/auth-providers';
import { registerCliAgentRuntimeServices } from '@ptah-extension/cli-agent-runtime';
import {
  registerAgentGenerationServices,
  AGENT_GENERATION_TOKENS,
} from '@ptah-extension/agent-generation';
import {
  registerPersistenceSqliteServices,
  PERSISTENCE_TOKENS,
} from '@ptah-extension/persistence-sqlite';
import { registerMemoryCuratorServices } from '@ptah-extension/memory-curator';
import * as path from 'node:path';
import * as os from 'node:os';
import { registerSkillSynthesisServices } from '@ptah-extension/skill-synthesis';
import { registerCronSchedulerServices } from '@ptah-extension/cron-scheduler';
import {
  registerMessagingGatewayServices,
  GATEWAY_TOKENS,
} from '@ptah-extension/messaging-gateway';
import { ElectronSafeStorageVault } from '../services/platform/electron-safe-storage-vault';
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
  registerWorkspaceIntelligenceServices(container, logger);
  registerAuthProvidersServices(container, logger);
  registerSdkServices(container, logger);
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
    const isDev = process.env['NODE_ENV'] === 'development';
    const dbFileName = isDev ? 'ptah-dev.sqlite' : 'ptah.sqlite';
    const dbPath = path.join(os.homedir(), '.ptah', 'state', dbFileName);
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
  registerSkillSynthesisServices(container, logger);
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
}
