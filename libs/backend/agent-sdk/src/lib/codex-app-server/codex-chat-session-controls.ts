import {
  CodexContextStateError,
  type CodexExecutionProfile,
} from '@ptah-extension/codex-runtime';
import {
  type IAgentAdapter,
  type SessionId,
  type FlatStreamEventUnion,
} from '@ptah-extension/shared';
import type { CodexChatSession as Session } from './codex-chat-turn-stream';
import type { CodexChatAdapterPorts } from './codex-chat-adapter';
import { CodexChatAdapterError } from './codex-chat-adapter-error';

export type TrackedSession = Session & {
  settings: Pick<CodexExecutionProfile, 'model' | 'effort' | 'permissionLevel'>;
};

interface SessionControlsDependencies {
  readonly sessions: Map<SessionId, TrackedSession>;
  readonly opening: Map<string, { cancelled: boolean }>;
  readonly ports: Pick<CodexChatAdapterPorts, 'sessions' | 'callbacks' | 'publish' | 'logger'>;
  session(id: SessionId): TrackedSession;
  unsupported(operation: string): never;
  failure(error: unknown, operation: string): CodexChatAdapterError;
  safe<T>(operation: string, action: () => Promise<T>): Promise<T>;
  close(session: Session): Promise<void>;
  interruptCurrentTurn(id: SessionId): Promise<boolean>;
  compactionStart(): Parameters<IAgentAdapter['setCompactionStartCallback']>[0] | undefined;
}

/** Session lifecycle and native controls; the adapter retains the public surface. */
export class CodexChatSessionControls {
  constructor(private readonly deps: SessionControlsDependencies) {}

  notifyCompaction(session: Session, trigger: 'manual' | 'auto'): void {
    const preTokens = session.usage?.lastRequestTotalTokens;
    if (preTokens === undefined) {
      this.deps.ports.logger.debug(
        '[CodexChatAdapter] Compaction start skipped: native last-request usage unavailable.',
      );
      return;
    }
    this.deps.compactionStart()?.({
      sessionId: session.id,
      trigger,
      timestamp: Date.now(),
      preTokens,
    });
  }

