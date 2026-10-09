/**
 * Codex CLI Adapter
 *               toolCallId, reasoning→thinking, listModels
 *
 * CLI fallback: codex --quiet "task description"
 * SDK path: Codex SDK thread.runStreamed() for in-process execution
 *
 * Path B (native Codex adapter, Codex owns the loop); see
 * `.ptah/specs/TASK_2026_408/ownership.md` for how it differs from the
 * translation proxy and the CLI workspace proxy. Main limit: no mid-turn steer
 * or interrupt, and `listModels` returns the curated static list below.
 */
import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import type {
  CliDetectionResult,
  CliOutputSegment,
} from '@ptah-extension/shared';
import { isCodexAccessTokenStale } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  AgentMessagingCapabilities,
  CliAdapter,
  CliCommandOptions,
  CliModelInfo,
  ContinuationOutcome,
  SdkHandle,
} from './cli-adapter.interface';
import { bestMessagingCapability } from './cli-adapter.interface';
import type { ResumeDeliveredPreambles } from './cli-adapter.utils';
import {
  assertCommandLineWithinLimit,
  stripAnsiCodes,
  buildTaskPrompt,
  fullPromptPreambles,
  probeCliVersion,
  resolveCliPath,
  createBufferedEmitter,
  renderRoleBlock,
} from './cli-adapter.utils';
import { summarizeCliSdkError } from './sdk-error-summary';
import {
  codexRejectionNamesUserServer,
  codexStderrExcerpt,
  essentialCodexConfigEntries,
  sdkConfigRejectionStderr,
} from './codex/codex-config-rejection';
import { codexExecArgs } from './codex/codex-exec-args';
import { resolveCodexLaneBudgets } from './codex/codex-lane-budgets';
import {
  buildCodexLaneConfig,
  type CodexLaneConfigVariant,
} from './codex/codex-lane-config.builder';
import {
  codexModelRejectionMessage,
  codexTextExcerpt,
} from './codex/codex-model-rejection';
import { resolveCodexNativeBinaryInfo } from './codex/codex-native-binary';
import {
  parseCodexModelCatalog,
  probeCodexModelCatalog,
} from './codex/codex-model-catalog';
import { readCodexUserMcpServerNames } from './codex/codex-user-mcp-servers';

/** Valid reasoning effort values for the Codex SDK. */
const CODEX_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const;
/**
 * Minimal local types for the dynamically imported Codex SDK.
 * These mirror the actual SDK exports but avoid importing ESM at module level.
 */
interface CodexSdkModule {
  Codex: new (options?: {
    env?: Record<string, string>;
    /** Raw `--config key=value` entries, passed to `codex exec` unchanged. */
    configOverrides?: string[];
    codexPathOverride?: string;
  }) => CodexClient;
}

/**
 * Only the four options that are not config keys. Web search, approval policy
 * and reasoning effort travel as `configOverrides`: the SDK emits thread
 * options AFTER the overrides, so a thread option would silently win over the
 * lane config (review N-A).
 */
interface CodexThreadOptions {
  workingDirectory: string;
  skipGitRepoCheck: true;
  model?: string;
  sandboxMode: 'danger-full-access';
}

/** Longest the distinct-warning memory of one adapter instance grows. */
const MAX_REMEMBERED_LANE_WARNINGS = 256;

/** A turn attempt Codex refused for its config before any event. */
const CONFIG_REJECTED: unique symbol = Symbol('codex-config-rejected');

/** Info segment for a lane that fell back to the essential config keys. */
const CONFIG_REJECTED_NOTICE =
  'Codex rejected the lane config; this run drops the lane budget and prefix keys, so Codex defaults and the full Codex prefix apply';

/** Added to the notice when the retry has to drop the user-server entry. */
const USER_SERVERS_ON_NOTICE =
  'Codex named one of your MCP servers as the cause, so your own MCP servers are enabled for this lane';

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
      // The SDK types all three as structures, not strings:
      // `arguments: unknown`, `result?: { content: ContentBlock[] }`,
      // `error?: { message: string }`. Declaring them `string` here is how an
      // MCP result reached the UI as `[object Object]`.
      arguments?: unknown;
      result?: unknown;
      error?: unknown;
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
 * The SDK is bundled with the extension via esbuild.
 * Uses a string literal in import() so esbuild can statically resolve
 * and bundle the package at build time.
 */
async function getCodexSdk(): Promise<CodexSdkModule> {
  if (codexSdkModule) {
    return codexSdkModule;
  }
  const mod = (await import('@openai/codex-sdk')) as unknown as CodexSdkModule;
  codexSdkModule = mod;
  return mod;
}

/**
 * Shell wrappers Codex puts in front of the command it actually wants to run.
 * Windows is the reason this exists: every command arrives as
 * `C:\...\powershell.exe -Command "<real command>"`, so the first token of the
 * raw string is the host shell for the whole session and says nothing about
 * the step.
 */
