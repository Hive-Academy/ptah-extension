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
import { TOKENS } from '../di/tokens';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';

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
    private readonly createClaudeProcess: ClaudeProcessFactory
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
   */
  private registerSessionMethods(): void {
    // session:list - List all sessions for workspace
    this.rpcHandler.registerMethod('session:list', async (params: any) => {
      try {
        const { workspacePath } = params;
        this.logger.debug('RPC: session:list called', { workspacePath });

        // Find the sessions directory for this workspace
        const sessionsDir = await this.findSessionsDirectory(workspacePath);

        if (!sessionsDir) {
          this.logger.debug('No sessions directory found for workspace', {
            workspacePath,
          });
          return [];
        }

        // Read directory
        try {
          const files = await fs.readdir(sessionsDir);
          const sessionFiles = files.filter((f) => f.endsWith('.jsonl'));

          // Return session summaries
          const sessions = await Promise.all(
            sessionFiles.map(async (file) => {
              const sessionId = path.basename(file, '.jsonl');
              const filePath = path.join(sessionsDir, file);
              const stats = await fs.stat(filePath);

              return {
                id: sessionId,
                name: `Session ${sessionId.substring(0, 8)}`,
                lastActivityAt: stats.mtime.getTime(),
                createdAt: stats.birthtime.getTime(),
                messageCount: 0, // Will be populated by frontend
              };
            })
          );

          return sessions.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
        } catch (error) {
          // Directory doesn't exist or no sessions yet
          this.logger.debug('No sessions directory found', { sessionsDir });
          return [];
        }
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

    // session:load - Load session messages from .jsonl file
    this.rpcHandler.registerMethod('session:load', async (params: any) => {
      try {
        const { sessionId, workspacePath } = params;
        this.logger.debug('RPC: session:load called', {
          sessionId,
          workspacePath,
        });

        // Find the sessions directory for this workspace
        const sessionsDir = await this.findSessionsDirectory(workspacePath);

        if (!sessionsDir) {
          throw new Error('Sessions directory not found for workspace');
        }

        const sessionFile = path.join(sessionsDir, `${sessionId}.jsonl`);

        // Read and parse JSONL file
        const content = await fs.readFile(sessionFile, 'utf-8');
        const lines = content.split('\n').filter((line) => line.trim());
        const messages = lines.map((line) => JSON.parse(line) as JSONLMessage);

        return {
          sessionId,
          messages,
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
    });
  }

  /**
   * Find the Claude CLI sessions directory for a workspace
   *
   * Claude CLI stores sessions in ~/.claude/projects/<escaped-path>/
   * The path escaping algorithm has varied between versions and may have
   * inconsistent casing. This method uses a robust matching strategy:
   *
   * 1. Generate candidate escaped paths (lowercase, original case, uppercase)
   * 2. List all directories in ~/.claude/projects/
   * 3. Find a case-insensitive match
   *
   * This approach handles:
   * - Different OS path formats (Windows backslash, Unix forward slash)
   * - Claude CLI version differences in path escaping
   * - Case sensitivity variations across operating systems
   *
   * @param workspacePath - The workspace path from VS Code (e.g., "D:\projects\ptah")
   * @returns The full path to the sessions directory, or null if not found
   */
  private async findSessionsDirectory(
    workspacePath: string
  ): Promise<string | null> {
    const homeDir = os.homedir();
    const projectsDir = path.join(homeDir, '.claude', 'projects');

    // Check if projects directory exists
    try {
      await fs.access(projectsDir);
    } catch {
      this.logger.debug('Claude projects directory does not exist', {
        projectsDir,
      });
      return null;
    }

    // Generate the escaped path pattern (replace : and /\ with -)
    const escapedPath = workspacePath.replace(/[:\\/]/g, '-');

    // List all project directories
    const dirs = await fs.readdir(projectsDir);

    // Try exact match first (case-sensitive)
    if (dirs.includes(escapedPath)) {
      return path.join(projectsDir, escapedPath);
    }

    // Try lowercase match
    const lowerEscaped = escapedPath.toLowerCase();
    const lowerMatch = dirs.find((d) => d.toLowerCase() === lowerEscaped);
    if (lowerMatch) {
      return path.join(projectsDir, lowerMatch);
    }

    // Try without leading hyphen (some paths may start differently)
    const withoutLeading = escapedPath.replace(/^-+/, '');
    const withoutLeadingLower = withoutLeading.toLowerCase();
    const partialMatch = dirs.find(
      (d) =>
        d.toLowerCase() === withoutLeadingLower ||
        d.toLowerCase().endsWith(withoutLeadingLower)
    );
    if (partialMatch) {
      return path.join(projectsDir, partialMatch);
    }

    this.logger.debug('No matching sessions directory found', {
      workspacePath,
      escapedPath,
      availableDirs: dirs.slice(0, 10), // Log first 10 for debugging
    });

    return null;
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
}
