/**
 * Formats the text a lane receives for one message (Component 6).
 *
 * The header `[Ptah message <id> from <sender label>]` lets the lane refer to
 * the message by id. It carries only the envelope id and a fixed sender label:
 * never a session id, workspace path, account or any other host detail. Phase 3
 * names the sending lane once the sender is verified; until then a lane sender
 * gets a generic label, so an unverified name cannot impersonate anyone.
 *
 * When the lane can call Ptah MCP tools (Component 13), a closing line asks it
 * to acknowledge the message with `ptah_agent_message_ack`. A lane without MCP
 * gets no such line, because it has no way to answer it.
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

export function agentMessageAckLine(messageId: string): string {
  return `[Reply with ptah_agent_message_ack { messageId: "${messageId}", state: "read" | "acted" | "rejected" }]`;
}

export function formatAgentMessageDeliveryText(
  messageId: string,
  sender: AgentMessageSender,
  body: string,
  ackRequested: boolean,
): string {
  const text = `[Ptah message ${messageId} from ${agentMessageSenderLabel(sender)}]\n\n${body}`;
  return ackRequested ? `${text}\n\n${agentMessageAckLine(messageId)}` : text;
}
