/**
 * Electron DI — Phase 4: RPC handler registrations.
 *
 * TASK_2025_291 Wave C1 Step 2b: Split from the monolithic container.ts.
 *
 * Registers:
 *   - Phase 4.1: 18 shared RPC handler classes (5 factory-based for lazy
 *                container/webview resolution, 13 singletons).
 *   - Phase 4.2: 11 Electron-specific RPC handler classes + GitInfoService +
 *                PtyManagerService + ElectronRpcMethodRegistrationService orchestrator.
 */

import type { DependencyContainer } from 'tsyringe';

import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';

// Shared RPC handler classes (TASK_2025_203 Batch 5: all shared handlers).
// These are platform-agnostic handlers that can be used in both VS Code and Electron.
// TASK_2025_209: LlmRpcHandlers now included (rewritten to be platform-agnostic).
// TASK_2025_241: WebSearchRpcHandlers added (web search settings management).
import {
  SessionRpcHandlers,
  ChatRpcHandlers,
  ConfigRpcHandlers,
  AuthRpcHandlers,
  ContextRpcHandlers,
  SetupRpcHandlers,
  LicenseRpcHandlers,
  WizardGenerationRpcHandlers,
  AutocompleteRpcHandlers,
  SubagentRpcHandlers,
  PluginRpcHandlers,
  PtahCliRpcHandlers,
  EnhancedPromptsRpcHandlers,
  QualityRpcHandlers,
  ProviderRpcHandlers,
  LlmRpcHandlers,
  WebSearchRpcHandlers,
  HarnessRpcHandlers,
} from '@ptah-extension/rpc-handlers';

// Electron-specific RPC handler classes (TASK_2025_203 Batch 5).
// TASK_2025_209: ElectronLlmRpcHandlers, ElectronChatExtendedRpcHandlers removed (unified into shared).
// Re-added: ElectronAgentRpcHandlers, ElectronSkillsShRpcHandlers, ElectronLayoutRpcHandlers.
import {
  ElectronWorkspaceRpcHandlers,
  ElectronEditorRpcHandlers,
  ElectronFileRpcHandlers,
  ElectronConfigExtendedRpcHandlers,
  ElectronCommandRpcHandlers,
  ElectronSettingsRpcHandlers,
  ElectronAgentRpcHandlers,
  ElectronSkillsShRpcHandlers,
  ElectronLayoutRpcHandlers,
  ElectronGitRpcHandlers,
  ElectronTerminalRpcHandlers,
} from '../services/rpc/handlers';

import { GitInfoService } from '../services/git-info.service';
import { PtyManagerService } from '../services/pty-manager.service';
import { ELECTRON_TOKENS } from './electron-tokens';
import { ElectronRpcMethodRegistrationService } from '../services/rpc/rpc-method-registration.service';

/**
 * Phase 4: Register all RPC handler classes and the orchestrator service.
 *
 * Prerequisites: Phases 0–3 must have registered all dependencies the factory
 * bodies resolve. Registrations themselves are lazy; actual resolution happens
 * when ElectronRpcMethodRegistrationService.registerAll() runs in main.ts.
 *
 * NOTE: Factory-based registrations (SetupRpcHandlers, WizardGenerationRpcHandlers,
 * EnhancedPromptsRpcHandlers, LlmRpcHandlers, ElectronEditorRpcHandlers,
 * ElectronConfigExtendedRpcHandlers) exist because these handlers need the
 * DependencyContainer interface itself (no reflection metadata) or resolve
 * WEBVIEW_MANAGER which is registered later in main.ts Phase 4.
 */
