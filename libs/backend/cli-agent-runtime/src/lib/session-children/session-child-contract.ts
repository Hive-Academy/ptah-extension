/**
 * The contract a child session receives with its task (TASK_2026_584).
 *
 * Pure text. Separate from `renderLaneCompletionContract`
 * (`lane-reporting-contract.ts`), whose wording is about a CLI process that
 * exits; a child session never exits on its own, it goes idle in its tab.
 */

export interface SessionChildContractInput {
  /** How the parent is named to the child (its label or tab id). */
  readonly parentLabel: string;
  readonly label: string;
  readonly branch: string;
  readonly worktreePath: string;
  readonly bashAllowlist: readonly string[];
  readonly denyWindowMs: number;
  /** Absolute task folder, when one was given. */
  readonly taskFolder?: string;
  /** Absolute deliverable paths. */
  readonly deliverables: readonly string[];
}

/** The contract text, opened and closed by a marker line the child can quote. */
export function renderSessionChildContract(
  input: SessionChildContractInput,
): string {
  const allowlist =
    input.bashAllowlist.length > 0
      ? input.bashAllowlist.map((entry) => `\`${entry}\``).join(', ')
      : '(none: every Bash command needs approval)';
  const lines: string[] = [
    '<ptah-session-contract>',
    `You are child session "${input.label}", started by the parent session ` +
      `${input.parentLabel} with ptah_session_start.`,
    `You work on branch ${input.branch} in the git worktree ${input.worktreePath}. ` +
      'Stay inside that worktree.',
    'You run unattended in your own tab; the user may also type there. ' +
      'AskUserQuestion and plan mode are unavailable: decide, note the ' +
      'assumption, and continue.',
    'Report progress, decisions and blockers to the parent with ' +
      'ptah_agent_report. If a report is refused because the parent is not ' +
      'live, repeat its content in your final message of the turn so the ' +
      'parent reads it later.',
    'You cannot start sessions of your own (ptah_session_start is refused for ' +
      'child sessions).',
    `Bash commands that start with one of ${allowlist} run without asking. ` +
      'Any other command waits for approval in your tab and is denied after ' +
      `${formatWindow(input.denyWindowMs)}; prefer the allowed commands.`,
    'Commit your work on this branch only. Never merge, rebase onto, or push ' +
      'another branch, and never remove the worktree: the user owns merge, PR ' +
      'and worktree cleanup.',
  ];
  if (input.taskFolder) {
    lines.push(`Task folder: ${input.taskFolder}`);
  }
  if (input.deliverables.length > 0) {
    lines.push(
      'Write every one of these deliverables before you go idle; the parent ' +
        'is told which are missing, empty, or not written by you:',
      ...input.deliverables.map((path) => `- ${path}`),
    );
  } else {
    lines.push(
      'No deliverables were declared; end each turn with a short summary of ' +
        'what you did and what is left.',
    );
  }
  lines.push('</ptah-session-contract>');
  return lines.join('\n');
}

/**
 * The prompt the child's SDK session receives. A task that starts with a
 * slash command (`/orchestrate TASK_...`) must stay first, or the SDK would
 * not expand it; the contract then follows as the command's trailing text.
 * Any other task follows the contract.
 */
export function composeSessionChildPrompt(
  contract: string,
  task: string,
): string {
  const trimmed = task.trim();
  return trimmed.startsWith('/')
    ? `${trimmed}\n\n${contract}`
    : `${contract}\n\n${trimmed}`;
}

function formatWindow(ms: number): string {
  if (ms <= 0) return 'no wait (denied at once)';
  if (ms % 60_000 === 0) {
    const minutes = ms / 60_000;
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  const seconds = Math.ceil(ms / 1000);
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}
