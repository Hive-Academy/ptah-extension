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
import {
  Logger,
  RpcHandler,
  AgentSessionWatcherService,
  AgentSummaryChunk,
  TOKENS,
  ConfigManager,
} from '@ptah-extension/vscode-core';
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

    // chat:continue - Send message to existing session
    this.rpcHandler.registerMethod<ChatContinueParams, ChatContinueResult>(
      'chat:continue',
      async (params) => {
        try {
          const { prompt, sessionId } = params;
          this.logger.debug('RPC: chat:continue called', { sessionId });

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
            await this.sdkAdapter.setSessionPermissionMode(sessionId, sdkMode);
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
