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
 * Platform binary package names used by the Codex SDK.
 * Maps target triple to npm package name (mirrors PLATFORM_PACKAGE_BY_TARGET in codex-sdk).
 */
const CODEX_PLATFORM_PACKAGES: Record<string, string> = {
  'x86_64-unknown-linux-musl': '@openai/codex-linux-x64',
  'aarch64-unknown-linux-musl': '@openai/codex-linux-arm64',
  'x86_64-apple-darwin': '@openai/codex-darwin-x64',
  'aarch64-apple-darwin': '@openai/codex-darwin-arm64',
  'x86_64-pc-windows-msvc': '@openai/codex-win32-x64',
  'aarch64-pc-windows-msvc': '@openai/codex-win32-arm64',
};

/**
 * Resolve the target triple for the current platform.
 * Returns the Rust-style target triple used by the Codex SDK binary packages.
 */
function getTargetTriple(): string | undefined {
  const { platform, arch } = process;
  if (platform === 'win32') {
    return arch === 'arm64'
      ? 'aarch64-pc-windows-msvc'
      : 'x86_64-pc-windows-msvc';
  }
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  }
  if (platform === 'linux') {
    return arch === 'arm64'
      ? 'aarch64-unknown-linux-musl'
      : 'x86_64-unknown-linux-musl';
  }
  return undefined;
}

/**
 * Cross-platform resolver for the Codex native binary.
 *
 * The Codex SDK spawns a platform-specific Rust executable directly (no shim).
 * On Windows, npm installs a `.cmd` wrapper that invokes a `.js` launcher —
 * passing either to the SDK as `codexPathOverride` produces `spawn EFTYPE`.
 * On every OS we must point to the actual native binary inside the
 * `@openai/codex-<platform>` package's `vendor/<triple>/codex/` directory.
 *
 * Resolution order (first existing path wins):
 *   1. Electron packaged: `<resourcesPath>/app.asar.unpacked/node_modules/...`
 *   2. `require.resolve('@openai/codex-<platform>/package.json')` → vendor/...
 *      (works when the SDK and its optional-dep platform package are installed
 *      under the host's node_modules — covers dev/unbundled and most installs)
 *   3. Walk up from `@openai/codex-sdk/package.json`'s node_modules root
 *      (with app.asar → app.asar.unpacked rewrite, covers older Electron builds)
 *   4. npm global roots (when user did `npm i -g @openai/codex`):
 *      Win  → `%APPDATA%\npm\node_modules\...`
 *      Unix → `/usr/local/lib/node_modules`, `/usr/lib/node_modules`,
 *             `$HOME/.npm-global/lib/node_modules`,
 *             `$HOME/.nvm/versions/node/<ver>/lib/node_modules`
 *   5. Walk up from the detected CLI path (`which codex` → its sibling
 *      `node_modules/@openai/codex-<platform>/...`) — last-resort heuristic.
 *
 * Returns `undefined` if no candidate exists. Callers must NOT pass the bare
 * `detectedCliPath` (a `.cmd` or `.js` shim) to the SDK in that case — let the
 * SDK's own `findCodexPath()` surface a clearer error than EFTYPE.
 */
