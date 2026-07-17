/**
 * Pi CLI Adapter (`pi`) — RPC mode (mid-run steering + continuation)
 *
 * Spawn-based, structured-JSONL adapter for Pi — the Earendil "Pi Coding Agent"
 * CLI (npm package `@earendil-works/pi-coding-agent`, bin `pi`). This adapter
 * drives Pi's **`--mode rpc`** channel rather than the one-shot `--mode json`
 * run, upgrading it to two SDK-grade capabilities over a killable subprocess:
 *
 *   1. **Mid-run steering** — a `{"type":"steer","message":...}` request written
 *      to the still-running child's stdin. Pi delivers it "after the current
 *      turn's tool calls, before the next LLM call", extending the run.
 *   2. **Continuation (multi-turn)** — `continue()` re-spawns Pi with the prior
 *      session id so the next user turn resumes the same conversation. Each
 *      re-spawn re-points `activeChild`, so steering targets the live turn.
 *
 * This deliberately does NOT use the in-process `@earendil-works/pi-coding-agent`
 * SDK: this repo already proved in-process agent SDKs fail to load under
 * Node/Electron's ESM loader (see `copilot-sdk.adapter.ts:5-13`). RPC mode gives
 * the same capabilities over a spawned binary the manager already owns and kills.
 *
 * Launch:  pi --mode rpc -a [--model <provider/model>] [--thinking <effort>]
 *                        [--session <id>]
 *
 * Protocol (JSONL over stdin/stdout, one object per line, LF-delimited):
 * - Requests (stdin): `{"type":"prompt","message":"...","id":"p1"}` (INITIAL
 *   prompt only — the agent is idle at spawn), `{"type":"get_state","id":"s0"}`
 *   (to capture the session id), `{"type":"steer","message":"..."}` (mid-run),
 *   `{"type":"abort"}` (best-effort graceful stop). A bare `prompt` mid-run is
 *   NEVER sent — Pi errors on it unless streamingBehavior is set; steering uses
 *   the dedicated `steer` request instead.
 * - Responses (stdout): `{"type":"response","command":"get_state","success":true,
 *   "id":"s0","data":{"sessionId":"...","sessionFile":"..."}}` — session id source.
 * - Events (stdout): same union as `--mode json`
 *   (`session` header / `message_update` text_delta|thinking_delta /
 *   `tool_execution_start` / `tool_execution_end`{isError} / structural
 *   `agent_start`/`turn_start`/`turn_end`/`agent_end`{willRetry}), PLUS the
 *   RPC-only **`agent_settled`** event = fully idle, nothing queued.
 *
 * Lifecycle (settle-then-kill — no process leak):
 * - The turn's `done` promise resolves on **`agent_settled`** (final idle), NOT
 *   on `agent_end` (an `agent_end` with `willRetry:true` means a retry follows).
 * - On resolve (or abort / fatal error), the child is killed best-effort
 *   (`{"type":"abort"}` write then `child.kill()`). The manager's `stop()` only
 *   kills agents whose status is still `running`, so a persistent RPC child left
 *   alive after settle would leak — hence the adapter owns teardown itself.
 *
 * Notes / known limitations (unchanged from the json-mode adapter):
 * - `-a`/`--approve` trusts project-local `.pi/` config for the run (config
 *   trust, NOT tool gating) so repo-level Pi skills/extensions are respected.
 * - Pi has NO tool-approval/permission gate by design ("no permission popups"),
 *   so `options.autoApprove` has nothing to map to — tool execution is always
 *   auto-approved by Pi itself; `autoApprove:false` cannot be honoured.
 * - MCP is NOT supported (`supportsMcp = false`); `options.mcpPort` is ignored.
 *
 * UNVERIFIED (no live `pi` in this environment — same defensive posture as the
 * antigravity adapter): that `--mode rpc` honours the `--model` / `--thinking` /
 * `--session` CLI flags (documented in Pi's flag table for the interactive/json
 * modes). If `--session` is not honoured in rpc mode, continuation would need a
 * post-spawn `{"type":"switch_session","sessionFile":<path>}` request instead —
 * captured `sessionFile` from get_state is available for that fallback.
 *
 * See: https://pi.dev/docs/latest/rpc , https://pi.dev/docs/latest/json ,
 *      https://github.com/earendil-works/pi
 */
