/**
 * Session RPC Handlers
 *
 * Handles session-related RPC methods: session:list, session:load, session:delete, session:validate
 * Uses SessionMetadataStore for lightweight UI metadata.
 * SDK handles message persistence natively to ~/.claude/projects/{sessionId}.jsonl
 *
 * TASK_2025_074: Extracted from monolithic RpcMethodRegistrationService
 * TASK_2025_088: Simplified to use SDK-native session persistence
 */

import { injectable, inject } from 'tsyringe';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import { SessionMetadataStore, SDK_TOKENS } from '@ptah-extension/agent-sdk';
import {
  SessionId,
  SessionListParams,
  SessionListResult,
  SessionLoadParams,
  SessionLoadResult,
  CliSessionReference,
} from '@ptah-extension/shared';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

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
    this.registerSessionValidate();
    this.registerSessionCliSessions();

    this.logger.debug('Session RPC handlers registered', {
      methods: [
        'session:list',
        'session:load',
        'session:delete',
        'session:validate',
        'session:cli-sessions',
      ],
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
   * session:load - Validate session exists (metadata-only)
   *
   * This is a lightweight check that returns immediately with empty arrays.
   * To load conversation history, frontend must call chat:resume after this.
   *
   * Flow: session:load (validate) → chat:resume (trigger SDK replay)
   *
   * TASK_2025_089: Clarified that this is validation only, not data loading
   */
  private registerSessionLoad(): void {
    this.rpcHandler.registerMethod<SessionLoadParams, SessionLoadResult>(
      'session:load',
      async (params: SessionLoadParams) => {
        try {
          const { sessionId } = params;

          this.logger.debug('RPC: session:load called (metadata validation)', {
            sessionId,
          });

          // Validate session exists in metadata store
          const metadata = await this.metadataStore.get(sessionId as string);

          if (!metadata) {
            throw new Error(`Session not found: ${sessionId}`);
          }

          this.logger.debug(
            'RPC: session:load validated - call chat:resume next',
            {
              sessionId,
            }
          );

          // Return empty arrays - actual messages loaded via chat:resume
          return {
            sessionId: metadata.sessionId as SessionId,
            messages: [], // Empty by design - see SessionLoadResult docs
            agentSessions: [], // Empty by design - SDK handles everything
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

  /**
   * session:validate - Check if session file exists on disk
   *
   * Validates that the actual .jsonl file exists in the Claude projects directory.
   * This prevents "process exited with code 1" errors when trying to
   * resume sessions that exist in localStorage but not on disk.
   *
   * @param sessionId - Session ID to validate
   * @param workspacePath - Workspace path to find the sessions directory
   * @returns { exists: boolean, filePath?: string }
   */
  private registerSessionValidate(): void {
    this.rpcHandler.registerMethod<
      { sessionId: SessionId; workspacePath: string },
      { exists: boolean; filePath?: string }
    >(
      'session:validate',
      async (params: { sessionId: SessionId; workspacePath: string }) => {
        try {
          const { sessionId, workspacePath } = params;

          this.logger.debug('RPC: session:validate called', {
            sessionId,
            workspacePath,
          });

          const filePath = await this.findSessionFile(
            sessionId as string,
            workspacePath
          );

          if (filePath) {
            this.logger.debug('RPC: session:validate - session file exists', {
              sessionId,
              filePath,
            });
            return { exists: true, filePath };
          }

          this.logger.debug('RPC: session:validate - session file NOT found', {
            sessionId,
          });
          return { exists: false };
        } catch (error) {
          this.logger.error(
            'RPC: session:validate failed',
            error instanceof Error ? error : new Error(String(error))
          );
          return { exists: false };
        }
      }
    );
  }

  /**
   * session:cli-sessions - Get CLI sessions for a given parent session
   *
   * Lightweight endpoint that returns only CLI session references from metadata.
   * Used by the frontend to restore agent monitor panel when webview reopens
   * with a previously active session (tab restored from localStorage).
   */
  private registerSessionCliSessions(): void {
    this.rpcHandler.registerMethod<
      { sessionId: string },
      { cliSessions: CliSessionReference[] }
    >('session:cli-sessions', async (params: { sessionId: string }) => {
      try {
        const { sessionId } = params;
        const metadata = await this.metadataStore.get(sessionId);
        const cliSessions = metadata?.cliSessions
          ? [...metadata.cliSessions]
          : [];

        return { cliSessions };
      } catch (error) {
        this.logger.error(
          'RPC: session:cli-sessions failed',
          error instanceof Error ? error : new Error(String(error))
        );
        return { cliSessions: [] };
      }
    });
  }

  /**
   * Find the session JSONL file on disk
   *
   * Looks for the session file in ~/.claude/projects/{workspace}/
   * Returns the file path if it exists, null otherwise.
   */
  private async findSessionFile(
    sessionId: string,
    workspacePath: string
  ): Promise<string | null> {
    const homeDir = os.homedir();
    const projectsDir = path.join(homeDir, '.claude', 'projects');

    try {
      await fs.access(projectsDir);
    } catch {
      // Projects directory doesn't exist
      return null;
    }

    // Generate the escaped workspace path (Claude's format)
    const escapedPath = workspacePath.replace(/[:\\/]/g, '-');
    const dirs = await fs.readdir(projectsDir);

    // Try exact match
    let sessionDir: string | undefined = escapedPath;
    if (!dirs.includes(escapedPath)) {
      // Try case-insensitive match
      const lowerEscaped = escapedPath.toLowerCase();
      sessionDir = dirs.find((d) => d.toLowerCase() === lowerEscaped);

      if (!sessionDir) {
        // Try normalized match: treat hyphens and underscores as equivalent.
        // Claude CLI may normalize path separators differently (e.g., replacing _ with -)
        const normalize = (s: string) => s.toLowerCase().replace(/[-_]/g, '-');
        sessionDir = dirs.find((d) => normalize(d) === normalize(escapedPath));
      }

      if (!sessionDir) {
        // Try partial match (workspace name only)
        const workspaceName = path.basename(workspacePath);
        const normalize = (s: string) => s.toLowerCase().replace(/[-_]/g, '-');
        sessionDir = dirs.find(
          (d) =>
            d.toLowerCase().includes(workspaceName.toLowerCase()) ||
            normalize(d).includes(normalize(workspaceName))
        );
      }
    }

    if (!sessionDir) {
      return null;
    }

    const sessionFilePath = path.join(
      projectsDir,
      sessionDir,
      `${sessionId}.jsonl`
    );

    try {
      await fs.access(sessionFilePath);
      return sessionFilePath;
    } catch {
      return null;
    }
  }
}
