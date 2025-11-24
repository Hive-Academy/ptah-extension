/**
 * RPC Method Registration Service
 *
 * Centralizes all RPC method registrations for clean separation of concerns.
 * This service is responsible for registering all backend RPC endpoints that
 * the frontend can call via the RpcHandler.
 *
 * Architecture:
 * - Session operations: session:list, session:get, session:create, session:switch
 * - Chat operations: chat:start (streaming handled separately via postMessage)
 * - File operations: file:read
 * - Context operations: context:getAllFiles, context:getFileSuggestions
 *
 * @module RpcMethodRegistrationService
 */

import { injectable, inject } from 'tsyringe';
import type { Logger } from '../logging/logger';
import type { RpcHandler } from './rpc-handler';
import { TOKENS } from '../di/tokens';
import type { SessionId } from '@ptah-extension/shared';

// Import domain service types (avoid importing implementations to prevent circular deps)
interface ClaudeCliService {
  sendMessage(
    sessionId: SessionId,
    content: string,
    files?: string[]
  ): Promise<any>;
}

interface SessionManager {
  getSessionsUIData(): Promise<any>;
  getSession(id: SessionId): any;
  createSession(options: { name?: string }): Promise<any>;
  switchSession(id: SessionId): Promise<boolean>;
}

interface ContextOrchestrationService {
  getAllFiles(params: any): Promise<any>;
  getFileSuggestions(params: any): Promise<any>;
}