import { readFile } from 'fs/promises';
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
  ContinuationOutcome,
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
 * Provider API-key env vars treated as a "credentials present" signal when no
 * on-disk auth.json is found. Non-exhaustive — Pi supports many providers via
 * env vars; these are the common ones.
 */
const PI_PROVIDER_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'DEEPSEEK_API_KEY',
  'GEMINI_API_KEY',
  'MISTRAL_API_KEY',
  'GROQ_API_KEY',
  'XAI_API_KEY',
  'OPENROUTER_API_KEY',
] as const;

/** A `message_update` event's inner assistant-message delta. */
interface PiAssistantMessageEvent {
  readonly type?: string;
  readonly contentIndex?: number;
  readonly delta?: string;
}

/** A single line of `pi --mode rpc` output (event OR response). */
interface PiEvent {
  readonly type?: string;
  /** Session header only: the session UUID. */
  readonly id?: string;
  readonly version?: number;
  readonly cwd?: string;
  /** `response` lines: which request they answer (e.g. 'get_state'). */
  readonly command?: string;
  readonly success?: boolean;
  /** `response` payload — get_state carries sessionId / sessionFile. */
  readonly data?: {
    readonly sessionId?: string;
    readonly sessionFile?: string;
    readonly [key: string]: unknown;
  };
  readonly assistantMessageEvent?: PiAssistantMessageEvent;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly args?: unknown;
  readonly result?: unknown;
  readonly isError?: boolean;
  /** `agent_end` only: a retry follows when true — do NOT settle on it. */
  readonly willRetry?: boolean;
  /** `error` event only: the failure message. */
  readonly message?: string;
}

/** Cap on the un-newlined stdout buffer before we discard it (runaway line). */
const LINE_BUF_CAP = 1024 * 1024;

export class PiCliAdapter implements CliAdapter {
  readonly name = 'pi' as const;
  readonly displayName = 'Pi';
  /** Pi has no MCP support — its extensibility is code-based (registerTool). */
  readonly supportsMcp = false;

  async detect(): Promise<CliDetectionResult> {
    try {
      const binaryPath = await resolveCliPath('pi');
      if (!binaryPath) {
        return { cli: 'pi', installed: false, supportsSteer: false };
      }
      const version = await probeCliVersion(binaryPath);

      return {
        cli: 'pi',
        installed: true,
        path: binaryPath,
        version,
        // RPC mode exposes a live stdin channel for mid-run steering.
        supportsSteer: true,
      };
    } catch {
      return {
        cli: 'pi',
        installed: false,
        supportsSteer: false,
      };
    }
  }

  supportsSteer(): boolean {
    return true;
  }

  parseOutput(raw: string): string {
    return stripAnsiCodes(raw);
  }

