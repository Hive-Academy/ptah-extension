/**
 * Session RPC Handlers
 *
 * Handles session-related RPC methods: session:list, session:load
 * Uses SdkSessionStorage for session management.
 *
 * TASK_2025_074: Extracted from monolithic RpcMethodRegistrationService
 */

import { injectable, inject } from 'tsyringe';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { SdkSessionStorage } from '@ptah-extension/agent-sdk';
import {
  SessionListParams,
  SessionListResult,
  SessionLoadParams,
  SessionLoadResult,
} from '@ptah-extension/shared';

/**
 * RPC handlers for session operations (SDK-based)
 */
@injectable()
export class SessionRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject('SdkSessionStorage') private readonly sdkStorage: SdkSessionStorage
  ) {}

  /**
   * Register all session RPC methods
   */
  register(): void {
    this.registerSessionList();
    this.registerSessionLoad();

    this.logger.debug('Session RPC handlers registered', {
      methods: ['session:list', 'session:load'],
    });
  }

  /**
   * session:list - List all sessions for workspace (with pagination)
   */
  private registerSessionList(): void {
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

          // Transform to RPC response format (ChatSessionSummary)
          const sessions = paginated.map((s) => ({
            id: s.id,
            name: s.name,
            lastActivityAt: s.lastActiveAt,
            createdAt: s.createdAt,
            messageCount: s.messages.length,
            isActive: false, // Listed sessions are not currently active
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
  }

  /**
   * session:load - Load session messages from SDK storage
   */
  private registerSessionLoad(): void {
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
}
