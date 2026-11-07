import type { AgentMessageSender } from '@ptah-extension/shared';
import type { AgentMessageEnvelope } from './envelope/agent-message-envelope.schema';

/** Stable dedupe and ownership key: `user`, `parent:<sessionId>` or `lane:<agentId>`. */
export function agentMessageSenderKey(sender: AgentMessageSender): string {
  switch (sender.kind) {
    case 'user':
      return 'user';
    case 'parent':
      return sender.sessionId ? `parent:${sender.sessionId}` : 'parent:anonymous';
    case 'lane':
      return `lane:${sender.agentId}`;
  }
}

/**
 * The user (renderer) may act on any envelope. A parent or lane may act only
 * on envelopes it sent; an anonymous parent has no identity to match, so it
 * may act on none.
 */
export function mayActOnEnvelope(actor: AgentMessageSender, envelope: AgentMessageEnvelope): boolean {
  if (actor.kind === 'user') return true;
  if (actor.kind === 'parent' && !actor.sessionId) return false;
  return agentMessageSenderKey(actor) === envelope.senderKey;
}
