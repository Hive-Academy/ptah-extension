import {
  streamCodexChatTurn,
  type CodexChatSession as Session,
} from './codex-chat-turn-stream';
import type { NativeChatAdapter } from './routing-agent-adapter';
import type { SessionTurnStateRegistry } from '../helpers/session-turn-state.registry';
import type { Logger } from '@ptah-extension/vscode-core';
import { randomUUID } from 'node:crypto';
import type { DependencyContainer } from 'tsyringe';
import {
  resolveGatedCodexRuntime,
  isCodexResumeProfileChangedError,
  type ApprovalSink,
  type CodexContext,
  type CodexExecutionProfile,
  type CodexModelInfo,
  type CodexMcpSecrets,
  type CodexParityPlatform,
  type CodexThreadIdentity,
  type CodexTurnInput,
} from '@ptah-extension/codex-runtime';
import {
  SessionId,
  type IAgentAdapter,
  type AgentModelInfo,
  type AgentSessionStartConfig,
  type AgentSessionResumeConfig,
  type FlatStreamEventUnion,
  type ProviderInfo,
} from '@ptah-extension/shared';
import type {
  CodexChatEventCallbacks,
  CodexChatTurnIdentity,
} from './codex-chat-events';
import {
  CodexChatApprovalSink,
  type CodexChatApprovalPresentation,
  type CodexChatApprovalFollowUp,
} from './codex-chat-approval-sink';
import {
  sessionApprovalKey,
  type SessionApprovalRouter,
} from './session-approval-router';

export class CodexChatAdapterError extends Error {
  constructor(
    readonly code:
      | 'unsupported'
      | 'unavailable'
      | 'busy'
      | 'runtime-failed'
      | 'resume-profile-changed'
      | 'cancelled'
      | 'identity-mismatch',
    readonly operation: string,
    options?: ErrorOptions,
  ) {
    super(`Codex chat ${operation}: ${code}`, options);
    this.name = 'CodexChatAdapterError';
  }
}

export type CodexChatAdapterErrorCode = CodexChatAdapterError['code'];

export function isCodexChatAdapterError(
  error: unknown,
): error is CodexChatAdapterError {
  return error instanceof CodexChatAdapterError;
}

export interface CodexChatMetadataPort {
  save(
    sessionId: SessionId,
    identity: CodexThreadIdentity,
    title?: string,
  ): Promise<void>;
  /** Called once for a completed native turn. Optional for older host fakes. */
  completedTurn?(sessionId: SessionId): Promise<void>;
}

/** Composition owns registration; every scope must bind this sink before resolving runtime. */
export interface CodexChatScope {
  readonly container: DependencyContainer;
  /** Close the owned runtime, then dispose its container, including failed opens. */
  dispose(): Promise<void>;
}

export interface CodexChatAdapterPorts {
  readonly logger: Logger;
  readonly platform: CodexParityPlatform;
  /** Injectable filesystem lookup for approval containment. Defaults to node realpath. */
  readonly resolveApprovalPath?: (value: string) => Promise<string>;
  readonly info: ProviderInfo;
  /** Throws the host's coded option error for unreviewed keys; strips ambient keys. */
  checkOptions(config: AgentSessionResumeConfig): void;
  /** Build a validated profile from this session (never focused provider state).
   * Load native resume identity, enforce immutable home/workspace/provider, and
   * reject unsupported caller options rather than dropping them. */
  profile(
    config: AgentSessionStartConfig | AgentSessionResumeConfig,
    sessionId?: SessionId,
  ): Promise<{
    readonly profile: CodexExecutionProfile;
    readonly resume?: CodexThreadIdentity;
    /** Resolved MCP secrets for this open only; never stored, logged or persisted. */
    readonly secrets?: CodexMcpSecrets;
  }>;
  createScope(sink: ApprovalSink): CodexChatScope;
  readonly metadata: CodexChatMetadataPort;
  /** Only the routing surface the adapter and hosts call; keeps the router fakeable. */
  readonly approvals: Pick<
    SessionApprovalRouter,
    'register' | 'respond' | 'cancelPrompt'
  >;
  readonly presentation: CodexChatApprovalPresentation;
  readonly replacement: Pick<
    CodexChatApprovalFollowUp,
    'validateReplacement' | 'failed'
  >;
  /**
   * `turn` is the native App Server turn (turn/start receipt) the callbacks belong to.
   * It is undefined only for session-level errors raised outside a turn.
   */
  callbacks(
    sessionId: SessionId,
    turn: CodexChatTurnIdentity | undefined,
  ): CodexChatEventCallbacks;
  /**
   * Optional host observer. `opened` stages the native session before metadata persistence
   * (fresh or resumed), using its prepared profile. `closed` releases staged state on a
   * failed/cancelled open or when the published session leaves the adapter. Failures before
   * staging call neither hook; a losing open does not close a published winner's state.
   */
  readonly sessions?: CodexChatSessionLifecycle;
  /** Drain follow-up streams into the same chat channel as the initial stream. */
  publish(
    sessionId: SessionId,
    stream: AsyncIterable<FlatStreamEventUnion>,
  ): Promise<void>;
}