const SHELL_WRAPPER_PATTERN =
  /^["']?[^\s"']*(?:powershell|pwsh|cmd|bash|zsh|sh)(?:\.exe)?["']?\s+(?:-Command|-lc|-c|\/[cC])\s+/i;

/**
 * Label for a `command_execution` chip.
 *
 * Returns the program the step runs (`rg`, `git`, `Get-Content`), not the
 * shell that hosts it. Labelling every step `Shell` made a mixed run of
 * searches, reads and builds render as one repeated chip, which is what made
 * Codex look like it had no tools but the shell.
 */
export function commandToolLabel(command: string): string {
  const program = stripShellWrapper(command).split(/[\s;|&]/)[0];
  return program || 'Shell';
}

/**
 * The command Codex actually wanted to run, without the host shell around it.
 *
 * The wrapper is the same 60 characters on every step, so it pushes the real
 * command out of the visible width of every chip that shows it.
 */
export function stripShellWrapper(command: string): string {
  const inner = command.replace(SHELL_WRAPPER_PATTERN, '').trim();
  const quote = inner[0];
  if ((quote === '"' || quote === "'") && inner.endsWith(quote)) {
    return inner.slice(1, -1).trim();
  }
  return inner;
}

/** Tool name for a patched file, chosen so the UI renders the card it already has. */
function fileChangeToolName(kind: string): string {
  if (kind === 'add') return 'Write';
  if (kind === 'delete') return 'Delete';
  return 'Edit';
}

/**
 * MCP arguments as a structured object.
 *
 * The SDK types this `unknown` and older builds send a JSON string. Anything
 * that does not resolve to an object is kept as a summary line, so a call still
 * shows its arguments instead of showing nothing.
 */
function mcpToolInput(args: unknown): Record<string, unknown> | undefined {
  if (args === undefined || args === null) return undefined;
  const parsed = typeof args === 'string' ? tryParseJson(args) : args;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return { __summary: typeof args === 'string' ? args : JSON.stringify(args) };
}

/**
 * Readable text for an MCP result or error.
 *
 * A result is `{ content: ContentBlock[] }` and an error is `{ message }`.
 * Both used to be interpolated straight into a template, which put
 * `[object Object]` in the transcript for every MCP call Codex made.
 */
export function mcpResultText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return String(value);

  const record = value as Record<string, unknown>;
  if (typeof record['message'] === 'string') return record['message'];

  const blocks = record['content'];
  if (Array.isArray(blocks)) {
    const text = blocks
      .map((block) =>
        block && typeof block === 'object' && 'text' in block
          ? String((block as { text: unknown }).text)
          : '',
      )
      .filter(Boolean)
      .join('\n');
    if (text) return text;
  }
  return JSON.stringify(value);
}

function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // degradation-audit: optional-capability - used only to render MCP tool
    // arguments for display (see `mcpToolInput`); a non-JSON string falls back
    // to being shown as a raw summary line instead of a parsed object.
    return undefined;
  }
}

/** Shape of ~/.codex/auth.json (both snake_case and SCREAMING_CASE variants exist across CLI versions) */
interface CodexAuthFile {
  auth_mode?: 'ApiKey' | 'Chatgpt' | 'ChatgptAuthTokens' | string;
  openai_api_key?: string | null;
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
  readonly roleChannel = 'developer-instructions' as const;

  /**
   * @param logger - Optional; when supplied it receives the FULL SDK rejection
   *   text, which the stream deliberately no longer carries.
   */
  constructor(private readonly logger?: Logger) {}

  async detect(): Promise<CliDetectionResult> {
    try {
      const binaryPath = await resolveCliPath('codex');
      if (!binaryPath) {
        return {
          cli: 'codex',
          installed: false,
          messagingMode: bestMessagingCapability(this.capabilities()),
        };
      }
      const version = await probeCliVersion(binaryPath);

      return {
        cli: 'codex',
        installed: true,
        path: binaryPath,
        version,
        messagingMode: bestMessagingCapability(this.capabilities()),
      };
    } catch {
      return {
        cli: 'codex',
        installed: false,
        messagingMode: bestMessagingCapability(this.capabilities()),
      };
    }
  }

  /**
   * The installed `@openai/codex-sdk` Thread API exposes no mid-turn steer and
   * no run-scoped interrupt; `continue` on the handle resumes the same thread,
   * so a message is delivered as the next full turn.
   */
  capabilities(): AgentMessagingCapabilities {
    return { steer: false, interrupt: false, continuation: true };
  }

  parseOutput(raw: string): string {
    return stripAnsiCodes(raw);
  }

  /**
   * `gpt-6-sol` is Ptah's lane default when neither
   * `agentOrchestration.codexModel` nor the spawn names a model
   * (TASK_2026_597, D3); its entry carries that note in any list.
   */
  private static readonly LANE_DEFAULT_MODEL = 'gpt-6-sol';

