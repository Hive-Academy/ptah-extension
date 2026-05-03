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
import {
  TOKENS,
  GitInfoService,
  type Logger,
} from '@ptah-extension/vscode-core';
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
  McpDirectoryRpcHandlers,
  GitRpcHandlers,
  // === TRACK_1_MEMORY_CURATOR_BEGIN ===
  MemoryRpcHandlers,
  // === TRACK_1_MEMORY_CURATOR_END ===
  // === TRACK_2_SKILL_SYNTHESIS_BEGIN ===
  SkillsSynthesisRpcHandlers,
  // === TRACK_2_SKILL_SYNTHESIS_END ===
  // === TRACK_3_CRON_SCHEDULER_BEGIN ===
  CronRpcHandlers,
  // === TRACK_3_CRON_SCHEDULER_END ===
  // === TRACK_4_MESSAGING_GATEWAY_BEGIN ===
  GatewayRpcHandlers,
  // === TRACK_4_MESSAGING_GATEWAY_END ===
  registerHarnessServices,
  registerChatServices,
} from '@ptah-extension/rpc-handlers';

// Electron-specific RPC handler classes (TASK_2025_203 Batch 5).
// TASK_2025_209: the Electron-prefixed LlmRpcHandlers and ChatExtendedRpcHandlers
// were unified into the shared versions; electron-specific AgentRpcHandlers,
// SkillsShRpcHandlers, and LayoutRpcHandlers were re-added.
// TASK_2025_291 Wave C6: Electron prefix dropped from class and file names.
import {
  EditorRpcHandlers,
  FileRpcHandlers,
  ConfigExtendedRpcHandlers,
  CommandRpcHandlers,
  AgentRpcHandlers,
  SkillsShRpcHandlers,
  LayoutRpcHandlers,
  TerminalRpcHandlers,
} from '../services/rpc/handlers';

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
 * EnhancedPromptsRpcHandlers, LlmRpcHandlers, EditorRpcHandlers,
 * ConfigExtendedRpcHandlers) exist because these handlers need the
 * DependencyContainer interface itself (no reflection metadata) or resolve
 * WEBVIEW_MANAGER which is registered later in main.ts Phase 4.
 */
