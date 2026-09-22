/**
 * Antigravity CLI Adapter (`agy`)
 *
 * Spawn-based, structured-JSONL adapter for Google's Antigravity CLI. As of
 * `agy` v1.1.11 print mode supports `--output-format stream-json`, which emits
 * one JSON object per line, so segment parsing here is an event loop like the
 * opencode / Codex adapters — not the old plain-text heuristic classifier.
 *
 * Multi-turn run:  agy --print= --input-format stream-json
 *                      --output-format stream-json
 * The prompt and every continuation are written as validated NDJSON to stdin.
 *
 * Observed stream-json schema (captured from agy 1.1.11 — see
 * `.ptah/specs/TASK_2026_199/stream-json-capture.md`). Every line is
 * `{"event": <name>, ...}` with the payload nested under a key of that name:
 *
 * - `init`   — `{event, conversation_id, init:{cwd, tools[], permission_mode}}`
 *              The conversation id IS on the stream, so no mtime scan is needed.
 * - `step_update` — `{event, step_update:{conversation_id, step_index, state,
 *              step_type, tool_name?, tool_info?, text_delta?, duration_seconds?,
 *              usage?}}`. `state` is `ACTIVE` | `DONE`; `step_type` observed as
 *              `user_input`, `agent_response`, `tool`, `checkpoint`, `unknown`
 *              (the binary also carries a `system_message` literal).
 *              `tool_info` is `{name, parameters, output?}` — `output` only on
 *              the `DONE` update, and it carries failure text inline (there is
 *              no separate error flag or exit code).
 * - `result` — `{event, result:{conversation_id, status, response,
 *              duration_seconds, num_turns, usage}}`. `response` is the full
 *              concatenation of the `text_delta`s already streamed, so it is
 *              NOT re-emitted; only a usage summary is.
 *
 * Notes:
 * - `text_delta` is INCREMENTAL per `agent_response` step (each event carries
 *   only the newly appended chunk), so no last-seen-text diffing is required.
 * - `agy` does NOT stream reasoning text — thinking shows up only as
 *   `usage.thinking_tokens`. No `thinking` segments are emitted; guessing them
 *   from prose (the previous behaviour) produced false positives.
 * - Lines that fail to parse as JSON fall back to being emitted verbatim as
 *   `text` (banners, crash dumps, a partial final line).
 * - `--print` (alias `--prompt`/`-p`) is a STRING flag with an optional value.
 *   Stream input requires an attached empty value. Shell notation is
 *   `--print=''`; direct spawn receives the quote-free argv item `--print=`.
 * - `--dangerously-skip-permissions` maps to autoApprove; required or
 *   file-writing tool calls hang waiting for interactive approval.
 * - `--effort` takes `low|medium|high` only; other values are dropped rather
 *   than passed through (same allowlist shape as the Codex adapter).
 * - `agy` has no GEMINI_SYSTEM_MD support, so systemPrompt/projectGuidance are
 *   prepended to the task prompt via buildTaskPrompt (the shared fallback).
 *
 * See: https://antigravity.google/docs/cli/reference
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import {
  createMcpFacet,
  PTAH_SPAWN_MCP_KEY,
  type IHarnessMcpFacet,
} from '@ptah-extension/harness-sync';
import type {
  CliDetectionResult,
  CliOutputSegment,
  McpServerConfig,
} from '@ptah-extension/shared';
import type {
  AgentMessagingCapabilities,
  CliAdapter,
  CliCommandOptions,
  CliModelInfo,
  SdkHandle,
} from './cli-adapter.interface';
import { bestMessagingCapability } from './cli-adapter.interface';
import {
  assertCommandLineWithinLimit,
  stripAnsiCodes,
  buildTaskPrompt,
  probeCliVersion,
  resolveCliPath,
  resolveDirectSpawn,
  spawnCli,
  createBufferedEmitter,
} from './cli-adapter.utils';
import {
  killProcessTree,
  type IProcessSpawner,
} from '@ptah-extension/platform-core';
import { ptahMcpServerUrl } from './ptah-mcp-url';
import { classifyCliStderr } from './cli-stderr-severity';
import { z } from 'zod';

/**
 * Print-mode wait timeout. `agy` defaults to 5m, which kills most real coding
 * tasks; align it with AgentProcessManager's 1h execution cap so the manager
 * owns the timeout rather than the CLI.
 */
