import type { Logger } from '@ptah-extension/vscode-core';
import type {
  CodexContext,
  CodexReportedUsage,
  CodexRuntimeEvent,
  CodexTurnInput,
} from '@ptah-extension/codex-runtime';
import type {
  FlatStreamEventUnion,
  IAgentAdapter,
  SessionId,
} from '@ptah-extension/shared';
import { resolveContextCapacity } from '@ptah-extension/shared';
import type {
  CodexChatAdapterPorts,
  CodexChatScope,
} from './codex-chat-adapter';
import {
  CodexChatAdapterError,
  isCodexChatAdapterError,
} from './codex-chat-adapter-error';
import type { CodexChatApprovalSink } from './codex-chat-approval-sink';
import type { CodexChatAdmission } from './codex-chat-admission';
import {
  CODEX_FAILURE_NOTICE,
  CodexChatEvents,
  tokenUsage,
  type CodexChatResult,
} from './codex-chat-events';
import {
  toTurnStateEvent,
  type SessionTurnStateRegistry,
} from '../helpers/session-turn-state.registry';

export interface CodexChatSession {
  readonly id: SessionId;
  readonly token: string;
  readonly consumer?: 'chat' | 'gateway';
  readonly context: CodexContext;
  readonly sink: CodexChatApprovalSink;
  readonly scope: CodexChatScope;
  readonly abort: AbortController;
  usage?: CodexReportedUsage;
  /**
   * The adapter's tracked settings (TrackedSession.settings); the turn's
   * stats row reads the effective model from here. The adapter keeps the
   * object current across setSessionModel, so read it per turn.
   */
  settings?: { model?: string };
  busy: boolean;
  turnId?: string;
  blocked: boolean;
  pendingInterrupt?: boolean;
  stopRequested?: boolean;
  closing?: Promise<void>;
  compacting?: Promise<void>;
}

function failureNotice(
  session: CodexChatSession,
  turnId: string | undefined,
): FlatStreamEventUnion[] {
  if (session.consumer === 'gateway') return [];
  const messageId = `codex-error:${session.id}:${turnId ?? 'start'}`;
  const base = {
    timestamp: Date.now(),
    sessionId: session.id,
    source: 'complete' as const,
    messageId,
  };
  return [
    {
      ...base,
      id: `${messageId}:start`,
      eventType: 'message_start',
      role: 'assistant',
    },
    {
      ...base,
      id: `${messageId}:text`,
      eventType: 'text_delta',
      delta: CODEX_FAILURE_NOTICE,
      blockIndex: 0,
    },
  ];
}

interface CodexChatTurnDependencies {
  readonly turnState: Pick<
    SessionTurnStateRegistry,
    'markGenerating' | 'settleTurn' | 'recordFailure' | 'forceIdle'
  >;
  readonly logger: Logger;
  completedTurn(id: SessionId): Promise<void>;
  callbacks: CodexChatAdapterPorts['callbacks'];
  stats: Parameters<IAgentAdapter['setResultStatsCallback']>[0];
  interrupt(id: SessionId): Promise<boolean>;
  close(session: CodexChatSession): Promise<void>;
  notifyCompaction(session: CodexChatSession, trigger: 'auto'): void;
  error(
    code: CodexChatAdapterError['code'],
    operation: string,
  ): CodexChatAdapterError;
  failure(error: unknown, operation: string): CodexChatAdapterError;
  onIdle(session: CodexChatSession): void;
  readonly admission?: CodexChatAdmission;
}

