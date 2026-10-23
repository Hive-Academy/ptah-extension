import { createHash, randomUUID } from 'node:crypto';
import { createNamedAccountPromptGate } from '@ptah-extension/agent-sdk';
import type {
  SDKUserMessage,
  SessionMetadata,
} from '@ptah-extension/agent-sdk';
import type {
  ProviderAccountBinding,
  ProviderAccountIdentityEvidence,
} from '@ptah-extension/shared';
import type {
  ClaudeAccountNamedRoute,
  ClaudeAccountRunReservation,
  ProviderAccountAdmissionPort,
} from '@ptah-extension/auth-providers-tokens';
import type {
  LaneAccountBindingPort,
  LaneAccountReference,
} from '../cli-agents/cli-adapters/cli-adapter.interface';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  Options,
  SdkModuleLoader,
  SdkMessageTransformer,
} from '@ptah-extension/agent-sdk';
import type { SdkHandle } from '../cli-agents/cli-adapters';
import {
  PtahCliStreamLoop,
  type PtahCliStreamLoopConfig,
} from '../ptah-cli/helpers/ptah-cli-stream-loop.service';
import {
  isPlanBilledLaneProvider,
  type PtahCliLanePlanLimits,
} from '../ptah-cli/helpers/ptah-cli-lane-plan-limits';
import type { PromptMailbox } from '../ptah-cli/helpers/ptah-cli-prompt-mailbox';

type LaneQueryFunction = Awaited<
  ReturnType<SdkModuleLoader['getQueryFunction']>
>;
export interface ClaudeSdkLaneRunContext {
  queryFn: LaneQueryFunction;
  options: Options & { abortController: AbortController };
  mailbox: PromptMailbox;
  named?: ClaudeNamedLaneAdmission;
  providerId: string;
  agentName: string;
  agentIdHolder: { value?: string };
  lanePlanLimits: Pick<
    PtahCliLanePlanLimits,
    'attach' | 'onSystemInit' | 'onSignal' | 'end' | 'settled'
  >;
  outputCallbacks: Array<(data: string) => void>;
  onSegment: NonNullable<SdkHandle['onSegment']>;
  onStreamEvent: NonNullable<SdkHandle['onStreamEvent']>;
  emitOutput: PtahCliStreamLoopConfig['emitOutput'];
  emitSegment: PtahCliStreamLoopConfig['emitSegment'];
  emitStreamEvent: PtahCliStreamLoopConfig['emitStreamEvent'];
  disposeCallbacks: () => void;
  stopProxy: () => Promise<void>;
}

/** One native query and stream loop per spawn; no provider/config fabrication. */
export class ClaudeSdkLaneRunner {
  constructor(
    private readonly logger: Logger,
    private readonly messageTransformer: SdkMessageTransformer,
  ) {}

