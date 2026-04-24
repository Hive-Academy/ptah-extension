/**
 * Phase 3 (handlers) — RPC Domain Handlers + RpcMethodRegistrationService factory
 *
 * Extracted from `container.ts` as part of TASK_2025_291 Wave C1, Step 2a.
 * Corresponds to the original file's "Phase 1.6" block (lines 286–431).
 *
 * Intentionally runs BEFORE Phase 2 in `DIContainer.setup`. Every registration
 * here is lazy — tsyringe does not resolve factory dependencies at registration
 * time — so this phase can precede the libraries that supply SDK / workspace /
 * agent-generation tokens. Those are resolved at runtime when
 * `TOKENS.RPC_METHOD_REGISTRATION_SERVICE` is finally requested.
 *
 * NOTE: `WebSearchRpcHandlers` is NOT registered explicitly. Like the original
 * container, it is auto-resolved by tsyringe via its `@injectable()` decorator
 * when the `RpcMethodRegistrationService` factory calls `c.resolve(...)` on it.
 * Do not add an explicit `registerSingleton` for it — that would change caching
 * behavior vs. the original.
 */

import type { DependencyContainer } from 'tsyringe';

import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';

import {
  RpcMethodRegistrationService,
  ChatRpcHandlers,
  SessionRpcHandlers,
  ContextRpcHandlers,
  AutocompleteRpcHandlers,
  FileRpcHandlers,
  ConfigRpcHandlers,
  AuthRpcHandlers,
  SetupRpcHandlers,
  LicenseRpcHandlers,
  LlmRpcHandlers as AppLlmRpcHandlers,
  ProviderRpcHandlers,
  SubagentRpcHandlers,
  CommandRpcHandlers, // TASK_2025_126
  EnhancedPromptsRpcHandlers, // TASK_2025_137
  QualityRpcHandlers, // TASK_2025_144
  WizardGenerationRpcHandlers, // TASK_2025_148
  PluginRpcHandlers, // TASK_2025_153
  AgentRpcHandlers, // TASK_2025_157
  PtahCliRpcHandlers, // TASK_2025_167
  SkillsShRpcHandlers, // TASK_2025_204
  McpDirectoryRpcHandlers, // MCP Server Directory
  WebSearchRpcHandlers, // TASK_2025_235
  HarnessRpcHandlers,
} from '../services/rpc';

export function registerPhase3Handlers(
  container: DependencyContainer,
  // Kept in the signature for parity with other phase modules and future use;
  // currently not needed at registration time.
  _logger: Logger,
): void {
  // Silence the unused-parameter warning without changing the signature.
  void _logger;

  // ========================================
  // PHASE 1.6: RPC Domain Handlers (TASK_2025_074)
  // ========================================
  // Register all domain-specific RPC handler classes. These are consumed by
  // `RpcMethodRegistrationService` to delegate per-domain RPC registration.
  container.registerSingleton(ChatRpcHandlers);
  container.registerSingleton(SessionRpcHandlers);
  container.registerSingleton(ContextRpcHandlers);
  container.registerSingleton(AutocompleteRpcHandlers);
  container.registerSingleton(FileRpcHandlers);
  container.registerSingleton(ConfigRpcHandlers);
  container.registerSingleton(AuthRpcHandlers);
  container.registerSingleton(LicenseRpcHandlers);

  // SetupRpcHandlers and LlmRpcHandlers require container instance for lazy
  // resolution. Must use factory pattern because DependencyContainer is an
  // interface (no reflection metadata).
  // TASK_2025_203: Added WORKSPACE_PROVIDER injection.
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

  container.register(AppLlmRpcHandlers, {
    useFactory: (c) =>
      new AppLlmRpcHandlers(
        c.resolve(TOKENS.LOGGER),
        c.resolve(TOKENS.RPC_HANDLER),
        c,
        c.resolve(TOKENS.SENTRY_SERVICE),
      ),
  });

  // ProviderRpcHandlers requires SDK_PROVIDER_MODELS which is registered in
  // Phase 2.7. Registered as singleton here, resolved lazily at RPC service
  // factory resolve time (after Phase 2.7 has run).
  container.registerSingleton(ProviderRpcHandlers);

  // TASK_2025_103: Subagent RPC handlers for subagent resumption
  container.registerSingleton(SubagentRpcHandlers);

  // TASK_2025_126: Command RPC handlers for webview command execution
  container.registerSingleton(CommandRpcHandlers);

  // TASK_2025_137: Enhanced Prompts RPC handlers
  // Factory pattern — DependencyContainer is an interface (no reflection metadata).
  // TASK_2025_203: Added WORKSPACE_PROVIDER + SAVE_DIALOG_PROVIDER injections.
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

  // TASK_2025_144: Quality Dashboard RPC handlers
  container.registerSingleton(QualityRpcHandlers);

  // TASK_2025_153: Plugin Configuration RPC handlers
  container.registerSingleton(PluginRpcHandlers);

  // TASK_2025_157: Agent Orchestration RPC handlers
  container.registerSingleton(AgentRpcHandlers);

  // TASK_2025_167: Ptah CLI Management RPC handlers
  container.registerSingleton(PtahCliRpcHandlers);

  // TASK_2025_204: Skills.sh Marketplace RPC handlers
  container.registerSingleton(SkillsShRpcHandlers);

  // MCP Server Directory RPC handlers
  container.registerSingleton(McpDirectoryRpcHandlers);

  // Harness Setup Builder RPC handlers
  container.registerSingleton(HarnessRpcHandlers);

  // TASK_2025_148: Wizard Generation RPC handlers (requires container for lazy resolution)
  // TASK_2025_203: Added WORKSPACE_PROVIDER injection.
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

  // ========================================
  // RPC Method Registration Service (orchestrator)
  // ========================================
  // Registered as factory because it requires the container instance.
  // TASK_2025_291 Wave C4b: shared-handler fan-out + wiring moved into helpers,
  // so the factory only threads LOGGER / RPC_HANDLER / COMMAND_MANAGER and the
  // five Tier-3 VS Code-specific handlers. ChatRpcHandlers is still injected
  // so the wiring helpers can resolve PTAH CLI session IDs via its public API.
  container.register(TOKENS.RPC_METHOD_REGISTRATION_SERVICE, {
    useFactory: (c) =>
      new RpcMethodRegistrationService(
        c.resolve(TOKENS.LOGGER),
        c.resolve(TOKENS.RPC_HANDLER),
        c.resolve(TOKENS.COMMAND_MANAGER),
        c.resolve(ChatRpcHandlers),
        c.resolve(FileRpcHandlers),
        c.resolve(CommandRpcHandlers),
        c.resolve(AgentRpcHandlers),
        c.resolve(SkillsShRpcHandlers),
        c.resolve(McpDirectoryRpcHandlers),
        c, // Pass container instance
      ),
  });
}
