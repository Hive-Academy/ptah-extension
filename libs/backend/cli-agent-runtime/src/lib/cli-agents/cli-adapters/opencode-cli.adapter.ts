/**
 * opencode CLI Adapter (`opencode`)
 *
 * Spawn-based, structured-JSONL adapter for the opencode CLI (npm package
 * `opencode-ai`, bin shim `opencode`). Unlike Antigravity's plain-text print
 * mode, `opencode run --format json` emits a real event stream — one JSON
 * object per line — so segment parsing here is a JSONL event loop closer to the
 * Codex adapter's structured mapping than to Antigravity's heuristic classifier.
 *
 * Non-interactive run:  opencode run --format json --auto --model <provider/model>
 *                                   --dir <cwd> [--session <id>] "<prompt>"
 *
 * Notes:
 * - `run`'s prompt is a POSITIONAL arg (not a Go-style trailing string flag),
 *   so it is passed LAST but ordering is less brittle than Antigravity's.
 * - `--auto` maps to autoApprove: it auto-approves the two permission gaps
 *   (`doom_loop`, `external_directory`) that otherwise default to "ask". There
 *   is no single `--yolo`/`--dangerously-skip-permissions` switch in opencode.
 * - Every JSONL event carries a top-level `sessionID` (`ses_...`); we capture it
 *   from the FIRST parseable line (no post-run mtime scan needed).
 * - Event `type` values handled: `step_start` (skip), `tool_use`, `text`,
 *   `step_finish`, `error`. `tool_use` lines arrive already completed
 *   (`state.status === "completed"`), so each is emitted as call + result in one
 *   shot; `tool: "bash"` becomes a `command` segment with an exit code.
 * - MCP is configured per-process via the `OPENCODE_CONFIG_CONTENT` env var:
 *   an inline JSON string carrying the `mcp.ptah` remote entry, passed to the
 *   child at spawn time. opencode deep-merges it (remeda `mergeDeep`, highest
 *   precedence) on top of the untouched shared project config — so two agents in
 *   the same working dir never race over a shared file, and there is nothing to
 *   clean up after the run.
 * - Windows: `resolveCliPath('opencode')` + cross-spawn (`.cmd` wrapper) is the
 *   primary path. Upstream issues report the generated `.ps1` wrapper shelling
 *   out to `/bin/sh.exe`; as a fallback we resolve the bundled native binary
 *   (`opencode-windows-x64/bin/opencode.exe`) directly, mirroring
 *   CodexCliAdapter.resolveCodexNativeBinary().
 *
 * See: https://opencode.ai/docs/cli/ , https://opencode.ai/docs/config/
 */
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { homedir } from 'os';
import path, { join } from 'path';
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
  spawnCli,
} from './cli-adapter.utils';

/**
 * Provider API-key env vars treated as a "credentials present" signal when no
 * on-disk auth.json is found. Non-exhaustive — opencode supports many providers
 * via env vars; these are the common ones.
 */
const OPENCODE_PROVIDER_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'MISTRAL_API_KEY',
  'DEEPSEEK_API_KEY',
  'XAI_API_KEY',
] as const;

/** npm platform package names carrying the opencode native binary (Windows). */
const OPENCODE_WINDOWS_PACKAGES: Record<string, string> = {
  x64: 'opencode-windows-x64',
  arm64: 'opencode-windows-arm64',
};

/** Minimal shape of the tool state carried on an opencode `tool_use` part. */
interface OpencodeToolState {
  readonly status?: string;
  readonly input?: Record<string, unknown>;
  readonly output?: string;
  readonly title?: string;
  readonly metadata?: { readonly exit?: number; readonly output?: string };
}

/** Nested `part` object present on most opencode JSONL events. */
interface OpencodePart {
  readonly id?: string;
  readonly type?: string;
  readonly text?: string;
  readonly tool?: string;
  readonly callID?: string;
  readonly state?: OpencodeToolState;
  readonly reason?: string;
  readonly cost?: number;
  readonly tokens?: {
    readonly input?: number;
    readonly output?: number;
    readonly reasoning?: number;
  };
}

/** A single line of `opencode run --format json` output. */
interface OpencodeEvent {
  readonly type?: string;
  readonly sessionID?: string;
  readonly timestamp?: number;
  readonly part?: OpencodePart;
  readonly error?: {
    readonly name?: string;
    readonly data?: { readonly message?: string; readonly statusCode?: number };
  };
}

/**
 * Resolve the opencode native binary inside its Windows platform package.
 *
 * The npm `.ps1` wrapper opencode generates has been reported to invoke
 * `/bin/sh.exe`, which does not exist on stock Windows. When that path breaks,
 * spawning the bundled `.exe` directly bypasses the wrapper entirely. Mirrors
 * the resolution-order strategy of CodexCliAdapter.resolveCodexNativeBinary().
 *
 * Returns `undefined` off-Windows, on unsupported arches, or when no candidate
 * exists (e.g. the tool was installed via Homebrew/Scoop/curl rather than npm).
 */
