/**
 * Subagent RPC Handlers
 *
 * Handles subagent-related RPC methods.
 *
 * RPC Methods:
 * - chat:subagent-query    — Query subagents (resumable or by specific ID)
 * - chat:dismiss-resumable-subagents — Hide interrupted subagents from the
 *                            resume banner (the model still hears once)
 * - subagent:send-message  — Push a user message into a running subagent
 * - subagent:stop          — Stop a specific subagent by taskId
 * - subagent:interrupt     — Interrupt the entire session
 * - subagent:background    — Move in-flight foreground task(s) to background
 * - subagent:history-page  — Read a bounded page of structured subagent history
 *
 * NOTE: The chat:subagent-resume RPC has been removed.
 * Subagent resumption is now handled via context injection in chat:continue,
 * allowing Claude to naturally resume interrupted agents through conversation.
 */

import { injectable, inject } from 'tsyringe';
import {
  Logger,
  RpcHandler,
  RpcUserError,
  TOKENS,
  SubagentRegistryService,
} from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  computeSubagentCacheState,
  resolveSubagentPromptCacheTtl,
  SubagentRecord,
  SubagentQueryParams,
  SubagentQueryResult,
  SubagentSendMessageParams,
  SubagentStopParams,
  SubagentInterruptParams,
  SubagentBackgroundParams,
  SubagentBackgroundResult,
  SubagentCommandResult,
  SubagentHistoryPageParams,
  SubagentHistoryPageResult,
  ChatDismissResumableSubagentsParams,
  ChatDismissResumableSubagentsResult,
  SessionId,
  type FlatStreamEventUnion,
} from '@ptah-extension/shared';
import type { RpcMethodName } from '@ptah-extension/shared';
import {
  SDK_TOKENS,
  SubagentHistoryValidationError,
  retainSubagentEventsTail,
} from '@ptah-extension/agent-sdk';
import type {
  SubagentMessageDispatcher,
  SessionHistoryReaderService,
  SessionMetadataStore,
} from '@ptah-extension/agent-sdk';
import {
  assembleHistoryPage,
  parseHistoryCursor,
} from './subagent-history-page';
import { CHAT_TOKENS } from '../chat/tokens';
import type { ChatHistoryReadService } from '../chat/session/chat-history-read.service';
import {
  SubagentQuerySchema,
  DismissResumableSubagentsSchema,
  SubagentSendMessageSchema,
  SubagentStopSchema,
  SubagentInterruptSchema,
  SubagentBackgroundSchema,
  SubagentHistoryPageSchema,
} from './subagent-rpc.schema';

/**
 * RPC handlers for subagent operations
 *
 * @example
 * ```typescript
 * // Frontend: Query all resumable subagents
 * const { subagents } = await rpcService.call('chat:subagent-query', {});
 *
 * // Frontend: Send message to subagent
 * await rpcService.call('subagent:send-message', { sessionId, parentToolUseId, text: 'hello' });
 *
 * // Frontend: Stop a specific subagent
 * await rpcService.call('subagent:stop', { sessionId, taskId });
 *
 * // Frontend: Interrupt the whole session
 * await rpcService.call('subagent:interrupt', { sessionId });
 *
 * // Frontend: Push in-flight foreground task(s) to the background
 * const { backgrounded } = await rpcService.call('subagent:background', { sessionId, toolUseId });
 *
 * ```
 */
