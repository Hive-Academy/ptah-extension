/**
 * Antigravity CLI Adapter (`agy`)
 *
 * Spawn-based text adapter for Google's Antigravity CLI. Unlike the Codex /
 * Cursor SDK adapters, `agy` has NO structured output mode: print mode emits
 * PLAIN TEXT (optional verbose step narration followed by a markdown answer),
 * so segment parsing here is a HEURISTIC line classifier rather than a JSONL
 * event loop.
 *
 * Non-interactive run:  agy --dangerously-skip-permissions --model <label>
 *                           --add-dir <cwd> --print "<prompt>"
 *
 * Notes:
 * - `--print` (alias `--prompt`/`-p`) is a STRING flag whose value is the
 *   prompt; Go's flag parser consumes the following argv element, so it is
 *   always passed LAST with the prompt as a single argv item.
 * - `--dangerously-skip-permissions` maps to autoApprove; required or
 *   file-writing tool calls hang waiting for interactive approval.
 * - Print mode does NOT print the conversation id to stdout. The session id is
 *   recovered post-run by enumerating the newest `.db` under
 *   ~/.gemini/antigravity-cli/conversations/ (mtime).
 * - `agy` has no GEMINI_SYSTEM_MD support, so systemPrompt/projectGuidance are
 *   prepended to the task prompt via buildTaskPrompt (the shared fallback).
 *
 * See: https://antigravity.google/docs/cli/reference
 */
import { readdirSync, statSync } from 'fs';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import type {
  CliDetectionResult,
  CliOutputSegment,
} from '@ptah-extension/shared';
import type {
  CliAdapter,
  CliCommandOptions,
  CliModelInfo,
  SdkHandle,
} from './cli-adapter.interface';
import {
  stripAnsiCodes,
  buildTaskPrompt,
  probeCliVersion,
  resolveCliPath,
  resolveDirectSpawn,
  spawnCli,
  killProcessTree,
} from './cli-adapter.utils';

/**
 * Print-mode wait timeout. `agy` defaults to 5m, which kills most real coding
 * tasks; align it with AgentProcessManager's 1h execution cap so the manager
 * owns the timeout rather than the CLI.
 */
const PRINT_TIMEOUT = '3600s';

/**
 * Heuristic prefixes for narration/step lines (`agy` describes each action
 * before performing it, e.g. "I will read the file..."). Matching lines are
 * emitted as `thinking` segments; everything else is treated as answer `text`.
 * Best-effort only — `agy` exposes no structured tool events to key off.
 */
const NARRATION_PREFIX =
  /^(i will\b|i'll\b|i am going to\b|i'm going to\b|i need to\b|i should\b|let me\b|first,? i\b|now i\b|next,? i\b|then i\b|searching\b|reading\b|running\b|writing\b|editing\b|creating\b|looking\b|checking\b|analyzing\b|exploring\b|inspecting\b|gathering\b)/i;

export class AntigravityCliAdapter implements CliAdapter {
  readonly name = 'antigravity' as const;
  readonly displayName = 'Antigravity';
  /** MCP is configured via ~/.gemini/config/mcp_config.json before each spawn */
  readonly supportsMcp = true;

  async detect(): Promise<CliDetectionResult> {
    try {
      const binaryPath = await resolveCliPath('agy');
      if (!binaryPath) {
        return { cli: 'antigravity', installed: false, supportsSteer: false };
      }
      const version = await probeCliVersion(binaryPath);

      return {
        cli: 'antigravity',
        installed: true,
        path: binaryPath,
        version,
        supportsSteer: false,
      };
    } catch {
      return {
        cli: 'antigravity',
        installed: false,
        supportsSteer: false,
      };
    }
  }

  supportsSteer(): boolean {
    return false;
  }

  parseOutput(raw: string): string {
    return stripAnsiCodes(raw);
  }

  /**
   * Resolve the ~/.gemini home root.
   *
   * Prefers $HOME / $USERPROFILE over os.homedir() so tests (and sandbox
   * setups) that reassign HOME after module load are honoured. Mirrors the
   * env-first pattern in CodexCliAdapter.getAuthPath().
   */
  private static geminiRoot(): string {
    const home = process.env['HOME'] || process.env['USERPROFILE'] || homedir();
    return join(home, '.gemini');
  }

