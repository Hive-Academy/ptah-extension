/**
 * Antigravity CLI Adapter (`agy`)
 *
 * Spawn-based, structured-JSONL adapter for Google's Antigravity CLI. As of
 * `agy` v1.1.11 print mode supports `--output-format stream-json`, which emits
 * one JSON object per line, so segment parsing here is an event loop like the
 * opencode / Codex adapters — not the old plain-text heuristic classifier.
 *
 * Non-interactive run:  agy --dangerously-skip-permissions
 *                           --output-format stream-json --model <label>
 *                           --add-dir <cwd> --print "<prompt>"
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
 * - `--print` (alias `--prompt`/`-p`) is a STRING flag whose value is the
 *   prompt; Go's flag parser consumes the following argv element, so it is
 *   always passed LAST with the prompt as a single argv item.
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
  createBufferedEmitter,
} from './cli-adapter.utils';

/**
 * Print-mode wait timeout. `agy` defaults to 5m, which kills most real coding
 * tasks; align it with AgentProcessManager's 1h execution cap so the manager
 * owns the timeout rather than the CLI.
 */
const PRINT_TIMEOUT = '3600s';

/** Values `agy --effort` accepts. Anything else is dropped. */
const AGY_EFFORTS = ['low', 'medium', 'high'] as const;

/** Token/cost accounting attached to `agent_response` / `checkpoint` / `result`. */
interface AgyUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly thinking_tokens?: number;
  readonly cache_read_tokens?: number;
  readonly total_tokens?: number;
}

/** Tool invocation detail. `output` is present only on the `DONE` update. */
interface AgyToolInfo {
  readonly name?: string;
  readonly parameters?: Record<string, unknown>;
  readonly output?: string;
}

/** Payload of a `step_update` event. */
interface AgyStepUpdate {
  readonly conversation_id?: string;
  readonly step_index?: number;
  readonly state?: string;
  readonly step_type?: string;
  readonly tool_name?: string;
  readonly tool_info?: AgyToolInfo;
  readonly text_delta?: string;
  readonly duration_seconds?: number;
  readonly usage?: AgyUsage;
}

/** Payload of the terminal `result` event. */
interface AgyResult {
  readonly conversation_id?: string;
  readonly status?: string;
  readonly response?: string;
  readonly duration_seconds?: number;
  readonly num_turns?: number;
  readonly usage?: AgyUsage;
}

/** A single line of `agy --output-format stream-json` output. */
interface AgyEvent {
  readonly event?: string;
  /** Present at the TOP level of the `init` event (not nested under `init`). */
  readonly conversation_id?: string;
  readonly init?: {
    readonly cwd?: string;
    readonly tools?: readonly string[];
    readonly permission_mode?: string;
  };
  readonly step_update?: AgyStepUpdate;
  readonly result?: AgyResult;
}

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
        { type: 'sse', url: `http://localhost:${port}` },
      );
      return prior;
    } catch {
      // MCP tools won't be available this run; CLI still functions.
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
    // The `ptah` entry as this run found it. Held in a LOCAL, not a field:
    // two `agy` agents can be in flight at once and a shared slot would let
    // one run's cleanup restore the other run's snapshot.
    let priorMcpEntry: McpServerConfig | undefined;
    if (options.mcpPort) {
      priorMcpEntry = await this.configureMcpServer(options.mcpPort);
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

    const args: string[] = ['--output-format', 'stream-json'];
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
    // `--print` is a string flag whose value is the prompt; keep it LAST so the
    // Go flag parser consumes the prompt (and nothing else) as its value.
    args.push('--print', taskPrompt);

    const output = createBufferedEmitter<string>();
    const segment = createBufferedEmitter<CliOutputSegment>();

    const binary = options.binaryPath ?? 'agy';
    // `agy` ships as a real `.exe` under %LOCALAPPDATA%\agy\bin, which
    // resolveDirectSpawn returns unchanged; when it is instead an npm `.cmd`
    // shim, resolveDirectSpawn points spawn at the real node entrypoint/binary
    // so child.pid is the process taskkill /T should walk from (not the cmd.exe
    // shim). No-op off-Windows.
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
        this.handleLine(line, output.emit, segment.emit, setSessionId);
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
      const isError =
        /\b(error|fail(ed)?|exception|denied|unauthorized|refused|timeout|abort|crash|panic|fatal)\b/i.test(
          cleaned,
        );
      segment.emit({ type: isError ? 'error' : 'info', content: cleaned });
    });

    const done = new Promise<number>((resolve) => {
      child.on('close', (code, signal) => {
        abortController.signal.removeEventListener('abort', onAbort);
        if (lineBuf.trim()) {
          this.handleLine(lineBuf, output.emit, segment.emit, setSessionId);
          lineBuf = '';
        }
        const exitCode = code ?? (signal ? 1 : 0);
        if (exitCode !== 0 && !abortController.signal.aborted) {
          segment.emit({
            type: 'error',
            content: `Antigravity CLI exited with code ${exitCode}`,
          });
        }
        resolve(exitCode);
      });

      child.on('error', (err) => {
        abortController.signal.removeEventListener('abort', onAbort);
        output.emit(`\n[Antigravity CLI Error] ${err.message}\n`);
        segment.emit({
          type: 'error',
          content: `Antigravity CLI Error: ${err.message}`,
        });
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
      done,
      onOutput: output.subscribe,
      onSegment: segment.subscribe,
      getSessionId: () => capturedSessionId,
      getPid: () => child.pid,
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
  ): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let event: AgyEvent;
    try {
      event = JSON.parse(trimmed) as AgyEvent;
    } catch {
      emitOutput(trimmed + '\n');
      emitSegment({ type: 'text', content: trimmed });
      return;
    }

    switch (event.event) {
      case 'init':
        // Carries the conversation id; nothing user-facing to render.
        setSessionId(event.conversation_id);
        break;
      case 'step_update':
        if (event.step_update) {
          setSessionId(event.step_update.conversation_id);
          this.handleStepUpdate(event.step_update, emitOutput, emitSegment);
        }
        break;
      case 'result':
        if (event.result) {
          setSessionId(event.result.conversation_id);
          this.handleResult(event.result, emitOutput, emitSegment);
        }
        break;
      default:
        // Defensive fallback — surface unrecognized events rather than dropping.
        emitSegment({ type: 'info', content: trimmed });
        break;
    }
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
      return;
    }

    const usage = result.usage;
    if (!usage) return;
    const usageStr = `Usage: ${usage.input_tokens ?? 0} input, ${
      usage.output_tokens ?? 0
    } output tokens`;
    emitOutput(`\n[${usageStr}]\n`);
    emitSegment({ type: 'info', content: usageStr });
  }
}
