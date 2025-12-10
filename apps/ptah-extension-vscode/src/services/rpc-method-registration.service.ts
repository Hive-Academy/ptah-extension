/**
 * RPC Method Registration Service
 *
 * App-level orchestration service that wires SDK services with RPC handlers.
 * Moved from vscode-core to app layer to resolve circular dependency
 * (agent-sdk depends on vscode-core for Logger/TOKENS, and this service uses agent-sdk).
 *
 * TASK_2025_051: SDK-only migration - relocated to app layer with proper type safety
 *
 * Working methods:
 * - context:getAllFiles, context:getFileSuggestions
 * - autocomplete:agents, autocomplete:mcps, autocomplete:commands
 * - chat:start, chat:continue, chat:abort
 * - session:list, session:load
 */

import { injectable, inject } from 'tsyringe';
import { z } from 'zod';
import {
  Logger,
  RpcHandler,
  AgentSessionWatcherService,
  AgentSummaryChunk,
  TOKENS,
  ConfigManager,
} from '@ptah-extension/vscode-core';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { SdkAgentAdapter, SdkSessionStorage } from '@ptah-extension/agent-sdk';
import {
  ClaudeModel,
  PermissionLevel,
  AVAILABLE_MODELS,
  ModelInfo,
  SessionId,
  ExecutionNode,
  // RPC Types - Type-safe params and results
  ChatStartParams,
  ChatStartResult,
  ChatContinueParams,
  ChatContinueResult,
  ChatAbortParams,
  ChatAbortResult,
  SessionListParams,
  SessionListResult,
  SessionLoadParams,
  SessionLoadResult,
  ContextGetAllFilesParams,
  ContextGetFileSuggestionsParams,
  AutocompleteAgentsParams,
  AutocompleteCommandsParams,
  FileOpenParams,
  FileOpenResult,
  ConfigModelSwitchParams,
  ConfigModelSwitchResult,
  ConfigModelGetResult,
  ConfigAutopilotToggleParams,
  ConfigAutopilotToggleResult,
  ConfigAutopilotGetResult,
  ConfigModelsListResult,
} from '@ptah-extension/shared';
import * as vscode from 'vscode';

// Import domain service types
interface ContextOrchestrationService {
  getAllFiles(params: ContextGetAllFilesParams): Promise<unknown>;
  getFileSuggestions(params: ContextGetFileSuggestionsParams): Promise<unknown>;
}

interface AgentDiscoveryService {
  searchAgents(request: {
    query: string;
    maxResults?: number;
  }): Promise<unknown>;
}

interface CommandDiscoveryService {
  searchCommands(request: {
    query: string;
    maxResults?: number;
  }): Promise<unknown>;
}

interface WebviewManager {
  sendMessage(viewType: string, type: string, payload: unknown): Promise<void>;
}

/**
 * Service responsible for registering all RPC methods
 *
 * TASK_2025_051: Migrated to SDK-based communication and relocated to app layer
 */
