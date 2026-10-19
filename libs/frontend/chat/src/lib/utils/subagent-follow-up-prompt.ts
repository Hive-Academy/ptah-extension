import type { SubagentRecord } from '@ptah-extension/chat-streaming';

const MAX_TASK_LENGTH = 200;

/** The task as one short line with no double quotes, so it fits in "…". */
function oneLine(task: string): string {
  const flat = task.replace(/"/g, "'").replace(/\s+/g, ' ').trim();
  return flat.length > MAX_TASK_LENGTH
    ? `${flat.slice(0, MAX_TASK_LENGTH - 1)}…`
    : flat;
}

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
  const taskText = oneLine(record.taskDescription ?? '');
  const task = taskText ? ` that worked on "${taskText}"` : '';
  return `Continue the ${name}${id}${task} with this message from me:\n\n${text}`;
}
