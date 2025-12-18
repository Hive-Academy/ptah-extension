/**
 * Session RPC Handlers
 *
 * Handles session-related RPC methods: session:list, session:load, session:delete
 * Uses SessionMetadataStore for lightweight UI metadata.
 * SDK handles message persistence natively to ~/.claude/projects/{sessionId}.jsonl
 *
 * TASK_2025_074: Extracted from monolithic RpcMethodRegistrationService
 * TASK_2025_088: Simplified to use SDK-native session persistence
 */

import { injectable, inject } from 'tsyringe';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { SessionMetadataStore, SDK_TOKENS } from '@ptah-extension/agent-sdk';
import {
  SessionId,
  SessionListParams,
  SessionListResult,
  SessionLoadParams,
  SessionLoadResult,
} from '@ptah-extension/shared';

/**
 * RPC handlers for session operations (SDK-based)
 *
 * Session Architecture (TASK_2025_088):
 * - SDK handles message persistence to ~/.claude/projects/{sessionId}.jsonl
 * - This handler manages metadata only (names, timestamps, cost)
 * - session:load returns minimal data - actual messages come from SDK resume
 */
@injectable()
export class SessionRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(SDK_TOKENS.SDK_SESSION_METADATA_STORE)
    private readonly metadataStore: SessionMetadataStore
  ) {}

  /**
   * Register all session RPC methods
   */
  register(): void {
    this.registerSessionList();
    this.registerSessionLoad();
    this.registerSessionDelete();

    this.logger.debug('Session RPC handlers registered', {
      methods: ['session:list', 'session:load', 'session:delete'],
    });
  }

  /**
   * session:list - List all sessions for workspace (with pagination)
   * Returns metadata only - SDK handles actual message storage
   */
  private registerSessionList(): void {
    this.rpcHandler.registerMethod<SessionListParams, SessionListResult>(
      'session:list',
      async (params: SessionListParams) => {
        try {
          const { workspacePath, limit = 10, offset = 0 } = params;
          this.logger.debug('RPC: session:list called', {
            workspacePath,
            limit,
            offset,
          });

          // Get session metadata for workspace
          const allSessions = await this.metadataStore.getForWorkspace(
            workspacePath
          );

          // Already sorted by lastActiveAt in metadataStore
          const total = allSessions.length;
          const paginated = allSessions.slice(offset, offset + limit);
          const hasMore = offset + limit < total;

          // Transform to RPC response format (ChatSessionSummary)
          const sessions = paginated.map((s) => ({
            id: s.sessionId as SessionId,
            name: s.name,
            lastActivityAt: s.lastActiveAt,
            createdAt: s.createdAt,
            messageCount: 0, // SDK handles messages - count not stored in metadata
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
   * session:load - Return session metadata for resumption
   * SDK handles actual message loading via resume option
   *
   * NOTE: This now returns minimal metadata. To get actual messages,
   * the frontend should call chat:resume which triggers SDK to replay history.
   */
  private registerSessionLoad(): void {
    this.rpcHandler.registerMethod<SessionLoadParams, SessionLoadResult>(
      'session:load',
      async (params: SessionLoadParams) => {
        try {
          const { sessionId } = params;

          this.logger.debug('RPC: session:load called', { sessionId });

          // Get session metadata
          const metadata = await this.metadataStore.get(sessionId as string);

          if (!metadata) {
            throw new Error(`Session not found: ${sessionId}`);
          }

          // Return minimal result - SDK will stream messages via resume
          return {
            sessionId: metadata.sessionId as SessionId,
            messages: [], // SDK handles messages via resume - don't store them
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
   * session:delete - Delete session metadata
   * Note: This only deletes Ptah's metadata. SDK's JSONL files remain.
   */
  private registerSessionDelete(): void {
    this.rpcHandler.registerMethod<
      { sessionId: SessionId },
      { success: boolean; error?: string }
    >('session:delete', async (params: { sessionId: SessionId }) => {
      try {
        const { sessionId } = params;

        this.logger.info('RPC: session:delete called', { sessionId });

        // Delete metadata (SDK files remain in ~/.claude/projects/)
        await this.metadataStore.delete(sessionId as string);

        this.logger.info('RPC: session:delete succeeded', { sessionId });

        return { success: true };
      } catch (error) {
        this.logger.error(
          'RPC: session:delete failed',
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
