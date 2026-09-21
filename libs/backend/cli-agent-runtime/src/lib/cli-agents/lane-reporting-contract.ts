/**
 * The completion contract every lane is given (TASK_2026_515).
 *
 * One text, two prompt-assembly points, because a lane's prompt is built in
 * two different places and a second copy of these words would drift:
 *
 *  - `buildTaskPrompt` (`cli-adapters/cli-adapter.utils.ts`) — every rival CLI
 *    adapter.
 *  - the `ptahCliId` branch of `agent-namespace.builder.ts` — Ptah CLI lanes,
 *    whose task string is handed to the SDK verbatim and never passes through
 *    `buildTaskPrompt`.
 *
 * The contract asks the lane to state its deliverable BEFORE it exits. That is
 * belt and braces with {@link LaneCompletionNotifier}, deliberately: the
 * notifier tells the orchestrator whether the files exist, and the lane's own
 * report tells it what the lane believes it did. A lane that exits silently
 * still produces a signal, so the orchestrator is never left waiting — but a
 * lane that reports gives the orchestrator the account a file listing cannot.
 */

export interface LaneCompletionContractInput {
  readonly taskFolder?: string;
  readonly deliverables?: readonly string[];
}

/**
 * Render the block appended to a lane's prompt. Returns `''` when there is
 * nothing to say, so a caller can concatenate unconditionally.
 */
export function renderLaneCompletionContract(
  input: LaneCompletionContractInput,
): string {
  const { taskFolder, deliverables = [] } = input;
  const lines: string[] = ['## Before you exit'];

  if (deliverables.length > 0) {
    lines.push(
      'Write every one of these files before your final message. The session ' +
        'that spawned you checks each path the moment you exit, and a clean ' +
        'exit with a missing or empty file is reported as work NOT done:',
      ...deliverables.map((path) => `- ${path}`),
    );
  } else if (taskFolder) {
    lines.push(
      `Write your deliverable under ${taskFolder} before your final message.`,
    );
  } else {
    lines.push(
      'State your deliverable in your final message before you exit.',
    );
  }

  lines.push(
    'Then call `ptah_agent_report` once with: what you produced, the absolute ' +
      'path of each file you wrote, and anything you could NOT do. That call ' +
      'reaches the session that spawned you immediately — it is how the ' +
      'orchestrator learns what you did without reading your whole output. ' +
      'If it returns `delivered: false`, put the same summary in your final ' +
      'message instead.',
    'Never end a turn claiming success for a file you did not write.',
  );

  return lines.join('\n');
}