function resolveOpencodeNativeBinary(
  detectedCliPath?: string,
): string | undefined {
  if (process.platform !== 'win32') return undefined;
  const platformPkg = OPENCODE_WINDOWS_PACKAGES[process.arch];
  if (!platformPkg) return undefined;

  const relFromNodeModules = path.join(platformPkg, 'bin', 'opencode.exe');
  const relFromBin = path.join('node_modules', relFromNodeModules);

  const candidates: string[] = [];
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string })
    .resourcesPath;
  if (resourcesPath) {
    candidates.push(path.join(resourcesPath, 'app.asar.unpacked', relFromBin));
  }

  try {
    const platformPkgJson = require.resolve(`${platformPkg}/package.json`);
    candidates.push(
      path.join(path.dirname(platformPkgJson), 'bin', 'opencode.exe'),
    );
  } catch {
    // noop — platform package not resolvable from here.
  }

  try {
    // opencode-ai nests its platform package under its own node_modules.
    const cliPkgJson = require.resolve('opencode-ai/package.json');
    candidates.push(
      path.join(path.dirname(cliPkgJson), 'node_modules', relFromNodeModules),
    );
  } catch {
    // noop — opencode-ai not resolvable from here.
  }

  const appData = process.env['APPDATA'];
  if (appData) {
    candidates.push(path.join(appData, 'npm', relFromBin));
    candidates.push(
      path.join(appData, 'npm', 'node_modules', 'opencode-ai', relFromBin),
    );
  }

  if (detectedCliPath) {
    const cliDir = path.dirname(detectedCliPath);
    candidates.push(path.join(cliDir, relFromBin));
    candidates.push(
      path.join(cliDir, 'node_modules', 'opencode-ai', relFromBin),
    );
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export class OpencodeCliAdapter implements CliAdapter {
  readonly name = 'opencode' as const;
  readonly displayName = 'opencode';
  /** MCP is configured per-process via the `OPENCODE_CONFIG_CONTENT` env var. */
  readonly supportsMcp = true;

  async detect(): Promise<CliDetectionResult> {
    try {
      const binaryPath = await resolveCliPath('opencode');
      if (!binaryPath) {
        return { cli: 'opencode', installed: false, supportsSteer: false };
      }
      const version = await probeCliVersion(binaryPath);

      return {
        cli: 'opencode',
        installed: true,
        path: binaryPath,
        version,
        supportsSteer: false,
      };
    } catch {
      return {
        cli: 'opencode',
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
   * List available models by parsing `opencode models` stdout. Each non-empty
   * line is treated as a `provider/model` id (the exact value opencode expects
   * for `--model`), so it serves as both id and display name. Falls back to an
   * empty list when the probe fails.
   */
  async listModels(): Promise<CliModelInfo[]> {
    const binaryPath = (await resolveCliPath('opencode')) ?? 'opencode';
    const raw = await this.probeModels(binaryPath);
    if (!raw) {
      return [];
    }
    return stripAnsiCodes(raw)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((id) => ({ id, name: id }));
  }

  /**
   * Run `opencode models` and capture stdout. Never throws — resolves undefined
   * on timeout/error/no output.
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
   * Candidate `auth.json` locations, in priority order.
   *
   * XDG data-home (`~/.local/share/opencode/`) is the documented location, but
   * Windows path conventions for opencode's data dir are inconsistent upstream,
   * so `%APPDATA%\opencode\` is checked as a fallback. Prefers $HOME /
   * $USERPROFILE over os.homedir() so tests that reassign HOME are honoured.
   */
  private static authPaths(): string[] {
    const home = process.env['HOME'] || process.env['USERPROFILE'] || homedir();
    const paths = [join(home, '.local', 'share', 'opencode', 'auth.json')];
    if (process.platform === 'win32') {
      const appData = process.env['APPDATA'];
      if (appData) {
        paths.push(join(appData, 'opencode', 'auth.json'));
      }
    }
    return paths;
  }

  /**
   * Check whether opencode credentials are available.
   * Returns true if any auth.json parses with at least one provider entry, or a
   * known provider API-key env var is set. No active refresh is attempted —
   * opencode manages its own token lifecycle.
   */
  async ensureTokensFresh(): Promise<boolean> {
    for (const authPath of OpencodeCliAdapter.authPaths()) {
      try {
        const raw = await readFile(authPath, 'utf8');
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (
          parsed &&
          typeof parsed === 'object' &&
          Object.keys(parsed).length > 0
        ) {
          return true;
        }
      } catch {
        // Missing/malformed at this path — try the next.
      }
    }
    return OPENCODE_PROVIDER_ENV_KEYS.some((key) => !!process.env[key]);
  }

  /**
   * Build the inline `OPENCODE_CONFIG_CONTENT` JSON registering the Ptah MCP
   * server as a remote endpoint. opencode deep-merges this per-process at the
   * highest precedence, so it never touches the shared project config on disk.
   */
  private buildMcpConfigContent(port: number): string {
    return JSON.stringify({
      mcp: {
        ptah: {
          type: 'remote',
          url: `http://localhost:${port}`,
          enabled: true,
        },
      },
    });
  }

  /**
   * Run the task via `opencode run --format json`.
   *
   * Spawns opencode with the prompt as a trailing positional arg, buffers stdout
   * by line, JSON.parses each line defensively, and dispatches to structured
   * `CliOutputSegment`s. The session id is captured from the first parseable
   * event. stderr and non-zero exit surface as `error` segments.
   */
  async runSdk(options: CliCommandOptions): Promise<SdkHandle> {
    const taskPrompt = buildTaskPrompt(options);
    const abortController = new AbortController();
    let capturedSessionId: string | undefined;
    // Tracks last-seen full text per part.id so repeated `text` lines emit only
    // the newly-appended delta (mirrors Codex's emitTextDelta).
    const textTracker = new Map<string, string>();

    const args: string[] = ['run', '--format', 'json'];
    if (options.autoApprove !== false) {
      args.push('--auto');
    }
    if (options.model) {
      args.push('--model', options.model);
    }
    if (options.workingDirectory) {
      args.push('--dir', options.workingDirectory);
    }
    if (options.resumeSessionId) {
      args.push('--session', options.resumeSessionId);
    }
    // Prompt is a positional arg; keep it LAST.
    args.push(taskPrompt);

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

    // Primary: detected binary path (the `.cmd` shim on Windows). We always
    // attempt native-binary resolution (passing the detected path as a hint) and
    // prefer the bundled native `.exe` when it exists — mirroring
    // CodexCliAdapter.resolveCodexNativeBinary(). On Windows the wrapper's target
    // binary can be wrong/missing/corrupt (open upstream #28920/#36737), so the
    // native `.exe` bypasses it entirely. No-op off-Windows / when absent.
    let binary = options.binaryPath ?? 'opencode';
    const native = resolveOpencodeNativeBinary(options.binaryPath);
    if (native) {
      binary = native;
    }

    const env: NodeJS.ProcessEnv = {};
    if (options.mcpPort) {
      env['OPENCODE_CONFIG_CONTENT'] = this.buildMcpConfigContent(
        options.mcpPort,
      );
    }

    const child = spawnCli(binary, args, {
      cwd: options.workingDirectory,
      env,
    });
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    // Prompt is passed via argv; nothing is written to stdin.
    child.stdin?.end();

    const onAbort = (): void => {
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    };
    abortController.signal.addEventListener('abort', onAbort);

    const setSessionId = (event: OpencodeEvent): void => {
      if (!capturedSessionId && event.sessionID) {
        capturedSessionId = event.sessionID;
      }
    };

    let lineBuf = '';
    child.stdout?.on('data', (data: string) => {
      lineBuf += stripAnsiCodes(data);
      const lines = lineBuf.split(/\r?\n/);
      lineBuf = lines.pop() ?? '';
      const LINE_BUF_CAP = 1024 * 1024;
      if (lineBuf.length > LINE_BUF_CAP) {
        emitSegment({
          type: 'info',
          content: `Line buffer exceeded ${LINE_BUF_CAP} bytes without a newline; resetting.`,
        });
        lineBuf = '';
      }
      for (const line of lines) {
        this.handleLine(
          line,
          emitOutput,
          emitSegment,
          textTracker,
          setSessionId,
        );
      }
    });

    child.stderr?.on('data', (data: string) => {
      const cleaned = stripAnsiCodes(data).trim();
      if (!cleaned) return;
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
          this.handleLine(
            lineBuf,
            emitOutput,
            emitSegment,
            textTracker,
            setSessionId,
          );
          lineBuf = '';
        }
        const exitCode = code ?? (signal ? 1 : 0);
        if (exitCode !== 0 && !abortController.signal.aborted) {
          emitSegment({
            type: 'error',
            content: `opencode CLI exited with code ${exitCode}`,
          });
        }
        resolve(exitCode);
      });

      child.on('error', (err) => {
        abortController.signal.removeEventListener('abort', onAbort);
        emitOutput(`\n[opencode CLI Error] ${err.message}\n`);
        emitSegment({
          type: 'error',
          content: `opencode CLI Error: ${err.message}`,
        });
        resolve(1);
      });
    });

    return {
      abort: abortController,
      done,
      onOutput,
      onSegment,
      getSessionId: () => capturedSessionId,
    };
  }

  /**
   * Parse one JSONL line and emit its raw text + structured segment(s).
   * Non-JSON / partial lines are skipped defensively. Dispatch follows the
   * event-type → segment mapping documented in the header.
   */
  private handleLine(
    line: string,
    emitOutput: (data: string) => void,
    emitSegment: (segment: CliOutputSegment) => void,
    textTracker: Map<string, string>,
    setSessionId: (event: OpencodeEvent) => void,
  ): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let event: OpencodeEvent;
    try {
      event = JSON.parse(trimmed) as OpencodeEvent;
    } catch {
      // Not a complete JSON object (partial line / non-JSON banner) — skip.
      return;
    }

    setSessionId(event);

    switch (event.type) {
      case 'step_start':
        // Structural marker only — no segment.
        break;
      case 'text':
        this.handleTextEvent(event, emitOutput, emitSegment, textTracker);
        break;
      case 'tool_use':
        this.handleToolUse(event, emitOutput, emitSegment);
        break;
      case 'step_finish':
        this.handleStepFinish(event, emitOutput, emitSegment);
        break;
      case 'error': {
        const message =
          event.error?.data?.message ?? event.error?.name ?? 'Unknown error';
        emitOutput(`[Error] ${message}\n`);
        emitSegment({ type: 'error', content: message });
        break;
      }
      default:
        // Defensive fallback — surface unrecognized events rather than dropping.
        emitSegment({ type: 'info', content: trimmed });
        break;
    }
  }

  /**
   * Emit incremental `text` deltas. opencode re-sends the current full/partial
   * chunk per `text` line; we diff against the last-seen text for the same
   * `part.id` so only newly-appended content is emitted.
   */
  private handleTextEvent(
    event: OpencodeEvent,
    emitOutput: (data: string) => void,
    emitSegment: (segment: CliOutputSegment) => void,
    textTracker: Map<string, string>,
  ): void {
    const part = event.part;
    const text = part?.text;
    if (!text) return;

    const id = part?.id ?? '';
    const previous = textTracker.get(id) ?? '';
    if (id && text.startsWith(previous)) {
      const delta = text.slice(previous.length);
      if (!delta) return;
      textTracker.set(id, text);
      emitOutput(delta);
      emitSegment({ type: 'text', content: delta });
    } else {
      if (id) textTracker.set(id, text);
      emitOutput(text);
      emitSegment({ type: 'text', content: text });
    }
  }

  /**
   * Map a completed `tool_use` event to segments. `tool: "bash"` becomes a
   * `command` segment (with exit code, like Codex's command_execution);
   * everything else becomes a `tool-call` + `tool-result` pair.
   */
  private handleToolUse(
    event: OpencodeEvent,
    emitOutput: (data: string) => void,
    emitSegment: (segment: CliOutputSegment) => void,
  ): void {
    const part = event.part;
    if (!part) return;

    const toolName = part.tool ?? 'tool';
    const toolCallId = part.callID;
    const state = part.state;
    const output = state?.output ?? state?.metadata?.output ?? '';

    if (toolName === 'bash') {
      const command =
        (state?.input?.['command'] as string | undefined) ?? toolName;
      const exitCode = state?.metadata?.exit;
      emitOutput(`$ ${command}\n`);
      if (output) {
        emitOutput(output.endsWith('\n') ? output : output + '\n');
      }
      emitSegment({
        type: 'command',
        content: output,
        toolName: command,
        exitCode,
        toolCallId,
      });
      return;
    }

    const toolArgs = state?.input ? JSON.stringify(state.input) : undefined;
    emitOutput(`[Tool] ${toolName}\n`);
    emitSegment({
      type: 'tool-call',
      toolName,
      toolArgs,
      toolInput: state?.input,
      content: '',
      toolCallId,
    });
    emitSegment({
      type: 'tool-result',
      toolName,
      content: output,
      toolCallId,
    });
  }

  /**
   * Emit a token/cost usage summary on the final step of a turn
   * (`reason === "stop"`). Intermediate `tool-calls` steps are skipped.
   */
  private handleStepFinish(
    event: OpencodeEvent,
    emitOutput: (data: string) => void,
    emitSegment: (segment: CliOutputSegment) => void,
  ): void {
    const part = event.part;
    if (part?.reason !== 'stop') return;

    const tokens = part.tokens;
    if (!tokens) return;
    const usageStr = `Usage: ${tokens.input ?? 0} input, ${
      tokens.output ?? 0
    } output tokens`;
    emitOutput(`\n[${usageStr}]\n`);
    emitSegment({ type: 'info', content: usageStr });
  }
}
