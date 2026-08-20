/**
 * Cursor CLI Adapter
 *
 * Runs in-process via the official `@cursor/sdk` (Agent.create → send →
 * run.stream()) instead of spawning the `cursor-agent` binary. Mirrors the
 * CodexCliAdapter SDK pattern: cached dynamic ESM import, typed SDKMessage
 * event loop, AbortSignal → run.cancel().
 *
 * Auth: requires a Cursor API key. Resolved from CURSOR_API_KEY, falling back
 * to `provider.cursor.apiKey` in ~/.ptah/settings.json. Detection is gated on
 * key presence — without a key the adapter reports not-installed so Cursor
 * does not surface as an available CLI agent.
 *
 * MCP: configured inline via the SDK's `mcpServers` option (no .cursor/mcp.json
 * file writes). Session resume: Agent.resume(agentId).
 */
import { readFileSync } from 'fs';
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
  createBufferedEmitter,
} from './cli-adapter.utils';

/**
 * Minimal local types for the dynamically imported `@cursor/sdk` package.
 * These mirror the actual SDK exports (v1.0.13) but avoid importing the
 * ESM module at module-evaluation time.
 */
interface CursorModelSelection {
  id: string;
  params?: Array<{ id: string; value: string }>;
}

interface CursorMcpServerConfig {
  type?: 'http' | 'sse';
  url: string;
  headers?: Record<string, string>;
}

interface CursorAgentOptions {
  apiKey?: string;
  model?: CursorModelSelection;
  local?: { cwd?: string };
  mcpServers?: Record<string, CursorMcpServerConfig>;
}

interface CursorTextBlock {
  type: 'text';
  text: string;
}
interface CursorToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

/** SDKMessage union from @cursor/sdk (see dist/esm/messages.d.ts). */
type CursorSdkMessage =
  | {
      type: 'system';
      subtype?: 'init';
      model?: CursorModelSelection;
      tools?: string[];
    }
  | { type: 'user' }
  | {
      type: 'assistant';
      message: {
        role: 'assistant';
        content: Array<CursorTextBlock | CursorToolUseBlock>;
      };
    }
  | {
      type: 'tool_call';
      call_id: string;
      name: string;
      status: 'running' | 'completed' | 'error';
      args?: unknown;
      result?: unknown;
    }
  | { type: 'thinking'; text: string; thinking_duration_ms?: number }
  | {
      type: 'status';
      status:
        | 'CREATING'
        | 'RUNNING'
        | 'FINISHED'
        | 'ERROR'
        | 'CANCELLED'
        | 'EXPIRED';
      message?: string;
    }
  | { type: 'request'; request_id: string }
  | { type: 'task'; status?: string; text?: string };

interface CursorRun {
  readonly id: string;
  readonly agentId: string;
  stream(): AsyncGenerator<CursorSdkMessage, void>;
  cancel(): Promise<void>;
}

interface CursorSdkAgent {
  readonly agentId: string;
  send(message: string, options?: unknown): Promise<CursorRun>;
  close(): void;
}

interface CursorSdkModule {
  Agent: {
    create(options: CursorAgentOptions): Promise<CursorSdkAgent>;
    resume(
      agentId: string,
      options?: Partial<CursorAgentOptions>,
    ): Promise<CursorSdkAgent>;
  };
  Cursor: {
    models: {
      list(options?: {
        apiKey?: string;
      }): Promise<Array<{ id: string; displayName?: string }>>;
    };
  };
}

/**
 * Default Cursor model id used when the caller does not specify one.
 * Local agents require an explicit model selection.
 */
const DEFAULT_CURSOR_MODEL = 'composer-2.5';

/**
 * Cached successful import of the ESM-only @cursor/sdk package.
 * Only successful imports are cached so a transient failure can be retried.
 * The string literal in import() lets esbuild statically bundle the package.
 */
let cursorSdkModule: CursorSdkModule | null = null;

async function getCursorSdk(): Promise<CursorSdkModule> {
  if (cursorSdkModule) {
    return cursorSdkModule;
  }
  const mod = (await import('@cursor/sdk')) as unknown as CursorSdkModule;
  cursorSdkModule = mod;
  return mod;
}