interface InteractiveSessionManager {
  pauseSession(sessionId: SessionId): void;
  resumeSession(sessionId: SessionId): void;
  stopSession(sessionId: SessionId): void;
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

/**
 * Service responsible for registering all RPC methods
 *
 * Benefits of extraction:
 * - Separation of concerns: main.ts focuses on extension lifecycle
 * - Testability: RPC methods can be tested independently
 * - Maintainability: All RPC endpoints in one place
 * - Type safety: Proper dependency injection with types
 */
@injectable()
export class RpcMethodRegistrationService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.CLAUDE_CLI_SERVICE)
    private readonly claudeCliService: ClaudeCliService,
    @inject(TOKENS.SESSION_MANAGER)
    private readonly sessionManager: SessionManager,
    @inject(TOKENS.CONTEXT_ORCHESTRATION_SERVICE)
    private readonly contextOrchestration: ContextOrchestrationService,
    @inject(TOKENS.INTERACTIVE_SESSION_MANAGER)
    private readonly interactiveSessionManager: InteractiveSessionManager,
    @inject(TOKENS.AGENT_DISCOVERY_SERVICE)
    private readonly agentDiscovery: AgentDiscoveryService,
    @inject(TOKENS.MCP_DISCOVERY_SERVICE)
    private readonly mcpDiscovery: MCPDiscoveryService,
    @inject(TOKENS.COMMAND_DISCOVERY_SERVICE)
    private readonly commandDiscovery: CommandDiscoveryService
  ) {}

  /**
   * Register all RPC methods
   *
   * This method should be called during extension activation (after DI container setup)
   * to make all RPC endpoints available to the frontend.
   */
  registerAll(): void {
    this.registerSessionMethods();
    this.registerChatMethods();
    this.registerInteractiveSessionMethods();
    this.registerFileMethods();
    this.registerContextMethods();
    this.registerAutocompleteMethods();

    this.logger.info('RPC methods registered', {
      methods: this.rpcHandler.getRegisteredMethods(),
    });
  }

  /**
   * Session operations RPC methods
   */
  private registerSessionMethods(): void {
    // session:list - Get all sessions with UI metadata
    this.rpcHandler.registerMethod('session:list', async () => {
      try {
        this.logger.debug('RPC: session:list called');
        return this.sessionManager.getSessionsUIData();
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

    // session:get - Get specific session by ID
    this.rpcHandler.registerMethod('session:get', async (params: any) => {
      try {
        const { id } = params;
        this.logger.debug('RPC: session:get called', { id });
        const session = this.sessionManager.getSession(id as SessionId);
        return session ?? null;
      } catch (error) {
        this.logger.error(
          'RPC: session:get failed',
          error instanceof Error ? error : new Error(String(error))
        );
        throw new Error(
          `Failed to get session: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    });

    // session:create - Create new session
    this.rpcHandler.registerMethod('session:create', async (params: any) => {
      try {
        const { name } = params;
        this.logger.debug('RPC: session:create called', { name });
        const session = await this.sessionManager.createSession({ name });
        return session.id;
      } catch (error) {
        this.logger.error(
          'RPC: session:create failed',
          error instanceof Error ? error : new Error(String(error))
        );
        throw new Error(
          `Failed to create session: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    });

    // session:switch - Switch to different session
    this.rpcHandler.registerMethod('session:switch', async (params: any) => {
      try {
        const { id } = params;
        this.logger.debug('RPC: session:switch called', { id });
        const success = await this.sessionManager.switchSession(
          id as SessionId
        );
        if (!success) {
          throw new Error(`Session not found: ${id}`);
        }
        return;
      } catch (error) {
        this.logger.error(
          'RPC: session:switch failed',
          error instanceof Error ? error : new Error(String(error))
        );
        throw new Error(
          `Failed to switch session: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    });
  }

  /**
   * Chat operations RPC methods
   *
   * Note: chat:start initiates the CLI process, but streaming happens via
   * webview.postMessage (see claude-cli-launcher.ts callbacks)
   */
  private registerChatMethods(): void {
    // chat:start - Start chat session (streaming happens via postMessage)
    this.rpcHandler.registerMethod('chat:start', async (params: any) => {
      try {
        const { content, files, sessionId } = params;
        this.logger.debug('RPC: chat:start called', {
          contentLength: content?.length,
          fileCount: files?.length,
          sessionId,
        });

        // Start Claude CLI process - streaming happens asynchronously via webview.postMessage
        // The stream itself is handled by ClaudeCliLauncher callbacks (see claude-cli-launcher.ts:321-347)
        await this.claudeCliService.sendMessage(sessionId, content, files);

        // Return immediately - frontend will receive streaming chunks via 'jsonl-message' postMessage
        return { success: true };
      } catch (error) {
        this.logger.error(
          'RPC: chat:start failed',
          error instanceof Error ? error : new Error(String(error))
        );
        throw new Error(
          `Failed to start chat: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    });
  }

  /**
   * Interactive session control RPC methods (TASK_2025_010)
   *
   * These methods support pause/resume/stop functionality for interactive CLI sessions.
   * Used when migrating from print mode (-p flag) to interactive mode.
   */
  private registerInteractiveSessionMethods(): void {
    // chat:pause - Pause current turn (SIGTSTP)
    this.rpcHandler.registerMethod('chat:pause', async (params: any) => {
      try {
        const { sessionId } = params;
        this.logger.debug('RPC: chat:pause called', { sessionId });

        this.interactiveSessionManager.pauseSession(sessionId as SessionId);

        return { success: true };
      } catch (error) {
        this.logger.error(
          'RPC: chat:pause failed',
          error instanceof Error ? error : new Error(String(error))
        );
        throw new Error(
          `Failed to pause chat: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    });

    // chat:resume - Resume paused turn (SIGCONT)
    this.rpcHandler.registerMethod('chat:resume', async (params: any) => {
      try {
        const { sessionId } = params;
        this.logger.debug('RPC: chat:resume called', { sessionId });

        this.interactiveSessionManager.resumeSession(sessionId as SessionId);

        return { success: true };
      } catch (error) {
        this.logger.error(
          'RPC: chat:resume failed',
          error instanceof Error ? error : new Error(String(error))
        );
        throw new Error(
          `Failed to resume chat: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    });

    // chat:stop - Stop current turn and clear queue (SIGTERM)
    this.rpcHandler.registerMethod('chat:stop', async (params: any) => {
      try {
        const { sessionId } = params;
        this.logger.debug('RPC: chat:stop called', { sessionId });

        this.interactiveSessionManager.stopSession(sessionId as SessionId);

        return { success: true };
      } catch (error) {
        this.logger.error(
          'RPC: chat:stop failed',
          error instanceof Error ? error : new Error(String(error))
        );
        throw new Error(
          `Failed to stop chat: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    });
  }

  /**
   * File operations RPC methods
   */
  private registerFileMethods(): void {
    // file:read - Read session file (optional, frontend may read directly)
    this.rpcHandler.registerMethod('file:read', async (params: any) => {
      try {
        const { sessionId } = params;
        // TODO: Implement session file reading when needed
        this.logger.debug('RPC: file:read called', { sessionId });
        return null;
      } catch (error) {
        this.logger.error(
          'RPC: file:read failed',
          error instanceof Error ? error : new Error(String(error))
        );
        throw new Error(
          `Failed to read file: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    });
  }

  /**
   * Context operations RPC methods (TASK_2025_019 Phase 1)
   *
   * These methods support file autocomplete and workspace file discovery
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
   * Autocomplete discovery RPC methods (TASK_2025_019 Phase 2)
   *
   * These methods support agent, MCP server, and command autocomplete
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
