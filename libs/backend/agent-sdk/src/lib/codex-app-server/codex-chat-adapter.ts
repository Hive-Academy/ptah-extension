import { randomUUID } from 'node:crypto';
import type { DependencyContainer } from 'tsyringe';
import {
  resolveGatedCodexRuntime,
  type ApprovalSink,
  type CodexContext,
  type CodexExecutionProfile,
  type CodexParityPlatform,
  type CodexThreadIdentity,
  type CodexTurnInput,
} from '@ptah-extension/codex-runtime';
import {
  SessionId,
  type IAgentAdapter,
  type AgentSessionStartConfig,
  type AgentSessionResumeConfig,
  type FlatStreamEventUnion,
  type ProviderInfo,
} from '@ptah-extension/shared';
import {
  CodexChatEvents,
  type CodexChatEventCallbacks,
} from './codex-chat-events';
import {
  CodexChatApprovalSink,
  type CodexChatApprovalPresentation,
  type CodexChatApprovalFollowUp,
} from './codex-chat-approval-sink';
import type { SessionApprovalRouter } from './session-approval-router';

export class CodexChatAdapterError extends Error {
  constructor(
    readonly code: 'unsupported' | 'unavailable' | 'busy' | 'runtime-failed',
    readonly operation: string,
  ) {
    super(`Codex chat ${operation}: ${code}`);
    this.name = 'CodexChatAdapterError';
  }
}

export interface CodexChatMetadataPort {
  save(
    sessionId: SessionId,
    identity: CodexThreadIdentity,
    title?: string,
  ): Promise<void>;
}

/** Composition owns registration; every scope must bind this sink before resolving runtime. */
export interface CodexChatScope {
  readonly container: DependencyContainer;
  /** Close the owned runtime, then dispose its container, including failed opens. */
  dispose(): Promise<void>;
}

export interface CodexChatAdapterPorts {
  readonly platform: CodexParityPlatform;
  readonly info: ProviderInfo;
  /** Build a validated profile from this session (never focused provider state).
   * Load native resume identity, enforce immutable home/workspace/provider, and
   * reject unsupported caller options rather than dropping them. */
  profile(
    config: AgentSessionStartConfig | AgentSessionResumeConfig,
    sessionId?: SessionId,
  ): Promise<{
    readonly profile: CodexExecutionProfile;
    readonly resume?: CodexThreadIdentity;
  }>;
  createScope(sink: ApprovalSink): CodexChatScope;
  readonly metadata: CodexChatMetadataPort;
  readonly approvals: SessionApprovalRouter;
  readonly presentation: CodexChatApprovalPresentation;
  readonly replacement: Pick<
    CodexChatApprovalFollowUp,
    'validateReplacement' | 'failed'
  >;
  callbacks(sessionId: SessionId): CodexChatEventCallbacks;
  /** Drain follow-up streams into the same chat channel as the initial stream. */
  publish(
    sessionId: SessionId,
    stream: AsyncIterable<FlatStreamEventUnion>,
  ): Promise<void>;
}

interface Session {
  readonly id: SessionId;
  readonly token: string;
  readonly context: CodexContext;
  readonly sink: CodexChatApprovalSink;
  readonly scope: CodexChatScope;
  readonly abort: AbortController;
  busy: boolean;
  turnId?: string;
  blocked: boolean;
  closing?: Promise<void>;
}

/** Thin native consumer. No SDK, proxy, transcript storage, or protocol parsing. */
export class CodexChatAdapter implements IAgentAdapter {
  private readonly sessions = new Map<SessionId, Session>();
  private readonly opening = new Map<string, { cancelled: boolean }>();
  private disposed = false;
  private generation = 0;
  private resolved?: Parameters<
    IAgentAdapter['setSessionIdResolvedCallback']
  >[0];
  private stats?: Parameters<IAgentAdapter['setResultStatsCallback']>[0];

