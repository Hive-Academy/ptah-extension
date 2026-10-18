import {
  buildApprovedRootFraming,
  roundCapFor,
} from '@ptah-extension/tribunal-panel/phase';
import type { CommandCenterRunManifest } from '@ptah-extension/chat-state';
import {
  parseRosterProposal,
  proposalIsLaunchable,
  rosterIsAvailable,
  type ProposalAvailability,
  type TribunalRosterProposal,
} from './tribunal-roster-proposal';

export const CONFIRMED_DISCOVERY_ANSWER =
  'Recorded. End this turn now without starting any agent; launch instructions follow in a separate message.';
export type ConfirmFailureReason =
  | 'cancelled'
  | 'lanes-unavailable'
  | 'answer-undelivered'
  | 'discovery-failed'
  | 'not-launchable'
  | 'task-create-failed'
  | 'manifest-write-failed'
  | 'launch-send-failed';
export type ConfirmResult =
  | { ok: true }
  | { ok: false; reason: ConfirmFailureReason; retryable: boolean };
export const CONFIRM_FAILURE_MESSAGES: Record<ConfirmFailureReason, string> = {
  cancelled:
    'Command Center closed before the run launched. Nothing was started.',
  'lanes-unavailable':
    'A selected lane is no longer available. Choose a new roster.',
  'answer-undelivered': 'The roster answer could not be delivered.',
  'discovery-failed': 'Discovery did not finish. Try confirming again.',
  'not-launchable': 'The roster is no longer launchable. Choose a new roster.',
  'task-create-failed':
    'The run task could not be created. Try confirming again.',
  'manifest-write-failed': 'The run could not be saved. Try confirming again.',
  'launch-send-failed':
    'The launch message could not be sent. Try confirming again.',
};
export interface ProposalTransport {
  answer(questionId: string, questionKey: string, answer: string): boolean;
  availability(): ProposalAvailability;
  discoveryComplete(): Promise<void>;
  createTask(proposal: TribunalRosterProposal): Promise<string | null>;
  writeManifest(workspace: string, manifest: CommandCenterRunManifest): boolean;
  removeManifest(workspace: string, runId: string): boolean;
  sendLaunchTurn(content: string): Promise<boolean>;
  reportFailure(message: string): void;
}
export interface ProposalReceiveContext {
  readonly questionId: string;
  readonly questionKey: string;
  readonly rootSdkId: string;
  readonly rootTabId: string;
  readonly workspace: string;
  readonly nonce: string;
  readonly availability: ProposalAvailability;
}
type PendingBase = Readonly<Omit<ProposalReceiveContext, 'availability'>> & {
  readonly proposal: TribunalRosterProposal;
};
export interface PendingProposal extends PendingBase {
  state: 'open' | 'answered' | 'launched' | 'declined' | 'cancelled';
  discoveryCompleted?: boolean;
  specTaskId?: string;
  runId?: string;
}

/** Page-owned paid-spawn gate. Only the card's click/key path calls confirm(). */
export class TribunalRunCoordinator {
  private readonly consumed = new Set<string>();
  private readonly pending = new Map<string, PendingProposal>();
  private readonly inFlight = new Map<string, Promise<ConfirmResult>>();

  public constructor(private readonly transport: ProposalTransport) {}

  public receive(
    payload: unknown,
    context: ProposalReceiveContext,
  ): TribunalRosterProposal | null {
    const proposal = parseRosterProposal(
      payload,
      context.rootSdkId,
      context.nonce,
      context.availability,
    );
    if (
      !proposal ||
      this.consumed.has(proposal.proposalId) ||
      this.pending.has(proposal.proposalId)
    ) {
      this.transport.answer(context.questionId, context.questionKey, 'Decline');
      return null;
    }
    this.pending.set(proposal.proposalId, {
      ...context,
      proposal: {
        ...proposal,
        options: [...proposal.options],
        lanes: proposal.lanes.map((item) => ({ ...item })),
      },
      state: 'open',
    });
    return proposal;
  }

  public decline(proposalId: string): void {
    this.resolveDecline(proposalId);
  }
  public timeout(proposalId: string): void {
    this.resolveDecline(proposalId);
  }
  /** An answered proposal is cancelled; an in-flight confirm stops before its manifest write. */
  public pageExit(): void {
    for (const [id, entry] of this.pending) {
      if (entry.state === 'open' && !this.inFlight.has(id))
        this.resolveDecline(id);
      else if (entry.state === 'answered') {
        entry.state = 'cancelled';
        this.pending.delete(id);
        this.consumed.add(id);
      }
    }
  }

  public confirm(proposalId: string): Promise<ConfirmResult> {
    const existing = this.inFlight.get(proposalId);
    if (existing) return existing;
    const entry = this.pending.get(proposalId);
    if (!entry || this.consumed.has(proposalId))
      return Promise.resolve(this.failure('not-launchable', false));
    const operation = this.confirmEntry(proposalId, entry);
    this.inFlight.set(proposalId, operation);
    void operation.then(
      () => this.inFlight.delete(proposalId),
      () => this.inFlight.delete(proposalId),
    );
    return operation;
  }

