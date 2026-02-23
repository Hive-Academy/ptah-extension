/**
 * Shared CLI Adapter Utilities
 * TASK_2025_157: Common functions extracted from individual CLI adapters
 */
import * as os from 'os';
import type { CliCommandOptions } from './cli-adapter.interface';

/**
 * Strip ANSI escape codes from CLI output.
 * Used by all CLI adapters to clean raw terminal output.
 */
export function stripAnsiCodes(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Determine whether a binary path requires shell: true for spawn().
 *
 * On Windows, npm-installed global CLI tools (gemini, codex, copilot, claude)
 * are .cmd wrapper scripts. child_process.spawn() with shell:false cannot
 * execute .cmd files — it causes ENOENT. Only full-path .exe files can be
 * spawned directly on Windows.
 *
 * Pattern from claude-domain (claude-process.ts needsShellExecution).
 */
export function needsShellExecution(binaryPath: string): boolean {
  if (os.platform() !== 'win32') {
    return false;
  }

  const pathLower = binaryPath.toLowerCase();

  // Full absolute path to a .exe — can spawn directly
  if (
    pathLower.endsWith('.exe') &&
    (pathLower.includes('\\') || pathLower.includes('/'))
  ) {
    return false;
  }

  // Everything else on Windows (.cmd wrappers, bare names) needs shell: true
  return true;
}

/**
 * Environment variables to suppress ANSI escape codes and color output
 * at the source. Prevents noisy output from CLI tools.
 */
export const CLI_CLEAN_ENV: Record<string, string> = {
  FORCE_COLOR: '0',
  NO_COLOR: '1',
  NODE_NO_READLINE: '1',
};

/**
 * Build a task prompt string from CLI command options.
 * Appends file context and task folder instructions to the base task.
 */
export function buildTaskPrompt(options: CliCommandOptions): string {
  let taskPrompt = options.task;

  if (options.files && options.files.length > 0) {
    taskPrompt += `\n\nFocus on these files:\n${options.files
      .map((f) => `- ${f}`)
      .join('\n')}`;
  }

  if (options.taskFolder) {
    taskPrompt += `\n\nWrite deliverable files to: ${options.taskFolder}`;
    taskPrompt += `\nUse convention: ${options.taskFolder}/agent-output-{agentId}.md for main deliverable.`;
  }

  return taskPrompt;
}
