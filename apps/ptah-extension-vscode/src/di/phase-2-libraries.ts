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
import {
  MEMORY_CONTRACT_TOKENS,
  type IMemoryReader,
  type IMemoryLister,
  type ISymbolSink,
} from '@ptah-extension/memory-contracts';

export function registerPhase2Libraries(
  container: DependencyContainer,
  logger: Logger,
): void {
  registerWorkspaceIntelligenceServices(container, logger);
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

  const noopMemoryReader: IMemoryReader = {
    search: async () => ({ hits: [], bm25Only: true }),
  };
  container.register(MEMORY_CONTRACT_TOKENS.MEMORY_READER, {
    useValue: noopMemoryReader,
  });

  const noopMemoryLister: IMemoryLister = {
    listAll: () => ({ memories: [], total: 0 }),
  };
  container.register(MEMORY_CONTRACT_TOKENS.MEMORY_LISTER, {
    useValue: noopMemoryLister,
  });

  const noopSymbolSink: ISymbolSink = {
    deleteSymbolsForFile: () => 0,
    insertSymbols: async () => undefined,
  };
  container.register(MEMORY_CONTRACT_TOKENS.SYMBOL_SINK, {
    useValue: noopSymbolSink,
  });
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
