import {
  buildApprovedRootFraming,
  roundCapFor,
} from '@ptah-extension/tribunal-panel/phase';
import type { CommandCenterRunManifest } from '@ptah-extension/chat-state';
import {
  parseRosterProposal,
  rosterIsLaunchableLocally,
  type AvailableLane,
  type TribunalRosterProposal,
} from './tribunal-roster-proposal';

export const CONFIRMED_DISCOVERY_ANSWER =
  'Recorded. End this turn now without starting any agent; launch instructions follow in a separate message.';
export interface ProposalTransport {
  answer(questionId: string, questionKey: string, answer: string): boolean;
  discoveryComplete(): Promise<void>;
  createTask(proposal: TribunalRosterProposal): Promise<string | null>;
  writeManifest(workspace: string, manifest: CommandCenterRunManifest): boolean;
  sendLaunchTurn(content: string): Promise<boolean>;
}
interface Pending {
  readonly questionId: string;
  readonly questionKey: string;
  readonly proposal: TribunalRosterProposal;
  readonly workspace: string;
  readonly rootTabId: string;
  readonly rootSdkId: string;
}

/** Page-owned paid-spawn gate. Only the card's click/key path calls confirm(). */
export class TribunalRunCoordinator {
  private readonly consumed = new Set<string>();
  private readonly pending = new Map<string, Pending>();

  public constructor(private readonly transport: ProposalTransport) {}

  public receive(
    payload: unknown,
    context: {
      questionId: string;
      questionKey: string;
      rootSdkId: string;
      rootTabId: string;
      workspace: string;
      nonce: string;
      availableLanes?: readonly AvailableLane[];
    },
  ): TribunalRosterProposal | null {
    const proposal = parseRosterProposal(
      payload,
      context.rootSdkId,
      context.nonce,
      context.availableLanes,
    );
    if (!proposal || this.consumed.has(proposal.proposalId)) {
      this.transport.answer(context.questionId, context.questionKey, 'Decline');
      return null;
    }
    this.pending.set(proposal.proposalId, {
      questionId: context.questionId,
      questionKey: context.questionKey,
      proposal: {
        ...proposal,
        options: [...proposal.options],
        lanes: proposal.lanes.map((lane) => ({ ...lane })),
      },
      workspace: context.workspace,
      rootTabId: context.rootTabId,
      rootSdkId: context.rootSdkId,
    });
    return proposal;
  }

  public decline(proposalId: string): void {
    this.resolveDecline(proposalId);
  }
  public timeout(proposalId: string): void {
    this.resolveDecline(proposalId);
  }
  public pageExit(): void {
    for (const id of this.pending.keys()) this.resolveDecline(id);
  }

  public async confirm(proposalId: string): Promise<boolean> {
    const pending = this.pending.get(proposalId);
    if (!pending || this.consumed.has(proposalId)) return false;
    this.pending.delete(proposalId);
    this.consumed.add(proposalId);
    if (
      !this.transport.answer(
        pending.questionId,
        pending.questionKey,
        CONFIRMED_DISCOVERY_ANSWER,
      )
    ) {
      this.transport.answer(pending.questionId, pending.questionKey, 'Decline');
      return false;
    }
    try {
      await this.transport.discoveryComplete();
      const proposal = pending.proposal;
      if (
        !rosterIsLaunchableLocally(proposal) ||
        proposal.rootSessionId !== pending.rootSdkId
      )
        return false;
      const specTaskId =
        proposal.move === 'relay' || proposal.move === 'crucible'
          ? await this.transport.createTask(proposal)
          : null;
      if (
        (proposal.move === 'relay' || proposal.move === 'crucible') &&
        !specTaskId
      )
        return false;
      const manifest: CommandCenterRunManifest = {
        runId: crypto.randomUUID(),
        rootTabId: pending.rootTabId,
        rootSdkId: pending.rootSdkId,
        move: proposal.move,
        specTaskId: specTaskId ?? `TRIBUNAL_${proposal.proposalId}`,
        lanes: proposal.lanes.map((item) => ({
          laneId: item.laneId,
          role: item.role ?? '',
        })),
        rounds: proposal.rounds,
        startedAt: Date.now(),
      };
      if (!this.transport.writeManifest(pending.workspace, manifest))
        return false;
      const framing = buildApprovedRootFraming(proposal.move, proposal.lanes, {
        specTaskId,
        roundCap: roundCapFor({
          move: proposal.move,
          roundCap: proposal.rounds,
        }),
        rubric: null,
      });
      return this.transport.sendLaunchTurn(
        `${framing}\n\nObjective: ${proposal.objective}`,
      );
    } catch {
      // degradation-audit: reported — the launch is withheld after registration or discovery failure
      return false;
    }
  }

  private resolveDecline(proposalId: string): void {
    const pending = this.pending.get(proposalId);
    if (!pending) return;
    this.pending.delete(proposalId);
    this.consumed.add(proposalId);
    this.transport.answer(pending.questionId, pending.questionKey, 'Decline');
  }
}