/**
 * Resolve the Cursor API key.
 *
 * Order: CURSOR_API_KEY env var, then `provider.cursor.apiKey` in
 * ~/.ptah/settings.json. Resolved lazily (per call) so changes applied after
 * module load are honoured, mirroring CodexCliAdapter.getAuthPath().
 */
function resolveCursorApiKey(): string | undefined {
  const envKey = process.env['CURSOR_API_KEY'];
  if (envKey && envKey.trim()) {
    return envKey.trim();
  }
  try {
    const home = process.env['HOME'] || process.env['USERPROFILE'] || homedir();
    const settingsPath = join(home, '.ptah', 'settings.json');
    const raw = readFileSync(settingsPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const provider = parsed['provider'] as Record<string, unknown> | undefined;
    const cursor = provider?.['cursor'] as Record<string, unknown> | undefined;
    const key = cursor?.['apiKey'];
    return typeof key === 'string' && key.trim() ? key.trim() : undefined;
  } catch {
    return undefined;
  }
}

export class CursorCliAdapter implements CliAdapter {
  readonly name = 'cursor' as const;
  readonly displayName = 'Cursor';
  /** MCP is configured inline via the SDK's mcpServers option. */
  readonly supportsMcp = true;

  /**
   * Detect Cursor availability. The SDK is bundled, so availability is gated
   * on API key presence rather than a binary on PATH.
   */
  async detect(): Promise<CliDetectionResult> {
    const apiKey = resolveCursorApiKey();
    if (!apiKey) {
      return { cli: 'cursor', installed: false, supportsSteer: false };
    }
    return {
      cli: 'cursor',
      installed: true,
      version: 'sdk',
      supportsSteer: false,
    };
  }

  /**
   * Confirm a Cursor API key is available. Used by CliDetectionService at
   * startup to prime detection. Returns true when a key is resolvable.
   */
  async ensureTokensFresh(): Promise<boolean> {
    return resolveCursorApiKey() !== undefined;
  }

  supportsSteer(): boolean {
    return false;
  }

  parseOutput(raw: string): string {
    return stripAnsiCodes(raw);
  }

  /** Fallback model list when the Cursor models API is unreachable. */
  private static readonly FALLBACK_MODELS: CliModelInfo[] = [
    { id: 'composer-2.5', name: 'Composer 2.5' },
    { id: 'composer-2', name: 'Composer 2' },
  ];

  /**
   * List models available to the authenticated key via Cursor.models.list().
   * Falls back to a curated list when the API is unreachable or no key is set.
   */
  async listModels(): Promise<CliModelInfo[]> {
    const apiKey = resolveCursorApiKey();
    if (!apiKey) {
      return CursorCliAdapter.FALLBACK_MODELS;
    }
    try {
      const sdk = await getCursorSdk();
      const models = await sdk.Cursor.models.list({ apiKey });
      const mapped = models
        .filter((m) => typeof m.id === 'string' && m.id.length > 0)
        .map((m) => ({ id: m.id, name: m.displayName ?? m.id }));
      return mapped.length > 0 ? mapped : CursorCliAdapter.FALLBACK_MODELS;
    } catch {
      return CursorCliAdapter.FALLBACK_MODELS;
    }
  }

  /**
   * Run task via the Cursor SDK.
   *
   * Creates (or resumes) a local agent, sends the prompt, and iterates the
   * run's typed SDKMessage stream. Abort cancels the in-flight run.
   */
  async runSdk(options: CliCommandOptions): Promise<SdkHandle> {
    const taskPrompt = buildTaskPrompt(options);
    const abortController = new AbortController();
    let capturedAgentId: string | undefined;
    let activeRun: CursorRun | undefined;
    let agent: CursorSdkAgent | undefined;

    const output = createBufferedEmitter<string>();
    const segment = createBufferedEmitter<CliOutputSegment>();

    const onAbort = (): void => {
      if (activeRun) {
        void activeRun.cancel().catch(() => {
          /* non-fatal */
        });
      }
      if (agent) {
        agent.close();
      }
    };
    abortController.signal.addEventListener('abort', onAbort);

    const runTurn = async (prompt: string): Promise<number> => {
      const apiKey = resolveCursorApiKey();
      if (!apiKey) {
        const msg =
          'Cursor API key not found. Set CURSOR_API_KEY or provider.cursor.apiKey in ~/.ptah/settings.json.';
        output.emit(`\n[Cursor SDK Error] ${msg}\n`);
        segment.emit({ type: 'error', content: msg });
        return 1;
      }

      try {
        if (!agent) {
          const sdk = await getCursorSdk();
          const agentOptions: CursorAgentOptions = {
            apiKey,
            model: { id: options.model ?? DEFAULT_CURSOR_MODEL },
            local: { cwd: options.workingDirectory },
          };
          if (options.mcpPort) {
            agentOptions.mcpServers = {
              ptah: {
                type: 'http',
                url: `http://localhost:${options.mcpPort}`,
              },
            };
          }

          agent = options.resumeSessionId
            ? await sdk.Agent.resume(options.resumeSessionId, agentOptions)
            : await sdk.Agent.create(agentOptions);
          capturedAgentId = agent.agentId;
        }

        if (abortController.signal.aborted) {
          return 1;
        }

        const run = await agent.send(prompt);
        activeRun = run;

        const textTracker = { last: '' };
        const seenToolCalls = new Set<string>();

        for await (const message of run.stream()) {
          if (abortController.signal.aborted) {
            return 1;
          }
          this.handleMessage(
            message,
            output.emit,
            segment.emit,
            textTracker,
            seenToolCalls,
          );
        }

        return abortController.signal.aborted ? 1 : 0;
      } catch (error: unknown) {
        if (abortController.signal.aborted) {
          return 1;
        }
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        output.emit(`\n[Cursor SDK Error] ${errorMessage}\n`);
        segment.emit({
          type: 'error',
          content: `Cursor SDK Error: ${errorMessage}`,
        });
        return 1;
      }
    };

    const done = runTurn(taskPrompt);

    return {
      abort: abortController,
      done,
      onOutput: output.subscribe,
      onSegment: segment.subscribe,
      getSessionId: () => capturedAgentId,
      setAgentId: () => {},
      supportsContinuation: () => true,
      continue: (message: string): Promise<ContinuationOutcome> =>
        Promise.resolve({ done: runTurn(message) }),
    };
  }

  /**
   * Process a single Cursor SDKMessage and emit readable output + structured
   * segments. Tool calls are deduplicated by call_id so a tool surfaced both
   * as an assistant tool_use block and a tool_call event renders once.
   */
  private handleMessage(
    message: CursorSdkMessage,
    emitOutput: (data: string) => void,
    emitSegment: (segment: CliOutputSegment) => void,
    textTracker: { last: string },
    seenToolCalls: Set<string>,
  ): void {
    switch (message.type) {
      case 'system': {
        if (message.model?.id) {
          emitOutput(`[Model: ${message.model.id}]\n`);
          emitSegment({ type: 'info', content: `Model: ${message.model.id}` });
        }
        break;
      }

      case 'assistant': {
        for (const block of message.message.content) {
          if (block.type === 'text') {
            this.emitTextDelta(
              block.text,
              emitOutput,
              emitSegment,
              textTracker,
            );
          } else if (
            block.type === 'tool_use' &&
            !seenToolCalls.has(block.id)
          ) {
            seenToolCalls.add(block.id);
            this.emitToolCall(
              block.id,
              block.name,
              block.input,
              emitOutput,
              emitSegment,
            );
          }
        }
        break;
      }

      case 'tool_call': {
        if (message.status === 'running') {
          if (!seenToolCalls.has(message.call_id)) {
            seenToolCalls.add(message.call_id);
            this.emitToolCall(
              message.call_id,
              message.name,
              message.args,
              emitOutput,
              emitSegment,
            );
          }
        } else if (
          message.status === 'completed' ||
          message.status === 'error'
        ) {
          const output = this.stringifyResult(message.result);
          const truncated =
            output.length > 2000
              ? output.substring(0, 2000) + '\n... [truncated]'
              : output;
          if (truncated) {
            emitOutput(
              `\n<details><summary>Tool result</summary>\n\n\`\`\`\n${truncated}\n\`\`\`\n</details>\n\n`,
            );
          }
          emitSegment({
            type:
              message.status === 'error' ? 'tool-result-error' : 'tool-result',
            content: truncated,
            toolCallId: message.call_id,
          });
        }
        break;
      }

      case 'thinking': {
        if (message.text) {
          emitSegment({ type: 'info', content: `[thinking] ${message.text}` });
        }
        break;
      }

      case 'status': {
        if (message.status === 'ERROR') {
          const msg = message.message ?? 'Agent run errored';
          emitOutput(`\n**Error:** ${msg}\n`);
          emitSegment({ type: 'error', content: msg });
        } else if (message.message) {
          emitSegment({ type: 'info', content: message.message });
        }
        break;
      }

      case 'task': {
        if (message.text) {
          emitSegment({ type: 'info', content: message.text });
        }
        break;
      }

      case 'request': {
        emitSegment({
          type: 'info',
          content: 'Agent requested input (not available in headless mode)',
        });
        break;
      }

      default:
        break;
    }
  }

  /**
   * Emit only the newly-appended portion of streamed assistant text. Falls
   * back to emitting the full text when it is not a continuation of the
   * previously-emitted buffer (a new assistant message).
   */
  private emitTextDelta(
    text: string,
    emitOutput: (data: string) => void,
    emitSegment: (segment: CliOutputSegment) => void,
    textTracker: { last: string },
  ): void {
    if (text.startsWith(textTracker.last)) {
      const delta = text.slice(textTracker.last.length);
      if (delta) {
        emitOutput(delta);
        emitSegment({ type: 'text', content: delta });
      }
    } else {
      emitOutput(text);
      emitSegment({ type: 'text', content: text });
    }
    textTracker.last = text;
  }

  /** Emit a tool-call segment with a summarized argument preview. */
  private emitToolCall(
    callId: string,
    name: string,
    input: unknown,
    emitOutput: (data: string) => void,
    emitSegment: (segment: CliOutputSegment) => void,
  ): void {
    const inputObj =
      input && typeof input === 'object'
        ? (input as Record<string, unknown>)
        : undefined;
    const summary = inputObj ? this.summarizeToolInput(name, inputObj) : '';
    emitOutput(`\n**Tool:** \`${name}\`${summary ? ` ${summary}` : ''}\n`);
    emitSegment({
      type: 'tool-call',
      content: '',
      toolName: name,
      toolArgs: summary || undefined,
      toolInput: inputObj,
      toolCallId: callId,
    });
  }

  /** Coerce a tool result of unknown shape into a display string. */
  private stringifyResult(result: unknown): string {
    if (result === undefined || result === null) return '';
    if (typeof result === 'string') return result;
    try {
      return JSON.stringify(result, null, 2);
    } catch {
      return String(result);
    }
  }

  /**
   * Summarize tool input for concise display.
   * Shows key details without dumping full JSON.
   */
  private summarizeToolInput(
    toolName: string,
    input: Record<string, unknown>,
  ): string {
    switch (toolName) {
      case 'read_file':
      case 'write_file':
        return input['path'] ? `\`${input['path']}\`` : '';
      case 'run_terminal_command':
      case 'run_shell_command':
        return input['command'] ? `\`${input['command']}\`` : '';
      case 'search_files':
      case 'search_file_content':
        return input['pattern'] ? `pattern: "${input['pattern']}"` : '';
      case 'list_directory':
        return input['path'] ? `\`${input['path']}\`` : '';
      case 'web_fetch':
        return input['url'] ? `${input['url']}` : '';
      default: {
        const firstStr = Object.entries(input).find(
          ([, v]) => typeof v === 'string',
        );
        return firstStr
          ? `${firstStr[0]}: "${String(firstStr[1]).substring(0, 60)}"`
          : '';
      }
    }
  }
}
