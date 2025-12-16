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
  TOKENS,
  CommandManager,
  verifyRpcRegistration,
} from '@ptah-extension/vscode-core';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { SdkAgentAdapter } from '@ptah-extension/agent-sdk';
import {
  SessionId,
  retryWithBackoff,
  MESSAGE_TYPES,
} from '@ptah-extension/shared';
import * as vscode from 'vscode';

import { ChatRpcHandlers } from './handlers/chat-rpc.handlers';
import { SessionRpcHandlers } from './handlers/session-rpc.handlers';
import { ContextRpcHandlers } from './handlers/context-rpc.handlers';
import { AutocompleteRpcHandlers } from './handlers/autocomplete-rpc.handlers';
import { FileRpcHandlers } from './handlers/file-rpc.handlers';
import { ConfigRpcHandlers } from './handlers/config-rpc.handlers';
import { AuthRpcHandlers } from './handlers/auth-rpc.handlers';
import { SetupRpcHandlers } from './handlers/setup-rpc.handlers';
import { LlmRpcHandlers } from './handlers/llm-rpc.handlers';

interface WebviewManager {
  sendMessage(viewType: string, type: string, payload: unknown): Promise<void>;
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
    @inject('SdkAgentAdapter') private readonly sdkAdapter: SdkAgentAdapter,
    // Domain-specific handlers
    private readonly chatHandlers: ChatRpcHandlers,
    private readonly sessionHandlers: SessionRpcHandlers,
    private readonly contextHandlers: ContextRpcHandlers,
    private readonly autocompleteHandlers: AutocompleteRpcHandlers,
    private readonly fileHandlers: FileRpcHandlers,
    private readonly configHandlers: ConfigRpcHandlers,
    private readonly authHandlers: AuthRpcHandlers,
    private readonly setupHandlers: SetupRpcHandlers,
    private readonly llmHandlers: LlmRpcHandlers,
    private readonly container: DependencyContainer
  ) {
    // Setup SDK callbacks and listeners
    this.setupAgentWatcherListeners();
    this.setupSessionIdResolvedCallback();
    this.setupResultStatsCallback();
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
    this.llmHandlers.register();

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
   */
  private setupSessionIdResolvedCallback(): void {
    this.sdkAdapter.setSessionIdResolvedCallback(
      (placeholderId: SessionId, realClaudeSessionId: string) => {
        this.logger.info(
          `[RPC] Session ID resolved: ${placeholderId} -> ${realClaudeSessionId}`
        );

        this.webviewManager
          .sendMessage('ptah.main', MESSAGE_TYPES.SESSION_ID_RESOLVED, {
            sessionId: placeholderId,
            realSessionId: realClaudeSessionId,
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
      });

      await this.sendStatsWithRetry(stats);
    });
  }

  /**
   * Send session stats to webview with retry logic
   */
  private async sendStatsWithRetry(stats: {
    sessionId: string;
    cost: number;
    tokens: { input: number; output: number };
    duration: number;
  }): Promise<void> {
    try {
      await retryWithBackoff(
        () =>
          this.webviewManager.sendMessage(
            'ptah.main',
            MESSAGE_TYPES.SESSION_STATS,
            {
              sessionId: stats.sessionId,
              cost: stats.cost,
              tokens: stats.tokens,
              duration: stats.duration,
            }
          ),
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
   */
  private setupAgentWatcherListeners(): void {
    (
      this.agentWatcher as {
        on(event: string, callback: (chunk: AgentSummaryChunk) => void): void;
      }
    ).on('summary-chunk', (chunk: AgentSummaryChunk) => {
      this.webviewManager
        .sendMessage('ptah.main', MESSAGE_TYPES.AGENT_SUMMARY_CHUNK, chunk)
        .catch((error) => {
          this.logger.error(
            'Failed to send agent summary chunk to webview',
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
          const { AGENT_GENERATION_TOKENS } = await import(
            '@ptah-extension/agent-generation'
          );

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
