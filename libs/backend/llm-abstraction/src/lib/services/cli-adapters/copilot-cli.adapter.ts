/**
 * Copilot CLI Adapter
 * Uses CLI subprocess for execution with --model support.
 *
 * CLI: copilot -p "task" --allow-all-tools --silent [--model <model>]
 *
 * Implements runSdk() using cross-spawn for cross-platform .cmd handling.
 * cross-spawn passes args directly without shell interpretation, so multi-line
 * prompts with special chars work correctly (no cmd.exe mangling).
 *
 * See: https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { CliDetectionResult } from '@ptah-extension/shared';
import type {
  CliAdapter,
  CliCommand,
  CliCommandOptions,
  SdkHandle,
} from './cli-adapter.interface';
import {
  stripAnsiCodes,
  buildTaskPrompt,
  resolveCliPath,
  spawnCli,
} from './cli-adapter.utils';

const execFileAsync = promisify(execFile);

// ========================================
// Adapter Implementation
// ========================================

export class CopilotCliAdapter implements CliAdapter {
  readonly name = 'copilot' as const;
  readonly displayName = 'Copilot CLI';

  async detect(): Promise<CliDetectionResult> {
    try {
      const binaryPath = await resolveCliPath('copilot');
      if (!binaryPath) {
        return { cli: 'copilot', installed: false, supportsSteer: false };
      }

      let version: string | undefined;
      try {
        const { stdout: versionOutput } = await execFileAsync(
          binaryPath,
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

  /**
   * Build command for the raw CLI spawn fallback path.
   * Kept as fallback but runSdk() is preferred.
   */
  buildCommand(options: CliCommandOptions): CliCommand {
    const taskPrompt = buildTaskPrompt(options);
    const args = [
      '-p',
      taskPrompt,
      '--allow-all-tools',
      '--no-ask-user',
      '--silent',
      '--no-custom-instructions',
      '--disable-builtin-mcps',
      ...this.getMcpDisableArgs(options.workingDirectory),
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

  /**
   * Run task via Copilot CLI with cross-spawn.
   *
   * Uses cross-spawn which handles .cmd wrappers transparently on Windows
   * WITHOUT shell: true. This means arguments are passed directly to the
   * binary — no cmd.exe mangling of special chars in the prompt.
   *
   * Previously, shell: true caused cmd.exe to mangle multi-line -p arguments,
   * resulting in "too many arguments" errors. cross-spawn eliminates this.
   */
  async runSdk(options: CliCommandOptions): Promise<SdkHandle> {
    const taskPrompt = buildTaskPrompt(options);
    const abortController = new AbortController();

    // With cross-spawn, -p receives the prompt directly without shell mangling.
    // --no-custom-instructions: skip AGENTS.md/copilot-instructions.md (agent has its own prompt).
    // --disable-builtin-mcps: skip GitHub MCP server (not needed for orchestrated tasks).
    // Project .mcp.json MCP servers can have invalid tool schemas that cause API 400
    // errors in -p mode. We read .mcp.json and disable each server explicitly.
    const args = [
      '-p',
      taskPrompt,
      '--allow-all-tools',
      '--no-ask-user',
      '--silent',
      '--no-custom-instructions',
      '--disable-builtin-mcps',
      ...this.getMcpDisableArgs(options.workingDirectory),
    ];

    if (options.model) {
      args.push('--model', options.model);
    }

    // Output buffering (same pattern as Gemini/Codex adapters)
    const outputBuffer: string[] = [];
    const outputCallbacks: Array<(data: string) => void> = [];

    const onOutput = (callback: (data: string) => void): void => {
      outputCallbacks.push(callback);
      if (outputBuffer.length > 0) {
        for (const buffered of outputBuffer) {
          callback(buffered);
        }
        outputBuffer.length = 0;
      }
    };

    const emitOutput = (data: string): void => {
      if (outputCallbacks.length === 0) {
        outputBuffer.push(data);
      } else {
        for (const cb of outputCallbacks) {
          cb(data);
        }
      }
    };

    // Spawn using cross-spawn — transparent .cmd handling on Windows
    const binary = options.binaryPath ?? 'copilot';
    const child = spawnCli(binary, args, {
      cwd: options.workingDirectory,
    });

    // Explicit UTF-8 encoding prevents Buffer concatenation issues
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');

    // Abort handler: kill the child process
    const onAbort = (): void => {
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    };
    abortController.signal.addEventListener('abort', onAbort);

    // Wire stdout/stderr to emitOutput
    child.stdout?.on('data', (data: string) => {
      emitOutput(data);
    });

    child.stderr?.on('data', (data: string) => {
      const cleaned = stripAnsiCodes(data).trim();
      if (cleaned) {
        emitOutput(`[stderr] ${cleaned}\n`);
      }
    });

    // Done promise: resolves when the process exits
    const done = new Promise<number>((resolve) => {
      child.on('close', (code) => {
        abortController.signal.removeEventListener('abort', onAbort);
        resolve(code ?? 0);
      });

      child.on('error', (err) => {
        abortController.signal.removeEventListener('abort', onAbort);
        emitOutput(`[Copilot CLI Error] ${err.message}\n`);
        resolve(1);
      });
    });

    return { abort: abortController, done, onOutput };
  }

  /**
   * Read .mcp.json from the working directory and return --disable-mcp-server
   * args for each configured server. Prevents project MCP servers with invalid
   * tool schemas from causing API 400 errors in headless -p mode.
   */
  private getMcpDisableArgs(workingDirectory?: string): string[] {
    if (!workingDirectory) return [];

    try {
      const mcpPath = join(workingDirectory, '.mcp.json');
      if (!existsSync(mcpPath)) return [];

      const mcpConfig = JSON.parse(readFileSync(mcpPath, 'utf8')) as {
        mcpServers?: Record<string, unknown>;
      };
      if (!mcpConfig.mcpServers) return [];

      const args: string[] = [];
      for (const serverName of Object.keys(mcpConfig.mcpServers)) {
        args.push('--disable-mcp-server', serverName);
      }
      return args;
    } catch {
      return [];
    }
  }
}
