/**
 * Session RPC Handlers
 *
 * Handles session-related RPC methods: session:list, session:load, session:delete, session:rename,
 * session:validate, session:cli-sessions, session:stats-batch
 * Uses SessionMetadataStore for lightweight UI metadata.
 * SDK handles message persistence natively to ~/.claude/projects/{sessionId}.jsonl
 *
 * TASK_2025_074: Extracted from monolithic RpcMethodRegistrationService
 * TASK_2025_088: Simplified to use SDK-native session persistence
 */

import { injectable, inject } from 'tsyringe';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import {
  SessionMetadataStore,
  SDK_TOKENS,
  SessionHistoryReaderService,
  DeepAgentHistoryReaderService,
} from '@ptah-extension/agent-sdk';
import {
  SessionId,
  SessionListParams,
  SessionListResult,
  SessionLoadParams,
  SessionLoadResult,
  CliSessionReference,
  SessionRenameParams,
  SessionRenameResult,
  SessionStatsBatchParams,
  SessionStatsBatchResult,
  SessionStatsEntry,
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
    private readonly metadataStore: SessionMetadataStore,
    @inject(SDK_TOKENS.SDK_SESSION_HISTORY_READER)
    private readonly historyReader: SessionHistoryReaderService,
    @inject(SDK_TOKENS.SDK_DEEP_AGENT_HISTORY_READER)
    private readonly deepAgentHistoryReader: DeepAgentHistoryReaderService,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
  ) {}

  /**
   * Register all session RPC methods
   */
  register(): void {
    this.registerSessionList();
    this.registerSessionLoad();
    this.registerSessionDelete();
    this.registerSessionRename();
    this.registerSessionValidate();
    this.registerSessionCliSessions();
    this.registerSessionStatsBatch();

    this.logger.debug('Session RPC handlers registered', {
      methods: [
        'session:list',
        'session:load',
        'session:delete',
        'session:rename',
        'session:validate',
        'session:cli-sessions',
        'session:stats-batch',
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
          const allSessions =
            await this.metadataStore.getForWorkspace(workspacePath);

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
            // Pass through token usage from metadata if available
            ...(s.totalTokens &&
            (s.totalTokens.input > 0 || s.totalTokens.output > 0)
              ? {
                  tokenUsage: {
                    input: s.totalTokens.input,
                    output: s.totalTokens.output,
                  },
                }
              : {}),
          }));

          return { sessions, total, hasMore };
        } catch (error) {
          this.logger.error(
            'RPC: session:list failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'SessionRpcHandlers.registerSessionList' },
          );
          throw new Error(
            `Failed to list sessions: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      },
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
            },
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
            error instanceof Error ? error : new Error(String(error)),
          );
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'SessionRpcHandlers.registerSessionLoad' },
          );
          throw new Error(
            `Failed to load session: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      },
    );
  }

  /**
   * session:delete - Delete session metadata AND JSONL files from disk
   * Removes both Ptah's metadata and the SDK's session files from ~/.claude/projects/
   */
  private registerSessionDelete(): void {
    this.rpcHandler.registerMethod<
      { sessionId: SessionId },
      { success: boolean; error?: string }
    >('session:delete', async (params: { sessionId: SessionId }) => {
      try {
        const { sessionId } = params;

        this.logger.info('RPC: session:delete called', { sessionId });

        // Get workspace path from metadata BEFORE deleting it
        const metadata = await this.metadataStore.get(sessionId as string);
        const workspacePath = metadata?.workspaceId;

        // Delete metadata first
        await this.metadataStore.delete(sessionId as string);

        // Delete JSONL session file from disk
        if (workspacePath) {
          await this.deleteSessionFiles(sessionId as string, workspacePath);
        } else {
          this.logger.warn(
            'RPC: session:delete - no workspace path in metadata, skipping file deletion',
            { sessionId },
          );
        }

        this.logger.info('RPC: session:delete succeeded', { sessionId });

        return { success: true };
      } catch (error) {
        this.logger.error(
          'RPC: session:delete failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'SessionRpcHandlers.registerSessionDelete' },
        );
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
  }

  /**
   * session:rename - Rename session metadata
   */
  private registerSessionRename(): void {
    this.rpcHandler.registerMethod<SessionRenameParams, SessionRenameResult>(
      'session:rename',
      async (params: SessionRenameParams) => {
        try {
          const { sessionId, name } = params;
          const trimmedName = name.trim();

          if (!trimmedName || trimmedName.length > 200) {
            return {
              success: false,
              error: 'Session name must be between 1 and 200 characters',
            };
          }

          this.logger.info('RPC: session:rename called', {
            sessionId,
            name: trimmedName,
          });

          // Verify session exists before renaming
          const metadata = await this.metadataStore.get(sessionId as string);
          if (!metadata) {
            return { success: false, error: 'Session not found' };
          }

          await this.metadataStore.rename(sessionId as string, trimmedName);

          this.logger.info('RPC: session:rename succeeded', { sessionId });

          return { success: true };
        } catch (error) {
          this.logger.error(
            'RPC: session:rename failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'SessionRpcHandlers.registerSessionRename' },
          );
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );
  }

  /**
   * Delete session JSONL files from disk.
   * Removes the main session file and any agent sub-session files.
   * Fails gracefully if files don't exist (session may have been short-lived).
   *
   * Agent sub-sessions are stored in two possible layouts (SDK version dependent):
   * - Current (nested): {sessionsDir}/{sessionId}/subagents/agent-{id}.jsonl
   * - Legacy (flat): {sessionsDir}/agent-{id}.jsonl (filtered by sessionId match)
   */
  private async deleteSessionFiles(
    sessionId: string,
    workspacePath: string,
  ): Promise<void> {
    // Handle deep agent sessions separately — they use a directory, not a single file
    if (this.deepAgentHistoryReader.hasSession(sessionId, workspacePath)) {
      const threadDir = path.join(
        workspacePath,
        '.ptah',
        'deep-agent-sessions',
        sessionId,
      );
      try {
        await fs.rm(threadDir, { recursive: true, force: true });
        this.logger.info(
          'RPC: session:delete - deleted deep agent session directory',
          { sessionId, threadDir },
        );
      } catch (err) {
        this.logger.warn(
          'RPC: session:delete - failed to delete deep agent session directory',
          {
            sessionId,
            threadDir,
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }
      return;
    }

    const sessionFilePath = await this.findJsonlSessionFile(
      sessionId,
      workspacePath,
    );

    if (!sessionFilePath) {
      this.logger.debug(
        'RPC: session:delete - session file not found on disk (already deleted or never created)',
        { sessionId },
      );
      return;
    }

    const sessionsDir = path.dirname(sessionFilePath);

    // Delete the main session file
    try {
      await fs.unlink(sessionFilePath);
      this.logger.info('RPC: session:delete - deleted JSONL file', {
        sessionId,
        filePath: sessionFilePath,
      });
    } catch (err) {
      this.logger.warn('RPC: session:delete - failed to delete JSONL file', {
        sessionId,
        filePath: sessionFilePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Delete agent sub-session files
    let deletedSubagents = 0;

    // 1. Current nested layout: {sessionsDir}/{sessionId}/subagents/
    const subagentsDir = path.join(sessionsDir, sessionId, 'subagents');
    try {
      const subagentFiles = await fs.readdir(subagentsDir);
      for (const file of subagentFiles) {
        if (file.startsWith('agent-') && file.endsWith('.jsonl')) {
          try {
            await fs.unlink(path.join(subagentsDir, file));
            deletedSubagents++;
          } catch {
            // Skip individual file failures
          }
        }
      }
      // Remove the subagents directory itself (if empty)
      try {
        await fs.rmdir(subagentsDir);
      } catch {
        // Not empty or doesn't exist — fine
      }
      // Remove the parent session directory (if empty)
      try {
        await fs.rmdir(path.join(sessionsDir, sessionId));
      } catch {
        // Not empty or doesn't exist — fine
      }
    } catch {
      // Nested subagents directory doesn't exist — try legacy layout
    }

    // 2. Legacy flat layout: {sessionsDir}/agent-*.jsonl
    // Only scan if no nested subagents were found
    if (deletedSubagents === 0) {
      try {
        const allFiles = await fs.readdir(sessionsDir);
        const agentFiles = allFiles.filter(
          (f) => f.startsWith('agent-') && f.endsWith('.jsonl'),
        );
        for (const file of agentFiles) {
          const filePath = path.join(sessionsDir, file);
          try {
            // Read first line to check if this agent belongs to our session
            const content = await fs.readFile(filePath, 'utf-8');
            const firstLine = content.split('\n')[0];
            if (firstLine) {
              const firstMsg = JSON.parse(firstLine);
              if (firstMsg.sessionId === sessionId) {
                await fs.unlink(filePath);
                deletedSubagents++;
              }
            }
          } catch {
            // Skip unreadable/unparseable files
          }
        }
      } catch {
        // Directory not readable
      }
    }

    if (deletedSubagents > 0) {
      this.logger.info('RPC: session:delete - deleted subagent files', {
        sessionId,
        deletedSubagents,
      });
    }
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
            workspacePath,
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
            error instanceof Error ? error : new Error(String(error)),
          );
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'SessionRpcHandlers.registerSessionValidate' },
          );
          return { exists: false };
        }
      },
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
        const raw = metadata?.cliSessions ?? [];

        // Filter out ghost entries synthesized by the old (now-removed)
        // recoverMissingCliSessions() method. That code incorrectly labeled
        // SDK internal subagents (agent_start history events) as ptah-cli
        // CLI sessions. Real ptah-cli CLI sessions persisted by
        // persistCliSessionReference() always have a ptahCliId set.
        const cliSessions = raw.filter(
          (ref) => ref.cli !== 'ptah-cli' || ref.ptahCliId,
        );

        return { cliSessions };
      } catch (error) {
        this.logger.error(
          'RPC: session:cli-sessions failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'SessionRpcHandlers.registerSessionCliSessions' },
        );
        return { cliSessions: [] };
      }
    });
  }

  /**
   * session:stats-batch - Batch fetch real stats for multiple sessions from JSONL files
   *
   * Reads JSONL files via SessionHistoryReaderService to get accurate per-session
   * stats (cost, tokens, model, message count). This bypasses the broken metadata
   * pipeline (addStats never called) and reads directly from source of truth.
   *
   * TASK_2025_206 v2: Dashboard redesign with per-session stats cards
   */
  private registerSessionStatsBatch(): void {
    this.rpcHandler.registerMethod<
      SessionStatsBatchParams,
      SessionStatsBatchResult
    >('session:stats-batch', async (params: SessionStatsBatchParams) => {
      const { sessionIds, workspacePath } = params;
      this.logger.debug('RPC: session:stats-batch called', {
        sessionCount: sessionIds.length,
        workspacePath,
      });

      // Process with limited concurrency (5 at a time) to avoid
      // overwhelming file system while staying well within RPC timeout
      const CONCURRENCY_LIMIT = 5;
      const sessionStats: SessionStatsEntry[] = [];

      for (let i = 0; i < sessionIds.length; i += CONCURRENCY_LIMIT) {
        const batch = sessionIds.slice(i, i + CONCURRENCY_LIMIT);
        const results = await Promise.allSettled(
          batch.map(async (sessionId) => {
            try {
              // Check deep agent sessions first, then fall back to JSONL
              const isDeepAgent = this.deepAgentHistoryReader.hasSession(
                sessionId,
                workspacePath,
              );
              const { stats } = isDeepAgent
                ? await this.deepAgentHistoryReader.readSessionHistory(
                    sessionId,
                    workspacePath,
                  )
                : await this.historyReader.readSessionHistory(
                    sessionId,
                    workspacePath,
                  );

              // Get CLI agent types from metadata (gemini, codex, copilot, ptah-cli)
              const metadata = await this.metadataStore.get(sessionId);
              const cliAgents = metadata?.cliSessions
                ? [...new Set(metadata.cliSessions.map((ref) => ref.cli))]
                : [];

              if (!stats) {
                return {
                  sessionId,
                  model: null,
                  totalCost: 0,
                  tokens: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheCreation: 0,
                  },
                  messageCount: 0,
                  cliAgents,
                  status: 'empty' as const,
                };
              }

              const statsAny = stats as Record<string, unknown>;
              return {
                sessionId,
                model: (statsAny['model'] as string) ?? null,
                totalCost: stats.totalCost,
                tokens: stats.tokens,
                messageCount: stats.messageCount,
                agentSessionCount:
                  (statsAny['agentSessionCount'] as number) ?? 0,
                modelUsageList: statsAny['modelUsageList'] as
                  | Array<{
                      model: string;
                      inputTokens: number;
                      outputTokens: number;
                      costUSD: number;
                    }>
                  | undefined,
                cliAgents,
                status: 'ok' as const,
              };
            } catch (error) {
              this.logger.warn('RPC: session:stats-batch failed for session', {
                sessionId,
                error: error instanceof Error ? error.message : String(error),
              });
              return {
                sessionId,
                model: null,
                totalCost: 0,
                tokens: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheCreation: 0,
                },
                messageCount: 0,
                status: 'error' as const,
              };
            }
          }),
        );

        for (let j = 0; j < results.length; j++) {
          const result = results[j];
          sessionStats.push(
            result.status === 'fulfilled'
              ? result.value
              : {
                  sessionId: batch[j],
                  model: null,
                  totalCost: 0,
                  tokens: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheCreation: 0,
                  },
                  messageCount: 0,
                  status: 'error' as const,
                },
          );
        }
      }

      this.logger.debug('RPC: session:stats-batch completed', {
        total: sessionIds.length,
        ok: sessionStats.filter((s) => s.status === 'ok').length,
        empty: sessionStats.filter((s) => s.status === 'empty').length,
        error: sessionStats.filter((s) => s.status === 'error').length,
      });

      return { sessionStats };
    });
  }

  /**
   * Find the session file on disk — checks both Claude SDK JSONL files
   * and deep agent checkpoint directories.
   *
   * Claude SDK sessions: ~/.claude/projects/{workspace}/{sessionId}.jsonl
   * Deep agent sessions: {workspacePath}/.ptah/deep-agent-sessions/{sessionId}/metadata.json
   */
  private async findSessionFile(
    sessionId: string,
    workspacePath: string,
  ): Promise<string | null> {
    // 1. Check Claude SDK JSONL files
    const jsonlPath = await this.findJsonlSessionFile(sessionId, workspacePath);
    if (jsonlPath) return jsonlPath;

    // 2. Fallback: check deep agent checkpoint directory
    if (this.deepAgentHistoryReader.hasSession(sessionId, workspacePath)) {
      return path.join(
        workspacePath,
        '.ptah',
        'deep-agent-sessions',
        sessionId,
        'metadata.json',
      );
    }

    return null;
  }

  private async findJsonlSessionFile(
    sessionId: string,
    workspacePath: string,
  ): Promise<string | null> {
    const homeDir = os.homedir();
    const projectsDir = path.join(homeDir, '.claude', 'projects');

    try {
      await fs.access(projectsDir);
    } catch {
      return null;
    }

    const escapedPath = workspacePath.replace(/[:\\/]/g, '-');
    const dirs = await fs.readdir(projectsDir);

    let sessionDir: string | undefined = escapedPath;
    if (!dirs.includes(escapedPath)) {
      const lowerEscaped = escapedPath.toLowerCase();
      sessionDir = dirs.find((d) => d.toLowerCase() === lowerEscaped);

      if (!sessionDir) {
        const normalize = (s: string) => s.toLowerCase().replace(/[-_]/g, '-');
        sessionDir = dirs.find((d) => normalize(d) === normalize(escapedPath));
      }

      if (!sessionDir) {
        const workspaceName = path.basename(workspacePath);
        const normalize = (s: string) => s.toLowerCase().replace(/[-_]/g, '-');
        sessionDir = dirs.find(
          (d) =>
            d.toLowerCase().includes(workspaceName.toLowerCase()) ||
            normalize(d).includes(normalize(workspaceName)),
        );
      }
    }

    if (!sessionDir) {
      return null;
    }

    const sessionFilePath = path.join(
      projectsDir,
      sessionDir,
      `${sessionId}.jsonl`,
    );

    try {
      await fs.access(sessionFilePath);
      return sessionFilePath;
    } catch {
      return null;
    }
  }
}