  owns(id: SessionId): boolean {
    return this.deps.sessions.has(id) || this.deps.opening.has(id);
  }
  isSessionActive(id: SessionId): boolean {
    return this.deps.sessions.has(id) || this.deps.opening.get(id)?.cancelled === false;
  }
  canSendFollowUp(id: SessionId): boolean {
    const session = this.deps.sessions.get(id);
    return !!session && !session.busy && !session.blocked && !session.closing;
  }
  getSessionToken(id: SessionId): string | null {
    return this.deps.sessions.get(id)?.token ?? null;
  }
  endSession(id: SessionId): void {
    const opening = this.deps.opening.get(id);
    if (opening) opening.cancelled = true;
    const session = this.deps.sessions.get(id);
    if (session)
      void this.deps.close(session).catch((error) => {
        this.deps.failure(error, 'cleanup');
        this.deps.ports
          .callbacks(id, undefined)
          .error('[CodexChatAdapter] runtime-failed: cleanup.');
      });
  }
  /** Explicit teardown for commands that must finish closing before returning. */
  async closeSession(id: SessionId): Promise<void> {
    const opening = this.deps.opening.get(id);
    if (opening) opening.cancelled = true;
    const session = this.deps.sessions.get(id);
    if (session) await this.deps.close(session);
  }
  /** Stream exit keeps the native thread; explicit teardown closes it. */
  async endSessionIfTokenMatches(_id: SessionId, _token: string): Promise<boolean> {
    return false;
  }
  close(session: Session): Promise<void> {
    if (session.closing) return session.closing;
    if (this.deps.sessions.get(session.id) === session) {
      this.deps.sessions.delete(session.id);
      this.deps.ports.sessions?.closed(session.id);
    }
    session.busy = false;
    session.blocked = false;
    if (session.turnId) session.sink.endTurn(session.id, session.turnId);
    session.abort.abort();
    session.sink.dispose();
    session.closing = this.deps.safe('close', async () => {
      try {
        await session.context.close();
      } finally {
        await session.scope.dispose();
      }
    });
    return session.closing;
  }
  async interruptCurrentTurn(id: SessionId): Promise<boolean> {
    const session = this.deps.session(id);
    const turnId = session.turnId;
    if (!turnId) {
      session.pendingInterrupt = session.busy;
      session.blocked = session.busy;
      return session.pendingInterrupt;
    }
    session.blocked = true;
    const accepted = await this.deps.safe('interrupt', () =>
      session.context.interrupt(turnId),
    );
    if (accepted) session.blocked = false;
    return accepted;
  }
  async interruptSession(id: SessionId): Promise<void> {
    const opening = this.deps.opening.get(id);
    if (opening) {
      opening.cancelled = true;
      return;
    }
    const session = this.deps.sessions.get(id);
    if (!session || !session.busy || session.stopRequested) return;
    session.stopRequested = true;
    try {
      const accepted = await this.deps.interruptCurrentTurn(id);
      if (!accepted) {
        if (!session.busy) return;
        this.deps.ports.logger.warn('[CodexChatAdapter] turn interrupt was refused; closing context.', { sessionId: id });
        await this.deps.close(session);
        return;
      }
      if (session.turnId) session.sink.endTurn(id, session.turnId);
    } catch (error) {
      await this.deps.close(session);
      throw error;
    }
  }
  async executeSlashCommand(
    ...[id, command]: Parameters<IAgentAdapter['executeSlashCommand']>
  ): Promise<AsyncIterable<FlatStreamEventUnion>> {
    if (command !== '/compact') this.deps.unsupported('slashCommand');
    const session = this.deps.session(id);
    if (session.busy) throw new CodexChatAdapterError('busy', 'compact');
    session.compacting ??= this.compact(session).finally(() => {
      session.compacting = undefined;
    });
    await session.compacting;
    return (async function* () {
      /* Compact has no assistant turn result. */
    })();
  }

  private async compact(session: Session): Promise<void> {
    this.notifyCompaction(session, 'manual');
    try {
      await this.deps.safe('compact', () => session.context.compact());
    } catch (error) {
      await this.deps.ports
        .callbacks(session.id, undefined)
        .error('Codex context compaction failed.');
      throw error;
    }
    await this.deps.ports.publish(
      session.id,
      (async function* (): AsyncGenerator<FlatStreamEventUnion> {
        const messageId = `codex-compaction:${session.id}:${Date.now()}`;
        yield {
          id: messageId,
          messageId,
          sessionId: session.id,
          timestamp: Date.now(),
          eventType: 'compaction_complete',
          trigger: 'manual',
        };
      })(),
    );
  }

  async setSessionPermissionLevel(
    ...[id, level]: Parameters<IAgentAdapter['setSessionPermissionLevel']>
  ): Promise<void> {
    if (
      level === 'default' ||
      level === 'acceptEdits' ||
      level === 'bypassPermissions'
    )
      this.deps.unsupported('permissionAlias');
    const session = this.deps.session(id);
    await this.deps.safe('permission', async () => {
      try {
        await session.context.updateNextTurn({ permissionLevel: level });
      } catch (error) {
        if (error instanceof CodexContextStateError && error.state === 'closed')
          throw new CodexChatAdapterError('unavailable', 'permission', { cause: error });
        throw error;
      }
    });
    session.settings = { ...session.settings, permissionLevel: level };
  }
  async setSessionModel(
    ...[id, model]: Parameters<IAgentAdapter['setSessionModel']>
  ): Promise<void> {
    const session = this.deps.session(id);
    await this.deps.safe('model', () =>
      session.context.updateNextTurn({ model }),
    );
    session.settings = { ...session.settings, model };
  }
  async setSessionEffort(
    ...[id, effort]: Parameters<IAgentAdapter['setSessionEffort']>
  ): Promise<void> {
    const session = this.deps.session(id);
    await this.deps.safe('effort', () =>
      session.context.updateNextTurn({ effort }),
    );
    session.settings = { ...session.settings, effort };
  }
}
