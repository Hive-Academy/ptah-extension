/**
 * Electron DI — Phase 4: RPC handler registrations.
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
import {
  SessionRpcHandlers,
  ChatRpcHandlers,
  ConfigRpcHandlers,
  AuthRpcHandlers,
  ContextRpcHandlers,
  LicenseRpcHandlers,
  AutocompleteRpcHandlers,
  SubagentRpcHandlers,
  PluginRpcHandlers,
  PtahCliRpcHandlers,
  QualityRpcHandlers,
  ProviderRpcHandlers,
  WebSearchRpcHandlers,
  HarnessRpcHandlers,
  McpDirectoryRpcHandlers,
  GitRpcHandlers,
  MemoryRpcHandlers,
  MemRpcHandlers,
  CorpusRpcHandlers,
  SkillsSynthesisRpcHandlers,
  CronRpcHandlers,
  GatewayRpcHandlers,
  VoiceRpcHandlers,
  IndexingRpcHandlers,
  SkillsShRpcHandlers,
  TasksRpcHandlers,
  registerHarnessServices,
  registerChatServices,
  registerSharedRpcHandlers,
} from '@ptah-extension/rpc-handlers';
import {
  EditorRpcHandlers,
  FileRpcHandlers,
  CommandRpcHandlers,
  AgentRpcHandlers,
  LayoutRpcHandlers,
  TerminalRpcHandlers,
  UpdateRpcHandlers,
} from '../services/rpc/handlers';
import { UpdateManager } from '../services/update/update-manager';
import { UPDATE_MANAGER_TOKEN } from '../services/update/update-tokens';

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
 * EnhancedPromptsRpcHandlers, LlmRpcHandlers, EditorRpcHandlers) exist because
 * these handlers need the DependencyContainer interface itself (no reflection
 * metadata) or resolve WEBVIEW_MANAGER which is registered later in main.ts Phase 4.
 */
export function registerPhase4Handlers(
  container: DependencyContainer,
  logger: Logger,
): void {
  registerHarnessServices(container);
  registerChatServices(container);
  container.registerSingleton(SessionRpcHandlers);
  container.registerSingleton(ChatRpcHandlers);
  container.registerSingleton(ConfigRpcHandlers);
  container.registerSingleton(AuthRpcHandlers);
  container.registerSingleton(ContextRpcHandlers);
  container.registerSingleton(LicenseRpcHandlers);
  container.registerSingleton(AutocompleteRpcHandlers);
  container.registerSingleton(SubagentRpcHandlers);
  container.registerSingleton(PluginRpcHandlers);
  container.registerSingleton(PtahCliRpcHandlers);
  container.registerSingleton(QualityRpcHandlers);
  container.registerSingleton(ProviderRpcHandlers);
  container.registerSingleton(WebSearchRpcHandlers);
  registerSharedRpcHandlers(container);
  container.registerSingleton(HarnessRpcHandlers);
  container.registerSingleton(McpDirectoryRpcHandlers);
  const gitInfoService = new GitInfoService(logger);
  container.register(TOKENS.GIT_INFO_SERVICE, {
    useValue: gitInfoService,
  });
  container.registerSingleton(GitRpcHandlers);
  container.registerSingleton(MemoryRpcHandlers);
  container.registerSingleton(MemRpcHandlers);
  container.registerSingleton(CorpusRpcHandlers);
  container.registerSingleton(SkillsSynthesisRpcHandlers);
  container.registerSingleton(CronRpcHandlers);
  container.registerSingleton(GatewayRpcHandlers);
  container.registerSingleton(VoiceRpcHandlers);
  container.registerSingleton(IndexingRpcHandlers);
  container.registerSingleton(TasksRpcHandlers);

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
  container.register(EditorRpcHandlers, {
    useFactory: (c) =>
      new EditorRpcHandlers(
        c.resolve(TOKENS.LOGGER),
        c.resolve(TOKENS.RPC_HANDLER),
        c.resolve(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER),
        c.resolve(PLATFORM_TOKENS.WORKSPACE_PROVIDER),
        c.resolve(PLATFORM_TOKENS.EDITOR_PROVIDER),
        c.resolve(TOKENS.WEBVIEW_MANAGER),
      ),
  });
  container.registerSingleton(FileRpcHandlers);
  container.registerSingleton(CommandRpcHandlers);
  container.registerSingleton(AgentRpcHandlers);
  container.registerSingleton(SkillsShRpcHandlers);
  container.registerSingleton(LayoutRpcHandlers);
  const ptyManagerService = new PtyManagerService(logger);
  container.register(ELECTRON_TOKENS.PTY_MANAGER_SERVICE, {
    useValue: ptyManagerService,
  });
  container.registerSingleton(TerminalRpcHandlers);
  container.registerSingleton(UPDATE_MANAGER_TOKEN, UpdateManager);
  container.registerSingleton(UpdateRpcHandlers);
  container.registerSingleton(ElectronRpcMethodRegistrationService);

  logger.info(
    '[Electron DI] Electron-specific RPC handler classes registered (TASK_2025_203 Batch 5, TASK_2025_209)',
    {
      handlers: [
        'EditorRpcHandlers',
        'FileRpcHandlers',
        'CommandRpcHandlers',
        'AgentRpcHandlers',
        'SkillsShRpcHandlers',
        'LayoutRpcHandlers',
        'TerminalRpcHandlers',
      ],
    },
  );
}