  run(context: ClaudeSdkLaneRunContext): {
    handle: SdkHandle;
    setAgentId: (id: string) => void;
  } {
    const {
      queryFn,
      options,
      mailbox,
      providerId,
      agentName,
      agentIdHolder,
      lanePlanLimits,
      outputCallbacks,
      onSegment,
      onStreamEvent,
      emitOutput,
      emitSegment,
      emitStreamEvent,
      disposeCallbacks,
      stopProxy,
    } = context;
    const abortController = options.abortController;
    let closed = false;
    let settleAbort: (() => void) | undefined;
    const closeMailbox = (): void => {
      if (closed) return;
      closed = true;
      mailbox.close();
      if (context.named) {
        void context.named.dispose();
        settleAbort?.();
      }
    };
    abortController.signal.addEventListener('abort', closeMailbox, {
      once: true,
    });
    let sdkQuery: ReturnType<LaneQueryFunction>;
    try {
      sdkQuery =
        context.named?.query ?? queryFn({ prompt: mailbox.prompt, options });
    } catch (error: unknown) {
      abortController.signal.removeEventListener('abort', closeMailbox);
      closeMailbox();
      disposeCallbacks();
      lanePlanLimits.end();
      throw error;
    }
    let resolvedSessionId: string | null = null;
    const sessionResolvedCallbacks: Array<(sessionId: string) => void> = [];
    const pendingTurns: Array<(exitCode: number) => void> = [];
    const enqueueTurn = (): Promise<number> =>
      new Promise<number>((resolve) => {
        pendingTurns.push(resolve);
      });
    const turn1Done = enqueueTurn();
    const attachAgentId = (agentId: string): void => {
      agentIdHolder.value = agentId;
      lanePlanLimits.attach(agentId);
    };
    const streamLoop = new PtahCliStreamLoop({
      logger: this.logger,
      messageTransformer: this.messageTransformer,
      emitOutput,
      emitSegment,
      emitStreamEvent,
      agentName: agentName,
      onSessionResolved: (sessionId: string) => {
        resolvedSessionId = sessionId;
        // The system init: the lane's own account can be read from here.
        lanePlanLimits.onSystemInit(sdkQuery);
        for (const cb of sessionResolvedCallbacks) {
          cb(sessionId);
        }
      },
      // A turn is released to the manager only once the lane's owner read
      // has settled (bounded at 3 s), so the exit it triggers is classified
      // and persisted with the owner (Batch 11 carry-forward).
      onTurnComplete: (exitCode: number) => {
        const resolve = pendingTurns.shift();
        if (resolve) {
          void lanePlanLimits.settled.then(() => resolve(exitCode));
        }
      },
      onPlanLimitSignal: (signal) => lanePlanLimits.onSignal(signal),
      planBilledSuccess: isPlanBilledLaneProvider(providerId),
    });
    let finished = false;
    const finish = (exitCode: number): void => {
      if (finished) return;
      finished = true;
      abortController.signal.removeEventListener('abort', closeMailbox);
      closeMailbox();
      disposeCallbacks();
      void stopProxy().catch(() =>
        this.logger.warn('[ClaudeLane] Proxy cleanup failed.'),
      );
      sessionResolvedCallbacks.length = 0;
      lanePlanLimits.end();
      void lanePlanLimits.settled.then(() => {
        while (pendingTurns.length) pendingTurns.shift()?.(exitCode);
      });
    };
    settleAbort = () => finish(1);
    streamLoop.run(sdkQuery).then(finish, (error: unknown) => {
      // Named lanes log no raw error text: it can carry account paths.
      this.logger.error(
        context.named
          ? '[ClaudeLane] Stream loop failed.'
          : `[PtahCliRegistry] spawnAgent stream loop error: ${
              error instanceof Error ? error.message : String(error)
            }`,
      );
      finish(1);
    });
    if (context.named && abortController.signal.aborted) finish(1);

    // No `getPid`, deliberately, and it is not an oversight the way it looks.
    // Every other adapter here spawns its own `child_process` and can hand the
    // manager a PID to tree-kill. This path does not spawn anything: `query()`
    // owns the `claude` child, exposes no handle to it anywhere in the SDK's
    // public surface, and reaps it itself when `abortController` fires — which
    // is also what closes the prompt mailbox above and ends the stream loop. So
    // for this handle the abort IS the kill, and `AgentProcessManager.killProcess`
    // waits on `done` rather than tree-killing a PID it cannot be given.
    // Inventing one (e.g. from a process scan) would be guessing at which
    // `claude.exe` on the machine is ours.
    const handle: SdkHandle = {
      ...context.named?.reference,
      providerId: providerId,
      abort: abortController,
      done: turn1Done,
      onOutput: (callback) => {
        outputCallbacks.push(callback);
      },
      onSegment,
      onStreamEvent,
      onSessionResolved: (callback) => {
        sessionResolvedCallbacks.push(callback);
        if (resolvedSessionId) {
          callback(resolvedSessionId);
        }
      },
      supportsContinuation: () => true,
      // Called by the manager as soon as it tracks the run, which is when
      // the lane's owner can be recorded on it.
      setAgentId: attachAgentId,
      continue: async (message: string) => {
        if (context.named && (closed || abortController.signal.aborted))
          throw claudeLaneRefusal();
        const done = enqueueTurn();
        if (context.named)
          await context.named.enqueue(message, resolvedSessionId ?? undefined);
        if (context.named && (closed || abortController.signal.aborted))
          throw claudeLaneRefusal();
        this.logger.info(
          `[PtahCliRegistry] continue() pushing follow-up turn for "${agentName}"`,
          { sessionId: resolvedSessionId, messageLength: message.length },
        );
        if (!context.named)
          mailbox.push(message, resolvedSessionId ?? undefined);
        return Promise.resolve({ done });
      },
    };
    return { handle, setAgentId: attachAgentId };
  }
}

