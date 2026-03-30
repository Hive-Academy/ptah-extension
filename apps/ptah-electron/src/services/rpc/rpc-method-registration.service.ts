/**
 * Electron RPC Method Registration Service
 *
 * Class-based orchestrator that mirrors the VS Code RpcMethodRegistrationService pattern.
 * Delegates to domain-specific handler classes: shared handlers from @ptah-extension/rpc-handlers
 * and Electron-specific handlers from ./handlers/.
 *
 * TASK_2025_203 Batch 5: Rewritten from ~2300-line procedural file to ~200-line class orchestrator.
 * TASK_2025_209: Unified LlmRpcHandlers, ChatRpcHandlers (chat:send-message, chat:stop).
 * Re-added ElectronAgentRpcHandlers, ElectronSkillsShRpcHandlers, ElectronLayoutRpcHandlers
 * with proper Electron-specific implementations using platform-agnostic services.
 *
 * Handler registration order:
 * 1. Shared handlers (17 handlers from @ptah-extension/rpc-handlers)
 *    - Session, Chat, Config, Auth, Context, Setup, License, WizardGeneration,
 *      Autocomplete, Subagent, Plugin, PtahCli, EnhancedPrompts, Quality, Provider, LLM, WebSearch
 * 2. Electron-specific handlers (10 handlers from ./handlers/)
 *    - Workspace, Editor, File, ConfigExtended, Command, AuthExtended, Settings,
 *      Agent, SkillsSh, Layout
 */

import { injectable, inject, container } from 'tsyringe';
import { TOKENS, verifyRpcRegistration } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type { SdkAgentAdapter } from '@ptah-extension/agent-sdk';

// Shared handler classes (all 17)
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
  ElectronAgentRpcHandlers,
  ElectronSkillsShRpcHandlers,
  ElectronLayoutRpcHandlers,
  ElectronGitRpcHandlers,
  ElectronTerminalRpcHandlers,
} from './handlers';

/**
 * Orchestrates RPC method registration across all domain handlers.
 *
 * TASK_2025_203 Batch 5: Reduced from ~2300 lines (two procedural files)
 * to a class-based orchestrator matching the VS Code pattern.
 * TASK_2025_209: Unified LLM/Chat handlers into shared.
 */
