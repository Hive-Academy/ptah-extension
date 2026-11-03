import type { SessionBudgetState } from '@ptah-extension/shared';
import {
  formatTokens,
  formatUsd,
  isCostMeasure,
} from '../components/molecules/notifications/session-budget-format';

/**
 * The messages the budget wrap-up sends. A leaf module on purpose: the root
 * auto-handoff coordinator and the skill probe need the command text, but must
 * not pull the chat view's services (and `ChatStore`) through it
 * (TASK_2026_863).
 */

/**
 * The message "Wrap up & hand off" sends. `{used}` is replaced with the
 * session's formatted usage (for example `41.2M`).
 */
export const SESSION_WRAP_UP_PROMPT = `This session has used {used} tokens. Please wrap up and prepare a handoff.

1. Do not start new work. Collect the results of subagents and CLI agent lanes that already reported. Do not poll or call wait tools for the ones still running: each one pushes its report and a completion signal with its final status into this session when it ends. List each running one in the handoff (its id, its task, how to read its result) and continue.
2. Write a handoff document named \`HANDOFF.md\` in the folder of the task you are working on (for example its task-tracking folder). If there is no task folder, write it in the root of the current worktree. Include: the goal, what is done (commits, branches, PRs), what is in progress, open problems and decisions, the key files, and the exact next steps with the verification commands.
3. Finish your reply with one fenced code block that contains a self-contained prompt I can paste into a new session to continue. The prompt must give the absolute path of the handoff document and tell the new session to read it first.`;

/** The wrap-up prompt with the session's usage filled in. */
export function buildWrapUpPrompt(budget: SessionBudgetState | null): string {
  return SESSION_WRAP_UP_PROMPT.replace('{used}', usedFigure(budget));
}

/**
 * The `session-handoff` skill's slash command (TASK_2026_655). Un-namespaced:
 * the SDK resolves `/session-handoff`, not `/ptah-core:session-handoff`.
 */
export const SESSION_HANDOFF_COMMAND = '/session-handoff';

/** `/session-handoff` with the session's usage as its argument. */
export function buildHandoffCommand(budget: SessionBudgetState | null): string {
  return `${SESSION_HANDOFF_COMMAND} This session has used ${usedFigure(budget)} tokens.`;
}

/** `41.2M`, or `$8.96 worth of` for a cost budget, so "… {used} tokens" reads. */
function usedFigure(budget: SessionBudgetState | null): string {
  if (!budget || budget.used === null) return 'a large number of';
  if (isCostMeasure(budget)) return `${formatUsd(budget.used)} worth of`;
  return formatTokens(budget.used);
}