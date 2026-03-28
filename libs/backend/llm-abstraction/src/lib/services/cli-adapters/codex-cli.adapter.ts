/**
 * Codex CLI Adapter
 * TASK_2025_157: Headless Codex CLI agent integration
 * TASK_2025_158: SDK-based execution via @openai/codex-sdk
 * TASK_2025_177: Session resume, progressive streaming, MCP/web_search/todo_list,
 *               toolCallId, reasoning→thinking, listModels
 *
 * CLI fallback: codex --quiet "task description"
 * SDK path: Codex SDK thread.runStreamed() for in-process execution
 */
import { readFile, rename, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import axios from 'axios';
import type {
  CliDetectionResult,
  CliOutputSegment,
} from '@ptah-extension/shared';
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
import { resolveAndImportSdk } from './sdk-resolver';

/** Valid reasoning effort values for the Codex SDK. */
const CODEX_REASONING_EFFORTS = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const;
type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number];

/**
 * Minimal local types for the dynamically imported Codex SDK.
 * These mirror the actual SDK exports but avoid importing ESM at module level.
 */
interface CodexSdkModule {
  Codex: new (options?: {
    apiKey?: string;
    env?: Record<string, string>;
    config?: Record<string, unknown>;
    codexPathOverride?: string;
  }) => CodexClient;
}

interface CodexThreadOptions {
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
  model?: string;
  approvalPolicy?: 'never' | 'on-request' | 'on-failure';
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
  modelReasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
}

interface CodexClient {
  startThread(options?: CodexThreadOptions): CodexThread;
  resumeThread(threadId: string, options?: CodexThreadOptions): CodexThread;
}

interface CodexThread {
  runStreamed(
    input: string,
    turnOptions?: { signal?: AbortSignal },
  ): Promise<{ events: AsyncGenerator<CodexThreadEvent> }>;
}

/**
 * Union of SDK thread events we handle.
 * Matches the actual @openai/codex-sdk ThreadEvent type structure.
 */
type CodexThreadEvent =
  | { type: 'thread.started'; thread_id: string }
  | { type: 'turn.started' }
  | {
      type: 'turn.completed';
      usage: {
        input_tokens: number;
        cached_input_tokens: number;
        output_tokens: number;
      };
    }
  | { type: 'turn.failed'; error: { message: string } }
  | { type: 'item.started'; item: CodexThreadItem }
  | { type: 'item.updated'; item: CodexThreadItem }
  | { type: 'item.completed'; item: CodexThreadItem }
  | { type: 'error'; message: string };

type CodexThreadItem =
  | { type: 'agent_message'; id: string; text: string }
  | { type: 'reasoning'; id: string; text: string }
  | {
      type: 'command_execution';
      id: string;
      command: string;
      aggregated_output: string;
      status: string;
      exit_code?: number;
    }
  | {
      type: 'file_change';
      id: string;
      changes: Array<{ path: string; kind: string }>;
      status: string;
    }
  | {
      type: 'mcp_tool_call';
      id: string;
      server: string;
      tool: string;
      arguments?: string;
      result?: string;
      error?: string;
      status: string;
    }
  | { type: 'web_search'; id: string; query: string }
  | {
      type: 'todo_list';
      id: string;
      items: Array<{ text: string; completed: boolean }>;
    }
  | { type: 'error'; id: string; message: string };

/**
 * Cached successful import of the ESM-only Codex SDK.
 * Only successful imports are cached; failures are not stored
 * so that a transient failure does not permanently break the SDK path.
 */
let codexSdkModule: CodexSdkModule | null = null;

/**
 * Lazily import the ESM-only @openai/codex-sdk package.
 * Only caches successful imports so a failed import can be retried.
 *
 * The SDK is bundled with the extension via esbuild (TASK_2025_232).
 * resolveAndImportSdk() returns the bundled module via dynamic import().
 */
async function getCodexSdk(binaryPath?: string): Promise<CodexSdkModule> {
  if (codexSdkModule) {
    return codexSdkModule;
  }
  const mod = await resolveAndImportSdk<CodexSdkModule>(
    '@openai/codex-sdk',
    binaryPath,
  );
  codexSdkModule = mod;
  return mod;
}