export async function* streamCodexChatTurn(
  session: CodexChatSession,
  input: CodexTurnInput,
  deps: CodexChatTurnDependencies,
  clientMessageId?: string,
  inboundPeer?: { readonly label: string },
): AsyncGenerator<FlatStreamEventUnion> {
  if (session.busy) throw deps.error('busy', 'turn');
  if (session.blocked || session.closing) throw deps.error('unavailable', 'turn');
  session.busy = true;
  const subscription = new AbortController();
  const abort = () => subscription.abort();
  session.abort.signal.addEventListener('abort', abort, { once: true });
  let terminal = false;
  let terminalStatus: CodexChatResult['status'] | undefined;
  let countedCompletedTurn = false;
  let turnSettled = false;
  const settleTurn = () => {
    if (turnSettled || terminalStatus === undefined) return;
    turnSettled = true;
    if (terminalStatus === 'failed') {
      deps.turnState.recordFailure(session.id, {
        error: 'unknown',
        terminalReason: null,
      });
      return deps.turnState.settleTurn(session.id);
    }
    return deps.turnState.settleTurn(
      session.id,
      terminalStatus === 'completed' ? 'completed' : 'aborted_streaming',
    );
  };
  let exhausted = false;
  const started = Date.now();
  let events: AsyncIterator<CodexRuntimeEvent> | undefined;
  let projection: CodexChatEvents | undefined;
  let errorPresented = false;
  let failureNoticeEmitted = false;
  let terminalStateEmitted = false;
  let compactionActive = false;
  let admitted = false;
  let finishCompaction: (() => void) | undefined;
  try {
    if (session.abort.signal.aborted) throw deps.error('cancelled', 'turn');
    const eventStream = session.context.events(subscription.signal);
    events = eventStream[Symbol.asyncIterator]();
    const receipt = await session.context.startTurn({
      ...input,
      signal: subscription.signal,
    });
    session.turnId = receipt.turnId;
    admitted = true;
    deps.admission?.accepted();
    const turn = { ...session.context.identity, turnId: receipt.turnId };
    const callbacks = deps.callbacks(session.id, turn);
    finishCompaction = () => {
      if (!compactionActive) return;
      compactionActive = false;
      callbacks.compaction('failed');
    };
    projection = new CodexChatEvents(session.id, turn, {
      ...callbacks,
      error: (message) => {
        errorPresented = true;
        return callbacks.error(message, session.context.identity.workspaceId);
      },
      compaction: (phase) => {
        if (phase === 'started') {
          if (!compactionActive) {
            compactionActive = true;
            deps.notifyCompaction(session, 'auto');
          }
        } else {
          compactionActive = false;
          callbacks.compaction(phase);
        }
      },
      result: async (result) => {
        terminal = true;
        terminalStatus = result.status;
        if (
          result.status === 'completed' &&
          !result.error &&
          !countedCompletedTurn
        ) {
          countedCompletedTurn = true;
          // The sessions-rail count is metadata; a failed write must never
          // block or fail the turn result itself.
          try {
            await deps.completedTurn(session.id);
          } catch (error) {
            deps.logger.warn(
              '[CodexChatAdapter] message-count-write-failed: completed turn not counted.',
              { error: error instanceof Error ? error.message : String(error) },
            );
          }
        }
        await callbacks.result(result);
        const usage = result.usage;
        if (
          usage?.inputTokens !== undefined &&
          usage.outputTokens !== undefined
        ) {
          const tokens = tokenUsage(usage);
          const model = session.settings?.model;
          const contextCapacity = model
            ? resolveContextCapacity({
                route: { kind: 'native', providerId: null },
                model,
                sdkContextWindow: usage.modelContextWindow,
              })
            : undefined;
          deps.stats({
            sessionId: session.id,
            turnCost: null,
            tokens,
            duration: Date.now() - started,
            ...(model && contextCapacity
              ? {
                  // The same per-model row the Claude path sends, from native
                  // data only: cost stays null (Codex reports no pricing) and
                  // an unknown window reads 0 while contextCapacity says
                  // 'unknown', so the header renders an explicit unknown
                  // context, never a wrong percentage.
                  modelUsage: [
                    {
                      model,
                      inputTokens: tokens.input,
                      outputTokens: tokens.output,
                      contextWindow: contextCapacity.tokens ?? 0,
                      contextCapacity,
                      costUSD: null,
                      cacheReadInputTokens: tokens.cacheRead ?? 0,
                      ...(usage.lastRequestTotalTokens !== undefined
                        ? {
                            lastTurnContextTokens:
                              usage.lastRequestTotalTokens,
                          }
                        : {}),
                    },
                  ],
                }
              : {}),
          });
        }
      },
    });
    if (inboundPeer) {
      const messageId = 'codex-peer:' + session.id + ':' + receipt.turnId;
      const timestamp = Date.now();
      yield {
        id: messageId + ':start',
        eventType: 'message_start',
        timestamp,
        sessionId: session.id,
        source: 'complete',
        messageId,
        role: 'user',
        inboundPeer,
      };
      yield {
        id: messageId + ':text',
        eventType: 'text_delta',
        timestamp,
        sessionId: session.id,
        source: 'complete',
        messageId,
        delta: input.text,
        blockIndex: 0,
      };
      yield {
        id: messageId + ':complete',
        eventType: 'message_complete',
        timestamp,
        sessionId: session.id,
        source: 'complete',
        messageId,
      };
    } else if (clientMessageId !== undefined) {
      yield {
        id: `codex-user:${session.id}:${receipt.turnId}`,
        eventType: 'message_start',
        timestamp: Date.now(),
        sessionId: session.id,
        source: 'complete',
        messageId: clientMessageId,
        role: 'user',
        clientMessageId,
      };
    }
    if (session.pendingInterrupt) {
      session.pendingInterrupt = false;
      const accepted = await deps.interrupt(session.id);
      if (!accepted) throw deps.error('runtime-failed', 'interrupt');
      if (session.stopRequested) session.sink.endTurn(session.id, receipt.turnId);
    }
    while (true) {
      const next = await events.next();
      if (next.done) {
        exhausted = true;
        break;
      }
      const event = next.value;
      if (subscription.signal.aborted) break;
      if (session.stopRequested) {
        if (
          event.type === 'terminal' &&
          event.contextId === session.context.identity.contextId &&
          event.processGeneration === session.context.identity.processGeneration &&
          event.threadId === session.id &&
          event.turnId === receipt.turnId
        ) {
          terminal = true;
          // The runtime synthesizes a failed terminal when its 30 s
          // interrupt timer closes a context that never answered.
          if (event.status === 'failed' && !session.closing)
            await deps.close(session);
          throw deps.error('cancelled', 'turn');
        }
        continue;
      }
      const mappedEvents = projection.map(event);
      if (
        event.contextId === session.context.identity.contextId &&
        event.processGeneration === session.context.identity.processGeneration &&
        event.threadId === session.id &&
        event.turnId === receipt.turnId
      ) {
        if (event.type === 'usage') session.usage = event.usage;
        if (event.type === 'terminal' && event.usage) session.usage = event.usage;
      }
      let terminalError: CodexChatAdapterError | undefined;
      try {
        await projection.settled();
      } catch (error) {
        if (event.type !== 'terminal' || !isCodexChatAdapterError(error)) throw error;
        terminalError = error;
      }
      if (terminalError && terminalError.code !== 'cancelled' && !failureNoticeEmitted) {
        failureNoticeEmitted = true;
        yield* failureNotice(session, receipt.turnId);
      }
      for (const mapped of mappedEvents) {
        // message_complete makes the broadcaster publish a successful chat:complete.
        // Failed and interrupted terminals settle through turn_state instead.
        if (terminalError && mapped.eventType === 'message_complete') {
          const settled = settleTurn();
          if (settled) {
            terminalStateEmitted = true;
            yield {
              ...toTurnStateEvent(session.id, settled),
              ...(clientMessageId === undefined ? {} : { consumedClientMessageId: clientMessageId }),
            };
          }
          continue;
        }
        if (mapped.eventType === 'message_start' && !mapped.parentToolUseId) {
          const generating = deps.turnState.markGenerating(session.id);
          if (generating) yield toTurnStateEvent(session.id, generating);
        }
        yield mapped;
        if (mapped.eventType === 'message_complete') {
          const settled = settleTurn();
          if (settled) {
            terminalStateEmitted = true;
            yield {
              ...toTurnStateEvent(session.id, settled),
              ...(clientMessageId === undefined ? {} : { consumedClientMessageId: clientMessageId }),
            };
          }
        }
      }
      if (terminalError) throw terminalError;
      if (terminal) return;
    }
    throw deps.error('runtime-failed', 'stream');
  } catch (error) {
    const interrupted = session.abort.signal.aborted || session.stopRequested ||
      (isCodexChatAdapterError(error) && error.code === 'cancelled');
    const failure = interrupted ? deps.error('cancelled', 'turn') : deps.failure(error, 'turn');
    if (!interrupted && !failureNoticeEmitted) {
      failureNoticeEmitted = true;
      yield* failureNotice(session, session.turnId);
    }
    if (!terminalStateEmitted) {
      terminalStatus = interrupted ? 'interrupted' : 'failed';
      const settled = settleTurn();
      if (settled) yield {
        ...toTurnStateEvent(session.id, settled),
        ...(clientMessageId === undefined ? {} : { consumedClientMessageId: clientMessageId }),
      };
    }
    if (!interrupted) {
      if (!errorPresented) {
        void Promise.resolve()
          .then(() => deps.callbacks(session.id, undefined).error(
            CODEX_FAILURE_NOTICE, session.context.identity.workspaceId,
          ))
          .catch((publicationError: unknown) => {
            deps.logger.error(
              '[CodexChatAdapter] Failed to publish turn error.',
              publicationError instanceof Error
                ? publicationError
                : new Error(String(publicationError)),
            );
          });
      }
      if (!session.closing) await deps.close(session);
    } else if (session.stopRequested && !terminal && !session.closing) {
      await deps.close(session);
    }
    const reported = interrupted ? failure : new CodexChatAdapterError(
      failure.code,
      failure.operation,
      { cause: failure, webviewReported: true },
    );
    // The notice and failed turn state are already in the stream. Let the
    // broadcaster finish before the RPC takes its settled reply path.
    if (!admitted && !interrupted && session.consumer === 'chat')
      deps.admission?.ended();
    else if (!admitted) deps.admission?.rejected(reported);
    throw reported;
  } finally {
    finishCompaction?.();
    // A consumer can detach between message_complete and its settlement event.
    if (terminal) settleTurn();
    if (session.turnId) session.sink.endTurn(session.id, session.turnId);
    const release = () => {
      subscription.abort();
      session.abort.signal.removeEventListener('abort', abort);
      session.busy = false;
      session.turnId = undefined;
      session.blocked = false;
      session.pendingInterrupt = false;
      session.stopRequested = false;
      deps.onIdle(session);
    };
    if (
      !terminal &&
      !exhausted &&
      session.turnId &&
      events &&
      projection &&
      !session.closing &&
      !session.abort.signal.aborted
    ) {
      // A detached consumer must not release the latch before the server terminal.
      void drainInterruptedTurn(
        session,
        events,
        projection,
        deps,
        settleTurn,
      ).finally(release);
    } else {
      release();
      try {
        await events?.return?.();
      } catch (error) {
        deps.logger.error(
          '[CodexChatAdapter] runtime-failed: event subscription cleanup.',
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
  }
}
async function drainInterruptedTurn(
  session: CodexChatSession,
  events: AsyncIterator<CodexRuntimeEvent>,
  projection: CodexChatEvents,
  deps: CodexChatTurnDependencies,
  settleTurn: () => ReturnType<SessionTurnStateRegistry['settleTurn']> | undefined,
): Promise<void> {
  let terminal = false;
  try {
    if (!session.stopRequested) await deps.interrupt(session.id);
    while (!session.abort.signal.aborted) {
      const next = await events.next();
      if (next.done) break;
      if (session.stopRequested) {
        if (
          next.value.type === 'terminal' &&
          next.value.contextId === session.context.identity.contextId &&
          next.value.processGeneration === session.context.identity.processGeneration &&
          next.value.threadId === session.id &&
          next.value.turnId === session.turnId
        ) {
          terminal = true;
          if (next.value.status === 'failed') await deps.close(session);
          return;
        }
        continue;
      }
      const mapped = projection.map(next.value);
      try {
        await projection.settled();
      } catch (error) {
        // The terminal itself rejects settlement (interrupted -> cancelled,
        // failed -> runtime-failed). Both are an expected end of the drained
        // turn: settle it as before. Any other error takes the cleanup path.
        if (
          next.value.type === 'terminal' &&
          isCodexChatAdapterError(error) &&
          (error.code === 'cancelled' || error.code === 'runtime-failed')
        ) {
          settleTurn();
          if (error.code === 'runtime-failed') await deps.close(session);
          terminal = true;
          return;
        }
        throw error;
      }
      if (mapped.some((event) => event.eventType === 'message_complete')) {
        settleTurn();
        terminal = true;
        return;
      }
    }
    // Without a terminal, close the context before permitting another turn.
    await deps.close(session);
  } catch (error) {
    deps.logger.error(
      '[CodexChatAdapter] runtime-failed: detached turn cleanup.',
      error instanceof Error ? error : new Error(String(error)),
    );
    try {
      await deps.close(session);
    } catch (error) {
      deps.logger.error(
        '[CodexChatAdapter] runtime-failed: detached context cleanup.',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  } finally {
    if (!terminal) deps.turnState.forceIdle(session.id, 'aborted_streaming');
    if (session.turnId) session.sink.endTurn(session.id, session.turnId);
    try {
      await events.return?.();
    } catch (error) {
      deps.logger.error(
        '[CodexChatAdapter] runtime-failed: event subscription cleanup.',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
}