  constructor(private readonly ports: CodexChatAdapterPorts) {}
  get providerId() {
    return this.ports.info.id;
  }
  get info() {
    return this.ports.info;
  }
  async preloadSdk(): Promise<void> {
    /* No SDK modules belong to this consumer. */
  }
  getCliJsPath(): null {
    return null;
  }
  async initialize(): Promise<boolean> {
    return !this.disposed;
  }
  async verifyInstallation(): Promise<boolean> {
    return this.unsupported('verifyInstallation');
  }
  getHealth(): ReturnType<IAgentAdapter['getHealth']> {
    return {
      status: this.disposed
        ? 'disabled'
        : this.sessions.size
          ? 'available'
          : 'unavailable',
      lastCheck: Date.now(),
    };
  }
  async getSupportedModels(): ReturnType<IAgentAdapter['getSupportedModels']> {
    return this.unsupported('getSupportedModels');
  }
  async getDefaultModel(): Promise<string> {
    return this.unsupported('getDefaultModel');
  }
  async getApiModels(): ReturnType<IAgentAdapter['getApiModels']> {
    return this.unsupported('getApiModels');
  }
  async reset(): Promise<void> {
    this.disposed = true;
    const generation = ++this.generation;
    await Promise.all(
      [...this.sessions.values()].map((session) => this.close(session)),
    );
    if (this.generation === generation) this.disposed = false;
  }
  dispose(): void {
    this.generation++;
    this.disposed = true;
    for (const session of this.sessions.values()) this.endSession(session.id);
  }

  startChatSession(
    config: AgentSessionStartConfig,
  ): Promise<AsyncIterable<FlatStreamEventUnion>> {
    return this.open(config);
  }
  async resumeSession(
    id: SessionId,
    config: AgentSessionResumeConfig = {},
  ): Promise<AsyncIterable<FlatStreamEventUnion>> {
    if (this.sessions.has(id)) {
      if (Object.keys(config).some((key) => !['prompt', 'tabId'].includes(key)))
        this.unsupported('activeResumeConfig');
      return this.turn(this.session(id), { text: config.prompt ?? '' });
    }
    return this.open(config, id);
  }
  private async open(
    config: AgentSessionStartConfig | AgentSessionResumeConfig,
    resumeId?: SessionId,
  ): Promise<AsyncIterable<FlatStreamEventUnion>> {
    const key = resumeId ?? config.tabId;
    if (!key || this.disposed)
      throw new CodexChatAdapterError('unavailable', 'open');
    if (this.opening.has(key)) throw new CodexChatAdapterError('busy', 'open');
    const opening = { cancelled: false };
    this.opening.set(key, opening);
    const generation = this.generation;
    let scope: CodexChatScope | undefined;
    let sink: CodexChatApprovalSink | undefined;
    let context: CodexContext | undefined;
    let session: Session | undefined;
    try {
      const prepared = await this.ports.profile(config, resumeId);
      if (opening.cancelled || this.disposed || generation !== this.generation)
        throw new CodexChatAdapterError('unavailable', 'open');
      if (
        prepared.profile.consumer !== 'chat' ||
        !!resumeId !== !!prepared.resume ||
        (resumeId && prepared.resume?.threadId !== resumeId)
      )
        throw new CodexChatAdapterError('unavailable', 'identity');
      const releases = new Map<string, () => void>();
      // Opening a context cannot authorize requests before its thread is bound.
      scope = this.ports.createScope({
        request: (request, signal) =>
          sink ? sink.request(request, signal) : Promise.resolve('decline'),
      });
      const runtime = resolveGatedCodexRuntime(
        scope.container,
        'chat',
        this.ports.platform,
      );
      context = await runtime.open(prepared.profile, prepared.resume);
      const id = SessionId.from(context.identity.threadId);
      if (
        opening.cancelled ||
        this.disposed ||
        generation !== this.generation ||
        this.sessions.has(id)
      )
        throw new CodexChatAdapterError('unavailable', 'open');
      sink = new CodexChatApprovalSink(
        id,
        context.identity.contextId,
        {
          present: (_id, request, choices) => {
            const release = this.ports.approvals.register(
              {
                sessionId: id,
                threadId: request.threadId,
                requestId: String(request.requestId),
              },
              { kind: 'codex', sink: sink! },
            );
            releases.set(JSON.stringify(request), release);
            this.ports.presentation.present(id, request, choices);
          },
          dismiss: (_id, request) => {
            const key = JSON.stringify(request);
            releases.get(key)?.();
            releases.delete(key);
            this.ports.presentation.dismiss(id, request);
          },
          cancelPrompt: (payload) =>
            this.ports.presentation.cancelPrompt(payload),
        },
        {
          ...this.ports.replacement,
          isTurnActive: () => session?.turnId !== undefined,
          post: async (text) => {
            if (!session)
              throw new CodexChatAdapterError('unavailable', 'followUp');
            if (session.blocked)
              throw new CodexChatAdapterError('unavailable', 'followUp');
            if (session.turnId)
              await this.safe('steer', () => session!.context.steer({ text }));
            else await this.ports.publish(id, this.turn(session, { text }));
          },
        },
      );
      await this.ports.metadata.save(
        id,
        context.identity,
        config.sessionTitle ?? config.sessionName,
      );
      if (opening.cancelled || this.disposed || generation !== this.generation)
        throw new CodexChatAdapterError('unavailable', 'open');
      session = {
        id,
        token: randomUUID(),
        context,
        sink,
        scope,
        abort: new AbortController(),
        busy: false,
        blocked: false,
      };
      this.sessions.set(id, session);
      this.resolved?.(config.tabId, id);
      return this.turn(session, {
        text: config.prompt ?? '',
        attachments: prepared.profile.attachments,
      });
    } catch {
      if (session) this.sessions.delete(session.id);
      sink?.dispose();
      try {
        await context?.close();
      } catch {
        /* Preserve sanitized admission failure. */
      }
      try {
        await scope?.dispose();
      } catch {
        /* Preserve sanitized admission failure. */
      }
      throw new CodexChatAdapterError('runtime-failed', 'open');
    } finally {
      this.opening.delete(key);
    }
  }