/** Host-owned adapter to the same registry/SDK-attachment/metadata ports as main chat.
 * This stays absent/held until host certification; it never trusts caller paths.
 */
export interface ClaudeLaneAccountPersistence extends LaneAccountBindingPort {
  readonly available: boolean;
  commitRunBinding(
    route: ClaudeAccountNamedRoute,
    reservation: ClaudeAccountRunReservation,
    identity: ProviderAccountIdentityEvidence,
  ): Promise<ProviderAccountBinding>;
  attachSdkSession(request: {
    provider: string;
    sdkSessionId: string;
    runId: string;
    attachedAt: number;
  }): Promise<{
    status:
      | 'attached'
      | 'binding-absent'
      | 'session-linked-elsewhere'
      | 'run-linked-elsewhere';
  }>;
  saveAccountBound(
    metadata: SessionMetadata,
    binding: ProviderAccountBinding,
  ): Promise<void>;
  assertRouteCurrent(route: ClaudeAccountNamedRoute): Promise<void>;
  onAuthEpochChanged(
    listener: (route: ClaudeAccountNamedRoute) => void,
  ): () => void;
}

export function claudeLaneRefusal(
  message = 'Claude account admission prompt gate is not available',
): Error & { code: 'release-held' } {
  return Object.assign(new Error(message), { code: 'release-held' as const });
}

/** Two independent empty gates; only the final query can receive conversation. */
export class ClaudeNamedLaneAdmission {
  readonly route: ClaudeAccountNamedRoute;
  reference?: LaneAccountReference;
  query?: ReturnType<LaneQueryFunction>;
  private readonly gates: ReturnType<typeof createNamedAccountPromptGate>[] =
    [];
  private child?: {
    query: ReturnType<LaneQueryFunction>;
    exited: boolean;
    close: () => void;
    terminated: Promise<void>;
  };
  private identity?: ProviderAccountIdentityEvidence;
  private settlement?: Promise<void>;
  private stopEpoch?: () => void;
  private released = false;
  private disposed = false;
  private readonly onAbort = (): void => {
    void this.dispose();
  };

  constructor(
    route: ClaudeAccountNamedRoute,
    private readonly reservation: ClaudeAccountRunReservation,
    private readonly admission: ProviderAccountAdmissionPort,
    private readonly persistence: ClaudeLaneAccountPersistence,
    private readonly abort: AbortController,
    private readonly logger: Pick<Logger, 'warn'>,
    private readonly stored?: ProviderAccountBinding,
    private readonly deadlineMs = 15_000,
  ) {
    this.route = Object.freeze({ ...route });
    abort.signal.addEventListener('abort', this.onAbort, { once: true });
  }

  private async wait<T>(pending: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    try {
      this.assertOpen();
      const value = await Promise.race([
        pending,
        new Promise<never>((_resolve, reject) => {
          cancel = () => reject(claudeLaneRefusal());
          this.abort.signal.addEventListener('abort', cancel, { once: true });
          timer = setTimeout(() => {
            this.abort.abort();
            reject(claudeLaneRefusal());
          }, this.deadlineMs);
        }),
      ]);
      this.assertOpen();
      return value;
    } finally {
      clearTimeout(timer);
      if (cancel) this.abort.signal.removeEventListener('abort', cancel);
    }
  }

  private assertOpen(): void {
    if (this.disposed || this.abort.signal.aborted) throw claudeLaneRefusal();
  }

