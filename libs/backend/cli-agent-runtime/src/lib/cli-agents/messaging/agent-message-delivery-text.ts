/**
 * Formats the text a lane receives for one message (Component 6).
 *
 * The header `[Ptah message <id> from <sender label>]` lets the lane refer to
 * the message by id. It carries only the envelope id and a fixed sender label:
 * never a session id, workspace path, account or any other host detail. Phase 3
 * names the sending lane once the sender is verified; until then a lane sender
 * gets a generic label, so an unverified name cannot impersonate anyone.
 */
import type { AgentMessageSender } from '@ptah-extension/shared';

export function agentMessageSenderLabel(sender: AgentMessageSender): string {
  switch (sender.kind) {
    case 'user':
      return 'the user';
    case 'parent':
      return 'the parent session';
    case 'lane':
      return 'another agent lane';
  }
}

export function formatAgentMessageDeliveryText(
  messageId: string,
  sender: AgentMessageSender,
  body: string,
): string {
  return `[Ptah message ${messageId} from ${agentMessageSenderLabel(sender)}]\n\n${body}`;
}