/** Shape of ~/.codex/auth.json */
interface CodexAuthFile {
  auth_mode?: string;
  OPENAI_API_KEY?: string | null;
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    account_id?: string;
  };
  last_refresh?: string;
}

export class CodexCliAdapter implements CliAdapter {
  readonly name = 'codex' as const;
  readonly displayName = 'Codex CLI';

  async detect(): Promise<CliDetectionResult> {
    try {
      const binaryPath = await resolveCliPath('codex');
      if (!binaryPath) {
        return { cli: 'codex', installed: false, supportsSteer: false };
      }

      // Use cross-spawn (via spawnCli) for version detection to avoid
      // EINVAL when execFile encounters a Windows .cmd wrapper.
      let version: string | undefined;
      try {
        version = await new Promise<string | undefined>((resolve) => {
          let stdout = '';
          const child = spawnCli(binaryPath, ['--version'], {});

          const timer = setTimeout(() => {
            child.kill();
            resolve(undefined);
          }, 5000);

          child.stdout?.setEncoding('utf8');
          child.stdout?.on('data', (data: string) => {
            stdout += data;
          });
          child.on('close', () => {
            clearTimeout(timer);
            const trimmed = stdout.trim().split('\n')[0];
            resolve(trimmed || undefined);
          });
          child.on('error', () => {
            clearTimeout(timer);
            resolve(undefined);
          });
        });
      } catch {
        // Version check failed
      }

      return {
        cli: 'codex',
        installed: true,
        path: binaryPath,
        version,
        supportsSteer: false,
      };
    } catch {
      return {
        cli: 'codex',
        installed: false,
        supportsSteer: false,
      };
    }
  }

  buildCommand(options: CliCommandOptions): CliCommand {
    const taskPrompt = buildTaskPrompt(options);

    // Use `exec` subcommand for non-interactive mode
    // Flags: --full-auto (auto-approve + sandbox), --ephemeral (no session persistence)
    const args = ['exec', '--full-auto', '--ephemeral', taskPrompt];

    if (options.model) {
      args.push('--model', options.model);
    }

    return {
      binary: 'codex',
      args,
    };
  }

  supportsSteer(): boolean {
    return false;
  }

  parseOutput(raw: string): string {
    return stripAnsiCodes(raw);
  }

  /** Fallback curated list when the Codex models API is unreachable.
   *  Keep in sync with `codex -m` interactive model list. */
  /**
   * Codex-supported models matching the Codex CLI `/model` menu.
   * The chatgpt.com API returns a broader set (including non-Codex models),
   * so we use this curated list instead of the API response.
   */
  private static readonly SUPPORTED_MODELS: CliModelInfo[] = [
    { id: 'gpt-5.3-codex', name: 'GPT 5.3 Codex (current)' },
    { id: 'gpt-5.4', name: 'GPT 5.4' },
    { id: 'gpt-5.2-codex', name: 'GPT 5.2 Codex' },
    { id: 'gpt-5.2', name: 'GPT 5.2' },
    { id: 'gpt-5.1-codex-max', name: 'GPT 5.1 Codex Max' },
    { id: 'gpt-5.1-codex-mini', name: 'GPT 5.1 Codex Mini' },
  ];

  /** OAuth token refresh endpoint (same as Codex CLI uses) */
  private static readonly AUTH_PATH = join(homedir(), '.codex', 'auth.json');
  private static readonly REFRESH_URL = 'https://auth.openai.com/oauth/token';
  /** Max age (ms) before proactive refresh. OAuth tokens last ~1h; refresh at 50 min. */
  private static readonly TOKEN_MAX_AGE_MS = 50 * 60 * 1000;

  /** Guard against concurrent refresh attempts (single-use refresh tokens) */
  private refreshInFlight: Promise<string | null> | null = null;

  /**
   * List available models for Codex.
   * Returns the curated list of Codex-supported models (matching Codex CLI's /model menu)
   * rather than querying the API, which returns a broader set of non-Codex models.
   */
  async listModels(): Promise<CliModelInfo[]> {
    return CodexCliAdapter.SUPPORTED_MODELS;
  }

