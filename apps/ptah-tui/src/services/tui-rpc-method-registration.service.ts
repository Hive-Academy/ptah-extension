/**
 * TUI RPC Method Registration Service
 *
 * TASK_2025_263 Batch 3: Mirrors ElectronRpcMethodRegistrationService but
 * registers ONLY the 17 shared handlers (NO Electron-specific handlers).
 *
 * Handler registration order:
 * 1. Shared handlers (17 handlers from @ptah-extension/rpc-handlers)
 * 2. SDK callbacks (SESSION_STATS, SESSION_ID_RESOLVED, compaction)
 * 3. Agent watcher listeners (summary chunks, agent-start events)
 * 4. Agent monitor listeners (spawned, output, exited)
 * 5. RPC verification
 */

import { container } from 'tsyringe';
import { TOKENS, verifyRpcRegistration } from '@ptah-extension/vscode-core';
import type {
  Logger,
  RpcHandler,
  AgentSummaryChunk,
  AgentStartEvent,
} from '@ptah-extension/vscode-core';
import { MESSAGE_TYPES, retryWithBackoff } from '@ptah-extension/shared';
import type {
  AgentProcessInfo,
  AgentOutputDelta,
} from '@ptah-extension/shared';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type { SdkAgentAdapter } from '@ptah-extension/agent-sdk';
import type { AgentProcessManager } from '@ptah-extension/agent-sdk';

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

/**
 * RPC methods not applicable in TUI — platform-specific (VS Code/Electron only).
 * Excluded from RPC verification to prevent false CRITICAL errors.
 */
const TUI_EXCLUDED_RPC_METHODS: string[] = [
  // File operations (VS Code/Electron file pickers & dialogs)
  'file:open',
  'file:pick',
  'file:pick-images',
  'file:read',
  'file:exists',
  'file:save-dialog',

  // Command execution (VS Code command palette)
  'command:execute',

  // Agent orchestration (registered by platform-specific handlers)
  'agent:getConfig',
  'agent:setConfig',
  'agent:detectClis',
  'agent:listCliModels',
  'agent:permissionResponse',
  'agent:stop',
  'agent:resumeCliSession',

  // Skills.sh marketplace (not available in CLI v1)
  'skillsSh:search',
  'skillsSh:listInstalled',
  'skillsSh:install',
  'skillsSh:uninstall',
  'skillsSh:getPopular',
  'skillsSh:detectRecommended',

  // Workspace management (Electron desktop only)
  'workspace:getInfo',
  'workspace:addFolder',
  'workspace:removeFolder',
  'workspace:switch',

  // Layout persistence (Electron desktop only)
  'layout:persist',
  'layout:restore',

  // Editor operations (Electron desktop only)
  'editor:openFile',
  'editor:saveFile',
  'editor:getFileTree',
  'editor:getDirectoryChildren',

  // Extended config/auth (Electron desktop only)
  'config:model-set',
  'auth:setApiKey',
  'auth:getStatus',
  'auth:getApiKeyStatus',

  // Settings import/export (Electron desktop only)
  'settings:export',
  'settings:import',

  // Git operations (Electron desktop only)
  'git:info',
  'git:worktrees',
  'git:addWorktree',
  'git:removeWorktree',

  // Terminal operations (Electron desktop only)
  'terminal:create',
  'terminal:kill',
];

/**
 * Orchestrates RPC method registration across all shared domain handlers.
 *
 * Unlike ElectronRpcMethodRegistrationService, this does NOT use @injectable()
 * because we want to avoid tsyringe DI decorator overhead for a service that is
 * only instantiated once during bootstrap. Instead, it resolves dependencies
 * from the global container directly.
 */
export class TuiRpcMethodRegistrationService {
  private readonly logger: Logger;
  private readonly rpcHandler: RpcHandler;

  constructor() {
    this.logger = container.resolve<Logger>(TOKENS.LOGGER);
    this.rpcHandler = container.resolve<RpcHandler>(TOKENS.RPC_HANDLER);
  }