  /**
   * Fallback only, for when `codex debug models` cannot be read: the listed
   * catalog of 2026-10-07 in menu order. The live catalog is the source.
   */
  private static readonly FALLBACK_MODELS: CliModelInfo[] = [
    { id: 'gpt-6.1-sol', name: 'GPT-6.1-Sol' },
    { id: 'gpt-6-astra', name: 'GPT-6-Astra' },
    { id: 'gpt-6-sol', name: 'GPT-6-Sol' },
    { id: 'gpt-6-luna', name: 'GPT-6-Luna' },
    { id: 'gpt-5.6-sol', name: 'GPT-5.6-Sol' },
    { id: 'gpt-5.6-terra', name: 'GPT-5.6-Terra' },
    { id: 'gpt-5.6-luna', name: 'GPT-5.6-Luna' },
  ];

  /**
   * Lane warnings already logged by this instance, so a condition that holds
   * on every spawn (a deleted working directory, an odd user config) is logged
   * once, not per spawn. Bounded: past the cap, warnings are logged again.
   */
  private readonly loggedLaneWarnings = new Set<string>();

  /**
   * One model-list load reads the catalog twice (`listModels` through
   * detection, then the model-list service directly), and each probe can wait
   * up to 8 seconds. Keyed by binary path so a moved install is read again;
   * the short TTL bounds how long an in-place upgrade shows the old list.
   */
  private catalogProbe: {
    readonly binaryPath: string;
    readonly at: number;
    readonly output: Promise<string | undefined>;
  } | null = null;
  private static readonly CATALOG_TTL_MS = 30_000;

  /**
   * Path to the Codex auth file.
   *
   * Resolved lazily (per call) so:
   *  (a) `$HOME` / `$USERPROFILE` overrides applied AFTER module load (e.g.
   *      sandbox/test setups that reassign HOME) are honoured, and
   *  (b) we prefer the env var on platforms where `os.homedir()` ignores
   *      `$HOME` overrides.
   *
   * Mirrors the env-preservation pattern in `build-safe-env.ts`.
   */
  private static getAuthPath(): string {
    const home = process.env['HOME'] || process.env['USERPROFILE'] || homedir();
    return join(home, '.codex', 'auth.json');
  }

  /**
   * The models the installed `codex` can run, from its own catalog
   * (`codex debug models`, see codex-model-catalog.ts), with the fallback list
   * when the catalog cannot be read.
   */
  async listModels(): Promise<CliModelInfo[]> {
    const live = await this.listCatalogModels();
    if (live.length > 0) return live;
    this.logger?.debug(
      '[CodexCliAdapter] codex debug models unavailable; using the fallback model list',
    );
    return CodexCliAdapter.FALLBACK_MODELS.map((model) =>
      this.markLaneDefault(model),
    );
  }

  /**
   * Only the installed CLI's own catalog, `[]` when it cannot be read. The
   * lane runs this binary, so a model newer than it accepts must not be
   * offered even when the account's list has it.
   */
  async listCatalogModels(): Promise<CliModelInfo[]> {
    const binaryPath = (await resolveCliPath('codex')) ?? 'codex';
    const raw = await this.probeCatalog(binaryPath);
    return (raw ? parseCodexModelCatalog(raw) : []).map((model) =>
      this.markLaneDefault(model),
    );
  }

  private probeCatalog(binaryPath: string): Promise<string | undefined> {
    const cached = this.catalogProbe;
    if (
      cached?.binaryPath === binaryPath &&
      Date.now() - cached.at < CodexCliAdapter.CATALOG_TTL_MS
    ) {
      return cached.output;
    }
    // probeCodexModelCatalog never rejects, so a cached promise cannot replay an error.
    const output = probeCodexModelCatalog(binaryPath);
    this.catalogProbe = { binaryPath, at: Date.now(), output };
    return output;
  }

  private markLaneDefault(model: CliModelInfo): CliModelInfo {
    return model.id === CodexCliAdapter.LANE_DEFAULT_MODEL
      ? { ...model, name: `${model.name} (Ptah lane default)` }
      : model;
  }

  /**
   * Resolve the OAuth access_token for Codex API calls.
   * Reads the token from ~/.codex/auth.json. No refresh is attempted.
   */
  private async resolveAccessToken(): Promise<string | null> {
    const raw = await readFile(CodexCliAdapter.getAuthPath(), 'utf-8');
    const auth = JSON.parse(raw) as CodexAuthFile;
    const apiKey = auth.openai_api_key || auth.OPENAI_API_KEY;
    if (apiKey) return apiKey;
    if (!auth.tokens?.access_token) return null;

    return auth.tokens.access_token;
  }

