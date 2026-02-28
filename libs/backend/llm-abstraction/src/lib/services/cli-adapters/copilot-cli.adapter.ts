/**
 * Copilot CLI Adapter
 * Uses CLI subprocess for execution with --model support.
 *
 * CLI: copilot -p "task" --yolo --silent [--model <model>]
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
  CliModelInfo,
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
      '--yolo', // --allow-all-tools + --allow-all-paths + --allow-all-urls
      '--no-ask-user',
      '--silent',
      '--no-custom-instructions',
      ...this.getMcpArgs(options.workingDirectory, options.mcpPort),
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

  /** Copilot CLI model list (from `copilot --help` output) */
  private static readonly COPILOT_MODELS: CliModelInfo[] = [
    { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6' },
    { id: 'claude-opus-4.6', name: 'Claude Opus 4.6' },
    { id: 'claude-opus-4.6-fast', name: 'Claude Opus 4.6 Fast' },
    { id: 'claude-opus-4.5', name: 'Claude Opus 4.5' },
    { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5' },
    { id: 'claude-sonnet-4', name: 'Claude Sonnet 4' },
    { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5' },
    { id: 'gpt-5.3-codex', name: 'GPT 5.3 Codex' },
    { id: 'gpt-5.2-codex', name: 'GPT 5.2 Codex' },
    { id: 'gpt-5.2', name: 'GPT 5.2' },
    { id: 'gpt-5.1-codex-max', name: 'GPT 5.1 Codex Max' },
    { id: 'gpt-5.1-codex', name: 'GPT 5.1 Codex' },
    { id: 'gpt-5.1-codex-mini', name: 'GPT 5.1 Codex Mini' },
    { id: 'gpt-5.1', name: 'GPT 5.1' },
    { id: 'gpt-5-mini', name: 'GPT 5 Mini' },
    { id: 'gpt-4.1', name: 'GPT 4.1' },
    { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro Preview' },
  ];

  /**
   * Return available models for Copilot CLI.
   *
   * Parses model choices from `copilot --help` output dynamically.
   * The --model flag lists choices inline: --model <model> ... (choices: "model-a", "model-b")
   * Falls back to static COPILOT_MODELS list if parsing fails.
   */
  async listModels(): Promise<CliModelInfo[]> {
    try {
      const binaryPath = (await resolveCliPath('copilot')) ?? 'copilot';
      const { stdout } = await execFileAsync(binaryPath, ['--help'], {
        timeout: 5000,
      });
      const parsed = this.parseModelsFromHelp(stdout);
      if (parsed.length > 0) return parsed;
    } catch {
      // Fall through to static list
    }
    return CopilotCliAdapter.COPILOT_MODELS;
  }

  /**
   * Parse model IDs from `copilot --help` output.
   * Extracts the (choices: "model-a", "model-b", ...) section from --model flag.
   */
  private parseModelsFromHelp(helpOutput: string): CliModelInfo[] {
    // Match the choices list after --model: (choices: "a", "b", ...)
    // Use [\s\S] instead of /s flag for pre-ES2018 compat
    const choicesMatch = helpOutput.match(
      /--model\s[\s\S]*?\(choices:\s*((?:"[^"]+",?\s*)+)\)/
    );
    if (!choicesMatch) return [];

    const ids = [...choicesMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    if (ids.length === 0) return [];

    return ids.map((id) => ({ id, name: this.formatModelName(id) }));
  }

  /**
   * Convert model ID to display name.
   * "claude-sonnet-4.6" → "Claude Sonnet 4.6"
   * "gpt-5.1-codex-mini" → "GPT 5.1 Codex Mini"
   */
  private formatModelName(id: string): string {
    return id
      .split('-')
      .map((part) => {
        if (/^\d/.test(part)) return part; // Keep version numbers as-is
        if (part.toLowerCase() === 'gpt') return 'GPT';
        return part.charAt(0).toUpperCase() + part.slice(1);
      })
      .join(' ');
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
    // --yolo: enable all permissions (tools + paths + URLs) for headless mode.
    //   --allow-all-tools alone only covers tool execution, NOT file path access or URL access,
    //   which causes "Permission denied" for shell commands and MCP tool calls.
    // --no-custom-instructions: skip AGENTS.md/copilot-instructions.md (agent has its own prompt).
    // MCP: disable IDE bridge servers (permission blocked in headless), re-add Ptah as direct HTTP.
    // NOTE: --disable-builtin-mcps removed — it's too aggressive and prevents --additional-mcp-config
    //   from adding the Ptah HTTP MCP server. Use targeted --disable-mcp-server instead.
    const args = [
      '-p',
      taskPrompt,
      '--yolo', // --allow-all-tools + --allow-all-paths + --allow-all-urls
      '--no-ask-user',
      '--silent',
      '--no-custom-instructions',
      ...this.getMcpArgs(options.workingDirectory, options.mcpPort),
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
   * Build MCP-related CLI args for headless mode.
   *
   * Two concerns:
   * 1. DISABLE servers that break in headless mode:
   *    - .mcp.json servers (invalid tool schemas → API 400 errors)
   *    - .vscode/mcp.json servers (same reason)
   *    - "ptah" IDE bridge (VS Code permission layer can't show dialog in headless)
   *
   * 2. RE-ADD Ptah as a direct HTTP MCP connection (when mcpPort is provided):
   *    Copilot CLI discovers our MCP server through VS Code's IDE bridge, but the
   *    VS Code permission layer blocks all tool calls in headless mode. By disabling
   *    the bridge version and re-adding it via --additional-mcp-config as a direct
   *    HTTP connection, --yolo covers the permissions and Copilot gets full access
   *    to ptah_workspace_analyze, ptah_search_files, ptah_get_diagnostics, etc.
   */
  private getMcpArgs(workingDirectory?: string, mcpPort?: number): string[] {
    const serverNames = new Set<string>();

    // Always disable the Ptah IDE MCP server (VS Code permission layer blocks headless use)
    serverNames.add('ptah');

    if (workingDirectory) {
      // .mcp.json (Claude Code format)
      this.collectServerNames(
        join(workingDirectory, '.mcp.json'),
        'mcpServers',
        serverNames
      );
      // .vscode/mcp.json (VS Code format)
      this.collectServerNames(
        join(workingDirectory, '.vscode', 'mcp.json'),
        'servers',
        serverNames
      );
    }

    const args: string[] = [];
    for (const name of serverNames) {
      args.push('--disable-mcp-server', name);
    }

    // Re-add Ptah MCP as direct HTTP connection (bypasses VS Code permission layer)
    if (mcpPort) {
      const mcpConfig = JSON.stringify({
        mcpServers: {
          ptah: { type: 'http', url: `http://localhost:${mcpPort}` },
        },
      });
      args.push('--additional-mcp-config', mcpConfig);
    }

    return args;
  }

  /**
   * Read an MCP config file and collect server names into the set.
   */
  private collectServerNames(
    filePath: string,
    key: string,
    out: Set<string>
  ): void {
    try {
      if (!existsSync(filePath)) return;
      const config = JSON.parse(readFileSync(filePath, 'utf8')) as Record<
        string,
        Record<string, unknown> | undefined
      >;
      const servers = config[key];
      if (servers && typeof servers === 'object') {
        for (const name of Object.keys(servers)) {
          out.add(name);
        }
      }
    } catch {
      // Ignore malformed config files
    }
  }
}
