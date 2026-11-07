/**
 * Formats the text a lane receives for one message (Component 6).
 *
 * The header `[Ptah message <id> from <sender label>]` lets the lane refer to
 * the message by id. It carries only the envelope id and a sender label: never
 * a session id, workspace path, account or any other host detail. A verified
 * lane sender (Component 15) is named by its sanitized display name and agent
 * id, so the target can reply with `ptah_agent_message`; an unverified lane
 * sender gets a generic label, so an unverified name cannot impersonate anyone.
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
      return sender.verified === true ? verifiedLaneLabel(sender.agentId, sender.name) : 'another agent lane';
  }
}

const LANE_NAME_MAX_CHARS = 64;

/** `lane "<name>" (agent <id>)`; the name keeps only plain label characters. */
function verifiedLaneLabel(agentId: string, name: string | undefined): string {
  const safe = (name ?? '').replace(/[^A-Za-z0-9 ._-]/g, '').trim().slice(0, LANE_NAME_MAX_CHARS).trim();
  return safe ? `lane "${safe}" (agent ${agentId})` : `lane (agent ${agentId})`;
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
