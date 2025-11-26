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
import { TOKENS } from '../di/tokens';

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
  on(event: 'error', listener: (error: Error) => void): void;
  on(event: 'close', listener: (code: number | null) => void): void;
  start(prompt: string, options?: any): Promise<void>;
  resume(sessionId: string, prompt: string): Promise<void>;
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
    @inject(TOKENS.MCP_DISCOVERY_SERVICE)
    private readonly mcpDiscovery: MCPDiscoveryService,
    @inject(TOKENS.COMMAND_DISCOVERY_SERVICE)
    private readonly commandDiscovery: CommandDiscoveryService,
    @inject(TOKENS.CLAUDE_CLI_DETECTOR)
    private readonly cliDetector: ClaudeCliDetector,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager,
    @inject('ClaudeProcessFactory')
    private readonly createClaudeProcess: ClaudeProcessFactory,
    @inject(TOKENS.SESSION_DISCOVERY_SERVICE)
    private readonly sessionDiscovery: SessionDiscoveryService
  ) {}

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

        // Setup message streaming to webview
        process.on('message', (msg: JSONLMessage) => {
          this.webviewManager
            .sendMessage('ptah.main', 'chat:chunk', {
              sessionId,
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
              sessionId,
              error: error.message,
            })
            .catch((err) => {
              this.logger.error('Failed to send message to webview', err);
            });
        });

        // Handle close
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

        // Start the process
        await process.start(prompt, options);

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

        // Setup message streaming
        process.on('message', (msg: JSONLMessage) => {
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

        // Resume the session
        await process.resume(sessionId, prompt);

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
    // session:list - List all sessions for workspace
    this.rpcHandler.registerMethod('session:list', async (params: any) => {
      try {
        const { workspacePath } = params;
        this.logger.debug('RPC: session:list called', { workspacePath });

        return await this.sessionDiscovery.listSessions(workspacePath);
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
        this.logger.debug('RPC: session:load called', {
          sessionId,
          workspacePath,
        });

        return await this.sessionDiscovery.loadSession(sessionId, workspacePath);
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

    // autocomplete:mcps - Search for MCP servers
    this.rpcHandler.registerMethod('autocomplete:mcps', async (params: any) => {
      try {
        const { query, maxResults, includeOffline } = params;
        this.logger.debug('RPC: autocomplete:mcps called', {
          query,
          maxResults,
          includeOffline,
        });
        const result = await this.mcpDiscovery.searchMCPServers({
          query: query || '',
          maxResults,
          includeOffline,
        });
        return result;
      } catch (error) {
        this.logger.error(
          'RPC: autocomplete:mcps failed',
          error instanceof Error ? error : new Error(String(error))
        );
        throw new Error(
          `Failed to search MCP servers: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    });

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
}
