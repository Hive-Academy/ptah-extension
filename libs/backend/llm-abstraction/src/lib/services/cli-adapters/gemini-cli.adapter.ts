/**
 * Gemini CLI Adapter
 * TASK_2025_157: Headless Gemini CLI agent integration
 *
 * Invocation: gemini "task description"
 * Headless mode accepts a prompt as a positional argument,
 * prints the response to stdout, and exits immediately.
 * See: https://geminicli.com/docs/cli/tutorials/automation/
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { CliDetectionResult } from '@ptah-extension/shared';
import type {
  CliAdapter,
  CliCommand,
  CliCommandOptions,
} from './cli-adapter.interface';
import { stripAnsiCodes, buildTaskPrompt } from './cli-adapter.utils';

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
    const taskPrompt = buildTaskPrompt(options);

    // Positional argument for headless mode (no flags needed)
    args.push(taskPrompt);

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