@injectable()
export class SubagentRpcHandlers {
  private readonly nativeHistoryCache = new Map<string, {
    events: readonly FlatStreamEventUnion[];
    expiresAt: number;
  }>();
  private readonly nativeHistoryInFlight = new Map<string, Promise<readonly FlatStreamEventUnion[]>>();
  private nativeHistoryUnavailableWarned = false;
  private static readonly NATIVE_CACHE_TTL_MS = 15_000;
  private static readonly NATIVE_CACHE_MAX = 8;
  static readonly METHODS = [
    'chat:subagent-query',
    'chat:dismiss-resumable-subagents',
    'subagent:send-message',
    'subagent:stop',
    'subagent:interrupt',
    'subagent:background',
    'subagent:history-page',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.SUBAGENT_REGISTRY_SERVICE)
    private readonly registry: SubagentRegistryService,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
    @inject(SDK_TOKENS.SDK_SUBAGENT_MESSAGE_DISPATCHER)
    private readonly dispatcher: SubagentMessageDispatcher,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(SDK_TOKENS.SDK_SESSION_HISTORY_READER)
    private readonly historyReader: SessionHistoryReaderService,
    @inject(SDK_TOKENS.SDK_SESSION_METADATA_STORE)
    private readonly sessionMetadataStore: SessionMetadataStore,
    @inject(CHAT_TOKENS.HISTORY_READ, { isOptional: true })
    private readonly nativeHistory?: Pick<ChatHistoryReadService, 'readForResume'>,
  ) {}

  private async nativeEvents(sessionId: SessionId): Promise<readonly FlatStreamEventUnion[]> {
    const now = Date.now();
    const cached = this.nativeHistoryCache.get(sessionId);
    if (cached && cached.expiresAt > now) {
      this.nativeHistoryCache.delete(sessionId);
      this.nativeHistoryCache.set(sessionId, cached);
      return cached.events;
    }
    this.nativeHistoryCache.delete(sessionId);
    if (!this.nativeHistory) return [];
    const inFlight = this.nativeHistoryInFlight.get(sessionId);
    if (inFlight) return inFlight;
    // A child may precede the parent's compaction boundary. Keep the complete
    // snapshot for all pages so cursor positions cannot shift mid-read.
    const read = this.nativeHistory.readForResume(sessionId, {
      includeCompactedEvents: true,
    }).then((history) => {
      const events = history.events;
      this.nativeHistoryCache.set(sessionId, {
        events,
        expiresAt: Date.now() + SubagentRpcHandlers.NATIVE_CACHE_TTL_MS,
      });
      while (this.nativeHistoryCache.size > SubagentRpcHandlers.NATIVE_CACHE_MAX) {
        const oldest = this.nativeHistoryCache.keys().next().value;
        if (oldest === undefined) break;
        this.nativeHistoryCache.delete(oldest);
      }
      return events;
    });
    this.nativeHistoryInFlight.set(sessionId, read);
    try {
      return await read;
    } finally {
      this.nativeHistoryInFlight.delete(sessionId);
    }
  }

  private async readNativeChild(
    sessionId: string,
    toolCallId: string,
    agentId?: string,
  ): Promise<{
    readonly events: FlatStreamEventUnion[];
    readonly agentId: string | null;
    readonly truncated: boolean;
    readonly start?: Extract<FlatStreamEventUnion, { eventType: 'agent_start' }>;
  } | null> {
    const metadata = await this.sessionMetadataStore.get(sessionId);
    if (metadata?.codexExecution?.runtime !== 'codex-app-server') return null;
    const id = SessionId.safeParse(sessionId);
    if (!id) {
      this.logger.warn('RPC: native child history has invalid session identity', { sessionId });
      return { events: [], agentId: null, truncated: false };
    }
    if (!this.nativeHistory) {
      if (!this.nativeHistoryUnavailableWarned) {
        this.nativeHistoryUnavailableWarned = true;
        this.logger.warn('RPC: native child history reader is unbound', { sessionId });
      }
      return { events: [], agentId: null, truncated: false };
    }
    const eventsForSession = await this.nativeEvents(id);
    const start = eventsForSession.find(
      (event) =>
        event.eventType === 'agent_start' &&
        event.toolCallId === toolCallId &&
        (!agentId || event.agentId === agentId),
    );
    if (!start || start.eventType !== 'agent_start') {
      this.nativeHistoryCache.delete(id);
      this.logger.warn('RPC: native child missing from full history', {
        sessionId, toolCallId, reason: 'No matching agent_start in complete session events',
      });
      return { events: [], agentId: null, truncated: false };
    }
    const events = eventsForSession.filter(
      (event) =>
        event.parentToolUseId === toolCallId &&
        event.eventType !== 'agent_start',
    );
    if (events.length === 0) this.nativeHistoryCache.delete(id);
    return { agentId: start.agentId ?? null, start, ...retainSubagentEventsTail(events) };
  }

  /**
   * Register all subagent RPC methods
   */
  register(): void {
    this.registerSubagentQuery();
    this.registerDismissResumable();
    this.registerSendMessage();
    this.registerStop();
    this.registerInterrupt();
    this.registerBackground();
    this.registerHistoryPage();

    this.logger.debug('Subagent RPC handlers registered', {
      methods: SubagentRpcHandlers.METHODS,
    });
  }

  /**
   * chat:subagent-query - Query subagents from the registry
   *
   * Supports three query modes:
   * 1. By toolCallId: Returns specific subagent record
   * 2. By sessionId: Returns resumable subagents for a specific session
   * 3. No params: Returns all resumable subagents
   *
   * @returns Array of matching SubagentRecord objects
   */
  private registerSubagentQuery(): void {
    this.rpcHandler.registerMethod<SubagentQueryParams, SubagentQueryResult>(
      'chat:subagent-query',
      async (params) => {
        try {
          // Shape validation only — see SubagentQuerySchema. The empty-id rule
          // below is this handler's, not Zod's. Parsing inside this try is
          // deliberate: the catch returns `{ subagents: [] }` and captures to
          // Sentry, so a malformed param yields an empty list plus one Sentry
          // event rather than a thrown RPC.
          const { toolCallId, sessionId } = SubagentQuerySchema.parse(params);

          this.logger.debug('RPC: subagent:query called', {
            toolCallId,
            sessionId,
          });
          if (toolCallId) {
            const record = this.registry.get(toolCallId);
            if (!record && sessionId) {
              const native = await this.readNativeChild(sessionId, toolCallId);
              if (native?.agentId && native.events.length > 0 && native.start) {
                const start = native.start;
                return {
                  subagents: this.withCacheInfo([{
                    toolCallId,
                    agentType: start.agentType,
                    status: 'completed',
                    startedAt: start.timestamp,
                    parentSessionId: sessionId,
                    agentId: native.agentId,
                  }]),
                };
              }
            }
            // A dismissed record is owed to the model, not to the webview.
            return {
              subagents: this.withCacheInfo(
                record && !record.dismissed ? [record] : [],
              ),
            };
          }
          // A sessionId that is present but empty is a scoped query whose
          // scope cannot be resolved — answer with nothing. Falling through to
          // the unscoped branch offered this session the chance to resume
          // another session's interrupted subagents.
          if (sessionId !== undefined) {
            if (sessionId === '') {
              this.logger.warn(
                'RPC: subagent:query received an empty sessionId — returning no subagents',
              );
              return { subagents: [] };
            }
            const subagents = this.registry.getResumableBySession(sessionId);
            this.logger.debug('RPC: subagent:query by session result', {
              sessionId,
              count: subagents.length,
            });
            return { subagents: this.withCacheInfo(subagents) };
          }
          const subagents = this.registry.getResumable();
          this.logger.debug('RPC: subagent:query all resumable result', {
            count: subagents.length,
          });
          return { subagents: this.withCacheInfo(subagents) };
        } catch (error) {
          this.logger.error(
            'RPC: subagent:query failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'SubagentRpcHandlers.registerSubagentQuery' },
          );
          return { subagents: [] };
        }
      },
    );
  }

  /**
   * chat:dismiss-resumable-subagents - Dismiss the resume banner for good.
   *
   * Marks the session's interrupted records dismissed in the registry and in
   * the durable resume snapshot. They disappear from every webview read but
   * are still described to the model once, on the next chat:continue, which
   * then retires them.
   */
  private registerDismissResumable(): void {
    this.rpcHandler.registerMethod<
      ChatDismissResumableSubagentsParams,
      ChatDismissResumableSubagentsResult
    >('chat:dismiss-resumable-subagents', async (params) => {
      try {
        const { sessionId, toolCallIds } =
          DismissResumableSubagentsSchema.parse(params);
        const dismissed = this.registry.dismissResumable(
          sessionId,
          toolCallIds,
        );
        if (dismissed.length > 0) {
          await this.sessionMetadataStore.dismissResumableSubagents(
            sessionId,
            dismissed,
          );
        }
        return { success: true };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.error('RPC: chat:dismiss-resumable-subagents failed', err);
        this.sentryService.captureException(err, {
          errorSource: 'SubagentRpcHandlers.registerDismissResumable',
        });
        return { success: false, error: err.message };
      }
    });
  }

  /**
   * Attach each record's prompt-cache state, measured against the TTL the SDK
   * uses for subagents (setting plus host env override; subagent-capable
   * sessions, as every session that produced a subagent record is).
   */
  private withCacheInfo(
    records: readonly SubagentRecord[],
  ): SubagentQueryResult['subagents'] {
    if (records.length === 0) {
      return [];
    }
    const { effective } = resolveSubagentPromptCacheTtl({
      setting: this.workspace.getConfiguration<unknown>(
        'ptah',
        'agentOrchestration.subagentPromptCacheTtl',
        'auto',
      ),
      envValue: process.env['CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL'],
      canSpawnSubagents: true,
    });
    const now = Date.now();
    return records.map((record) => ({
      ...record,
      cacheInfo: computeSubagentCacheState(
        record.lastActivityAt,
        effective,
        now,
      ),
    }));
  }

  /**
   * subagent:send-message — Push a user message into a running subagent.
   *
   * Uses the SDK's streamInput channel with parent_tool_use_id set so the
   * message is routed to the correct subagent rather than the root coordinator.
   */
  private registerSendMessage(): void {
    this.rpcHandler.registerMethod<
      SubagentSendMessageParams,
      SubagentCommandResult
    >('subagent:send-message', async (params) => {
      const parsed = SubagentSendMessageSchema.safeParse(params);
      if (!parsed.success) {
        throw new RpcUserError(
          `subagent:send-message: invalid params — ${parsed.error.message}`,
          'INVALID_PARAMS',
        );
      }

      const { sessionId, parentToolUseId, text } = parsed.data;

      this.logger.debug('RPC: subagent:send-message called', {
        sessionId,
        parentToolUseId,
        textLength: text.length,
      });

      await this.dispatcher.sendToSubagent(sessionId, parentToolUseId, text);
      return { ok: true };
    });
  }

  /**
   * subagent:stop — Gracefully stop a specific subagent.
   *
   * Calls Query.stopTask(taskId). The SDK writes the subagent's output to
   * its output_file and emits a task_notification with status='stopped'.
   */
  private registerStop(): void {
    this.rpcHandler.registerMethod<SubagentStopParams, SubagentCommandResult>(
      'subagent:stop',
      async (params) => {
        const parsed = SubagentStopSchema.safeParse(params);
        if (!parsed.success) {
          throw new RpcUserError(
            `subagent:stop: invalid params — ${parsed.error.message}`,
            'INVALID_PARAMS',
          );
        }

        const { sessionId, taskId } = parsed.data;

        this.logger.debug('RPC: subagent:stop called', { sessionId, taskId });

        await this.dispatcher.stopSubagent(sessionId, taskId);
        return { ok: true };
      },
    );
  }

  /**
   * subagent:interrupt — Interrupt the entire session, stopping all subagents.
   */
  private registerInterrupt(): void {
    this.rpcHandler.registerMethod<
      SubagentInterruptParams,
      SubagentCommandResult
    >('subagent:interrupt', async (params) => {
      const parsed = SubagentInterruptSchema.safeParse(params);
      if (!parsed.success) {
        throw new RpcUserError(
          `subagent:interrupt: invalid params — ${parsed.error.message}`,
          'INVALID_PARAMS',
        );
      }

      const { sessionId } = parsed.data;

      this.logger.debug('RPC: subagent:interrupt called', { sessionId });

      await this.dispatcher.interruptSession(sessionId);
      return { ok: true };
    });
  }

  /**
   * subagent:background — Move in-flight foreground task(s) to the background.
   *
   * Calls Query.backgroundTasks(toolUseId) (Ctrl+B parity). With no toolUseId,
   * all foreground tasks are backgrounded; with a toolUseId, only that task is
   * targeted and `backgrounded` is false when the id matched no foreground task.
   */
  private registerBackground(): void {
    this.rpcHandler.registerMethod<
      SubagentBackgroundParams,
      SubagentBackgroundResult
    >('subagent:background', async (params) => {
      const parsed = SubagentBackgroundSchema.safeParse(params);
      if (!parsed.success) {
        throw new RpcUserError(
          `subagent:background: invalid params — ${parsed.error.message}`,
          'INVALID_PARAMS',
        );
      }

      const { sessionId, toolUseId } = parsed.data;

      this.logger.debug('RPC: subagent:background called', {
        sessionId,
        toolUseId,
      });

      const backgrounded = await this.dispatcher.backgroundTask(
        sessionId,
        toolUseId,
      );
      return { backgrounded };
    });
  }

  private registerHistoryPage(): void {
    this.rpcHandler.registerMethod<
      SubagentHistoryPageParams,
      SubagentHistoryPageResult
    >('subagent:history-page', async (params) => {
      const parsed = SubagentHistoryPageSchema.safeParse(params);
      if (!parsed.success)
        throw new RpcUserError(
          'Invalid agent history request',
          'INVALID_PARAMS',
        );
      const { sessionId, toolCallId, agentId, cursor, maxBytes } = parsed.data;
      const anchor = cursor === undefined ? null : parseHistoryCursor(cursor);
      if (cursor !== undefined && !anchor) {
        throw new RpcUserError(
          'Invalid agent history cursor',
          'INVALID_PARAMS',
        );
      }
      try {
        const native = await this.readNativeChild(sessionId, toolCallId, agentId);
        const read = native
          ? {
              status: native.events.length > 0 ? 'ok' as const : 'not-found' as const,
              ...native,
            }
          : await this.historyReader.readSubagentEvents(sessionId, toolCallId, agentId);
        if (read.status !== 'ok') {
          if (native) this.nativeHistoryCache.delete(sessionId);
          return assembleHistoryPage(
            [],
            0,
            read.status,
            read.agentId,
            read.truncated,
            maxBytes,
          );
        }
        const position = anchor
          ? read.events.findIndex(
              (event) =>
                event.id === anchor[0] && event.eventType === anchor[1],
            )
          : -1;
        if (anchor && position < 0) {
          if (native) this.nativeHistoryCache.delete(sessionId);
          throw new RpcUserError(
            'Agent history cursor expired; restart from the first page',
            'HISTORY_CURSOR_STALE',
          );
        }
        const start = position + 1;
        const page = assembleHistoryPage(
          read.events,
          start,
          read.status,
          read.agentId,
          read.truncated,
          maxBytes,
        );
        if (!page.done && page.nextCursor === cursor) {
          if (native) this.nativeHistoryCache.delete(sessionId);
          throw new RpcUserError(
            'Agent history cursor did not advance',
            'HISTORY_CURSOR_STALE',
          );
        }
        return page;
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        if (error instanceof SubagentHistoryValidationError) {
          throw new RpcUserError(
            'Invalid agent history request',
            'INVALID_PARAMS',
          );
        }
        this.logger.error(
          'RPC: subagent:history-page failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        throw new RpcUserError(
          'Could not read agent output',
          'PERSISTENCE_UNAVAILABLE',
        );
      }
    });
  }
}