const PRINT_TIMEOUT = '3600s';

/** Values `agy --effort` accepts. Anything else is dropped. */
const AGY_EFFORTS = ['low', 'medium', 'high'] as const;

/** Token/cost accounting attached to `agent_response` / `checkpoint` / `result`. */
const AgyUsageSchema = z
  .object({
    input_tokens: z.number().optional(),
    output_tokens: z.number().optional(),
    thinking_tokens: z.number().optional(),
    cache_read_tokens: z.number().optional(),
    total_tokens: z.number().optional(),
  })
  .passthrough();

/** Tool invocation detail. `output` is present only on the `DONE` update. */
const AgyToolInfoSchema = z
  .object({
    name: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
    output: z.string().optional(),
  })
  .passthrough();

/** Payload of a `step_update` event. */
const AgyStepUpdateSchema = z
  .object({
    conversation_id: z.string().optional(),
    step_index: z.number().optional(),
    state: z.string().optional(),
    step_type: z.string(),
    tool_name: z.string().optional(),
    tool_info: AgyToolInfoSchema.optional(),
    text_delta: z.string().optional(),
    duration_seconds: z.number().optional(),
    usage: AgyUsageSchema.optional(),
  })
  .passthrough();

/** Payload of the terminal `result` event. */
const AgyResultSchema = z
  .object({
    conversation_id: z.string().optional(),
    status: z.string(),
    response: z.string().optional(),
    duration_seconds: z.number().optional(),
    num_turns: z.number().optional(),
    usage: AgyUsageSchema.optional(),
  })
  .passthrough();

