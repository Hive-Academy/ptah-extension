/**
 * Phase 2 — Library Services (workspace-intelligence, vscode-lm-tools, agent-sdk,
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

import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
import { registerWorkspaceIntelligenceServices } from '@ptah-extension/workspace-intelligence';
// NOTE: persistence-sqlite, memory-curator, skill-synthesis, cron-scheduler
// are intentionally NOT imported here. SQLite-backed features (Cron, Gateway,
// Memory, Skill Synthesis) are Electron-only by design — see
// rpc-method-registration.service.ts ELECTRON_ONLY_METHODS. The VS Code build
// must not register these tokens or the activation chain will eagerly load
// better-sqlite3's native binary, which is not shipped with the marketplace
// VSIX (would require platform-specific packages).
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
  // Workspace Intelligence Services
  registerWorkspaceIntelligenceServices(container, logger);

  // Code Execution MCP
  registerVsCodeLmToolsServices(container, logger);

  // Register VS Code IDE capabilities for PtahAPIBuilder. VscodeIDECapabilities
  // wraps VS Code's LSP commands, editor state, and code actions. PtahAPIBuilder
  // resolves this lazily via `container.isRegistered(IDE_CAPABILITIES_TOKEN)`.
  // In Electron, this token is NOT registered, so `buildIDENamespace()` returns
  // graceful degradation stubs.
  container.register(IDE_CAPABILITIES_TOKEN, {
    useValue: new VscodeIDECapabilities(),
  });

  // Register browser capabilities for PtahAPIBuilder.
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

  // Agent SDK Integration — register Agent SDK services (adapter, storage,
  // permission handler). SdkPermissionHandler handles permission emitter
  // directly. SDK services inject platform abstractions via PLATFORM_TOKENS
  // instead of receiving vscode.ExtensionContext.
  registerSdkServices(container, logger);

  // Override CopilotAuthService with VS Code-enhanced version.
  // VscodeCopilotAuthService adds native GitHub OAuth via vscode.authentication
  // (best UX in VS Code) before falling back to file-based/device-code flow.
  container.register(
    SDK_TOKENS.SDK_COPILOT_AUTH,
    { useClass: VscodeCopilotAuthService },
    { lifecycle: Lifecycle.Singleton },
  );

  // TOKENS.AGENT_ADAPTER -> SdkAgentAdapter (direct binding).
  // tsyringe rejects `Lifecycle.Singleton` with factory providers. The factory
  // delegates to `SDK_TOKENS.SDK_AGENT_ADAPTER` which IS already a singleton
  // (useClass + Lifecycle.Singleton in registerSdkServices), so every call
  // returns the same cached instance.
  container.register(TOKENS.AGENT_ADAPTER, {
    useFactory: (c) => c.resolve<SdkAgentAdapter>(SDK_TOKENS.SDK_AGENT_ADAPTER),
  });

  // Agent Generation Services — SetupStatusService, SetupWizardService, and
  // supporting services required for setup wizard functionality. Services
  // inject IPlatformInfo directly via PLATFORM_TOKENS.PLATFORM_INFO.
  registerAgentGenerationServices(container, logger);

  // Wire multi-phase analysis reader into EnhancedPromptsService. Both SDK
  // and agent-generation services are now registered, so we can safely resolve
  // and connect them for optional multi-phase enrichment.
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

  // Shared LlmRpcHandlers (from @ptah-extension/rpc-handlers) is platform-
  // agnostic and registered by the handlers phase as AppLlmRpcHandlers.
  //
  // CLI agent services (CliDetectionService, AgentProcessManager,
  // CliPluginSyncService) are registered by registerSdkServices (called
  // earlier in this phase). The llm-abstraction library has been deleted.

  // SQLite-backed services — INTENTIONALLY NOT REGISTERED.
  // Persistence-SQLite, Memory Curator, Skill Synthesis, Cron Scheduler, and
  // Messaging Gateway are Electron-only. The VS Code marketplace VSIX is a
  // single cross-platform package and does not ship `better-sqlite3` /
  // `sqlite-vec` native binaries (those would require per-platform VSIXes).
  //
  // The Thoth shell tabs (Memory / Skills / Cron / Gateway) detect the
  // missing DI registrations and render a "desktop-only" placeholder. The
  // ELECTRON_ONLY_METHODS list in rpc-method-registration.service.ts
  // documents the corresponding RPC methods that are intentionally absent.
  logger.info('[DI] SQLite-backed services skipped — Electron-only by design');
}