  private open(
    queryFn: LaneQueryFunction,
    prompt: AsyncIterable<SDKUserMessage>,
    options: Options,
  ): NonNullable<ClaudeNamedLaneAdmission['child']> {
    this.assertOpen();
    const spawn = options.spawnClaudeCodeProcess;
    if (!spawn) throw claudeLaneRefusal();
    let exited = false;
    let resolve!: () => void;
    const terminated = new Promise<void>((done) => {
      resolve = done;
    });
    // Install the exit proof before query() can spawn or throw.
    let query: ReturnType<LaneQueryFunction> | undefined;
    let closed = false;
    const child = {
      get query() {
        if (!query) throw claudeLaneRefusal();
        return query;
      },
      get exited() {
        return exited;
      },
      terminated,
      close: () => {
        if (closed) return;
        closed = true;
        try {
          query?.close();
        } catch {
          this.logger.warn('[ClaudeLane] Child close was not confirmed.');
        }
      },
    };
    this.child = child;
    query = queryFn({
      prompt,
      options: {
        ...options,
        spawnClaudeCodeProcess: (input) => {
          const process = spawn(input);
          process.once('exit', (code) => {
            if (typeof code === 'number') {
              exited = true;
              resolve();
            }
          });
          return process;
        },
      },
    });
    return child;
  }

  private async readIdentity(): Promise<ProviderAccountIdentityEvidence> {
    this.assertOpen();
    if (!this.child) throw claudeLaneRefusal();
    await this.wait(this.persistence.assertRouteCurrent(this.route));
    const info = await this.wait(this.child.query.accountInfo());
    const email = info.email?.trim();
    return email
      ? {
          kind: 'known',
          ownerKey: createHash('sha256')
            .update(
              `ptah-quota-owner\0${email}\0${info.organization?.trim() ?? ''}`,
              'utf8',
            )
            .digest('hex'),
        }
      : { kind: 'unknown' };
  }

  private sameIdentity(identity: ProviderAccountIdentityEvidence): boolean {
    return (
      !!this.identity &&
      (this.identity.kind === 'known' && identity.kind === 'known'
        ? this.identity.ownerKey === identity.ownerKey
        : this.identity.kind === identity.kind)
    );
  }

  async bootstrap(queryFn: LaneQueryFunction, options: Options): Promise<void> {
    this.stopEpoch = this.persistence.onAuthEpochChanged((changed) => {
      if (
        changed.routeFingerprint === this.route.routeFingerprint &&
        changed.authEpoch !== this.route.authEpoch
      )
        this.abort.abort();
    });
    if (this.disposed) {
      this.stopEpoch();
      this.stopEpoch = undefined;
      throw claudeLaneRefusal();
    }
    const gate = createNamedAccountPromptGate(this.abort.signal);
    this.gates.push(gate);
    const child = this.open(queryFn, gate.prompt, options);
    this.identity = await this.readIdentity();
    if (
      this.stored &&
      (this.stored.identity.kind !== 'known' ||
        !this.sameIdentity(this.stored.identity))
    )
      throw claudeLaneRefusal();
    gate.close();
    child.close();
    await this.wait(child.terminated);
    this.child = undefined;
  }

