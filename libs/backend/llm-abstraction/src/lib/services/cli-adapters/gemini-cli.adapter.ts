/**
 * Gemini CLI Adapter
 * TASK_2025_157: Headless Gemini CLI agent integration
 *
 * Invocation: gemini -p "task description"
 * The -p flag sends a prompt non-interactively.
 * Falls back to stdin pipe if -p is not supported.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { CliDetectionResult } from '@ptah-extension/shared';
import type {
  CliAdapter,
  CliCommand,
  CliCommandOptions,
} from './cli-adapter.interface';

const execFileAsync = promisify(execFile);

export class GeminiCliAdapter implements CliAdapter {
  readonly name = 'gemini' as const;
  readonly displayName = 'Gemini CLI';

  async detect(): Promise<CliDetectionResult> {
    try {
      const whichCmd = process.platform === 'win32' ? 'where' : 'which';
      const { stdout: pathOutput } = await execFileAsync(whichCmd, ['gemini'], {
        timeout: 5000,
      });
      const binaryPath = pathOutput.trim().split('\n')[0];

      // Try to get version
      let version: string | undefined;
      try {
        const { stdout: versionOutput } = await execFileAsync(
          'gemini',
          ['--version'],
          {
            timeout: 5000,
          }
        );
        version = versionOutput.trim().split('\n')[0];
      } catch {
        // Version check failed, CLI still usable
      }

      return {
        cli: 'gemini',
        installed: true,
        path: binaryPath,
        version,
        supportsSteer: false, // Gemini CLI does not support stdin steering in headless mode
      };
    } catch {
      return {
        cli: 'gemini',
        installed: false,
        supportsSteer: false,
      };
    }
  }

  buildCommand(options: CliCommandOptions): CliCommand {
    const args: string[] = [];

    // Build task prompt with file context
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

    // Use -p flag for non-interactive prompt
    args.push('-p', taskPrompt);

    return {
      binary: 'gemini',
      args,
    };
  }

  supportsSteer(): boolean {
    return false;
  }

  parseOutput(raw: string): string {
    return stripAnsiCodes(raw);
  }
}

/**
 * Strip ANSI escape codes from CLI output
 */
function stripAnsiCodes(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}
