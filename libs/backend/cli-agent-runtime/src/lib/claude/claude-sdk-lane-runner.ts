import { randomUUID } from 'node:crypto';
import {
  ClaudeCertifiedLaunchRefusal,
  assertCertifiedLaunch,
  claudeIdentityReference,
  claudePersonalLoginCheck,
  claudePersonalLoginPassed,
  createNamedAccountPromptGate,
  isChildExitProved,
  spawnedChildPid,
  withNamedAccountToolGate,
} from '@ptah-extension/agent-sdk';
import type {
  ClaudePersonalLoginCheck,
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
  ClaudeCertifiedLaunchContext,
  ClaudeLaunchBoundary,
  ClaudeLaunchBoundaryOutcome,
  ProviderAccountAdmissionPort,
  ProviderAccountPortRefusal,
} from '@ptah-extension/auth-providers-tokens';
import { claudeActualLaunch } from './claude-sdk-lane-options';
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
    // A holder, not a late const: closeMailbox can run (abort or the
    // queryFn catch below) before finish exists.
    const abortSettler: { settle?: () => void } = {};
    const closeMailbox = (): void => {
      if (closed) return;
      closed = true;
      mailbox.close();
      if (context.named) {
        void context.named.dispose();
        abortSettler.settle?.();
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
        // The system init: the lane's own account can be read from here. A
        // named lane keys an unproved owner to its certified route.
        lanePlanLimits.onSystemInit(sdkQuery, context.named?.route);
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
    abortSettler.settle = () => finish(1);
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
 * A host binds it only together with route certification
 * (`ClaudeNamedAccountPersistence`); a host without it binds read-only
 * bindings whose writes refuse `unavailable-storage`. It never trusts caller
 * paths.
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
  /**
   * Revalidates the route and re-checks the certified launch's policy sources
   * right before one SDK child starts. `terminated` reports whether every
   * child the check started was proved closed.
   */
  checkLaunchBoundary(
    route: ClaudeAccountNamedRoute,
    launch: ClaudeCertifiedLaunchContext,
    boundary: ClaudeLaunchBoundary,
    signal: AbortSignal,
  ): Promise<ClaudeLaunchBoundaryOutcome>;
  onAuthEpochChanged(
    listener: (route: ClaudeAccountNamedRoute) => void,
  ): () => void;
}

export type ClaudeLaneRefusalCode = ProviderAccountPortRefusal['code'];

/** Fixed, path-free lane refusal: a result code and a fixed message. */
class ClaudeLaneRefusal extends Error {
  constructor(
    readonly code: ClaudeLaneRefusalCode,
    message: string,
  ) {
    super(message);
    this.name = 'ClaudeLaneRefusal';
  }
}

/**
 * Fixed, path-free refusal text per code. Each names its code so the error an
 * agent sees states why the named run was refused.
 */
const CLAUDE_LANE_REFUSAL_MESSAGES: Readonly<
  Record<ClaudeLaneRefusalCode, string>
> = Object.freeze({
  'missing-profile':
    'Claude account refused (missing-profile): the named account does not exist',
  'wrong-provider':
    'Claude account refused (wrong-provider): the account belongs to another provider',
  'unsupported-store':
    'Claude account refused (unsupported-store): the account directory or the installed Claude CLI is not usable for named accounts',
  'unsupported-source':
    'Claude account refused (unsupported-source): a Claude settings source for this working directory or machine policy is not supported for named accounts',
  'identity-mismatch':
    'Claude account refused (identity-mismatch): the signed-in Claude login is not the stored account',
  'identity-unproved':
    'Claude account refused (identity-unproved): the account sign-in could not be proved',
  'route-changed':
    'Claude account refused (route-changed): the account configuration changed during admission',
  busy: 'Claude account refused (busy): the account is in use by another operation',
  'unavailable-storage':
    'Claude account refused (unavailable-storage): account storage is not available',
  conflict:
    'Claude account refused (conflict): the account selection conflicts with the request or session',
  cancelled: 'Claude account refused (cancelled): the admission was cancelled',
  timeout: 'Claude account refused (timeout): the admission timed out',
  'release-held':
    'Claude account refused (release-held): a previous run of this account is not released yet',
  'invalid-bound':
    'Claude account refused (invalid-bound): the stored session binding is not valid',
});

/**
 * `message` must be a fixed string: never a path, an account value or CLI text.
 * It defaults to the fixed text of `code`. A refusal with no stated code is an
 * unproved named run, `identity-unproved`.
 */
export function claudeLaneRefusal(
  code: ClaudeLaneRefusalCode = 'identity-unproved',
  message: string = CLAUDE_LANE_REFUSAL_MESSAGES[code],
): Error & { code: ClaudeLaneRefusalCode } {
  return new ClaudeLaneRefusal(code, message);
}

/**
 * The refusal code an error carries: a lane refusal's or a certified-launch
 * refusal's own code. Any other error (a store, SDK or callback failure) is an
 * unclassified named-run failure, `identity-unproved`, so no foreign error
 * field reaches a caller.
 */
export function claudeLaneRefusalCode(error: unknown): ClaudeLaneRefusalCode {
  if (
    error instanceof ClaudeLaneRefusal ||
    error instanceof ClaudeCertifiedLaunchRefusal
  )
    return error.code;
  return 'identity-unproved';
}

/** Init `apiKeySource` values a personal claude.ai login may report. */
const INIT_PERSONAL_KEY_SOURCES: ReadonlySet<string> = new Set([
  'none',
  'oauth',
]);

/** Fixed sub-stage words of one named lane run, logged with a refusal. */
export type ClaudeLaneLaunchStep =
  | 'boundary'
  | 'open'
  | 'route-current'
  | 'account-info'
  | 'personal-login'
  | 'identity-absent'
  | 'identity-compare'
  | 'stored-identity'
  | 'close'
  | 'released'
  | 'init-wait'
  | 'init-version'
  | 'init-key-source'
  | 'resume'
  | 'commit-binding'
  | 'binding-check'
  | 'attach'
  | 'save-metadata'
  | 'persist-reference'
  | 'on-binding'
  | 'gate';

/**
 * Where a named lane run stopped: the child phase, the last sub-stage reached
 * and, when a wait was cut short, why. Every field is a fixed word.
 */
export interface ClaudeLaneLaunchDiagnostic {
  readonly phase: 'admission' | 'bootstrap' | 'final' | 'turn';
  readonly step?: ClaudeLaneLaunchStep;
  readonly interrupt?: 'deadline' | 'abort' | 'epoch';
  readonly personalLogin?: ClaudePersonalLoginCheck;
}

/** Built-in error classes a refusal log line may name; `name` is mutable data. */
const FOREIGN_ERROR_CLASSES = [
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ReferenceError',
  'AbortError',
  'TimeoutError',
] as const;

/**
 * The class of a foreign (non-refusal) error, for a refusal log line.
 * `undefined` for a lane or certified-launch refusal. Only a built-in class
 * name from a fixed list is returned, anything else is `other`; the message
 * is never read. `name` is read once and only the list's own constant is
 * returned, so an accessor cannot put other text in the log.
 */
export function claudeLaneForeignErrorClass(
  error: unknown,
): (typeof FOREIGN_ERROR_CLASSES)[number] | 'other' | 'non-error' | undefined {
  if (
    error instanceof ClaudeLaneRefusal ||
    error instanceof ClaudeCertifiedLaunchRefusal
  )
    return undefined;
  if (!(error instanceof Error)) return 'non-error';
  let name: unknown;
  try {
    name = error.name;
  } catch {
    // degradation-audit: reported - a throwing `name` accessor logs the fixed word `other`; the refusal code is unchanged.
    return 'other';
  }
  return FOREIGN_ERROR_CLASSES.find((known) => known === name) ?? 'other';
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
  /** The first turn `launch` released before init (D68), until consumed. */
  private releasedTurn?: SDKUserMessage;
  private disposed = false;
  /**
   * True while a boundary check is pending or after one refused without
   * proving its own children closed. Settlement then retains the reservation.
   */
  private boundaryUnproved = false;
  private phase: ClaudeLaneLaunchDiagnostic['phase'] = 'admission';
  private step?: ClaudeLaneLaunchStep;
  private interrupt?: ClaudeLaneLaunchDiagnostic['interrupt'];
  private personalLogin?: ClaudePersonalLoginCheck;
  private readonly onAbort = (): void => {
    void this.dispose();
  };

  constructor(
    route: ClaudeAccountNamedRoute,
    /** Certified launch from admission; absent refuses `identity-unproved`. */
    readonly certified: ClaudeCertifiedLaunchContext | undefined,
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

  /** Where this run stopped; fixed words only, safe for a refusal log line. */
  get launchDiagnostic(): ClaudeLaneLaunchDiagnostic {
    return Object.freeze({
      phase: this.phase,
      ...(this.step ? { step: this.step } : {}),
      ...(this.interrupt ? { interrupt: this.interrupt } : {}),
      ...(this.step === 'personal-login' && this.personalLogin
        ? { personalLogin: this.personalLogin }
        : {}),
    });
  }

  private async wait<T>(pending: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    try {
      this.assertOpen();
      const value = await Promise.race([
        pending,
        new Promise<never>((_resolve, reject) => {
          cancel = () => {
            this.interrupt ??= 'abort';
            reject(claudeLaneRefusal());
          };
          this.abort.signal.addEventListener('abort', cancel, { once: true });
          timer = setTimeout(() => {
            this.interrupt ??= 'deadline';
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
    // A holder, not a late const: the getter and close() may run before
    // queryFn() returns, where a const would be in its temporal dead zone.
    const opened: { query?: ReturnType<LaneQueryFunction> } = {};
    let closed = false;
    const child = {
      get query() {
        if (!opened.query) throw claudeLaneRefusal();
        return opened.query;
      },
      get exited() {
        return exited;
      },
      terminated,
      close: () => {
        if (closed) return;
        closed = true;
        try {
          opened.query?.close();
        } catch {
          this.logger.warn('[ClaudeLane] Child close was not confirmed.');
        }
      },
    };
    this.child = child;
    opened.query = queryFn({
      prompt,
      options: {
        ...options,
        spawnClaudeCodeProcess: (input) => {
          const process = spawn(input);
          process.once('exit', (code) => {
            // A signal death after close/abort is proof only when the spawner
            // observed the child's own exit (see isChildExitProved).
            if (isChildExitProved(process, code)) {
              exited = true;
              resolve();
            }
          });
          this.recordChild(process);
          return process;
        },
      },
    });
    return child;
  }

  /**
   * Records the child's pid on the reservation, so a later process reclaims a
   * lease this host leaves behind only once the child is gone too. A failed
   * record is logged and never changes the lane's own admission.
   */
  private recordChild(child: object): void {
    if (!this.admission.recordRunChild) return;
    const unrecorded = (): void => this.logger.warn('[ClaudeLane] Account child was not recorded on its reservation.');
    void spawnedChildPid(child).then(async (pid) => {
      if (pid === null) return;
      const result = await this.admission.recordRunChild?.({ reservationId: this.reservation.reservationId,
        operationId: this.reservation.operationId, authEpoch: this.reservation.authEpoch, pid });
      if (result && result.code !== 'ok') unrecorded();
    }).catch(unrecorded);
  }

  private certifiedLaunch(): ClaudeCertifiedLaunchContext {
    if (!this.certified) throw claudeLaneRefusal('identity-unproved');
    return this.certified;
  }

  /**
   * Both checks that must pass right before one SDK child starts: the actual
   * options against the certified launch (no I/O), then the host boundary
   * check (route revalidation and policy re-scan). Throws a lane refusal
   * with the real code; `queryFn` is never reached on a refusal.
   */
  private async checkBoundary(
    options: Options,
    boundary: ClaudeLaunchBoundary,
  ): Promise<void> {
    this.phase = boundary;
    this.step = 'boundary';
    this.assertOpen();
    const launch = this.certifiedLaunch();
    try {
      assertCertifiedLaunch(launch, claudeActualLaunch(options), boundary);
    } catch (error: unknown) {
      throw claudeLaneRefusal(claudeLaneRefusalCode(error));
    }
    // Pending until an outcome proves the check's children closed: an abort
    // or deadline during the check settles by retaining the reservation.
    this.boundaryUnproved = true;
    const outcome = await this.wait(
      this.persistence.checkLaunchBoundary(
        this.route,
        launch,
        boundary,
        this.abort.signal,
      ),
    );
    if (outcome.ok) {
      this.boundaryUnproved = false;
      return;
    }
    this.boundaryUnproved = !outcome.terminated;
    throw claudeLaneRefusal(outcome.code);
  }

  private async readIdentity(): Promise<ProviderAccountIdentityEvidence> {
    this.assertOpen();
    if (!this.child) throw claudeLaneRefusal();
    const launch = this.certifiedLaunch();
    this.step = 'route-current';
    await this.wait(this.persistence.assertRouteCurrent(this.route));
    this.step = 'account-info';
    const info = await this.wait(this.child.query.accountInfo());
    this.step = 'personal-login';
    this.personalLogin = claudePersonalLoginCheck(info);
    if (!claudePersonalLoginPassed(this.personalLogin))
      throw claudeLaneRefusal('identity-unproved');
    this.step = 'identity-absent';
    const reference = claudeIdentityReference(info.email, info.organization);
    if (!reference) return { kind: 'unknown' };
    // The running child must be the account the launch was certified for.
    this.step = 'identity-compare';
    if (reference !== launch.identityReference)
      throw claudeLaneRefusal('identity-unproved');
    return { kind: 'known', ownerKey: reference };
  }

  private sameIdentity(identity: ProviderAccountIdentityEvidence): boolean {
    // `unknown` is absent proof, never an identity: it equals nothing, not
    // even itself. A known identity matches only the same owner key.
    const baseline = this.identity;
    return (
      !!baseline &&
      baseline.kind === 'known' &&
      identity.kind === 'known' &&
      baseline.ownerKey === identity.ownerKey
    );
  }

  async bootstrap(queryFn: LaneQueryFunction, options: Options): Promise<void> {
    this.stopEpoch = this.persistence.onAuthEpochChanged((changed) => {
      if (
        changed.routeFingerprint === this.route.routeFingerprint &&
        changed.authEpoch !== this.route.authEpoch
      ) {
        this.interrupt ??= 'epoch';
        this.abort.abort();
      }
    });
    if (this.disposed) {
      this.stopEpoch();
      this.stopEpoch = undefined;
      throw claudeLaneRefusal();
    }
    await this.checkBoundary(options, 'bootstrap');
    const gate = createNamedAccountPromptGate(this.abort.signal);
    this.gates.push(gate);
    this.step = 'open';
    const child = this.open(queryFn, gate.prompt, options);
    this.identity = await this.readIdentity();
    // Refuse an unproved identity before any binding is committed or any
    // prompt is sent, including on a fresh lane with no stored binding.
    if (this.identity.kind !== 'known')
      throw claudeLaneRefusal('identity-unproved');
    this.step = 'stored-identity';
    if (
      this.stored &&
      (this.stored.identity.kind !== 'known' ||
        !this.sameIdentity(this.stored.identity))
    )
      throw claudeLaneRefusal('identity-unproved');
    this.step = 'close';
    gate.close();
    child.close();
    await this.wait(child.terminated);
    this.child = undefined;
  }

  /** Yields each gated turn only after its account admission re-validates. */
  private async *admittedTurns(
    turns: ReturnType<typeof createNamedAccountPromptGate>['prompt'],
  ): AsyncGenerator<SDKUserMessage> {
    for await (const message of turns) {
      try {
        // Only the exact turn `launch` released right after the same child
        // proved the account skips re-validation (no binding exists yet).
        // Keyed on the message, not on the iterator, so a fresh iterator
        // cannot skip validation for a later queued turn.
        if (message === this.releasedTurn) this.releasedTurn = undefined;
        else await this.validateTurn();
        this.assertOpen();
        yield message;
      } catch (error: unknown) {
        await this.dispose();
        throw claudeLaneRefusal(claudeLaneRefusalCode(error));
      }
    }
  }

  async launch(
    queryFn: LaneQueryFunction,
    options: Options,
    metadata: Omit<SessionMetadata, 'sessionId'>,
    firstTurn: { readonly message: string; readonly sessionId?: string },
    onBinding?: (
      reference: LaneAccountReference,
      sdkSessionId: string,
    ) => Promise<void>,
  ): Promise<void> {
    await this.checkBoundary(options, 'final');
    const gate = createNamedAccountPromptGate(this.abort.signal);
    this.gates.push(gate);
    const prompt: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]: () => this.admittedTurns(gate.prompt),
    };
    // Settles when the run is released or stopped (dispose aborts).
    let settleLaunch!: () => void;
    const launched = new Promise<void>((resolve) => {
      settleLaunch = resolve;
      this.abort.signal.addEventListener('abort', () => resolve(), {
        once: true,
      });
    });
    let initVerified = false;
    this.step = 'open';
    // One admission check for `canUseTool` and the `PreToolUse` hook: denied
    // before a verified init; after it, held until the binding; denied on
    // refusal, abort or dispose (each settles `launched` via the abort).
    const toolAdmitted = async (): Promise<boolean> => {
      if (initVerified && !this.released) await launched;
      return this.released && !this.disposed && !this.abort.signal.aborted;
    };
    const child = this.open(
      queryFn,
      prompt,
      withNamedAccountToolGate(options, toolAdmitted),
    );
    if (!this.sameIdentity(await this.readIdentity()))
      throw claudeLaneRefusal('identity-unproved');
    // CLI 2.1.278 builds `system/init` in its turn loop, after it picks up a
    // user message (D68): release the first turn now; nothing is forwarded
    // and no tool runs until init is verified below.
    this.step = 'released';
    this.releasedTurn = this.userTurn(firstTurn.message, firstTurn.sessionId);
    if (
      !gate.push(this.releasedTurn) ||
      !gate.commit()
    )
      throw claudeLaneRefusal();
    const version = this.certifiedLaunch().executable.version;
    const buffered: Awaited<ReturnType<typeof child.query.next>>[] = [];
    let sessionId: string | undefined;
    while (!sessionId) {
      this.step = 'init-wait';
      const next = await this.wait(child.query.next());
      if (next.done || buffered.length >= 64) throw claudeLaneRefusal();
      buffered.push(next);
      if (next.value.type === 'system' && next.value.subtype === 'init') {
        // The running CLI must be the certified version and must report a
        // personal key source (independent of account info), before any output
        // is forwarded, any tool runs or the binding is committed.
        this.step = 'init-version';
        if (next.value.claude_code_version !== version)
          throw claudeLaneRefusal('identity-unproved');
        this.step = 'init-key-source';
        if (!INIT_PERSONAL_KEY_SOURCES.has(String(next.value.apiKeySource)))
          throw claudeLaneRefusal('identity-unproved');
        sessionId = next.value.session_id;
      }
    }
    this.step = 'resume';
    if (options.resume && options.resume !== sessionId)
      throw claudeLaneRefusal('conflict');
    initVerified = true;
    if (!this.identity) throw claudeLaneRefusal();
    this.step = 'commit-binding';
    const binding =
      this.stored ??
      (await this.wait(
        this.persistence.commitRunBinding(
          this.route,
          this.reservation,
          this.identity,
        ),
      ));
    this.step = 'binding-check';
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
    this.step = 'attach';
    const attached = await this.wait(
      this.persistence.attachSdkSession({
        provider: 'claude',
        sdkSessionId: sessionId,
        runId: binding.runId,
        attachedAt: Date.now(),
      }),
    );
    if (attached.status !== 'attached') throw claudeLaneRefusal('conflict');
    this.step = 'save-metadata';
    await this.wait(
      this.persistence.saveAccountBound(
        { ...metadata, sessionId },
        this.reference.accountBinding,
      ),
    );
    this.step = 'persist-reference';
    await this.wait(
      this.persistence.persistReference(this.reference, sessionId),
    );
    this.step = 'on-binding';
    if (onBinding) await this.wait(onBinding(this.reference, sessionId));
    if (!this.sameIdentity(await this.readIdentity()))
      throw claudeLaneRefusal();
    this.assertOpen();
    this.released = true;
    settleLaunch();
    this.phase = 'turn';
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

  private userTurn(message: string, sessionId?: string): SDKUserMessage {
    return {
      type: 'user',
      uuid: randomUUID() as SDKUserMessage['uuid'],
      message: { role: 'user', content: message },
      parent_tool_use_id: null,
      ...(sessionId ? { session_id: sessionId } : {}),
    };
  }

  /** A later turn; the first turn is released by `launch`. */
  async enqueue(message: string, sessionId?: string): Promise<void> {
    try {
      await this.validateTurn();
      this.step = 'gate';
      const gate = this.gates[this.gates.length - 1];
      if (
        !this.released ||
        !gate.push(this.userTurn(message, sessionId)) ||
        !gate.commit()
      )
        throw claudeLaneRefusal();
    } catch (error: unknown) {
      await this.dispose();
      throw claudeLaneRefusal(claudeLaneRefusalCode(error));
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
          !this.boundaryUnproved && (!this.child || this.child.exited)
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
