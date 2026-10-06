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
 *                                   [--standalone] [--session <id>] "<prompt>"
 *
 * Notes:
 * - **The working directory is the spawn's `cwd`, and there is no flag for it.**
 *   This used to pass `--dir <cwd>`; opencode 2.0.11 rejects that with
 *   `Unrecognized flag: --dir in command opencode run` and exits 1, so EVERY
 *   lane failed at spawn with no output. The flag was redundant anyway — the
 *   spawn already sets `cwd` — and `opencode run` honours it: measured on
 *   2.0.11, a run started from this worktree reported that worktree as its
 *   directory. Pinned by a spec asserting `--dir` never appears in argv.
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
 * - **Exit 1 does not mean the turn failed (2.x).** In the 2.0.12 bundle the
 *   `run` command sets `process.exitCode = 1` on every `session.step.failed`
 *   and never clears it, while `session.execution.succeeded` just returns. A
 *   provider error that opencode retried past (seen: `provider.invalid-output`,
 *   "stream ended without finish_reason") therefore exits 1 after a finished
 *   turn. A non-zero exit whose last `error` event is followed by a final
 *   `step_finish` (`reason: "stop"`) is reported as success with an `info`
 *   segment naming the recovered error; anything else stays a failure.
 * - Messaging is queue-next-turn: `continue(message)` spawns another
 *   `run --session <id>` with the same flags and env once the turn has ended.
 * - MCP is configured per-process via the `OPENCODE_CONFIG_CONTENT` env var:
 *   an inline JSON string carrying the `mcp.ptah` remote entry, passed to the
 *   child at spawn time. It only reaches the session when that process runs the
 *   session itself. opencode 2.x `run` instead attaches to ONE shared background
 *   service (measured on 2.0.12: a single `role=server` in opencode.log served
 *   every worktree), which never sees the child's env — so the lane had no
 *   `ptah_*` tools and could not report. `--standalone` makes `run` start a
 *   private server from the child's own env; we pass it whenever `run --help`
 *   lists it (1.x has no such flag, and 2.x rejects unknown flags). With the env
 *   honoured, opencode deep-merges it (highest precedence) over the untouched
 *   project config, so agents in one working dir never race over a shared file.
 * - Windows: `resolveCliPath('opencode')` + cross-spawn (`.cmd` wrapper) is the
 *   primary path. Upstream issues report the generated `.ps1` wrapper shelling
 *   out to `/bin/sh.exe`; as a fallback we resolve the bundled native binary
 *   (`opencode-windows-x64/bin/opencode.exe`) directly, mirroring
 *   CodexCliAdapter.resolveCodexNativeBinary().
 *
 * See: https://opencode.ai/docs/cli/ , https://opencode.ai/docs/config/
 */
import { existsSync } from 'fs';
import path from 'path';
import type {
  CliDetectionResult,
  CliOutputSegment,
} from '@ptah-extension/shared';
import type {
  AgentMessagingCapabilities,
  CliAdapter,
  CliCommandOptions,
  CliModelInfo,
  ContinuationOutcome,
  SdkHandle,
} from './cli-adapter.interface';
import { bestMessagingCapability } from './cli-adapter.interface';
import {
  stripAnsiCodes,
  buildTaskPrompt,
  probeCliVersion,
  resolveCliPath,
  resolveDirectSpawn,
  spawnCli,
  createBufferedEmitter,
  withAsarUnpackedTwin,
} from './cli-adapter.utils';
import {
  killProcessTree,
  type IProcessSpawner,
} from '@ptah-extension/platform-core';
import { ptahMcpServerUrl } from './ptah-mcp-url';
import { classifyCliStderr } from './cli-stderr-severity';

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

/**
 * A single line of `opencode run --format json` output.
 *
 * The `error` payload has two shapes. 1.x sends `{ name, data: { message } }`.
 * 2.x forwards the session's error object as is — `{ type, message, ... }`,
 * e.g. `{"type":"provider.invalid-output","message":"OpenAI Chat stream ended
 * without finish_reason","status":200}` — and its own CLI failures as
 * `{ type: "unknown", message }` (read from the 2.0.12 bundle).
 */
