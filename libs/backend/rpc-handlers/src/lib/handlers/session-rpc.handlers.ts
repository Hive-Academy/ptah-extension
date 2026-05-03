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
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  SessionMetadataStore,
  SDK_TOKENS,
  SessionHistoryReaderService,
  SdkAgentAdapter,
  SessionNotActiveError,
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
  SessionForkParams,
  SessionForkResult,
  SessionRewindParams,
  SessionRewindResult,
} from '@ptah-extension/shared';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { RpcMethodName } from '@ptah-extension/shared';

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
  static readonly METHODS = [
    'session:list',
    'session:load',
    'session:delete',
    'session:rename',
    'session:validate',
    'session:cli-sessions',
    'session:stats-batch',
    'session:forkSession',
    'session:rewindFiles',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(SDK_TOKENS.SDK_SESSION_METADATA_STORE)
    private readonly metadataStore: SessionMetadataStore,
    @inject(SDK_TOKENS.SDK_SESSION_HISTORY_READER)
    private readonly historyReader: SessionHistoryReaderService,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(SDK_TOKENS.SDK_AGENT_ADAPTER)
    private readonly sdkAdapter: SdkAgentAdapter,
  ) {}

  /**
   * Verify that a workspacePath supplied by the frontend is one of the
   * currently open workspace folders. Prevents the webview from reading or
   * operating on arbitrary paths outside the active workspace.
   */
  private isAuthorizedWorkspace(workspacePath: string): boolean {
    if (!workspacePath) return false;
    const folders = this.workspaceProvider.getWorkspaceFolders();
    if (!folders || folders.length === 0) return false;
    const normalize = (p: string) =>
      path.resolve(p).replace(/\\/g, '/').toLowerCase();
    const target = normalize(workspacePath);
    return folders.some((f) => normalize(f) === target);
  }

  /**
   * Lowercased lookup of authorized workspace roots, used by path-containment
   * checks that need a `startsWith` predicate rather than equality.
   */
  private getAuthorizedWorkspaceRoots(): string[] {
    const folders = this.workspaceProvider.getWorkspaceFolders() ?? [];
    return folders.map((f) =>
      path.resolve(f).replace(/\\/g, '/').toLowerCase(),
    );
  }

  /**
   * Validate a session UUID: 8-4-4-4-12 hex with hyphens, case-insensitive.
   * Throws an error tagged with `invalid-session-id` so the frontend can
   * branch on a stable code instead of message wording.
   */
  private validateSessionId(sessionId: unknown): string {
    if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sessionId)) {
      throw new Error('invalid-session-id: sessionId must be a 36-char UUID');
    }
    return sessionId;
  }

  /**
   * Validate a user message id. Spec note: rewind's `userMessageId` may be a
   * Ptah-generated message UUID rather than the SDK's exact format, so we
   * apply a permissive guard (non-empty, max 100 chars, no path separators)
   * and let the SDK do final validation.
   */
  private validateUserMessageId(value: unknown): string {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      value.length > 100 ||
      /[\\/]/.test(value)
    ) {
      throw new Error(
        'invalid-user-message-id: userMessageId must be 1-100 chars without path separators',
      );
    }
    return value;
  }

  /**
   * Sanitize an optional fork title: cap at 200 chars and strip Windows-
   * illegal filename characters. Empty strings collapse to `undefined` so
   * downstream code can fall back to the SDK's default "<original> (fork)".
   */
  private sanitizeForkTitle(title: unknown): string | undefined {
    if (title === undefined || title === null) return undefined;
    if (typeof title !== 'string') return undefined;
    // Strip characters that Windows disallows in filenames — the SDK persists
    // the title as part of session metadata which can flow into file paths.
    const stripped = title.replace(/[\\/:*?"<>|]/g, '').trim();
    if (stripped.length === 0) return undefined;
    return stripped.length > 200 ? stripped.substring(0, 200) : stripped;
  }

  /**
   * Resolve session metadata + verify the workspace it belongs to is one of
   * the currently open workspace folders. Throws stable error codes that the
   * frontend (and tests) can branch on:
   *   - `session-not-found` — no metadata for this id
   *   - `unauthorized-workspace` — metadata workspace not in active folders
   */
  private async authorizeSessionAccess(sessionId: string): Promise<void> {
    const metadata = await this.metadataStore.get(sessionId);
    if (!metadata) {
      throw new Error(
        `session-not-found: session ${sessionId} not in metadata store`,
      );
    }
    // Some legacy sessions may have a missing workspaceId. In that case we
    // can't verify ownership, so reject conservatively rather than allow.
    const workspacePath = metadata.workspaceId;
    if (!workspacePath || !this.isAuthorizedWorkspace(workspacePath)) {
      throw new Error(
        `unauthorized-workspace: session ${sessionId} workspace not in active folders`,
      );
    }
  }

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
    this.registerForkSession();
    this.registerRewindFiles();

    this.logger.debug('Session RPC handlers registered', {
      methods: [
        'session:list',
        'session:load',
        'session:delete',
        'session:rename',
        'session:validate',
        'session:cli-sessions',
        'session:stats-batch',
        'session:forkSession',
        'session:rewindFiles',
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

          if (!this.isAuthorizedWorkspace(workspacePath)) {
            this.logger.warn(
              'RPC: session:list rejected — workspacePath outside active workspace',
              { workspacePath },
            );
            throw new Error('workspace-not-authorized');
          }

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
          const metadata = await this.metadataStore.get(sessionId);

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
        const metadata = await this.metadataStore.get(sessionId);
        const workspacePath = metadata?.workspaceId;

        // Delete metadata first
        await this.metadataStore.delete(sessionId);

        // Delete JSONL session file from disk
        if (workspacePath) {
          await this.deleteSessionFiles(sessionId, workspacePath);
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
          const metadata = await this.metadataStore.get(sessionId);
          if (!metadata) {
            return { success: false, error: 'Session not found' };
          }

          await this.metadataStore.rename(sessionId, trimmedName);

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
    const sessionFilePath = await this.findSessionFile(
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

          if (!this.isAuthorizedWorkspace(workspacePath)) {
            this.logger.warn(
              'RPC: session:validate rejected — workspacePath outside active workspace',
              { workspacePath },
            );
            return { exists: false };
          }

          const filePath = await this.findSessionFile(sessionId, workspacePath);

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
              const { stats } = await this.historyReader.readSessionHistory(
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
   * session:forkSession - Fork an existing session into a new branch
   *
   * Delegates to `SdkAgentAdapter.forkSession()`, which calls the SDK's
   * standalone `forkSession()` export to copy the source transcript into a
   * brand-new session file (with remapped UUIDs). Optionally slices the
   * transcript at `upToMessageId` so the user can branch mid-conversation.
   *
   * The returned `newSessionId` can be passed to chat:resume to continue the
   * forked branch. The original session is left untouched.
   */
  private registerForkSession(): void {
    this.rpcHandler.registerMethod<SessionForkParams, SessionForkResult>(
      'session:forkSession',
      async (params: SessionForkParams) => {
        try {
          // Validate inputs at the boundary BEFORE any side effects. These
          // throw with stable error code prefixes the frontend branches on.
          const sessionId = this.validateSessionId(params.sessionId);
          // upToMessageId is optional — only validate when present.
          const upToMessageId =
            params.upToMessageId !== undefined
              ? this.validateUserMessageId(params.upToMessageId)
              : undefined;
          const title = this.sanitizeForkTitle(params.title);

          // Authorize: confirm the session exists in our metadata store and
          // belongs to a currently-open workspace. Rejects cross-workspace
          // probes that bypass the frontend tab UI.
          await this.authorizeSessionAccess(sessionId);

          this.logger.debug('RPC: session:forkSession called', {
            sessionId,
            upToMessageId,
            title,
          });

          const result = await this.sdkAdapter.forkSession(
            sessionId as SessionId,
            upToMessageId,
            title,
          );

          // SDK's ForkSessionResult exposes the new id as `sessionId`. Surface
          // it to the webview as `newSessionId` so callers don't confuse it
          // with the source session id they just passed in.
          return { newSessionId: result.sessionId as SessionId };
        } catch (error) {
          const errorObj =
            error instanceof Error ? error : new Error(String(error));
          this.logger.error('RPC: session:forkSession failed', errorObj);
          this.sentryService.captureException(errorObj, {
            errorSource: 'SessionRpcHandlers.registerForkSession',
          });
          throw new Error(`Failed to fork session: ${errorObj.message}`);
        }
      },
    );
  }

  /**
   * session:rewindFiles - Rewind tracked files for an active session
   *
   * Delegates to `SdkAgentAdapter.rewindFiles()`, which calls
   * `Query.rewindFiles()` on the live SDK query handle. **Requires the
   * session to be currently active in SessionLifecycleManager** — there
   * must be an in-flight or paused query with file checkpointing enabled.
   *
   * When the session is not active, the adapter throws an SdkError that
   * mentions "is not active or has no live Query handle". We translate
   * that into a stable RPC error code (`session-not-active`) so the
   * frontend can prompt the user to resume the session first instead of
   * showing a raw stack trace.
   */
  private registerRewindFiles(): void {
    this.rpcHandler.registerMethod<SessionRewindParams, SessionRewindResult>(
      'session:rewindFiles',
      async (params: SessionRewindParams) => {
        try {
          // Validate inputs at the boundary. Stable error code prefixes
          // (`invalid-session-id`, `invalid-user-message-id`) flow up to the
          // frontend so it can show actionable messages.
          const sessionId = this.validateSessionId(params.sessionId);
          const userMessageId = this.validateUserMessageId(
            params.userMessageId,
          );
          const dryRun = params.dryRun;

          // Authorize cross-workspace access (rejects when session belongs to
          // a workspace not currently open in the editor).
          await this.authorizeSessionAccess(sessionId);

          this.logger.debug('RPC: session:rewindFiles called', {
            sessionId,
            userMessageId,
            dryRun: dryRun ?? false,
          });

          const result = await this.sdkAdapter.rewindFiles(
            sessionId as SessionId,
            userMessageId,
            dryRun,
          );

          // Path containment guard: when the SDK reports filesChanged in a
          // non-dry-run, verify each path resolves under one of the active
          // workspace roots. The SDK has already written by the time we see
          // the result — moving the validation to a server-side dryRun first
          // would be a much larger refactor (the frontend already does the
          // dry-run preview pattern). Best we can do at this boundary:
          // log + Sentry + reject the response so the user is alerted.
          if (
            dryRun === false &&
            Array.isArray(result.filesChanged) &&
            result.filesChanged.length > 0
          ) {
            const roots = this.getAuthorizedWorkspaceRoots();
            const escapingPaths: string[] = [];
            for (const p of result.filesChanged) {
              const resolved = path
                .resolve(p)
                .replace(/\\/g, '/')
                .toLowerCase();
              const contained = roots.some(
                (root) =>
                  resolved === root ||
                  resolved.startsWith(root.endsWith('/') ? root : root + '/'),
              );
              if (!contained) {
                escapingPaths.push(p);
              }
            }

            if (escapingPaths.length > 0) {
              const message = `unauthorized-path-rewrite: rewindFiles touched ${escapingPaths.length} path(s) outside the active workspace`;
              const err = new Error(message);
              this.logger.warn(message, {
                sessionId,
                escapingCount: escapingPaths.length,
                samplePaths: escapingPaths.slice(0, 5),
              });
              this.sentryService.captureException(err, {
                errorSource:
                  'SessionRpcHandlers.registerRewindFiles.pathContainment',
              });
              // Surface to the frontend so the user knows something is off.
              throw err;
            }
          }

          // SDK's RewindFilesResult is structurally identical to the shared
          // SessionRewindResult (see rpc-session.types.ts) — return as-is.
          return {
            canRewind: result.canRewind,
            error: result.error,
            filesChanged: result.filesChanged,
            insertions: result.insertions,
            deletions: result.deletions,
          };
        } catch (error) {
          const errorObj =
            error instanceof Error ? error : new Error(String(error));
          this.logger.error('RPC: session:rewindFiles failed', errorObj);
          this.sentryService.captureException(errorObj, {
            errorSource: 'SessionRpcHandlers.registerRewindFiles',
          });
          // Prefer the stable error type over regex-matching the message
          // (Fix 8). The regex fallback is preserved below for safety in
          // case a non-typed error bubbles up through legacy paths.
          if (error instanceof SessionNotActiveError) {
            throw new Error(`session-not-active: ${errorObj.message}`);
          }
          if (
            /is not active or has no live Query handle/i.test(errorObj.message)
          ) {
            throw new Error(`session-not-active: ${errorObj.message}`);
          }
          throw new Error(`Failed to rewind files: ${errorObj.message}`);
        }
      },
    );
  }

  /**
   * Find the Claude SDK JSONL session file on disk.
   *
   * Claude SDK sessions: ~/.claude/projects/{workspace}/{sessionId}.jsonl
   */
  private async findSessionFile(
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
