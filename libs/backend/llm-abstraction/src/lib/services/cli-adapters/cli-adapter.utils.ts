/**
 * Shared CLI Adapter Utilities
 * TASK_2025_157: Common functions extracted from individual CLI adapters
 */
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
