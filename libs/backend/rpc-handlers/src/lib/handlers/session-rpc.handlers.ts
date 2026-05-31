/**
 * Session RPC Handlers
 *
 * Handles session-related RPC methods: session:list, session:load, session:delete, session:rename,
 * session:validate, session:cli-sessions, session:stats-batch
 * Uses SessionMetadataStore for lightweight UI metadata.
 * SDK handles message persistence natively to ~/.claude/projects/{sessionId}.jsonl.
 */

import { injectable, inject } from 'tsyringe';
import {
  Logger,
  RpcHandler,
  RpcUserError,
  TOKENS,
} from '@ptah-extension/vscode-core';
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
  SdkError,
  MESSAGE_ID_NOT_FOUND_PHRASE,
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
  UUID_REGEX,
} from '@ptah-extension/shared';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { RpcMethodName } from '@ptah-extension/shared';
import { isAuthorizedWorkspace } from '../utils/workspace-authorization';
import { z } from 'zod';
import { CHAT_TOKENS } from '../chat/tokens';
import type { ChatSessionService } from '../chat/session/chat-session.service';

/**
 * Minimal schema for JSONL first-line entries in agent session files.
 * Only `sessionId` is required for the delete-subagents lookup.
 * Exported for focused unit testing in session-rpc.schema.spec.ts.
 */
export const AgentJsonlFirstLineSchema = z.object({
  sessionId: z.string(),
});

