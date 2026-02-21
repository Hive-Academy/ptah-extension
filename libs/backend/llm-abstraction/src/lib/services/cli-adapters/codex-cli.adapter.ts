/**
 * Codex CLI Adapter
 * TASK_2025_157: Headless Codex CLI agent integration
 *
 * Invocation: codex --quiet "task description"
 * The --quiet flag suppresses interactive UI.
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

export class CodexCliAdapter implements CliAdapter {
  readonly name = 'codex' as const;
  readonly displayName = 'Codex CLI';

  async detect(): Promise<CliDetectionResult> {
    try {
      const whichCmd = process.platform === 'win32' ? 'where' : 'which';
      const { stdout: pathOutput } = await execFileAsync(whichCmd, ['codex'], {
        timeout: 5000,
      });
      const binaryPath = pathOutput.trim().split('\n')[0];

      let version: string | undefined;
      try {
        const { stdout: versionOutput } = await execFileAsync(
          'codex',
          ['--version'],
          {
            timeout: 5000,
          }
        );
        version = versionOutput.trim().split('\n')[0];
      } catch {
        // Version check failed
      }

      return {
        cli: 'codex',
        installed: true,
        path: binaryPath,
        version,
        supportsSteer: false, // Codex CLI in quiet mode does not accept stdin
      };
    } catch {
      return {
        cli: 'codex',
        installed: false,
        supportsSteer: false,
      };
    }
  }

  buildCommand(options: CliCommandOptions): CliCommand {
    const args: string[] = [];
    const taskPrompt = buildTaskPrompt(options);

    // Use --quiet for non-interactive mode
    args.push('--quiet', taskPrompt);

    return {
      binary: 'codex',
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