  /**
   * Resolve the OAuth access_token for Codex API calls.
   * Proactively refreshes if the token looks stale (last_refresh > 50 min ago).
   */
  private async resolveAccessToken(): Promise<string | null> {
    try {
      const raw = await readFile(CodexCliAdapter.AUTH_PATH, 'utf-8');
      const auth = JSON.parse(raw) as CodexAuthFile;

      // API key takes priority — never expires
      if (auth.OPENAI_API_KEY) return auth.OPENAI_API_KEY;
      if (!auth.tokens?.access_token) return null;

      // Proactively refresh if token looks stale
      if (auth.tokens.refresh_token && this.isTokenStale(auth.last_refresh)) {
        const refreshed = await this.refreshAccessToken(auth);
        if (refreshed) return refreshed;
      }

      return auth.tokens.access_token;
    } catch {
      // Auth file not found or unreadable
    }
    return null;
  }

  /** Check whether the stored token is likely expired based on last_refresh. */
  private isTokenStale(lastRefresh?: string): boolean {
    if (!lastRefresh) return true;
    try {
      const refreshTime = new Date(lastRefresh).getTime();
      if (isNaN(refreshTime)) return true;
      return Date.now() - refreshTime > CodexCliAdapter.TOKEN_MAX_AGE_MS;
    } catch {
      return true;
    }
  }

  /**
   * Refresh the OAuth access_token using the stored refresh_token.
   * POST https://auth.openai.com/oauth/token (same endpoint Codex CLI uses).
   * Guards against concurrent refresh (OpenAI uses single-use refresh tokens).
   * On success, writes updated tokens back to auth.json.
   */
  private async refreshAccessToken(
    auth: CodexAuthFile,
  ): Promise<string | null> {
    if (!auth.tokens?.refresh_token) return null;

    // Deduplicate concurrent refresh calls
    if (this.refreshInFlight) return this.refreshInFlight;

    this.refreshInFlight = this.doRefreshAccessToken(auth);
    try {
      return await this.refreshInFlight;
    } finally {
      this.refreshInFlight = null;
    }
  }