/** A single line of `agy --output-format stream-json` output. */
const AgyEventHeaderSchema = z.object({ event: z.string() }).passthrough();
const AgyInitEventSchema = z
  .object({
    event: z.literal('init'),
    conversation_id: z.string(),
    init: z
      .object({
        cwd: z.string().optional(),
        tools: z.array(z.string()).optional(),
        permission_mode: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();
const AgyStepUpdateEventSchema = z
  .object({ event: z.literal('step_update'), step_update: AgyStepUpdateSchema })
  .passthrough();
const AgyResultEventSchema = z
  .object({ event: z.literal('result'), result: AgyResultSchema })
  .passthrough();
const AgyInputMessageSchema = z.object({
  event: z.literal('user'),
  message: z.object({ content: z.string() }),
});

type AgyStepUpdate = z.infer<typeof AgyStepUpdateSchema>;
type AgyResult = z.infer<typeof AgyResultSchema>;

interface TurnDeferred {
  readonly done: Promise<number>;
  readonly resolve: (exitCode: number) => void;
  settled: boolean;
}

function createTurnDeferred(): TurnDeferred {
  let resolvePromise!: (exitCode: number) => void;
  const deferred: TurnDeferred = {
    done: new Promise<number>((resolve) => {
      resolvePromise = resolve;
    }),
    resolve: (exitCode) => {
      if (deferred.settled) return;
      deferred.settled = true;
      resolvePromise(exitCode);
    },
    settled: false,
  };
  return deferred;
}

function buildAntigravityArgs(
  options: CliCommandOptions,
  taskPrompt: string,
  useStreamInput: boolean,
): string[] {
  const args = useStreamInput
    ? [
        '--print=',
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
      ]
    : ['--output-format', 'stream-json'];
  if (options.autoApprove !== false) {
    args.push('--dangerously-skip-permissions');
  }
  args.push('--print-timeout', PRINT_TIMEOUT);
  if (options.model) {
    args.push('--model', options.model);
  }
  if (
    options.reasoningEffort &&
    (AGY_EFFORTS as readonly string[]).includes(options.reasoningEffort)
  ) {
    args.push('--effort', options.reasoningEffort);
  }
  if (options.workingDirectory) {
    args.push('--add-dir', options.workingDirectory);
  }
  if (options.resumeSessionId) {
    args.push('--conversation', options.resumeSessionId);
  }
  if (!useStreamInput) {
    args.push('--print', taskPrompt);
  }
  return args;
}

function formatUsage(
  usage: z.infer<typeof AgyUsageSchema>,
): string | undefined {
  const details: string[] = [];
  if (usage.input_tokens !== undefined) {
    details.push(`${usage.input_tokens} input`);
  }
  if (usage.output_tokens !== undefined) {
    details.push(`${usage.output_tokens} output`);
  }
  if (details.length === 0 && usage.total_tokens !== undefined) {
    details.push(`${usage.total_tokens} total`);
  }
  return details.length > 0 ? `Usage: ${details.join(', ')} tokens` : undefined;
}

export class AntigravityCliAdapter implements CliAdapter {
  readonly name = 'antigravity' as const;
  readonly displayName = 'Antigravity';
  readonly roleChannel = 'task-prompt' as const;
  /** MCP is configured via ~/.gemini/config/mcp_config.json before each spawn */
  readonly supportsMcp = true;

  /**
   * @param spawner - Off-thread process spawner. Supplied by
   *   `CliDetectionService` from `SDK_TOKENS.SDK_PROCESS_SPAWNER`. Without it
   *   every spawn below runs `cross-spawn` inline, which on Windows is a
   *   synchronous `CreateProcessW` that cost 300-900 ms of event-loop lag per
   *   rival-CLI launch (TASK_2026_367).
   */
  private streamJsonInputSupported: boolean | undefined;
  private readonly streamJsonInputSupportByBinary = new Map<string, boolean>();

  constructor(
    private readonly spawner?: IProcessSpawner,
    private readonly streamJsonProbe?: (binary: string) => Promise<boolean>,
  ) {}

  async detect(): Promise<CliDetectionResult> {
    try {
      const binaryPath = await resolveCliPath('agy');
      if (!binaryPath) {
        return {
          cli: 'antigravity',
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
      await this.probeStreamJsonInput(binaryPath);

      return {
        cli: 'antigravity',
        installed: true,
        path: binaryPath,
        version,
        messagingMode: bestMessagingCapability(this.capabilities()),
      };
    } catch {
      return {
        cli: 'antigravity',
        installed: false,
        messagingMode: bestMessagingCapability(this.capabilities()),
      };
    }
  }

  /**
   * The async capability probe records whether this installed `agy` supports
   * stream-json input. A live handle also reports its own capability, which is
   * authoritative while a lane is running.
   */
  capabilities(): AgentMessagingCapabilities {
    return {
      steer: false,
      interrupt: false,
      continuation: this.streamJsonInputSupported === true,
    };
  }

  private async probeStreamJsonInput(binary: string): Promise<boolean> {
    const cached = this.streamJsonInputSupportByBinary.get(binary);
    if (cached !== undefined) {
      this.streamJsonInputSupported = cached;
      return cached;
    }
    if (this.streamJsonProbe) {
      this.streamJsonInputSupported = await this.streamJsonProbe(binary);
      this.streamJsonInputSupportByBinary.set(
        binary,
        this.streamJsonInputSupported,
      );
      return this.streamJsonInputSupported;
    }

    this.streamJsonInputSupported = await new Promise<boolean>((resolve) => {
      let help = '';
      let settled = false;
      const finish = (supported: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(supported);
      };
      const child = spawnCli(binary, ['--help'], { spawner: this.spawner });
      const timer = setTimeout(() => {
        child.kill();
        finish(false);
      }, 8000);
      const capture = (data: string): void => {
        help += stripAnsiCodes(data);
      };
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', capture);
      child.stderr?.on('data', capture);
      child.on('close', () => finish(/--input-format\b/.test(help)));
      child.on('error', () => finish(false));
    });
    this.streamJsonInputSupportByBinary.set(
      binary,
      this.streamJsonInputSupported,
    );
    return this.streamJsonInputSupported;
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
      const child = spawnCli(binary, ['models'], { spawner: this.spawner });
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
   * The ONE writer of `~/.gemini/config/mcp_config.json`.
   *
   * This adapter used to hand-roll its own read-modify-write of that file. Then
   * `agy` became a user-installable MCP target (TASK_2026_285) and the harness
   * reconciler started writing the SAME file, which made the hand-rolled copy a
   * second writer with a second idea of the format and no serialization at all
   * — one lost update and the user's installed server disappears after an agent
   * run, silently.
   *
   * So both sides go through the facet from `harness-sync`, which owns the
   * schema (`mcpServers`, `serverUrl` for remote), the atomic write and the
   * config-file lock. The dependency direction is the allowed one:
   * `cli-agent-runtime` → `harness-sync`, never the reverse.
   *
   * `homeDir` is resolved env-first for the same reason `geminiRoot()` is —
   * tests and sandboxes reassign `HOME` after module load, and the facet's
   * default would otherwise resolve `os.homedir()` and write to the real one.
   */
  private static mcpFacet(): IHarnessMcpFacet {
    return createMcpFacet('antigravity', {
      homeDir: process.env['HOME'] || process.env['USERPROFILE'] || homedir(),
    });
  }

  /**
   * Publish Ptah's own MCP server for this run.
   *
   * The key is `PTAH_SPAWN_MCP_KEY`, shared with the reconciler so the two
   * writers cannot disagree about which name is ephemeral. The facet's write is
   * read-modify-write of ONE key, so a user's servers — installed through the
   * marketplace or by hand — are carried through untouched.
   *
   * Non-fatal: a failure here costs MCP tools for this run, and the CLI still
   * functions, so it must not abort the spawn.
   */
  private async configureMcpServer(
    port: number,
    workingDirectory: string,
    agentId?: string,
  ): Promise<McpServerConfig | undefined> {
    try {
      const facet = AntigravityCliAdapter.mcpFacet();
      // Captured BEFORE the write so cleanup can put it back. `CodeExecutionMCP`
      // now keeps a PERSISTENT `ptah` entry in this file for as long as its HTTP
      // server is up, so that a user's own `agy` — not just one Ptah spawned —
      // has the tools. Deleting the key after this run would take that away and
      // leave it gone until the next registration pass.
      const prior = facet.readAll('').get(PTAH_SPAWN_MCP_KEY);
      await facet.write(
        '',
        PTAH_SPAWN_MCP_KEY,
        // `agy`'s remote transport is SSE and the facet serializes this as
        // `{ serverUrl }`, which is the only remote shape the CLI reads.
        // Passing `sse` is safe beside the persistent writer because the facet
        // drops the discriminant on disk — and `ptahMcpServerUrl` percent-
        // encodes the directory, so the URL cannot grow a literal `/sse` that
        // would flip `inferTransportType` on read-back. The URL itself is
        // scoped to this run's working directory (TASK_2026_364); it differs
        // from the persistent bare home entry only while this run is in
        // flight, and cleanup restores whatever this run found.
        { type: 'sse', url: ptahMcpServerUrl(port, workingDirectory, agentId) },
      );
      return prior;
    } catch {
      // degradation-audit: optional-capability - per the doc comment on this
      // method, MCP tools won't be available this run; CLI still functions.
      return undefined;
    }
  }

  /**
   * Put the `ptah` key back the way this run found it, so no stale localhost
   * port is left pointing at a closed server.
   *
   * **RESTORE, not delete.** It used to remove the key unconditionally, which
   * was right while this adapter was the only thing that ever wrote it. It no
   * longer is: `CodeExecutionMCP` keeps a PERSISTENT entry here for as long as
   * its HTTP server is up, so that `agy` sessions the USER starts have Ptah
   * tools too. An unconditional delete would silently revoke that every time a
   * Ptah-spawned agent finished.
   *
   * Restoring needs no knowledge of who the other writer is: `prior` is
   * whatever was in the file before this run. Absent means nobody owned the
   * key, and removing it is exactly the old behaviour.
   *
   * Removes or rewrites exactly `PTAH_SPAWN_MCP_KEY` and nothing else. An older
   * version also deleted the whole `mcpServers` map once it looked empty, which
   * was safe only while Ptah was its sole writer; now that a user's install can
   * live in that map, "empty" is a claim this code is not entitled to make.
   *
   * Non-fatal: the next spawn, and the next registration pass, both rewrite it.
   */
  private async cleanupMcpEntry(prior?: McpServerConfig): Promise<void> {
    try {
      const facet = AntigravityCliAdapter.mcpFacet();
      if (prior === undefined) {
        await facet.remove('', PTAH_SPAWN_MCP_KEY);
      } else {
        await facet.write('', PTAH_SPAWN_MCP_KEY, prior);
      }
    } catch {
      // Stale ptah entry will be overwritten on next configureMcpServer().
    }
  }

  /**
   * Run the task via `agy` print mode with `--output-format stream-json`.
   *
   * Spawns `agy` with the prompt as the value of the trailing `--print` flag,
   * buffers stdout by line, JSON.parses each line defensively, and dispatches
   * to structured `CliOutputSegment`s. The conversation id is captured from the
   * `init` event. stderr and non-zero exit surface as `error` segments.
   */
  async runSdk(options: CliCommandOptions): Promise<SdkHandle> {
    if (options.workingDirectory) {
      await this.ensureFolderTrusted(options.workingDirectory);
    }
    const spawnEnv: Record<string, string> = {};
    if (process.platform === 'win32') {
      spawnEnv['NODE_PTY_USE_CONPTY'] = '0';
    }

    // No GEMINI_SYSTEM_MD support in `agy`: fold systemPrompt/projectGuidance
    // into the task prompt via the shared builder.
    const taskPrompt = buildTaskPrompt(options, this.name);
    const abortController = new AbortController();
    let capturedSessionId: string | undefined;

    const binary = options.binaryPath ?? 'agy';
    const useStreamInput = await this.probeStreamJsonInput(binary);

    const args = buildAntigravityArgs(options, taskPrompt, useStreamInput);

    // `agy` ships as a real `.exe` under %LOCALAPPDATA%\agy\bin, which
    // resolveDirectSpawn returns unchanged; when it is instead an npm `.cmd`
    // shim, resolveDirectSpawn points spawn at the real node entrypoint/binary
    // so child.pid is the process taskkill /T should walk from (not the cmd.exe
    // shim). No-op off-Windows.
    const spawnDescriptor = await resolveDirectSpawn(binary);
    assertCommandLineWithinLimit(spawnDescriptor.command, [
      ...spawnDescriptor.prefixArgs,
      ...args,
    ]);

    // The `ptah` entry as this run found it. Held in a LOCAL, not a field:
    // two `agy` agents can be in flight at once and a shared slot would let
    // one run's cleanup restore the other run's snapshot.
    let priorMcpEntry: McpServerConfig | undefined;
    if (options.mcpPort) {
      priorMcpEntry = await this.configureMcpServer(
        options.mcpPort,
        options.workingDirectory,
        options.agentId,
      );
    }

    const output = createBufferedEmitter<string>();
    const segment = createBufferedEmitter<CliOutputSegment>();

    const child = spawnCli(
      spawnDescriptor.command,
      [...spawnDescriptor.prefixArgs, ...args],
      {
        cwd: options.workingDirectory,
        env: Object.keys(spawnEnv).length > 0 ? spawnEnv : undefined,
        needsConsole: true,
        detached: true,
        spawner: this.spawner,
      },
    );
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    let processClosed = false;
    let stdinClosed = false;
    let currentTurn = createTurnDeferred();
    const firstTurn = currentTurn;

    const emitAdapterError = (error: Error): void => {
      output.emit(`\n[Antigravity CLI Error] ${error.message}\n`);
      segment.emit({
        type: 'error',
        content: `Antigravity CLI Error: ${error.message}`,
      });
    };

    child.stdin?.on?.('error', (error: Error) => {
      stdinClosed = true;
      currentTurn.resolve(1);
      emitAdapterError(error);
    });

    const writeTurn = (message: string): void => {
      const parsed = AgyInputMessageSchema.safeParse({
        event: 'user',
        message: { content: message },
      });
      if (!parsed.success) {
        throw new Error(
          `Refusing to send an invalid Antigravity stream-json message: ${z.prettifyError(parsed.error)}`,
        );
      }
      if (processClosed || stdinClosed || !child.stdin) {
        throw new Error('Antigravity stdin is no longer writable');
      }
      child.stdin.write(`${JSON.stringify(parsed.data)}\n`);
    };

    if (useStreamInput) {
      writeTurn(taskPrompt);
    } else {
      // The fallback prompt is carried in argv and remains strictly one-shot.
      child.stdin?.end();
      stdinClosed = true;
    }

    const closeAfterSettledTurn = (settledTurn: TurnDeferred): void => {
      setImmediate(() => {
        if (
          !processClosed &&
          !stdinClosed &&
          currentTurn === settledTurn &&
          settledTurn.settled
        ) {
          child.stdin?.end();
          stdinClosed = true;
        }
      });
    };

    const onAbort = (): void => {
      // `pid` is known synchronously for an inline spawn and NOT for an
      // off-thread one, where the child is created on a worker. `whenSpawned`
      // is the one read that works for both; it settles to null if the child
      // never started, so this can never hang (TASK_2026_367).
      void child.whenSpawned.then((pid) => {
        if (pid && !child.killed) {
          // Tree-kill the whole process group — child.kill() alone orphans the
          // real `agy` process (and any shell subprocesses) when child is a shim.
          void killProcessTree(pid);
        }
      });
    };
    abortController.signal.addEventListener('abort', onAbort);

    const setSessionId = (id: string | undefined): void => {
      if (!capturedSessionId && id) {
        capturedSessionId = id;
      }
    };

    let lineBuf = '';
    child.stdout?.on('data', (data: string) => {
      lineBuf += stripAnsiCodes(data);
      const lines = lineBuf.split(/\r?\n/);
      lineBuf = lines.pop() ?? '';
      // A single stream-json line carries a whole tool output, so the cap is
      // sized like opencode's rather than the old plain-text 64KB.
      const LINE_BUF_CAP = 1024 * 1024;
      if (lineBuf.length > LINE_BUF_CAP) {
        output.emit(
          `[Antigravity CLI Warning] Line buffer exceeded ${LINE_BUF_CAP} bytes without a newline; resetting.\n`,
        );
        segment.emit({
          type: 'info',
          content: `Line buffer exceeded ${LINE_BUF_CAP} bytes without a newline; resetting.`,
        });
        lineBuf = '';
      }
      for (const line of lines) {
        this.handleLine(
          line,
          output.emit,
          segment.emit,
          setSessionId,
          useStreamInput
            ? (exitCode) => {
                const settledTurn = currentTurn;
                settledTurn.resolve(exitCode);
                closeAfterSettledTurn(settledTurn);
              }
            : undefined,
        );
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
      output.emit(`[stderr] ${cleaned}\n`);
      segment.emit({ type: classifyCliStderr(cleaned), content: cleaned });
    });

    const done = new Promise<number>((resolve) => {
      child.on('close', (code, signal) => {
        processClosed = true;
        abortController.signal.removeEventListener('abort', onAbort);
        if (lineBuf.trim()) {
          this.handleLine(
            lineBuf,
            output.emit,
            segment.emit,
            setSessionId,
            useStreamInput
              ? (turnCode) => currentTurn.resolve(turnCode)
              : undefined,
          );
          lineBuf = '';
        }
        const exitCode = code ?? (signal ? 1 : 0);
        if (useStreamInput) {
          currentTurn.resolve(exitCode);
        }
        if (exitCode !== 0 && !abortController.signal.aborted) {
          segment.emit({
            type: 'error',
            content: `Antigravity CLI exited with code ${exitCode}`,
          });
        }
        resolve(exitCode);
      });

      child.on('error', (err) => {
        processClosed = true;
        abortController.signal.removeEventListener('abort', onAbort);
        if (useStreamInput) {
          currentTurn.resolve(1);
        }
        emitAdapterError(err);
        resolve(1);
      });
    });

    if (options.mcpPort) {
      done.then(() => {
        this.cleanupMcpEntry(priorMcpEntry);
      });
    }

    return {
      abort: abortController,
      done: useStreamInput ? firstTurn.done : done,
      onOutput: output.subscribe,
      onSegment: segment.subscribe,
      getSessionId: () => capturedSessionId,
      getPid: () => child.pid,
      ...(useStreamInput
        ? {
            supportsContinuation: () => !processClosed && !stdinClosed,
            continue: async (message: string) => {
              if (!currentTurn.settled) {
                throw new Error(
                  'Antigravity is still processing the current turn',
                );
              }
              const previousTurn = currentTurn;
              const nextTurn = createTurnDeferred();
              currentTurn = nextTurn;
              try {
                writeTurn(message);
              } catch (error: unknown) {
                currentTurn = previousTurn;
                throw error;
              }
              return { done: nextTurn.done };
            },
          }
        : {}),
    };
  }

  /**
   * Parse one stream-json line and emit its raw text + structured segment(s).
   * A line that is not valid JSON falls back to being emitted verbatim as
   * `text` — `agy` prints banners and crash dumps outside the event stream.
   */
  private handleLine(
    line: string,
    emitOutput: (data: string) => void,
    emitSegment: (segment: CliOutputSegment) => void,
    setSessionId: (id: string | undefined) => void,
    settleTurn?: (exitCode: number) => void,
  ): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let value: unknown;
    try {
      value = JSON.parse(trimmed) as unknown;
    } catch {
      // degradation-audit: optional-capability - agy prints banners and crash
      // dumps outside the JSON event stream; a non-JSON line is emitted
      // verbatim as text instead of being treated as a parse failure, per the
      // doc comment on this method.
      emitOutput(trimmed + '\n');
      emitSegment({ type: 'text', content: trimmed });
      return;
    }

    const header = AgyEventHeaderSchema.safeParse(value);
    if (!header.success) {
      emitSegment({
        type: 'error',
        content: `Invalid Antigravity stream-json event: ${z.prettifyError(header.error)}`,
      });
      return;
    }

    switch (header.data.event) {
      case 'init':
        this.parseKnownEvent(
          AgyInitEventSchema,
          value,
          emitSegment,
          (event) => {
            setSessionId(event.conversation_id);
          },
        );
        break;
      case 'step_update':
        this.parseKnownEvent(
          AgyStepUpdateEventSchema,
          value,
          emitSegment,
          (event) => {
            setSessionId(event.step_update.conversation_id);
            this.handleStepUpdate(event.step_update, emitOutput, emitSegment);
          },
        );
        break;
      case 'result':
        if (
          !this.parseKnownEvent(
            AgyResultEventSchema,
            value,
            emitSegment,
            (event) => {
              setSessionId(event.result.conversation_id);
              this.handleResult(event.result, emitOutput, emitSegment);
              settleTurn?.(event.result.status === 'SUCCESS' ? 0 : 1);
            },
          )
        ) {
          settleTurn?.(1);
        }
        break;
      default:
        // Defensive fallback — surface unrecognized events rather than dropping.
        emitSegment({ type: 'info', content: trimmed });
        break;
    }
  }

  private parseKnownEvent<T>(
    schema: z.ZodType<T>,
    value: unknown,
    emitSegment: (segment: CliOutputSegment) => void,
    consume: (event: T) => void,
  ): boolean {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      emitSegment({
        type: 'error',
        content: `Invalid Antigravity stream-json event: ${z.prettifyError(parsed.error)}`,
      });
      return false;
    }
    consume(parsed.data);
    return true;
  }

  /**
   * Map a `step_update` to segments.
   *
   * - `tool` + `ACTIVE` → `tool-call` (parameters known, output not yet)
   * - `tool` + `DONE`   → `tool-result` (`tool_info.output` carries failure
   *   text inline; `agy` reports no separate error flag or exit code, so no
   *   `tool-result-error` / `command` segment is synthesized)
   * - `agent_response`  → `text` for each incremental `text_delta`
   * - everything else (`user_input`, `checkpoint`, `unknown`, …) is a
   *   structural marker and produces no segment.
   */
  private handleStepUpdate(
    step: AgyStepUpdate,
    emitOutput: (data: string) => void,
    emitSegment: (segment: CliOutputSegment) => void,
  ): void {
    if (step.step_type === 'tool') {
      const toolName = step.tool_name ?? step.tool_info?.name ?? 'tool';
      const toolCallId =
        step.step_index !== undefined ? String(step.step_index) : undefined;

      if (step.state === 'DONE') {
        emitSegment({
          type: 'tool-result',
          toolName,
          content: step.tool_info?.output ?? '',
          toolCallId,
        });
        return;
      }

      const parameters = step.tool_info?.parameters;
      emitOutput(`[Tool] ${toolName}\n`);
      emitSegment({
        type: 'tool-call',
        toolName,
        toolArgs: parameters ? JSON.stringify(parameters) : undefined,
        toolInput: parameters,
        content: '',
        toolCallId,
      });
      return;
    }

    if (step.step_type === 'agent_response' && step.text_delta) {
      emitOutput(step.text_delta);
      emitSegment({ type: 'text', content: step.text_delta });
    }

    if (
      step.step_type === 'agent_response' &&
      step.state === 'DONE' &&
      step.usage
    ) {
      const usageStr = formatUsage(step.usage);
      if (usageStr) {
        emitOutput(`\n[${usageStr}]\n`);
        emitSegment({
          type: 'info',
          content: usageStr,
          usage: {
            inputTokens: step.usage.input_tokens,
            outputTokens: step.usage.output_tokens,
            totalTokens: step.usage.total_tokens,
          },
        });
      }
    }
  }

  /**
   * Emit the terminal outcome. `result.response` repeats text already streamed
   * as deltas, so only a usage summary is emitted on success; a non-SUCCESS
   * status surfaces as an `error` segment carrying the response body.
   */
  private handleResult(
    result: AgyResult,
    emitOutput: (data: string) => void,
    emitSegment: (segment: CliOutputSegment) => void,
  ): void {
    if (result.status && result.status !== 'SUCCESS') {
      const message = result.response?.trim()
        ? `${result.status}: ${result.response.trim()}`
        : `Antigravity CLI finished with status ${result.status}`;
      emitOutput(`\n[Error] ${message}\n`);
      emitSegment({ type: 'error', content: message });
    }

    // result.usage and result.num_turns are cumulative across the whole
    // process. Per-turn usage is emitted from the DONE agent_response step so
    // a second result cannot double-count the first turn.
  }
}
