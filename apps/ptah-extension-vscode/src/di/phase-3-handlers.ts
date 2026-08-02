/**
 * RPC Domain Handlers.
 *
 * Intentionally runs BEFORE the library phase in `DIContainer.setup`. Every
 * registration here is lazy — tsyringe does not resolve constructor
 * dependencies at registration time — so this phase can precede the libraries
 * that supply SDK / workspace / agent-generation tokens. Those are resolved at
 * runtime when `registerRpcSurface()` runs in `activation/bootstrap.ts`.
 *
 * NOTE: `WebSearchRpcHandlers` is NOT registered explicitly. It is
 * auto-resolved by tsyringe via its `@injectable()` decorator when
 * `registerRpcSurface` resolves it. Do not add an explicit `registerSingleton`
 * for it — that would change caching behavior.
 */

import type { DependencyContainer } from 'tsyringe';

import { TOKENS, GitInfoService } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  AgentRpcHandlers,
  CommandRpcHandlers,
  FilePickerRpcHandlers,
  ImagePickerRpcHandlers,
  activateSessionLifecycleNotifier,
  registerChatServices,
  registerHarnessServices,
  registerSharedRpcHandlers,
} from '@ptah-extension/rpc-handlers';

import {
  ChatRpcHandlers,
  SessionRpcHandlers,
  ContextRpcHandlers,
  AutocompleteRpcHandlers,
  FileRpcHandlers,
  EditorRpcHandlers,
  ConfigRpcHandlers,
  AuthRpcHandlers,
  LicenseRpcHandlers,
  ProviderRpcHandlers,
  SubagentRpcHandlers,
  QualityRpcHandlers,
  PluginRpcHandlers,
  PtahCliRpcHandlers,
  SkillsShRpcHandlers,
  McpDirectoryRpcHandlers,
  HarnessRpcHandlers,
} from '../services/rpc';

export function registerPhase3Handlers(
  container: DependencyContainer,
  _logger: Logger,
): void {
  void _logger;
  container.register(TOKENS.GIT_INFO_SERVICE, {
    useFactory: (c) => new GitInfoService(c.resolve(TOKENS.LOGGER)),
  });
  registerHarnessServices(container);
  registerChatServices(container);
  container.registerSingleton(ChatRpcHandlers);
  container.registerSingleton(SessionRpcHandlers);
  container.registerSingleton(ContextRpcHandlers);
  container.registerSingleton(AutocompleteRpcHandlers);
  container.registerSingleton(FileRpcHandlers);
  container.registerSingleton(EditorRpcHandlers);
  container.registerSingleton(ConfigRpcHandlers);
  container.registerSingleton(AuthRpcHandlers);
  container.registerSingleton(LicenseRpcHandlers);
  container.registerSingleton(ProviderRpcHandlers);
  container.registerSingleton(SubagentRpcHandlers);
  container.registerSingleton(CommandRpcHandlers);
  container.registerSingleton(QualityRpcHandlers);
  container.registerSingleton(PluginRpcHandlers);
  container.registerSingleton(AgentRpcHandlers);
  container.registerSingleton(FilePickerRpcHandlers);
  container.registerSingleton(ImagePickerRpcHandlers);
  container.registerSingleton(PtahCliRpcHandlers);
  container.registerSingleton(SkillsShRpcHandlers);
  container.registerSingleton(McpDirectoryRpcHandlers);
  container.registerSingleton(HarnessRpcHandlers);
  registerSharedRpcHandlers(container);
  activateSessionLifecycleNotifier(container);
}
