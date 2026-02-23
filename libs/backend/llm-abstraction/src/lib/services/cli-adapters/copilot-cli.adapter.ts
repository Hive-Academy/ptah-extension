/**
 * Copilot CLI Adapter
 * Uses CLI subprocess for execution with --model support.
 *
 * CLI: copilot -p "task" --allow-all-tools --silent [--model <model>]
 *
 * NOTE: SDK path (@github/copilot-sdk CopilotClient) was removed because
 * CopilotClient/CopilotSession don't support model selection.
 * The CLI subprocess path via buildCommand() supports --model.
 * SDK can be re-added when CopilotClient supports model selection.
 *
 * See: https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli
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

// ========================================
// Adapter Implementation
// ========================================

export class CopilotCliAdapter implements CliAdapter {
  readonly name = 'copilot' as const;
  readonly displayName = 'Copilot CLI';

  async detect(): Promise<CliDetectionResult> {
    try {
      const whichCmd = process.platform === 'win32' ? 'where' : 'which';
      const { stdout: pathOutput } = await execFileAsync(
        whichCmd,
        ['copilot'],
        {
          timeout: 5000,
        }
      );
      const binaryPath = pathOutput.trim().split('\n')[0];

      let version: string | undefined;
      try {
        const { stdout: versionOutput } = await execFileAsync(
          'copilot',
          ['version'],
          { timeout: 5000 }
        );
        version = versionOutput.trim().split('\n')[0];
      } catch {
        // Version check failed, CLI still usable
      }

      return {
        cli: 'copilot',
        installed: true,
        path: binaryPath,
        version,
        supportsSteer: false,
      };
    } catch {
      return {
        cli: 'copilot',
        installed: false,
        supportsSteer: false,
      };
    }
  }

  buildCommand(options: CliCommandOptions): CliCommand {
    const taskPrompt = buildTaskPrompt(options);
    const args = [
      '-p',
      taskPrompt,
      '--allow-all-tools',
      '--no-ask-user',
      '--silent',
    ];

    if (options.model) {
      args.push('--model', options.model);
    }

    return {
      binary: 'copilot',
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
