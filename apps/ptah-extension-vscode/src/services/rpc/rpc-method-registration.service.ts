/**
 * RPC Method Registration Service
 *
 * Orchestrates RPC handler registration by delegating to domain-specific handler classes.
 * Responsible for:
 * - Initializing SDK callbacks (session ID resolution, stats)
 * - Setting up agent watcher listeners
 * - Registering VS Code commands
 * - Delegating to domain-specific handler classes
 * - Verifying all expected methods are registered
 *
 * TASK_2025_051: SDK-only migration
 * TASK_2025_074: Refactored from ~1500 lines to ~150 lines orchestrator
 */

import { injectable, inject, DependencyContainer } from 'tsyringe';
import {
  Logger,
  RpcHandler,
  AgentSessionWatcherService,
  AgentSummaryChunk,
  AgentStartEvent,
  TOKENS,
  CommandManager,
  verifyRpcRegistration,
} from '@ptah-extension/vscode-core';
import { SdkAgentAdapter, SDK_TOKENS } from '@ptah-extension/agent-sdk';
import {
  SessionId,
  retryWithBackoff,
  MESSAGE_TYPES,
} from '@ptah-extension/shared';
import { AGENT_GENERATION_TOKENS } from '@ptah-extension/agent-generation';
import * as vscode from 'vscode';

import { ChatRpcHandlers } from './handlers/chat-rpc.handlers';
import { SessionRpcHandlers } from './handlers/session-rpc.handlers';
import { ContextRpcHandlers } from './handlers/context-rpc.handlers';
import { AutocompleteRpcHandlers } from './handlers/autocomplete-rpc.handlers';
import { FileRpcHandlers } from './handlers/file-rpc.handlers';
import { ConfigRpcHandlers } from './handlers/config-rpc.handlers';
import { AuthRpcHandlers } from './handlers/auth-rpc.handlers';
import { SetupRpcHandlers } from './handlers/setup-rpc.handlers';
import { LicenseRpcHandlers } from './handlers/license-rpc.handlers';
import { LlmRpcHandlers } from './handlers/llm-rpc.handlers';
import { ProviderRpcHandlers } from './handlers/provider-rpc.handlers';
import { SubagentRpcHandlers } from './handlers/subagent-rpc.handlers';
import { CommandRpcHandlers } from './handlers/command-rpc.handlers';
import { EnhancedPromptsRpcHandlers } from './handlers/enhanced-prompts-rpc.handlers';
import { QualityRpcHandlers } from './handlers/quality-rpc.handlers';
import { WizardGenerationRpcHandlers } from './handlers/wizard-generation-rpc.handlers'; // TASK_2025_148
import { PluginRpcHandlers } from './handlers/plugin-rpc.handlers'; // TASK_2025_153
import { AgentRpcHandlers } from './handlers/agent-rpc.handlers'; // TASK_2025_157

interface WebviewManager {
  sendMessage(viewType: string, type: string, payload: unknown): Promise<void>;
  broadcastMessage(type: string, payload: unknown): Promise<void>;
}

/**
 * Orchestrates RPC method registration across all domain handlers.
 *
 * TASK_2025_074: Reduced from ~1500 lines to ~150 lines by extracting
 * domain-specific handlers into separate classes.
 */
