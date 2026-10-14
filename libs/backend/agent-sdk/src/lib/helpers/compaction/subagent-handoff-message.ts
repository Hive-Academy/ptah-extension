/**
 * The parent message the subagent budget monitor sends when it stops a
 * subagent: who stopped it (Ptah's monitor, not the user) and why, and
 * everything a fresh subagent of the same type and name needs to continue.
 */
import type { SubagentHandoffPaths } from './subagent-handoff-files';

/** Why the monitor stopped a subagent. */
export type StopReason = 'handoff' | 'safety';

/** Who the handoff names: the registry record when there is one, else `task_started`. */
export interface HandoffSubject {
  readonly agentType: string;
  readonly teammateName?: string;
}

/** Where the handoff files of a stopped subagent stand. */
export interface HandoffFileState {
  /** Absent when the session has no known workspace. */
  readonly paths?: SubagentHandoffPaths;
  readonly taskSaved: boolean;
  readonly notesWritten: boolean;
}

/** The stopped subagent's usage and the limit it reached. */
export interface HandoffUsage {
  readonly reason: StopReason;
  readonly contextTokens: number;
  readonly weightedUsed: number;
  readonly handoffTokens: number;
  readonly stopWeightedTokens: number;
}

export function handoffMessage(
  subject: HandoffSubject,
  usage: HandoffUsage,
  taskText: string | undefined,
  files: HandoffFileState,
): string {
  const name = subject.teammateName
    ? `\`${subject.agentType}\` ('${subject.teammateName}')`
    : `\`${subject.agentType}\``;
  const why =
    usage.reason === 'handoff'
      ? `at ${usage.contextTokens} context tokens (handoff limit ${usage.handoffTokens} tokens)`
      : `after ${Math.round(usage.weightedUsed)} weighted tokens (safety limit ${usage.stopWeightedTokens})`;
  const { paths, taskSaved, notesWritten } = files;
  const lines = [
    `Ptah's subagent budget monitor stopped subagent ${name} ${why}. ` +
      `The user did not stop it; a task notification that reports it as ` +
      `stopped by the user refers to this automatic stop. It cannot be resumed.`,
  ];
  if (taskText) {
    lines.push(`Its task was: ${taskText}`);
  }
  const taskSource =
    paths && taskSaved
      ? `its full original task prompt, saved at ${paths.task}`
      : 'its full original task prompt from the Agent call that spawned it';
  if (paths) {
    lines.push(
      notesWritten
        ? `Its progress notes are at ${paths.notes}.`
        : `Its progress notes file is missing: ${paths.notes} was not written.`,
    );
  }
  lines.push(
    'Its output so far is in the output file named by the task notification for this task.',
  );
  const fresh = subject.teammateName
    ? `a fresh \`${subject.agentType}\` subagent named '${subject.teammateName}'`
    : `a fresh \`${subject.agentType}\` subagent`;
  const resume =
    paths && notesWritten
      ? `Read ${paths.notes} first and continue from it; do not redo finished work.`
      : 'Check the files the stopped subagent changed and continue from them; do not redo finished work.';
  lines.push(
    `If its task is not finished, spawn ${fresh} with ${taskSource}, ` +
      `plus this instruction: "${resume}"`,
  );
  return lines.join('\n');
}