interface OpencodeEvent {
  readonly type?: string;
  readonly sessionID?: string;
  readonly timestamp?: number;
  readonly part?: OpencodePart;
  readonly message?: string;
  readonly error?: {
    readonly name?: string;
    readonly type?: string;
    readonly message?: string;
    readonly data?: { readonly message?: string; readonly statusCode?: number };
  };
}

/** Parse state for one `opencode run` turn, read again when the child exits. */
interface OpencodeTurnState {
  /** Last-seen full text per `part.id`, so repeated `text` lines emit deltas. */
  readonly textTracker: Map<string, string>;
  /** Message of the most recent `error` event in this turn. */
  lastErrorMessage?: string;
  /** A final `step_finish` (`reason: "stop"`) arrived after that error. */
  stoppedAfterLastError: boolean;
  /** Error-classified stderr received after that final `step_finish`. */
  stderrErrorAfterStop?: string;
}

/** Everything one `opencode run` spawn needs; see `runTurn`. */
interface OpencodeTurnLaunch {
  readonly command: string;
  readonly args: string[];
  readonly workingDirectory: string;
  readonly env: NodeJS.ProcessEnv;
  readonly signal: AbortSignal;
  readonly emitOutput: (data: string) => void;
  readonly emitSegment: (segment: CliOutputSegment) => void;
  readonly onSpawned: (child: ReturnType<typeof spawnCli>) => void;
  /** The child closed or failed to start; its PID must no longer be used. */
  readonly onExited: (child: ReturnType<typeof spawnCli>) => void;
  readonly onSessionId: (sessionId: string) => void;
}

/** The readable message of an `error` event, whichever shape it has. */
function describeOpencodeError(event: OpencodeEvent): string {
  return (
    event.error?.message ??
    event.error?.data?.message ??
    event.message ??
    event.error?.name ??
    event.error?.type ??
    'Unknown error'
  );
}

/** Resolves a module request to its on-disk path (`require.resolve`). */
type ModulePathResolver = (request: string) => string;

/** Default seam implementation; keeps `require` off the module's top level. */
const requireResolveModulePath: ModulePathResolver = (request) =>
  require.resolve(request);

/**
 * Resolve a Windows native binary only from the detected CLI's directory or
 * its nested `node_modules/opencode-ai`; return `undefined` for an already-native
 * `.exe` (case-insensitive) or missing candidates so the caller keeps that CLI.
 * Without a detected path, try Electron resources, module-resolved packages
 * (including their `app.asar.unpacked` twins), then APPDATA npm packages.
 * Returns `undefined` off-Windows, on unsupported arches, or if no candidate exists.
 *
 * @internal Exported for unit tests only. `resolveModulePath` is a seam: Jest's
 * `require.resolve` can never yield an `app.asar` path, so the asar branch is
 * unreachable otherwise. Production callers pass `detectedCliPath` alone.
 */
