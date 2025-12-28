/**
 * RPC Method Registration Service
 *
 * TASK_2025_023 Batch 4: Rebuilt with simple ClaudeProcess pattern
 *
 * Working methods:
 * - context:getAllFiles, context:getFileSuggestions
 * - autocomplete:agents, autocomplete:mcps, autocomplete:commands
 * - chat:start, chat:continue, chat:abort (NEW - Batch 4)
 * - session:list, session:load (NEW - Batch 4)
 */

import { injectable, inject } from 'tsyringe';
import type { Logger } from '../logging/logger';
import type { RpcHandler } from './rpc-handler';
import type { SessionDiscoveryService } from '../services/session-discovery.service';
import type {
  AgentSessionWatcherService,
  AgentSummaryChunk,
} from '../services/agent-session-watcher.service';
import { TOKENS } from '../di/tokens';
import type { ConfigManager } from '../config/config-manager';
import {
  ClaudeModel,
  PermissionLevel,
  AVAILABLE_MODELS,
  ModelInfo,
} from '@ptah-extension/shared';
import * as vscode from 'vscode';

// Import domain service types
interface ContextOrchestrationService {
  getAllFiles(params: any): Promise<any>;
  getFileSuggestions(params: any): Promise<any>;
}

interface AgentDiscoveryService {
  searchAgents(request: { query: string; maxResults?: number }): Promise<any>;
}

interface MCPDiscoveryService {
  searchMCPServers(request: {
    query: string;
    maxResults?: number;
    includeOffline?: boolean;
  }): Promise<any>;
}

interface CommandDiscoveryService {
  searchCommands(request: { query: string; maxResults?: number }): Promise<any>;
}

interface ClaudeCliDetector {
  findExecutable(): Promise<{ path: string } | null>;
}

interface WebviewManager {
  sendMessage(viewType: string, type: string, payload: any): Promise<void>;
}

// Import types only (avoid circular dependency)
import { JSONLMessage } from '@ptah-extension/shared';