export interface CodexChatSessionLifecycle {
  opened(
    sessionId: SessionId,
    prepared: Awaited<ReturnType<CodexChatAdapterPorts['profile']>>,
  ): void;
  closed(sessionId: SessionId): void;
}

/** Thin native consumer. No SDK, proxy, transcript storage, or protocol parsing. */
type TrackedSession = Session & {
  settings: Pick<CodexExecutionProfile, 'model' | 'effort' | 'permissionLevel'>;
};

export class CodexChatAdapter implements NativeChatAdapter {
  private readonly sessions = new Map<SessionId, TrackedSession>();
  private readonly opening = new Map<string, { cancelled: boolean }>();
  private disposed = false;
  private generation = 0;
  private resolved?: Parameters<
    IAgentAdapter['setSessionIdResolvedCallback']
  >[0];
  private compactionStart?: Parameters<
    IAgentAdapter['setCompactionStartCallback']
  >[0];
  private stats?: Parameters<IAgentAdapter['setResultStatsCallback']>[0];

  constructor(
    private readonly ports: CodexChatAdapterPorts,
    private readonly turnState: Pick<
      SessionTurnStateRegistry,
      'markGenerating' | 'settleTurn' | 'recordFailure' | 'forceIdle'
    >,
  ) {}
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
      status: this.disposed ? 'disabled' : 'available',
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
      this.ports.checkOptions(config);
      const session = this.session(id);
      const keys = (['model', 'effort', 'permissionLevel'] as const).filter(
        key => config[key] !== undefined && config[key] !== session.settings[key],
      );
      if (keys.length > 0) {
        this.ports.logger.info(
          'Codex chat: changed session options are not applied to the open thread.',
          { code: 'codex-active-resume-options-not-applied', keys },
        );
      }
      // Session-level options are not reapplied to an open thread. Differences
      // from its retained model/effort/permissionLevel are reported by name only;
      // other supported inputs (such as systemPrompt) remain unapplied.
      return this.turn(session, {
        text: config.prompt ?? '',
        attachments: [
          ...(config.files ?? []).map((path) => ({ type: 'file' as const, path })),
          ...(config.images ?? []).map((image) => ({ type: 'image' as const, ...image })),
        ],
      });
    }
    return this.open(config, id);
  }
  private async open(
    config: AgentSessionStartConfig | AgentSessionResumeConfig,
    resumeId?: SessionId,
  ): Promise<AsyncIterable<FlatStreamEventUnion>> {
    const key = config.tabId ?? resumeId;
    if (!key || this.disposed)
      throw new CodexChatAdapterError('unavailable', 'open');
    if (this.opening.has(key) || (resumeId && this.opening.has(resumeId)))
      throw new CodexChatAdapterError('busy', 'open');
    const opening = { cancelled: false };
    this.opening.set(key, opening);
    if (resumeId) this.opening.set(resumeId, opening);
    const generation = this.generation;
    let scope: CodexChatScope | undefined;
    let sink: CodexChatApprovalSink | undefined;
    let context: CodexContext | undefined;
    let session: TrackedSession | undefined;
    let stagedId: SessionId | undefined;
    try {
      const prepared = await this.prepareProfile(config, resumeId);
      this.checkOpening(opening, generation);
      scope = this.createScope(() => sink);
      context = await this.openContext(scope, prepared);
      const id = SessionId.from(context.identity.threadId);
      this.checkOpening(opening, generation);
      if (this.sessions.has(id))
        throw new CodexChatAdapterError('busy', 'open');
      sink = this.buildSink(id, context, prepared.profile.cwd, () => session);
      stagedId = id;
      this.ports.sessions?.opened(id, prepared);
      this.checkOpening(opening, generation);
      await this.persistMetadata(id, context, config);
      this.checkOpening(opening, generation);
      if (this.sessions.has(id))
        throw new CodexChatAdapterError('busy', 'open');
      session = this.publishSession(id, context, sink, scope, prepared.profile);
      this.resolved?.(config.tabId, id);
      return this.turn(session, {
        text: config.prompt ?? '',
        attachments: prepared.profile.attachments,
      });
    } catch (error) {
      const failure = this.failure(error, 'open');
      if (session) this.sessions.delete(session.id);
      if (stagedId && !this.sessions.has(stagedId)) {
        try {
          this.ports.sessions?.closed(stagedId);
        } catch (cleanupError) {
          this.failure(cleanupError, 'lifecycle cleanup');
        }
      }
      sink?.dispose();
      await this.cleanupOpen(context, scope);
      throw failure;
    } finally {
      this.opening.delete(key);
      if (resumeId) this.opening.delete(resumeId);
    }
  }

  private async prepareProfile(
    config: AgentSessionStartConfig | AgentSessionResumeConfig,
    resumeId?: SessionId,
  ): ReturnType<CodexChatAdapterPorts['profile']> {
    const prepared = await this.ports.profile(config, resumeId);
    if (
      prepared.profile.consumer !== 'chat' ||
      !!resumeId !== !!prepared.resume ||
      (resumeId && prepared.resume?.threadId !== resumeId)
    )
      throw new CodexChatAdapterError('identity-mismatch', 'identity');
    return prepared;
  }

  private checkOpening(
    opening: { cancelled: boolean },
    generation: number,
  ): void {
    if (opening.cancelled || this.disposed || generation !== this.generation)
      throw new CodexChatAdapterError('cancelled', 'open');
  }

  private createScope(
    getSink: () => CodexChatApprovalSink | undefined,
  ): CodexChatScope {
    // Opening a context cannot authorize requests before its thread is bound.
    return this.ports.createScope({
      request: (request, signal) =>
        getSink()?.request(request, signal) ?? Promise.resolve('decline'),
    });
  }

  private openContext(
    scope: CodexChatScope,
    prepared: Awaited<ReturnType<CodexChatAdapterPorts['profile']>>,
  ): Promise<CodexContext> {
    const runtime = resolveGatedCodexRuntime(
      scope.container,
      'chat',
      this.ports.platform,
    );
    return runtime.open(prepared.profile, prepared.resume, prepared.secrets);
  }

  private persistMetadata(
    id: SessionId,
    context: CodexContext,
    config: AgentSessionStartConfig | AgentSessionResumeConfig,
  ): Promise<void> {
    const title = [
      config.sessionTitle,
      config.sessionName,
      'name' in config ? config.name : undefined,
    ].find((candidate) => candidate?.trim());
    return this.ports.metadata.save(
      id,
      context.identity,
      title,
    );
  }

  private publishSession(
    id: SessionId,
    context: CodexContext,
    sink: CodexChatApprovalSink,
    scope: CodexChatScope,
    profile: CodexExecutionProfile,
  ): TrackedSession {
    const session: TrackedSession = {
      settings: {
        model: profile.model,
        effort: profile.effort,
        permissionLevel: profile.permissionLevel,
      },
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
    return session;
  }

  private async cleanupOpen(
    context?: CodexContext,
    scope?: CodexChatScope,
  ): Promise<void> {
    try {
      await context?.close();
    } catch (error) {
      this.ports.logger.error(
        '[CodexChatAdapter] runtime-failed: context cleanup.',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
    try {
      await scope?.dispose();
    } catch (error) {
      this.ports.logger.error(
        '[CodexChatAdapter] runtime-failed: scope cleanup.',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  private buildSink(
    id: SessionId,
    context: CodexContext,
    threadCwd: string,
    getSession: () => TrackedSession | undefined,
  ): CodexChatApprovalSink {
    const releases = new Map<string, () => void>();
    const address = (request: Parameters<ApprovalSink['request']>[0]) => ({
      sessionId: id,
      threadId: request.threadId,
      requestId: String(request.requestId),
    });
    const sink = new CodexChatApprovalSink(
      id,
      context.identity.contextId,
      {
        present: (_id, request, choices) => {
          const key = sessionApprovalKey(address(request));
          releases.set(
            key,
            this.ports.approvals.register(address(request), {
              kind: 'codex',
              sink,
            }),
          );
          this.ports.presentation.present(id, request, choices);
        },
        dismiss: (_id, request) => {
          const key = sessionApprovalKey(address(request));
          releases.get(key)?.();
          releases.delete(key);
          this.ports.presentation.dismiss(id, request);
        },
        cancelPrompt: (payload) =>
          this.ports.presentation.cancelPrompt(payload),
      },
      {
        ...this.ports.replacement,
        isTurnActive: () => getSession()?.turnId !== undefined,
        post: async (text) => {
          const session = getSession();
          if (!session || session.blocked || session.closing)
            throw new CodexChatAdapterError('unavailable', 'followUp');
          if (session.turnId)
            await this.safe('steer', () => session.context.steer({ text }));
          else await this.publish(session, { text });
        },
      },
      this.ports.logger,
      () => getSession()?.settings.permissionLevel,
      this.ports.platform.platform,
      threadCwd,
      this.ports.resolveApprovalPath,
    );
    return sink;
  }

  private async publish(
    session: Session,
    input: CodexTurnInput,
  ): Promise<void> {
    const iterator = this.turn(session, input)[Symbol.asyncIterator]();
    try {
      await this.safe('publish', () =>
        this.ports.publish(session.id, {
          [Symbol.asyncIterator]: () => iterator,
        }),
      );
    } finally {
      await iterator.return?.();
    }
  }

  async listSessionModels(
    sessionId: SessionId,
  ): Promise<readonly AgentModelInfo[]> {
    const context = this.session(sessionId).context;
    return this.safe('listModels', async () => {
      const models = new Map<string, CodexModelInfo>();
      for (const model of await context.listModels()) {
        if (!models.has(model.model) || model.isDefault)
          models.set(model.model, model);
      }
      return [...models.values()].map((model) => ({
        value: model.model,
        displayName: model.displayName,
        ...(model.description === undefined
          ? {}
          : { description: model.description }),
      }));
    });
  }

  private notifyCompaction(session: Session, trigger: 'manual' | 'auto'): void {
    const preTokens = session.usage?.lastRequestTotalTokens;
    if (preTokens === undefined) {
      this.ports.logger.debug(
        '[CodexChatAdapter] Compaction start skipped: native last-request usage unavailable.',
      );
      return;
    }
    this.compactionStart?.({
      sessionId: session.id,
      trigger,
      timestamp: Date.now(),
      preTokens,
    });
  }

  private turn(
    session: Session,
    input: CodexTurnInput,
  ): AsyncIterable<FlatStreamEventUnion> {
    if (session.busy) throw new CodexChatAdapterError('busy', 'turn');
    if (session.blocked || session.closing)
      throw new CodexChatAdapterError('unavailable', 'turn');
    return streamCodexChatTurn(session, input, {
      turnState: this.turnState,
      logger: this.ports.logger,
      completedTurn: (id) => this.ports.metadata.completedTurn?.(id) ?? Promise.resolve(),
      callbacks: (id, turn) => this.ports.callbacks(id, turn),
      stats: (result) => this.stats?.(result),
      interrupt: (id) => this.interruptCurrentTurn(id),
      close: (active) => this.close(active),
      notifyCompaction: (active, trigger) => this.notifyCompaction(active, trigger),
      error: (code, operation) => new CodexChatAdapterError(code, operation),
      failure: (error, operation) => this.failure(error, operation),
    });
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
    await this.publish(this.session(id), { text, attachments });
  }
  owns(id: SessionId): boolean {
    return this.sessions.has(id) || this.opening.has(id);
  }
  isSessionActive(id: SessionId): boolean {
    return this.sessions.has(id) || this.opening.get(id)?.cancelled === false;
  }
  canSendFollowUp(id: SessionId): boolean {
    const session = this.sessions.get(id);
    return !!session && !session.busy && !session.blocked && !session.closing;
  }
  getSessionToken(id: SessionId): string | null {
    return this.sessions.get(id)?.token ?? null;
  }
  endSession(id: SessionId): void {
    const opening = this.opening.get(id);
    if (opening) opening.cancelled = true;
    const session = this.sessions.get(id);
    if (session)
      void this.close(session).catch((error) => {
        this.failure(error, 'cleanup');
        this.ports
          .callbacks(id, undefined)
          .error('[CodexChatAdapter] runtime-failed: cleanup.');
      });
  }
  /** Explicit teardown for commands that must finish closing before returning. */
  async closeSession(id: SessionId): Promise<void> {
    const opening = this.opening.get(id);
    if (opening) opening.cancelled = true;
    const session = this.sessions.get(id);
    if (session) await this.close(session);
  }
  /**
   * Never closes the native thread. The broadcaster calls this at stream exit
   * because a Claude query has one long-lived stream; each Codex turn is its
   * own stream and the thread outlives every turn (8k-5 finding 3). The
   * turn stream owns mid-turn detachment (`drainInterruptedTurn`);
   * `endSession`, `reset` and `dispose` close explicitly. A user Stop
   * interrupts the current turn while retaining the native thread.
   * `false` makes the broadcaster clear turn state, as after the first turn.
   */
  async endSessionIfTokenMatches(
    _id: SessionId,
    _token: string,
  ): Promise<boolean> {
    return false;
  }
  private close(session: Session): Promise<void> {
    if (session.closing) return session.closing;
    if (this.sessions.get(session.id) === session) {
      this.sessions.delete(session.id);
      this.ports.sessions?.closed(session.id);
    }
    session.busy = false;
    session.blocked = false;
    if (session.turnId) session.sink.endTurn(session.id, session.turnId);
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
    const turnId = session.turnId;
    if (!turnId) {
      session.pendingInterrupt = session.busy;
      session.blocked = session.busy;
      return session.pendingInterrupt;
    }
    session.blocked = true;
    const accepted = await this.safe('interrupt', () =>
      session.context.interrupt(turnId),
    );
    if (accepted) session.blocked = false;
    return accepted;
  }
  async interruptSession(id: SessionId): Promise<void> {
    const opening = this.opening.get(id);
    if (opening) {
      opening.cancelled = true;
      return;
    }
    const session = this.sessions.get(id);
    if (!session || !session.busy || session.stopRequested) return;
    session.stopRequested = true;
    try {
      const accepted = await this.interruptCurrentTurn(id);
      if (!accepted) {
        if (!session.busy) return;
        this.ports.logger.warn('[CodexChatAdapter] turn interrupt was refused; closing context.', { sessionId: id });
        await this.close(session);
        return;
      }
      if (session.turnId) session.sink.endTurn(id, session.turnId);
    } catch (error) {
      await this.close(session);
      throw error;
    }
  }
  async executeSlashCommand(
    ...[id, command]: Parameters<IAgentAdapter['executeSlashCommand']>
  ): Promise<AsyncIterable<FlatStreamEventUnion>> {
    if (command !== '/compact') this.unsupported('slashCommand');
    const session = this.session(id);
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
      await this.safe('compact', () => session.context.compact());
    } catch (error) {
      await this.ports
        .callbacks(session.id, undefined)
        .error('Codex context compaction failed.');
      throw error;
    }
    await this.ports.publish(
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
      this.unsupported('permissionAlias');
    const session = this.session(id);
    await this.safe('permission', () =>
      session.context.updateNextTurn({ permissionLevel: level }),
    );
    session.settings = { ...session.settings, permissionLevel: level };
  }
  async setSessionModel(
    ...[id, model]: Parameters<IAgentAdapter['setSessionModel']>
  ): Promise<void> {
    const session = this.session(id);
    await this.safe('model', () =>
      session.context.updateNextTurn({ model }),
    );
    session.settings = { ...session.settings, model };
  }
  async setSessionEffort(
    ...[id, effort]: Parameters<IAgentAdapter['setSessionEffort']>
  ): Promise<void> {
    const session = this.session(id);
    await this.safe('effort', () =>
      session.context.updateNextTurn({ effort }),
    );
    session.settings = { ...session.settings, effort };
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
  setCompactionStartCallback(
    cb: Parameters<IAgentAdapter['setCompactionStartCallback']>[0],
  ): void {
    this.compactionStart = cb;
  }
  setLiveStatsCallback(): void {
    // Resume supplies no prior assistant-message count or session-wide usage totals.
    this.unsupported('liveStats');
  }
  setWorktreeCreatedCallback(): void {
    this.unsupported('worktreeCreated');
  }
  setWorktreeRemovedCallback(): void {
    this.unsupported('worktreeRemoved');
  }
  private session(id: SessionId): TrackedSession {
    const session = this.sessions.get(id);
    if (!session || session.closing)
      throw new CodexChatAdapterError('unavailable', 'session');
    return session;
  }
  private unsupported(operation: string): never {
    throw new CodexChatAdapterError('unsupported', operation);
  }
  private failure(error: unknown, operation: string): CodexChatAdapterError {
    const failure = error instanceof CodexChatAdapterError
      ? error
      : new CodexChatAdapterError(
          isCodexResumeProfileChangedError(error)
            ? 'resume-profile-changed'
            : 'runtime-failed',
          operation,
          { cause: error },
        );
    if (failure.code === 'cancelled') return failure;
    this.ports.logger.error(
      `[CodexChatAdapter] ${failure.code}: ${operation}.`,
      error instanceof Error ? error : new Error(String(error)),
    );
    return failure;
  }
  private async safe<T>(
    operation: string,
    action: () => Promise<T>,
  ): Promise<T> {
    try {
      return await action();
    } catch (error) {
      throw this.failure(error, operation);
    }
  }
}
