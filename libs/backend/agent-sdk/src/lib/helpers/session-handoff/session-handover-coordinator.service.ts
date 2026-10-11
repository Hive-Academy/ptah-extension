import { inject, injectable } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type {
  InlineImageAttachment,
  BeginSessionHandoverResult,
  SessionHandoverReason,
  SessionHandoverState,
  EffortLevel,
  PermissionLevel,
} from '@ptah-extension/shared';

import { SessionHandoffBuilder } from '../session-budget/session-handoff-builder';
import { SessionHandoffWriter } from '../session-budget/session-handoff-writer';
import { SessionHistoryReaderService } from '../../session-history-reader.service';
import { SDK_TOKENS } from '../../di/tokens';
import type { SDKMessageOrigin } from '../../types/sdk-types/claude-sdk.types';

/** Shared with cli-agent-runtime without making agent-sdk depend on that lib. */
export const SESSION_SUCCESSOR_HOST = Symbol.for('ChildChatSessionHost');

/** Source-neutral input retained until the successor host accepts it. */
export interface QueuedSessionInput {
  readonly content: string;
  readonly files?: readonly string[];
  readonly images?: readonly InlineImageAttachment[];
  readonly origin?: SDKMessageOrigin;
  readonly admission?: 'require-idle' | 'owned-compact' | 'owned-handoff';
}

/** SDK messages are constructed only by the stream pump at dequeue. */
export type SessionQueueItem = QueuedSessionInput;

export interface HandoverAdmission {
  readonly held: boolean;
  readonly operationId?: string;
}

export interface HandoverSourceSnapshot {
  readonly sessionId: string;
  readonly tabId: string;
  readonly token: string;
  readonly workspacePath: string;
  /** Configuration copied into the replacement tab, never inferred from defaults. */
  readonly successorConfig: {
    readonly model?: string;
    readonly effort?: EffortLevel;
    readonly permissionLevel?: PermissionLevel;
    readonly workspacePath: string;
  };
  /** Resources the host transfers to its replacement without duplicating ownership. */
  readonly resourceLease: {
    readonly worktreePath: string;
    readonly mcpRootPath?: string;
    readonly inheritedParentIds: readonly string[];
  };
}

export interface StartSuccessorHandoverInput {
  readonly operationId: string;
  readonly source: HandoverSourceSnapshot;
  readonly seed: string;
  readonly resourceLease: HandoverSourceSnapshot['resourceLease'];
}

/** Host implementation is supplied by Batch B/D under `SESSION_SUCCESSOR_HOST`. */
export interface SessionSuccessorHost {
  startSuccessorSession(
    input: StartSuccessorHandoverInput,
  ): Promise<{ readonly started: boolean; readonly successorTabId?: string; readonly error?: string }>;
  deliverTransferInputs(
    operationId: string,
    inputs: readonly QueuedSessionInput[],
  ): Promise<{ readonly delivered: boolean; readonly error?: string }>;
  /** Best-effort cleanup when the source ends during successor startup. */
  stopSuccessorSession?(operationId: string): Promise<void>;
}

/** Lifecycle callbacks avoid a coordinator ↔ lifecycle DI cycle. */
export interface SessionHandoverRuntime {
  sourceSnapshot(sourceSessionId: string): HandoverSourceSnapshot | undefined;
  queueOwnedHandoff(sourceSessionId: string, prompt: string): Promise<void>;
  restoreInputs(sourceSessionId: string, inputs: readonly QueuedSessionInput[]): boolean;
  closeIfTokenMatches(sourceSessionId: string, token: string): Promise<boolean>;
  isOwnedHandoffPendingOrRunning(sourceSessionId: string, token: string): boolean;
  /** Running plus background subagents of the source. */
  subagentsInFlight(sourceSessionId: string): number;
}

/** Counts CLI agent lanes still working for a source session. */
export type LaneWorkProvider = (ids: { readonly sessionId: string; readonly tabId: string }) => number;

type WaitingFor = NonNullable<SessionHandoverState['waitingFor']>;