  private turn(
    session: Session,
    input: CodexTurnInput,
  ): AsyncIterable<FlatStreamEventUnion> {
    if (session.busy) throw new CodexChatAdapterError('busy', 'turn');
    if (session.blocked || session.closing)
      throw new CodexChatAdapterError('unavailable', 'turn');
    session.busy = true;
    return this.stream(session, input);
  }
  private async *stream(
    session: Session,
    input: CodexTurnInput,
  ): AsyncIterable<FlatStreamEventUnion> {
    const subscription = new AbortController();
    const abort = () => subscription.abort();
    session.abort.signal.addEventListener('abort', abort, { once: true });
    let terminal = false;
    const started = Date.now();
    try {
      if (session.abort.signal.aborted)
        throw new CodexChatAdapterError('unavailable', 'turn');
      const events = session.context.events(subscription.signal);
      const receipt = await session.context.startTurn({
        ...input,
        signal: subscription.signal,
      });
      session.turnId = receipt.turnId;
      const callbacks = this.ports.callbacks(session.id);
      const projection = new CodexChatEvents(
        session.id,
        { ...session.context.identity, turnId: receipt.turnId },
        {
          ...callbacks,
          result: (result) => {
            terminal = true;
            callbacks.result(result);
            const usage = result.usage;
            if (
              usage?.inputTokens !== undefined &&
              usage.outputTokens !== undefined
            )
              this.stats?.({
                sessionId: session.id,
                turnCost: null,
                tokens: {
                  input: usage.inputTokens,
                  output: usage.outputTokens,
                  cacheRead: usage.cachedInputTokens,
                },
                duration: Date.now() - started,
              });
          },
        },
      );
      for await (const event of events) {
        if (subscription.signal.aborted) break;
        for (const mapped of projection.map(event)) yield mapped;
        if (terminal) return;
      }
      throw new CodexChatAdapterError('runtime-failed', 'stream');
    } catch {
      throw new CodexChatAdapterError('runtime-failed', 'turn');
    } finally {
      subscription.abort();
      session.abort.signal.removeEventListener('abort', abort);
      session.busy = false;
      session.turnId = undefined;
      if (!terminal) await this.close(session);
    }
  }
  async sendMessageToSession(
    ...[id, text, options]: Parameters<IAgentAdapter['sendMessageToSession']>
  ): Promise<void> {
    if (
      options &&
      Object.keys(options).some(
        (key) => !['files', 'images', 'admission'].includes(key),
      )
    )
      this.unsupported('messageOptions');
    const attachments = [
      ...(options?.files ?? []).map((path) => ({
        type: 'file' as const,
        path,
      })),
      ...(options?.images ?? []).map((image) => ({
        type: 'image' as const,
        ...image,
      })),
    ];
    await this.safe('sendMessage', () =>
      this.ports.publish(
        id,
        this.turn(this.session(id), { text, attachments }),
      ),
    );
  }
  isSessionActive(id: SessionId): boolean {
    return this.sessions.has(id);
  }
  getSessionToken(id: SessionId): string | null {
    return this.sessions.get(id)?.token ?? null;
  }
  endSession(id: SessionId): void {
    const opening = this.opening.get(id);
    if (opening) opening.cancelled = true;
    const session = this.sessions.get(id);
    if (session)
      void this.close(session).catch(() =>
        this.ports.callbacks(id).error('Codex chat cleanup failed.'),
      );
  }
  async endSessionIfTokenMatches(
    id: SessionId,
    token: string,
  ): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session || session.token !== token) return false;
    await this.close(session);
    return true;
  }
  private close(session: Session): Promise<void> {
    if (session.closing) return session.closing;
    if (this.sessions.get(session.id) === session)
      this.sessions.delete(session.id);
    session.abort.abort();
    session.sink.dispose();
    session.closing = this.safe('close', async () => {
      try {
        await session.context.close();
      } finally {
        await session.scope.dispose();
      }
    });
    return session.closing;
  }
  async interruptCurrentTurn(id: SessionId): Promise<boolean> {
    const session = this.session(id);
    if (!session.turnId) return false;
    session.blocked = true;
    const accepted = await this.safe('interrupt', () =>
      session.context.interrupt(session.turnId!),
    );
    if (accepted) session.blocked = false;
    return accepted;
  }
  async interruptSession(id: SessionId): Promise<void> {
    await this.close(this.session(id));
  }
  async executeSlashCommand(
    ...[id, command]: Parameters<IAgentAdapter['executeSlashCommand']>
  ): Promise<AsyncIterable<FlatStreamEventUnion>> {
    if (command !== '/compact') this.unsupported('slashCommand');
    await this.safe('compact', () => this.session(id).context.compact());
    return (async function* () {
      /* Compact has no assistant turn result. */
    })();
  }
  async setSessionPermissionLevel(
    ...[id, level]: Parameters<IAgentAdapter['setSessionPermissionLevel']>
  ): Promise<void> {
    if (
      level === 'default' ||
      level === 'acceptEdits' ||
      level === 'bypassPermissions'
    )
      this.unsupported('permissionAlias');
    await this.safe('permission', () =>
      this.session(id).context.updateNextTurn({ permissionLevel: level }),
    );
  }
  async setSessionModel(
    ...[id, model]: Parameters<IAgentAdapter['setSessionModel']>
  ): Promise<void> {
    await this.safe('model', () =>
      this.session(id).context.updateNextTurn({ model }),
    );
  }
  async setSessionEffort(
    ...[id, effort]: Parameters<IAgentAdapter['setSessionEffort']>
  ): Promise<void> {
    await this.safe('effort', () =>
      this.session(id).context.updateNextTurn({ effort }),
    );
  }
  setSessionIdResolvedCallback(
    cb: Parameters<IAgentAdapter['setSessionIdResolvedCallback']>[0],
  ): void {
    this.resolved = cb;
  }
  setResultStatsCallback(
    cb: Parameters<IAgentAdapter['setResultStatsCallback']>[0],
  ): void {
    this.stats = cb;
  }
  setCompactionStartCallback(): void {
    this.unsupported('compactionStats');
  }
  setLiveStatsCallback(): void {
    this.unsupported('liveStats');
  }
  setWorktreeCreatedCallback(): void {
    this.unsupported('worktreeCreated');
  }
  setWorktreeRemovedCallback(): void {
    this.unsupported('worktreeRemoved');
  }
  private session(id: SessionId): Session {
    const session = this.sessions.get(id);
    if (!session || session.closing)
      throw new CodexChatAdapterError('unavailable', 'session');
    return session;
  }
  private unsupported(operation: string): never {
    throw new CodexChatAdapterError('unsupported', operation);
  }
  private async safe<T>(
    operation: string,
    action: () => Promise<T>,
  ): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof CodexChatAdapterError) throw error;
      throw new CodexChatAdapterError('runtime-failed', operation);
    }
  }
}
