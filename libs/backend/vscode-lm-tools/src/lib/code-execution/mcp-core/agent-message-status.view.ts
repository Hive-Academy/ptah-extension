import type { AgentNamespace } from '../types';

type MessageStatus = Awaited<ReturnType<AgentNamespace['messageStatus']>>;

/**
 * The `ptah_agent_message_status` reply, shared by the HTTP and stdio
 * surfaces. Every receipt key is kept (Preserve 2) and these are added or
 * made explicit:
 * - `requestedAgentId`: the id the caller asked about;
 * - `agentId`: the lane that now owns the message (differs after a resume);
 * - `attemptCount` and `ackState`, the lane's own acknowledgment
 *   (`ptah_agent_message_ack`). A receipt without an ack state (never
 *   started, or written before acks existed) reads `unavailable`.
 *
 * The legacy `{ status, reason }` answer of a host without the coordinator
 * keeps its old shape.
 */
export function agentMessageStatusView(
  requestedAgentId: string,
  messageId: string,
  status: MessageStatus,
): Record<string, unknown> {
  if (!('state' in status)) return { agentId: requestedAgentId, messageId, ...status };
  return {
    messageId,
    ...status,
    requestedAgentId,
    agentId: status.actualAgentId ?? status.agentId,
    attemptCount: status.attemptCount ?? 0,
    ackState: status.ackState ?? 'unavailable',
  };
}