export type SessionHandoverListener = (state: SessionHandoverState) => void;

function sameWaitingFor(a: WaitingFor | undefined, b: WaitingFor | undefined): boolean {
  return a?.subagents === b?.subagents && a?.lanes === b?.lanes;
}

/** True while an operation still owns its source (not closed, failed or cancelled). */
export function isInProgress(state: SessionHandoverState | undefined): boolean {
  return (
    state !== undefined &&
    state.phase !== 'closed' &&
    state.phase !== 'failed' &&
    state.phase !== 'cancelled'
  );
}

interface Operation {
  readonly id: string;
  readonly sourceSessionId: string;
  /** A parked agent request becomes `budget-limit` at the blocking limit. */
  reason: SessionHandoverReason;
  /** Kept when a parked op is approved or converted. */
  readonly agentHandoff?: string;
  phase: SessionHandoverState['phase'];
  revision: number;
  /** Held send inputs; never contains the draft. */
  readonly inputs: QueuedSessionInput[];
  error?: string;
  restored: boolean;
  lostInputCount: number;
  lostInputTexts: string[];
  successorTabId?: string;
  /** Work a user-started handover waits for in `waiting-for-turn-end`. */
  waitingFor?: WaitingFor;
  /** Set only by `begin` (the user); `startConfirmed` requires it. */
  userConfirmed?: boolean;
  /** "Continue now anyway" mid-turn: the next terminal skips the work gate. */
  forced?: boolean;
  /** An agent's request parked for the user's approval. */
  requestedBy?: 'agent';
  /** The user's captured composer text, apart from `inputs` (D24). */
  draftText?: string;
  /** The lane-status WARN was logged for this op. */
  laneStatusWarned?: boolean;
}

const HELD_SOURCE_PHASES: ReadonlySet<SessionHandoverState['phase']> = new Set([
  'armed',
  'awaiting-confirmation',
  'writing-handoff',
  'starting-successor',
  'successor-confirmed',
  'closing',
]);

/** Phases whose op takes a later begin's composer text as its draft. */
const DRAFT_CAPTURE_PHASES: ReadonlySet<SessionHandoverState['phase']> = new Set([
  'waiting-for-turn-end',
  'awaiting-confirmation',
  'writing-handoff',
  'starting-successor',
  'successor-confirmed',
]);

export const HANDOFF_REQUEST_TIMEOUT_MS = 180_000;
export const HANDOFF_REQUEST_PROMPT = [
  'Write a concise Markdown handoff for the next agent taking over this work.',
  'Use exactly these headings, in this order:',
  '## Goal',
  '## Decisions',
  '## Task folders',
  '## Changed files (include files changed by subagents and CLI agent lanes)',
  '## Open items',
  '## Still running (subagents and CLI agent lanes with their ids, or "None")',
  '## Next action',
  'Keep the whole handoff under 5,000 characters.',
  'Do not call tools; respond only with the handoff.',
].join('\n');

const CANCELLABLE_PHASES: ReadonlySet<SessionHandoverState['phase']> = new Set([
  'waiting-for-turn-end',
  'armed',
  'awaiting-confirmation',
  'writing-handoff',
  'failed',
]);

const RESTORE_FAILED_ERROR = 'held inputs could not be restored';
const LOST_INPUT_TEXT_LIMIT = 2_000;
const LOST_INPUT_TEXT_TOTAL_LIMIT = 8_000;

/** Single-flight authority for a source session's replacement handover. */
@injectable()
export class SessionHandoverCoordinator {
  private readonly operations = new Map<string, Operation>();
  private readonly listeners = new Set<SessionHandoverListener>();
  private runtime: SessionHandoverRuntime | null = null;
  private resourceLeaseProvider: ((
    sourceSessionId: string,
  ) => Partial<HandoverSourceSnapshot['resourceLease']> | undefined) | null = null;
  private laneWorkProvider: LaneWorkProvider | null = null;

