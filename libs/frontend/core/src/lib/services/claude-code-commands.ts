/**
 * The Claude Code install and sign-in commands (TASK_2026_ONBOARDING).
 *
 * One source for every surface that tells the user what to type in a
 * terminal (settings credentials tab, the provider setup message and
 * onboarding), so the copies cannot drift. Values are the official commands
 * from the Claude Code setup docs (`CLAUDE_CODE_SETUP_DOCS_URL`).
 *
 * Data only: no Angular, no I/O.
 */

/** Signs in: running `claude` and following the browser prompts. */
export const CLAUDE_CODE_SIGN_IN_COMMAND = 'claude';

/** The npm install, for any system with Node.js 22 or later. */
export const CLAUDE_CODE_NPM_INSTALL_COMMAND =
  'npm install -g @anthropic-ai/claude-code';

/** The official install guide, opened in the system browser. */
export const CLAUDE_CODE_SETUP_DOCS_URL =
  'https://code.claude.com/docs/en/setup';

/** The operating-system tab an install command is listed under. */
export type ClaudeCodeInstallTab = 'unix' | 'windows' | 'npm';

/** One install command row: what to type, and who it is for. */
export interface ClaudeCodeInstallCommand {
  readonly id: 'unix' | 'powershell' | 'cmd' | 'npm';
  readonly tab: ClaudeCodeInstallTab;
  /** Who the command is for, shown above it. */
  readonly label: string;
  /** The exact command to paste into a terminal. */
  readonly command: string;
}

/** The install commands, in display order. */
export const CLAUDE_CODE_INSTALL_COMMANDS: readonly ClaudeCodeInstallCommand[] =
  [
    {
      id: 'unix',
      tab: 'unix',
      label: 'macOS, Linux, WSL (Terminal)',
      command: 'curl -fsSL https://claude.ai/install.sh | bash',
    },
    {
      id: 'powershell',
      tab: 'windows',
      label: 'Windows PowerShell (prompt starts with PS)',
      command: 'irm https://claude.ai/install.ps1 | iex',
    },
    {
      id: 'cmd',
      tab: 'windows',
      label: 'Windows CMD (prompt has no PS)',
      command:
        'curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd',
    },
    {
      id: 'npm',
      tab: 'npm',
      label: 'Any system with Node.js 22 or later (do not use sudo)',
      command: CLAUDE_CODE_NPM_INSTALL_COMMAND,
    },
  ];