/**
 * RPC handlers for session operations (SDK-based)
 *
 * Session Architecture:
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
    @inject(CHAT_TOKENS.SESSION)
    private readonly chatSession: ChatSessionService,
  ) {}

  /**
   * Verify that a workspacePath supplied by the frontend is one of the
   * currently open workspace folders, OR is a sub-path of one of them.
   *
   * Sub-path check is needed because the webview may serialize paths with
   * trailing slashes or mixed separators after JSON round-trips. A path is
   * accepted when:
   *   - It matches an open folder exactly (after normalization), OR
   *   - It starts with an open folder path followed by a separator boundary
   *     (prevents `/foo/barbaz` from matching `/foo/bar`).
   *
   * Both sides are normalized (path.resolve + backslash-to-slash + lowercase +
   * trailing-separator stripped) before comparison.
   */
  private isAuthorizedWorkspace(workspacePath: string): boolean {
    return isAuthorizedWorkspace(workspacePath, this.workspaceProvider);
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
    if (typeof sessionId !== 'string' || !UUID_REGEX.test(sessionId)) {
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
          const allSessions =
            await this.metadataStore.getForWorkspace(workspacePath);
          const total = allSessions.length;
          const paginated = allSessions.slice(offset, offset + limit);
          const hasMore = offset + limit < total;
          const sessions = paginated.flatMap((s) => {
            let id: SessionId;
            try {
              id = SessionId.from(s.sessionId);
            } catch (parseError) {
              this.logger.error(
                'RPC: session:list skipping row with corrupt sessionId',
                parseError instanceof Error
                  ? parseError
                  : new Error(String(parseError)),
              );
              return [];
            }
            return [
              {
                id,
                name: s.name,
                lastActivityAt: s.lastActiveAt,
                createdAt: s.createdAt,
                messageCount: 0, // SDK handles messages - count not stored in metadata
                isActive: false, // Listed sessions are not currently active
                ...(s.totalTokens &&
                (s.totalTokens.input > 0 || s.totalTokens.output > 0)
                  ? {
                      tokenUsage: {
                        input: s.totalTokens.input,
                        output: s.totalTokens.output,
                      },
                    }
                  : {}),
              },
            ];
          });

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
   * Flow: session:load (validate) → chat:resume (trigger SDK replay).
   * This is validation only, not data loading.
   */
  private registerSessionLoad(): void {
    this.rpcHandler.registerMethod<SessionLoadParams, SessionLoadResult>(
      'session:load',
      async (params: SessionLoadParams) => {
        try {
          const sessionId = this.validateSessionId(params.sessionId);
          await this.authorizeSessionAccess(sessionId);

          this.logger.debug('RPC: session:load called (metadata validation)', {
            sessionId,
          });
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
          let validatedSessionId: SessionId;
          try {
            validatedSessionId = SessionId.from(metadata.sessionId);
          } catch (parseError) {
            this.logger.error(
              'RPC: session:load aborted - metadata row has corrupt sessionId',
              parseError instanceof Error
                ? parseError
                : new Error(String(parseError)),
            );
            throw new Error(
              `Session metadata corrupted (non-UUID sessionId): ${sessionId}`,
            );
          }
          return {
            sessionId: validatedSessionId,
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
        const sessionId = this.validateSessionId(params.sessionId);
        await this.authorizeSessionAccess(sessionId);

        this.logger.info('RPC: session:delete called', { sessionId });
        const metadata = await this.metadataStore.get(sessionId);
        const workspacePath = metadata?.workspaceId;
        await this.metadataStore.delete(sessionId);
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
          const sessionId = this.validateSessionId(params.sessionId);
          await this.authorizeSessionAccess(sessionId);
          const { name } = params;
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
    const resolvedSessionFile = path.resolve(sessionFilePath);
    const resolvedSessionsDir = path.resolve(sessionsDir);
    if (
      !resolvedSessionFile.startsWith(resolvedSessionsDir + path.sep) &&
      resolvedSessionFile !== resolvedSessionsDir
    ) {
      throw new Error(
        `unauthorized-path-rewrite: deleteSessionFiles refused to operate on ${sessionFilePath} (outside ${sessionsDir})`,
      );
    }
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
    let deletedSubagents = 0;
    const subagentsDir = path.join(sessionsDir, sessionId, 'subagents');

    const subagentFiles = await fs.readdir(subagentsDir);
    for (const file of subagentFiles) {
      if (file.startsWith('agent-') && file.endsWith('.jsonl')) {
        await fs.unlink(path.join(subagentsDir, file));
        deletedSubagents++;
      }
    }

    await fs.rmdir(subagentsDir);

    await fs.rmdir(path.join(sessionsDir, sessionId));
    if (deletedSubagents === 0) {
      const allFiles = await fs.readdir(sessionsDir);
      const agentFiles = allFiles.filter(
        (f) => f.startsWith('agent-') && f.endsWith('.jsonl'),
      );
      for (const file of agentFiles) {
        const filePath = path.join(sessionsDir, file);

        const content = await fs.readFile(filePath, 'utf-8');
        const firstLine = content.split('\n')[0];
        if (firstLine) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(firstLine);
          } catch {
            this.logger.debug(
              'session:delete — skipping unreadable JSONL (malformed JSON)',
              { filePath },
            );
            continue;
          }
          const result = AgentJsonlFirstLineSchema.safeParse(parsed);
          if (!result.success) {
            this.logger.debug(
              'session:delete — skipping JSONL with unexpected first-line shape',
              { filePath, issues: result.error.issues },
            );
            continue;
          }
          if (result.data.sessionId === sessionId) {
            await fs.unlink(filePath);
            deletedSubagents++;
          }
        }
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
        const sessionId = this.validateSessionId(params.sessionId);
        await this.authorizeSessionAccess(sessionId);
        const metadata = await this.metadataStore.get(sessionId);
        const raw = metadata?.cliSessions ?? [];
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
      if (!this.isAuthorizedWorkspace(workspacePath)) {
        this.logger.warn(
          'RPC: session:stats-batch rejected — workspacePath outside active workspace',
          { workspacePath },
        );
        throw new Error('workspace-not-authorized');
      }
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
              const metadata = await this.metadataStore.get(sessionId);
              const cliAgents = metadata?.cliSessions
                ? [...new Set(metadata.cliSessions.map((ref) => ref.cli))]
                : [];

              if (!stats) {
                return {
                  sessionId,
                  model: null,
                  totalCost: null,
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
                      costUSD: number | null;
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
                totalCost: null,
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
                  totalCost: null,
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
          const sessionId = this.validateSessionId(params.sessionId);
          const upToMessageId =
            params.upToMessageId !== undefined
              ? this.validateUserMessageId(params.upToMessageId)
              : undefined;
          const title = this.sanitizeForkTitle(params.title);
          const kind =
            params.kind === 'rewind' || params.kind === 'branch'
              ? params.kind
              : undefined;
          await this.authorizeSessionAccess(sessionId);

          this.logger.debug('RPC: session:forkSession called', {
            sessionId,
            upToMessageId,
            title,
            kind,
          });

          const result = await this.sdkAdapter.forkSession(
            sessionId as SessionId,
            upToMessageId,
            title,
            kind,
          );
          return { newSessionId: result.sessionId as SessionId };
        } catch (error) {
          const errorObj =
            error instanceof Error ? error : new Error(String(error));
          if (
            error instanceof SdkError &&
            errorObj.message.includes(MESSAGE_ID_NOT_FOUND_PHRASE)
          ) {
            this.logger.warn(
              'RPC: session:forkSession upToMessageId not found in history',
              { message: errorObj.message },
            );
            throw new RpcUserError(errorObj.message, 'MESSAGE_ID_NOT_FOUND');
          }

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
   * If the session is inactive when the handler runs, we now call
   * `ChatSessionService.ensureSessionActiveForRewind` to transparently
   * resume it first (one attempt, no recursion) before delegating to the
   * SDK. Auto-resume failures are surfaced as the legacy
   * `session-not-active` error code so the existing frontend error path
   * still works — but the routine success path no longer requires the
   * frontend retry dance.
   */
  private registerRewindFiles(): void {
    this.rpcHandler.registerMethod<SessionRewindParams, SessionRewindResult>(
      'session:rewindFiles',
      async (params: SessionRewindParams) => {
        try {
          const sessionId = this.validateSessionId(params.sessionId);
          const userMessageId = this.validateUserMessageId(
            params.userMessageId,
          );
          const dryRun = params.dryRun;
          await this.authorizeSessionAccess(sessionId);

          this.logger.debug('RPC: session:rewindFiles called', {
            sessionId,
            userMessageId,
            dryRun: dryRun ?? false,
          });

          if (!this.sdkAdapter.isSessionActive(sessionId as SessionId)) {
            const metadata = await this.metadataStore.get(sessionId);
            const workspacePath = metadata?.workspaceId;
            if (!workspacePath) {
              throw new Error(
                'session-not-active: cannot auto-resume — session metadata missing workspacePath',
              );
            }
            this.logger.info(
              'RPC: session:rewindFiles — session inactive, attempting auto-resume',
              { sessionId, workspacePath },
            );
            const outcome = await this.chatSession.ensureSessionActiveForRewind(
              sessionId as SessionId,
              sessionId,
              workspacePath,
            );
            if ('resumed' in outcome && outcome.resumed === false) {
              throw new Error(`session-not-active: ${outcome.error}`);
            }
          }

          const result = await this.sdkAdapter.rewindFiles(
            sessionId as SessionId,
            userMessageId,
            dryRun,
          );
          if (
            dryRun !== true &&
            Array.isArray(result.filesChanged) &&
            result.filesChanged.length > 0
          ) {
            const roots = this.getAuthorizedWorkspaceRoots();
            const escapingPaths: string[] = [];
            for (const p of result.filesChanged) {
              if (!path.isAbsolute(p)) {
                escapingPaths.push(p);
                continue;
              }
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
              throw err;
            }
          }
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
          if (error instanceof SessionNotActiveError) {
            throw new Error(`session-not-active: ${errorObj.message}`);
          }
          if (
            /is not active or has no live Query handle/i.test(errorObj.message)
          ) {
            throw new Error(`session-not-active: ${errorObj.message}`);
          }
          if (errorObj.message.startsWith('session-not-active:')) {
            throw errorObj;
          }
          if (errorObj.message.startsWith('unauthorized-path-rewrite:')) {
            throw errorObj;
          }
          this.sentryService.captureException(errorObj, {
            errorSource: 'SessionRpcHandlers.registerRewindFiles',
          });
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
