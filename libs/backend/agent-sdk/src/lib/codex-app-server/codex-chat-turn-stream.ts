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
import { CodexChatEvents, tokenUsage } from './codex-chat-events';

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
}

interface CodexChatTurnDependencies {
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
  let exhausted = false;
  const started = Date.now();
  let events: AsyncIterator<CodexRuntimeEvent> | undefined;
  let projection: CodexChatEvents | undefined;
  try {
    if (session.abort.signal.aborted) throw deps.error('unavailable', 'turn');
    const eventStream = session.context.events(subscription.signal);
    events = eventStream[Symbol.asyncIterator]();
    const receipt = await session.context.startTurn({
      ...input,
      signal: subscription.signal,
    });
    session.turnId = receipt.turnId;
    const turn = { ...session.context.identity, turnId: receipt.turnId };
    const callbacks = deps.callbacks(session.id, turn);
    projection = new CodexChatEvents(session.id, turn, {
      ...callbacks,
      result: (result) => {
        terminal = true;
        callbacks.result(result);
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
        if (event.type === 'compaction' && event.phase === 'started')
          deps.notifyCompaction(session, 'auto');
      }
      for (const mapped of mappedEvents) yield mapped;
      if (terminal) return;
    }
    throw deps.error('runtime-failed', 'stream');
  } catch (error) {
    throw deps.failure(error, 'turn');
  } finally {
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
      !session.closing
    ) {
      // A detached consumer must not release the latch before the server terminal.
      void drainInterruptedTurn(session, events, projection, deps).finally(
        release,
      );
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
): Promise<void> {
  try {
    await deps.interrupt(session.id);
    while (!session.abort.signal.aborted) {
      const next = await events.next();
      if (next.done) break;
      const mapped = projection.map(next.value);
      if (mapped.some((event) => event.eventType === 'message_complete')) return;
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
