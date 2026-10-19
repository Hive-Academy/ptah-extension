import type { SubagentRecord } from '@ptah-extension/chat-streaming';

/**
 * The main-chat message that asks the main agent to continue a finished
 * sub-agent with the user's text (a finished sub-agent cannot be steered over
 * `subagent:send-message`). Modelled on `ChatViewComponent.handleResumeAgent`.
 * Parts the record does not know are left out, never guessed.
 */
export function subagentFollowUpPrompt(
  record: SubagentRecord,
  text: string,
): string {
  const named = record.agentType || record.teammateName;
  // No name: "the sub-agent", not "the sub-agent sub-agent".
  const name = named ? `${named} sub-agent` : 'sub-agent';
  const id = record.agentId ? ` (agent id ${record.agentId})` : '';
  const task = record.taskDescription
    ? ` that worked on "${record.taskDescription}"`
    : '';
  return `Continue the ${name}${id}${task} with this message from me:\n\n${text}`;
}