function resolveCodexNativeBinary(
  detectedCliPath?: string,
): string | undefined {
  const targetTriple = getTargetTriple();
  if (!targetTriple) return undefined;

  const platformPkg = CODEX_PLATFORM_PACKAGES[targetTriple];
  if (!platformPkg) return undefined;

  const binaryName = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const pkgDir = platformPkg.split('/')[1];
  // Path of the binary RELATIVE to a `node_modules/@openai/` parent directory.
  const relFromOpenAi = path.join(
    pkgDir,
    'vendor',
    targetTriple,
    'codex',
    binaryName,
  );
  // Path of the binary RELATIVE to a `node_modules/` parent directory.
  const relFromNodeModules = path.join('@openai', relFromOpenAi);
  // Path of the binary RELATIVE to a directory containing `node_modules`.
  const relFromBin = path.join('node_modules', relFromNodeModules);

  const candidates: string[] = [];

  // 1. Electron: resourcesPath/app.asar.unpacked/node_modules/...
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string })
    .resourcesPath;
  if (resourcesPath) {
    candidates.push(path.join(resourcesPath, 'app.asar.unpacked', relFromBin));
  }

  // 2. require.resolve the platform binary package directly. When the SDK's
  //    optional dep is installed alongside the SDK, this is the most reliable
  //    path on all OSes.
  try {
    const platformPkgJson = require.resolve(`${platformPkg}/package.json`);
    candidates.push(
      path.join(
        path.dirname(platformPkgJson),
        'vendor',
        targetTriple,
        'codex',
        binaryName,
      ),
    );
  } catch {
    // Platform package not installed or not resolvable from this context.
  }

  // 3. require.resolve via @openai/codex-sdk's node_modules root.
  try {
    const sdkPkgJsonPath = require.resolve('@openai/codex-sdk/package.json');
    // sdkPkgJsonPath = .../node_modules/@openai/codex-sdk/package.json
    const nodeModulesRoot = path.resolve(sdkPkgJsonPath, '..', '..', '..');
    const candidate = path.join(nodeModulesRoot, relFromNodeModules);
    candidates.push(candidate);
    // Rewrite for older Electron builds where SDK lives inside app.asar but
    // the binary is unpacked.
    candidates.push(
      candidate.replace(/app\.asar(?!\.unpacked)/, 'app.asar.unpacked'),
    );
  } catch {
    // SDK not resolvable when bundled by esbuild — falls through to below.
  }

  // 4. npm global roots (covers `npm i -g @openai/codex` installs).
  if (process.platform === 'win32') {
    const appData = process.env['APPDATA'];
    if (appData) {
      candidates.push(path.join(appData, 'npm', relFromBin));
    }
  } else {
    candidates.push(path.join('/usr/local/lib', relFromBin));
    candidates.push(path.join('/usr/lib', relFromBin));
    const home = process.env['HOME'];
    if (home) {
      candidates.push(path.join(home, '.npm-global', 'lib', relFromBin));
      candidates.push(
        path.join(
          home,
          '.nvm',
          'versions',
          'node',
          process.version,
          'lib',
          relFromBin,
        ),
      );
    }
  }

  // 5. Walk up from the detected CLI path. npm puts the platform-binary
  //    optional-dep alongside the `@openai/codex` package, so we try both:
  //      <cliDir>/node_modules/@openai/codex-<platform>/...
  //      <cliDir>/node_modules/@openai/codex/node_modules/@openai/codex-<platform>/...
  if (detectedCliPath) {
    const cliDir = path.dirname(detectedCliPath);
    candidates.push(path.join(cliDir, relFromBin));
    candidates.push(
      path.join(
        cliDir,
        'node_modules',
        '@openai',
        'codex',
        'node_modules',
        relFromNodeModules,
      ),
    );
    // On Windows, the .cmd lives in `<prefix>/npm/`; the node_modules is at
    // `<prefix>/npm/node_modules/`. cliDir already points to the right place.
    // On Unix, the bin is at `<prefix>/bin/codex`; node_modules is at
    // `<prefix>/lib/node_modules/`. Translate bin → lib for that case.
    if (process.platform !== 'win32' && path.basename(cliDir) === 'bin') {
      const prefix = path.dirname(cliDir);
      candidates.push(path.join(prefix, 'lib', relFromBin));
    }
  }

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      // Permission / path errors — skip and try next.
    }
  }

  return undefined;
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
            const trimmed = stdout.trim().split(/\r?\n/)[0];
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
   * List available models for Codex.
   * Returns the curated list of Codex-supported models (matching Codex CLI's /model menu)
   * rather than querying the API, which returns a broader set of non-Codex models.
   */
  async listModels(): Promise<CliModelInfo[]> {
    return CodexCliAdapter.SUPPORTED_MODELS;
  }

  /**
   * Resolve the OAuth access_token for Codex API calls.
   * Reads the token from ~/.codex/auth.json. No refresh is attempted.
   */
  private async resolveAccessToken(): Promise<string | null> {
    try {
      const raw = await readFile(CodexCliAdapter.getAuthPath(), 'utf-8');
      const auth = JSON.parse(raw) as CodexAuthFile;

      // API key takes priority — never expires (check both snake_case and SCREAMING_CASE)
      const apiKey = auth.openai_api_key || auth.OPENAI_API_KEY;
      if (apiKey) return apiKey;
      if (!auth.tokens?.access_token) return null;

      return auth.tokens.access_token;
    } catch {
      // Auth file not found or unreadable
    }
    return null;
  }

  /**
   * Check if Codex credentials are available.
   * Returns true if an API key or access token is present in ~/.codex/auth.json.
   */
  async ensureTokensFresh(): Promise<boolean> {
    try {
      const raw = await readFile(CodexCliAdapter.getAuthPath(), 'utf-8');
      const auth = JSON.parse(raw) as CodexAuthFile;

      if (auth.openai_api_key || auth.OPENAI_API_KEY) return true;
      return !!auth.tokens?.access_token;
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
    const sdk = await getCodexSdk();

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
    // Resolve the native Codex binary across all platforms (Win/macOS/Linux)
    // and all hosts (Electron, VS Code extension, CLI/dev). The SDK spawns
    // this binary directly, so we must point to the actual platform-specific
    // Rust executable — never to a `.cmd` shim (EFTYPE on Windows) or `.js`
    // launcher. If resolution fails we pass `undefined` and let the SDK's
    // internal `findCodexPath()` try.
    const nativeBinaryPath = resolveCodexNativeBinary(options.binaryPath);
    if (nativeBinaryPath) {
      codexOptions.codexPathOverride = nativeBinaryPath;
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
   * Dispatches to per-event-type handler methods for testability and readability.
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
        // thread.started handled in runSdk() for thread ID capture
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
      // Normal append — emit only the new delta
      const delta = item.text.slice(previousText.length);
      if (delta) {
        emitOutput(delta);
        emitSegment({ type: segmentType, content: delta });
        itemTextTracker.set(item.id, item.text);
        itemsWithDeltas.add(item.id);
      }
    } else {
      // Text was replaced (not appended) — emit full text as replacement
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
  }

  /** Emit usage statistics when a turn completes successfully. */
  private handleTurnCompleted(
    event: Extract<CodexThreadEvent, { type: 'turn.completed' }>,
    emitOutput: (data: string) => void,
    emitSegment: (segment: CliOutputSegment) => void,
  ): void {
    if (event.usage) {
      const usageStr = `Usage: ${event.usage.input_tokens} input, ${event.usage.output_tokens} output tokens`;
      emitOutput(`\n[${usageStr}]\n`);
      emitSegment({ type: 'info', content: usageStr });
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