export function registerPhase4Handlers(
  container: DependencyContainer,
  logger: Logger,
): void {
  // ========================================
  // PHASE 4.1: Shared RPC Handler Classes (TASK_2025_203 Batch 5, TASK_2025_209, TASK_2025_241)
  // ========================================
  container.registerSingleton(SessionRpcHandlers);
  container.registerSingleton(ChatRpcHandlers);
  container.registerSingleton(ConfigRpcHandlers);
  container.registerSingleton(AuthRpcHandlers);
  container.registerSingleton(ContextRpcHandlers);
  // SetupRpcHandlers requires container instance for lazy resolution of agent-generation services.
  // Must use factory pattern because DependencyContainer is an interface (no reflection metadata).
  container.register(SetupRpcHandlers, {
    useFactory: (c) =>
      new SetupRpcHandlers(
        c.resolve(TOKENS.LOGGER),
        c.resolve(TOKENS.RPC_HANDLER),
        c.resolve(TOKENS.CONFIG_MANAGER),
        c.resolve(SDK_TOKENS.SDK_PLUGIN_LOADER),
        c.resolve(PLATFORM_TOKENS.WORKSPACE_PROVIDER),
        c,
        c.resolve(TOKENS.SENTRY_SERVICE),
      ),
  });
  container.registerSingleton(LicenseRpcHandlers);
  // WizardGenerationRpcHandlers requires container instance for lazy resolution.
  container.register(WizardGenerationRpcHandlers, {
    useFactory: (c) =>
      new WizardGenerationRpcHandlers(
        c.resolve(TOKENS.LOGGER),
        c.resolve(TOKENS.RPC_HANDLER),
        c.resolve(SDK_TOKENS.SDK_PLUGIN_LOADER),
        c.resolve(PLATFORM_TOKENS.WORKSPACE_PROVIDER),
        c,
        c.resolve(TOKENS.SENTRY_SERVICE),
      ),
  });
  container.registerSingleton(AutocompleteRpcHandlers);
  container.registerSingleton(SubagentRpcHandlers);
  container.registerSingleton(PluginRpcHandlers);
  container.registerSingleton(PtahCliRpcHandlers);
  // EnhancedPromptsRpcHandlers requires container instance for lazy resolution.
  container.register(EnhancedPromptsRpcHandlers, {
    useFactory: (c) =>
      new EnhancedPromptsRpcHandlers(
        c.resolve(TOKENS.LOGGER),
        c.resolve(TOKENS.RPC_HANDLER),
        c.resolve(SDK_TOKENS.SDK_ENHANCED_PROMPTS_SERVICE),
        c.resolve(TOKENS.LICENSE_SERVICE),
        c.resolve(SDK_TOKENS.SDK_PLUGIN_LOADER),
        c.resolve(PLATFORM_TOKENS.WORKSPACE_PROVIDER),
        c.resolve(TOKENS.SAVE_DIALOG_PROVIDER),
        c,
        c.resolve(TOKENS.SENTRY_SERVICE),
      ),
  });
  container.registerSingleton(QualityRpcHandlers);
  container.registerSingleton(ProviderRpcHandlers);
  // TASK_2025_209: LlmRpcHandlers now platform-agnostic, uses DependencyContainer for lazy resolution.
  container.register(LlmRpcHandlers, {
    useFactory: (c) =>
      new LlmRpcHandlers(
        c.resolve(TOKENS.LOGGER),
        c.resolve(TOKENS.RPC_HANDLER),
        c,
        c.resolve(TOKENS.SENTRY_SERVICE),
      ),
  });
  // TASK_2025_241: WebSearchRpcHandlers — web search settings management (API keys, config, testing).
  container.registerSingleton(WebSearchRpcHandlers);

  // Harness Setup Builder RPC handlers.
  container.registerSingleton(HarnessRpcHandlers);

  logger.info(
    '[Electron DI] Shared RPC handler classes registered (TASK_2025_203 Batch 5, TASK_2025_209)',
    {
      handlers: [
        'SessionRpcHandlers',
        'ChatRpcHandlers',
        'ConfigRpcHandlers',
        'AuthRpcHandlers',
        'ContextRpcHandlers',
        'SetupRpcHandlers',
        'LicenseRpcHandlers',
        'WizardGenerationRpcHandlers',
        'AutocompleteRpcHandlers',
        'SubagentRpcHandlers',
        'PluginRpcHandlers',
        'PtahCliRpcHandlers',
        'EnhancedPromptsRpcHandlers',
        'QualityRpcHandlers',
        'ProviderRpcHandlers',
        'LlmRpcHandlers',
        'WebSearchRpcHandlers',
        'HarnessRpcHandlers',
      ],
    },
  );

  // ========================================
  // PHASE 4.2: Electron-specific RPC Handler Classes (TASK_2025_203 Batch 5)
  // ========================================
  container.registerSingleton(ElectronWorkspaceRpcHandlers);
  // ElectronEditorRpcHandlers requires container for lazy resolution.
  container.register(ElectronEditorRpcHandlers, {
    useFactory: (c) =>
      new ElectronEditorRpcHandlers(
        c.resolve(TOKENS.LOGGER),
        c.resolve(TOKENS.RPC_HANDLER),
        c.resolve(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER),
        c.resolve(PLATFORM_TOKENS.WORKSPACE_PROVIDER),
        c,
      ),
  });
  container.registerSingleton(ElectronFileRpcHandlers);
  // TASK_2025_209: ElectronLlmRpcHandlers, ElectronChatExtendedRpcHandlers, ElectronAgentRpcHandlers
  // removed (unified into shared LlmRpcHandlers and ChatRpcHandlers).
  // ElectronConfigExtendedRpcHandlers requires container for lazy resolution.
  container.register(ElectronConfigExtendedRpcHandlers, {
    useFactory: (c) =>
      new ElectronConfigExtendedRpcHandlers(
        c.resolve(TOKENS.LOGGER),
        c.resolve(TOKENS.RPC_HANDLER),
        c,
      ),
  });
  container.registerSingleton(ElectronCommandRpcHandlers);
  container.registerSingleton(ElectronSettingsRpcHandlers);
  container.registerSingleton(ElectronAgentRpcHandlers);
  container.registerSingleton(ElectronSkillsShRpcHandlers);
  container.registerSingleton(ElectronLayoutRpcHandlers);

  // GitInfoService (TASK_2025_227): Plain class instantiated with logger.
  const gitInfoService = new GitInfoService(logger);
  container.register(ELECTRON_TOKENS.GIT_INFO_SERVICE, {
    useValue: gitInfoService,
  });
  container.registerSingleton(ElectronGitRpcHandlers);

  // PtyManagerService (TASK_2025_227): Terminal PTY session management.
  const ptyManagerService = new PtyManagerService(logger);
  container.register(ELECTRON_TOKENS.PTY_MANAGER_SERVICE, {
    useValue: ptyManagerService,
  });
  container.registerSingleton(ElectronTerminalRpcHandlers);

  // Register the orchestrator itself.
  container.registerSingleton(ElectronRpcMethodRegistrationService);

  logger.info(
    '[Electron DI] Electron-specific RPC handler classes registered (TASK_2025_203 Batch 5, TASK_2025_209)',
    {
      handlers: [
        'ElectronWorkspaceRpcHandlers',
        'ElectronEditorRpcHandlers',
        'ElectronFileRpcHandlers',
        'ElectronConfigExtendedRpcHandlers',
        'ElectronCommandRpcHandlers',
        'ElectronSettingsRpcHandlers',
        'ElectronAgentRpcHandlers',
        'ElectronSkillsShRpcHandlers',
        'ElectronLayoutRpcHandlers',
        'ElectronGitRpcHandlers',
        'ElectronTerminalRpcHandlers',
      ],
    },
  );
}
