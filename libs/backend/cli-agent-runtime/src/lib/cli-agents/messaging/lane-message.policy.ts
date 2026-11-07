/**
 * Who may message whom among lanes (Component 15, ALL-SIBLINGS rule).
 *
 * A lane may message another lane only when both run under the same parent
 * session in the same workspace. Every identity input is host-owned:
 * - the sender is the credential binding the MCP gate accepted, never an
 *   argument or a URL field;
 * - `workspaceKey` is the canonical workspace identity the host stamped on
 *   each lane record at spawn.
 *
 * Path containment is not workspace identity, and nothing falls back to a
 * working directory when an identity is missing: a missing input denies.
 * `privileged` capability alone never authorizes a target; whether the tool
 * may be called at all stays with the MCP gate's tool permission check.
 */
import { normalizeWorkspaceRoot } from '@ptah-extension/platform-core';
import {
  AGENT_LANE_MESSAGE_MAX_CHARS,
  type AgentId,
  type AgentProcessInfo,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { LaneSenderRateLimiter } from './lane-sender-rate.limiter';

/** Stable deny codes, in the order they are checked. */
export type LaneMessageDenyReason =
  | 'identity-missing'
  | 'sender-unknown'
  | 'self-target'
  | 'parent-missing'
  | 'different-parent'
  | 'workspace-missing'
  | 'different-workspace'
  | 'rate-limited'
  | 'body-too-large';

/** The lane a verified credential binding names. Built only from that binding. */
export interface VerifiedLaneSender {
  readonly agentId: AgentId;
  /** The binding's root; PR #956 issues it as the lane's working directory. */
  readonly workspaceRoot?: string;
  readonly sessionId?: string;
}

export type LaneMessageDecision =
  | { readonly allowed: true; readonly senderRecord: AgentProcessInfo }
  | { readonly allowed: false; readonly reason: LaneMessageDenyReason };

export interface LaneMessagePolicyDeps {
  readonly findAgentInfo: (agentId: AgentId) => AgentProcessInfo | undefined;
  /** Lane lifecycle events; `agent:expired` drops the sender's rate window. */
  readonly events?: {
    on(event: 'agent:expired', listener: (payload: { agentId: string }) => void): unknown;
    off(event: 'agent:expired', listener: (payload: { agentId: string }) => void): unknown;
  };
  readonly logger: Logger;
  readonly limiter?: LaneSenderRateLimiter;
  readonly clock?: () => number;
}

export class LaneMessagePolicy {
  private readonly limiter: LaneSenderRateLimiter;
  private readonly clock: () => number;
  private readonly onExpired = ({ agentId }: { agentId: string }): void => {
    this.limiter.forget(agentId);
  };

  constructor(private readonly deps: LaneMessagePolicyDeps) {
    this.limiter = deps.limiter ?? new LaneSenderRateLimiter();
    this.clock = deps.clock ?? Date.now;
    deps.events?.on('agent:expired', this.onExpired);
  }

  dispose(): void {
    this.deps.events?.off('agent:expired', this.onExpired);
  }

  /**
   * Decide one lane-to-lane send. An allowed send counts against the sender's
   * rate window; a denied one does not. A denial is logged with ids only.
   */
  authorize(
    sender: VerifiedLaneSender | undefined,
    target: AgentProcessInfo,
    bodyChars: number,
  ): LaneMessageDecision {
    const decision = this.decide(sender, target, bodyChars);
    if (decision.allowed) {
      this.limiter.record(decision.senderRecord.agentId, this.clock());
    } else {
      this.deps.logger.warn('[LaneMessagePolicy] Lane-to-lane message denied', {
        reason: decision.reason,
        senderAgentId: sender?.agentId,
        targetAgentId: target.agentId,
      });
    }
    return decision;
  }

  private decide(
    sender: VerifiedLaneSender | undefined,
    target: AgentProcessInfo,
    bodyChars: number,
  ): LaneMessageDecision {
    if (!sender?.agentId) return deny('identity-missing');
    const senderRecord = this.deps.findAgentInfo(sender.agentId);
    if (!senderRecord) return deny('sender-unknown');
    if (senderRecord.agentId === target.agentId) return deny('self-target');
    if (!senderRecord.parentSessionId || !target.parentSessionId) return deny('parent-missing');
    if (senderRecord.parentSessionId !== target.parentSessionId) return deny('different-parent');
    if (!bindingMatchesRecord(sender, senderRecord)) return deny('workspace-missing');
    if (!senderRecord.workspaceKey || !target.workspaceKey) return deny('workspace-missing');
    if (senderRecord.workspaceKey !== target.workspaceKey) return deny('different-workspace');
    if (this.limiter.isLimited(senderRecord.agentId, this.clock())) return deny('rate-limited');
    if (bodyChars > AGENT_LANE_MESSAGE_MAX_CHARS) return deny('body-too-large');
    return { allowed: true, senderRecord };
  }
}

/**
 * The binding was issued for this lane record: its root is the record's
 * working directory after normalization (A3). A missing root denies.
 */
function bindingMatchesRecord(sender: VerifiedLaneSender, record: AgentProcessInfo): boolean {
  if (!sender.workspaceRoot?.trim() || !record.workingDirectory?.trim()) return false;
  return normalizeWorkspaceRoot(sender.workspaceRoot) === normalizeWorkspaceRoot(record.workingDirectory);
}

function deny(reason: LaneMessageDenyReason): LaneMessageDecision {
  return { allowed: false, reason };
}