export function resolveOpencodeNativeBinary(
  detectedCliPath?: string,
  resolveModulePath: ModulePathResolver = requireResolveModulePath,
): string | undefined {
  if (process.platform !== 'win32') return undefined;
  const platformPkg = OPENCODE_WINDOWS_PACKAGES[process.arch];
  if (!platformPkg) return undefined;

  const relFromNodeModules = path.join(platformPkg, 'bin', 'opencode.exe');
  const relFromBin = path.join('node_modules', relFromNodeModules);

  const candidates: string[] = [];
  if (detectedCliPath) {
    if (/\.exe$/i.test(detectedCliPath)) return undefined;
    const cliDir = path.dirname(detectedCliPath);
    candidates.push(path.join(cliDir, relFromBin));
    candidates.push(
      path.join(cliDir, 'node_modules', 'opencode-ai', relFromBin),
    );
    return candidates.find((candidate) => existsSync(candidate));
  }

  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string })
    .resourcesPath;
  if (resourcesPath) {
    candidates.push(path.join(resourcesPath, 'app.asar.unpacked', relFromBin));
  }

  try {
    const platformPkgJson = resolveModulePath(`${platformPkg}/package.json`);
    candidates.push(
      ...withAsarUnpackedTwin(
        path.join(path.dirname(platformPkgJson), 'bin', 'opencode.exe'),
      ),
    );
  } catch {
    // noop — platform package not resolvable from here.
  }

  try {
    // opencode-ai nests its platform package under its own node_modules.
    const cliPkgJson = resolveModulePath('opencode-ai/package.json');
    candidates.push(
      ...withAsarUnpackedTwin(
        path.join(path.dirname(cliPkgJson), 'node_modules', relFromNodeModules),
      ),
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

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export class OpencodeCliAdapter implements CliAdapter {
  readonly name = 'opencode' as const;
  readonly displayName = 'opencode';
  readonly roleChannel = 'task-prompt' as const;
  /** MCP is configured per-process via the `OPENCODE_CONFIG_CONTENT` env var. */
  readonly supportsMcp = true;

  /**
   * @param spawner - Off-thread process spawner. Supplied by
   *   `CliDetectionService` from `SDK_TOKENS.SDK_PROCESS_SPAWNER`. Without it
   *   every spawn below runs `cross-spawn` inline, which on Windows is a
   *   synchronous `CreateProcessW` that cost 300-900 ms of event-loop lag per
   *   rival-CLI launch (TASK_2026_367).
   */
  constructor(private readonly spawner?: IProcessSpawner) {}

  /** `run --help` probe result per binary; see `supportsStandalone`. */
  private readonly standaloneSupport = new Map<
    string,
    Promise<boolean | undefined>
  >();

  async detect(): Promise<CliDetectionResult> {
    // A re-detect may follow an upgrade (1.x → 2.x); probe `run --help` again.
    this.standaloneSupport.clear();
    try {
      const binaryPath = await resolveCliPath('opencode');
      if (!binaryPath) {
        return {
          cli: 'opencode',
          installed: false,
          messagingMode: bestMessagingCapability(this.capabilities()),
        };
      }
      const version = await probeCliVersion(
        binaryPath,
        undefined,
        undefined,
        this.spawner,
      );

      return {
        cli: 'opencode',
        installed: true,
        path: binaryPath,
        version,
        messagingMode: bestMessagingCapability(this.capabilities()),
      };
    } catch {
      return {
        cli: 'opencode',
        installed: false,
        messagingMode: bestMessagingCapability(this.capabilities()),
      };
    }
  }

  /**
   * One-shot `opencode run` per turn with stdin closed immediately, so nothing
   * reaches a turn in flight. A message is delivered as the NEXT turn instead:
   * the handle's `continue` spawns `run --session <id>` on the same session
   * (the router queues it until the current turn ends).
   */
  capabilities(): AgentMessagingCapabilities {
    return { steer: false, interrupt: false, continuation: true };
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
   * Execute a single CLI probe command and capture its stdout and exit outcome.
   * Never throws — settles cleanly with status flags on timeout, error, or exit.
   */
  private probeCommandOnce(
    binary: string,
    args: string[],
    timeoutMs = 8000,
  ): Promise<{
    readonly stdout: string;
    readonly exitCode: number | null;
    readonly timedOut: boolean;
    readonly errored: boolean;
  }> {
    return new Promise((resolve) => {
      let stdout = '';
      let settled = false;
      const child = spawnCli(binary, args, { spawner: this.spawner });

      const finish = (outcome: {
        stdout: string;
        exitCode: number | null;
        timedOut: boolean;
        errored: boolean;
      }): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(outcome);
      };

      const timer = setTimeout(() => {
        child.kill();
        finish({ stdout: '', exitCode: null, timedOut: true, errored: false });
      }, timeoutMs);

      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (data: string) => {
        stdout += data;
      });
      child.on('close', (code) => {
        finish({
          stdout: stdout.trim(),
          exitCode: code,
          timedOut: false,
          errored: false,
        });
      });
      child.on('error', () => {
        finish({ stdout: '', exitCode: null, timedOut: false, errored: true });
      });
    });
  }

  /**
   * Run `opencode models` and capture stdout. Never throws — resolves undefined
   * on timeout/error/no output.
   *
   * Measured 2026-09-22 on opencode 2.x (win32, TASK_2026_525):
   * `opencode models` in v2 queries an internal background HTTP server. When that
   * server is down (cold start), the command launches it in the background, exits
   * 0 immediately, and prints NOTHING to stdout and nothing to stderr. The model
   * list appears only on the next call once the background server is up:
   *   cycle 1: first=0 lines, second=103 lines
   *   cycle 2: first=0 lines, second=73 lines
   *   cycle 3: first=0 lines, second=73 lines
   *
   * Fix: when the probe exits 0 with empty stdout, run it a second time. One
   * retry covered every measured cycle. We explicitly keep the 8000 ms timeout per
   * attempt, and do NOT retry on a spawn error, non-zero exit, or timeout — only on
   * the "clean exit 0, no output" case, because that is the only signature that
   * indicates the background server was cold.
   *
   * The retry is the SECOND line of defence, and both are needed. `ensureTokensFresh`
   * below runs `opencode auth list`, which was measured to start the background
   * server as a side effect, and `CliDetectionService.refreshCliTokens` calls it at
   * host activation — long before anything asks for models. So in the normal boot
   * order the server is already warm here. The retry covers the orders that are not
   * normal: a model probe that beats activation, or a server that died mid-session.
   * Removing either one reintroduces TASK_2026_525.
   */
  private async probeModels(
    binary: string,
    timeoutMs = 8000,
  ): Promise<string | undefined> {
    const first = await this.probeCommandOnce(binary, ['models'], timeoutMs);

    if (
      first.exitCode === 0 &&
      !first.timedOut &&
      !first.errored &&
      first.stdout
    ) {
      return first.stdout;
    }

    const isColdDaemonStart =
      first.exitCode === 0 &&
      !first.timedOut &&
      !first.errored &&
      first.stdout === '';

    if (!isColdDaemonStart) {
      return undefined;
    }

    const second = await this.probeCommandOnce(binary, ['models'], timeoutMs);
    if (
      second.exitCode === 0 &&
      !second.timedOut &&
      !second.errored &&
      second.stdout
    ) {
      return second.stdout;
    }
    return undefined;
  }

  /**
   * Probe `opencode auth list` to verify if any credentials are stored.
   * Never throws — resolves stdout or undefined on error/timeout/non-zero exit.
   */
  private async probeAuthList(
    binary: string,
    timeoutMs = 8000,
  ): Promise<string | undefined> {
    const outcome = await this.probeCommandOnce(
      binary,
      ['auth', 'list'],
      timeoutMs,
    );
    if (
      outcome.exitCode === 0 &&
      !outcome.errored &&
      !outcome.timedOut &&
      outcome.stdout
    ) {
      return outcome.stdout;
    }
    return undefined;
  }

  /**
   * Check whether opencode credentials are available.
   *
   * opencode 2.x stores credentials in `~/.local/share/opencode/opencode.db` (SQLite)
   * rather than the legacy `auth.json` paths (TASK_2026_525). Probes `opencode auth list`
   * through `spawnCli` with the injected spawner.
   *
   * Measured output:
   * - Signed-in account: `OpenCode  Default  stored`
   * - No authenticated account: `No authenticated integrations`
   *
   * Measured twice more, and both properties matter: `opencode auth list` answers
   * CORRECTLY with the background server stopped (exit 0, credentials reported), and
   * it STARTS that server as a side effect. Since `refreshCliTokens` calls this at
   * host activation, it is what leaves the server warm for `probeModels`. A future
   * rewrite that reads the credential store directly would keep the verdict and lose
   * the warm-up — see the note on `probeModels` before making that trade.
   *
   * Returns true if `opencode auth list` returns non-empty output that does not match
   * "no authenticated integrations", or if a known provider API-key env var is set
   * as the fallback signal.
   */
  async ensureTokensFresh(): Promise<boolean> {
    const binaryPath = (await resolveCliPath('opencode')) ?? 'opencode';
    const raw = await this.probeAuthList(binaryPath);
    if (raw) {
      const cleaned = stripAnsiCodes(raw).trim();
      if (
        cleaned.length > 0 &&
        !/no authenticated integrations/i.test(cleaned)
      ) {
        return true;
      }
    }
    return OPENCODE_PROVIDER_ENV_KEYS.some((key) => !!process.env[key]);
  }

  /**
   * Whether this binary's `opencode run` accepts `--standalone` (see the header).
   * Probed from `run --help` (stdout, ~2.7 s on 2.0.12) rather than the version,
   * because an unknown flag makes 2.x exit 1 before any output. Only a clean
   * exit-0 answer is cached (per binary, until the next `detect()`); a timeout,
   * spawn failure or non-zero exit resolves `undefined` — unknown — and the next
   * run probes again.
   */
  private supportsStandalone(binary: string): Promise<boolean | undefined> {
    let probe = this.standaloneSupport.get(binary);
    if (!probe) {
      probe = this.probeCommandOnce(binary, ['run', '--help'])
        .then((outcome) => {
          if (outcome.exitCode !== 0 || outcome.timedOut || outcome.errored) {
            this.standaloneSupport.delete(binary);
            return undefined;
          }
          return /^\s*--standalone\b/m.test(stripAnsiCodes(outcome.stdout));
        })
        .catch(() => {
          this.standaloneSupport.delete(binary);
          return undefined;
        });
      this.standaloneSupport.set(binary, probe);
    }
    return probe;
  }

  /**
   * Build the inline `OPENCODE_CONFIG_CONTENT` JSON registering the Ptah MCP
   * server as a remote endpoint. opencode deep-merges this per-process at the
   * highest precedence, so it never touches the shared project config on disk.
   */
  private buildMcpConfigContent(
    port: number,
    workingDirectory: string,
    agentId?: string,
  ): string {
    return JSON.stringify({
      mcp: {
        ptah: {
          type: 'remote',
          // Scoped to the spawn's working directory so the server attributes
          // this agent's calls to the right workspace (TASK_2026_364).
          url: ptahMcpServerUrl(port, workingDirectory, agentId),
          enabled: true,
        },
      },
    });
  }

  /**
   * Run the task via `opencode run --format json`.
   *
   * Spawns opencode with the prompt as a trailing positional arg (see
   * `runTurn` for the stream handling). The returned handle can `continue` the
   * same opencode session with a further `run --session <id>` turn, built from
   * the same flags, env and binary as the first one.
   *
   * No session id yet (no event parsed and none to resume): there is nothing
   * to address, so `supportsContinuation()` answers false — the router then
   * refuses the message with its reason — and `continue` rejects rather than
   * starting a fresh session that would lose the conversation (as Pi does).
   */
  async runSdk(options: CliCommandOptions): Promise<SdkHandle> {
    const taskPrompt = buildTaskPrompt(options, this.name);
    const abortController = new AbortController();
    let capturedSessionId: string | undefined;
    let activeChild: ReturnType<typeof spawnCli> | undefined;

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

    // Flags shared by the first turn and every `continue()` turn.
    const baseArgs: string[] = ['run', '--format', 'json'];
    if (options.autoApprove !== false) {
      baseArgs.push('--auto');
    }
    if (options.model) {
      baseArgs.push('--model', options.model);
    }
    const standalone = await this.supportsStandalone(binary);
    if (standalone) {
      baseArgs.push('--standalone');
    }
    // No working-directory flag: `opencode run` takes it from the spawn's cwd.
    // See the note at the top of this file.

    const output = createBufferedEmitter<string>();
    const segment = createBufferedEmitter<CliOutputSegment>();
    if (standalone === undefined) {
      segment.emit({
        type: 'info',
        content:
          '`opencode run --help` did not answer, so this run omits --standalone. ' +
          'On opencode 2.x the lane may then have no Ptah MCP tools.',
      });
    }

    const env: NodeJS.ProcessEnv = {};
    if (options.mcpPort) {
      env['OPENCODE_CONFIG_CONTENT'] = this.buildMcpConfigContent(
        options.mcpPort,
        options.workingDirectory,
        options.agentId,
      );
    }

    // `binary` is already the native `.exe` (from resolveOpencodeNativeBinary) or
    // the `.cmd` shim. resolveDirectSpawn returns the `.exe` unchanged and points
    // a `.cmd` shim at its real node entrypoint/binary, so child.pid is the
    // process taskkill /T should walk from (not the cmd.exe shim). No-op
    // off-Windows / for a resolved `.exe`.
    const spawnDescriptor = await resolveDirectSpawn(binary);

    const startTurn = (
      prompt: string,
      sessionId: string | undefined,
    ): Promise<number> => {
      const args = [...spawnDescriptor.prefixArgs, ...baseArgs];
      if (sessionId) {
        args.push('--session', sessionId);
      }
      // Prompt is a positional arg; keep it LAST.
      args.push(prompt);
      return this.runTurn({
        command: spawnDescriptor.command,
        args,
        workingDirectory: options.workingDirectory,
        env,
        signal: abortController.signal,
        emitOutput: output.emit,
        emitSegment: segment.emit,
        onSpawned: (child) => {
          activeChild = child;
        },
        onExited: (child) => {
          // An exited PID can be reused by an unrelated process; the
          // manager tree-kills whatever `getPid()` returns on stop/release.
          // Only the newest turn's child clears the slot.
          if (activeChild === child) {
            activeChild = undefined;
          }
        },
        onSessionId: (reported) => {
          if (!capturedSessionId) {
            capturedSessionId = reported;
          }
        },
      });
    };

    const resumableSessionId = (): string | undefined =>
      capturedSessionId ?? options.resumeSessionId;

    const done = startTurn(taskPrompt, options.resumeSessionId);

    return {
      abort: abortController,
      done,
      onOutput: output.subscribe,
      onSegment: segment.subscribe,
      // The resumed id counts before (or without) any reported `sessionID`,
      // so the manager can still record which session the lane ran on.
      getSessionId: resumableSessionId,
      getPid: () => activeChild?.pid,
      supportsContinuation: () => resumableSessionId() !== undefined,
      continue: (message: string): Promise<ContinuationOutcome> => {
        const sessionId = resumableSessionId();
        if (!sessionId) {
          return Promise.reject(
            new Error(
              'opencode has not reported a session id yet, so there is no ' +
                'session to continue. The message was not delivered.',
            ),
          );
        }
        // The session already holds the task and its context; the message is
        // the whole prompt of the new turn.
        return Promise.resolve({ done: startTurn(message, sessionId) });
      },
    };
  }

  /**
   * Spawn one `opencode run` turn and stream it into the handle's emitters.
   *
   * stdout is buffered by line and each line JSON.parsed defensively; stderr
   * surfaces as classified segments. The child is tree-killed when the handle
   * aborts (and never spawned if it already has). Resolves the turn's exit
   * code, with a recovered error mapped to 0 — see `settleExitCode`.
   */
  private runTurn(launch: OpencodeTurnLaunch): Promise<number> {
    if (launch.signal.aborted) {
      return Promise.resolve(1);
    }
    const { emitOutput, emitSegment, signal } = launch;
    const child = spawnCli(launch.command, launch.args, {
      cwd: launch.workingDirectory,
      env: launch.env,
      detached: true,
      spawner: this.spawner,
    });
    launch.onSpawned(child);
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    // Prompt is passed via argv; nothing is written to stdin.
    child.stdin?.end();

    const onAbort = (): void => {
      // `pid` is known synchronously for an inline spawn and NOT for an
      // off-thread one, where the child is created on a worker. `whenSpawned`
      // is the one read that works for both; it settles to null if the child
      // never started, so this can never hang (TASK_2026_367).
      void child.whenSpawned.then((pid) => {
        if (pid && !child.killed) {
          // Tree-kill the whole process group — child.kill() alone orphans the
          // real opencode process (and its bash subprocesses) on abort/timeout.
          void killProcessTree(pid);
        }
      });
    };
    signal.addEventListener('abort', onAbort);

    const state: OpencodeTurnState = {
      textTracker: new Map<string, string>(),
      stoppedAfterLastError: false,
    };
    const parseLine = (line: string): void =>
      this.handleLine(line, emitOutput, emitSegment, state, (event) => {
        if (event.sessionID) {
          launch.onSessionId(event.sessionID);
        }
      });

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
        parseLine(line);
      }
    });

    child.stderr?.on('data', (data: string) => {
      const cleaned = stripAnsiCodes(data).trim();
      if (!cleaned) return;
      const severity = classifyCliStderr(cleaned);
      if (severity === 'error' && state.stoppedAfterLastError) {
        state.stderrErrorAfterStop = cleaned;
      }
      emitOutput(`[stderr] ${cleaned}\n`);
      emitSegment({ type: severity, content: cleaned });
    });

    return new Promise<number>((resolve) => {
      child.on('close', (code, exitSignal) => {
        signal.removeEventListener('abort', onAbort);
        launch.onExited(child);
        if (lineBuf.trim()) {
          parseLine(lineBuf);
          lineBuf = '';
        }
        const exitCode = code ?? (exitSignal ? 1 : 0);
        resolve(this.settleExitCode(exitCode, state, signal.aborted, launch));
      });

      child.on('error', (err) => {
        signal.removeEventListener('abort', onAbort);
        launch.onExited(child);
        emitOutput(`\n[opencode CLI Error] ${err.message}\n`);
        emitSegment({
          type: 'error',
          content: `opencode CLI Error: ${err.message}`,
        });
        resolve(1);
      });
    });
  }

  /**
   * Turn a finished child's exit code into the turn's outcome.
   *
   * opencode 2.x exits 1 after ANY failed step, including one it retried past
   * (see the header). When the last `error` event was followed by a final
   * `step_finish` with `reason: "stop"`, the turn completed: report 0 and name
   * the recovered error. A non-zero exit without that stays a failure and
   * carries the last error's message. An aborted turn keeps its code silently.
   */
  private settleExitCode(
    exitCode: number,
    state: OpencodeTurnState,
    aborted: boolean,
    launch: Pick<OpencodeTurnLaunch, 'emitOutput' | 'emitSegment'>,
  ): number {
    if (exitCode === 0 || aborted) {
      return exitCode;
    }
    if (
      state.lastErrorMessage !== undefined &&
      state.stoppedAfterLastError &&
      state.stderrErrorAfterStop === undefined
    ) {
      const notice =
        `opencode recovered from an error and finished the turn, but exited ` +
        `with code ${exitCode}; the turn is treated as complete. Recovered ` +
        `error: ${state.lastErrorMessage}`;
      launch.emitOutput(`[Warning] ${notice}\n`);
      launch.emitSegment({ type: 'info', content: notice });
      return 0;
    }
    const errorMessages = [
      state.lastErrorMessage,
      state.stderrErrorAfterStop,
    ].filter((message): message is string => message !== undefined);
    const cause =
      errorMessages.length > 0 ? ` after error: ${errorMessages.join('; ')}` : '';
    launch.emitSegment({
      type: 'error',
      content: `opencode CLI exited with code ${exitCode}${cause}`,
    });
    return exitCode;
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
    turn: OpencodeTurnState,
    setSessionId: (event: OpencodeEvent) => void,
  ): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let event: OpencodeEvent;
    try {
      event = JSON.parse(trimmed) as OpencodeEvent;
    } catch {
      // degradation-audit: optional-capability - not a complete JSON object
      // (partial line / non-JSON banner); opencode's stream-json output is
      // interleaved with plain text, so skipping the line is the documented
      // defensive behaviour, not a hidden parse bug.
      return;
    }

    setSessionId(event);

    switch (event.type) {
      case 'step_start':
        // Structural marker only — no segment.
        break;
      case 'text':
        this.handleTextEvent(event, emitOutput, emitSegment, turn.textTracker);
        break;
      case 'tool_use':
        this.handleToolUse(event, emitOutput, emitSegment);
        break;
      case 'step_finish':
        if (event.part?.reason === 'stop') {
          turn.stoppedAfterLastError = true;
        }
        this.handleStepFinish(event, emitOutput, emitSegment);
        break;
      case 'error': {
        const message = describeOpencodeError(event);
        turn.lastErrorMessage = message;
        turn.stoppedAfterLastError = false;
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
    emitSegment({
      type: 'info',
      content: usageStr,
      usage: {
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        costUsd: part.cost,
      },
    });
  }
}