  /**
   * Check whether usable Codex credentials are on disk.
   *
   * This adapter NEVER refreshes anything — it only reads
   * `~/.codex/auth.json` and reports. (`CodexAuthService` in `auth-providers`
   * owns the actual OAuth refresh; nothing here can reach it.) The name is kept
   * because it is the `CliAdapter` contract shared with the other CLIs.
   *
   * True iff an API key is present, or an access token is present AND not
   * stale by the ONE shared rule. Answering presence alone is what let this
   * method log "fresh" for the same `auth.json` that `auth:getAuthStatus`
   * simultaneously reported as `codexTokenStale: true` (TASK_2026_342).
   */
  async ensureTokensFresh(): Promise<boolean> {
    try {
      const raw = await readFile(CodexCliAdapter.getAuthPath(), 'utf-8');
      const auth = JSON.parse(raw) as CodexAuthFile;

      if (auth.openai_api_key || auth.OPENAI_API_KEY) return true;
      if (!auth.tokens?.access_token) return false;
      return !isCodexAccessTokenStale({
        accessToken: auth.tokens.access_token,
        lastRefresh: auth.last_refresh,
      });
      // degradation-audit: optional-capability - this is a presence probe over
      // `~/.codex/auth.json` per the doc comment above; a missing or malformed
      // file means "no usable credentials found", the documented false return.
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
   * Every turn builds its own `Codex` client: the first turn of a new thread
   * gets the `first-turn` lane config, and every resumed spawn and
   * `continue()` turn gets the `resume` variant on `resumeThread(threadId)`
   * (TASK_2026_597, D2). The SDK spawns one `codex exec` per turn anyway, so a
   * client per turn adds no process.
   */
  async runSdk(options: CliCommandOptions): Promise<SdkHandle> {
    const sdk = await getCodexSdk();
    const binary = await resolveCodexNativeBinaryInfo(options.binaryPath);
    const userServers = await readCodexUserMcpServerNames(
      options.workingDirectory,
    );
    const budgets = resolveCodexLaneBudgets(options.laneBudgets);
    const developerInstructions = options.role
      ? renderRoleBlock(options.role, this.name)
      : undefined;
    const reasoningEffort =
      options.reasoningEffort &&
      (CODEX_REASONING_EFFORTS as readonly string[]).includes(
        options.reasoningEffort,
      )
        ? options.reasoningEffort
        : undefined;
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      FORCE_COLOR: '0',
      NO_COLOR: '1',
    };
    const secrets = [env['CODEX_API_KEY'], env['OPENAI_API_KEY']].filter(
      (value): value is string => typeof value === 'string' && value !== '',
    );
    const threadOptions: CodexThreadOptions = {
      workingDirectory: options.workingDirectory,
      sandboxMode: 'danger-full-access',
      skipGitRepoCheck: true,
      ...(options.model ? { model: options.model } : {}),
    };
    /**
     * The stderr of the rejection that put this handle on the essential keys,
     * or `undefined` while it runs the full lane config. It stays set for later
     * `continue()` turns once the essential retry worked; it is cleared again
     * when the essential config is rejected too, because that proves the cause
     * is outside Ptah's overrides (the user's own Codex config) and dropping
     * the budgets would buy nothing (batch 4 review M2).
     */
    let essentialAfter: string | undefined;
    /** `onLaneConfigRejected` fires once per handle. */
    let rejectionAnnounced = false;

    const laneConfig = (variant: CodexLaneConfigVariant): string[] => {
      const built = buildCodexLaneConfig({
        variant,
        ...budgets.budgets,
        reasoningEffort,
        mcpPort: options.mcpPort,
        workingDirectory: options.workingDirectory,
        agentId: options.agentId,
        userMcpServerNames: userServers.names,
        developerInstructions,
        codexVersion: binary?.version,
      });
      this.logLaneWarnings(built.warnings);
      return essentialAfter === undefined
        ? built.entries
        : essentialCodexConfigEntries(built.entries, essentialAfter);
    };

    /**
     * The overrides for a turn on `threadId` (none: a new thread), checked
     * against the command-line limit as the whole argv the SDK will spawn.
     * Many user servers or a long role plus budgets can breach it; nothing
     * is truncated (Batch 5 H6).
     */
    const turnOverrides = (threadId: string | undefined): string[] => {
      const configOverrides = laneConfig(threadId ? 'resume' : 'first-turn');
      assertCommandLineWithinLimit(
        binary?.path ?? 'codex',
        codexExecArgs({
          configOverrides,
          ...threadOptions,
          resumeThreadId: threadId,
        }),
      );
      return configOverrides;
    };

    const openThread = (threadId: string | undefined): CodexThread => {
      const codex = new sdk.Codex({
        configOverrides: turnOverrides(threadId),
        env,
        ...(binary ? { codexPathOverride: binary.path } : {}),
      });
      return threadId
        ? codex.resumeThread(threadId, threadOptions)
        : codex.startThread(threadOptions);
    };

    this.logLaneWarnings([...userServers.warnings, ...budgets.warnings]);
    // A too-long command line refuses the spawn here, before any process.
    turnOverrides(options.resumeSessionId);
    this.logger?.info('[CodexCliAdapter] Codex lane config', {
      codexVersion: binary?.version ?? 'unknown',
      nativeBinary: binary?.path ?? 'sdk-resolved',
      userServersDisabled: userServers.names.length,
      // R3.5: while CODEX_RESUME_RESENDS_ROLE is true the role is resent as
      // developer_instructions on every resumed spawn and continue() turn,
      // adding this many chars (at most LANE_ROLE_MAX_CHARS) per resume.
      // Tokens per resume are filled in from M on run C2 (S5).
      resumeRoleChars: developerInstructions?.length ?? 0,
    });

    const taskPrompt = buildTaskPrompt(
      { ...options, role: undefined, resumeRestoresContext: true },
      this.name,
    );
    // What this handle's first turn carried; later turns on the same thread
    // leave out exactly those blocks. A `resumeSessionId` spawn is a new
    // process with no record of the earlier one, so its first turn above
    // passes nothing and keeps both.
    const firstTurnPreambles: ResumeDeliveredPreambles =
      fullPromptPreambles(options);
    const abortController = new AbortController();
    let capturedThreadId: string | undefined;
    const itemTextTracker = new Map<string, string>();
    const itemsWithDeltas = new Set<string>();
    const output = createBufferedEmitter<string>();
    const segment = createBufferedEmitter<CliOutputSegment>();
    const configRejection = createBufferedEmitter<void>();
    const STARTUP_TIMEOUT_MS = 30_000;

    /**
     * Start a turn under a startup watchdog, disarming the watchdog the moment
     * the race settles either way.
     *
     * A watchdog must never outlive the thing it watches. The timer used to be
     * armed and forgotten: once `runStreamed` won the race, its 30-second timer
     * stayed in the event loop with nothing waiting on it. Rejecting a settled
     * race is a harmless no-op, so this was invisible to correctness — but the
     * handle keeps the process alive, and `continue()` re-enters `runTurn`, so
     * it is one orphaned 30-second handle PER TURN. That is what made this
     * lib's Jest run report "a worker process has failed to exit gracefully",
     * and it is the same defect class as commit 5dc525f02.
     */
    const startStreamedTurn = async (thread: CodexThread, prompt: string) => {
      let startupTimer: NodeJS.Timeout | undefined;
      try {
        return await Promise.race([
          thread.runStreamed(prompt, {
            signal: abortController.signal,
          }),
          new Promise<never>((_, reject) => {
            startupTimer = setTimeout(
              () => reject(new Error('Codex SDK startup timed out after 30s')),
              STARTUP_TIMEOUT_MS,
            );
          }),
        ]);
      } finally {
        clearTimeout(startupTimer);
      }
    };

    /**
     * The F10 message when `event` is a terminal `turn.failed` saying Codex
     * refused the model; never a retry with another model. Only the terminal
     * event is read: a non-terminal `error` (a reconnect or capacity notice)
     * goes through the normal path untouched. Codex's original text is logged
     * and quoted in the message (batch 4 review S1).
     */
    const modelRejection = (event: CodexThreadEvent): string | undefined => {
      if (event.type !== 'turn.failed') return undefined;
      const message = codexModelRejectionMessage(
        event.error.message,
        options.model,
        options.modelSource,
        secrets,
      );
      if (message !== undefined) {
        this.logger?.warn('[CodexCliAdapter] Codex rejected the lane model', {
          model: options.model ?? 'codex-default',
          modelSource: options.modelSource ?? 'unknown',
          codexError: codexTextExcerpt(event.error.message, secrets),
        });
      }
      return message;
    };

    /**
     * One attempt at a turn. `CONFIG_REJECTED` means Codex refused the lane
     * config before writing any event, so nothing reached a model and the
     * caller may retry once with the essential keys.
     */
    const runAttempt = async (
      prompt: string,
      threadId: string | undefined,
    ): Promise<number | typeof CONFIG_REJECTED> => {
      let receivedEvent = false;
      try {
        const thread = openThread(threadId);
        const streamedTurn = await startStreamedTurn(thread, prompt);

        for await (const event of streamedTurn.events) {
          receivedEvent = true;
          if (abortController.signal.aborted) {
            return 1;
          }
          if (event.type === 'thread.started') {
            capturedThreadId = event.thread_id;
          }

          const rejected = modelRejection(event);
          if (rejected === undefined) {
            this.handleStreamEvent(
              event,
              output.emit,
              segment.emit,
              itemTextTracker,
              itemsWithDeltas,
            );
          } else {
            output.emit(`[Error] ${rejected}\n`);
            segment.emit({ type: 'error', content: rejected });
          }

          // The turn is over the moment `turn.completed` or `turn.failed`
          // arrives — never wait for the iterator to end. The SDK ends it only
          // when `codex exec` closes stdout, and on Windows codex.exe was
          // measured alive for over an hour after its final event (a
          // long-lived powershell.exe child holds it open), so `done` never
          // settled and the agent read `running` until the timeout. Leaving
          // the loop calls the generator's `return()`, which runs the SDK's
          // `finally`: readline closed, child killed. `continue()` is safe
          // because each turn spawns its own `codex exec … resume <threadId>`.
          // `error` is deliberately NOT terminal: the SDK's own `Thread.run`
          // reads past it, and the turn still ends with one of these two.
          if (event.type === 'turn.completed') {
            return 0;
          }
          if (event.type === 'turn.failed') {
            return 1;
          }
        }

        return 0;
      } catch (error: unknown) {
        if (
          error instanceof Error &&
          (error.name === 'AbortError' || abortController.signal.aborted)
        ) {
          return 1;
        }

        // The SDK embeds the child's last ~500 output lines in `.message`.
        // The full text goes to the log; the stream gets a bounded summary.
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const rejectionStderr = receivedEvent
          ? undefined
          : sdkConfigRejectionStderr(errorMessage);
        if (rejectionStderr !== undefined && essentialAfter !== undefined) {
          // The essential keys were rejected too: the cause is not Ptah's
          // budget or prefix keys, so later turns go back to the full lane
          // config, and this failure is reported as a normal error below.
          essentialAfter = undefined;
          this.logger?.warn(
            "[CodexCliAdapter] Codex rejected the essential lane config too; the cause is outside Ptah's overrides (check the user's Codex config.toml). Later turns use the full lane config again",
            { stderr: codexStderrExcerpt(rejectionStderr, secrets) },
          );
        } else if (rejectionStderr !== undefined) {
          essentialAfter = rejectionStderr;
          const userServersOn =
            userServers.names.length > 0 &&
            codexRejectionNamesUserServer(rejectionStderr);
          this.logger?.warn(
            '[CodexCliAdapter] Codex rejected the lane config; retrying once with the essential keys only',
            {
              stderr: codexStderrExcerpt(rejectionStderr, secrets),
              userServersReEnabled: userServersOn,
            },
          );
          const notice = userServersOn
            ? `${CONFIG_REJECTED_NOTICE}. ${USER_SERVERS_ON_NOTICE}`
            : CONFIG_REJECTED_NOTICE;
          output.emit(`\n[${notice}]\n`);
          segment.emit({ type: 'info', content: notice });
          if (!rejectionAnnounced) {
            rejectionAnnounced = true;
            configRejection.emit();
          }
          return CONFIG_REJECTED;
        }
        this.logger?.error('[CodexCliAdapter] SDK turn failed', {
          detail: errorMessage,
        });
        const summary = summarizeCliSdkError(error, 'Codex', secrets);
        output.emit(`\n${summary}\n`);
        segment.emit({ type: 'error', content: summary });
        return 1;
      }
    };

    /** A turn with at most one retry after a config rejection. */
    const runTurn = async (
      prompt: string,
      threadId: string | undefined,
    ): Promise<number> => {
      const first = await runAttempt(prompt, threadId);
      if (first !== CONFIG_REJECTED) return first;
      if (abortController.signal.aborted) return 1;
      // `essentialAfter` is now set, so a second rejection is a normal error
      // (and clears it again).
      const retry = await runAttempt(prompt, threadId);
      return retry === CONFIG_REJECTED ? 1 : retry;
    };

    const continueTurn = (message: string): Promise<number> => {
      // Resume the thread this handle ran (or the one it was spawned to
      // resume). With no thread to resume, the message starts a new thread
      // and therefore carries the full prefix again.
      const threadId = capturedThreadId ?? options.resumeSessionId;
      const prompt = buildTaskPrompt(
        {
          ...options,
          task: message,
          files: undefined,
          role: undefined,
          resumeSessionId: threadId,
          resumeRestoresContext: true,
          resumeDeliveredPreambles: firstTurnPreambles,
        },
        this.name,
      );
      return runTurn(prompt, threadId);
    };

    const done = runTurn(taskPrompt, options.resumeSessionId);

    return {
      abort: abortController,
      done,
      onOutput: output.subscribe,
      onSegment: segment.subscribe,
      onLaneConfigRejected: configRejection.subscribe,
      getSessionId: () => capturedThreadId,
      setAgentId: () => {},
      supportsContinuation: () => true,
      continue: (message: string): Promise<ContinuationOutcome> =>
        Promise.resolve({ done: continueTurn(message) }),
    };
  }

  /** Log each distinct lane warning once per adapter instance. */
  private logLaneWarnings(warnings: readonly string[]): void {
    for (const warning of warnings) {
      if (this.loggedLaneWarnings.has(warning)) continue;
      if (this.loggedLaneWarnings.size < MAX_REMEMBERED_LANE_WARNINGS) {
        this.loggedLaneWarnings.add(warning);
      }
      this.logger?.warn(`[CodexCliAdapter] Codex lane config: ${warning}`);
    }
  }

  /**
   * Process a single SDK stream event and emit relevant output + structured segments.
   * Dispatches to per-event-type handler methods for testability and readability.
   *
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
      case 'item.started':
        this.handleItemStarted(event.item, emitSegment);
        break;
      case 'item.updated':
        this.handleItemUpdated(
          event.item,
          emitOutput,
          emitSegment,
          itemTextTracker,
          itemsWithDeltas,
        );
        break;
      case 'item.completed':
        this.handleItemCompleted(
          event.item,
          emitOutput,
          emitSegment,
          itemTextTracker,
          itemsWithDeltas,
        );
        break;
      case 'turn.completed':
        this.handleTurnCompleted(event, emitOutput, emitSegment);
        break;
      case 'turn.failed':
        this.handleTurnFailed(event, emitOutput, emitSegment);
        break;
      case 'error':
        this.handleStreamError(event, emitOutput, emitSegment);
        break;
      default:
        break;
    }
  }

  /** Emit early tool-call segments for progressive rendering on item start. */
  private handleItemStarted(
    item: CodexThreadItem,
    emitSegment: (segment: CliOutputSegment) => void,
  ): void {
    switch (item.type) {
      case 'command_execution':
        // `Bash` + `{ command, description }` is the shape the tool card is
        // built for: shell syntax highlighting, a copyable command, and the
        // program (`rg`, `git`) as the chip's description. `toolArgs` alone
        // reached the card as `__summary` and rendered as truncated text.
        emitSegment({
          type: 'tool-call',
          toolName: 'Bash',
          toolArgs: item.command,
          toolInput: {
            command: stripShellWrapper(item.command),
            description: commandToolLabel(item.command),
          },
          content: '',
          toolCallId: item.id,
        });
        break;
      case 'mcp_tool_call':
        // `mcp__<server>__<tool>` is the name the UI already knows: the tool
        // icon and the JSON view both key off that prefix.
        emitSegment({
          type: 'tool-call',
          toolName: `mcp__${item.server}__${item.tool}`,
          toolInput: mcpToolInput(item.arguments),
          content: '',
          toolCallId: item.id,
        });
        break;
      default:
        break;
    }
  }

  /** Emit progressive text/thinking deltas for streaming updates. */
  private handleItemUpdated(
    item: CodexThreadItem,
    emitOutput: (data: string) => void,
    emitSegment: (segment: CliOutputSegment) => void,
    itemTextTracker: Map<string, string>,
    itemsWithDeltas: Set<string>,
  ): void {
    switch (item.type) {
      case 'agent_message':
        this.emitTextDelta(
          item,
          'text',
          emitOutput,
          emitSegment,
          itemTextTracker,
          itemsWithDeltas,
        );
        break;
      case 'reasoning':
        this.emitTextDelta(
          item,
          'thinking',
          emitOutput,
          emitSegment,
          itemTextTracker,
          itemsWithDeltas,
        );
        break;
      default:
        break;
    }
  }

  /**
   * Shared delta tracking logic for text-bearing items (agent_message, reasoning).
   * Computes the delta between previous and current text, emitting only the new portion.
   * Falls back to emitting the full text when the SDK replaces (rather than appends) content.
   */
  private emitTextDelta(
    item: { id: string; text: string },
    segmentType: 'text' | 'thinking',
    emitOutput: (data: string) => void,
    emitSegment: (segment: CliOutputSegment) => void,
    itemTextTracker: Map<string, string>,
    itemsWithDeltas: Set<string>,
  ): void {
    const previousText = itemTextTracker.get(item.id) ?? '';
    if (item.text.startsWith(previousText)) {
      const delta = item.text.slice(previousText.length);
      if (delta) {
        emitOutput(delta);
        emitSegment({ type: segmentType, content: delta });
        itemTextTracker.set(item.id, item.text);
        itemsWithDeltas.add(item.id);
      }
    } else {
      emitOutput(item.text);
      emitSegment({ type: segmentType, content: item.text });
      itemTextTracker.set(item.id, item.text);
      itemsWithDeltas.add(item.id);
    }
  }

  /** Emit final output and structured segments when an item completes. */
  private handleItemCompleted(
    item: CodexThreadItem,
    emitOutput: (data: string) => void,
    emitSegment: (segment: CliOutputSegment) => void,
    itemTextTracker: Map<string, string>,
    itemsWithDeltas: Set<string>,
  ): void {
    switch (item.type) {
      case 'agent_message':
        if (!itemsWithDeltas.has(item.id)) {
          if (item.text) {
            emitOutput(item.text + '\n');
            emitSegment({ type: 'text', content: item.text });
          }
        }
        itemTextTracker.delete(item.id);
        itemsWithDeltas.delete(item.id);
        break;
      case 'reasoning':
        if (!itemsWithDeltas.has(item.id)) {
          if (item.text) {
            emitOutput(`[Thinking] ${item.text}\n`);
            emitSegment({ type: 'thinking', content: item.text });
          }
        }
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
        // Codex reports a patch only once it has been applied, so there is no
        // started event to pair with. Emit the pair here: one card per file,
        // named Write/Edit/Delete with a `file_path`, which is what makes the
        // path a link instead of a line of grey text.
        for (const [index, change] of item.changes.entries()) {
          const changeCallId = `${item.id}:${index}`;
          emitOutput(`[${change.kind}] ${change.path}\n`);
          emitSegment({
            type: 'tool-call',
            toolName: fileChangeToolName(change.kind),
            toolInput: { file_path: change.path },
            content: '',
            toolCallId: changeCallId,
          });
          emitSegment({
            type:
              item.status === 'failed' ? 'tool-result-error' : 'file-change',
            content: change.path,
            changeKind: change.kind,
            toolCallId: changeCallId,
          });
        }
        break;
      case 'mcp_tool_call':
        if (item.error) {
          const errorText = mcpResultText(item.error);
          emitOutput(`[MCP Error] ${item.server}:${item.tool}: ${errorText}\n`);
          emitSegment({
            type: 'tool-result-error',
            content: errorText,
            toolCallId: item.id,
          });
        } else if (item.result) {
          emitOutput(`[MCP Result] ${item.server}:${item.tool}\n`);
          emitSegment({
            type: 'tool-result',
            content: mcpResultText(item.result),
            toolCallId: item.id,
          });
        } else {
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
          type: 'tool-call',
          toolName: 'WebSearch',
          toolInput: { query: item.query },
          content: '',
          toolCallId: item.id,
        });
        emitSegment({
          type: 'tool-result',
          content: item.query,
          toolCallId: item.id,
        });
        break;
      case 'todo_list': {
        const formatted = item.items
          .map((i) => `${i.completed ? '[x]' : '[ ]'} ${i.text}`)
          .join('\n');
        emitOutput(`[Todo List]\n${formatted}\n`);
        // `TodoWrite` + `{ todos }` routes to the task-list card the Claude
        // path already uses. Codex tracks two states, so an item is
        // `completed` or `pending` and never `in_progress`.
        emitSegment({
          type: 'tool-call',
          toolName: 'TodoWrite',
          toolInput: {
            todos: item.items.map((i) => ({
              content: i.text,
              status: i.completed ? 'completed' : 'pending',
              activeForm: i.text,
            })),
          },
          content: '',
          toolCallId: item.id,
        });
        emitSegment({
          type: 'tool-result',
          content: formatted,
          toolCallId: item.id,
        });
        break;
      }
      case 'error':
        emitOutput(`[Error] ${item.message}\n`);
        emitSegment({ type: 'error', content: item.message });
        break;
      default: {
        // A newer Codex build emits item types this SDK version does not
        // declare. Dropping them silently is how work that DID run reads as
        // work that never happened.
        const unhandled = item as { type: string };
        emitOutput(`[${unhandled.type}]\n`);
        emitSegment({
          type: 'info',
          content: `Codex item: ${unhandled.type}`,
        });
        break;
      }
    }
  }