  /**
   * Register all RPC methods by delegating to domain-specific handlers.
   *
   * Only shared handlers are registered -- NO Electron-specific handlers.
   */
  registerAll(): void {
    // Phase 1: Shared handlers from @ptah-extension/rpc-handlers
    this.registerSharedHandlers();

    // Phase 2: Wire SDK callbacks (SESSION_STATS, SESSION_ID_RESOLVED, etc.)
    this.setupSdkCallbacks();

    // Phase 3: Wire agent watcher listeners (summary chunks, agent-start events)
    this.setupAgentWatcherListeners();

    // Phase 4: Wire agent monitor listeners (spawned, output, exited)
    this.setupAgentMonitorListeners();

    // Phase 5: Verify all expected RPC methods are registered
    // Exclude platform-specific methods not applicable in TUI (VS Code/Electron only)
    verifyRpcRegistration(
      this.rpcHandler,
      this.logger,
      TUI_EXCLUDED_RPC_METHODS,
    );

    this.logger.info('[TUI RPC] All RPC methods registered', {
      methods: this.rpcHandler.getRegisteredMethods(),
    } as unknown as Error);
  }

  private registerSharedHandlers(): void {
    const sharedHandlers: Array<{
      name: string;
      handler: { register(): void };
    }> = [
      {
        name: 'SessionRpcHandlers',
        handler: container.resolve(SessionRpcHandlers),
      },
      {
        name: 'ChatRpcHandlers',
        handler: container.resolve(ChatRpcHandlers),
      },
      {
        name: 'ConfigRpcHandlers',
        handler: container.resolve(ConfigRpcHandlers),
      },
      {
        name: 'AuthRpcHandlers',
        handler: container.resolve(AuthRpcHandlers),
      },
      {
        name: 'ContextRpcHandlers',
        handler: container.resolve(ContextRpcHandlers),
      },
      {
        name: 'SetupRpcHandlers',
        handler: container.resolve(SetupRpcHandlers),
      },
      {
        name: 'LicenseRpcHandlers',
        handler: container.resolve(LicenseRpcHandlers),
      },
      {
        name: 'WizardGenerationRpcHandlers',
        handler: container.resolve(WizardGenerationRpcHandlers),
      },
      {
        name: 'AutocompleteRpcHandlers',
        handler: container.resolve(AutocompleteRpcHandlers),
      },
      {
        name: 'SubagentRpcHandlers',
        handler: container.resolve(SubagentRpcHandlers),
      },
      {
        name: 'PluginRpcHandlers',
        handler: container.resolve(PluginRpcHandlers),
      },
      {
        name: 'PtahCliRpcHandlers',
        handler: container.resolve(PtahCliRpcHandlers),
      },
      {
        name: 'EnhancedPromptsRpcHandlers',
        handler: container.resolve(EnhancedPromptsRpcHandlers),
      },
      {
        name: 'QualityRpcHandlers',
        handler: container.resolve(QualityRpcHandlers),
      },
      {
        name: 'ProviderRpcHandlers',
        handler: container.resolve(ProviderRpcHandlers),
      },
      {
        name: 'LlmRpcHandlers',
        handler: container.resolve(LlmRpcHandlers),
      },
      {
        name: 'WebSearchRpcHandlers',
        handler: container.resolve(WebSearchRpcHandlers),
      },
    ];

    for (const { name, handler } of sharedHandlers) {
      try {
        handler.register();
        this.logger.info(`[TUI RPC] ${name} registered (shared)`);
      } catch (error) {
        this.logger.error(`[TUI RPC] Failed to register ${name} (shared)`, {
          error: error instanceof Error ? error.message : String(error),
        } as unknown as Error);
      }
    }
  }

