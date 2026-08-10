/**
 * Phase 2 â€” Library Services (workspace-intelligence, vscode-lm-tools, agent-sdk,
 *                             agent-generation)
 *
 * Runs AFTER `registerPhase3Handlers` in `DIContainer.setup`. RPC handlers are
 * registered before workspace intelligence. Handler factories are lazy, so the
 * SDK / agent-generation tokens they resolve are safely supplied here before
 * any actual resolution happens via
 * `container.resolve(RPC_METHOD_REGISTRATION_SERVICE)`.
 */

import { Lifecycle } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';

import type { Logger } from '@ptah-extension/vscode-core';
import { registerWorkspaceIntelligenceServices } from '@ptah-extension/workspace-intelligence';
import {
  registerTaskSpecsServices,
  startTaskSpecsIndex,
} from '@ptah-extension/task-specs';
import { registerOutputStyleServices } from '@ptah-extension/output-styles';
import {
  registerVsCodeLmToolsServices,
  IDE_CAPABILITIES_TOKEN,
  BROWSER_CAPABILITIES_TOKEN,
  ChromeLauncherBrowserCapabilities,
} from '@ptah-extension/vscode-lm-tools';
import { VscodeIDECapabilities } from '@ptah-extension/vscode-lm-tools/vscode';
import {
  registerSdkServices,
  wireAgentAdapterAliases,
} from '@ptah-extension/agent-sdk';
import {
  registerAuthProvidersServices,
  AUTH_PROVIDERS_TOKENS,
  VscodeCopilotAuthService,
} from '@ptah-extension/auth-providers';
import { registerCliAgentRuntimeServices } from '@ptah-extension/cli-agent-runtime';
import {
  registerAgentGenerationServices,
  AGENT_GENERATION_TOKENS,
  EnhancedPromptsService,
} from '@ptah-extension/agent-generation';
import type { IMultiPhaseAnalysisReader } from '@ptah-extension/agent-generation';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
export function registerPhase2Libraries(
  container: DependencyContainer,
  logger: Logger,
): void {
  registerWorkspaceIntelligenceServices(container, logger);
  // task-specs registered in all three hosts (G1). The SQLite-backed index
  // store is selected lazily inside registerTaskSpecsServices via
  // isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION) — VS Code registers the
  // connection later in wire-runtime, so the store choice is deferred to first
  // resolution (wire-runtime.ts:176 precedent).
  registerTaskSpecsServices(container, logger);
  // Warm the index at activation (TASK_2026_179 step 11) so `.ptah/specs/
  // README.md` lands even for a user who never opens the Tasks board. Non-
  // blocking and failure-swallowing by contract — see startTaskSpecsIndex.
  startTaskSpecsIndex(container, logger);
  // output-styles registered in all three hosts: OutputStyleRpcHandlers is a
  // `requires: []` manifest entry, so every host resolves it. Its services
  // depend only on the Phase 1 platform adapters (FILE_SYSTEM_PROVIDER,
  // WORKSPACE_PROVIDER) and are consumed by Phase 3/4 handlers.
  registerOutputStyleServices(container, logger);
  registerVsCodeLmToolsServices(container, logger);
  container.register(IDE_CAPABILITIES_TOKEN, {
    useValue: new VscodeIDECapabilities(),
  });
  {
    const workspaceProvider = container.resolve<IWorkspaceProvider>(
      PLATFORM_TOKENS.WORKSPACE_PROVIDER,
    );
    container.register(BROWSER_CAPABILITIES_TOKEN, {
      useValue: new ChromeLauncherBrowserCapabilities(() => {
        const configured =
          workspaceProvider.getConfiguration<string>(
            'ptah',
            'browser.recordingDir',
            '',
          ) ?? '';
        if (configured) return configured;
        const wsRoot = workspaceProvider.getWorkspaceRoot();
        if (wsRoot) return `${wsRoot}/.ptah/recordings`;
        return '';
      }),
    });
  }
  registerAuthProvidersServices(container, logger);
  registerSdkServices(container, logger);
  registerCliAgentRuntimeServices(container, logger);
  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_COPILOT_AUTH,
    { useClass: VscodeCopilotAuthService },
    { lifecycle: Lifecycle.Singleton },
  );

  wireAgentAdapterAliases(container);

  registerAgentGenerationServices(container, logger);
  try {
    const enhancedPrompts = container.resolve<EnhancedPromptsService>(
      AGENT_GENERATION_TOKENS.ENHANCED_PROMPTS_SERVICE,
    );
    const analysisStorage = container.resolve<IMultiPhaseAnalysisReader>(
      AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE,
    );
    enhancedPrompts.setAnalysisReader(analysisStorage);
  } catch (error) {
    logger.warn(
      '[DI] Failed to wire multi-phase analysis reader into EnhancedPromptsService',
      { error: error instanceof Error ? error.message : String(error) },
    );
  }
  logger.info(
    '[DI] SQLite-backed services skipped â€” Electron-only by design',
  );
}