  /**
   * List available models by parsing `agy models` stdout (one label per line,
   * e.g. "Gemini 3.1 Pro (High)"). The label IS the value passed to `--model`,
   * so it serves as both id and display name. Falls back to an empty list when
   * the probe fails — the caller treats a bare binary on PATH as "installed".
   */
  async listModels(): Promise<CliModelInfo[]> {
    const binaryPath = (await resolveCliPath('agy')) ?? 'agy';
    const raw = await this.probeModels(binaryPath);
    if (!raw) {
      return [];
    }
    return stripAnsiCodes(raw)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((label) => ({ id: label, name: label }));
  }

  /**
   * Run `agy models` and capture stdout. Never throws — resolves undefined on
   * timeout/error/no output. Separate from probeCliVersion because we need the
   * full multi-line stdout, not just the first line.
   */
  private probeModels(
    binary: string,
    timeoutMs = 8000,
  ): Promise<string | undefined> {
    return new Promise((resolve) => {
      let stdout = '';
      const child = spawnCli(binary, ['models'], {});
      const timer = setTimeout(() => {
        child.kill();
        resolve(undefined);
      }, timeoutMs);

      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (data: string) => {
        stdout += data;
      });
      child.on('close', () => {
        clearTimeout(timer);
        resolve(stdout.trim() || undefined);
      });
      child.on('error', () => {
        clearTimeout(timer);
        resolve(undefined);
      });
    });
  }

  /**
   * Ensure the workspace folder is trusted by `agy`.
   * Prevents the interactive "Do you trust this folder?" prompt from blocking
   * headless execution. `agy` reads a `trustedWorkspaces` ARRAY of absolute
   * paths from ~/.gemini/antigravity-cli/settings.json.
   * Non-fatal: errors are silently caught.
   */
  private async ensureFolderTrusted(folder: string): Promise<void> {
    try {
      const cliDir = join(
        AntigravityCliAdapter.geminiRoot(),
        'antigravity-cli',
      );
      const settingsPath = join(cliDir, 'settings.json');
      const normalizedFolder =
        process.platform === 'win32' ? folder.replace(/\//g, '\\') : folder;

      let settings: Record<string, unknown> = {};
      try {
        const content = await readFile(settingsPath, 'utf8');
        settings = JSON.parse(content) as Record<string, unknown>;
      } catch {
        // Missing or malformed file — start fresh.
      }

      const trusted = Array.isArray(settings['trustedWorkspaces'])
        ? (settings['trustedWorkspaces'] as unknown[]).filter(
            (v): v is string => typeof v === 'string',
          )
        : [];
      if (trusted.includes(folder) || trusted.includes(normalizedFolder)) {
        return;
      }
      trusted.push(normalizedFolder);
      settings['trustedWorkspaces'] = trusted;

      await mkdir(cliDir, { recursive: true });
      await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    } catch {
      // --dangerously-skip-permissions bypasses tool approval, so a failure
      // here only re-surfaces the trust prompt on a future interactive run.
    }
  }

  /**
   * Path to the global MCP config `agy` reads at startup.
   * The documented (post-migration) location is ~/.gemini/config/mcp_config.json.
   */
  private static mcpConfigPath(): string {
    return join(
      AntigravityCliAdapter.geminiRoot(),
      'config',
      'mcp_config.json',
    );
  }

  /**
   * Configure the Ptah MCP server in ~/.gemini/config/mcp_config.json.
   * `agy` uses a `mcpServers` map; remote servers are declared with a
   * `serverUrl` field (SSE transport). Non-fatal: errors are silently caught.
   */
  private async configureMcpServer(port: number): Promise<void> {
    try {
      const configPath = AntigravityCliAdapter.mcpConfigPath();

      let config: Record<string, unknown> = {};
      try {
        const content = await readFile(configPath, 'utf8');
        if (content.trim()) {
          config = JSON.parse(content) as Record<string, unknown>;
        }
      } catch {
        // Missing or malformed file — start fresh.
      }

      const mcpServers =
        (config['mcpServers'] as Record<string, unknown>) || {};
      mcpServers['ptah'] = {
        serverUrl: `http://localhost:${port}`,
      };
      config['mcpServers'] = mcpServers;

      await mkdir(join(AntigravityCliAdapter.geminiRoot(), 'config'), {
        recursive: true,
      });
      await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
    } catch {
      // MCP tools won't be available this run; CLI still functions.
    }
  }

  /**
   * Remove the ptah MCP entry from ~/.gemini/config/mcp_config.json.
   * Called after the process exits to avoid stale port references.
   * Non-fatal: errors are silently caught.
   */
  private async cleanupMcpEntry(): Promise<void> {
    try {
      const configPath = AntigravityCliAdapter.mcpConfigPath();
      const content = await readFile(configPath, 'utf8');
      const config = JSON.parse(content) as Record<string, unknown>;
      const mcpServers = config['mcpServers'] as
        | Record<string, unknown>
        | undefined;
      if (!mcpServers?.['ptah']) return;

      delete mcpServers['ptah'];
      if (Object.keys(mcpServers).length === 0) {
        delete config['mcpServers'];
      }
      await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
    } catch {
      // Stale ptah entry will be overwritten on next configureMcpServer().
    }
  }

  /**
   * Recover the CLI-native conversation id after a print-mode run.
   *
   * Print mode never echoes the id to stdout; `agy` persists each conversation
   * as a per-id SQLite DB under ~/.gemini/antigravity-cli/conversations/<uuid>.db.
   * We return the newest `.db` (by mtime) created at/after the run started, so
   * a stale prior conversation is never mistaken for this run's session.
   * Never throws — returns undefined when nothing qualifies.
   */
  private resolveSessionId(sinceMs: number): string | undefined {
    try {
      const dir = join(
        AntigravityCliAdapter.geminiRoot(),
        'antigravity-cli',
        'conversations',
      );
      let newestId: string | undefined;
      let newestMs = sinceMs - 2000; // small clock-skew tolerance
      for (const entry of readdirSync(dir)) {
        if (!entry.endsWith('.db')) continue; // skip .db-shm / .db-wal
        const mtimeMs = statSync(join(dir, entry)).mtimeMs;
        if (mtimeMs >= newestMs) {
          newestMs = mtimeMs;
          newestId = entry.slice(0, -'.db'.length);
        }
      }
      return newestId;
    } catch {
      return undefined;
    }
  }

  /**
   * Run the task via `agy` print mode.
   *
   * Spawns `agy` with the prompt as the value of the trailing `--print` flag,
   * captures plain-text stdout, and classifies each line into `thinking`
   * (narration) or `text` (answer) segments. stderr and non-zero exit surface
   * as `error` segments.
   */
  async runSdk(options: CliCommandOptions): Promise<SdkHandle> {
    if (options.workingDirectory) {
      await this.ensureFolderTrusted(options.workingDirectory);
    }
    if (options.mcpPort) {
      await this.configureMcpServer(options.mcpPort);
    }

    const spawnEnv: Record<string, string> = {};
    if (process.platform === 'win32') {
      spawnEnv['NODE_PTY_USE_CONPTY'] = '0';
    }

    // No GEMINI_SYSTEM_MD support in `agy`: fold systemPrompt/projectGuidance
    // into the task prompt via the shared builder.
    const taskPrompt = buildTaskPrompt(options);
    const abortController = new AbortController();
    let capturedSessionId: string | undefined;

    const args: string[] = [];
    if (options.autoApprove !== false) {
      args.push('--dangerously-skip-permissions');
    }
    args.push('--print-timeout', PRINT_TIMEOUT);
    if (options.model) {
      args.push('--model', options.model);
    }
    if (options.workingDirectory) {
      args.push('--add-dir', options.workingDirectory);
    }
    if (options.resumeSessionId) {
      args.push('--conversation', options.resumeSessionId);
    }
    // `--print` is a string flag whose value is the prompt; keep it LAST so the
    // Go flag parser consumes the prompt (and nothing else) as its value.
    args.push('--print', taskPrompt);

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

    const segmentBuffer: CliOutputSegment[] = [];
    const segmentCallbacks: Array<(segment: CliOutputSegment) => void> = [];

    const onSegment = (callback: (segment: CliOutputSegment) => void): void => {
      segmentCallbacks.push(callback);
      if (segmentBuffer.length > 0) {
        for (const buffered of segmentBuffer) {
          callback(buffered);
        }
        segmentBuffer.length = 0;
      }
    };

    const emitSegment = (segment: CliOutputSegment): void => {
      if (segmentCallbacks.length === 0) {
        segmentBuffer.push(segment);
      } else {
        for (const cb of segmentCallbacks) {
          cb(segment);
        }
      }
    };

    const spawnStartMs = Date.now();
    const binary = options.binaryPath ?? 'agy';
    // On Windows `agy` is typically an npm `.cmd` shim; resolveDirectSpawn points
    // spawn at the real node entrypoint/binary so child.pid is the process
    // taskkill /T should walk from (not the cmd.exe shim). No-op off-Windows.
    const spawnDescriptor = await resolveDirectSpawn(binary);
    const child = spawnCli(
      spawnDescriptor.command,
      [...spawnDescriptor.prefixArgs, ...args],
      {
        cwd: options.workingDirectory,
        env: Object.keys(spawnEnv).length > 0 ? spawnEnv : undefined,
        needsConsole: true,
        detached: true,
      },
    );
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    // Prompt is passed via argv; nothing is written to stdin.
    child.stdin?.end();

    const onAbort = (): void => {
      if (child.pid && !child.killed) {
        // Tree-kill the whole process group — child.kill() alone orphans the
        // real `agy` process (and any shell subprocesses) when child is a shim.
        void killProcessTree(child.pid);
      }
    };
    abortController.signal.addEventListener('abort', onAbort);

    let lineBuf = '';
    child.stdout?.on('data', (data: string) => {
      lineBuf += stripAnsiCodes(data);
      const lines = lineBuf.split(/\r?\n/);
      lineBuf = lines.pop() ?? '';
      const LINE_BUF_CAP = 64 * 1024;
      if (lineBuf.length > LINE_BUF_CAP) {
        emitOutput(
          `[Antigravity CLI Warning] Line buffer exceeded ${LINE_BUF_CAP} bytes without a newline; resetting.\n`,
        );
        emitSegment({
          type: 'info',
          content: `Line buffer exceeded ${LINE_BUF_CAP} bytes without a newline; resetting.`,
        });
        lineBuf = '';
      }
      for (const line of lines) {
        this.handleLine(line, emitOutput, emitSegment);
      }
    });

    let suppressConptyLines = 0;
    child.stderr?.on('data', (data: string) => {
      const cleaned = stripAnsiCodes(data).trim();
      if (!cleaned) return;
      if (cleaned.includes('conpty_console_list_agent')) {
        suppressConptyLines = 5; // Suppress this + next few stack trace lines
        return;
      }
      if (cleaned.includes('AttachConsole failed')) {
        suppressConptyLines = 3;
        return;
      }
      if (suppressConptyLines > 0) {
        suppressConptyLines--;
        return;
      }
      emitOutput(`[stderr] ${cleaned}\n`);
      const isError =
        /\b(error|fail(ed)?|exception|denied|unauthorized|refused|timeout|abort|crash|panic|fatal)\b/i.test(
          cleaned,
        );
      emitSegment({ type: isError ? 'error' : 'info', content: cleaned });
    });

    const done = new Promise<number>((resolve) => {
      child.on('close', (code, signal) => {
        abortController.signal.removeEventListener('abort', onAbort);
        if (lineBuf.trim()) {
          this.handleLine(lineBuf, emitOutput, emitSegment);
          lineBuf = '';
        }
        const exitCode = code ?? (signal ? 1 : 0);
        if (exitCode !== 0 && !abortController.signal.aborted) {
          emitSegment({
            type: 'error',
            content: `Antigravity CLI exited with code ${exitCode}`,
          });
        }
        capturedSessionId = this.resolveSessionId(spawnStartMs);
        resolve(exitCode);
      });

      child.on('error', (err) => {
        abortController.signal.removeEventListener('abort', onAbort);
        emitOutput(`\n[Antigravity CLI Error] ${err.message}\n`);
        emitSegment({
          type: 'error',
          content: `Antigravity CLI Error: ${err.message}`,
        });
        resolve(1);
      });
    });

    if (options.mcpPort) {
      done.then(() => {
        this.cleanupMcpEntry();
      });
    }

    return {
      abort: abortController,
      done,
      onOutput,
      onSegment,
      getSessionId: () => capturedSessionId,
      getPid: () => child.pid,
    };
  }

  /**
   * Emit a single plain-text output line and its structured segment.
   * Narration/step lines become `thinking`; everything else is answer `text`.
   * Blank lines pass through to raw output only (preserving markdown spacing).
   */
  private handleLine(
    line: string,
    emitOutput: (data: string) => void,
    emitSegment: (segment: CliOutputSegment) => void,
  ): void {
    emitOutput(line + '\n');
    const trimmed = line.trim();
    if (!trimmed) return;
    emitSegment({
      type: NARRATION_PREFIX.test(trimmed) ? 'thinking' : 'text',
      content: trimmed,
    });
  }
}
