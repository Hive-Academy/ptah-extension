/**
 * The texts of the subagent budget monitor: the near-budget warning a
 * subagent gets, and the parent message sent when it stops a subagent: who
 * stopped it (Ptah's monitor, not the user) and why, and everything a fresh
 * subagent of the same type and name needs to continue.
 */
import type { HandoffFileState } from './subagent-handoff-files';

/** Why the monitor stopped a subagent. */
export type StopReason = 'handoff' | 'safety';

/**
 * Who the handoff names (the registry record when there is one, else
 * `task_started`) and the SDK task it ran as.
 */
export interface HandoffSubject {
  readonly agentType: string;
  readonly teammateName?: string;
  /** The SDK task id the stop used. */
  readonly taskId: string;
  /** The task's output file, when its spawning tool result already named it. */
  readonly outputFile?: string;
}

/** The stopped subagent's usage and the limit it reached. */
export interface HandoffUsage {
  readonly reason: StopReason;
  readonly contextTokens: number;
  readonly weightedUsed: number;
  readonly handoffTokens: number;
  readonly stopWeightedTokens: number;
}

/**
 * The one notice a subagent gets near its handoff size: write progress notes
 * to `notesPath` now (the same path the hard-stop handoff names), then go on.
 */
export function nearBudgetWarning(
  contextTokens: number,
  handoffTokens: number,
  notesPath: string,
): string {
  return (
    `Ptah budget notice: your context is at ${contextTokens} tokens, close to ` +
    `the ${handoffTokens}-token limit at which Ptah's subagent budget monitor ` +
    `stops this subagent. Before your next step, write your progress notes to ` +
    `${notesPath} (create its directory if needed; overwrite the file): current ` +
    `state, findings, decisions and their reasons, files touched, and the exact ` +
    `next steps. Then continue your task. If you are stopped, a fresh subagent ` +
    `continues from that file.`
  );
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
  const { paths, taskSaved, notesWritten, unavailable } = files;
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
  lines.push(
    !paths
      ? 'Its progress notes file: unavailable (workspace unknown).'
      : unavailable
        ? `Its progress notes file: unavailable (the file check did not finish); look for ${paths.notes}.`
        : notesWritten
          ? `Its progress notes are at ${paths.notes}.`
          : `Its progress notes file is missing: ${paths.notes} was not written.`,
  );
  lines.push(
    subject.outputFile
      ? `Its output so far is in ${subject.outputFile} (task ${subject.taskId}).`
      : `Its output file: not yet known; it is in the task notification for task ${subject.taskId}.`,
  );
  const fresh = subject.teammateName
    ? `a fresh \`${subject.agentType}\` subagent named '${subject.teammateName}'`
    : `a fresh \`${subject.agentType}\` subagent`;
  const resume =
    paths && unavailable
      ? `If ${paths.notes} exists, read it first and continue from it; otherwise check the files the stopped subagent changed. Do not redo finished work.`
      : paths && notesWritten
        ? `Read ${paths.notes} first and continue from it; do not redo finished work.`
        : 'Check the files the stopped subagent changed and continue from them; do not redo finished work.';
  lines.push(
    `If its task is not finished, spawn ${fresh} with ${taskSource}, ` +
      `plus this instruction: "${resume}"`,
  );
  return lines.join('\n');
}