  /** Emit usage statistics when a turn completes successfully. */
  private handleTurnCompleted(
    event: Extract<CodexThreadEvent, { type: 'turn.completed' }>,
    emitOutput: (data: string) => void,
    emitSegment: (segment: CliOutputSegment) => void,
  ): void {
    if (event.usage) {
      // `cached_input_tokens` is the share of the input that was served from
      // the prompt cache. Without it the input figure reads as new work every
      // turn, which is the opposite of what a resent thread actually costs.
      const cached = event.usage.cached_input_tokens ?? 0;
      const usageStr = `Usage: ${event.usage.input_tokens} input (${cached} cached), ${event.usage.output_tokens} output tokens`;
      emitOutput(`\n[${usageStr}]\n`);
      emitSegment({
        type: 'info',
        content: usageStr,
        usage: {
          inputTokens: event.usage.input_tokens,
          outputTokens: event.usage.output_tokens,
        },
      });
    }
  }

  /** Emit error output when a turn fails. */
  private handleTurnFailed(
    event: Extract<CodexThreadEvent, { type: 'turn.failed' }>,
    emitOutput: (data: string) => void,
    emitSegment: (segment: CliOutputSegment) => void,
  ): void {
    emitOutput(`[Turn Failed] ${event.error.message}\n`);
    emitSegment({
      type: 'error',
      content: `Turn Failed: ${event.error.message}`,
    });
  }

  /** Emit error output for stream-level errors. */
  private handleStreamError(
    event: Extract<CodexThreadEvent, { type: 'error' }>,
    emitOutput: (data: string) => void,
    emitSegment: (segment: CliOutputSegment) => void,
  ): void {
    emitOutput(`[Stream Error] ${event.message}\n`);
    emitSegment({ type: 'error', content: event.message });
  }
}
