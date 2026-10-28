import type { SpawnedProcessHandle } from '@ptah-extension/platform-core';
import { z } from 'zod';
import { redactCodexDiagnostics } from './codex-stderr-tail';
import {
  CodexAppServerProcess,
  CodexHomeMismatchError,
  CodexProcessFailureError,
  CodexRequestRejectedError,
  type CodexAppServerHandlers,
} from './codex-app-server-process';
import {
  CodexApprovalBridge,
  type CodexApprovalBridgeOptions,
} from './codex-approval-bridge';
import { CodexEventTranslator } from './codex-event-translator';
import { buildCodexMcpConfigOverrides } from './codex-mcp-config';
import {
  CodexPermissionRuleStore,
  type CodexPermissionRuleTarget,
} from './codex-permission-rule-store';
import type { CodexBinaryIdentity } from './codex-protocol-manifest';
import {
  CodexProtocolError,
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
  CodexModelInfo,
  CodexExecutionProfile,
  CodexJsonValue,
  CodexMcpSecrets,
  CodexRuntime as RuntimePort,
  CodexRuntimeEvent,
  CodexThreadIdentity,
  CodexTurnInput,
  CodexTurnReceipt,
  CodexTurnSettings,
} from './codex-runtime.types';

export interface CodexRuntimeOptions {
  readonly spawner: IProcessSpawner;
  readonly executable: CodexExecutableSource;
  readonly binary: CodexBinaryIdentity;
  readonly store: CodexThreadIdentityStore;
  readonly sink: ApprovalSink;
  readonly clock: Clock;
  readonly logger: CodexRuntimeLogger;
  readonly requestUserInput?: CodexApprovalBridgeOptions['requestUserInput'];
}

/** Host-owned instance; contexts share only the scoped, in-memory permission rules. */
export class CodexRuntime implements RuntimePort {
  private readonly contexts = new Map<string, RuntimeContext>();
  private readonly generations = new Map<string, number>();
  private readonly rules = new CodexPermissionRuleStore();
  private closed = false;

  constructor(private readonly options: CodexRuntimeOptions) {}

  async open(
    profile: CodexExecutionProfile,
    resume?: CodexThreadIdentity,
    secrets?: CodexMcpSecrets,
  ): Promise<CodexContext> {
    if (this.closed) throw new Error('Codex runtime is closed');
    if (this.contexts.has(profile.contextId))
      throw new Error('Codex context is already open');
    if (!this.options.sink || typeof this.options.sink.request !== 'function')
      throw new Error('Codex approval presentation is required');
    if (
      resume &&
      (
        [
          'contextId',
          'normalizedHome',
          'providerId',
          'workspaceId',
          'profileFingerprint',
        ] as const
      ).some((key) => resume[key] !== profile[key])
    )
      throw new Error('Codex resume identity mismatch');
    // Lane budget/tool enforcement is not present at this boundary; MCP
    // servers are applied natively as config overrides on the thread frame.
    if (
      profile.lane?.suppressedTools.length ||
      profile.lane?.maxTurns ||
      profile.lane?.maxBudgetUsd ||
      profile.lane?.explicitFullAccess
    )
      throw new Error(
        'Codex profile requires unsupported runtime configuration',
      );
    // Built before any spawn; an unresolved secret reference refuses the open.
    const mcpConfig = buildCodexMcpConfigOverrides(profile.mcpServers, secrets);
    const generation =
      Math.max(
        this.generations.get(profile.contextId) ?? 0,
        resume?.processGeneration ?? 0,
      ) + 1;
    this.generations.set(profile.contextId, generation);
    const context = new RuntimeContext(
      this.options,
      this.rules,
      profile,
      generation,
      mcpConfig,
      () => {
        if (this.contexts.get(profile.contextId) === context)
          this.contexts.delete(profile.contextId);
      },
    );
    this.contexts.set(profile.contextId, context);
    try {
      await context.open(resume);
      return context;
    } catch (error) {
      await context.close();
      const method =
        error instanceof CodexProcessFailureError ||
        error instanceof CodexRequestRejectedError ||
        error instanceof CodexProtocolError
          ? error.method
          : undefined;
      let root: unknown = error;
      const seen = new Set<unknown>();
      while (
        root instanceof Error &&
        root.cause !== undefined &&
        !seen.has(root)
      ) {
        seen.add(root);
        root = root.cause;
      }
      this.options.logger.error('Codex context could not be opened', {
        errorClass:
          error instanceof Error ? error.constructor.name : typeof error,
        errorMessage: diagnosticMessage(error),
        ...(method ? { failedMethod: redactCodexDiagnostics(method) } : {}),
        ...(error instanceof CodexRequestRejectedError
          ? { rpcCode: error.rpcCode }
          : {}),
        ...(root !== error
          ? {
              rootCauseClass:
                root instanceof Error ? root.constructor.name : typeof root,
              rootCauseMessage: diagnosticMessage(root),
            }
          : {}),
        stderrTail: context.stderrTail(2048),
      });
      if (error instanceof CodexHomeMismatchError) throw error;
      throw new Error('Codex context could not be opened', { cause: error });
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.all(
      [...this.contexts.values()].map((context) => context.close()),
    );
    this.rules.dispose();
  }
}

// JSON parser errors may quote a raw protocol frame. Never send that text to logs.
function diagnosticMessage(error: unknown): string {
  if (error instanceof SyntaxError) return 'Invalid JSON';
  return error instanceof Error
    ? redactCodexDiagnostics(error.message)
    : 'Non-Error failure';
}

interface Subscriber {
  readonly queue: CodexRuntimeEvent[];
  wake: () => void;
  closed: boolean;
  release: () => void;
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
  private sequence = 0;
  private revision = 0;
  private turnRevision = 0;
  private sentInitialInput = false;
  private settings: CodexTurnSettings;
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