@injectable()
export class RpcMethodRegistrationService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager,
    @inject(TOKENS.AGENT_SESSION_WATCHER_SERVICE)
    private readonly agentWatcher: AgentSessionWatcherService,
    @inject(TOKENS.COMMAND_MANAGER)
    private readonly commandManager: CommandManager,
    @inject(SDK_TOKENS.SDK_AGENT_ADAPTER)
    private readonly sdkAdapter: SdkAgentAdapter,
    // Domain-specific handlers
    private readonly chatHandlers: ChatRpcHandlers,
    private readonly sessionHandlers: SessionRpcHandlers,
    private readonly contextHandlers: ContextRpcHandlers,
    private readonly autocompleteHandlers: AutocompleteRpcHandlers,
    private readonly fileHandlers: FileRpcHandlers,
    private readonly configHandlers: ConfigRpcHandlers,
    private readonly authHandlers: AuthRpcHandlers,
    private readonly setupHandlers: SetupRpcHandlers,
    private readonly licenseHandlers: LicenseRpcHandlers,
    private readonly llmHandlers: LlmRpcHandlers,
    private readonly providerHandlers: ProviderRpcHandlers,
    private readonly subagentHandlers: SubagentRpcHandlers,
    private readonly commandHandlers: CommandRpcHandlers, // TASK_2025_126
    private readonly enhancedPromptsHandlers: EnhancedPromptsRpcHandlers, // TASK_2025_137
    private readonly qualityHandlers: QualityRpcHandlers, // TASK_2025_144
    private readonly wizardGenerationHandlers: WizardGenerationRpcHandlers, // TASK_2025_148
    private readonly pluginHandlers: PluginRpcHandlers, // TASK_2025_153
    private readonly agentHandlers: AgentRpcHandlers, // TASK_2025_157
    private readonly container: DependencyContainer
  ) {
    // Setup SDK callbacks and listeners
    this.setupAgentWatcherListeners();
    this.setupSessionIdResolvedCallback();
    this.setupResultStatsCallback();
    this.setupCompactionStartCallback();
    this.registerSetupAgentsCommand();
  }

  /**
   * Register all RPC methods by delegating to domain-specific handlers
   */
  registerAll(): void {
    // Delegate to domain-specific handlers
    this.chatHandlers.register();
    this.sessionHandlers.register();
    this.contextHandlers.register();
    this.autocompleteHandlers.register();
    this.fileHandlers.register();
    this.configHandlers.register();
    this.authHandlers.register();
    this.setupHandlers.register();
    this.licenseHandlers.register();
    this.llmHandlers.register();
    this.providerHandlers.register();
    this.subagentHandlers.register();
    this.commandHandlers.register(); // TASK_2025_126
    this.enhancedPromptsHandlers.register(); // TASK_2025_137
    this.qualityHandlers.register(); // TASK_2025_144
    this.wizardGenerationHandlers.register(); // TASK_2025_148
    this.pluginHandlers.register(); // TASK_2025_153
    this.agentHandlers.register(); // TASK_2025_157

    this.logger.info('RPC methods registered (SDK-only mode)', {
      methods: this.rpcHandler.getRegisteredMethods(),
    });

    // Verify all expected RPC methods have handlers
    const verificationResult = verifyRpcRegistration(
      this.rpcHandler,
      this.logger
    );

    if (!verificationResult.valid) {
      this.logger.error(
        `RPC registration incomplete: ${verificationResult.missingHandlers.length} methods missing`,
        new Error(
          `Missing: ${verificationResult.missingHandlers.join(', ')}. ` +
            `Add handlers or remove from RpcMethodRegistry.`
        )
      );
    }
  }

  /**
   * Setup callback to notify frontend when real Claude session ID is resolved
   * TASK_2025_095: Now uses tabId for direct routing - no temp ID lookup needed.
   */
  private setupSessionIdResolvedCallback(): void {
    this.sdkAdapter.setSessionIdResolvedCallback(
      (tabId: string | undefined, realSessionId: string) => {
        this.logger.info(
          `[RPC] Session ID resolved from SDK: tabId=${tabId} -> real=${realSessionId}`
        );

        // Notify frontend with tabId for direct routing
        // tabId: used to find the tab directly (no temp ID lookup needed)
        // realSessionId: the actual SDK UUID to store on the tab
        this.webviewManager
          .broadcastMessage(MESSAGE_TYPES.SESSION_ID_RESOLVED, {
            tabId,
            realSessionId: realSessionId,
          })
          .catch((error) => {
            this.logger.error(
              'Failed to send session:id-resolved to webview',
              error instanceof Error ? error : new Error(String(error))
            );
          });
      }
    );
  }

  /**
   * Setup callback to notify frontend when result message with stats is received
   */
  private setupResultStatsCallback(): void {
    this.sdkAdapter.setResultStatsCallback(async (stats) => {
      this.logger.info(`[RPC] Session stats received: ${stats.sessionId}`, {
        cost: stats.cost,
        tokens: stats.tokens,
        duration: stats.duration,
        modelUsage: stats.modelUsage,
      });

      await this.sendStatsWithRetry(stats);
    });
  }

  /**
   * Setup callback to notify frontend when compaction starts
   * TASK_2025_098: SDK Session Compaction
   *
   * Unified flow: Routes compaction events through CHAT_CHUNK (same as streaming events)
   * instead of a separate SESSION_COMPACTING message type.
   * This ensures all streaming events flow through the same code path.
   */
  private setupCompactionStartCallback(): void {
    this.sdkAdapter.setCompactionStartCallback((data) => {
      this.logger.info(
        `[RPC] Compaction started: sessionId=${data.sessionId}, trigger=${data.trigger}`
      );

      // Create a CompactionStartEvent to send through the unified streaming path
      const compactionEvent = {
        id: `compaction_${data.sessionId}_${data.timestamp}`,
        eventType: 'compaction_start' as const,
        timestamp: data.timestamp,
        sessionId: data.sessionId,
        messageId: `compaction_msg_${data.timestamp}`,
        trigger: data.trigger,
        source: 'stream' as const,
      };

      // Route through CHAT_CHUNK (same path as all other streaming events)
      // Frontend will process this through StreamingHandlerService
      this.webviewManager
        .broadcastMessage(MESSAGE_TYPES.CHAT_CHUNK, {
          sessionId: data.sessionId,
          event: compactionEvent,
        })
        .catch((error) => {
          this.logger.error(
            'Failed to send compaction event to webview',
            error instanceof Error ? error : new Error(String(error))
          );
        });
    });
  }

  /**
   * Send session stats to webview with retry logic
   */
  private async sendStatsWithRetry(stats: {
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
    }>;
  }): Promise<void> {
    try {
      await retryWithBackoff(
        () =>
          this.webviewManager.broadcastMessage(MESSAGE_TYPES.SESSION_STATS, {
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
        }
      );
    } catch (error) {
      this.logger.error(
        '[RPC] Failed to send session:stats after all retries',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Setup listeners for agent session watcher events
   *
   * TASK_2025_100 FIX: Also listens for 'agent-start' events to send
   * agent_start streaming events BEFORE summary chunks arrive. This
   * fixes the race condition where summary chunks were buffered.
   */
  private setupAgentWatcherListeners(): void {
    // Type the agentWatcher for EventEmitter methods
    const watcher = this.agentWatcher as {
      on(
        event: 'summary-chunk',
        callback: (chunk: AgentSummaryChunk) => void
      ): void;
      on(
        event: 'agent-start',
        callback: (event: AgentStartEvent) => void
      ): void;
    };

    // Listen for summary chunks (existing behavior)
    watcher.on('summary-chunk', (chunk: AgentSummaryChunk) => {
      // DIAGNOSTIC: Log when we receive and forward summary chunks
      this.logger.info(
        '[RpcMethodRegistrationService] Received summary-chunk, forwarding to webview',
        {
          toolUseId: chunk.toolUseId,
          agentId: chunk.agentId, // TASK_2025_099: Stable key for summary lookup
          deltaLength: chunk.summaryDelta.length,
          deltaPreview: chunk.summaryDelta.slice(0, 50),
        }
      );

      // TASK_2025_099: Forward entire chunk including agentId for stable lookup
      this.webviewManager
        .broadcastMessage(MESSAGE_TYPES.AGENT_SUMMARY_CHUNK, chunk)
        .then(() => {
          this.logger.info(
            '[RpcMethodRegistrationService] Summary-chunk sent to webview successfully',
            { toolUseId: chunk.toolUseId }
          );
        })
        .catch((error) => {
          this.logger.error(
            'Failed to send agent summary chunk to webview',
            error instanceof Error ? error : new Error(String(error))
          );
        });
    });

    // TASK_2025_100 FIX: Listen for agent-start events and send as agent_start streaming event
    // This creates the agent node in the frontend BEFORE summary chunks arrive
    watcher.on('agent-start', (agentStartEvent: AgentStartEvent) => {
      this.logger.info(
        '[RpcMethodRegistrationService] Received agent-start event',
        {
          toolUseId: agentStartEvent.toolUseId,
          agentId: agentStartEvent.agentId, // TASK_2025_099: Stable key for summary lookup
          agentType: agentStartEvent.agentType,
          sessionId: agentStartEvent.sessionId,
        }
      );

      // Send as a CHAT_CHUNK with agent_start event type
      // This matches the format expected by streaming-handler.service.ts
      // Include sessionId for frontend to route to correct tab
      // TASK_2025_099: Include agentId for stable summary content lookup
      // TASK_2025_128 FIX: Include parentToolUseId for tree builder matching.
      // The toolUseId from the hook IS the parent Task tool's ID - this is what
      // the subagent hooks provide. Without parentToolUseId, collectTools() in
      // execution-tree-builder.service.ts can't find this agent_start event and
      // creates placeholder agents instead, causing duplicates.
      const streamingEvent = {
        id: `agent-start-${agentStartEvent.toolUseId}`,
        eventType: 'agent_start' as const,
        sessionId: agentStartEvent.sessionId, // Parent session for tab routing
        messageId: '',
        toolCallId: agentStartEvent.toolUseId,
        parentToolUseId: agentStartEvent.toolUseId, // TASK_2025_128: Link to parent Task tool
        agentType: agentStartEvent.agentType,
        agentDescription: agentStartEvent.agentDescription,
        timestamp: agentStartEvent.timestamp,
        source: 'hook' as const, // Mark as from hook (for duplicate detection)
        agentId: agentStartEvent.agentId, // Stable key for summary lookup
      };

      this.webviewManager
        .broadcastMessage(MESSAGE_TYPES.CHAT_CHUNK, {
          // TASK_2025_100: No tabId available from hook - frontend will resolve from sessionId
          sessionId: agentStartEvent.sessionId,
          event: streamingEvent,
        })
        .catch((error) => {
          this.logger.error(
            'Failed to send agent-start event to webview',
            error instanceof Error ? error : new Error(String(error))
          );
        });
    });
  }

  /**
   * Register VS Code command for launching setup wizard
   */
  private registerSetupAgentsCommand(): void {
    this.commandManager.registerCommand({
      id: 'ptah.setupAgents',
      title: 'Setup Ptah Agents',
      category: 'Ptah',
      handler: async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

        if (!workspaceFolder) {
          vscode.window.showErrorMessage(
            'No workspace open. Please open a folder first.'
          );
          return;
        }

        try {
          const setupWizardService = this.container.resolve(
            AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE
          ) as {
            launchWizard: (uri: vscode.Uri) => Promise<{
              isErr?: () => boolean;
              error?: { message: string };
            }>;
          };

          const result = await setupWizardService.launchWizard(
            workspaceFolder.uri
          );

          if (result.isErr && result.isErr()) {
            vscode.window.showErrorMessage(
              `Failed to launch setup wizard: ${result.error?.message}`
            );
          }
        } catch (error) {
          this.logger.error(
            'Failed to launch setup wizard',
            error instanceof Error ? error : new Error(String(error))
          );
          vscode.window.showErrorMessage(
            `Failed to launch setup wizard: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`
          );
        }
      },
    });

    this.logger.info('Setup agents command registered');
  }
}
