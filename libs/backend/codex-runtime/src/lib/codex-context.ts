import type { SpawnedProcessHandle } from '@ptah-extension/platform-core';
import { z } from 'zod';
import { CodexContextStateError } from './codex-context-state-error';
import {
  CodexAppServerProcess,
  CodexHomeMismatchError,
  CodexRequestRejectedError,
  CodexUnsupportedMethodError,
  type CodexAppServerHandlers,
} from './codex-app-server-process';
import {
  CodexApprovalBridge,
  type CodexApprovalBridgeOptions,
} from './codex-approval-bridge';
import { CodexEventTranslator } from './codex-event-translator';
import {
  codexProfileFingerprint,
  resolveCodexLevelPolicy,
} from './codex-execution-profile';
import type {
  CodexPermissionRuleStore,
  CodexPermissionRuleTarget,
} from './codex-permission-rule-store';
import type { CodexSelectionSnapshotPort } from './select-codex-executable';
import {
  codexNotificationSchemas,
  codexRequestSchemas,
  type CodexRequestParams,
} from './codex-protocol-validator';
import type {
  ApprovalSink,
  Clock,
  CodexExecutableSource,
  CodexRuntimeLogger,
  CodexThreadIdentityStore,
  IProcessSpawner,
} from './codex-runtime-ports';
import type {
  AppliedSettings,
  CodexContext,
  CodexApprovalRequest,
  CodexModelInfo,
  CodexExecutionProfile,
  CodexPermissionLevel,
  CodexJsonValue,
  CodexRuntimeEvent,
  CodexThreadIdentity,
  CodexTurnInput,
  CodexTurnReceipt,
  CodexTurnSettings,
} from './codex-runtime.types';

export interface CodexRuntimeOptions {
  readonly spawner: IProcessSpawner;
  readonly selectionSnapshot: CodexSelectionSnapshotPort;
  readonly store: CodexThreadIdentityStore;
  readonly sink: ApprovalSink;
  readonly clock: Clock;
  readonly logger: CodexRuntimeLogger;
  readonly requestUserInput?: CodexApprovalBridgeOptions['requestUserInput'];
}

export interface CodexContextProcessOptions extends CodexRuntimeOptions {
  readonly executable: CodexExecutableSource;
}

interface Subscriber {
  readonly queue: CodexRuntimeEvent[];
  wake: () => void;
  closed: boolean;
  release: () => void;
}

/** Undefined means the root thread; null means an unrelated thread. */
export function childEventParent(
  threadId: string,
  rootThreadId: string,
  childTools: ReadonlyMap<string, string>,
): string | null | undefined {
  return threadId === rootThreadId ? undefined : childTools.get(threadId) ?? null;
}

/** Operations serialize RPC admission, never the lifetime of a running turn. */
class RuntimeContext implements CodexContext {
  private committedIdentity?: CodexThreadIdentity;
  private readonly process: CodexAppServerProcess;
  private readonly translator: CodexEventTranslator;
  private bridge?: CodexApprovalBridge;
  private child?: SpawnedProcessHandle;
  private state: 'opening' | 'idle' | 'running' | 'interrupting' | 'closed' =
    'opening';
  private activeTurn?: string;
  private turnController = new AbortController();
  private readonly terminalTurns = new Set<string>();
  private readonly childTools = new Map<string, string>();
  private readonly knownChildParents = new Map<string, string>();
  private readonly childTurns = new Map<string, string>();
  private readonly pendingSpawns = new Map<string, Set<string>>();
  private readonly earlyChildEvents = new Map<string, CodexRuntimeEvent[]>();
  private earlyChildCount = 0;
  private earlyChildOverflowLogged = false;
  private rootTerminalPending = false;
  private rootTerminalTimer?: ReturnType<typeof setTimeout>;
  private sequence = 0;
  private revision = 0;
  private turnRevision = 0;
  private sentInitialInput = false;
  private turnHistory = false;
  private settings: CodexTurnSettings;
  private levelPolicy: Pick<
    CodexExecutionProfile,
    'approvalPolicy' | 'sandboxPolicy'
  >;
  private wirePermissionLevel: CodexPermissionLevel;
  private activeTurnPermissionLevel?: CodexPermissionLevel;
  private operation: Promise<unknown> = Promise.resolve();
  private closing?: Promise<void>;
  private persistence?: Promise<void>;
  private readonly subscribers = new Set<Subscriber>();
  private readonly followUps = new Set<ReturnType<typeof setImmediate>>();
  private releaseTurnSignal?: () => void;
  private compacting?: Promise<void>;
  private finishCompact?: () => void;
  private compactTimer?: ReturnType<typeof setTimeout>;
  private interruptTimer?: ReturnType<typeof setTimeout>;
  private readonly targets = new Map<string, CodexPermissionRuleTarget>();
  /** Item ids already presented during the active turn. */
  private readonly asyncQuestionItems = new Set<string>();