  constructor(
    @inject(SessionHandoffBuilder, { isOptional: true })
    private readonly handoffBuilder: SessionHandoffBuilder | null = null,
    @inject(SessionHandoffWriter, { isOptional: true })
    private readonly handoffWriter: SessionHandoffWriter | null = null,
    @inject(SDK_TOKENS.SDK_SESSION_HISTORY_READER, { isOptional: true })
    private readonly historyReader: Pick<
      SessionHistoryReaderService,
      'readHistoryForCuration'
    > | null = null,
    private readonly successorHostResolver: () => SessionSuccessorHost | null =
      () => null,
    @inject(TOKENS.LOGGER, { isOptional: true })
    private readonly logger: Logger | null = null,
  ) {}

  attachRuntime(runtime: SessionHandoverRuntime): void {
    this.runtime = runtime;
  }

  /** Lets a host-owned child lease replace the lifecycle default at handover. */
  setResourceLeaseProvider(
    provider: (sourceSessionId: string) => Partial<HandoverSourceSnapshot['resourceLease']> | undefined,
  ): () => void {
    this.resourceLeaseProvider = provider;
    return () => {
      if (this.resourceLeaseProvider === provider) this.resourceLeaseProvider = null;
    };
  }

  /** Lets the CLI lane runtime report lanes still working for a source. */
  setLaneWorkProvider(provider: LaneWorkProvider): () => void {
    this.laneWorkProvider = provider;
    return () => {
      if (this.laneWorkProvider === provider) this.laneWorkProvider = null;
    };
  }

