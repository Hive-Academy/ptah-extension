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
import type {
  CodexChatAdapterError,
  CodexChatAdapterPorts,
  CodexChatScope,
} from './codex-chat-adapter';
import type { CodexChatApprovalSink } from './codex-chat-approval-sink';
import {
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
  readonly context: CodexContext;
  readonly sink: CodexChatApprovalSink;
  readonly scope: CodexChatScope;
  readonly abort: AbortController;
  usage?: CodexReportedUsage;
  busy: boolean;
  turnId?: string;
  blocked: boolean;
  pendingInterrupt?: boolean;
  closing?: Promise<void>;
  compacting?: Promise<void>;
}

interface CodexChatTurnDependencies {
  readonly turnState: Pick<
    SessionTurnStateRegistry,
    'markGenerating' | 'settleTurn' | 'recordFailure' | 'forceIdle'
  >;
  readonly logger: Logger;
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
}

export async function* streamCodexChatTurn(
  session: CodexChatSession,
  input: CodexTurnInput,
  deps: CodexChatTurnDependencies,
): AsyncGenerator<FlatStreamEventUnion> {
  if (session.busy) throw deps.error('busy', 'turn');
  if (session.blocked || session.closing) throw deps.error('unavailable', 'turn');
  session.busy = true;
  const subscription = new AbortController();
  const abort = () => subscription.abort();
  session.abort.signal.addEventListener('abort', abort, { once: true });
  let terminal = false;
  let terminalStatus: CodexChatResult['status'] | undefined;
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
  let compactionActive = false;
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
    const turn = { ...session.context.identity, turnId: receipt.turnId };
    const callbacks = deps.callbacks(session.id, turn);
    finishCompaction = () => {
      if (!compactionActive) return;
      compactionActive = false;
      callbacks.compaction('failed');
    };
    projection = new CodexChatEvents(session.id, turn, {
      ...callbacks,
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
        await callbacks.result(result);
        const usage = result.usage;
        if (
          usage?.inputTokens !== undefined &&
          usage.outputTokens !== undefined
        )
          deps.stats({
            sessionId: session.id,
            turnCost: null,
            tokens: tokenUsage(usage),
            duration: Date.now() - started,
          });
      },
    });
    if (session.pendingInterrupt) {
      session.pendingInterrupt = false;
      await deps.interrupt(session.id);
    }
    while (true) {
      const next = await events.next();
      if (next.done) {
        exhausted = true;
        break;
      }
      const event = next.value;
      if (subscription.signal.aborted) break;
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
      await projection.settled();
      for (const mapped of mappedEvents) {
        if (mapped.eventType === 'message_start' && !mapped.parentToolUseId) {
          const generating = deps.turnState.markGenerating(session.id);
          if (generating) yield toTurnStateEvent(session.id, generating);
        }
        yield mapped;
        if (mapped.eventType === 'message_complete') {
          const settled = settleTurn();
          if (settled) yield toTurnStateEvent(session.id, settled);
        }
      }
      if (terminal) return;
    }
    throw deps.error('runtime-failed', 'stream');
  } catch (error) {
    if (session.abort.signal.aborted) throw deps.error('cancelled', 'turn');
    throw deps.failure(error, 'turn');
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
    await deps.interrupt(session.id);
    while (!session.abort.signal.aborted) {
      const next = await events.next();
      if (next.done) break;
      const mapped = projection.map(next.value);
      await projection.settled();
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