  constructor(
    private readonly options: CodexContextProcessOptions,
    private readonly rules: CodexPermissionRuleStore,
    private readonly profile: CodexExecutionProfile,
    private readonly generation: number,
    /** Consumer-specific thread config; dropped once the start/resume frame is sent. */
    private threadConfig: Record<string, CodexJsonValue> | undefined,
    private readonly release: () => void,
  ) {
    this.settings = {
      model: profile.model,
      effort: profile.effort,
      permissionLevel: profile.permissionLevel,
    };
    this.levelPolicy = {
      approvalPolicy: profile.approvalPolicy,
      sandboxPolicy: profile.sandboxPolicy,
    };
    this.wirePermissionLevel = profile.permissionLevel;
    this.translator = new CodexEventTranslator(profile.contextId, generation);
    const spawner: IProcessSpawner = {
      spawnProcess: (request) => {
        const child = options.spawner.spawnProcess(request);
        this.child = child;
        child.on('exit', this.onFailure);
        child.on('close', this.onFailure);
        child.on('error', this.onFailure);
        // Internal protocol failures close stdin even when no turn RPC is outstanding.
        child.stdin?.on('finish', this.onFailure);
        return child;
      },
    };
    this.process = new CodexAppServerProcess(
      spawner,
      options.executable,
      profile,
      {
        onNotification: (frame) => this.onNotification(frame),
        onRequest: async (frame, signal) => {
          if (
            !this.bridge ||
            !this.activeTurn ||
            (this.state !== 'running' && this.state !== 'interrupting')
          )
            throw new Error('Codex approval has no live turn');
          const requestedTurn = z.object({
            threadId: z.string(), turnId: z.string(),
          }).safeParse(frame.params);
          const approvalTurnId = requestedTurn.success &&
            this.childTools.has(requestedTurn.data.threadId) &&
            this.childTurns.get(requestedTurn.data.threadId) ===
              requestedTurn.data.turnId
            ? requestedTurn.data.turnId : this.activeTurn;
          const result = await this.bridge.handle(
            frame,
            approvalTurnId,
            AbortSignal.any([signal, this.turnController.signal]),
          );
          if (result.followUpMessage !== undefined) {
            const text = result.followUpMessage;
            const turnId = approvalTurnId;
            // dispatchApproval writes the returned response in its promise continuation.
            // The next event-loop check phase is strictly after that microtask writer.
            const handle = setImmediate(() => {
              this.followUps.delete(handle);
              if (this.state === 'closed' || signal.aborted) return;
              void this.steer({ text }).catch((error: unknown) => {
                if (error instanceof CodexRequestRejectedError ||
                    error instanceof CodexUnsupportedMethodError) {
                  this.emitFollowUpRejected(turnId);
                } else this.onFailure();
              });
            });
            this.followUps.add(handle);
          }
          if (result.denialFeedback !== undefined) {
            const text = result.denialFeedback;
            const turnId = this.activeTurn;
            // Same ordering as an edit follow-up: the returned decline is written
            // before this check-phase steer. A refused or finished turn is logged
            // without the user's reason and never fails this reply.
            const handle = setImmediate(() => {
              this.followUps.delete(handle);
              if (
                this.state === 'closed' ||
                signal.aborted ||
                turnId === undefined
              )
                return;
              void this.deliverDenialFeedback(text, turnId);
            });
            this.followUps.add(handle);
          }
          return result.response;
        },
      },
      options.logger,
    );
  }

  stderrTail(maxBytes?: number): string {
    return this.process.stderrTail(maxBytes);
  }

  get identity(): CodexThreadIdentity {
    if (!this.committedIdentity)
      throw new Error('Codex identity is not committed');
    return this.committedIdentity;
  }

  get hasTurnHistory(): boolean {
    return this.turnHistory;
  }

  get turnPermissionLevel(): CodexPermissionLevel {
    if (this.state === 'running' || this.state === 'interrupting')
      return (
        this.activeTurnPermissionLevel ??
        this.settings.permissionLevel ??
        this.profile.permissionLevel
      );
    return this.settings.permissionLevel ?? this.profile.permissionLevel;
  }

