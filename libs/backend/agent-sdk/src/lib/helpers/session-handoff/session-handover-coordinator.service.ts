import { inject, injectable } from 'tsyringe';
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
}

export type SessionHandoverListener = (state: SessionHandoverState) => void;

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
  readonly reason: SessionHandoverReason;
  readonly agentHandoff?: string;
  phase: SessionHandoverState['phase'];
  revision: number;
  readonly inputs: QueuedSessionInput[];
  error?: string;
  restored: boolean;
  lostInputCount: number;
  lostInputTexts: string[];
  successorTabId?: string;
}

const HELD_SOURCE_PHASES: ReadonlySet<SessionHandoverState['phase']> = new Set([
  'armed',
  'awaiting-confirmation',
  'writing-handoff',
  'starting-successor',
  'successor-confirmed',
  'closing',
]);

export const HANDOFF_REQUEST_TIMEOUT_MS = 180_000;
export const HANDOFF_REQUEST_PROMPT = `Write a concise Markdown handoff for the next agent taking over this work. Include the goal, current state, decisions made, files touched, open todos, exact next steps, and pitfalls. Do not call tools; respond only with the handoff.`;

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
  /** A cancelled automatic handoff stays suppressed until the hard limit. */
  private readonly cancelledAutomaticSources = new Set<string>();
  private readonly listeners = new Set<SessionHandoverListener>();
  private runtime: SessionHandoverRuntime | null = null;
  private resourceLeaseProvider: ((
    sourceSessionId: string,
  ) => Partial<HandoverSourceSnapshot['resourceLease']> | undefined) | null = null;

  constructor(
    @inject(SessionHandoffBuilder, { isOptional: true })
    private readonly handoffBuilder: SessionHandoffBuilder | null = null,
    @inject(SessionHandoffWriter, { isOptional: true })
    private readonly handoffWriter: SessionHandoffWriter | null = null,
    @inject(SDK_TOKENS.SDK_SESSION_HISTORY_READER, { isOptional: true })
    private readonly historyReader: SessionHistoryReaderService | null = null,
    private readonly successorHostResolver: () => SessionSuccessorHost | null =
      () => null,
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

  /** Batch B forwards this revisioned event through the session-state broadcast. */
  onStateChange(listener: SessionHandoverListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  isSuccessorHostAvailable(): boolean {
    return this.successorHostResolver() !== null;
  }

  /** External begin gate: an absent host must not arm or hold source input. */
  begin(
    sourceSessionId: string,
    reason: SessionHandoverReason,
    turnInFlight: boolean,
    agentHandoff?: string,
  ): BeginSessionHandoverResult {
    if (!this.successorHostResolver()) {
      return { accepted: false, error: 'unavailable' };
    }
    const state = this.request(sourceSessionId, reason, turnInFlight, agentHandoff);
    if (!turnInFlight && reason === 'successor') {
      const operation = this.operations.get(sourceSessionId);
      if (operation?.phase === 'armed') this.confirmSuccessor(operation);
    }
    return {
      accepted: true,
      state,
    };
  }

  request(
    sourceSessionId: string,
    reason: SessionHandoverReason,
    turnInFlight: boolean,
    agentHandoff?: string,
  ): SessionHandoverState {
    const existing = this.operations.get(sourceSessionId);
    if (existing && !this.isRestartable(existing)) return this.snapshot(existing);
    const operation: Operation = {
      id: crypto.randomUUID(),
      sourceSessionId,
      reason,
      ...(agentHandoff ? { agentHandoff } : {}),
      phase: turnInFlight ? 'waiting-for-turn-end' : 'armed',
      revision: 1,
      inputs: [],
      restored: false,
      lostInputCount: 0,
      lostInputTexts: [],
    };
    this.operations.set(sourceSessionId, operation);
    return this.publish(operation);
  }

  armAtTerminal(
    sourceSessionId: string,
    atBlockingLimit: boolean,
    queuedInputs: QueuedSessionInput[],
    atHandoffStage = false,
  ): SessionHandoverState | undefined {
    let operation = this.operations.get(sourceSessionId);
    if (atBlockingLimit) this.cancelledAutomaticSources.delete(sourceSessionId);
    if (
      !atBlockingLimit &&
      atHandoffStage &&
      this.cancelledAutomaticSources.has(sourceSessionId)
    ) {
      return operation ? this.snapshot(operation) : undefined;
    }
    if ((!operation || this.isRestartable(operation)) && !atBlockingLimit && !atHandoffStage) {
      return undefined;
    }
    if (!operation || this.isRestartable(operation)) {
      operation = this.createBudgetOperation(
        sourceSessionId,
        atBlockingLimit ? 'budget-limit' : 'budget-auto',
      );
    }
    if (operation.phase === 'waiting-for-turn-end') {
      operation.phase = 'armed';
      operation.revision += 1;
    }
    if (operation.phase === 'armed' && operation.reason === 'budget-limit') {
      operation.phase = 'awaiting-confirmation';
      operation.revision += 1;
    }
    if (HELD_SOURCE_PHASES.has(operation.phase) && queuedInputs.length > 0) {
      operation.inputs.push(...queuedInputs.splice(0));
      operation.revision += 1;
    }
    const state = this.publish(operation);
    if (operation.reason === 'successor' && operation.phase === 'armed') {
      this.confirmSuccessor(operation);
    }
    if (operation.reason === 'budget-auto' && operation.phase === 'armed') {
      this.startAutomatic(operation);
    }
    return state;
  }

  admitOrHold(
    sourceSessionId: string,
    input: QueuedSessionInput,
  ): HandoverAdmission {
    const operation = this.operations.get(sourceSessionId);
    if (!operation || !HELD_SOURCE_PHASES.has(operation.phase)) {
      return { held: false };
    }
    operation.inputs.push(input);
    operation.revision += 1;
    this.publish(operation);
    return { held: true, operationId: operation.id };
  }

  admitInterrupt(sourceSessionId: string): HandoverAdmission {
    const operation = this.operations.get(sourceSessionId);
    return operation && !this.isRestartable(operation)
      ? { held: true, operationId: operation.id }
      : { held: false };
  }

  confirm(
    sourceSessionId: string,
    operationId: string,
  ): SessionHandoverState | undefined {
    const operation = this.operations.get(sourceSessionId);
    if (
      !operation ||
      operation.id !== operationId ||
      operation.phase !== 'awaiting-confirmation'
    ) {
      return undefined;
    }
    operation.phase = 'writing-handoff';
    operation.revision += 1;
    const state = this.publish(operation);
    void this.complete(operation);
    return state;
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
    operation.revision += 1;
    if (operation.reason === 'budget-auto') {
      this.cancelledAutomaticSources.add(sourceSessionId);
    }
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

  private createBudgetOperation(
    sourceSessionId: string,
    reason: 'budget-limit' | 'budget-auto' = 'budget-limit',
  ): Operation {
    const operation: Operation = {
      id: crypto.randomUUID(),
      sourceSessionId,
      reason,
      phase: 'armed',
      revision: 1,
      inputs: [],
      restored: false,
      lostInputCount: 0,
      lostInputTexts: [],
    };
    this.operations.set(sourceSessionId, operation);
    return operation;
  }

  private confirmSuccessor(operation: Operation): void {
    if (operation.phase !== 'armed') return;
    operation.phase = 'awaiting-confirmation';
    operation.revision += 1;
    this.publish(operation);
    this.transition(operation, 'writing-handoff');
    void this.complete(operation);
  }

  private startAutomatic(operation: Operation): void {
    if (operation.phase !== 'armed') return;
    this.transition(operation, 'writing-handoff');
    void this.complete(operation);
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
      do {
        const transferInputs = [...operation.inputs];
        const delivered = await successorHost.deliverTransferInputs(
          operation.id,
          transferInputs,
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
        operation.revision += 1;
        this.publish(operation);
      } while (operation.inputs.length > 0);
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
      const previousIndex = previousId
        ? assistants.findIndex((message) => message.id === previousId)
        : -1;
      const handoff = assistants
        .slice(previousIndex + 1)
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
    if (operation.reason === 'budget-auto') {
      this.cancelledAutomaticSources.add(operation.sourceSessionId);
    }
    operation.phase = 'failed';
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
    operation.error = `source session ended: ${reason}`;
    operation.revision += 1;
    this.restore(operation);
    this.publish(operation);
  }

  /** Input held while the source closed goes to the successor, never nowhere. */
  private async deliverLateInputs(
    successorHost: SessionSuccessorHost,
    operation: Operation,
  ): Promise<void> {
    const lateInputs = [...operation.inputs];
    const delivered = await successorHost.deliverTransferInputs(
      operation.id,
      lateInputs,
    );
    if (delivered.delivered) {
      operation.inputs.splice(0, lateInputs.length);
    } else {
      operation.lostInputCount = lateInputs.length;
      operation.lostInputTexts = this.boundedLostInputTexts(lateInputs);
    }
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

  private publish(operation: Operation): SessionHandoverState {
    const state = this.snapshot(operation);
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