  constructor(
    private readonly options: CodexRuntimeOptions,
    private readonly rules: CodexPermissionRuleStore,
    private readonly profile: CodexExecutionProfile,
    private readonly generation: number,
    /** Resolved MCP config overrides; dropped once the start/resume frame is sent. */
    private mcpConfig: Record<string, CodexJsonValue> | undefined,
    private readonly release: () => void,
  ) {
    this.settings = {
      model: profile.model,
      effort: profile.effort,
      permissionLevel: profile.permissionLevel,
    };
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
      options.binary,
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
          const result = await this.bridge.handle(
            frame,
            this.activeTurn,
            AbortSignal.any([signal, this.turnController.signal]),
          );
          if (result.followUpMessage !== undefined) {
            const text = result.followUpMessage;
            const turnId = this.activeTurn;
            // dispatchApproval writes the returned response in its promise continuation.
            // The next event-loop check phase is strictly after that microtask writer.
            const handle = setImmediate(() => {
              this.followUps.delete(handle);
              if (this.state === 'closed' || signal.aborted) return;
              void this.steer({ text }).catch((error: unknown) => {
                if (error instanceof CodexRequestRejectedError) {
                  // The turn already ended; a late rejection must not follow its terminal.
                  if (turnId !== undefined && this.terminalTurns.has(turnId))
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
                } else this.onFailure();
              });
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

  async open(resume?: CodexThreadIdentity): Promise<void> {
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
    const mcpConfig = this.mcpConfig;
    const params = codexRequestSchemas['thread/start'].params.parse({
      cwd: this.profile.cwd,
      model: this.profile.model,
      approvalPolicy: this.profile.approvalPolicy,
      approvalsReviewer: 'user',
      sandbox: this.profile.sandboxPolicy.mode,
      ...(this.profile.systemPrompt !== undefined
        ? { baseInstructions: this.profile.systemPrompt }
        : {}),
      ...(instructions ? { developerInstructions: instructions } : {}),
      ...(mcpConfig && Object.keys(mcpConfig).length > 0
        ? { config: mcpConfig }
        : {}),
    });
    const result = resume
      ? await this.process.request('thread/resume', {
          ...params,
          threadId: resume.threadId,
        })
      : await this.process.request('thread/start', params);
    // The sent frame was the secrets' only destination; the context drops them.
    this.mcpConfig = undefined;
    if (resume && result.thread.id !== resume.threadId)
      throw new Error('Codex resumed a different thread');
    if (this.isClosed()) throw new Error('Codex context closed');
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
      permissionLevel: () => this.profile.permissionLevel,
      isCurrent: (correlation) =>
        this.state === 'running' &&
        correlation.turnId === this.activeTurn &&
        correlation.processGeneration === this.generation,
      isWritable: () => this.state !== 'closed',
      close: this.onFailure,
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
        parsed.threadId === this.identity.threadId &&
        parsed.turnId === this.activeTurn
      ) {
        const item = parsed.item;
        if (item.type === 'fileChange')
          this.targets.set(item.id, {
            kind: 'fileChange',
            paths: item.changes.map((change) => change.path),
          });
        if (item.type === 'mcpToolCall')
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
      if (
        parsed.threadId === this.identity.threadId &&
        !this.terminalTurns.has(parsed.turn.id)
      ) {
        this.activeTurn = parsed.turn.id;
        this.state = 'running';
      }
    }
    for (const event of this.translator.translate(frame)) {
      if (
        event.threadId !== this.identity.threadId ||
        this.terminalTurns.has(event.turnId)
      )
        continue;
      if (event.type === 'terminal') {
        this.terminalTurns.add(event.turnId);
        if (event.turnId === this.activeTurn) {
          this.activeTurn = undefined;
          this.targets.clear();
          this.turnController.abort();
          this.releaseTurnSignal?.();
          this.releaseTurnSignal = undefined;
          clearTimeout(this.interruptTimer);
          this.interruptTimer = undefined;
          this.state = 'idle';
        }
        this.finishCompact?.();
      }
      if (event.type === 'compaction' && event.phase !== 'started')
        this.finishCompact?.();
      this.emit(event);
    }
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
      throw new Error('Codex context is not ready');
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
    const params = codexRequestSchemas['turn/start'].params.parse({
      threadId: this.identity.threadId,
      input: this.wireInput(input, !this.sentInitialInput),
      model: this.settings.model,
      effort: this.settings.effort ?? null,
      approvalPolicy: this.profile.approvalPolicy,
      approvalsReviewer: 'user',
      cwd: this.profile.cwd,
      sandboxPolicy:
        this.profile.sandboxPolicy.mode === 'workspace-write'
          ? {
              type: 'workspaceWrite',
              networkAccess: this.profile.sandboxPolicy.networkAccess,
              writableRoots: [...this.profile.sandboxPolicy.writableRoots],
            }
          : { type: 'readOnly', networkAccess: false },
    });
    this.state = 'running';
    this.turnController = new AbortController();
    this.turnRevision = this.revision;
    try {
      const result = await this.process.request('turn/start', params);
      const turnId = result.turn.id;
      this.sentInitialInput = true;
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
      if (error instanceof CodexRequestRejectedError) {
        if (!this.activeTurn) this.state = 'idle';
        throw error;
      }
      this.onFailure();
      throw new Error('Codex turn start failed');
    }
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
        if (error instanceof CodexRequestRejectedError) throw error;
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
        if (!(error instanceof CodexRequestRejectedError)) this.onFailure();
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
        if (error instanceof CodexRequestRejectedError) {
          clearTimeout(this.interruptTimer);
          this.interruptTimer = undefined;
          if (this.activeTurn === turnId) {
            this.state = 'running';
            this.turnController = new AbortController();
          }
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
      if (
        patch.permissionLevel !== undefined &&
        patch.permissionLevel !== this.profile.permissionLevel
      )
        throw new Error(
          'Codex permission transition requires verified reconfiguration',
        );
      this.settings = {
        ...this.settings,
        ...(parsed.data.model !== undefined
          ? { model: parsed.data.model }
          : {}),
        ...('effort' in patch ? { effort: parsed.data.effort } : {}),
      };
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
          // Catalog id, displayName, description and isDefault pass through;
          // supportedReasoningEfforts[].reasoningEffort becomes supportedEfforts.
          models.push(
            ...result.data.map((model) => ({
              id: model.id,
              model: model.model,
              displayName: model.displayName,
              description: model.description,
              isDefault: model.isDefault,
              supportedEfforts: model.supportedReasoningEfforts.map(
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
      } catch {
        throw new Error('Codex model listing failed');
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
        if (error instanceof CodexRequestRejectedError) throw error;
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
    this.translator.dispose();
    this.targets.clear();
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
