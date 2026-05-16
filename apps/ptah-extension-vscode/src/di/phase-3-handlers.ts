/**
 * RPC Domain Handlers + RpcMethodRegistrationService factory.
 *
 * Intentionally runs BEFORE the library phase in `DIContainer.setup`. Every
 * registration here is lazy — tsyringe does not resolve factory dependencies
 * at registration time — so this phase can precede the libraries that supply
 * SDK / workspace / agent-generation tokens. Those are resolved at runtime
 * when `TOKENS.RPC_METHOD_REGISTRATION_SERVICE` is finally requested.
 *
 * NOTE: `WebSearchRpcHandlers` is NOT registered explicitly. It is
 * auto-resolved by tsyringe via its `@injectable()` decorator when the
 * `RpcMethodRegistrationService` factory calls `c.resolve(...)` on it. Do not
 * add an explicit `registerSingleton` for it — that would change caching
 * behavior.
 */

import type { DependencyContainer } from 'tsyringe';

import { TOKENS, GitInfoService } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { SETTINGS_TOKENS } from '@ptah-extension/settings-core';
import {
  registerChatServices,
  registerHarnessServices,
} from '@ptah-extension/rpc-handlers';

import {
  RpcMethodRegistrationService,
  ChatRpcHandlers,
  SessionRpcHandlers,
  ContextRpcHandlers,
  AutocompleteRpcHandlers,
  FileRpcHandlers,
  EditorRpcHandlers,
  ConfigRpcHandlers,
  AuthRpcHandlers,
  SetupRpcHandlers,
  LicenseRpcHandlers,
  LlmRpcHandlers as AppLlmRpcHandlers,
  ProviderRpcHandlers,
  SubagentRpcHandlers,
  CommandRpcHandlers,
  EnhancedPromptsRpcHandlers,
  QualityRpcHandlers,
  WizardGenerationRpcHandlers,
  PluginRpcHandlers,
  AgentRpcHandlers,
  PtahCliRpcHandlers,
  SkillsShRpcHandlers,
  McpDirectoryRpcHandlers,
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

  // RPC Domain Handlers.

  // GitInfoService is required by the lifted shared GitRpcHandlers
  // (registered via SHARED_HANDLERS in `@ptah-extension/rpc-handlers`).
  // Registered here so it is available before the shared handler fan-out
  // resolves it.
  container.register(TOKENS.GIT_INFO_SERVICE, {
    useFactory: (c) => new GitInfoService(c.resolve(TOKENS.LOGGER)),
  });

  // Register the lifted harness + chat sub-services BEFORE their handler
  // classes. `RpcMethodRegistrationService` injects `ChatRpcHandlers` eagerly
  // via its constructor, so the chat sub-services (CHAT_TOKENS.PTAH_CLI,
  // STREAM_BROADCASTER, SESSION, PREMIUM_CONTEXT) must be registered here,
  // not deferred to `registerAll()`. Mirrors the electron pattern in
  // `apps/ptah-electron/src/di/phase-4-handlers.ts`.
  registerHarnessServices(container);
  registerChatServices(container);

  // Register all domain-specific RPC handler classes. These are consumed by
  // `RpcMethodRegistrationService` to delegate per-domain RPC registration.
  container.registerSingleton(ChatRpcHandlers);
  container.registerSingleton(SessionRpcHandlers);
  container.registerSingleton(ContextRpcHandlers);
  container.registerSingleton(AutocompleteRpcHandlers);
  container.registerSingleton(FileRpcHandlers);
  container.registerSingleton(EditorRpcHandlers);
  container.registerSingleton(ConfigRpcHandlers);
  container.registerSingleton(AuthRpcHandlers);
  container.registerSingleton(LicenseRpcHandlers);

  // SetupRpcHandlers and LlmRpcHandlers require container instance for lazy
  // resolution. Must use factory pattern because DependencyContainer is an
  // interface (no reflection metadata).
  container.register(SetupRpcHandlers, {
    useFactory: (c) =>
      new SetupRpcHandlers(
        c.resolve(TOKENS.LOGGER),
        c.resolve(TOKENS.RPC_HANDLER),
        c.resolve(SETTINGS_TOKENS.MODEL_SETTINGS),
        c.resolve(SDK_TOKENS.SDK_PLUGIN_LOADER),
        c.resolve(PLATFORM_TOKENS.WORKSPACE_PROVIDER),
        c,
        c.resolve(TOKENS.SENTRY_SERVICE),
        c.resolve(TOKENS.PLATFORM_COMMANDS),
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

  // ProviderRpcHandlers requires SDK_PROVIDER_MODELS which is registered by
  // the library phase. Registered as singleton here, resolved lazily at RPC
  // service factory resolve time (after the library phase has run).
  container.registerSingleton(ProviderRpcHandlers);

  // Subagent RPC handlers for subagent resumption.
  container.registerSingleton(SubagentRpcHandlers);

  // Command RPC handlers for webview command execution.
  container.registerSingleton(CommandRpcHandlers);

  // Enhanced Prompts RPC handlers.
  // Factory pattern — DependencyContainer is an interface (no reflection metadata).
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

  // Quality Dashboard RPC handlers.
  container.registerSingleton(QualityRpcHandlers);

  // Plugin Configuration RPC handlers.
  container.registerSingleton(PluginRpcHandlers);

  // Agent Orchestration RPC handlers.
  container.registerSingleton(AgentRpcHandlers);

  // Ptah CLI Management RPC handlers.
  container.registerSingleton(PtahCliRpcHandlers);

  // Skills.sh Marketplace RPC handlers.
  container.registerSingleton(SkillsShRpcHandlers);

  // MCP Server Directory RPC handlers
  container.registerSingleton(McpDirectoryRpcHandlers);

  // Harness Setup Builder RPC handlers
  container.registerSingleton(HarnessRpcHandlers);

  // Wizard Generation RPC handlers (requires container for lazy resolution).
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
  // Shared-handler fan-out + wiring live in helpers, so the factory only
  // threads LOGGER / RPC_HANDLER / COMMAND_MANAGER and the five VS Code-
  // specific handlers. ChatRpcHandlers is still injected so the wiring
  // helpers can resolve PTAH CLI session IDs via its public API.
  container.register(TOKENS.RPC_METHOD_REGISTRATION_SERVICE, {
    useFactory: (c) =>
      new RpcMethodRegistrationService(
        c.resolve(TOKENS.LOGGER),
        c.resolve(TOKENS.RPC_HANDLER),
        c.resolve(TOKENS.COMMAND_MANAGER),
        c.resolve(ChatRpcHandlers),
        c.resolve(FileRpcHandlers),
        c.resolve(EditorRpcHandlers),
        c.resolve(CommandRpcHandlers),
        c.resolve(AgentRpcHandlers),
        c.resolve(SkillsShRpcHandlers),
        c, // Pass container instance
      ),
  });
}