@injectable()
export class ElectronRpcMethodRegistrationService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    // Shared handlers (all 17)
    @inject(SessionRpcHandlers)
    private readonly sessionHandlers: SessionRpcHandlers,
    @inject(ChatRpcHandlers) private readonly chatHandlers: ChatRpcHandlers,
    @inject(ConfigRpcHandlers)
    private readonly configHandlers: ConfigRpcHandlers,
    @inject(AuthRpcHandlers) private readonly authHandlers: AuthRpcHandlers,
    @inject(ContextRpcHandlers)
    private readonly contextHandlers: ContextRpcHandlers,
    @inject(SetupRpcHandlers) private readonly setupHandlers: SetupRpcHandlers,
    @inject(LicenseRpcHandlers)
    private readonly licenseHandlers: LicenseRpcHandlers,
    @inject(WizardGenerationRpcHandlers)
    private readonly wizardGenerationHandlers: WizardGenerationRpcHandlers,
    @inject(AutocompleteRpcHandlers)
    private readonly autocompleteHandlers: AutocompleteRpcHandlers,
    @inject(SubagentRpcHandlers)
    private readonly subagentHandlers: SubagentRpcHandlers,
    @inject(PluginRpcHandlers)
    private readonly pluginHandlers: PluginRpcHandlers,
    @inject(PtahCliRpcHandlers)
    private readonly ptahCliHandlers: PtahCliRpcHandlers,
    @inject(EnhancedPromptsRpcHandlers)
    private readonly enhancedPromptsHandlers: EnhancedPromptsRpcHandlers,
    @inject(QualityRpcHandlers)
    private readonly qualityHandlers: QualityRpcHandlers,
    @inject(ProviderRpcHandlers)
    private readonly providerHandlers: ProviderRpcHandlers,
    @inject(LlmRpcHandlers) private readonly llmHandlers: LlmRpcHandlers,
    @inject(WebSearchRpcHandlers)
    private readonly webSearchHandlers: WebSearchRpcHandlers,
    // Electron-specific handlers
    @inject(ElectronWorkspaceRpcHandlers)
    private readonly workspaceHandlers: ElectronWorkspaceRpcHandlers,
    @inject(ElectronEditorRpcHandlers)
    private readonly editorHandlers: ElectronEditorRpcHandlers,
    @inject(ElectronFileRpcHandlers)
    private readonly fileHandlers: ElectronFileRpcHandlers,
    @inject(ElectronConfigExtendedRpcHandlers)
    private readonly configExtendedHandlers: ElectronConfigExtendedRpcHandlers,
    @inject(ElectronCommandRpcHandlers)
    private readonly commandHandlers: ElectronCommandRpcHandlers,
    @inject(ElectronAuthExtendedRpcHandlers)
    private readonly authExtendedHandlers: ElectronAuthExtendedRpcHandlers,
    @inject(ElectronSettingsRpcHandlers)
    private readonly settingsHandlers: ElectronSettingsRpcHandlers,
    @inject(ElectronAgentRpcHandlers)
    private readonly agentHandlers: ElectronAgentRpcHandlers,
    @inject(ElectronSkillsShRpcHandlers)
    private readonly skillsShHandlers: ElectronSkillsShRpcHandlers,
    @inject(ElectronLayoutRpcHandlers)
    private readonly layoutHandlers: ElectronLayoutRpcHandlers,
    @inject(ElectronGitRpcHandlers)
    private readonly gitHandlers: ElectronGitRpcHandlers,
    @inject(ElectronTerminalRpcHandlers)
    private readonly terminalHandlers: ElectronTerminalRpcHandlers,
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

    // Phase 3: Wire SDK callbacks (SESSION_STATS, SESSION_ID_RESOLVED, etc.)
    // TASK_2025_241: Without these, the frontend hangs after chat:complete
    // because SESSION_STATS never arrives to finalize streaming state.
    this.setupSdkCallbacks();

    // Phase 4: Verify all expected RPC methods are registered
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
      { name: 'WebSearchRpcHandlers', handler: this.webSearchHandlers },
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
          } as unknown as Error,
        );
      }
    }
  }

  /**
   * Wire SDK adapter callbacks so the backend can push events to the frontend.
   * TASK_2025_241: These were missing in Electron, causing the frontend to hang
   * after chat:complete because SESSION_STATS never arrived.
   *
   * Resolved lazily because SdkAgentAdapter and WebviewManager may not be
   * registered at DI construction time (Electron phases register them later).
   */
  private setupSdkCallbacks(): void {
    // Lazy-resolve SdkAgentAdapter (may fail if SDK auth not configured)
    if (!container.isRegistered(SDK_TOKENS.SDK_AGENT_ADAPTER)) {
      this.logger.warn(
        '[Electron RPC] SdkAgentAdapter not registered — SDK callbacks skipped',
      );
      return;
    }

    // Lazy-resolve WebviewManager (registered in Phase 4, before this runs)
    if (!container.isRegistered(TOKENS.WEBVIEW_MANAGER)) {
      this.logger.warn(
        '[Electron RPC] WebviewManager not registered — SDK callbacks skipped',
      );
      return;
    }

    try {
      const sdkAdapter = container.resolve<SdkAgentAdapter>(
        SDK_TOKENS.SDK_AGENT_ADAPTER,
      );
      const webviewManager = container.resolve<{
        broadcastMessage(type: string, payload: unknown): Promise<void>;
      }>(TOKENS.WEBVIEW_MANAGER);

      // 1. SESSION_STATS — authoritative streaming completion signal
      sdkAdapter.setResultStatsCallback(async (stats) => {
        this.logger.info(
          `[Electron RPC] Session stats received: ${stats.sessionId}`,
        );
        await webviewManager
          .broadcastMessage(MESSAGE_TYPES.SESSION_STATS, {
            sessionId: stats.sessionId,
            cost: stats.cost,
            tokens: stats.tokens,
            duration: stats.duration,
            modelUsage: stats.modelUsage,
          })
          .catch((error) => {
            this.logger.error(
              '[Electron RPC] Failed to send session:stats',
              error instanceof Error ? error : new Error(String(error)),
            );
          });
      });

      // 2. SESSION_ID_RESOLVED — temporary tab ID → real SDK UUID
      sdkAdapter.setSessionIdResolvedCallback(
        (tabId: string | undefined, realSessionId: string) => {
          this.logger.info(
            `[Electron RPC] Session ID resolved: tabId=${tabId} -> real=${realSessionId}`,
          );
          webviewManager
            .broadcastMessage(MESSAGE_TYPES.SESSION_ID_RESOLVED, {
              tabId,
              realSessionId,
            })
            .catch((error) => {
              this.logger.error(
                '[Electron RPC] Failed to send session:id-resolved',
                error instanceof Error ? error : new Error(String(error)),
              );
            });
        },
      );

      // 3. COMPACTION_START — context window compaction notification
      sdkAdapter.setCompactionStartCallback((data) => {
        this.logger.info(
          `[Electron RPC] Compaction started: sessionId=${data.sessionId}`,
        );
        const compactionEvent = {
          id: `compaction_${data.sessionId}_${data.timestamp}`,
          eventType: 'compaction_start' as const,
          timestamp: data.timestamp,
          sessionId: data.sessionId,
          messageId: `compaction_msg_${data.timestamp}`,
          trigger: data.trigger,
          source: 'stream' as const,
        };
        webviewManager
          .broadcastMessage(MESSAGE_TYPES.CHAT_CHUNK, {
            sessionId: data.sessionId,
            event: compactionEvent,
          })
          .catch((error) => {
            this.logger.error(
              '[Electron RPC] Failed to send compaction event',
              error instanceof Error ? error : new Error(String(error)),
            );
          });
      });

      // 4. WORKTREE callbacks — git worktree create/remove notifications
      sdkAdapter.setWorktreeCreatedCallback((data) => {
        this.logger.info(`[Electron RPC] Worktree created: name=${data.name}`);
        webviewManager
          .broadcastMessage('git:worktreeChanged', {
            action: 'created',
            name: data.name,
            path: data.cwd,
          })
          .catch((error) => {
            this.logger.error(
              '[Electron RPC] Failed to send git:worktreeChanged (created)',
              error instanceof Error ? error : new Error(String(error)),
            );
          });
      });

      sdkAdapter.setWorktreeRemovedCallback((data) => {
        this.logger.info(
          `[Electron RPC] Worktree removed: path=${data.worktreePath}`,
        );
        webviewManager
          .broadcastMessage('git:worktreeChanged', {
            action: 'removed',
            path: data.worktreePath,
          })
          .catch((error) => {
            this.logger.error(
              '[Electron RPC] Failed to send git:worktreeChanged (removed)',
              error instanceof Error ? error : new Error(String(error)),
            );
          });
      });

      this.logger.info(
        '[Electron RPC] SDK callbacks wired (stats, sessionId, compaction, worktree)',
      );
    } catch (error) {
      this.logger.warn(
        '[Electron RPC] Failed to setup SDK callbacks (non-fatal):',
        {
          error: error instanceof Error ? error.message : String(error),
        } as unknown as Error,
      );
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
      {
        name: 'ElectronAgentRpcHandlers',
        handler: this.agentHandlers,
      },
      {
        name: 'ElectronSkillsShRpcHandlers',
        handler: this.skillsShHandlers,
      },
      {
        name: 'ElectronLayoutRpcHandlers',
        handler: this.layoutHandlers,
      },
      {
        name: 'ElectronGitRpcHandlers',
        handler: this.gitHandlers,
      },
      {
        name: 'ElectronTerminalRpcHandlers',
        handler: this.terminalHandlers,
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
          } as unknown as Error,
        );
      }
    }
  }
}