  private async doRefreshAccessToken(
    auth: CodexAuthFile,
  ): Promise<string | null> {
    try {
      const { data: body } = await axios.post<{
        access_token?: string;
        refresh_token?: string;
        id_token?: string;
        expires_in?: number;
      }>(
        CodexCliAdapter.REFRESH_URL,
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: auth.tokens!.refresh_token!,
          client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10_000,
        },
      );

      if (!body.access_token) return null;

      // Persist updated tokens to auth.json. Use write-to-temp-then-rename
      // for atomicity — prevents corruption if the process crashes mid-write
      // or the Codex CLI writes concurrently.
      const updated: CodexAuthFile = {
        ...auth,
        tokens: {
          ...auth.tokens!,
          access_token: body.access_token,
          ...(body.refresh_token && { refresh_token: body.refresh_token }),
          ...(body.id_token && { id_token: body.id_token }),
        },
        last_refresh: new Date().toISOString(),
      };

      const tmpPath = CodexCliAdapter.AUTH_PATH + '.tmp';
      try {
        await writeFile(tmpPath, JSON.stringify(updated, null, 2), 'utf-8');
        await rename(tmpPath, CodexCliAdapter.AUTH_PATH);
      } catch {
        // Write failed but we still have the fresh access_token in memory.
        // Return it so this session works; the stale refresh_token on disk
        // will be retried next time (OpenAI has a grace window for reuse).
      }

      return body.access_token;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        console.warn(
          `[CodexCliAdapter] Token refresh failed: HTTP ${error.response.status}`,
        );
      } else {
        console.warn(
          '[CodexCliAdapter] Token refresh failed:',
          error instanceof Error ? error.message : String(error),
        );
      }
      return null;
    }
  }

  /**
   * Public: Ensure the Codex OAuth token is fresh.
   * Called during extension startup (fire-and-forget) so that
   * listModels() hits the API with a valid token on first use.
   */
  async ensureTokensFresh(): Promise<boolean> {
    try {
      const raw = await readFile(CodexCliAdapter.AUTH_PATH, 'utf-8');
      const auth = JSON.parse(raw) as CodexAuthFile;

      if (auth.OPENAI_API_KEY) return true;
      if (!auth.tokens?.access_token || !auth.tokens.refresh_token)
        return false;

      if (this.isTokenStale(auth.last_refresh)) {
        const refreshed = await this.refreshAccessToken(auth);
        return refreshed !== null;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Run task via Codex SDK instead of CLI subprocess.
   *
   * Uses the @openai/codex-sdk to create a thread and stream events.
   * The SDK is ESM-only so we use a cached dynamic import().
   * Abort is achieved via AbortSignal passed to thread.runStreamed().
   *
   * TASK_2025_177: Supports session resume via resumeThread(), progressive
   * streaming via item.started/updated, toolCallId emission, and
   * reasoning→thinking mapping.
   */
  async runSdk(options: CliCommandOptions): Promise<SdkHandle> {
    const sdk = await getCodexSdk(options.binaryPath);

    // Pass MCP server config, env vars, and codexPathOverride through Codex SDK
    const codexOptions: {
      config?: Record<string, unknown>;
      codexPathOverride?: string;
      env?: Record<string, string>;
    } = {
      // Spread process.env to preserve PATH, API keys, etc.
      // The SDK does NOT inherit process.env when `env` is provided.
      env: {
        ...(process.env as Record<string, string>),
        FORCE_COLOR: '0',
        NO_COLOR: '1',
      },
    };
    // Build config: MCP servers + feature flags for skill/agent discovery
    const config: Record<string, unknown> = {
      features: {
        child_agents_md: true,
        multi_agent: true,
      },
    };
    if (options.mcpPort) {
      config['mcp_servers'] = {
        ptah: {
          url: `http://localhost:${options.mcpPort}`,
        },
      };
    }
    codexOptions.config = config;
    // Only set codexPathOverride for non-.cmd paths. On Windows, npm-installed
    // CLIs are .cmd wrappers that the SDK's internal spawn() cannot execute
    // (causes EINVAL). The SDK can resolve 'codex' from PATH on its own,
    // so we skip the override when the path is a .cmd file.
    if (
      options.binaryPath &&
      !options.binaryPath.toLowerCase().endsWith('.cmd')
    ) {
      codexOptions.codexPathOverride = options.binaryPath;
    }

    const codex = new sdk.Codex(codexOptions);

    // Thread options: always headless with full permissions.
    // Codex SDK has no runtime permission hooks (unlike Copilot), so
    // approvalPolicy + sandboxMode are set upfront and cannot be changed mid-session.
    const threadOptions: CodexThreadOptions = {
      workingDirectory: options.workingDirectory,
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
      skipGitRepoCheck: true,
    };
    if (options.model) {
      threadOptions.model = options.model;
    }
    if (
      options.reasoningEffort &&
      (CODEX_REASONING_EFFORTS as readonly string[]).includes(
        options.reasoningEffort,
      )
    ) {
      threadOptions.modelReasoningEffort =
        options.reasoningEffort as CodexReasoningEffort;
    }

    // Session resume or new thread
    const thread = options.resumeSessionId
      ? codex.resumeThread(options.resumeSessionId, threadOptions)
      : codex.startThread(threadOptions);

    // Codex SDK has no native system message channel (unlike Gemini's GEMINI_SYSTEM_MD
    // or Copilot's sessionConfig.systemMessage). The systemPrompt is intentionally
    // included in buildTaskPrompt() as the only way to inject system context.
    const taskPrompt = buildTaskPrompt(options);
    const abortController = new AbortController();

    // Captured thread ID for session resume
    let capturedThreadId: string | undefined;

    // Delta tracking: track last-seen text per item.id for progressive streaming
    const itemTextTracker = new Map<string, string>();
    // Track which item IDs have emitted deltas (skip full text on completion)
    const itemsWithDeltas = new Set<string>();

    // Output buffering: buffer output until callbacks are registered,
    // then flush buffered data and switch to direct delivery.
    const outputBuffer: string[] = [];
    const outputCallbacks: Array<(data: string) => void> = [];

    const onOutput = (callback: (data: string) => void): void => {
      outputCallbacks.push(callback);
      // Flush any buffered output to the newly registered callback
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

    // Structured segment buffering (same pattern as output)
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

    // Start streamed execution and iterate events
    const STARTUP_TIMEOUT_MS = 30_000;
    const done = (async (): Promise<number> => {
      try {
        // Startup timeout: catch cases where the Codex subprocess fails to
        // start or connect. The overall session timeout is handled by
        // AgentProcessManager separately.
        const streamedTurn = await Promise.race([
          thread.runStreamed(taskPrompt, {
            signal: abortController.signal,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error('Codex SDK startup timed out after 30s')),
              STARTUP_TIMEOUT_MS,
            ),
          ),
        ]);

        for await (const event of streamedTurn.events) {
          if (abortController.signal.aborted) {
            return 1;
          }

          // Capture thread ID from thread.started event
          if (event.type === 'thread.started') {
            capturedThreadId = event.thread_id;
          }

          this.handleStreamEvent(
            event,
            emitOutput,
            emitSegment,
            itemTextTracker,
            itemsWithDeltas,
          );
        }

        return 0;
      } catch (error: unknown) {
        // AbortError is expected when we cancel - treat as non-error exit
        if (
          error instanceof Error &&
          (error.name === 'AbortError' || abortController.signal.aborted)
        ) {
          return 1;
        }

        const errorMessage =
          error instanceof Error ? error.message : String(error);
        emitOutput(`\n[Codex SDK Error] ${errorMessage}\n`);
        emitSegment({
          type: 'error',
          content: `Codex SDK Error: ${errorMessage}`,
        });
        return 1;
      }
    })();

    return {
      abort: abortController,
      done,
      onOutput,
      onSegment,
      getSessionId: () => capturedThreadId,
      setAgentId: () => {
        // No-op: Codex SDK has no permission hooks that need agentId routing
      },
    };
  }

  /**
   * Process a single SDK stream event and emit relevant output + structured segments.
   *
   * TASK_2025_177: Handles item.started (early tool-call segments), item.updated
   * (progressive text/thinking deltas), and enhanced item.completed with toolCallId,
   * MCP tool calls, web_search, and todo_list.
   */
  private handleStreamEvent(
    event: CodexThreadEvent,
    emitOutput: (data: string) => void,
    emitSegment: (segment: CliOutputSegment) => void,
    itemTextTracker: Map<string, string>,
    itemsWithDeltas: Set<string>,
  ): void {
    switch (event.type) {
      case 'item.started': {
        const item = event.item;
        switch (item.type) {
          case 'command_execution':
            // Emit early tool-call for progressive rendering.
            // Use generic 'Shell' as toolName; full command goes in toolArgs.
            emitSegment({
              type: 'tool-call',
              toolName: 'Shell',
              toolArgs: item.command,
              content: '',
              toolCallId: item.id,
            });
            break;
          case 'mcp_tool_call':
            emitSegment({
              type: 'tool-call',
              toolName: `${item.server}:${item.tool}`,
              content: item.arguments ?? '',
              toolCallId: item.id,
            });
            break;
          default:
            break;
        }
        break;
      }

      case 'item.updated': {
        const item = event.item;
        switch (item.type) {
          case 'agent_message': {
            const previousText = itemTextTracker.get(item.id) ?? '';
            if (item.text.startsWith(previousText)) {
              // Normal append — emit only the new delta
              const delta = item.text.slice(previousText.length);
              if (delta) {
                emitOutput(delta);
                emitSegment({ type: 'text', content: delta });
                itemTextTracker.set(item.id, item.text);
                itemsWithDeltas.add(item.id);
              }
            } else {
              // Text was replaced (not appended) — emit full text as replacement
              emitOutput(item.text);
              emitSegment({ type: 'text', content: item.text });
              itemTextTracker.set(item.id, item.text);
              itemsWithDeltas.add(item.id);
            }
            break;
          }
          case 'reasoning': {
            const previousText = itemTextTracker.get(item.id) ?? '';
            if (item.text.startsWith(previousText)) {
              const delta = item.text.slice(previousText.length);
              if (delta) {
                emitOutput(delta);
                emitSegment({ type: 'thinking', content: delta });
                itemTextTracker.set(item.id, item.text);
                itemsWithDeltas.add(item.id);
              }
            } else {
              // Text was replaced — emit full text as replacement
              emitOutput(item.text);
              emitSegment({ type: 'thinking', content: item.text });
              itemTextTracker.set(item.id, item.text);
              itemsWithDeltas.add(item.id);
            }
            break;
          }
          default:
            break;
        }
        break;
      }

      case 'item.completed': {
        const item = event.item;
        switch (item.type) {
          case 'agent_message':
            // Skip full text emission if deltas were sent via item.updated
            if (!itemsWithDeltas.has(item.id)) {
              if (item.text) {
                emitOutput(item.text + '\n');
                emitSegment({ type: 'text', content: item.text });
              }
            }
            // Clean up trackers
            itemTextTracker.delete(item.id);
            itemsWithDeltas.delete(item.id);
            break;
          case 'reasoning':
            // Skip full text emission if deltas were sent via item.updated
            if (!itemsWithDeltas.has(item.id)) {
              if (item.text) {
                emitOutput(`[Thinking] ${item.text}\n`);
                emitSegment({ type: 'thinking', content: item.text });
              }
            }
            // Clean up trackers
            itemTextTracker.delete(item.id);
            itemsWithDeltas.delete(item.id);
            break;
          case 'command_execution': {
            emitOutput(`$ ${item.command}\n`);
            if (item.aggregated_output) {
              emitOutput(item.aggregated_output);
              if (!item.aggregated_output.endsWith('\n')) {
                emitOutput('\n');
              }
            }
            if (item.exit_code !== undefined && item.exit_code !== 0) {
              emitOutput(`[exit code: ${item.exit_code}]\n`);
            }
            emitSegment({
              type: 'command',
              content: item.aggregated_output ?? '',
              toolName: item.command,
              exitCode: item.exit_code,
              toolCallId: item.id,
            });
            break;
          }
          case 'file_change':
            for (const change of item.changes) {
              emitOutput(`[${change.kind}] ${change.path}\n`);
              emitSegment({
                type: 'file-change',
                content: change.path,
                changeKind: change.kind,
                toolCallId: item.id,
              });
            }
            break;
          case 'mcp_tool_call':
            if (item.error) {
              emitOutput(
                `[MCP Error] ${item.server}:${item.tool}: ${item.error}\n`,
              );
              emitSegment({
                type: 'tool-result-error',
                content: item.error,
                toolCallId: item.id,
              });
            } else if (item.result) {
              emitOutput(`[MCP Result] ${item.server}:${item.tool}\n`);
              emitSegment({
                type: 'tool-result',
                content: item.result,
                toolCallId: item.id,
              });
            } else {
              // Completed with neither result nor error (e.g., cancelled/timed out)
              emitOutput(
                `[MCP] ${item.server}:${item.tool} (${
                  item.status || 'completed'
                })\n`,
              );
              emitSegment({
                type: 'tool-result',
                content: `(${item.status || 'completed'})`,
                toolCallId: item.id,
              });
            }
            break;
          case 'web_search':
            emitOutput(`[Web Search] ${item.query}\n`);
            emitSegment({
              type: 'info',
              content: `Web search: ${item.query}`,
            });
            break;
          case 'todo_list': {
            const formatted = item.items
              .map((i) => `${i.completed ? '[x]' : '[ ]'} ${i.text}`)
              .join('\n');
            emitOutput(`[Todo List]\n${formatted}\n`);
            emitSegment({
              type: 'info',
              content: `Todo list:\n${formatted}`,
            });
            break;
          }
          case 'error':
            emitOutput(`[Error] ${item.message}\n`);
            emitSegment({ type: 'error', content: item.message });
            break;
          default:
            break;
        }
        break;
      }
      case 'turn.completed':
        if (event.usage) {
          const usageStr = `Usage: ${event.usage.input_tokens} input, ${event.usage.output_tokens} output tokens`;
          emitOutput(`\n[${usageStr}]\n`);
          emitSegment({ type: 'info', content: usageStr });
        }
        break;
      case 'turn.failed':
        emitOutput(`[Turn Failed] ${event.error.message}\n`);
        emitSegment({
          type: 'error',
          content: `Turn Failed: ${event.error.message}`,
        });
        break;
      case 'error':
        emitOutput(`[Stream Error] ${event.message}\n`);
        emitSegment({ type: 'error', content: event.message });
        break;
      default:
        // thread.started handled in runSdk() for thread ID capture
        break;
    }
  }
}
