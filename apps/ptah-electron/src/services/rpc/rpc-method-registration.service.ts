/**
 * Electron RPC Method Registration Service
 *
 * Class-based orchestrator that mirrors the VS Code RpcMethodRegistrationService pattern.
 * Delegates to domain-specific handler classes: shared handlers from @ptah-extension/rpc-handlers
 * and Electron-specific handlers from ./handlers/.
 *
 * TASK_2025_203 Batch 5: Rewritten from ~2300-line procedural file to ~200-line class orchestrator.
 * TASK_2025_209: Unified LlmRpcHandlers, ChatRpcHandlers (chat:send-message, chat:stop),
 *   removed ElectronLlmRpcHandlers, ElectronChatExtendedRpcHandlers, ElectronAgentRpcHandlers.
 *
 * Handler registration order:
 * 1. Shared handlers (16 handlers from @ptah-extension/rpc-handlers)
 *    - Session, Chat, Config, Auth, Context, Setup, License, WizardGeneration,
 *      Autocomplete, Subagent, Plugin, PtahCli, EnhancedPrompts, Quality, Provider, LLM
 * 2. Electron-specific handlers (7 handlers from ./handlers/)
 *    - Workspace, Editor, File, ConfigExtended, Command, AuthExtended, Settings
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS, verifyRpcRegistration } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';

// Shared handler classes (all 16)
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
} from '@ptah-extension/rpc-handlers';

// Electron-specific handler classes
import {
  ElectronWorkspaceRpcHandlers,
  ElectronEditorRpcHandlers,
  ElectronFileRpcHandlers,
  ElectronConfigExtendedRpcHandlers,
  ElectronCommandRpcHandlers,
  ElectronAuthExtendedRpcHandlers,
  ElectronSettingsRpcHandlers,
} from './handlers';

/**
 * Orchestrates RPC method registration across all domain handlers.
 *
 * TASK_2025_203 Batch 5: Reduced from ~2300 lines (two procedural files)
 * to a class-based orchestrator matching the VS Code pattern.
 * TASK_2025_209: Unified LLM/Chat/Agent handlers into shared.
 */
@injectable()
export class ElectronRpcMethodRegistrationService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    // Shared handlers (all 16)
    private readonly sessionHandlers: SessionRpcHandlers,
    private readonly chatHandlers: ChatRpcHandlers,
    private readonly configHandlers: ConfigRpcHandlers,
    private readonly authHandlers: AuthRpcHandlers,
    private readonly contextHandlers: ContextRpcHandlers,
    private readonly setupHandlers: SetupRpcHandlers,
    private readonly licenseHandlers: LicenseRpcHandlers,
    private readonly wizardGenerationHandlers: WizardGenerationRpcHandlers,
    private readonly autocompleteHandlers: AutocompleteRpcHandlers,
    private readonly subagentHandlers: SubagentRpcHandlers,
    private readonly pluginHandlers: PluginRpcHandlers,
    private readonly ptahCliHandlers: PtahCliRpcHandlers,
    private readonly enhancedPromptsHandlers: EnhancedPromptsRpcHandlers,
    private readonly qualityHandlers: QualityRpcHandlers,
    private readonly providerHandlers: ProviderRpcHandlers,
    private readonly llmHandlers: LlmRpcHandlers,
    // Electron-specific handlers
    private readonly workspaceHandlers: ElectronWorkspaceRpcHandlers,
    private readonly editorHandlers: ElectronEditorRpcHandlers,
    private readonly fileHandlers: ElectronFileRpcHandlers,
    private readonly configExtendedHandlers: ElectronConfigExtendedRpcHandlers,
    private readonly commandHandlers: ElectronCommandRpcHandlers,
    private readonly authExtendedHandlers: ElectronAuthExtendedRpcHandlers,
    private readonly settingsHandlers: ElectronSettingsRpcHandlers
  ) {}

  /**
   * Register all RPC methods by delegating to domain-specific handlers.
   *
   * Shared handlers register first (platform-agnostic implementations),
   * then Electron-specific handlers register supplementary/override methods.
   */
  registerAll(): void {
    // Phase 1: Shared handlers from @ptah-extension/rpc-handlers
    this.registerSharedHandlers();

    // Phase 2: Electron-specific handlers
    this.registerElectronHandlers();

    // Phase 3: Verify all expected RPC methods are registered
    verifyRpcRegistration(this.rpcHandler, this.logger);

    this.logger.info('[Electron RPC] All RPC methods registered', {
      methods: this.rpcHandler.getRegisteredMethods(),
    } as unknown as Error);
  }

  private registerSharedHandlers(): void {
    const sharedHandlers: Array<{
      name: string;
      handler: { register(): void };
    }> = [
      { name: 'SessionRpcHandlers', handler: this.sessionHandlers },
      { name: 'ChatRpcHandlers', handler: this.chatHandlers },
      { name: 'ConfigRpcHandlers', handler: this.configHandlers },
      { name: 'AuthRpcHandlers', handler: this.authHandlers },
      { name: 'ContextRpcHandlers', handler: this.contextHandlers },
      { name: 'SetupRpcHandlers', handler: this.setupHandlers },
      { name: 'LicenseRpcHandlers', handler: this.licenseHandlers },
      {
        name: 'WizardGenerationRpcHandlers',
        handler: this.wizardGenerationHandlers,
      },
      { name: 'AutocompleteRpcHandlers', handler: this.autocompleteHandlers },
      { name: 'SubagentRpcHandlers', handler: this.subagentHandlers },
      { name: 'PluginRpcHandlers', handler: this.pluginHandlers },
      { name: 'PtahCliRpcHandlers', handler: this.ptahCliHandlers },
      {
        name: 'EnhancedPromptsRpcHandlers',
        handler: this.enhancedPromptsHandlers,
      },
      { name: 'QualityRpcHandlers', handler: this.qualityHandlers },
      { name: 'ProviderRpcHandlers', handler: this.providerHandlers },
      { name: 'LlmRpcHandlers', handler: this.llmHandlers },
    ];

    for (const { name, handler } of sharedHandlers) {
      try {
        handler.register();
        this.logger.info(`[Electron RPC] ${name} registered (shared)`);
      } catch (error) {
        this.logger.error(
          `[Electron RPC] Failed to register ${name} (shared)`,
          {
            error: error instanceof Error ? error.message : String(error),
          } as unknown as Error
        );
      }
    }
  }

  private registerElectronHandlers(): void {
    const electronHandlers: Array<{
      name: string;
      handler: { register(): void };
    }> = [
      { name: 'ElectronWorkspaceRpcHandlers', handler: this.workspaceHandlers },
      { name: 'ElectronEditorRpcHandlers', handler: this.editorHandlers },
      { name: 'ElectronFileRpcHandlers', handler: this.fileHandlers },
      {
        name: 'ElectronConfigExtendedRpcHandlers',
        handler: this.configExtendedHandlers,
      },
      { name: 'ElectronCommandRpcHandlers', handler: this.commandHandlers },
      {
        name: 'ElectronAuthExtendedRpcHandlers',
        handler: this.authExtendedHandlers,
      },
      {
        name: 'ElectronSettingsRpcHandlers',
        handler: this.settingsHandlers,
      },
    ];

    for (const { name, handler } of electronHandlers) {
      try {
        handler.register();
        this.logger.info(`[Electron RPC] ${name} registered (Electron)`);
      } catch (error) {
        this.logger.warn(
          `[Electron RPC] Failed to register ${name} (Electron)`,
          {
            error: error instanceof Error ? error.message : String(error),
          } as unknown as Error
        );
      }
    }
  }
}