  private async confirmEntry(
    id: string,
    entry: PendingProposal,
  ): Promise<ConfirmResult> {
    if (entry.state === 'open') {
      if (!rosterIsAvailable(entry.proposal, this.transport.availability())) {
        this.transport.answer(entry.questionId, entry.questionKey, 'Decline');
        this.terminate(id, entry, 'declined');
        return this.failure('lanes-unavailable', false);
      }
      const delivered = this.transport.answer(
        entry.questionId,
        entry.questionKey,
        CONFIRMED_DISCOVERY_ANSWER,
      );
      if (!delivered) {
        const declined = this.transport.answer(
          entry.questionId,
          entry.questionKey,
          'Decline',
        );
        if (declined) this.terminate(id, entry, 'declined');
        return this.failure('answer-undelivered', !declined);
      }
      entry.state = 'answered';
    }
    if (!entry.discoveryCompleted) {
      try {
        await this.transport.discoveryComplete();
        entry.discoveryCompleted = true;
      } catch {
        // degradation-audit: reported — a failed discovery leaves the answered proposal available for retry
        if (this.isCancelled(id, entry)) return this.cancel(entry);
        return this.failure('discovery-failed', true);
      }
    }
    if (this.isCancelled(id, entry)) return this.cancel(entry);
    const proposal = entry.proposal;
    if (
      proposal.rootSessionId !== entry.rootSdkId ||
      proposal.nonce !== entry.nonce ||
      !proposalIsLaunchable(proposal) ||
      !rosterIsAvailable(proposal, this.transport.availability())
    ) {
      this.terminate(id, entry, 'declined');
      return this.failure('not-launchable', false);
    }
    const requiresTask =
      proposal.move === 'relay' || proposal.move === 'crucible';
    if (requiresTask && !entry.specTaskId) {
      try {
        entry.specTaskId =
          (await this.transport.createTask(proposal)) ?? undefined;
      } catch {
        // degradation-audit: reported — task creation failed and the answered proposal remains retryable
        if (this.isCancelled(id, entry)) return this.cancel(entry);
        return this.failure('task-create-failed', true);
      }
      if (this.isCancelled(id, entry)) return this.cancel(entry);
      if (!entry.specTaskId) return this.failure('task-create-failed', true);
    }
    entry.runId ??= crypto.randomUUID();
    const manifest: CommandCenterRunManifest = {
      runId: entry.runId,
      rootTabId: entry.rootTabId,
      rootSdkId: entry.rootSdkId,
      move: proposal.move,
      specTaskId: entry.specTaskId ?? `TRIBUNAL_${proposal.proposalId}`,
      lanes: proposal.lanes.map((item) =>
        item.role === undefined
          ? { laneId: item.laneId }
          : { laneId: item.laneId, role: item.role },
      ),
      rounds: proposal.rounds,
      startedAt: Date.now(),
    };
    try {
      if (!this.transport.writeManifest(entry.workspace, manifest))
        return this.failure('manifest-write-failed', true);
    } catch {
      // degradation-audit: reported — the manifest write failed and the answered proposal remains retryable
      return this.failure('manifest-write-failed', true);
    }
    const framing = buildApprovedRootFraming(proposal.move, proposal.lanes, {
      specTaskId: entry.specTaskId ?? null,
      roundCap: roundCapFor({ move: proposal.move, roundCap: proposal.rounds }),
      rubric: null,
    });
    try {
      if (
        await this.transport.sendLaunchTurn(
          `${framing}\n\nObjective: ${proposal.objective}`,
        )
      ) {
        this.terminate(id, entry, 'launched');
        return { ok: true };
      }
    } catch {
      // degradation-audit: reported — the failed send is rolled back below and can be retried
    }
    try {
      this.transport.removeManifest(entry.workspace, entry.runId);
    } catch {
      // degradation-audit: reported — the rollback failed; the launch failure is still reported to the page
    }
    return this.isCancelled(id, entry)
      ? this.failure('cancelled', false)
      : this.failure('launch-send-failed', true);
  }

  private isCancelled(id: string, entry: PendingProposal): boolean {
    return this.pending.get(id) !== entry;
  }

  private cancel(entry: PendingProposal): ConfirmResult {
    if (entry.runId) {
      try {
        this.transport.removeManifest(entry.workspace, entry.runId);
      } catch {
        // degradation-audit: reported — cancellation is reported even if an earlier manifest cannot be removed
      }
    }
    return this.failure('cancelled', false);
  }

  private failure(
    reason: ConfirmFailureReason,
    retryable: boolean,
  ): ConfirmResult {
    this.transport.reportFailure(CONFIRM_FAILURE_MESSAGES[reason]);
    return { ok: false, reason, retryable };
  }
  private terminate(
    id: string,
    entry: PendingProposal,
    state: 'launched' | 'declined',
  ): void {
    entry.state = state;
    this.pending.delete(id);
    this.consumed.add(id);
  }
  private resolveDecline(id: string): void {
    const entry = this.pending.get(id);
    if (!entry || entry.state !== 'open' || this.inFlight.has(id)) return;
    this.transport.answer(entry.questionId, entry.questionKey, 'Decline');
    this.terminate(id, entry, 'declined');
  }
}