export function registerPhase4Handlers(
  container: DependencyContainer,
  logger: Logger,
): void {
  // ========================================
  // PHASE 4.0: Pre-handler service tokens (Wave C7d/C7e sub-services).
  // ========================================
  // ChatRpcHandlers (4.1) and HarnessRpcHandlers (4.1) declare constructor
  // injections against CHAT_TOKENS.* and HARNESS_TOKENS.* respectively.
  // tsyringe walks those decorators when the orchestrator service
  // (ElectronRpcMethodRegistrationService) is resolved later in
  // wireRuntime — at that point every chat/harness token MUST already
  // be registered, otherwise resolution throws
  //   "Attempted to resolve unregistered dependency token: ChatPtahCliService".
  // Registering both groups here (before the handler classes themselves)
  // keeps tsyringe's lazy resolution chain valid without re-ordering main.ts.
  registerHarnessServices(container);
  registerChatServices(container);

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

  // TASK_2026_104 Batch 6a: MCP Directory handlers lifted to shared library.
  // Electron now exposes mcpDirectory:* (parity with VS Code).
  container.registerSingleton(McpDirectoryRpcHandlers);

  // TASK_2026_104 Sub-batch B5b: GitInfoService + GitRpcHandlers lifted to
  // shared libraries. The service registration must happen here (not inside the
  // shared register helper) because each app owns its own logger instance.
  // GitRpcHandlers is resolved automatically via SHARED_HANDLERS — no local
  // registerSingleton call is needed.
  const gitInfoService = new GitInfoService(logger);
  container.register(TOKENS.GIT_INFO_SERVICE, {
    useValue: gitInfoService,
  });
  container.registerSingleton(GitRpcHandlers);

  // === TRACK_1_MEMORY_CURATOR_BEGIN ===
  // TASK_2026_HERMES Track 1: Memory curator RPC handlers.
  container.registerSingleton(MemoryRpcHandlers);
  // === TRACK_1_MEMORY_CURATOR_END ===

  // === TRACK_2_SKILL_SYNTHESIS_BEGIN ===
  // TASK_2026_HERMES Track 2: Skill synthesis RPC handlers.
  container.registerSingleton(SkillsSynthesisRpcHandlers);
  // === TRACK_2_SKILL_SYNTHESIS_END ===

  // === TRACK_3_CRON_SCHEDULER_BEGIN ===
  // TASK_2026_HERMES Track 3: Cron scheduler RPC handlers.
  container.registerSingleton(CronRpcHandlers);
  // === TRACK_3_CRON_SCHEDULER_END ===

  // === TRACK_4_MESSAGING_GATEWAY_BEGIN ===
  // TASK_2026_HERMES Track 4: Messaging gateway RPC handlers.
  container.registerSingleton(GatewayRpcHandlers);
  // === TRACK_4_MESSAGING_GATEWAY_END ===

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
        'McpDirectoryRpcHandlers',
        'GitRpcHandlers',
        'WorkspaceRpcHandlers',
      ],
    },
  );

  // ========================================
  // PHASE 4.2: Electron-specific RPC Handler Classes (TASK_2025_203 Batch 5)
  // ========================================
  // EditorRpcHandlers requires container for lazy resolution.
  container.register(EditorRpcHandlers, {
    useFactory: (c) =>
      new EditorRpcHandlers(
        c.resolve(TOKENS.LOGGER),
        c.resolve(TOKENS.RPC_HANDLER),
        c.resolve(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER),
        c.resolve(PLATFORM_TOKENS.WORKSPACE_PROVIDER),
        c,
      ),
  });
  container.registerSingleton(FileRpcHandlers);
  // TASK_2025_209: the Electron-prefixed LlmRpcHandlers, ChatExtendedRpcHandlers,
  // and AgentRpcHandlers were unified into the shared LlmRpcHandlers and
  // ChatRpcHandlers (electron-specific AgentRpcHandlers was re-added below).
  // ConfigExtendedRpcHandlers requires container for lazy resolution.
  container.register(ConfigExtendedRpcHandlers, {
    useFactory: (c) =>
      new ConfigExtendedRpcHandlers(
        c.resolve(TOKENS.LOGGER),
        c.resolve(TOKENS.RPC_HANDLER),
        c,
      ),
  });
  container.registerSingleton(CommandRpcHandlers);
  container.registerSingleton(AgentRpcHandlers);
  container.registerSingleton(SkillsShRpcHandlers);
  container.registerSingleton(LayoutRpcHandlers);

  // TASK_2026_104 Sub-batch B5b: GitInfoService + GitRpcHandlers were lifted
  // to shared libraries. Service registration moved to Phase 4.1 above so the
  // shared GitRpcHandlers (now in SHARED_HANDLERS) can resolve TOKENS.GIT_INFO_SERVICE.

  // PtyManagerService (TASK_2025_227): Terminal PTY session management.
  const ptyManagerService = new PtyManagerService(logger);
  container.register(ELECTRON_TOKENS.PTY_MANAGER_SERVICE, {
    useValue: ptyManagerService,
  });
  container.registerSingleton(TerminalRpcHandlers);

  // Register the orchestrator itself.
  container.registerSingleton(ElectronRpcMethodRegistrationService);

  logger.info(
    '[Electron DI] Electron-specific RPC handler classes registered (TASK_2025_203 Batch 5, TASK_2025_209)',
    {
      handlers: [
        'EditorRpcHandlers',
        'FileRpcHandlers',
        'ConfigExtendedRpcHandlers',
        'CommandRpcHandlers',
        'AgentRpcHandlers',
        'SkillsShRpcHandlers',
        'LayoutRpcHandlers',
        'TerminalRpcHandlers',
      ],
    },
  );
}