  async open(resume?: CodexThreadIdentity): Promise<void> {
    this.turnHistory = resume !== undefined;
    await this.process.start();
    if (this.process.verifiedCodexHome !== this.profile.normalizedHome)
      throw new CodexHomeMismatchError();
    const instructions = [
      this.profile.developerPrompt,
      this.profile.outputStyle,
      ...this.profile.instructionSources.map((source) => source.content),
    ]
      .filter(Boolean)
      .join('\n\n');
    const threadConfig = this.threadConfig;
    const params = codexRequestSchemas['thread/start'].params.parse({
      cwd: this.profile.cwd,
      ...(this.profile.model === undefined ? {} : { model: this.profile.model }),
      approvalPolicy: this.profile.approvalPolicy,
      approvalsReviewer: 'user',
      sandbox: this.profile.sandboxPolicy.mode,
      ...(this.profile.systemPrompt !== undefined
        ? { baseInstructions: this.profile.systemPrompt }
        : {}),
      ...(instructions ? { developerInstructions: instructions } : {}),
      ...(threadConfig && Object.keys(threadConfig).length > 0
        ? { config: threadConfig }
        : {}),
    });
    const result = resume
      ? await this.process.request('thread/resume', {
          ...params,
          threadId: resume.threadId,
        })
      : await this.process.request('thread/start', params);
    // The sent frame was the secrets' only destination; the context drops them.
    this.threadConfig = undefined;
    if (resume && result.thread.id !== resume.threadId)
      throw new Error('Codex resumed a different thread');
    if (this.isClosed()) throw new Error('Codex context closed');
    this.translator.setThreadModel(result.thread.id, result.model);
    const identity: CodexThreadIdentity = Object.freeze({
      threadId: result.thread.id,
      contextId: this.profile.contextId,
      processGeneration: this.generation,
      normalizedHome: this.profile.normalizedHome,
      workspaceId: this.profile.workspaceId,
      providerId: this.profile.providerId,
      profileFingerprint: this.profile.profileFingerprint,
    });
    this.persistence = this.options.store.persist(identity).then(() => {
      this.committedIdentity = identity;
    });
    await this.persistence;
    if (this.isClosed()) throw new Error('Codex context closed');
    this.bridge = new CodexApprovalBridge({
      identity,
      sink: this.options.sink,
      rules: this.rules,
      clock: this.options.clock,
      permissionLevel: () => this.turnPermissionLevel,
      isCurrent: (correlation) =>
        this.state === 'running' &&
        (correlation.turnId === this.activeTurn ||
          [...this.childTurns.values()].includes(correlation.turnId)) &&
        correlation.processGeneration === this.generation,
      isWritable: () => this.state !== 'closed',
      close: this.onFailure,
      logger: this.options.logger,
      requestUserInput: this.options.requestUserInput,
      resolveTarget: (request) =>
        typeof request.details['itemId'] === 'string'
          ? this.targets.get(request.details['itemId'])
          : undefined,
    });
    this.state = 'idle';
  }