  /**
   * Wire SDK adapter callbacks so the backend can push events to the TUI.
   *
   * Resolved lazily because SdkAgentAdapter and WebviewManager may not be
   * registered at DI construction time.
   */
  private setupSdkCallbacks(): void {
    if (!container.isRegistered(SDK_TOKENS.SDK_AGENT_ADAPTER)) {
      this.logger.warn(
        '[TUI RPC] SdkAgentAdapter not registered -- SDK callbacks skipped',
      );
      return;
    }

    if (!container.isRegistered(TOKENS.WEBVIEW_MANAGER)) {
      this.logger.warn(
        '[TUI RPC] WebviewManager not registered -- SDK callbacks skipped',
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

      // 1. SESSION_STATS -- authoritative streaming completion signal
      sdkAdapter.setResultStatsCallback(async (stats) => {
        this.logger.info(
          `[TUI RPC] Session stats received: ${stats.sessionId}`,
        );
        await this.sendStatsWithRetry(webviewManager, stats);
      });

      // 2. SESSION_ID_RESOLVED -- temporary tab ID -> real SDK UUID
      sdkAdapter.setSessionIdResolvedCallback(
        (tabId: string | undefined, realSessionId: string) => {
          this.logger.info(
            `[TUI RPC] Session ID resolved: tabId=${tabId} -> real=${realSessionId}`,
          );

          // Update CLI agents spawned with tab ID as parentSessionId
          if (tabId) {
            try {
              if (container.isRegistered(TOKENS.AGENT_PROCESS_MANAGER)) {
                const agentProcessManager =
                  container.resolve<AgentProcessManager>(
                    TOKENS.AGENT_PROCESS_MANAGER,
                  );
                agentProcessManager.resolveParentSessionId(
                  tabId,
                  realSessionId,
                );

                // Resolve parent session ID in SubagentRegistryService
                try {
                  if (
                    container.isRegistered(TOKENS.SUBAGENT_REGISTRY_SERVICE)
                  ) {
                    const subagentRegistry = container.resolve<{
                      resolveParentSessionId(
                        tabId: string,
                        realSessionId: string,
                      ): void;
                    }>(TOKENS.SUBAGENT_REGISTRY_SERVICE);
                    subagentRegistry.resolveParentSessionId(
                      tabId,
                      realSessionId,
                    );
                  }
                } catch {
                  // SubagentRegistryService may not be registered yet
                }
              }
            } catch {
              // AgentProcessManager may not be registered yet
            }
          }

          webviewManager
            .broadcastMessage(MESSAGE_TYPES.SESSION_ID_RESOLVED, {
              tabId,
              realSessionId,
            })
            .catch((error) => {
              this.logger.error(
                '[TUI RPC] Failed to send session:id-resolved',
                error instanceof Error ? error : new Error(String(error)),
              );
            });
        },
      );

      // 3. COMPACTION_START -- context window compaction notification
      sdkAdapter.setCompactionStartCallback((data) => {
        this.logger.info(
          `[TUI RPC] Compaction started: sessionId=${data.sessionId}`,
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
              '[TUI RPC] Failed to send compaction event',
              error instanceof Error ? error : new Error(String(error)),
            );
          });
      });

      this.logger.info(
        '[TUI RPC] SDK callbacks wired (stats, sessionId, compaction)',
      );
    } catch (error) {
      this.logger.warn('[TUI RPC] Failed to setup SDK callbacks (non-fatal):', {
        error: error instanceof Error ? error.message : String(error),
      } as unknown as Error);
    }
  }

  /**
   * Send session stats to TUI with retry logic.
   * Retries on channel/disposed/closed/timeout errors (3 retries, 1s initial delay).
   */
  private async sendStatsWithRetry(
    webviewManager: {
      broadcastMessage(type: string, payload: unknown): Promise<void>;
    },
    stats: {
      sessionId: string;
      cost: number;
      tokens: {
        input: number;
        output: number;
        cacheRead?: number;
        cacheCreation?: number;
      };
      duration: number;
      modelUsage?: Array<{
        model: string;
        inputTokens: number;
        outputTokens: number;
        contextWindow: number;
        costUSD: number;
        cacheReadInputTokens?: number;
        lastTurnContextTokens?: number;
      }>;
    },
  ): Promise<void> {
    try {
      await retryWithBackoff(
        () =>
          webviewManager.broadcastMessage(MESSAGE_TYPES.SESSION_STATS, {
            sessionId: stats.sessionId,
            cost: stats.cost,
            tokens: stats.tokens,
            duration: stats.duration,
            modelUsage: stats.modelUsage,
          }),
        {
          retries: 3,
          initialDelay: 1000,
          shouldRetry: (error: unknown): boolean => {
            const message =
              error instanceof Error ? error.message.toLowerCase() : '';
            return (
              message.includes('channel') ||
              message.includes('disposed') ||
              message.includes('closed') ||
              message.includes('timeout')
            );
          },
        },
      );
    } catch (error) {
      this.logger.error(
        '[TUI RPC] Failed to send session:stats after all retries',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Setup listeners for agent session watcher events (summary chunks, agent-start).
   */
  private setupAgentWatcherListeners(): void {
    if (!container.isRegistered(TOKENS.AGENT_SESSION_WATCHER_SERVICE)) {
      this.logger.warn(
        '[TUI RPC] AgentSessionWatcherService not registered -- watcher listeners skipped',
      );
      return;
    }

    if (!container.isRegistered(TOKENS.WEBVIEW_MANAGER)) {
      this.logger.warn(
        '[TUI RPC] WebviewManager not registered -- watcher listeners skipped',
      );
      return;
    }

    try {
      const agentWatcher = container.resolve<{
        on(
          event: 'summary-chunk',
          callback: (chunk: AgentSummaryChunk) => void,
        ): void;
        on(
          event: 'agent-start',
          callback: (event: AgentStartEvent) => void,
        ): void;
      }>(TOKENS.AGENT_SESSION_WATCHER_SERVICE);

      const webviewManager = container.resolve<{
        broadcastMessage(type: string, payload: unknown): Promise<void>;
      }>(TOKENS.WEBVIEW_MANAGER);

      // Listen for summary chunks and forward to TUI
      agentWatcher.on('summary-chunk', (chunk: AgentSummaryChunk) => {
        webviewManager
          .broadcastMessage(MESSAGE_TYPES.AGENT_SUMMARY_CHUNK, chunk)
          .catch((error) => {
            this.logger.error(
              '[TUI RPC] Failed to send agent summary chunk',
              error instanceof Error ? error : new Error(String(error)),
            );
          });
      });

      // Listen for agent-start events and send as agent_start streaming event
      agentWatcher.on('agent-start', (agentStartEvent: AgentStartEvent) => {
        const streamingEvent = {
          id: `agent-start-${agentStartEvent.toolUseId}`,
          eventType: 'agent_start' as const,
          sessionId: agentStartEvent.sessionId,
          messageId: '',
          toolCallId: agentStartEvent.toolUseId,
          parentToolUseId: agentStartEvent.toolUseId,
          agentType: agentStartEvent.agentType,
          agentDescription: agentStartEvent.agentDescription,
          timestamp: agentStartEvent.timestamp,
          source: 'hook' as const,
          agentId: agentStartEvent.agentId,
        };

        webviewManager
          .broadcastMessage(MESSAGE_TYPES.CHAT_CHUNK, {
            sessionId: agentStartEvent.sessionId,
            event: streamingEvent,
          })
          .catch((error) => {
            this.logger.error(
              '[TUI RPC] Failed to send agent-start event',
              error instanceof Error ? error : new Error(String(error)),
            );
          });
      });

      this.logger.info(
        '[TUI RPC] Agent watcher listeners registered (summary-chunk, agent-start)',
      );
    } catch (error) {
      this.logger.warn(
        '[TUI RPC] Failed to setup agent watcher listeners (non-fatal):',
        {
          error: error instanceof Error ? error.message : String(error),
        } as unknown as Error,
      );
    }
  }

  /**
   * Setup listeners for agent process manager events (spawned, output, exited).
   */
  private setupAgentMonitorListeners(): void {
    if (!container.isRegistered(TOKENS.AGENT_PROCESS_MANAGER)) {
      this.logger.warn(
        '[TUI RPC] AgentProcessManager not registered -- monitor listeners skipped',
      );
      return;
    }

    if (!container.isRegistered(TOKENS.WEBVIEW_MANAGER)) {
      this.logger.warn(
        '[TUI RPC] WebviewManager not registered -- monitor listeners skipped',
      );
      return;
    }

    try {
      const agentProcessManager = container.resolve<AgentProcessManager>(
        TOKENS.AGENT_PROCESS_MANAGER,
      );

      const webviewManager = container.resolve<{
        broadcastMessage(type: string, payload: unknown): Promise<void>;
      }>(TOKENS.WEBVIEW_MANAGER);

      agentProcessManager.events.on(
        'agent:spawned',
        (info: AgentProcessInfo) => {
          webviewManager
            .broadcastMessage(MESSAGE_TYPES.AGENT_MONITOR_SPAWNED, info)
            .catch((error) => {
              this.logger.error(
                '[TUI RPC] Failed to send agent-monitor:spawned',
                error instanceof Error ? error : new Error(String(error)),
              );
            });
        },
      );

      agentProcessManager.events.on(
        'agent:output',
        (delta: AgentOutputDelta) => {
          webviewManager
            .broadcastMessage(MESSAGE_TYPES.AGENT_MONITOR_OUTPUT, delta)
            .catch((error) => {
              this.logger.error(
                '[TUI RPC] Failed to send agent-monitor:output',
                error instanceof Error ? error : new Error(String(error)),
              );
            });
        },
      );

      agentProcessManager.events.on(
        'agent:exited',
        (info: AgentProcessInfo) => {
          webviewManager
            .broadcastMessage(MESSAGE_TYPES.AGENT_MONITOR_EXITED, info)
            .catch((error) => {
              this.logger.error(
                '[TUI RPC] Failed to send agent-monitor:exited',
                error instanceof Error ? error : new Error(String(error)),
              );
            });
        },
      );

      this.logger.info(
        '[TUI RPC] Agent monitor listeners registered (spawned, output, exited)',
      );
    } catch (error) {
      this.logger.warn(
        '[TUI RPC] Could not setup agent monitor listeners (non-fatal)',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
}
