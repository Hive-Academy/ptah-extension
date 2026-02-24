/**
 * Shared CLI Adapter Utilities
 * TASK_2025_157: Common functions extracted from individual CLI adapters
 *
 * Cross-platform foundation using:
 * - `cross-spawn`: Transparent .cmd wrapper handling on Windows (no shell: true needed)
 * - `which`: Library-based binary resolution (no subprocess, no \r issues)
 */
import crossSpawn from 'cross-spawn';
import whichLib from 'which';
import type { ChildProcess } from 'child_process';
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
 * Cross-platform binary resolution. Returns full path or null.
 * Uses `which` npm package — no subprocess, no \r issues.
 */
export async function resolveCliPath(binary: string): Promise<string | null> {
  try {
    return await whichLib(binary);
  } catch {
    return null;
  }
}

/**
 * Cross-platform spawn. Uses `cross-spawn` — transparent .cmd handling on Windows.
 * No shell: true needed, no argument mangling.
 */
export function spawnCli(
  binary: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv }
): ChildProcess {
  return crossSpawn(binary, args, {
    cwd: options.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...CLI_CLEAN_ENV, ...options.env },
  });
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
