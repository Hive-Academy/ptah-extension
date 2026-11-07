import type { AgentDeliveryReceipt } from '@ptah-extension/shared';
import type { AgentMessageEnvelope } from './agent-message-envelope.schema';

export function projectAgentMessageEnvelope(
  envelope: AgentMessageEnvelope,
): AgentDeliveryReceipt {
  const state = envelope.state === 'not-started'
    ? 'accepted'
    : envelope.state === 'failed' && envelope.reason === 'interrupted-undelivered'
      ? 'interrupted-undelivered'
      : envelope.state;
  return {
    id: envelope.id,
    agentId: envelope.targetAgentId,
    ...(envelope.actualAgentId ? { actualAgentId: envelope.actualAgentId } : {}),
    state,
    mode: envelope.mode,
    delivery: envelope.delivery,
    sender: envelope.sender.kind,
    ...(envelope.sender.kind === 'lane' ? {
      senderAgentId: envelope.sender.agentId,
      senderVerified: envelope.sender.verified,
    } : {}),
    ...(envelope.sender.kind === 'parent' && 'sessionId' in envelope.sender &&
      envelope.sender.sessionId
      ? { senderSessionId: envelope.sender.sessionId } : {}),
    ...(envelope.parentSessionId ? { parentSessionId: envelope.parentSessionId } : {}),
    createdAt: envelope.createdAt,
    updatedAt: envelope.updatedAt,
    ...(envelope.turnSeq !== undefined ? { turnSeq: envelope.turnSeq } : {}),
    ...(envelope.cliSessionId ? { cliSessionId: envelope.cliSessionId } : {}),
    ...(envelope.reason ? { reason: envelope.reason } : {}),
    ...(envelope.partialTurnLost !== undefined
      ? { partialTurnLost: envelope.partialTurnLost } : {}),
    ...(envelope.turnOutcome ? { turnOutcome: envelope.turnOutcome } : {}),
    attemptCount: envelope.attemptCount,
    ...(envelope.everDispatched !== undefined
      ? { everDispatched: envelope.everDispatched } : {}),
    ...(envelope.lastError ? { lastError: envelope.lastError } : {}),
    ...(envelope.nextRetryAt !== undefined ? { nextRetryAt: envelope.nextRetryAt } : {}),
    ...(envelope.limit ? { limit: envelope.limit } : {}),
    hasRecoverableBody: (envelope.bodyBytes ?? 0) > 0,
    ...(envelope.ackState ? { ackState: envelope.ackState } : {}),
    ...(envelope.ackAt !== undefined ? { ackAt: envelope.ackAt } : {}),
    ...(envelope.ackNote ? { ackNote: envelope.ackNote } : {}),
  };
}
