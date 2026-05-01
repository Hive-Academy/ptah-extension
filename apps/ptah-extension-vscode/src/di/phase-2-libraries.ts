/**
 * Phase 2 — Library Services (workspace-intelligence, vscode-lm-tools, agent-sdk,
 *                             agent-generation, llm-abstraction)
 *
 * Extracted from `container.ts` as part of TASK_2025_291 Wave C1, Step 2a.
 * Corresponds to the original file's Phase 2 / 2.5 / 2.7 / 2.8 / 2.9 blocks.
 *
 * Runs AFTER `registerPhase3Handlers` in `DIContainer.setup`. This preserves the
 * original container's ordering (RPC handlers registered before workspace
 * intelligence). Handler factories are lazy, so the SDK / agent-generation /
 * llm-abstraction tokens they resolve are safely supplied here before any actual
 * resolution happens via `container.resolve(RPC_METHOD_REGISTRATION_SERVICE)`.
 */

import { Lifecycle } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';

import { TOKENS } from '@ptah-extension/vscode-core';
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
  SDK_TOKENS,
  EnhancedPromptsService,
  VscodeCopilotAuthService,
  SdkAgentAdapter,
} from '@ptah-extension/agent-sdk';
import type { IMultiPhaseAnalysisReader } from '@ptah-extension/agent-sdk';
import {
  registerAgentGenerationServices,
  AGENT_GENERATION_TOKENS,
} from '@ptah-extension/agent-generation';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';

export function registerPhase2Libraries(
  container: DependencyContainer,
  logger: Logger,
): void {
  // ========================================
  // PHASE 2: Workspace Intelligence Services
  // ========================================
  registerWorkspaceIntelligenceServices(container, logger);

  // ========================================
  // PHASE 2.5: Code Execution MCP (TASK_2025_025)
  // ========================================
  registerVsCodeLmToolsServices(container, logger);

  // TASK_2025_226: Register VS Code IDE capabilities for PtahAPIBuilder.
  // VscodeIDECapabilities wraps VS Code's LSP commands, editor state, and code
  // actions. PtahAPIBuilder resolves this lazily via
  // `container.isRegistered(IDE_CAPABILITIES_TOKEN)`. In Electron, this token is
  // NOT registered, so `buildIDENamespace()` returns graceful degradation stubs.
  container.register(IDE_CAPABILITIES_TOKEN, {
    useValue: new VscodeIDECapabilities(),
  });

  // TASK_2025_244: Register browser capabilities for PtahAPIBuilder.
  // ChromeLauncherBrowserCapabilities uses chrome-launcher + chrome-remote-interface
  // to launch and control Chrome for browser automation tools. Headless/viewport
  // are agent-controlled via `ptah_browser_navigate` params.
  {
    const workspaceProvider = container.resolve<IWorkspaceProvider>(
      PLATFORM_TOKENS.WORKSPACE_PROVIDER,
    );
    container.register(BROWSER_CAPABILITIES_TOKEN, {
      useValue: new ChromeLauncherBrowserCapabilities(
        // getRecordingDir — routed via file-based settings for Electron parity.
        // Defaults to {workspace}/.ptah/recordings/ when no explicit dir is configured.
        () => {
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
        },
      ),
    });
  }

  // ========================================
  // PHASE 2.7: Agent SDK Integration (TASK_2025_044 Batch 3)
  // ========================================
  // Register Agent SDK services (adapter, storage, permission handler).
  // TASK_2025_092: SdkPermissionHandler now handles permission emitter directly.
  // TASK_2025_199: Removed context parameter — SDK services inject platform
  // abstractions via PLATFORM_TOKENS instead of receiving vscode.ExtensionContext.
  registerSdkServices(container, logger);

  // TASK_2025_224: Override CopilotAuthService with VS Code-enhanced version.
  // VscodeCopilotAuthService adds native GitHub OAuth via vscode.authentication
  // (best UX in VS Code) before falling back to file-based/device-code flow.
  container.register(
    SDK_TOKENS.SDK_COPILOT_AUTH,
    { useClass: VscodeCopilotAuthService },
    { lifecycle: Lifecycle.Singleton },
  );

  // TOKENS.AGENT_ADAPTER -> SdkAgentAdapter (direct binding, deep-agent removed TASK_2025_293).
  // tsyringe rejects `Lifecycle.Singleton` with factory providers. The factory
  // delegates to `SDK_TOKENS.SDK_AGENT_ADAPTER` which IS already a singleton
  // (useClass + Lifecycle.Singleton in registerSdkServices), so every call
  // returns the same cached instance.
  container.register(TOKENS.AGENT_ADAPTER, {
    useFactory: (c) => c.resolve<SdkAgentAdapter>(SDK_TOKENS.SDK_AGENT_ADAPTER),
  });

  // ========================================
  // PHASE 2.8: Agent Generation Services (TASK_2025_069)
  // ========================================
  // SetupStatusService, SetupWizardService, and supporting services required
  // for setup wizard functionality.
  // TASK_2025_199: Removed extensionPath parameter — services now inject
  // IPlatformInfo directly via PLATFORM_TOKENS.PLATFORM_INFO.
  registerAgentGenerationServices(container, logger);

  // TASK_2025_154: Wire multi-phase analysis reader into EnhancedPromptsService.
  // Both SDK and agent-generation services are now registered, so we can safely
  // resolve and connect them for optional multi-phase enrichment.
  try {
    const enhancedPrompts = container.resolve<EnhancedPromptsService>(
      SDK_TOKENS.SDK_ENHANCED_PROMPTS_SERVICE,
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

  // TASK_2025_209: TOKENS.LLM_RPC_HANDLERS deleted. Shared LlmRpcHandlers (from
  // @ptah-extension/rpc-handlers) is now platform-agnostic and registered in
  // Phase 1.6 as AppLlmRpcHandlers.
  //
  // TASK_2025_291 Wave C5: CLI agent services (CliDetectionService,
  // AgentProcessManager, CliPluginSyncService) are now registered by
  // registerSdkServices (called earlier in Phase 2). The llm-abstraction
  // library has been deleted.
}
