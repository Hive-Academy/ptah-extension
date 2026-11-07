/**
 * Semantic acknowledgment of a delivered message (Component 13).
 *
 * The ack is kept apart from transport (`state`) and turn (`turnOutcome`): a
 * lane says it read, acted on or rejected a message, and nothing else about
 * the envelope changes. The caller is the lane identity the transport proved
 * (the MCP credential binding), never a tool argument.
 *
 * Order: `pending`/`unavailable` → `read` → `acted`. `rejected` is terminal
 * and cannot follow `acted`. Repeating the current state is idempotent; any
 * step back is refused as `ack-regression`.
 */
import type {
  AgentDeliveryReceipt,
  AgentId,
  AgentMessageAckState,
  AgentMessageEnvelopeState,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import type { AgentIdAliasRegistry } from './agent-id-alias.registry';
import { envelopeLane } from './agent-message-reconciler';
import type { AgentMessageEnvelope } from './envelope/agent-message-envelope.schema';
import type { AgentMessageEnvelopeStore } from './envelope/agent-message-envelope.store';

export const AGENT_MESSAGE_ACK_NOTE_MAX_CHARS = 500;

export type AgentMessageAckRequestState = 'read' | 'acted' | 'rejected';

export interface AgentMessageAckRequest {
  readonly messageId: string;
  readonly state: AgentMessageAckRequestState;
  readonly note?: string;
}

export type AgentMessageAckRefusal =
  | 'not_found'
  | 'ack-forbidden'
  | 'ack-before-delivery'
  | 'ack-regression'
  | 'storage-unavailable';

export type AgentMessageAckResult =
  | {
    readonly ok: true;
    readonly messageId: string;
    readonly ackState: AgentMessageAckState;
    /** False when the message already had this ack state. */
    readonly changed: boolean;
    readonly receipt: AgentDeliveryReceipt;
  }
  | {
    readonly ok: false;
    readonly messageId: string;
    readonly code: AgentMessageAckRefusal;
    /** The current ack state; only on `ack-regression`, to the owning lane. */
    readonly ackState?: AgentMessageAckState;
  };

export interface AgentMessageAckServiceDeps {
  readonly store: Pick<AgentMessageEnvelopeStore, 'writeAck' | 'toReceipt'>;
  readonly aliases: Pick<AgentIdAliasRegistry, 'aliasesOf'>;
  readonly logger: Logger;
  readonly clock?: () => number;
}

/** Transport states in which the adapter accepted the text. */
const ACCEPTED = new Set<AgentMessageEnvelopeState>(['started', 'settled']);

/**
 * The lane may have the text. `outcome-unknown` alone does not prove it: a
 * restart right after the dispatch journal gives `outcome-unknown` before any
 * adapter call, so it also needs `maybeDelivered`.
 */
export function mayHaveReachedLane(envelope: AgentMessageEnvelope): boolean {
  return ACCEPTED.has(envelope.state) ||
    (envelope.state === 'outcome-unknown' && envelope.maybeDelivered === true);
}
const RANK: Readonly<Record<AgentMessageAckState, number>> = {
  pending: 0, unavailable: 0, read: 1, acted: 2, rejected: 2,
};

export class AgentMessageAckService {
  private readonly clock: () => number;

  constructor(private readonly deps: AgentMessageAckServiceDeps) {
    this.clock = deps.clock ?? Date.now;
  }

  async acknowledge(request: AgentMessageAckRequest, caller: { readonly agentId: AgentId }): Promise<AgentMessageAckResult> {
    const { messageId } = request;
    // Resolved before the lock (the alias registry is async); the owner is
    // compared inside it, against the record the write is decided on.
    const ownLanes = await this.ownLanes(caller.agentId);
    const note = normalizeAckNote(request.note);
    const decision: { refusal?: 'ack-forbidden' | 'ack-before-delivery' | 'ack-regression'; changed: boolean } = {
      changed: false,
    };
    let written: AgentMessageEnvelope | undefined;
    try {
      written = await this.deps.store.writeAck(messageId, (current) => {
        if (!ownLanes.has(envelopeLane(current))) {
          decision.refusal = 'ack-forbidden';
          return undefined;
        }
        if (!mayHaveReachedLane(current)) {
          decision.refusal = 'ack-before-delivery';
          return undefined;
        }
        if (current.ackState === request.state) return undefined;
        if (current.ackState !== undefined && RANK[request.state] <= RANK[current.ackState]) {
          decision.refusal = 'ack-regression';
          return undefined;
        }
        decision.changed = true;
        return { ackState: request.state, ackAt: this.clock(), ackNote: note };
      });
    } catch (error: unknown) {
      this.deps.logger.error('[AgentMessageAck] Ack not persisted; the ack is not recorded',
        error instanceof Error ? error : new Error('Ack write failed'));
      return refused(messageId, 'storage-unavailable');
    }
    if (!written) return refused(messageId, 'not_found');
    if (decision.refusal === 'ack-regression')
      return { ok: false, messageId, code: 'ack-regression', ...(written.ackState ? { ackState: written.ackState } : {}) };
    if (decision.refusal) return refused(messageId, decision.refusal);
    return {
      ok: true, messageId, ackState: request.state, changed: decision.changed,
      receipt: this.deps.store.toReceipt(written),
    };
  }

  /**
   * The caller and every older id that resolves to it, so a resumed lane
   * acks a message delivered to its previous id.
   */
  private async ownLanes(caller: AgentId): Promise<ReadonlySet<AgentId>> {
    return new Set([caller, ...await this.deps.aliases.aliasesOf(caller)]);
  }
}

/** Whitespace collapsed, at most 500 characters; empty means no note. */
export function normalizeAckNote(note: string | undefined): string | undefined {
  const collapsed = note?.replace(/\s+/g, ' ').trim();
  return collapsed ? collapsed.slice(0, AGENT_MESSAGE_ACK_NOTE_MAX_CHARS) : undefined;
}

function refused(messageId: string, code: AgentMessageAckRefusal): AgentMessageAckResult {
  return { ok: false, messageId, code };
}