  events(signal: AbortSignal): AsyncIterable<CodexRuntimeEvent> {
    const subscriber: Subscriber = {
      queue: [],
      wake: () => undefined,
      closed: false,
      release: () => undefined,
    };
    subscriber.release = () => {
      subscriber.closed = true;
      signal.removeEventListener('abort', abort);
      this.subscribers.delete(subscriber);
      subscriber.wake();
    };
    const abort = () => {
      subscriber.queue.length = 0;
      subscriber.release();
    };
    if (!signal.aborted && this.state !== 'closed') {
      this.subscribers.add(subscriber);
      signal.addEventListener('abort', abort, { once: true });
    } else subscriber.closed = true;
    // Registration happens above, before the first next() call.
    return {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          while (!signal.aborted) {
            const event = subscriber.queue.shift();
            if (event) return { value: event, done: false };
            if (subscriber.closed) break;
            await new Promise<void>((resolve) => {
              subscriber.wake = resolve;
            });
          }
          subscriber.release();
          return { value: undefined, done: true };
        },
        return: async () => {
          subscriber.queue.length = 0;
          subscriber.release();
          return { value: undefined, done: true };
        },
      }),
    };
  }

  private emit(event: CodexRuntimeEvent): void {
    const ordered = { ...event, sequence: ++this.sequence };
    for (const subscriber of this.subscribers) {
      if (subscriber.queue.length >= 1024) {
        subscriber.queue.length = 0;
        subscriber.queue.push({
          ...ordered,
          type: 'error',
          error: {
            code: 'codexSubscriberOverflow',
            message: 'Codex event subscription exceeded its buffer limit.',
            retryable: true,
          },
        });
        subscriber.release();
        continue;
      }
      subscriber.queue.push(ordered);
      subscriber.wake();
    }
  }

  private onNotification(
    frame: Parameters<CodexAppServerHandlers['onNotification']>[0],
  ): void {
    if (this.state === 'closed' || !this.committedIdentity) return;
    if (frame.method === 'thread/started') {
      const started = z.object({ thread: z.object({
        id: z.string(), parentThreadId: z.string().nullish(),
      }) }).safeParse(frame.params);
      if (started.success && started.data.thread.parentThreadId) {
        const candidates = this.pendingSpawns.get(started.data.thread.parentThreadId);
        if (candidates?.size === 1) {
          const toolId = [...candidates][0];
          if (toolId) this.linkChild(started.data.thread.id, toolId);
        }
      }
    }
    // Compaction owns admission, so thread item activity belongs to its work.
    if (
      this.finishCompact &&
      typeof frame.params === 'object' &&
      frame.params !== null &&
      !Array.isArray(frame.params) &&
      frame.params['threadId'] === this.identity.threadId &&
      (frame.method.startsWith('item/') || frame.method.startsWith('turn/'))
    )
      this.resetCompactWatchdog();
    if (frame.method === 'item/started') {
      const parsed = codexNotificationSchemas['item/started'].parse(
        frame.params,
      );
      if (
        (parsed.threadId === this.identity.threadId &&
          parsed.turnId === this.activeTurn) ||
        this.childTools.has(parsed.threadId)
      ) {
        if (this.childTools.has(parsed.threadId))
          this.childTurns.set(parsed.threadId, parsed.turnId);
        const item = parsed.item;
        if (item.type === 'fileChange' && 'changes' in item)
          this.targets.set(item.id, {
            kind: 'fileChange',
            paths: item.changes.map((change) => change.path),
          });
        if (item.type === 'mcpToolCall' && 'server' in item && 'tool' in item)
          this.targets.set(item.id, {
            kind: 'mcpElicitation',
            server: item.server,
            tool: item.tool,
          });
      }
    }
    if (frame.method === 'turn/started') {
      const parsed = codexNotificationSchemas['turn/started'].parse(
        frame.params,
      );
      const knownParent = this.knownChildParents.get(parsed.threadId);
      if (knownParent && !this.childTools.has(parsed.threadId))
        this.linkChild(parsed.threadId, knownParent);
      if (
        parsed.threadId === this.identity.threadId &&
        !this.terminalTurns.has(parsed.turn.id)
      ) {
        if (this.state === 'idle')
          this.activeTurnPermissionLevel = this.wirePermissionLevel;
        this.activeTurn = parsed.turn.id;
        this.state = 'running';
      }
      if (this.childTools.has(parsed.threadId))
        this.childTurns.set(parsed.threadId, parsed.turn.id);
    }
    for (const event of this.translator.translate(frame)) {
      const parentToolUseId = childEventParent(
        event.threadId, this.identity.threadId, this.childTools,
      );
      if (parentToolUseId === null) {
        this.bufferEarlyChild(event);
        continue;
      }
      if (parentToolUseId === undefined && this.terminalTurns.has(event.turnId))
        continue;
      if (event.type === 'toolStarted' && event.toolName === 'spawnAgent') {
        const pending = this.pendingSpawns.get(event.threadId) ?? new Set<string>();
        pending.add(event.toolId);
        this.pendingSpawns.set(event.threadId, pending);
      }
      if (event.type === 'toolCompleted')
        this.pendingSpawns.get(event.threadId)?.delete(event.toolId);
      this.admitEvent(event, parentToolUseId);
      if ((event.type === 'toolStarted' || event.type === 'toolCompleted') &&
        event.agentThreadIds) {
        for (const childId of event.agentThreadIds) {
          if (childId !== this.identity.threadId && childId !== event.threadId)
            this.linkChild(childId, event.toolId);
        }
      }
    }
  }

  private linkChild(threadId: string, toolId: string): void {
    if (!this.knownChildParents.has(threadId) &&
      this.knownChildParents.size >= 256) {
      const oldest = this.knownChildParents.keys().next().value;
      if (oldest) this.knownChildParents.delete(oldest);
      this.options.logger.error(
        'Codex child thread linkage cache limit reached',
        { reason: 'Oldest inactive child linkage was removed' },
      );
    }
    this.knownChildParents.set(threadId, toolId);
    this.childTools.set(threadId, toolId);
    const buffered = this.earlyChildEvents.get(threadId) ?? [];
    this.earlyChildEvents.delete(threadId);
    this.earlyChildCount -= buffered.length;
    for (const event of buffered) {
      const parentToolUseId = this.childTools.get(threadId);
      if (parentToolUseId) this.admitEvent(event, parentToolUseId);
    }
  }

  private bufferEarlyChild(event: CodexRuntimeEvent): void {
    const current = this.earlyChildEvents.get(event.threadId);
    if (this.earlyChildCount >= 64 ||
      (!current && this.earlyChildEvents.size >= 8)) {
      // One report per root turn: a still-running unlinked child keeps
      // dropping events, and per-event logging would flood the log.
      if (!this.earlyChildOverflowLogged) {
        this.earlyChildOverflowLogged = true;
        this.options.logger.error(
          'Codex early child event buffer overflow',
          { reason: 'Native child linkage was not reported within the buffer limit' },
        );
      }
      return;
    }
    const buffer = current ?? [];
    buffer.push(event);
    this.earlyChildEvents.set(event.threadId, buffer);
    this.earlyChildCount++;
  }

  private admitEvent(
    event: CodexRuntimeEvent,
    parentToolUseId: string | undefined,
  ): void {
      if (event.type === 'terminal') {
        if (parentToolUseId !== undefined) {
          this.emit({ ...event, parentToolUseId });
          this.childTools.delete(event.threadId);
          this.childTurns.delete(event.threadId);
          this.pendingSpawns.delete(event.threadId);
          if (this.rootTerminalPending && this.childTools.size === 0)
            this.finishActiveTurn();
          return;
        }
        this.terminalTurns.add(event.turnId);
        if (event.turnId === this.activeTurn) {
          if (this.childTools.size > 0 && event.status === 'completed') {
            this.rootTerminalPending = true;
            this.rootTerminalTimer = setTimeout(() => this.finishActiveTurn(), 30_000);
          } else this.finishActiveTurn();
        }
        this.finishCompact?.();
        this.earlyChildEvents.clear();
        this.earlyChildCount = 0;
        this.earlyChildOverflowLogged = false;
      }
      if (parentToolUseId === undefined && event.type === 'compaction' &&
        event.phase !== 'started')
        this.finishCompact?.();
      if (
        event.type === 'userInputAsync' &&
        (this.profile.consumer === 'chat' || this.profile.consumer === 'gateway')
      ) {
        const questionKey = `${event.threadId}:${event.itemId}`;
        if (this.asyncQuestionItems.has(questionKey)) {
          this.warnAsyncQuestion('duplicate');
          return;
        }
        this.asyncQuestionItems.add(questionKey);
        const card = event.presentation !== 'text' && this.askAsyncUserInput(event);
        if (!card)
          this.warnAsyncQuestion(
            event.presentation === 'text' ? 'already-streamed' : 'card-unavailable',
          );
        this.emit({
          ...event,
          ...(parentToolUseId === undefined ? {} : { parentToolUseId }),
          presentation: card ? 'card' : 'text',
          text: event.text || event.questions.map((question) => question.title).join('\n'),
        });
      } else this.emit(parentToolUseId === undefined ? event : { ...event, parentToolUseId });
  }

  private finishActiveTurn(): void {
    clearTimeout(this.rootTerminalTimer);
    this.rootTerminalTimer = undefined;
    this.rootTerminalPending = false;
    this.asyncQuestionItems.clear();
    this.activeTurn = undefined;
    this.activeTurnPermissionLevel = undefined;
    this.targets.clear();
    this.childTools.clear();
    this.childTurns.clear();
    this.pendingSpawns.clear();
    this.turnController.abort();
    this.releaseTurnSignal?.();
    this.releaseTurnSignal = undefined;
    clearTimeout(this.interruptTimer);
    this.interruptTimer = undefined;
    if (this.state !== 'closed') this.state = 'idle';
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operation.then(() => {
      this.assertOpen();
      return operation();
    });
    // degradation-audit: reported - The original next promise is returned to the caller with its rejection intact; only the admission queue recovers.
    this.operation = next.catch(() => undefined);
    return next;
  }

  private assertOpen(): void {
    if (this.state === 'closed' || this.state === 'opening')
      throw new CodexContextStateError(this.state);
  }

  private isClosed(): boolean {
    return this.state === 'closed';
  }

  startTurn(input: CodexTurnInput): Promise<CodexTurnReceipt> {
    return this.serialize(() => this.start(input));
  }

  private wireInput(
    input: CodexTurnInput,
    initial = false,
  ): CodexRequestParams<'turn/start'>['input'] {
    if (input.signal?.aborted) throw new Error('Codex turn aborted');
    if (typeof input.text !== 'string') throw new Error('Invalid Codex input');
    const text =
      initial &&
      this.profile.enhancedPrompt &&
      this.profile.enhancedPrompt !== input.text
        ? `${this.profile.enhancedPrompt}\n\n${input.text}`
        : input.text;
    return [
      { type: 'text', text },
      ...(input.attachments ?? (initial ? this.profile.attachments : [])).map(
        (attachment) =>
          attachment.type === 'image'
            ? {
                type: 'image' as const,
                url: `data:${attachment.mediaType};base64,${attachment.data}`,
              }
            : {
                type: 'mention' as const,
                name: attachment.path,
                path: attachment.path,
              },
      ),
    ];
  }

  private async start(input: CodexTurnInput): Promise<CodexTurnReceipt> {
    if (this.state !== 'idle') throw new Error('Codex turn is already active');
    const level = this.settings.permissionLevel ?? this.profile.permissionLevel;
    const levelPolicy = this.levelPolicy;
    const params = codexRequestSchemas['turn/start'].params.parse({
      threadId: this.identity.threadId,
      input: this.wireInput(input, !this.sentInitialInput),
      ...(this.settings.model === undefined ? {} : { model: this.settings.model }),
      effort: this.settings.effort ?? null,
      approvalPolicy: levelPolicy.approvalPolicy,
      approvalsReviewer: 'user',
      cwd: this.profile.cwd,
      sandboxPolicy:
        levelPolicy.sandboxPolicy.mode === 'workspace-write'
          ? {
              type: 'workspaceWrite',
              networkAccess: levelPolicy.sandboxPolicy.networkAccess,
              writableRoots: [...levelPolicy.sandboxPolicy.writableRoots],
            }
          : levelPolicy.sandboxPolicy.mode === 'danger-full-access'
            ? { type: 'dangerFullAccess' }
            : { type: 'readOnly', networkAccess: false },
    });
    const previousWirePermissionLevel = this.wirePermissionLevel;
    this.activeTurnPermissionLevel = level;
    this.state = 'running';
    this.turnController = new AbortController();
    this.turnRevision = this.revision;
    const previousThreadModel = this.translator.threadModel(this.identity.threadId);
    try {
      this.wirePermissionLevel = level;
      // Usage notifications may arrive before the turn/start response. The
      // validated request is the effective model for this accepted turn.
      if (params.model) this.translator.setThreadModel(this.identity.threadId, params.model);
      const result = await this.process.request('turn/start', params);
      const turnId = result.turn.id;
      if (params.model) this.translator.setTurnModel(this.identity.threadId, turnId, params.model);
      this.sentInitialInput = true;
      this.turnHistory = true;
      this.assertOpen();
      if (!this.terminalTurns.has(turnId)) {
        this.activeTurn = turnId;
        this.bindTurnSignal(input.signal, turnId);
      }
      if (result.turn.status !== 'inProgress')
        this.onNotification({
          method: 'turn/completed',
          params: { threadId: this.identity.threadId, turn: result.turn },
        });
      return {
        threadId: this.identity.threadId,
        turnId,
        revision: this.turnRevision,
      };
    } catch (error) {
      if (error instanceof CodexRequestRejectedError ||
          error instanceof CodexUnsupportedMethodError) {
        if (!this.activeTurn) {
          // The rejected turn never ran, so later usage must not use its model.
          if (params.model)
            this.translator.restoreThreadModel(this.identity.threadId, previousThreadModel);
          this.wirePermissionLevel = previousWirePermissionLevel;
          this.state = 'idle';
          this.activeTurnPermissionLevel = undefined;
        }
        throw error;
      }
      this.onFailure();
      throw new Error('Codex turn start failed');
    }
  }

  /** Report a refused live follow-up once to the event stream. */
  private emitFollowUpRejected(turnId: string): void {
    // A late rejection must not follow the turn's terminal event.
    if (this.state === 'closed' || this.terminalTurns.has(turnId))
      return;
    this.emit({
      ...this.identity,
      turnId,
      sequence: 0,
      type: 'error',
      error: {
        code: 'codexFollowUpRejected',
        message: 'Codex rejected the follow-up instruction.',
        retryable: true,
      },
    });
  }

  /** Deliver denial feedback or a question answer to the same live turn. */
  private deliverDenialFeedback(
    text: string,
    turnId: string,
    kind: 'denial' | 'user-input' = 'denial',
  ): Promise<void> {
    return this.serialize(async () => {
      if (
        this.state !== 'running' ||
        this.activeTurn !== turnId ||
        this.terminalTurns.has(turnId)
      ) {
        this.warnDenialFeedback('turn-ended', kind);
        return;
      }
      try {
        const steered = await this.process.request('turn/steer', {
          threadId: this.identity.threadId,
          expectedTurnId: turnId,
          input: this.wireInput({ text }),
        });
        if (steered.turnId !== turnId) {
          this.warnDenialFeedback('failed', kind);
          if (kind === 'user-input') this.emitFollowUpRejected(turnId);
        }
      } catch (error) {
        // degradation-audit: reported - A failed steer is logged without exposing the user's text.
        this.warnDenialFeedback(
          error instanceof CodexRequestRejectedError ||
            error instanceof CodexUnsupportedMethodError ? 'refused' : 'failed',
          kind,
        );
        if (kind === 'user-input' &&
            (error instanceof CodexRequestRejectedError ||
              error instanceof CodexUnsupportedMethodError))
          this.emitFollowUpRejected(turnId);
      }
    }).catch(() => {
      // degradation-audit: reported - A closed context cannot receive feedback; report the delivery failure.
      this.warnDenialFeedback('failed', kind);
    });
  }

  /** The native async question is an item, so its answer must steer the same live turn. */
  private askAsyncUserInput(
    event: Extract<CodexRuntimeEvent, { type: 'userInputAsync' }>,
  ): boolean {
    const ask = this.options.requestUserInput;
    if (!ask || this.state !== 'running' || this.activeTurn !== event.turnId || this.turnController.signal.aborted)
      return false;
    const ids = event.questions.map((_, index) => `${event.itemId}:${index}`);
    const request: CodexApprovalRequest = {
      ...this.identity,
      turnId: event.turnId,
      requestId: event.itemId,
      kind: 'userInput',
      normalizedHome: this.profile.normalizedHome,
      workspaceId: this.profile.workspaceId,
      providerId: this.profile.providerId,
      message: event.text,
      details: {
        questions: event.questions.map((question, index) => ({
          id: ids[index],
          header: '',
          question: question.title,
          options: (question.options ?? []).map((label) => ({
            label,
            description: '',
          })),
        })),
      },
    };
    const signal = this.turnController.signal;
    let response: ReturnType<NonNullable<CodexRuntimeOptions['requestUserInput']>>;
    try {
      response = ask(request, signal);
    } catch {
      // degradation-audit: reported - the failure is logged by
      // warnDenialFeedback and false sends the question to the text fallback.
      this.warnDenialFeedback('failed', 'user-input');
      return false;
    }
    void response.then((answers) => {
      if (signal.aborted) {
        this.warnDenialFeedback('turn-ended', 'user-input');
        return;
      }
      if (!answers) {
        this.warnDenialFeedback('dismissed', 'user-input');
        return;
      }
      const pairs = event.questions.flatMap((question, index) => {
        const answer = answers[ids[index]]?.answers[0];
        return answer === undefined
          ? []
          : [`${JSON.stringify(question.title)}=${JSON.stringify(answer)}`];
      });
      if (!pairs.length) {
        this.warnDenialFeedback('dismissed', 'user-input');
        return;
      }
      const text = `User has answered your questions: ${pairs.join(', ')}. You can now continue with the user's answers in mind.`;
      void this.deliverDenialFeedback(text, event.turnId, 'user-input');
    }).catch(() => {
      if (!signal.aborted) this.warnDenialFeedback('failed', 'user-input');
    });
    return true;
  }

  private warnAsyncQuestion(cause: 'duplicate' | 'already-streamed' | 'card-unavailable'): void {
    this.options.logger.warn('Codex async question used text presentation or was already presented.', {
      code: 'codex-user-input-text-fallback', cause,
    });
  }

  private warnDenialFeedback(
    cause: 'turn-ended' | 'refused' | 'failed' | 'dismissed',
    kind: 'denial' | 'user-input' = 'denial',
  ): void {
    this.options.logger.warn(kind === 'denial'
      ? 'Codex denial feedback was not delivered.'
      : 'Codex user answer was not delivered.', {
      code: kind === 'denial'
        ? 'codex-denial-feedback-undelivered'
        : 'codex-user-input-undelivered',
      cause,
    });
  }

  steer(input: CodexTurnInput): Promise<CodexTurnReceipt> {
    return this.serialize(async () => {
      if (this.state === 'idle') return this.start(input);
      if (this.state !== 'running' || !this.activeTurn)
        throw new Error('Codex turn cannot be steered');
      const expectedTurnId = this.activeTurn;
      const wireInput = this.wireInput(input);
      try {
        const result = await this.process.request('turn/steer', {
          threadId: this.identity.threadId,
          expectedTurnId,
          input: wireInput,
        });
        if (result.turnId !== expectedTurnId)
          throw new Error('Codex steer identity mismatch');
        this.assertOpen();
        return {
          threadId: this.identity.threadId,
          turnId: result.turnId,
          revision: this.turnRevision,
        };
      } catch (error) {
        if (error instanceof CodexRequestRejectedError ||
            error instanceof CodexUnsupportedMethodError) throw error;
        this.onFailure();
        throw new Error('Codex steer failed');
      }
    });
  }

  private bindTurnSignal(
    signal: AbortSignal | undefined,
    turnId: string,
  ): void {
    if (!signal) return;
    const abort = () => {
      void this.interrupt(turnId).catch((error: unknown) => {
        if (!(error instanceof CodexRequestRejectedError ||
              error instanceof CodexUnsupportedMethodError)) this.onFailure();
      });
    };
    signal.addEventListener('abort', abort, { once: true });
    this.releaseTurnSignal = () => signal.removeEventListener('abort', abort);
    if (signal.aborted) abort();
  }

  interrupt(turnId: string): Promise<boolean> {
    return this.serialize(async () => {
      if (this.activeTurn !== turnId) return false;
      this.state = 'interrupting';
      clearTimeout(this.interruptTimer);
      this.interruptTimer = setTimeout(() => this.onFailure(), 30_000);
      // Invalidate pending UI answers before asking the server to interrupt.
      this.turnController.abort();
      try {
        await this.process.request('turn/interrupt', {
          threadId: this.identity.threadId,
          turnId,
        });
        // An RPC acknowledgement is not proof of terminal state. Admission remains blocked.
        return true;
      } catch (error) {
        if (error instanceof CodexRequestRejectedError ||
            error instanceof CodexUnsupportedMethodError) {
          clearTimeout(this.interruptTimer);
          this.interruptTimer = undefined;
          if (this.activeTurn === turnId) {
            this.state = 'running';
            this.turnController = new AbortController();
          }
          if (error instanceof CodexUnsupportedMethodError) return false;
          throw error;
        }
        this.onFailure();
        return false;
      }
    });
  }

  updateNextTurn(patch: CodexTurnSettings): Promise<AppliedSettings> {
    return this.serialize(async () => {
      const parsed = z
        .strictObject({
          model: z.string().trim().min(1).optional(),
          effort: z.string().trim().min(1).optional(),
          permissionLevel: z
            .enum(['ask', 'plan', 'auto-edit', 'yolo'])
            .optional(),
        })
        .safeParse(patch);
      if (!parsed.success) throw new Error('Invalid Codex turn settings');
      const level = parsed.data.permissionLevel;
      let nextPolicy = this.levelPolicy;
      if (level !== undefined && level !== this.settings.permissionLevel) {
        nextPolicy = resolveCodexLevelPolicy(
          this.profile.consumer,
          level,
          this.profile.cwd,
          this.profile.codexSandboxMode,
        );
        const nextIdentity: CodexThreadIdentity = Object.freeze({
          ...this.identity,
          profileFingerprint: codexProfileFingerprint({
            permissionLevel: level,
            codexSandboxMode: this.profile.codexSandboxMode,
            ...nextPolicy,
          }),
        });
        const nextSettings: CodexTurnSettings = {
          ...this.settings,
          ...(parsed.data.model !== undefined
            ? { model: parsed.data.model }
            : {}),
          ...('effort' in patch ? { effort: parsed.data.effort } : {}),
          permissionLevel: level,
        };
        this.persistence = this.options.store.persist(nextIdentity).then(async () => {
          if (this.isClosed()) {
            try {
              await this.options.store.markInactive(nextIdentity);
            } catch {
              this.options.logger.error(
                'Codex identity could not be marked inactive',
              );
            }
            throw new Error('Codex context closed');
          }
          this.committedIdentity = nextIdentity;
          this.settings = nextSettings;
          this.levelPolicy = nextPolicy;
        });
        await this.persistence;
        if (this.isClosed()) throw new Error('Codex context closed');
      } else {
        this.settings = {
          ...this.settings,
          ...(parsed.data.model !== undefined
            ? { model: parsed.data.model }
            : {}),
          ...('effort' in patch ? { effort: parsed.data.effort } : {}),
          ...(level !== undefined ? { permissionLevel: level } : {}),
        };
      }
      return { timing: 'nextTurn', revision: ++this.revision };
    });
  }

  listModels(): Promise<readonly CodexModelInfo[]> {
    return this.serialize(async () => {
      const models: CodexModelInfo[] = [];
      const cursors = new Set<string>();
      let cursor: string | undefined;
      try {
        for (let page = 0; page < 100; page++) {
          const result = await this.process.request('model/list', {
            limit: 100,
            ...(cursor !== undefined ? { cursor } : {}),
          });
          this.assertOpen();
          // Keep the public catalog shape stable as newer servers omit metadata.
          models.push(
            ...result.data.map((model) => ({
              id: model.id,
              model: model.model,
              displayName: model.displayName || model.model,
              description: model.description,
              isDefault: model.isDefault ?? false,
              supportedEfforts: (model.supportedReasoningEfforts ?? []).map(
                (effort) => effort.reasoningEffort,
              ),
            })),
          );
          if (result.nextCursor == null) return models;
          if (cursors.has(result.nextCursor)) break;
          cursors.add(result.nextCursor);
          cursor = result.nextCursor;
        }
        throw new Error('Codex model pagination limit reached');
      } catch (error: unknown) {
        if (error instanceof CodexUnsupportedMethodError) throw error;
        throw new Error('Codex model listing failed', { cause: error });
      }
    });
  }

  private resetCompactWatchdog(): void {
    clearTimeout(this.compactTimer);
    // Summarization can be silent for a long time; only a long quiet period means a hang.
    this.compactTimer = setTimeout(() => this.onFailure(), 120_000);
  }

  compact(): Promise<void> {
    if (this.compacting) return this.compacting;
    this.compacting = this.serialize(async () => {
      if (this.state !== 'idle')
        throw new Error('Codex compaction requires an idle context');
      const completed = new Promise<void>((resolve) => {
        this.finishCompact = resolve;
      });
      this.resetCompactWatchdog();
      try {
        await this.process.request('thread/compact/start', {
          threadId: this.identity.threadId,
        });
        await completed;
        this.assertOpen();
      } catch (error) {
        if (error instanceof CodexRequestRejectedError ||
            error instanceof CodexUnsupportedMethodError) throw error;
        this.onFailure();
        throw new Error('Codex compaction failed');
      } finally {
        clearTimeout(this.compactTimer);
        this.compactTimer = undefined;
        this.finishCompact = undefined;
      }
    }).finally(() => {
      this.compacting = undefined;
    });
    return this.compacting;
  }

  private readonly onFailure = (): void => {
    if (this.state !== 'closed') void this.close();
  };

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.state = 'closed';
    clearTimeout(this.compactTimer);
    clearTimeout(this.rootTerminalTimer);
    this.rootTerminalTimer = undefined;
    this.compactTimer = undefined;
    clearTimeout(this.interruptTimer);
    this.interruptTimer = undefined;
    this.turnController.abort();
    this.finishCompact?.();
    this.bridge?.dispose();
    this.releaseTurnSignal?.();
    this.releaseTurnSignal = undefined;
    for (const timer of this.followUps) clearImmediate(timer);
    this.followUps.clear();
    if (this.activeTurn && !this.terminalTurns.has(this.activeTurn)) {
      this.terminalTurns.add(this.activeTurn);
      this.emit({
        ...this.identity,
        turnId: this.activeTurn,
        sequence: 0,
        type: 'terminal',
        status: 'failed',
        error: {
          code: 'codexContextClosed',
          message: 'Codex execution ended before completion.',
          retryable: false,
        },
      });
    }
    this.activeTurn = undefined;
    this.activeTurnPermissionLevel = undefined;
    this.translator.dispose();
    this.targets.clear();
    this.childTools.clear();
    this.childTurns.clear();
    this.knownChildParents.clear();
    this.pendingSpawns.clear();
    this.earlyChildEvents.clear();
    this.earlyChildCount = 0;
    this.earlyChildOverflowLogged = false;
    for (const subscriber of this.subscribers) subscriber.release();
    this.closing = this.finishClose();
    return this.closing;
  }

  private async finishClose(): Promise<void> {
    await this.process.close();
    this.child?.off('exit', this.onFailure);
    this.child?.off('close', this.onFailure);
    this.child?.off('error', this.onFailure);
    this.child?.stdin?.off('finish', this.onFailure);
    try {
      await this.persistence;
    } catch {
      /* Failed persistence never adopts the orphan. */
    }
    if (this.committedIdentity) {
      try {
        await this.options.store.markInactive(this.committedIdentity);
      } catch {
        this.options.logger.error(
          'Codex identity could not be marked inactive',
        );
      }
    }
    this.release();
  }
}

export { RuntimeContext };