  async launch(
    queryFn: LaneQueryFunction,
    options: Options,
    metadata: Omit<SessionMetadata, 'sessionId'>,
    onBinding?: (
      reference: LaneAccountReference,
      sdkSessionId: string,
    ) => Promise<void>,
  ): Promise<void> {
    const gate = createNamedAccountPromptGate(this.abort.signal);
    this.gates.push(gate);
    const owner = this;
    const prompt: AsyncIterable<SDKUserMessage> = {
      async *[Symbol.asyncIterator]() {
        let initial = true;
        for await (const message of gate.prompt) {
          try {
            await owner.validateTurn(!initial);
            owner.assertOpen();
            initial = false;
            yield message;
          } catch {
            await owner.dispose();
            throw claudeLaneRefusal();
          }
        }
      },
    };
    const canUseTool = options.canUseTool;
    const child = this.open(queryFn, prompt, {
      ...options,
      canUseTool: (tool, input, context) =>
        this.released &&
        !this.disposed &&
        !this.abort.signal.aborted &&
        canUseTool
          ? canUseTool(tool, input, context)
          : Promise.resolve({
              behavior: 'deny',
              message: 'Account admission pending.',
            }),
    });
    if (!this.sameIdentity(await this.readIdentity()))
      throw claudeLaneRefusal();
    const buffered: Awaited<ReturnType<typeof child.query.next>>[] = [];
    let sessionId: string | undefined;
    while (!sessionId) {
      const next = await this.wait(child.query.next());
      if (next.done || buffered.length >= 64) throw claudeLaneRefusal();
      buffered.push(next);
      if (next.value.type === 'system' && next.value.subtype === 'init')
        sessionId = next.value.session_id;
    }
    if (options.resume && options.resume !== sessionId)
      throw claudeLaneRefusal();
    if (!this.identity) throw claudeLaneRefusal();
    const binding =
      this.stored ??
      (await this.wait(
        this.persistence.commitRunBinding(
          this.route,
          this.reservation,
          this.identity,
        ),
      ));
    if (
      binding.provider !== 'claude' ||
      binding.profileId !== this.route.profileId ||
      binding.runId !== this.route.runId ||
      binding.routeRevision !== this.route.routeRevision ||
      binding.routeFingerprint !== this.route.routeFingerprint ||
      (this.stored
        ? binding.authEpoch > this.route.authEpoch
        : binding.authEpoch !== this.route.authEpoch) ||
      !this.sameIdentity(binding.identity)
    )
      throw claudeLaneRefusal();
    this.reference = Object.freeze({
      accountBindingId: binding.runId,
      accountBinding: Object.freeze({
        ...binding,
        identity: Object.freeze({ ...binding.identity }),
      }),
    });
    const attached = await this.wait(
      this.persistence.attachSdkSession({
        provider: 'claude',
        sdkSessionId: sessionId,
        runId: binding.runId,
        attachedAt: Date.now(),
      }),
    );
    if (attached.status !== 'attached') throw claudeLaneRefusal();
    await this.wait(
      this.persistence.saveAccountBound(
        { ...metadata, sessionId },
        this.reference.accountBinding,
      ),
    );
    await this.wait(
      this.persistence.persistReference(this.reference, sessionId),
    );
    if (onBinding) await this.wait(onBinding(this.reference, sessionId));
    if (!this.sameIdentity(await this.readIdentity()))
      throw claudeLaneRefusal();
    this.assertOpen();
    this.released = true;
    const next = () =>
      buffered.length ? Promise.resolve(buffered.shift()!) : child.query.next();
    this.query = new Proxy(child.query, {
      get(target, key) {
        if (key === 'next') return next;
        if (key === Symbol.asyncIterator) return () => ({ next });
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  private async validateTurn(checkMetadata = true): Promise<void> {
    this.assertOpen();
    if (!this.reference || !this.sameIdentity(await this.readIdentity()))
      throw claudeLaneRefusal();
    if (checkMetadata) {
      const result = await this.wait(
        this.persistence.validateResume(this.reference),
      );
      if (result.code !== 'ok') throw claudeLaneRefusal();
    }
    this.assertOpen();
  }

  async enqueue(
    message: string,
    sessionId?: string,
    initial = false,
  ): Promise<void> {
    try {
      await this.validateTurn(!initial);
      const gate = this.gates[this.gates.length - 1];
      if (
        !this.released ||
        !gate.push({
          type: 'user',
          uuid: randomUUID() as SDKUserMessage['uuid'],
          message: { role: 'user', content: message },
          parent_tool_use_id: null,
          ...(sessionId ? { session_id: sessionId } : {}),
        }) ||
        !gate.commit()
      )
        throw claudeLaneRefusal();
    } catch {
      await this.dispose();
      throw claudeLaneRefusal();
    }
  }

  dispose(): Promise<void> {
    if (this.settlement) return this.settlement;
    const command = {
      reservationId: this.reservation.reservationId,
      operationId: this.reservation.operationId,
      authEpoch: this.reservation.authEpoch,
    };
    this.settlement = Promise.resolve()
      .then(async () => {
        const result =
          !this.child || this.child.exited
            ? await this.admission.releaseReservation({
                ...command,
                reason: 'child-closed',
              })
            : await this.admission.retainUnresolvedReservation(command);
        if (result.code !== 'ok')
          this.logger.warn('[ClaudeLane] Account reservation remains held.');
      })
      .catch(() => {
        this.logger.warn('[ClaudeLane] Account reservation settlement failed.');
      });
    this.disposed = true;
    for (const gate of this.gates) gate.close();
    this.abort.signal.removeEventListener('abort', this.onAbort);
    this.abort.abort();
    this.child?.close();
    this.stopEpoch?.();
    this.stopEpoch = undefined;
    return this.settlement;
  }
}