  /** Batch B forwards this revisioned event through the session-state broadcast. */
  onStateChange(listener: SessionHandoverListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  isSuccessorHostAvailable(): boolean {
    return this.successorHostResolver() !== null;
  }

  /**
   * The user's handover request (`session:beginHandover`), the only path that
   * may start one: the only setter of `userConfirmed`. Waits for the turn and
   * known work unless `continueNow`; a parked limit or agent op becomes the
   * user's op (its `agentHandoff` kept). Composer text becomes the draft.
   */
  begin(
    sourceSessionId: string,
    reason: SessionHandoverReason,
    turnInFlight: boolean,
    agentHandoff?: string,
    options: { readonly continueNow?: boolean; readonly queuedInput?: string } = {},
  ): BeginSessionHandoverResult {
    const refused = this.refusal(sourceSessionId);
    if (refused) return refused;
    const existing = this.operations.get(sourceSessionId);
    const live = existing && !this.isRestartable(existing) ? existing : undefined;
    const operation = live ?? this.createOperation(sourceSessionId, reason, agentHandoff);
    const draftCaptured = this.captureDraft(operation, options.queuedInput);
    if (live && !this.isUserGatable(live)) {
      // Already writing or starting: a repeat click changes nothing else.
      return { accepted: true, state: draftCaptured ? this.bump(live) : this.snapshot(live) };
    }
    const changed =
      !live || draftCaptured || !operation.userConfirmed || operation.requestedBy !== undefined;
    operation.userConfirmed = true;
    operation.requestedBy = undefined;
    if (options.continueNow) {
      if (!turnInFlight) return { accepted: true, state: this.startConfirmed(operation) };
      operation.forced = true;
    }
    return { accepted: true, state: this.gate(operation, turnInFlight, changed) };
  }

  /**
   * An agent's successor request (D23): parks it for the user's approval.
   * Never confirms, gates or starts; a live op is returned unchanged.
   */
  requestFromAgent(sourceSessionId: string, agentHandoff?: string): BeginSessionHandoverResult {
    const refused = this.refusal(sourceSessionId);
    if (refused) return refused;
    const existing = this.operations.get(sourceSessionId);
    if (existing && !this.isRestartable(existing)) {
      return { accepted: true, state: this.snapshot(existing) };
    }
    const operation = this.createOperation(sourceSessionId, 'successor', agentHandoff);
    operation.phase = 'awaiting-confirmation';
    operation.requestedBy = 'agent';
    this.logger?.info(`[SessionHandover] Agent requested a successor for ${sourceSessionId}`, { operationId: operation.id });
    return { accepted: true, state: this.publish(operation) };
  }

  /**
   * Turn terminal (and the post-result blocking limit). Parks `budget-limit`
   * at the blocking limit, converts a parked agent request there, re-gates a
   * user-confirmed wait, and holds queued inputs only for a holding op.
   * Creates nothing else and never starts an op the user did not confirm.
   */
  armAtTerminal(
    sourceSessionId: string,
    atBlockingLimit: boolean,
    queuedInputs: QueuedSessionInput[],
  ): SessionHandoverState | undefined {
    const existing = this.operations.get(sourceSessionId);
    let operation = existing && !this.isRestartable(existing) ? existing : undefined;
    let changed = false;
    if (!operation) {
      if (!atBlockingLimit) return undefined;
      operation = this.createOperation(sourceSessionId, 'budget-limit');
      operation.phase = 'awaiting-confirmation';
      changed = true;
    } else if (atBlockingLimit && this.isAgentRequest(operation)) {
      // Sends are refused at the blocking limit: the request becomes the
      // holding limit park so queued inputs cannot drain past the limit.
      operation.reason = 'budget-limit';
      operation.requestedBy = undefined;
      changed = true;
    }
    if (operation.userConfirmed && operation.phase === 'waiting-for-turn-end') {
      const waitingFor = operation.forced ? undefined : this.workInFlight(operation);
      if (!waitingFor) {
        const started = this.startConfirmed(operation);
        // The started op holds the source: queued inputs go to the successor.
        return this.holdQueued(operation, queuedInputs) ? this.bump(operation) : started;
      }
      if (!sameWaitingFor(operation.waitingFor, waitingFor)) {
        operation.waitingFor = waitingFor;
        changed = true;
      }
    }
    if (this.holdQueued(operation, queuedInputs)) changed = true;
    return changed ? this.bump(operation) : this.snapshot(operation);
  }

  admitOrHold(
    sourceSessionId: string,
    input: QueuedSessionInput,
  ): HandoverAdmission {
    const operation = this.operations.get(sourceSessionId);
    if (!operation || !this.holdsSource(operation)) {
      return { held: false };
    }
    operation.inputs.push(input);
    this.bump(operation);
    return { held: true, operationId: operation.id };
  }

  /** Stop is held only while the op holds the source (627-L6). */
  admitInterrupt(sourceSessionId: string): HandoverAdmission {
    const operation = this.operations.get(sourceSessionId);
    return operation && this.holdsSource(operation)
      ? { held: true, operationId: operation.id }
      : { held: false };
  }

  cancel(
    sourceSessionId: string,
    operationId: string,
  ): QueuedSessionInput[] | undefined {
    const operation = this.operations.get(sourceSessionId);
    if (
      !operation ||
      operation.id !== operationId ||
      !CANCELLABLE_PHASES.has(operation.phase)
    ) {
      return undefined;
    }
    operation.phase = 'cancelled';
    operation.waitingFor = undefined;
    operation.revision += 1;
    this.restore(operation);
    this.publish(operation);
    return [...operation.inputs];
  }

  transferInputs(sourceSessionId: string): readonly QueuedSessionInput[] {
    return this.operations.get(sourceSessionId)?.inputs ?? [];
  }

  snapshotFor(sourceSessionId: string): SessionHandoverState | undefined {
    const operation = this.operations.get(sourceSessionId);
    return operation ? this.snapshot(operation) : undefined;
  }

  /** The guards of `begin` and `requestFromAgent`: no host, or no source. */
  private refusal(sourceSessionId: string): BeginSessionHandoverResult | undefined {
    if (!this.successorHostResolver()) {
      return { accepted: false, error: 'unavailable' };
    }
    // A source that no longer exists can never be handed over; refuse before
    // an operation is created so the caller can fall back at once.
    if (this.runtime && !this.runtime.sourceSnapshot(sourceSessionId)) {
      return { accepted: false, error: 'source-unavailable' };
    }
    return undefined;
  }

  /** Registers an unpublished op; the caller sets its phase and publishes. */
  private createOperation(
    sourceSessionId: string,
    reason: SessionHandoverReason,
    agentHandoff?: string,
  ): Operation {
    const operation: Operation = {
      id: crypto.randomUUID(),
      sourceSessionId,
      reason,
      ...(agentHandoff ? { agentHandoff } : {}),
      phase: 'waiting-for-turn-end',
      revision: 1,
      inputs: [],
      restored: false,
      lostInputCount: 0,
      lostInputTexts: [],
    };
    this.operations.set(sourceSessionId, operation);
    return operation;
  }

  /** Stores composer text as the draft, a second capture after a blank line. */
  private captureDraft(operation: Operation, text: string | undefined): boolean {
    if (!text?.trim()) return false;
    if (!DRAFT_CAPTURE_PHASES.has(operation.phase)) {
      this.logger?.warn('[SessionHandover] Draft not captured; the handover is closing', { operationId: operation.id });
      return false;
    }
    operation.draftText = operation.draftText ? `${operation.draftText}\n\n${text}` : text;
    return true;
  }

  /** Phases in which the user's begin runs the work gate. */
  private isUserGatable(operation: Operation): boolean {
    return (
      operation.phase === 'waiting-for-turn-end' ||
      operation.phase === 'awaiting-confirmation'
    );
  }

  /** Waits in `waiting-for-turn-end` for the turn and known work, or starts. */
  private gate(operation: Operation, turnInFlight: boolean, changed: boolean): SessionHandoverState {
    const waitingFor = operation.forced ? undefined : this.workInFlight(operation);
    if (!turnInFlight && !waitingFor) return this.startConfirmed(operation);
    const moved = operation.phase !== 'waiting-for-turn-end';
    const refreshed = !sameWaitingFor(operation.waitingFor, waitingFor);
    operation.phase = 'waiting-for-turn-end';
    operation.waitingFor = waitingFor;
    return changed || moved || refreshed ? this.bump(operation) : this.snapshot(operation);
  }

  /** Subagents and lanes still working for the source; undefined when none. */
  private workInFlight(operation: Operation): WaitingFor | undefined {
    const { sourceSessionId } = operation;
    const subagents = this.runtime?.subagentsInFlight(sourceSessionId) ?? 0;
    let lanes: number | null = 0;
    if (this.laneWorkProvider) {
      const tabId = this.runtime?.sourceSnapshot(sourceSessionId)?.tabId ?? sourceSessionId;
      try {
        lanes = this.laneWorkProvider({ sessionId: sourceSessionId, tabId });
      } catch (error: unknown) {
        // Unknown counts as work (D25): the wait never ends on an unreadable
        // lane count; the user can always continue now.
        lanes = null;
        if (!operation.laneStatusWarned) {
          operation.laneStatusWarned = true;
          const reason = error instanceof Error ? error.message : String(error);
          this.logger?.warn('[SessionHandover] Lane work provider failed; lane status unknown', { sourceSessionId, operationId: operation.id, error: reason });
        }
      }
    }
    return subagents > 0 || lanes === null || lanes > 0 ? { subagents, lanes } : undefined;
  }

  /** Moves queued inputs into a holding op; true when any moved. */
  private holdQueued(operation: Operation, queuedInputs: QueuedSessionInput[]): boolean {
    if (!this.holdsSource(operation) || queuedInputs.length === 0) return false;
    operation.inputs.push(...queuedInputs.splice(0));
    return true;
  }

  /** The one hold predicate (Decision 6): an agent request holds nothing. */
  private holdsSource(operation: Operation): boolean {
    return HELD_SOURCE_PHASES.has(operation.phase) && !this.isAgentRequest(operation);
  }

  private isAgentRequest(operation: Operation): boolean {
    return operation.phase === 'awaiting-confirmation' && operation.requestedBy === 'agent';
  }

  /** The only caller of `complete()`; acts only on a user-confirmed op. */
  private startConfirmed(operation: Operation): SessionHandoverState {
    if (!operation.userConfirmed) return this.snapshot(operation);
    operation.waitingFor = undefined;
    operation.forced = undefined;
    this.transition(operation, 'writing-handoff');
    const state = this.snapshot(operation);
    void this.complete(operation);
    return state;
  }

  private async complete(operation: Operation): Promise<void> {
    const runtime = this.runtime;
    if (
      !runtime ||
      !this.handoffBuilder ||
      !this.handoffWriter ||
      !this.historyReader
    ) {
      this.fail(operation, 'handover unavailable');
      return;
    }
    try {
      const snapshot = runtime.sourceSnapshot(operation.sourceSessionId);
      const source = snapshot && {
        ...snapshot,
        resourceLease: {
          ...snapshot.resourceLease,
          ...this.resourceLeaseProvider?.(operation.sourceSessionId),
        },
      };
      if (!source) {
        this.fail(operation, 'source session unavailable');
        return;
      }
      const successorHost = this.successorHostResolver();
      if (!successorHost) {
        this.fail(operation, 'handover unavailable');
        return;
      }
      const agentHandoff = operation.agentHandoff ?? await this.requestAgentHandoff(
        runtime,
        source,
      );
      if (!this.isActive(operation)) return;
      const built = await this.handoffBuilder.build({
        sessionId: source.sessionId,
        workspacePath: source.workspacePath,
        ...(agentHandoff ? { agentHandoff } : {}),
      });
      if (!this.isActive(operation)) return;
      const written = await this.handoffWriter.write(
        source.sessionId,
        built.document.content,
      );
      if (!this.isActive(operation)) return;
      if (!written.path) throw new Error(written.writeError ?? 'handoff write failed');

      this.transition(operation, 'starting-successor');
      const started = await successorHost.startSuccessorSession({
        operationId: operation.id,
        source,
        seed: built.document.seed,
        resourceLease: source.resourceLease,
      });
      if (!this.isActive(operation)) {
        if (started.started) await successorHost.stopSuccessorSession?.(operation.id);
        return;
      }
      if (!started.started) throw new Error(started.error ?? 'successor start failed');

      operation.successorTabId = started.successorTabId;

      this.transition(operation, 'successor-confirmed');
      const deliveredInputs: QueuedSessionInput[] = [];
      let deliveredDraftLength = 0;
      do {
        const transferInputs = [...operation.inputs];
        // The draft rides last in the first batch, as one input that waits
        // for the successor to be idle; a later capture rides the next batch.
        const draftLength = operation.draftText?.length ?? 0;
        const pending = operation.draftText?.slice(deliveredDraftLength);
        const draft = deliveredDraftLength > 0 ? pending?.replace(/^\n\n/, '') : pending;
        const delivered = await successorHost.deliverTransferInputs(
          operation.id,
          draft
            ? [...transferInputs, { content: draft, admission: 'require-idle' }]
            : transferInputs,
        );
        if (!this.isActive(operation)) {
          await successorHost.stopSuccessorSession?.(operation.id);
          return;
        }
        if (!delivered.delivered) {
          // Stop the successor so only the source keeps working, and give
          // it back every held input, earlier delivered batches first.
          operation.inputs.unshift(...deliveredInputs);
          await successorHost.stopSuccessorSession?.(operation.id);
          throw new Error(delivered.error ?? 'successor input delivery failed');
        }
        operation.inputs.splice(0, transferInputs.length);
        deliveredInputs.push(...transferInputs);
        deliveredDraftLength = draftLength;
        operation.revision += 1;
        this.publish(operation);
      } while (
        operation.inputs.length > 0 ||
        (operation.draftText?.length ?? 0) > deliveredDraftLength
      );
      // Delivered: a failure from here on has no draft to return.
      operation.draftText = undefined;
      this.transition(operation, 'closing');
      const closed = await runtime.closeIfTokenMatches(
        operation.sourceSessionId,
        source.token,
      );
      if (closed && operation.inputs.length > 0) {
        await this.deliverLateInputs(successorHost, operation);
      }
      if (!this.isActive(operation)) return;
      if (!closed) {
        operation.error = 'source token no longer matches';
        this.transition(operation, 'failed');
        return;
      }
      this.transition(operation, 'closed');
    } catch (error: unknown) {
      this.fail(
        operation,
        error instanceof Error ? error.message : 'handover failed',
      );
    }
  }

  /** Best-effort owned turn: a failed or empty response falls back to facts. */
  private async requestAgentHandoff(
    runtime: SessionHandoverRuntime,
    source: HandoverSourceSnapshot,
  ): Promise<string | undefined> {
    try {
      const before = await this.historyReader?.readHistoryForCuration(
        source.sessionId,
        source.workspacePath,
      );
      const previousId = before?.filter((message) => message.role === 'assistant').at(-1)?.id;
      await runtime.queueOwnedHandoff(source.sessionId, HANDOFF_REQUEST_PROMPT);
      const completed = await this.waitForOwnedHandoff(runtime, source);
      if (!completed) return undefined;
      const after = await this.historyReader?.readHistoryForCuration(
        source.sessionId,
        source.workspacePath,
      );
      const assistants = after?.filter((message) => message.role === 'assistant') ?? [];
      const previousIndex = previousId === undefined
        ? -1
        : assistants.findIndex((message) => message.id === previousId);
      let replies = assistants.slice(previousIndex + 1);
      if (previousId !== undefined && previousIndex < 0) {
        // A compaction between the reads trimmed the anchor: only the last
        // assistant text is surely the handoff, never older text.
        this.logger?.debug('[SessionHandover] Handoff anchor not found; using the last assistant message', { sessionId: source.sessionId });
        replies = assistants.filter((message) => message.content.trim()).slice(-1);
      }
      const handoff = replies
        .map((message) => message.content.trim())
        .filter(Boolean)
        .join('\n\n');
      return handoff || undefined;
    } catch {
      // degradation-audit: optional-capability - the agent-written handoff is
      // optional; undefined makes the caller use the deterministic builder.
      return undefined;
    }
  }

  private async waitForOwnedHandoff(
    runtime: SessionHandoverRuntime,
    source: HandoverSourceSnapshot,
  ): Promise<boolean> {
    const deadline = Date.now() + HANDOFF_REQUEST_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (!runtime.isOwnedHandoffPendingOrRunning(source.sessionId, source.token)) {
        return true;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    return false;
  }

  private transition(
    operation: Operation,
    phase: SessionHandoverState['phase'],
  ): void {
    if (this.operations.get(operation.sourceSessionId) !== operation) return;
    operation.phase = phase;
    operation.revision += 1;
    this.publish(operation);
  }

  private fail(operation: Operation, error: string): void {
    if (this.operations.get(operation.sourceSessionId) !== operation) return;
    operation.phase = 'failed';
    operation.waitingFor = undefined;
    operation.error = error;
    operation.revision += 1;
    this.restore(operation);
    this.publish(operation);
  }

  /** Called before a token-matched session record is removed. */
  sourceEnded(sourceSessionId: string, token: string, reason: string): void {
    const operation = this.operations.get(sourceSessionId);
    if (!operation) return;
    const source = this.runtime?.sourceSnapshot(sourceSessionId);
    if (!source || source.token !== token) return;
    if (operation.phase === 'closing') {
      this.transition(operation, 'closed');
      return;
    }
    if (operation.phase === 'closed' || operation.phase === 'failed' || operation.phase === 'cancelled') {
      return;
    }
    operation.phase = 'failed';
    operation.waitingFor = undefined;
    operation.error = `source session ended: ${reason}`;
    operation.revision += 1;
    operation.lostInputCount = operation.inputs.length;
    operation.lostInputTexts = this.boundedLostInputTexts(operation.inputs);
    this.publish(operation);
  }

  /** Input held while the source closed goes to the successor, never nowhere. */
  private async deliverLateInputs(
    successorHost: SessionSuccessorHost,
    operation: Operation,
  ): Promise<void> {
    const lateInputs = [...operation.inputs];
    let delivered = false;
    try {
      delivered = (
        await successorHost.deliverTransferInputs(operation.id, lateInputs)
      ).delivered;
    } catch {
      // The source is already closed, so a throw is a failed delivery: the
      // inputs are reported as lost below instead of failing a closed handover.
      delivered = false;
    }
    if (!delivered) {
      operation.lostInputCount = lateInputs.length;
      operation.lostInputTexts = this.boundedLostInputTexts(lateInputs);
    }
    operation.inputs.splice(0, lateInputs.length);
    operation.revision += 1;
    this.publish(operation);
  }

  private restore(operation: Operation): void {
    if (operation.restored || operation.inputs.length === 0) return;
    const restored = this.runtime?.restoreInputs(
      operation.sourceSessionId,
      operation.inputs,
    ) ?? false;
    if (restored) {
      operation.restored = true;
      if (operation.error === RESTORE_FAILED_ERROR) operation.error = undefined;
      operation.lostInputCount = 0;
      operation.lostInputTexts = [];
      return;
    }
    operation.error = RESTORE_FAILED_ERROR;
    operation.lostInputCount = operation.inputs.length;
    operation.lostInputTexts = this.boundedLostInputTexts(operation.inputs);
  }

  private boundedLostInputTexts(
    inputs: readonly QueuedSessionInput[],
  ): string[] {
    let remaining = LOST_INPUT_TEXT_TOTAL_LIMIT;
    const texts: string[] = [];
    for (const input of inputs) {
      if (remaining <= 0) break;
      const text = input.content.slice(0, Math.min(LOST_INPUT_TEXT_LIMIT, remaining));
      if (!text) continue;
      texts.push(text);
      remaining -= text.length;
    }
    return texts;
  }

  private isActive(operation: Operation): boolean {
    return (
      this.operations.get(operation.sourceSessionId) === operation &&
      operation.phase !== 'failed' &&
      operation.phase !== 'cancelled' &&
      operation.phase !== 'closed'
    );
  }

  private isRestartable(operation: Operation): boolean {
    return (
      operation.phase === 'failed' ||
      operation.phase === 'cancelled' ||
      operation.phase === 'closed'
    );
  }

  /** Bumps the revision and publishes. */
  private bump(operation: Operation): SessionHandoverState {
    operation.revision += 1;
    return this.publish(operation);
  }

  private publish(operation: Operation): SessionHandoverState {
    const state = this.snapshot(operation);
    const { operationId, reason, phase, heldInputCount, waitingFor, requestedBy, error } = state;
    this.logger?.info('[SessionHandover] State published', { operationId, reason, phase, heldInputCount, waitingFor, requestedBy, error });
    for (const listener of this.listeners) listener(state);
    return state;
  }

  private snapshot(operation: Operation): SessionHandoverState {
    return {
      operationId: operation.id,
      sourceSessionId: operation.sourceSessionId,
      reason: operation.reason,
      phase: operation.phase,
      revision: operation.revision,
      heldInputCount: operation.inputs.length,
      ...(operation.successorTabId ? { successorTabId: operation.successorTabId } : {}),
      ...(operation.waitingFor ? { waitingFor: { ...operation.waitingFor } } : {}),
      ...(operation.requestedBy ? { requestedBy: operation.requestedBy } : {}),
      ...(operation.draftText &&
      (operation.phase === 'cancelled' || operation.phase === 'failed')
        ? { draftText: operation.draftText }
        : {}),
      ...(operation.lostInputCount > 0
        ? {
            lostInputCount: operation.lostInputCount,
            lostInputsMessage: 'Held messages could not be restored. Copy them back into the composer before restarting.',
            lostInputTexts: operation.lostInputTexts,
          }
        : {}),
      ...(operation.error ? { error: operation.error } : {}),
    };
  }
}