// ClaudeProcess interface (avoid importing class from claude-domain)
interface ClaudeProcessInterface {
  on(event: 'message', listener: (msg: JSONLMessage) => void): void;
  on(event: 'session-id', listener: (sessionId: string) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  on(event: 'close', listener: (code: number | null) => void): void;
  start(prompt: string, options?: any): Promise<void>;
  resume(sessionId: string, prompt: string, options?: any): Promise<void>;
  kill(): void;
  isRunning(): boolean;
}

// Factory function type
type ClaudeProcessFactory = (
  cliPath: string,
  workspacePath: string
) => ClaudeProcessInterface;

/**
 * Service responsible for registering all RPC methods
 *
 * TASK_2025_023 Batch 4: Rebuilt with ClaudeProcess pattern
 */
@injectable()
export class RpcMethodRegistrationService {
  // Active Claude processes (sessionId -> ClaudeProcessInterface)
  private readonly activeProcesses = new Map<string, ClaudeProcessInterface>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.CONTEXT_ORCHESTRATION_SERVICE)
    private readonly contextOrchestration: ContextOrchestrationService,
    @inject(TOKENS.AGENT_DISCOVERY_SERVICE)
    private readonly agentDiscovery: AgentDiscoveryService,
    @inject(TOKENS.COMMAND_DISCOVERY_SERVICE)
    private readonly commandDiscovery: CommandDiscoveryService,
    @inject(TOKENS.CLAUDE_CLI_DETECTOR)
    private readonly cliDetector: ClaudeCliDetector,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager,
    @inject('ClaudeProcessFactory')
    private readonly createClaudeProcess: ClaudeProcessFactory,
    @inject(TOKENS.SESSION_DISCOVERY_SERVICE)
    private readonly sessionDiscovery: SessionDiscoveryService,
    @inject(TOKENS.AGENT_SESSION_WATCHER_SERVICE)
    private readonly agentWatcher: AgentSessionWatcherService,
    @inject(TOKENS.CONFIG_MANAGER)
    private readonly configManager: ConfigManager
  ) {
    // Setup agent watcher summary chunk listener
    this.setupAgentWatcherListeners();
  }

  /**
   * Setup listeners for agent session watcher events
   */
  private setupAgentWatcherListeners(): void {
    (this.agentWatcher as any).on(
      'summary-chunk',
      (chunk: AgentSummaryChunk) => {
        this.webviewManager
          .sendMessage('ptah.main', 'agent:summary-chunk', chunk)
          .catch((error) => {
            this.logger.error(
              'Failed to send agent summary chunk to webview',
              error
            );
          });
      }
    );
  }

  /**
   * Register all RPC methods
   */
  registerAll(): void {
    // TASK_2025_023 Batch 4: Rebuilt with ClaudeProcess
    this.registerChatMethods();
    this.registerSessionMethods();
    this.registerContextMethods();
    this.registerAutocompleteMethods();
    this.registerFileMethods();
    // TASK_2025_035 Batch 3: Model and autopilot RPC handlers
    this.registerModelAndAutopilotMethods();

    this.logger.info(
      'RPC methods registered (TASK_2025_023 Batch 4 complete)',
      {
        methods: this.rpcHandler.getRegisteredMethods(),
      }
    );
  }

  /**
   * Chat RPC methods (NEW - Batch 4)
   */
  private registerChatMethods(): void {
    // chat:start - Start new conversation
    this.rpcHandler.registerMethod('chat:start', async (params: any) => {
      try {
        const { prompt, sessionId, workspacePath, options } = params;
        this.logger.debug('RPC: chat:start called', {
          sessionId,
          workspacePath,
        });

        // Get Claude CLI path
        const installation = await this.cliDetector.findExecutable();
        if (!installation) {
          throw new Error('Claude CLI not found');
        }

        // Create and start process
        const process = this.createClaudeProcess(
          installation.path,
          workspacePath
        );

        // TASK_2025_035: Read model and autopilot configuration
        const selectedModel = this.configManager.getWithDefault<ClaudeModel>(
          'model.selected',
          'sonnet'
        );

        // QA FIX: Validate model is selectable (not 'default') before passing to CLI
        const validModels: ClaudeModel[] = ['opus', 'sonnet', 'haiku'];
        const safeModel: ClaudeModel = validModels.includes(selectedModel)
          ? selectedModel
          : 'sonnet';

        const autopilotEnabled = this.configManager.getWithDefault<boolean>(
          'autopilot.enabled',
          false
        );
        const permissionLevelRaw =
          this.configManager.getWithDefault<PermissionLevel>(
            'autopilot.permissionLevel',
            'ask'
          );

        // QA FIX ISSUE 4: Validate permission level before passing to CLI
        const validLevels: PermissionLevel[] = ['ask', 'auto-edit', 'yolo'];
        const safePermissionLevel: PermissionLevel = validLevels.includes(
          permissionLevelRaw
        )
          ? permissionLevelRaw
          : 'ask';

        // Build enhanced options with config values
        const processOptions = {
          model: safeModel, // Use validated model
          autopilotEnabled,
          permissionLevel: safePermissionLevel, // Use validated permission level
          // Merge with any existing options from params
          ...(options || {}),
        };

        // Track the effective session ID - starts as placeholder, updated when real ID resolved
        let effectiveSessionId = sessionId;

        // Extract session UUID from JSONL stream (emitted BEFORE message event)
        process.on('session-id', (realSessionId: string) => {
          this.logger.debug('Session UUID extracted from JSONL', {
            sessionId,
            realSessionId,
          });
          // Update effective session ID to use real Claude UUID for subsequent messages
          effectiveSessionId = realSessionId;
          this.webviewManager
            .sendMessage('ptah.main', 'session:id-resolved', {
              sessionId,
              realSessionId,
            })
            .catch((error) => {
              this.logger.error('Failed to send session ID to webview', error);
            });
        });

        // Setup message streaming to webview
        process.on('message', (msg: JSONLMessage) => {
          // Detect Task tool_use (agent spawn) and start watching for agent file
          this.detectAndWatchAgents(msg, effectiveSessionId, workspacePath);

          this.webviewManager
            .sendMessage('ptah.main', 'chat:chunk', {
              sessionId: effectiveSessionId,
              message: msg,
            })
            .catch((error) => {
              this.logger.error('Failed to send chat chunk to webview', error);
            });
        });

        // Handle errors
        process.on('error', (error: Error) => {
          this.logger.error('ClaudeProcess error', error);
          this.webviewManager
            .sendMessage('ptah.main', 'chat:error', {
              sessionId: effectiveSessionId,
              error: error.message,
            })
            .catch((err) => {
              this.logger.error('Failed to send message to webview', err);
            });
        });

        // Handle close
        process.on('close', (code: number | null) => {
          this.logger.debug('ClaudeProcess closed', {
            sessionId: effectiveSessionId,
            code,
          });
          this.activeProcesses.delete(sessionId);
          this.webviewManager
            .sendMessage('ptah.main', 'chat:complete', {
              sessionId: effectiveSessionId,
              code,
            })
            .catch((err) => {
              this.logger.error('Failed to send message to webview', err);
            });
        });

        // Store process reference (keep using placeholder for internal tracking)
        this.activeProcesses.set(sessionId, process);

        // Start the process with enhanced options
        await process.start(prompt, processOptions);

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
    });

    // chat:continue - Continue existing session
    this.rpcHandler.registerMethod('chat:continue', async (params: any) => {
      try {
        const { prompt, sessionId, workspacePath } = params;
        this.logger.debug('RPC: chat:continue called', { sessionId });

        // Validate session ID format (Claude CLI expects UUID)
        const uuidPattern =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidPattern.test(sessionId)) {
          throw new Error(
            `Invalid session ID format: ${sessionId}. Expected UUID format (e.g., 550e8400-e29b-41d4-a716-446655440000). Use session:id-resolved to get the real session ID from Claude CLI.`
          );
        }

        // Get Claude CLI path
        const installation = await this.cliDetector.findExecutable();
        if (!installation) {
          throw new Error('Claude CLI not found');
        }

        // Create and start process
        const process = this.createClaudeProcess(
          installation.path,
          workspacePath
        );

        // TASK_2025_035: Read model and autopilot configuration
        const selectedModel = this.configManager.getWithDefault<ClaudeModel>(
          'model.selected',
          'sonnet'
        );

        // QA FIX: Validate model is selectable (not 'default') before passing to CLI
        const validModels: ClaudeModel[] = ['opus', 'sonnet', 'haiku'];
        const safeModel: ClaudeModel = validModels.includes(selectedModel)
          ? selectedModel
          : 'sonnet';

        const autopilotEnabled = this.configManager.getWithDefault<boolean>(
          'autopilot.enabled',
          false
        );
        const permissionLevelRaw =
          this.configManager.getWithDefault<PermissionLevel>(
            'autopilot.permissionLevel',
            'ask'
          );

        // QA FIX ISSUE 4: Validate permission level before passing to CLI
        const validLevels: PermissionLevel[] = ['ask', 'auto-edit', 'yolo'];
        const safePermissionLevel: PermissionLevel = validLevels.includes(
          permissionLevelRaw
        )
          ? permissionLevelRaw
          : 'ask';

        // Build enhanced options with config values (omit resumeSessionId since it's a separate parameter)
        const processOptions = {
          model: safeModel, // Use validated model
          autopilotEnabled,
          permissionLevel: safePermissionLevel, // Use validated permission level
        };

        // Setup message streaming
        process.on('message', (msg: JSONLMessage) => {
          // Detect Task tool_use (agent spawn) and start watching for agent file
          this.detectAndWatchAgents(msg, sessionId, workspacePath);

          this.webviewManager
            .sendMessage('ptah.main', 'chat:chunk', {
              sessionId,
              message: msg,
            })
            .catch((error) => {
              this.logger.error('Failed to send chat chunk to webview', error);
            });
        });

        process.on('error', (error: Error) => {
          this.logger.error('ClaudeProcess error', error);
          this.webviewManager
            .sendMessage('ptah.main', 'chat:error', {
              sessionId,
              error: error.message,
            })
            .catch((err) => {
              this.logger.error('Failed to send message to webview', err);
            });
        });

        process.on('close', (code: number | null) => {
          this.logger.debug('ClaudeProcess closed', { sessionId, code });
          this.activeProcesses.delete(sessionId);
          this.webviewManager
            .sendMessage('ptah.main', 'chat:complete', {
              sessionId,
              code,
            })
            .catch((err) => {
              this.logger.error('Failed to send message to webview', err);
            });
        });

        // Store process reference
        this.activeProcesses.set(sessionId, process);

        // Resume the session with enhanced options
        await process.resume(sessionId, prompt, processOptions);

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
    });

    // chat:abort - Kill active process
    this.rpcHandler.registerMethod('chat:abort', async (params: any) => {
      try {
        const { sessionId } = params;
        this.logger.debug('RPC: chat:abort called', { sessionId });

        const process = this.activeProcesses.get(sessionId);
        if (process) {
          process.kill();
          this.activeProcesses.delete(sessionId);
          return { success: true };
        }

        return { success: false, error: 'No active process for session' };
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
    });
  }

  /**
   * Session RPC methods (NEW - Batch 4)
   * Delegated to SessionDiscoveryService for better separation of concerns
   */
  private registerSessionMethods(): void {
    // session:list - List all sessions for workspace (with pagination)
    this.rpcHandler.registerMethod('session:list', async (params: any) => {
      try {
        const { workspacePath, limit = 10, offset = 0 } = params;
        this.logger.debug('RPC: session:list called', {
          workspacePath,
          limit,
          offset,
        });

        return await this.sessionDiscovery.listSessions(
          workspacePath,
          limit,
          offset
        );
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
    });

    // session:load - Load session messages from .jsonl file with linked agent sessions
    this.rpcHandler.registerMethod('session:load', async (params: any) => {
      try {
        const { sessionId, workspacePath } = params;

        // Security: Validate sessionId format to prevent path traversal attacks
        // Only allow alphanumeric characters, hyphens, and underscores
        if (!sessionId || !/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
          this.logger.warn('RPC: session:load - Invalid sessionId format', {
            sessionId,
          });
          throw new Error(
            'Invalid session ID format. Only alphanumeric characters, hyphens, and underscores are allowed.'
          );
        }

        this.logger.debug('RPC: session:load called', {
          sessionId,
          workspacePath,
        });

        return await this.sessionDiscovery.loadSession(
          sessionId,
          workspacePath
        );
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
    });
  }

  /**
   * Context operations RPC methods (WORKING)
   */
  private registerContextMethods(): void {
    // context:getAllFiles - Get all files in workspace
    this.rpcHandler.registerMethod(
      'context:getAllFiles',
      async (params: any) => {
        try {
          this.logger.debug('RPC: context:getAllFiles called', {
            includeImages: params?.includeImages,
            limit: params?.limit,
          });
          const result = await (this.contextOrchestration as any).getAllFiles(
            params
          );
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
    this.rpcHandler.registerMethod(
      'context:getFileSuggestions',
      async (params: any) => {
        try {
          this.logger.debug('RPC: context:getFileSuggestions called', {
            query: params?.query,
            limit: params?.limit,
          });
          const result = await (
            this.contextOrchestration as any
          ).getFileSuggestions(params);
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
   * Autocomplete discovery RPC methods (WORKING)
   */
  private registerAutocompleteMethods(): void {
    // autocomplete:agents - Search for agents
    this.rpcHandler.registerMethod(
      'autocomplete:agents',
      async (params: any) => {
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
    this.rpcHandler.registerMethod(
      'autocomplete:commands',
      async (params: any) => {
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
    this.rpcHandler.registerMethod('file:open', async (params: any) => {
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
          const vscode = await import('vscode');
          const uri = vscode.Uri.file(path);
          await vscode.commands.executeCommand('revealInExplorer', uri);
          return { success: true, isDirectory: true };
        }

        // Dynamic import of vscode to avoid bundling issues
        const vscode = await import('vscode');
        const uri = vscode.Uri.file(path);

        // Open the document and show it in editor
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
    });
  }

  /**
   * Detect Task tool_use (agent spawn) and tool_result (agent complete) in JSONL messages.
   * Starts/stops watching for agent session files accordingly.
   *
   * @param msg - JSONL message from Claude CLI stream
   * @param sessionId - Current session ID
   * @param workspacePath - Workspace path for locating agent files
   */
  private detectAndWatchAgents(
    msg: JSONLMessage,
    sessionId: string,
    workspacePath: string
  ): void {
    // Detect Task tool_use (agent spawn)
    if (msg.type === 'assistant' && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === 'tool_use' && block.name === 'Task' && block.id) {
          this.logger.debug('Detected Task tool_use, starting agent watch', {
            toolUseId: block.id,
            sessionId,
          });
          this.agentWatcher.startWatching(block.id, sessionId, workspacePath);
        }
      }
    }

    // Detect tool_result for Task tools (agent complete)
    if (msg.type === 'user' && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          // Check if this is a result for a watched agent
          // The watcher will ignore if not tracked
          this.agentWatcher.stopWatching(block.tool_use_id);
        }
      }
    }
  }

  /**
   * Model and Autopilot RPC methods (TASK_2025_035 Batch 3)
   * Handles model selection and autopilot configuration persistence
   */
  private registerModelAndAutopilotMethods(): void {
    // config:model-switch - Switch AI model
    this.rpcHandler.registerMethod(
      'config:model-switch',
      async (params: any) => {
        try {
          const { model } = params;

          // QA FIX ISSUE 1: Validate BEFORE type assertion
          const validModels = ['opus', 'sonnet', 'haiku'] as const;
          if (
            typeof model !== 'string' ||
            !validModels.includes(model as any)
          ) {
            throw new Error(
              `Invalid model: ${model}. Must be one of: ${validModels.join(
                ', '
              )}`
            );
          }
          // Now safe to use model as ClaudeModel
          const validatedModel = model as ClaudeModel;

          this.logger.debug('RPC: config:model-switch called', {
            model: validatedModel,
          });

          // QA FIX ISSUE 3: Note on ConfigurationTarget.Workspace coupling
          // Note: Using Workspace scope to persist per-workspace settings
          // ConfigManager is VS Code-specific, so this coupling is acceptable
          await this.configManager.set('model.selected', validatedModel, {
            target: vscode.ConfigurationTarget.Workspace,
          });

          this.logger.info('Model switched successfully', {
            model: validatedModel,
          });

          // Return just the data - RpcHandler wraps with { success, data, correlationId }
          return { model: validatedModel };
        } catch (error) {
          this.logger.error(
            'RPC: config:model-switch failed',
            error instanceof Error ? error : new Error(String(error))
          );
          // Re-throw to let RpcHandler handle error response
          throw error;
        }
      }
    );

    // config:model-get - Get current model selection
    this.rpcHandler.registerMethod('config:model-get', async () => {
      try {
        this.logger.debug('RPC: config:model-get called');

        // Read from workspace configuration with default
        const model = this.configManager.getWithDefault<ClaudeModel>(
          'model.selected',
          'sonnet'
        );

        // Return just the data - RpcHandler wraps with { success, data, correlationId }
        return { model };
      } catch (error) {
        this.logger.error(
          'RPC: config:model-get failed',
          error instanceof Error ? error : new Error(String(error))
        );
        // Re-throw to let RpcHandler handle error response
        throw error;
      }
    });

    // config:autopilot-toggle - Toggle autopilot and set permission level
    this.rpcHandler.registerMethod(
      'config:autopilot-toggle',
      async (params: any) => {
        try {
          const { enabled, permissionLevel } = params;

          // QA FIX ISSUE 1: Validate BEFORE type assertion
          const validLevels = ['ask', 'auto-edit', 'yolo'] as const;
          if (typeof enabled !== 'boolean') {
            throw new Error(
              `Invalid enabled value: ${enabled}. Must be a boolean.`
            );
          }
          if (
            typeof permissionLevel !== 'string' ||
            !validLevels.includes(permissionLevel as any)
          ) {
            throw new Error(
              `Invalid permission level: ${permissionLevel}. Must be one of: ${validLevels.join(
                ', '
              )}`
            );
          }
          // Now safe to use permissionLevel as PermissionLevel
          const validatedPermissionLevel = permissionLevel as PermissionLevel;

          this.logger.debug('RPC: config:autopilot-toggle called', {
            enabled,
            permissionLevel: validatedPermissionLevel,
          });

          // Warn if YOLO mode is enabled (dangerous operation)
          if (enabled && validatedPermissionLevel === 'yolo') {
            this.logger.warn(
              'YOLO mode enabled - DANGEROUS: All permission prompts will be skipped',
              { enabled, permissionLevel: validatedPermissionLevel }
            );
          }

          // QA FIX ISSUE 3: Note on ConfigurationTarget.Workspace coupling
          // Note: Using Workspace scope to persist per-workspace settings
          // ConfigManager is VS Code-specific, so this coupling is acceptable
          await this.configManager.set('autopilot.enabled', enabled, {
            target: vscode.ConfigurationTarget.Workspace,
          });
          await this.configManager.set(
            'autopilot.permissionLevel',
            validatedPermissionLevel,
            {
              target: vscode.ConfigurationTarget.Workspace,
            }
          );

          this.logger.info('Autopilot state updated', {
            enabled,
            permissionLevel: validatedPermissionLevel,
          });

          // Return just the data - RpcHandler wraps with { success, data, correlationId }
          return { enabled, permissionLevel: validatedPermissionLevel };
        } catch (error) {
          this.logger.error(
            'RPC: config:autopilot-toggle failed',
            error instanceof Error ? error : new Error(String(error))
          );
          // Re-throw to let RpcHandler handle error response
          throw error;
        }
      }
    );

    // config:autopilot-get - Get current autopilot state
    this.rpcHandler.registerMethod('config:autopilot-get', async () => {
      try {
        this.logger.debug('RPC: config:autopilot-get called');

        // Read from workspace configuration with defaults
        const enabled = this.configManager.getWithDefault<boolean>(
          'autopilot.enabled',
          false
        );
        const permissionLevel =
          this.configManager.getWithDefault<PermissionLevel>(
            'autopilot.permissionLevel',
            'ask'
          );

        // Return just the data - RpcHandler wraps with { success, data, correlationId }
        return { enabled, permissionLevel };
      } catch (error) {
        this.logger.error(
          'RPC: config:autopilot-get failed',
          error instanceof Error ? error : new Error(String(error))
        );
        // Re-throw to let RpcHandler handle error response
        throw error;
      }
    });

    // config:models-list - Get available models with metadata
    this.rpcHandler.registerMethod('config:models-list', async () => {
      try {
        this.logger.debug('RPC: config:models-list called');

        // Get current selected model to mark it in the response
        const selectedModel = this.configManager.getWithDefault<ClaudeModel>(
          'model.selected',
          'sonnet'
        );

        // Return models from shared constant with selection state
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
    });
  }
}