  /**
   * List available models by parsing `pi --list-models` stdout. Each non-empty
   * line is treated as a model id (the value passed to `--model`), serving as
   * both id and display name. Falls back to an empty list when the probe fails.
   */
  async listModels(): Promise<CliModelInfo[]> {
    const binaryPath = (await resolveCliPath('pi')) ?? 'pi';
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
   * Run `pi --list-models` and capture stdout. Never throws — resolves undefined
   * on timeout/error/no output.
   */
  private probeModels(
    binary: string,
    timeoutMs = 8000,
  ): Promise<string | undefined> {
    return new Promise((resolve) => {
      let stdout = '';
      const child = spawnCli(binary, ['--list-models'], {});
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
   * Path to Pi's auth file (`~/.pi/agent/auth.json`).
   * Prefers $HOME / $USERPROFILE over os.homedir() so tests that reassign HOME
   * are honoured (mirrors CodexCliAdapter.getAuthPath()).
   */
  private static getAuthPath(): string {
    const home = process.env['HOME'] || process.env['USERPROFILE'] || homedir();
    return join(home, '.pi', 'agent', 'auth.json');
  }

  /**
   * Check whether Pi credentials are available.
   * Returns true if ~/.pi/agent/auth.json parses with at least one provider
   * entry, or a known provider API-key env var is set. No active refresh —
   * Pi refreshes its own OAuth tokens internally.
   */
  async ensureTokensFresh(): Promise<boolean> {
    try {
      const raw = await readFile(PiCliAdapter.getAuthPath(), 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (
        parsed &&
        typeof parsed === 'object' &&
        Object.keys(parsed).length > 0
      ) {
        return true;
      }
    } catch {
      // Missing/malformed auth.json — fall through to the env-var check.
    }
    return PI_PROVIDER_ENV_KEYS.some((key) => !!process.env[key]);
  }

  /**
   * Run the task via `pi --mode rpc` over a persistent-during-run subprocess.
   *
   * Mirrors the copilot-sdk adapter's `runTurn(prompt, resumeSessionId)` closure
   * over a mutable `activeChild`: each turn spawns Pi, keeps stdin open, writes
   * the initial `prompt` + a `get_state` request, streams JSONL events into
   * `CliOutputSegment`s, resolves on `agent_settled`, then kills the child so no
   * persistent process leaks. `steer()` and `continue()` target `activeChild`.
   */
  async runSdk(options: CliCommandOptions): Promise<SdkHandle> {
    // options.mcpPort is intentionally ignored — Pi has no MCP support.
    // options.autoApprove is a no-op — Pi has no tool-approval gate to skip;
    // tool execution is always auto-approved by Pi itself, so `false` cannot be
    // honoured. Surfaced as a known limitation rather than silently pretended.

    const abortController = new AbortController();
    const binary = options.binaryPath ?? 'pi';
    let capturedSessionId: string | undefined;
    let capturedSessionFile: string | undefined;
    let activeChild: ReturnType<typeof spawnCli> | undefined;

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

    /** Write one JSONL request to a child's stdin, only if still writable. */
    const writeRequest = (
      child: ReturnType<typeof spawnCli>,
      request: Record<string, unknown>,
    ): void => {
      try {
        if (child.stdin?.writable) {
          child.stdin.write(JSON.stringify(request) + '\n');
        }
      } catch {
        // stdin closed / EPIPE mid-write — the run is already tearing down.
      }
    };

    /** Best-effort graceful stop then hard tree-kill (settle-then-kill
     *  lifecycle). The `{"type":"abort"}` write gives Pi a chance to unwind its
     *  own tool subprocesses first; the tree-kill then reaps whatever survives
     *  (bash grandchildren, dev servers) instead of orphaning them. */
    const killChild = (child: ReturnType<typeof spawnCli>): void => {
      writeRequest(child, { type: 'abort' });
      if (child.pid && !child.killed) {
        void killProcessTree(child.pid);
      }
    };

    // Registered ONCE for the lifetime of the handle. `activeChild` is re-pointed
    // on every turn (initial + each continue()), so abort always targets the
    // live child. The manager's killProcess() calls abort for SDK handles.
    const onAbort = (): void => {
      if (activeChild) {
        killChild(activeChild);
      }
    };
    abortController.signal.addEventListener('abort', onAbort);

    // On Windows, `pi` is typically an npm `.cmd` shim; cross-spawn would run it
    // through cmd.exe, making child.pid the shim PID (killing it orphans the real
    // agent). resolveDirectSpawn points spawn at the real node entrypoint/binary
    // so child.pid is the process taskkill /T should walk from. No-op off-Windows.
    const spawnDescriptor = await resolveDirectSpawn(binary);

    const runTurn = (
      message: string,
      resumeSessionId?: string,
    ): Promise<number> => {
      const args: string[] = ['--mode', 'rpc', '-a'];
      if (options.model) {
        args.push('--model', options.model);
      }
      if (options.reasoningEffort) {
        // Pi's thinking scale: off | minimal | low | medium | high | xhigh | max.
        args.push('--thinking', options.reasoningEffort);
      }
      if (resumeSessionId) {
        // See UNVERIFIED note in the header: assumes --mode rpc honours --session.
        args.push('--session', resumeSessionId);
      }

      const child = spawnCli(
        spawnDescriptor.command,
        [...spawnDescriptor.prefixArgs, ...args],
        {
          cwd: options.workingDirectory,
          detached: true,
        },
      );
      activeChild = child;
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      // Defensive no-op: an async EPIPE/ERR_STREAM_DESTROYED on a write into a
      // dying child emits an 'error' event on stdin; without a listener Node
      // rethrows it and can crash the host process.
      child.stdin?.on('error', () => {});

      // Persistent channel: DO NOT end stdin — it stays open for steering.
      // The INITIAL prompt is safe (agent idle); get_state captures the session.
      writeRequest(child, { type: 'prompt', message, id: 'p1' });
      writeRequest(child, { type: 'get_state', id: 's0' });

      let lineBuf = '';
      let stderrBuf = '';

      return new Promise<number>((resolve) => {
        let settled = false;

        /** Resolve the turn exactly once, then tear the child down. */
        const finish = (code: number): void => {
          if (settled) return;
          settled = true;
          killChild(child);
          // Invalidate the steer target so a late steer() (guarded on
          // `if (activeChild)`) becomes a guaranteed no-op instead of writing
          // into the just-killed child. onAbort reading undefined is a safe
          // no-op; continue()'s runTurn re-assigns activeChild on re-spawn.
          activeChild = undefined;
          resolve(code);
        };

        child.stdout?.on('data', (data: string) => {
          lineBuf += stripAnsiCodes(data);
          const lines = lineBuf.split(/\r?\n/);
          lineBuf = lines.pop() ?? '';
          if (lineBuf.length > LINE_BUF_CAP) {
            emitSegment({
              type: 'info',
              content: `Line buffer exceeded ${LINE_BUF_CAP} bytes without a newline; resetting.`,
            });
            lineBuf = '';
          }
          for (const line of lines) {
            const isSettled = this.handleLine(line, emitOutput, emitSegment, {
              onSessionId: (id) => {
                if (id && !capturedSessionId) capturedSessionId = id;
              },
              onSessionFile: (file) => {
                if (file && !capturedSessionFile) capturedSessionFile = file;
              },
            });
            if (isSettled) {
              finish(0);
            }
          }
        });

        child.stderr?.on('data', (data: string) => {
          stderrBuf += stripAnsiCodes(data);
          const lines = stderrBuf.split(/\r?\n/);
          stderrBuf = lines.pop() ?? '';
          for (const raw of lines) {
            const cleaned = raw.trim();
            if (!cleaned) continue;
            emitOutput(`[stderr] ${cleaned}\n`);
            const isError =
              /\b(error|fail(ed)?|exception|denied|unauthorized|refused|timeout|abort|crash|panic|fatal)\b/i.test(
                cleaned,
              );
            emitSegment({
              type: isError ? 'error' : 'info',
              content: cleaned,
            });
          }
        });

        child.on('close', (code, signal) => {
          if (settled) return;
          // The process exited before an `agent_settled` — flush any trailing
          // line, then resolve with the exit code as a fallback.
          if (lineBuf.trim()) {
            this.handleLine(lineBuf, emitOutput, emitSegment, {
              onSessionId: (id) => {
                if (id && !capturedSessionId) capturedSessionId = id;
              },
              onSessionFile: (file) => {
                if (file && !capturedSessionFile) capturedSessionFile = file;
              },
            });
            lineBuf = '';
          }
          const exitCode = code ?? (signal ? 1 : 0);
          if (exitCode !== 0 && !abortController.signal.aborted) {
            emitSegment({
              type: 'error',
              content: `Pi CLI exited with code ${exitCode}`,
            });
          }
          finish(exitCode);
        });

        child.on('error', (err: Error) => {
          emitOutput(`\n[Pi CLI Error] ${err.message}\n`);
          emitSegment({
            type: 'error',
            content: `Pi CLI Error: ${err.message}`,
          });
          finish(1);
        });
      });
    };

    const done = runTurn(buildTaskPrompt(options), options.resumeSessionId);

    return {
      abort: abortController,
      done,
      onOutput,
      onSegment,
      getSessionId: () => capturedSessionId,
      getPid: () => activeChild?.pid,
      steer: (message: string): void => {
        // Mid-run steering targets the CURRENT child's stdin. NEVER a bare
        // `prompt` (Pi errors on that mid-run) — the dedicated `steer` request.
        if (activeChild) {
          writeRequest(activeChild, { type: 'steer', message });
        }
      },
      supportsContinuation: () => capturedSessionId != null,
      continue: (message: string): Promise<ContinuationOutcome> =>
        // Re-spawn with the captured session id; the new child re-points
        // `activeChild`, so steering works on the continued turn too.
        Promise.resolve({ done: runTurn(message, capturedSessionId) }),
    };
  }

  /**
   * Parse one JSONL line and emit its raw text + structured segment(s).
   * Non-JSON / partial lines are skipped defensively. Returns `true` when the
   * line is the RPC-only `agent_settled` event (the caller resolves the turn).
   *
   * Session id / file are surfaced via the `capture` callbacks from either the
   * `session` header line or the `get_state` response payload.
   */
  private handleLine(
    line: string,
    emitOutput: (data: string) => void,
    emitSegment: (segment: CliOutputSegment) => void,
    capture: {
      onSessionId: (id: string | undefined) => void;
      onSessionFile: (file: string | undefined) => void;
    },
  ): boolean {
    const trimmed = line.trim();
    if (!trimmed) return false;

    let event: PiEvent;
    try {
      event = JSON.parse(trimmed) as PiEvent;
    } catch {
      // Not a complete JSON object (partial line / non-JSON banner) — skip.
      return false;
    }

    switch (event.type) {
      case 'session':
        // Session header line: capture the id, emit no segment.
        capture.onSessionId(event.id);
        return false;
      case 'response':
        // RPC response envelope — get_state carries the session id / file.
        if (event.command === 'get_state' && event.data) {
          capture.onSessionId(event.data.sessionId);
          capture.onSessionFile(event.data.sessionFile);
        }
        return false;
      case 'agent_settled':
        // RPC-only: fully idle, nothing queued — the turn is complete.
        return true;
      case 'agent_end':
        // Structural end of one agent pass. A retry follows when willRetry is
        // true, so we do NOT settle here — we wait for `agent_settled`.
        return false;
      case 'message_update':
        this.handleMessageUpdate(event, emitOutput, emitSegment);
        return false;
      case 'tool_execution_start':
        emitOutput(`[Tool] ${event.toolName ?? 'tool'}\n`);
        emitSegment({
          type: 'tool-call',
          toolName: event.toolName ?? 'tool',
          toolArgs:
            event.args !== undefined ? JSON.stringify(event.args) : undefined,
          content: '',
          toolCallId: event.toolCallId,
        });
        return false;
      case 'tool_execution_end': {
        const content =
          event.result !== undefined
            ? typeof event.result === 'string'
              ? event.result
              : JSON.stringify(event.result)
            : '';
        emitSegment({
          type: event.isError ? 'tool-result-error' : 'tool-result',
          toolName: event.toolName,
          content,
          toolCallId: event.toolCallId,
        });
        return false;
      }
      case 'error': {
        const message = event.message ?? 'Unknown Pi error';
        emitOutput(`\n[Pi CLI Error] ${message}\n`);
        emitSegment({ type: 'error', content: message });
        return false;
      }
      default:
        // agent_start/turn_start/turn_end/queue_update/etc. are structural.
        return false;
    }
  }

  /**
   * Map a `message_update` event to a text/thinking delta segment based on its
   * inner `assistantMessageEvent.type` (`text_delta` / `thinking_delta`).
   */
  private handleMessageUpdate(
    event: PiEvent,
    emitOutput: (data: string) => void,
    emitSegment: (segment: CliOutputSegment) => void,
  ): void {
    const inner = event.assistantMessageEvent;
    const delta = inner?.delta;
    if (!delta) return;

    if (inner?.type === 'thinking_delta') {
      emitOutput(delta);
      emitSegment({ type: 'thinking', content: delta });
    } else if (inner?.type === 'text_delta') {
      emitOutput(delta);
      emitSegment({ type: 'text', content: delta });
    }
  }
}