@injectable()
export class RpcMethodRegistrationService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.CONTEXT_ORCHESTRATION_SERVICE)
    private readonly contextOrchestration: ContextOrchestrationService,
    @inject(TOKENS.AGENT_DISCOVERY_SERVICE)
    private readonly agentDiscovery: AgentDiscoveryService,
    @inject(TOKENS.COMMAND_DISCOVERY_SERVICE)
    private readonly commandDiscovery: CommandDiscoveryService,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager,
    @inject(TOKENS.AGENT_SESSION_WATCHER_SERVICE)
    private readonly agentWatcher: AgentSessionWatcherService,
    @inject(TOKENS.CONFIG_MANAGER)
    private readonly configManager: ConfigManager,
    @inject('SdkAgentAdapter') private readonly sdkAdapter: SdkAgentAdapter,
    @inject('SdkSessionStorage') private readonly sdkStorage: SdkSessionStorage
  ) {
    // Setup agent watcher summary chunk listener
    this.setupAgentWatcherListeners();

    // Setup session ID resolution callback
    // This sends 'session:id-resolved' event to frontend when SDK returns real Claude UUID
    this.setupSessionIdResolvedCallback();

    // Setup result stats callback
    // This sends 'session:stats' event to frontend when SDK result message is received
    this.setupResultStatsCallback();
  }

  /**
   * Setup callback to notify frontend when real Claude session ID is resolved
   * This bridges the gap between placeholder IDs and real Claude UUIDs
   */
  private setupSessionIdResolvedCallback(): void {
    this.sdkAdapter.setSessionIdResolvedCallback(
      (placeholderId: SessionId, realClaudeSessionId: string) => {
        this.logger.info(
          `[RPC] Session ID resolved: ${placeholderId} -> ${realClaudeSessionId}`
        );

        this.webviewManager
          .sendMessage('ptah.main', 'session:id-resolved', {
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
   * This sends session:stats event to webview when streaming completes
   */
  private setupResultStatsCallback(): void {
    this.sdkAdapter.setResultStatsCallback((stats) => {
      this.logger.info(`[RPC] Session stats received: ${stats.sessionId}`, {
        cost: stats.cost,
        tokens: stats.tokens,
        duration: stats.duration,
      });

      this.webviewManager
        .sendMessage('ptah.main', 'session:stats', {
          sessionId: stats.sessionId,
          cost: stats.cost,
          tokens: stats.tokens,
          duration: stats.duration,
        })
        .catch((error) => {
          this.logger.error(
            'Failed to send session:stats to webview',
            error instanceof Error ? error : new Error(String(error))
          );
        });
    });
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
        .sendMessage('ptah.main', 'agent:summary-chunk', chunk)
        .catch((error) => {
          this.logger.error(
            'Failed to send agent summary chunk to webview',
            error instanceof Error ? error : new Error(String(error))
          );
        });
    });
  }

  /**
   * Register all RPC methods
   */
  registerAll(): void {
    this.registerChatMethods();
    this.registerSessionMethods();
    this.registerContextMethods();
    this.registerAutocompleteMethods();
    this.registerFileMethods();
    this.registerModelAndAutopilotMethods();
    this.registerAuthMethods();

    this.logger.info('RPC methods registered (SDK-only mode)', {
      methods: this.rpcHandler.getRegisteredMethods(),
    });
  }

  /**
   * Chat RPC methods (SDK-based - TASK_2025_051)
   */
  private registerChatMethods(): void {
    // chat:start - Start new SDK session
    this.rpcHandler.registerMethod<ChatStartParams, ChatStartResult>(
      'chat:start',
      async (params) => {
        try {
          const { prompt, sessionId, workspacePath, options } = params;
          this.logger.debug('RPC: chat:start called', {
            sessionId,
            workspacePath,
          });

          // Start SDK session with streaming ExecutionNode output
          const stream = await this.sdkAdapter.startChatSession(sessionId, {
            workspaceId: workspacePath,
            model: options?.model || 'claude-sonnet-4-20250514',
            systemPrompt: options?.systemPrompt,
            projectPath: workspacePath,
          });

          // Send initial prompt if provided
          if (prompt) {
            await this.sdkAdapter.sendMessageToSession(sessionId, prompt);
          }

          // Stream ExecutionNodes to webview (background - don't await)
          this.streamExecutionNodesToWebview(sessionId, stream);

          return { success: true, sessionId };
        } catch (error) {
          this.logger.error(
            'RPC: chat:start failed',
            error instanceof Error ? error : new Error(String(error))
          );
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
    );

    // chat:continue - Send message to existing session (with auto-resume)
    this.rpcHandler.registerMethod<ChatContinueParams, ChatContinueResult>(
      'chat:continue',
      async (params) => {
        try {
          const { prompt, sessionId, workspacePath } = params;
          this.logger.debug('RPC: chat:continue called', { sessionId });

          // Check if session is active in memory
          if (!this.sdkAdapter.isSessionActive(sessionId)) {
            this.logger.info(
              `[RPC] Session ${sessionId} not active, attempting resume...`
            );

            // Resume the session to reconnect to Claude's conversation context
            const stream = await this.sdkAdapter.resumeSession(sessionId, {
              projectPath: workspacePath,
            });

            // Start streaming responses to webview (background - don't await)
            this.streamExecutionNodesToWebview(sessionId, stream);

            this.logger.info(`[RPC] Session ${sessionId} resumed successfully`);
          }

          // Now send the message to the (now active) session
          await this.sdkAdapter.sendMessageToSession(sessionId, prompt);

          return { success: true, sessionId };
        } catch (error) {
          this.logger.error(
            'RPC: chat:continue failed',
            error instanceof Error ? error : new Error(String(error))
          );
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
    );

    // chat:abort - Interrupt session
    this.rpcHandler.registerMethod<ChatAbortParams, ChatAbortResult>(
      'chat:abort',
      async (params) => {
        try {
          const { sessionId } = params;
          this.logger.debug('RPC: chat:abort called', { sessionId });

          await this.sdkAdapter.interruptSession(sessionId);

          return { success: true };
        } catch (error) {
          this.logger.error(
            'RPC: chat:abort failed',
            error instanceof Error ? error : new Error(String(error))
          );
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
    );
  }

  /**
   * Stream ExecutionNodes to webview
   * Handles SDK AsyncIterable<ExecutionNode> → webview messages
   */
  private async streamExecutionNodesToWebview(
    sessionId: SessionId,
    stream: AsyncIterable<ExecutionNode>
  ): Promise<void> {
    try {
      for await (const node of stream) {
        // Send ExecutionNode directly (not JSONLMessage!)
        await this.webviewManager.sendMessage('ptah.main', 'chat:chunk', {
          sessionId,
          message: node,
        });
      }

      // Stream completed successfully
      await this.webviewManager.sendMessage('ptah.main', 'chat:complete', {
        sessionId,
        code: 0,
      });
    } catch (error) {
      this.logger.error(
        `[RPC] Error streaming ExecutionNodes for session ${sessionId}`,
        error instanceof Error ? error : new Error(String(error))
      );
      await this.webviewManager.sendMessage('ptah.main', 'chat:error', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Session RPC methods (SDK-based - TASK_2025_051)
   * Uses SdkSessionStorage instead of SessionDiscoveryService
   */
  private registerSessionMethods(): void {
    // session:list - List all sessions for workspace (with pagination)
    this.rpcHandler.registerMethod<SessionListParams, SessionListResult>(
      'session:list',
      async (params) => {
        try {
          const { workspacePath, limit = 10, offset = 0 } = params;
          this.logger.debug('RPC: session:list called', {
            workspacePath,
            limit,
            offset,
          });

          // Get all sessions from SDK storage
          const allSessions = await this.sdkStorage.getAllSessions(
            workspacePath
          );

          // Filter, sort, and paginate
          const sorted = allSessions
            .filter((s) => s.messages.length > 0)
            .sort((a, b) => b.lastActiveAt - a.lastActiveAt);

          const total = sorted.length;
          const paginated = sorted.slice(offset, offset + limit);
          const hasMore = offset + limit < total;

          // Transform to RPC response format
          const sessions = paginated.map((s) => ({
            id: s.id,
            name: s.name,
            lastActivityAt: s.lastActiveAt,
            createdAt: s.createdAt,
            messageCount: s.messages.length,
            branch: null,
            isUserSession: true,
          }));

          return { sessions, total, hasMore };
        } catch (error) {
          this.logger.error(
            'RPC: session:list failed',
            error instanceof Error ? error : new Error(String(error))
          );
          throw new Error(
            `Failed to list sessions: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    );

    // session:load - Load session messages from SDK storage
    this.rpcHandler.registerMethod<SessionLoadParams, SessionLoadResult>(
      'session:load',
      async (params) => {
        try {
          const { sessionId } = params;

          this.logger.debug('RPC: session:load called', { sessionId });

          // Get session from SDK storage
          const session = await this.sdkStorage.getSession(sessionId);

          if (!session) {
            throw new Error(`Session not found: ${sessionId}`);
          }

          // Transform to RPC response format
          return {
            sessionId: session.id,
            messages: session.messages,
            agentSessions: [],
          };
        } catch (error) {
          this.logger.error(
            'RPC: session:load failed',
            error instanceof Error ? error : new Error(String(error))
          );
          throw new Error(
            `Failed to load session: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    );
  }

  /**
   * Context operations RPC methods
   */
  private registerContextMethods(): void {
    // context:getAllFiles - Get all files in workspace
    this.rpcHandler.registerMethod<ContextGetAllFilesParams, unknown>(
      'context:getAllFiles',
      async (params) => {
        try {
          this.logger.debug('RPC: context:getAllFiles called', {
            includeImages: params?.includeImages,
            limit: params?.limit,
          });
          const result = await this.contextOrchestration.getAllFiles(params);
          return result;
        } catch (error) {
          this.logger.error(
            'RPC: context:getAllFiles failed',
            error instanceof Error ? error : new Error(String(error))
          );
          throw new Error(
            `Failed to get all files: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    );

    // context:getFileSuggestions - Get file suggestions for autocomplete
    this.rpcHandler.registerMethod<ContextGetFileSuggestionsParams, unknown>(
      'context:getFileSuggestions',
      async (params) => {
        try {
          this.logger.debug('RPC: context:getFileSuggestions called', {
            query: params?.query,
            limit: params?.limit,
          });
          const result = await this.contextOrchestration.getFileSuggestions(
            params
          );
          return result;
        } catch (error) {
          this.logger.error(
            'RPC: context:getFileSuggestions failed',
            error instanceof Error ? error : new Error(String(error))
          );
          throw new Error(
            `Failed to get file suggestions: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    );
  }

  /**
   * Autocomplete discovery RPC methods
   */
  private registerAutocompleteMethods(): void {
    // autocomplete:agents - Search for agents
    this.rpcHandler.registerMethod<AutocompleteAgentsParams, unknown>(
      'autocomplete:agents',
      async (params) => {
        try {
          const { query, maxResults } = params;
          this.logger.debug('RPC: autocomplete:agents called', {
            query,
            maxResults,
          });
          const result = await this.agentDiscovery.searchAgents({
            query: query || '',
            maxResults,
          });
          return result;
        } catch (error) {
          this.logger.error(
            'RPC: autocomplete:agents failed',
            error instanceof Error ? error : new Error(String(error))
          );
          throw new Error(
            `Failed to search agents: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    );

    // autocomplete:commands - Search for commands
    this.rpcHandler.registerMethod<AutocompleteCommandsParams, unknown>(
      'autocomplete:commands',
      async (params) => {
        try {
          const { query, maxResults } = params;
          this.logger.debug('RPC: autocomplete:commands called', {
            query,
            maxResults,
          });
          const result = await this.commandDiscovery.searchCommands({
            query: query || '',
            maxResults,
          });
          return result;
        } catch (error) {
          this.logger.error(
            'RPC: autocomplete:commands failed',
            error instanceof Error ? error : new Error(String(error))
          );
          throw new Error(
            `Failed to search commands: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    );
  }

  /**
   * File operations RPC methods
   */
  private registerFileMethods(): void {
    // file:open - Open file in VS Code editor
    this.rpcHandler.registerMethod<FileOpenParams, FileOpenResult>(
      'file:open',
      async (params) => {
        try {
          const { path, line } = params;
          this.logger.debug('RPC: file:open called', { path, line });

          // Check if path is a directory (Claude sometimes reads directories by mistake)
          const fs = await import('fs');
          const stats = await fs.promises.stat(path).catch(() => null);

          if (!stats) {
            return { success: false, error: `Path not found: ${path}` };
          }

          if (stats.isDirectory()) {
            // For directories, reveal in explorer instead of opening as file
            const uri = vscode.Uri.file(path);
            await vscode.commands.executeCommand('revealInExplorer', uri);
            return { success: true, isDirectory: true };
          }

          // Open the document and show it in editor
          const uri = vscode.Uri.file(path);
          const document = await vscode.workspace.openTextDocument(uri);
          const editor = await vscode.window.showTextDocument(document);

          // If line number specified, navigate to it
          if (typeof line === 'number' && line > 0) {
            const position = new vscode.Position(line - 1, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(
              new vscode.Range(position, position),
              vscode.TextEditorRevealType.InCenter
            );
          }

          return { success: true };
        } catch (error) {
          this.logger.error(
            'RPC: file:open failed',
            error instanceof Error ? error : new Error(String(error))
          );
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
    );
  }

  /**
   * Model and Autopilot RPC methods
   * Handles model selection and autopilot configuration persistence
   */
  private registerModelAndAutopilotMethods(): void {
    // config:model-switch - Switch AI model
    this.rpcHandler.registerMethod<
      ConfigModelSwitchParams,
      ConfigModelSwitchResult
    >('config:model-switch', async (params) => {
      try {
        const { model, sessionId } = params;

        // Validate model (already typed, but runtime check for safety)
        const validModels = ['opus', 'sonnet', 'haiku'] as const;
        if (!validModels.includes(model as (typeof validModels)[number])) {
          throw new Error(
            `Invalid model: ${model}. Must be one of: ${validModels.join(', ')}`
          );
        }

        this.logger.debug('RPC: config:model-switch called', {
          model,
          sessionId,
        });

        await this.configManager.set('model.selected', model, {
          target: vscode.ConfigurationTarget.Workspace,
        });

        // Sync to active SDK session if provided
        if (sessionId) {
          try {
            const modelInfo = AVAILABLE_MODELS.find((m) => m.id === model);
            if (modelInfo) {
              await this.sdkAdapter.setSessionModel(
                sessionId,
                modelInfo.apiName
              );
              this.logger.debug('Model synced to active session', {
                sessionId,
                model,
                apiName: modelInfo.apiName,
              });
            }
          } catch (syncError) {
            this.logger.warn(
              'Failed to sync model to active session (config saved)',
              syncError instanceof Error
                ? syncError
                : new Error(String(syncError))
            );
            // Continue - config was saved, just live sync failed
          }
        }

        this.logger.info('Model switched successfully', { model });

        return { model };
      } catch (error) {
        this.logger.error(
          'RPC: config:model-switch failed',
          error instanceof Error ? error : new Error(String(error))
        );
        throw error;
      }
    });

    // config:model-get - Get current model selection
    this.rpcHandler.registerMethod<void, ConfigModelGetResult>(
      'config:model-get',
      async () => {
        try {
          this.logger.debug('RPC: config:model-get called');

          const model = this.configManager.getWithDefault<ClaudeModel>(
            'model.selected',
            'sonnet'
          );

          return { model };
        } catch (error) {
          this.logger.error(
            'RPC: config:model-get failed',
            error instanceof Error ? error : new Error(String(error))
          );
          throw error;
        }
      }
    );

    // config:autopilot-toggle - Toggle autopilot and set permission level
    this.rpcHandler.registerMethod<
      ConfigAutopilotToggleParams,
      ConfigAutopilotToggleResult
    >('config:autopilot-toggle', async (params) => {
      try {
        const { enabled, permissionLevel, sessionId } = params;

        // Validate permission level (already typed, but runtime check for safety)
        const validLevels = ['ask', 'auto-edit', 'yolo'] as const;
        if (
          !validLevels.includes(permissionLevel as (typeof validLevels)[number])
        ) {
          throw new Error(
            `Invalid permission level: ${permissionLevel}. Must be one of: ${validLevels.join(
              ', '
            )}`
          );
        }

        this.logger.debug('RPC: config:autopilot-toggle called', {
          enabled,
          permissionLevel,
          sessionId,
        });

        // Warn if YOLO mode is enabled (dangerous operation)
        if (enabled && permissionLevel === 'yolo') {
          this.logger.warn(
            'YOLO mode enabled - DANGEROUS: All permission prompts will be skipped',
            { enabled, permissionLevel }
          );
        }

        await this.configManager.set('autopilot.enabled', enabled, {
          target: vscode.ConfigurationTarget.Workspace,
        });
        await this.configManager.set(
          'autopilot.permissionLevel',
          permissionLevel,
          {
            target: vscode.ConfigurationTarget.Workspace,
          }
        );

        // Sync to active SDK session if provided and autopilot is enabled
        if (sessionId && enabled) {
          try {
            const sdkMode = this.mapPermissionToSdkMode(permissionLevel);
            await this.sdkAdapter.setSessionPermissionLevel(sessionId, sdkMode);
            this.logger.debug('Permission mode synced to active session', {
              sessionId,
              sdkMode,
            });
          } catch (syncError) {
            this.logger.warn(
              'Failed to sync permission mode to active session (config saved)',
              syncError instanceof Error
                ? syncError
                : new Error(String(syncError))
            );
            // Continue - config was saved, just live sync failed
          }
        }

        this.logger.info('Autopilot state updated', {
          enabled,
          permissionLevel,
        });

        return { enabled, permissionLevel };
      } catch (error) {
        this.logger.error(
          'RPC: config:autopilot-toggle failed',
          error instanceof Error ? error : new Error(String(error))
        );
        throw error;
      }
    });

    // config:autopilot-get - Get current autopilot state
    this.rpcHandler.registerMethod<void, ConfigAutopilotGetResult>(
      'config:autopilot-get',
      async () => {
        try {
          this.logger.debug('RPC: config:autopilot-get called');

          const enabled = this.configManager.getWithDefault<boolean>(
            'autopilot.enabled',
            false
          );
          const permissionLevel =
            this.configManager.getWithDefault<PermissionLevel>(
              'autopilot.permissionLevel',
              'ask'
            );

          return { enabled, permissionLevel };
        } catch (error) {
          this.logger.error(
            'RPC: config:autopilot-get failed',
            error instanceof Error ? error : new Error(String(error))
          );
          throw error;
        }
      }
    );

    // config:models-list - Get available models with metadata
    this.rpcHandler.registerMethod<void, ConfigModelsListResult>(
      'config:models-list',
      async () => {
        try {
          this.logger.debug('RPC: config:models-list called');

          const selectedModel = this.configManager.getWithDefault<ClaudeModel>(
            'model.selected',
            'sonnet'
          );

          const models: (ModelInfo & { isSelected: boolean })[] =
            AVAILABLE_MODELS.map((model) => ({
              ...model,
              isSelected: model.id === selectedModel,
            }));

          return { models };
        } catch (error) {
          this.logger.error(
            'RPC: config:models-list failed',
            error instanceof Error ? error : new Error(String(error))
          );
          throw error;
        }
      }
    );
  }

  /**
   * Authentication RPC methods (TASK_2025_057)
   */
  private registerAuthMethods(): void {
    // auth:getHealth - Get SDK authentication health status
    this.rpcHandler.registerMethod<void, { success: boolean; health: unknown }>(
      'auth:getHealth',
      async () => {
        try {
          this.logger.debug('RPC: auth:getHealth called');
          const health = this.sdkAdapter.getHealth();
          return { success: true, health };
        } catch (error) {
          this.logger.error(
            'RPC: auth:getHealth failed',
            error instanceof Error ? error : new Error(String(error))
          );
          throw error;
        }
      }
    );

    // auth:saveSettings - Save authentication settings to VS Code config
    const AuthSettingsSchema = z.object({
      authMethod: z.enum(['oauth', 'apiKey', 'auto']),
      claudeOAuthToken: z.string().optional(),
      anthropicApiKey: z.string().optional(),
    });

    this.rpcHandler.registerMethod<
      unknown,
      { success: boolean; error?: string }
    >('auth:saveSettings', async (params: unknown) => {
      try {
        // SECURITY: Sanitize params before logging (mask credentials)
        const sanitizedParams =
          typeof params === 'object' && params !== null
            ? {
                ...params,
                claudeOAuthToken:
                  'claudeOAuthToken' in params &&
                  typeof params.claudeOAuthToken === 'string' &&
                  params.claudeOAuthToken
                    ? `***${params.claudeOAuthToken.slice(-4)}`
                    : undefined,
                anthropicApiKey:
                  'anthropicApiKey' in params &&
                  typeof params.anthropicApiKey === 'string' &&
                  params.anthropicApiKey
                    ? `***${params.anthropicApiKey.slice(-4)}`
                    : undefined,
              }
            : params;
        this.logger.debug('RPC: auth:saveSettings called', {
          params: sanitizedParams,
        });

        // Validate parameters with Zod
        const validated = AuthSettingsSchema.parse(params);

        // Save settings to VS Code configuration
        await this.configManager.set('authMethod', validated.authMethod);
        if (validated.claudeOAuthToken !== undefined) {
          await this.configManager.set(
            'claudeOAuthToken',
            validated.claudeOAuthToken
          );
        }
        if (validated.anthropicApiKey !== undefined) {
          await this.configManager.set(
            'anthropicApiKey',
            validated.anthropicApiKey
          );
        }

        this.logger.info('RPC: auth:saveSettings completed successfully');
        return { success: true };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Validation failed';
        this.logger.error('RPC: auth:saveSettings failed', {
          error: errorMessage,
        });
        return {
          success: false,
          error: errorMessage,
        };
      }
    });

    // auth:testConnection - Test connection after settings save
    this.rpcHandler.registerMethod<
      void,
      { success: boolean; health: unknown; errorMessage?: string }
    >('auth:testConnection', async () => {
      try {
        this.logger.debug('RPC: auth:testConnection called');

        // Brief delay to allow ConfigManager watcher to trigger re-init
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const health = this.sdkAdapter.getHealth();

        const success = health.status === 'available';
        const result = {
          success,
          health,
          errorMessage: health.errorMessage,
        };

        this.logger.info('RPC: auth:testConnection completed', { result });
        return result;
      } catch (error) {
        this.logger.error(
          'RPC: auth:testConnection failed',
          error instanceof Error ? error : new Error(String(error))
        );
        throw error;
      }
    });
  }

  /**
   * Map frontend permission level to SDK permission mode
   */
  private mapPermissionToSdkMode(
    level: PermissionLevel
  ): 'default' | 'acceptEdits' | 'bypassPermissions' {
    const modeMap: Record<
      PermissionLevel,
      'default' | 'acceptEdits' | 'bypassPermissions'
    > = {
      ask: 'default',
      'auto-edit': 'acceptEdits',
      yolo: 'bypassPermissions',
    };
    return modeMap[level];
  }
}
