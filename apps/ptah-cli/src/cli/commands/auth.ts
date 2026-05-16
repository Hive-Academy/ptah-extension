/**
 * `ptah auth` command — sub-dispatcher for status / login / logout / test.
 *
 * Sub-commands (per task-description.md §3.1):
 *
 *   status                — Read-only. Calls `auth:getAuthStatus` +
 *                           `auth:getHealth` + `auth:getApiKeyStatus`.
 *                           Redacts API keys unless `--reveal`.
 *   login copilot         — Headless device-code OAuth via `headless-flow.ts`.
 *                           Composes JsonRpc opener if a peer is attached,
 *                           stderr opener otherwise.
 *   login codex           — Spawns `codex login --device-auth` via cross-spawn,
 *                           surfaces the device-code URL via auth.login.url,
 *                           propagates SIGINT, emits auth.login.complete on
 *                           exit code 0.
 *   login claude-cli      — Verifies Claude CLI on PATH via ClaudeCliDetector
 *                           (alias: `claude`). On success, persists
 *                           `authMethod=claudeCli` to ~/.ptah/settings.json.
 *                           On failure emits task.error{ ptah_code:
 *                           'claude_cli_not_found' } + ExitCode.UsageError.
 *   login anthropic       — Settings-based: prints "use provider set-key".
 *   logout copilot        — Calls `auth:copilotLogout` over RPC.
 *   logout codex --force  — CLI-local `fs.unlink('~/.codex/auth.json')`.
 *                           No RPC method (per B8b drop decision).
 *   test <provider>       — Calls `auth:testConnection` and emits
 *                           `auth.test.result`.
 *
 * No DI mocking in production code — all collaborators are obtained via
 * `withEngine` (which bootstraps tsyringe) or via direct container resolution.
 * Mocking is permitted ONLY in the spec file.
 */

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join as pathJoin } from 'node:path';

import {
  ANTHROPIC_PROVIDERS,
  SDK_TOKENS,
  spawnCli,
  type ICopilotAuthService,
  type ClaudeCliDetector,
} from '@ptah-extension/agent-sdk';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { ClaudeCliHealth } from '@ptah-extension/shared';

import { withEngine } from '../bootstrap/with-engine.js';
import { suggestClosest } from './_string-distance.js';
import {
  runHeadlessLogin,
  type HeadlessProcessLike,
} from '../oauth/headless-flow.js';
import { JsonRpcOAuthUrlOpener } from '../oauth/jsonrpc-oauth-url-opener.js';
import { StderrOAuthUrlOpener } from '../oauth/stderr-oauth-url-opener.js';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { redact } from '../output/redactor.js';
import { JsonRpcServer } from '../jsonrpc/server.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';

/** Sub-commands accepted by `ptah auth ...`. */
export type AuthSubcommand =
  | 'status'
  | 'login'
  | 'logout'
  | 'test'
  | 'use'
  | 'set-anthropic-route';

/** Providers accepted by `auth login` / `auth logout` / `auth test`. */
export type AuthProvider =
  | 'copilot'
  | 'codex'
  | 'claude'
  | 'claude-cli'
  | 'anthropic'
  | string;

/**
 * Narrowed contract for the workspace provider used by auth login flows that
 * write to `~/.ptah/settings.json` (notably `authMethod`). Mirrors the shape
 * surfaced by `IWorkspaceProvider` in `@ptah-extension/platform-core` without
 * pulling the full interface (which adds VS Code-specific overloads we never
 * exercise from the CLI).
 */
export interface AuthWorkspaceProviderLike {
  setConfiguration?(
    section: string,
    key: string,
    value: unknown,
  ): Promise<void>;
}

/**
 * Subset of `ChildProcess` that the codex login flow needs: exit/error events
 * and SIGINT propagation. Defining a narrowed type lets tests inject a fake
 * without polyfilling every Node `ChildProcess` field.
 */
export interface CodexChildLike {
  on(event: 'exit', listener: (code: number | null) => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  on(event: 'close', listener: (code: number | null) => void): unknown;
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export interface AuthOptions {
  subcommand: AuthSubcommand;
  /** For login/logout/test sub-commands. */
  provider?: AuthProvider;
  /** For `logout codex --force`: skip confirmation. */
  force?: boolean;
  /**
   * For `auth use <providerId>`. Accepts:
   *   - `claude-cli`              → authMethod=claude-cli
   *   - `github-copilot`/`copilot`→ authMethod=oauth, anthropicProviderId=...
   *   - `openai-codex`/`codex`    → authMethod=oauth, anthropicProviderId=...
   *   - `openrouter`              → authMethod=apiKey, defaultProvider=openrouter
   *   - `moonshot`                → authMethod=apiKey, defaultProvider=moonshot
   *   - `z-ai`                    → authMethod=apiKey, defaultProvider=z-ai
   */
  providerId?: string;
}

/**
 * Stderr stream contract — narrowed for testability. Production uses
 * `process.stderr`; tests inject a buffer-backed sink.
 */
export interface AuthStderrLike {
  write(chunk: string): boolean;
}

/** Optional collaborators — tests inject; production omits. */
export interface AuthExecuteHooks {
  /** Override the stderr sink. Defaults to `process.stderr`. */
  stderr?: AuthStderrLike;
  /** Override the formatter. Defaults to one built from `globals`. */
  formatter?: Formatter;
  /**
   * Override the headless-flow runner (tests). Production uses the real
   * `runHeadlessLogin` import.
   */
  runHeadlessLogin?: typeof runHeadlessLogin;
  /**
   * Override the engine bootstrapper. Tests pass a stub that returns
   * scripted ctx; production omits to use `withEngine`.
   */
  withEngine?: typeof withEngine;
  /** Override the file-unlink fn (used by `logout codex`). */
  unlinkFile?: (path: string) => Promise<void>;
  /** Override the codex auth file path (tests). */
  codexAuthPath?: string;
  /** Override the SIGINT-aware process ref passed to runHeadlessLogin. */
  processRef?: HeadlessProcessLike;
  /**
   * Override the CopilotAuthService resolver. Production omits this hook; the
   * default resolves the service from the DI container via
   * `SDK_TOKENS.SDK_COPILOT_AUTH`. Tests pass a stub so they do not need to
   * register the SDK module under jest.
   *
   * The resolver receives the engine context's container so production code
   * can stay unchanged; tests typically ignore it and return a vanilla mock.
   */
  resolveCopilotAuth?: (
    container: import('tsyringe').DependencyContainer,
  ) => Promise<ICopilotAuthService> | ICopilotAuthService;
  /**
   * Override the ClaudeCliDetector resolver. Production omits — we resolve
   * `SDK_TOKENS.SDK_CLI_DETECTOR` from the container. Tests pass a stub.
   */
  resolveClaudeCliDetector?: (
    container: import('tsyringe').DependencyContainer,
  ) => Promise<ClaudeCliDetector> | ClaudeCliDetector;
  /**
   * Override the workspace provider resolver. Production omits — we resolve
   * `PLATFORM_TOKENS.WORKSPACE_PROVIDER` from the container. Tests pass a stub
   * so the spec doesn't need a real DI graph.
   */
  resolveWorkspaceProvider?: (
    container: import('tsyringe').DependencyContainer,
  ) => Promise<AuthWorkspaceProviderLike> | AuthWorkspaceProviderLike;
  /**
   * Override the codex login spawn. Production uses `spawnCli('codex', ...)`
   * from `@ptah-extension/agent-sdk`; tests inject a fake that returns a
   * scripted child.
   */
  spawnCodexLogin?: (
    binary: string,
    args: string[],
    options: { env?: NodeJS.ProcessEnv },
  ) => CodexChildLike;
  /**
   * SIGINT-aware process ref for codex login. Production omits and we attach
   * a one-shot handler to `process`; tests inject an `EventEmitter` stub.
   */
  processRefForCodex?: NodeJS.EventEmitter;
}

/**
 * Execute the `ptah auth` command. Returns the process exit code.
 *
 * The dispatch is a flat switch — each sub-command resolves its own engine
 * mode and invokes the appropriate collaborator. We avoid building a single
 * giant DI bootstrap because `auth login codex` and `auth logout codex` need
 * no DI at all (they are pure file/stderr ops).
 */
export async function execute(
  opts: AuthOptions,
  globals: GlobalOptions,
  hooks: AuthExecuteHooks = {},
): Promise<number> {
  const formatter = hooks.formatter ?? buildFormatter(globals);
  const stderr: AuthStderrLike = hooks.stderr ?? process.stderr;
  const engine = hooks.withEngine ?? withEngine;

  try {
    switch (opts.subcommand) {
      case 'status':
        return await runStatus(formatter, globals, engine);
      case 'login':
        return await runLogin(opts, globals, formatter, stderr, engine, hooks);
      case 'logout':
        return await runLogout(opts, globals, formatter, stderr, engine, hooks);
      case 'test':
        return await runTest(opts, formatter, globals, engine);
      case 'use':
        return await runUse(opts, globals, formatter, stderr, engine, hooks);
      case 'set-anthropic-route':
        return await runSetAnthropicRoute(
          opts,
          globals,
          formatter,
          stderr,
          engine,
          hooks,
        );
      default:
        stderr.write(
          `ptah auth: unknown sub-command '${String(opts.subcommand)}'\n`,
        );
        return ExitCode.UsageError;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await formatter.writeNotification('task.error', {
      ptah_code: 'internal_failure',
      message,
    });
    return ExitCode.InternalFailure;
  }
}

// ---------------------------------------------------------------------------
// `auth status`
// ---------------------------------------------------------------------------

async function runStatus(
  formatter: Formatter,
  globals: GlobalOptions,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
    const transport = ctx.transport;

    const status = await callRpc<Record<string, unknown>>(
      transport,
      'auth:getAuthStatus',
      {},
    );
    const health = await callRpc<Record<string, unknown>>(
      transport,
      'auth:getHealth',
      undefined,
    );
    const apiKey = await callRpc<Record<string, unknown>>(
      transport,
      'auth:getApiKeyStatus',
      {},
    );

    const reveal = globals.reveal === true;

    // Default (non-verbose) emits ONE coalesced `auth.status` notification.
    // The formatter's `renderAuthStatus` understands the nested `health` and
    // `apiKey` fields, so `--human` users see a single table instead of three
    // disjoint envelopes. Operators driving the CLI from JSON-RPC also get a
    // single deterministic frame, simplifying their state machine.
    //
    // `--verbose` preserves the legacy 3-frame stream for parity with older
    // tooling that depends on `auth.health` / `auth.api_key.status` being
    // separate envelopes (e.g. the doctor stream).
    if (globals.verbose) {
      await formatter.writeNotification(
        'auth.status',
        redact(status, { reveal }),
      );
      await formatter.writeNotification(
        'auth.health',
        redact(health, { reveal }),
      );
      await formatter.writeNotification(
        'auth.api_key.status',
        redact(apiKey, { reveal }),
      );
      return ExitCode.Success;
    }

    // Nested keys are namespaced (`health`, `apiKeyStatus`) to avoid colliding
    // with any top-level field on the auth-status payload. Naming the nested
    // RPC result `apiKeyStatus` keeps it disjoint from the redactor's
    // sensitive-key heuristics (which match `/apikey/i`) — the nested object
    // gets walked and `hasApiKey`/`apiKey` fields inside it still redact
    // correctly via the recursion.
    const coalesced = {
      ...(status ?? {}),
      health: health ?? null,
      apiKeyStatus: apiKey ?? null,
    };
    await formatter.writeNotification(
      'auth.status',
      redact(coalesced, { reveal }),
    );
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// `auth login [copilot|codex|claude]`
// ---------------------------------------------------------------------------

async function runLogin(
  opts: AuthOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: AuthStderrLike,
  engine: typeof withEngine,
  hooks: AuthExecuteHooks,
): Promise<number> {
  const provider = (opts.provider ?? '').toLowerCase();
  if (!provider) {
    stderr.write('ptah auth login: provider is required\n');
    return ExitCode.UsageError;
  }

  if (provider === 'copilot') {
    return runCopilotLogin(globals, formatter, engine, hooks);
  }

  if (provider === 'codex') {
    return runCodexLogin(globals, formatter, stderr, engine, hooks);
  }

  if (provider === 'claude' || provider === 'claude-cli') {
    return runClaudeCliLogin(globals, formatter, stderr, engine, hooks);
  }

  if (provider === 'anthropic') {
    // Settings-based: API-key auth flow lives under `provider set-key`.
    // `claude` and `claude-cli` are now distinct (PATH-detected CLI auth).
    await formatter.writeNotification('auth.login.start', {
      provider: 'anthropic',
      timestamp: new Date().toISOString(),
    });
    stderr.write(
      'Set your Anthropic API key via: ' +
        'ptah provider set-key --provider anthropic --key <KEY>\n',
    );
    return ExitCode.Success;
  }

  stderr.write(`ptah auth login: unsupported provider '${provider}'\n`);
  return ExitCode.UsageError;
}

/**
 * `auth login claude-cli` (alias: `auth login claude`).
 *
 * Verify the Claude CLI is reachable on PATH (or any of the standard install
 * locations the SDK already probes via `ClaudeCliDetector`), then persist
 * `authMethod=claudeCli` to `~/.ptah/settings.json` so the SDK adapter picks
 * the CLI strategy on next bootstrap.
 *
 * On failure (CLI not found / health check returns `available: false`) we
 * emit `task.error{ ptah_code: 'claude_cli_not_found' }` and exit with
 * `ExitCode.UsageError` — operator action is required (install the CLI or
 * fix PATH), so `UsageError` is the right semantic, not `InternalFailure`.
 */
async function runClaudeCliLogin(
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: AuthStderrLike,
  engine: typeof withEngine,
  hooks: AuthExecuteHooks,
): Promise<number> {
  return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
    await formatter.writeNotification('auth.login.start', {
      provider: 'claude-cli',
      timestamp: new Date().toISOString(),
    });

    const detector = await (hooks.resolveClaudeCliDetector
      ? hooks.resolveClaudeCliDetector(ctx.container)
      : ctx.container.resolve<ClaudeCliDetector>(SDK_TOKENS.SDK_CLI_DETECTOR));

    let health: ClaudeCliHealth;
    try {
      health = await detector.performHealthCheck();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await formatter.writeNotification('task.error', {
        provider: 'claude-cli',
        ptah_code: 'claude_cli_not_found',
        message: `Claude CLI health check failed: ${message}`,
      });
      stderr.write(
        'Claude CLI not found. Install it (e.g. `npm install -g ' +
          '@anthropic-ai/claude-code`) and ensure `claude` is on PATH, ' +
          'then re-run `ptah auth login claude-cli`.\n',
      );
      return ExitCode.UsageError;
    }

    if (!health.available) {
      await formatter.writeNotification('task.error', {
        provider: 'claude-cli',
        ptah_code: 'claude_cli_not_found',
        message:
          health.error ??
          'Claude CLI not found in PATH or known install locations',
        platform: health.platform,
        isWSL: health.isWSL,
      });
      stderr.write(
        'Claude CLI not found. Install it (e.g. `npm install -g ' +
          '@anthropic-ai/claude-code`) and ensure `claude` is on PATH, ' +
          'then re-run `ptah auth login claude-cli`.\n',
      );
      return ExitCode.UsageError;
    }

    // Persist authMethod=claudeCli via the workspace provider. The
    // `authMethod` key is part of FILE_BASED_SETTINGS_KEYS so it routes to
    // ~/.ptah/settings.json automatically.
    const workspaceProvider = await (hooks.resolveWorkspaceProvider
      ? hooks.resolveWorkspaceProvider(ctx.container)
      : (ctx.container.resolve(
          PLATFORM_TOKENS.WORKSPACE_PROVIDER,
        ) as AuthWorkspaceProviderLike));

    if (typeof workspaceProvider.setConfiguration !== 'function') {
      await formatter.writeNotification('task.error', {
        provider: 'claude-cli',
        ptah_code: 'internal_failure',
        message:
          'IWorkspaceProvider.setConfiguration is not available on this platform',
      });
      return ExitCode.InternalFailure;
    }

    // Stream A migrates `claudeCli` → `claude-cli` (kebab) across the
    // codebase. Always write the canonical kebab token; Stream A's read-back
    // shim in `with-engine.ts` normalizes legacy values for older configs.
    await workspaceProvider.setConfiguration(
      'ptah',
      'authMethod',
      'claude-cli',
    );

    await formatter.writeNotification('auth.login.complete', {
      provider: 'claude-cli',
      success: true,
      authMethod: 'claude-cli',
      cliPath: health.path,
      cliVersion: health.version,
      platform: health.platform,
      isWSL: health.isWSL,
    });
    return ExitCode.Success;
  });
}

/**
 * `auth login codex` — drives `codex login --device-auth` via cross-spawn.
 *
 * The Codex CLI prints a `https://...` device-code URL to its own stdout.
 * We surface that URL via `auth.login.url` so JSON-RPC peers (and humans
 * via `--human`) get a consistent envelope, then wait for the child to
 * exit. SIGINT is propagated to the child so Ctrl-C cleanly cancels the
 * device-code flow.
 *
 * On exit code 0 we emit `auth.login.complete{ success: true }`. On any
 * non-zero exit we emit `task.error{ ptah_code: 'auth_required' }` and
 * return `ExitCode.AuthRequired` (the operator never finished the flow).
 */
async function runCodexLogin(
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: AuthStderrLike,
  _engine: typeof withEngine,
  hooks: AuthExecuteHooks,
): Promise<number> {
  await formatter.writeNotification('auth.login.start', {
    provider: 'codex',
    timestamp: new Date().toISOString(),
  });

  const spawn =
    hooks.spawnCodexLogin ??
    ((binary: string, args: string[], options: { env?: NodeJS.ProcessEnv }) =>
      spawnCli(binary, args, {
        env: options.env,
      }) as unknown as CodexChildLike);

  let child: CodexChildLike;
  try {
    child = spawn('codex', ['login', '--device-auth'], { env: process.env });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await formatter.writeNotification('task.error', {
      provider: 'codex',
      ptah_code: 'auth_required',
      message: `Failed to spawn 'codex login --device-auth': ${message}`,
    });
    stderr.write(
      'Failed to spawn `codex login --device-auth`. Ensure the codex CLI ' +
        'is installed and on PATH.\n',
    );
    return ExitCode.AuthRequired;
  }

  // Capture stdout to detect the device-code URL. We surface the FIRST
  // https:// URL we see via `auth.login.url`; subsequent output is only
  // mirrored to stderr (so humans driving the flow see codex's prompts).
  let urlEmitted = false;
  let stdoutBuffer = '';
  const urlPattern = /(https?:\/\/[^\s'"<>]+)/;

  const onStdoutData = async (chunk: Buffer | string): Promise<void> => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    stdoutBuffer += text;
    // Mirror codex output to stderr so humans see the prompts.
    stderr.write(text);
    if (!urlEmitted) {
      const match = urlPattern.exec(stdoutBuffer);
      if (match) {
        urlEmitted = true;
        await formatter.writeNotification('auth.login.url', {
          provider: 'codex',
          verification_uri: match[1],
          opened: false,
          message: 'Open the URL above in a browser to complete codex login.',
        });
      }
    }
  };

  if (child.stdout) {
    child.stdout.on('data', (chunk) => {
      // Fire-and-forget — async errors surface via the formatter elsewhere.
      void onStdoutData(chunk);
    });
  }
  if (child.stderr) {
    child.stderr.on('data', (chunk) => {
      const text =
        typeof chunk === 'string' ? chunk : (chunk as Buffer).toString('utf8');
      stderr.write(text);
    });
  }

  // SIGINT propagation: forward Ctrl-C to the child so the device-code flow
  // cancels cleanly. We attach a one-shot handler and remove it on exit.
  const sigintSource: NodeJS.EventEmitter = hooks.processRefForCodex ?? process;
  const onSigint = (): void => {
    try {
      child.kill('SIGINT');
    } catch {
      // Ignore — child may already be dead.
    }
  };
  sigintSource.on('SIGINT', onSigint);

  const exitCode = await new Promise<number>((resolve) => {
    let settled = false;
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      resolve(typeof code === 'number' ? code : 1);
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      stderr.write(`codex login error: ${err.message}\n`);
      resolve(1);
    });
  });

  // Detach the SIGINT handler.
  sigintSource.removeListener('SIGINT', onSigint);

  if (exitCode === 0) {
    await formatter.writeNotification('auth.login.complete', {
      provider: 'codex',
      success: true,
    });
    return ExitCode.Success;
  }

  await formatter.writeNotification('task.error', {
    provider: 'codex',
    ptah_code: 'auth_required',
    message: `codex login --device-auth exited with code ${exitCode}`,
  });
  return ExitCode.AuthRequired;
}

/**
 * Drive the Copilot device-code flow via `headless-flow.ts`. Composes a
 * JsonRpc opener if a peer is attached on stdio, otherwise a stderr opener.
 *
 * For the one-shot CLI command (no `interact` mode), we always fall back to
 * the stderr opener — `interact` is the only context where a JSON-RPC peer
 * round-trips on stdio, and `auth login copilot` is invoked as a one-shot.
 */
async function runCopilotLogin(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
  hooks: AuthExecuteHooks,
): Promise<number> {
  const headless = hooks.runHeadlessLogin ?? runHeadlessLogin;

  return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
    // Resolve CopilotAuthService directly from the container — we need the
    // begin/poll/cancel methods, which are not exposed via the RPC surface.
    // The hook lets tests inject a mock without touching the container.
    const copilotAuth = await (hooks.resolveCopilotAuth
      ? hooks.resolveCopilotAuth(ctx.container)
      : ctx.container.resolve<ICopilotAuthService>(
          SDK_TOKENS.SDK_COPILOT_AUTH,
        ));

    // One-shot CLI commands have no JSON-RPC peer on stdio (that's `interact`
    // mode only). Surface the URL via stderr so a human operator can complete
    // the device-code flow manually.
    const opener = new StderrOAuthUrlOpener();

    const result = await headless({
      provider: 'copilot',
      copilotAuth,
      opener,
      formatter,
      processRef: hooks.processRef,
    });
    return result.exitCode;
  });
}

// ---------------------------------------------------------------------------
// `auth logout [copilot|codex]`
// ---------------------------------------------------------------------------

async function runLogout(
  opts: AuthOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: AuthStderrLike,
  engine: typeof withEngine,
  hooks: AuthExecuteHooks,
): Promise<number> {
  const provider = (opts.provider ?? '').toLowerCase();
  if (!provider) {
    stderr.write('ptah auth logout: provider is required\n');
    return ExitCode.UsageError;
  }

  if (provider === 'copilot') {
    return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
      await callRpc(ctx.transport, 'auth:copilotLogout', {});
      await formatter.writeNotification('auth.logout.complete', {
        provider: 'copilot',
        success: true,
      });
      return ExitCode.Success;
    });
  }

  if (provider === 'codex') {
    if (!opts.force) {
      stderr.write(
        'ptah auth logout codex: pass --force to delete ~/.codex/auth.json\n',
      );
      return ExitCode.UsageError;
    }
    const codexPath =
      hooks.codexAuthPath ?? pathJoin(homedir(), '.codex', 'auth.json');
    const unlink = hooks.unlinkFile ?? ((p: string) => fs.unlink(p));
    try {
      await unlink(codexPath);
    } catch (error) {
      // ENOENT is benign — logout is idempotent.
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== 'ENOENT') {
        const message = error instanceof Error ? error.message : String(error);
        await formatter.writeNotification('task.error', {
          provider: 'codex',
          ptah_code: 'internal_failure',
          message,
        });
        return ExitCode.InternalFailure;
      }
    }
    await formatter.writeNotification('auth.logout.complete', {
      provider: 'codex',
      success: true,
      path: codexPath,
    });
    return ExitCode.Success;
  }

  stderr.write(`ptah auth logout: unsupported provider '${provider}'\n`);
  return ExitCode.UsageError;
}

// ---------------------------------------------------------------------------
// `auth test <provider>`
// ---------------------------------------------------------------------------

async function runTest(
  opts: AuthOptions,
  formatter: Formatter,
  globals: GlobalOptions,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<unknown>(
      ctx.transport,
      'auth:testConnection',
      undefined,
    );
    await formatter.writeNotification('auth.test.result', {
      provider: opts.provider ?? 'unknown',
      ...((typeof result === 'object' && result !== null
        ? (result as Record<string, unknown>)
        : {}) as Record<string, unknown>),
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// `auth use <providerId>`
// ---------------------------------------------------------------------------

/**
 * Provider-id → settings-shape resolution table for `ptah auth use`.
 *
 * The CLI writes three coordinated keys under the `ptah` config namespace:
 *
 *   - `authMethod`            — strategy selector consumed by `resolveStrategy`.
 *                               One of `'claude-cli' | 'oauth' | 'apiKey'`.
 *   - `defaultProvider`       — the provider id consumed by the SDK adapter
 *                               when `authMethod !== 'oauth'`. For oauth flows
 *                               this is the anthropic-compatible upstream
 *                               (`'anthropic'`) so the proxy still routes
 *                               messages.create requests correctly.
 *   - `anthropicProviderId`   — the bridge provider id used by the oauth
 *                               proxy to forge upstream calls. Only relevant
 *                               for `authMethod=oauth`. Cleared (set to
 *                               `null`) for non-oauth strategies.
 *
 * The mapping below is intentionally narrow — only the providers the doctor
 * surface and the marketplace agree on are accepted. Extending it requires a
 * new `auth.use.applied` payload field, so it must stay in lockstep with the
 * `task-description.md` §3.1 `auth use` table.
 */
interface AuthUsePlan {
  authMethod: 'claude-cli' | 'oauth' | 'apiKey';
  defaultProvider: string;
  anthropicProviderId: string | null;
}

function resolveAuthUsePlan(providerId: string): AuthUsePlan | null {
  const id = providerId.toLowerCase().trim();
  switch (id) {
    case 'claude-cli':
    case 'claude':
      return {
        authMethod: 'claude-cli',
        defaultProvider: 'anthropic',
        anthropicProviderId: null,
      };
    case 'github-copilot':
    case 'copilot':
      return {
        authMethod: 'oauth',
        defaultProvider: 'anthropic',
        anthropicProviderId: 'github-copilot',
      };
    case 'openai-codex':
    case 'codex':
      return {
        authMethod: 'oauth',
        defaultProvider: 'anthropic',
        anthropicProviderId: 'openai-codex',
      };
    case 'openrouter':
      return {
        authMethod: 'apiKey',
        defaultProvider: 'openrouter',
        anthropicProviderId: null,
      };
    case 'moonshot':
      return {
        authMethod: 'apiKey',
        defaultProvider: 'moonshot',
        anthropicProviderId: null,
      };
    case 'z-ai':
    case 'zai':
      return {
        authMethod: 'apiKey',
        defaultProvider: 'z-ai',
        anthropicProviderId: null,
      };
    default:
      return null;
  }
}

/**
 * `auth use <providerId>` — switch the active auth strategy without going
 * through a full login flow. This is the headless equivalent of the
 * "Switch Provider" UX in the VS Code/Electron settings panel.
 *
 * Writes three settings via `IWorkspaceProvider.setConfiguration`:
 *   - ptah.authMethod
 *   - ptah.defaultProvider
 *   - ptah.anthropicProviderId
 *
 * Each key is part of `FILE_BASED_SETTINGS_KEYS` so writes are routed to
 * `~/.ptah/settings.json` automatically (transparent to the caller).
 *
 * Does NOT remove or invalidate existing OAuth tokens or API keys — it only
 * mutates which strategy the SDK selects on next bootstrap. Use
 * `ptah auth logout <provider>` to revoke credentials.
 */
async function runUse(
  opts: AuthOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: AuthStderrLike,
  engine: typeof withEngine,
  hooks: AuthExecuteHooks,
): Promise<number> {
  const providerId = (opts.providerId ?? '').trim();
  if (!providerId) {
    stderr.write('ptah auth use: <providerId> is required\n');
    return ExitCode.UsageError;
  }

  const plan = resolveAuthUsePlan(providerId);
  if (!plan) {
    stderr.write(
      `ptah auth use: unsupported provider '${providerId}'. ` +
        'Accepted: claude-cli, github-copilot, openai-codex, openrouter, moonshot, z-ai\n',
    );
    return ExitCode.UsageError;
  }

  return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
    const workspaceProvider = await (hooks.resolveWorkspaceProvider
      ? hooks.resolveWorkspaceProvider(ctx.container)
      : (ctx.container.resolve(
          PLATFORM_TOKENS.WORKSPACE_PROVIDER,
        ) as AuthWorkspaceProviderLike));

    if (typeof workspaceProvider.setConfiguration !== 'function') {
      await formatter.writeNotification('task.error', {
        ptah_code: 'internal_failure',
        message:
          'IWorkspaceProvider.setConfiguration is not available on this platform',
      });
      return ExitCode.InternalFailure;
    }

    // Write all three keys before emitting the notification so callers see a
    // consistent post-state. Order matters less here than atomicity within
    // ~/.ptah/settings.json — `PtahFileSettingsManager` serializes writes.
    await workspaceProvider.setConfiguration(
      'ptah',
      'authMethod',
      plan.authMethod,
    );
    await workspaceProvider.setConfiguration(
      'ptah',
      'defaultProvider',
      plan.defaultProvider,
    );
    await workspaceProvider.setConfiguration(
      'ptah',
      'anthropicProviderId',
      plan.anthropicProviderId,
    );

    await formatter.writeNotification('auth.use.applied', {
      providerId,
      authMethod: plan.authMethod,
      defaultProvider: plan.defaultProvider,
      anthropicProviderId: plan.anthropicProviderId,
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// `auth set-anthropic-route <providerId>`
// ---------------------------------------------------------------------------

/**
 * `ptah auth set-anthropic-route <providerId>`.
 *
 * Headless-friendly setter for the `anthropicProviderId` config key — i.e.
 * which Anthropic-compatible bridge the SDK should route `messages.create`
 * traffic through when the agent talks to Claude. Mirrors the "Anthropic
 * route" picker in the Settings webview.
 *
 * Pass `default` (or an empty string / `null`) to clear the override and
 * fall back to direct Anthropic. Any other value is validated against the
 * `ANTHROPIC_PROVIDERS` registry; unknown ids are rejected with a
 * `did-you-mean?` suggestion via Levenshtein distance.
 *
 * Writes only `anthropicProviderId` — `authMethod` and `defaultProvider`
 * are left untouched so existing OAuth/CLI strategies keep working. Use
 * `ptah auth use` if you need to flip the strategy as well.
 */
async function runSetAnthropicRoute(
  opts: AuthOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: AuthStderrLike,
  engine: typeof withEngine,
  hooks: AuthExecuteHooks,
): Promise<number> {
  const raw = (opts.providerId ?? '').trim();
  if (!raw) {
    stderr.write(
      'ptah auth set-anthropic-route: <providerId> is required ' +
        '(use `default` to clear)\n',
    );
    return ExitCode.UsageError;
  }

  const validIds = ANTHROPIC_PROVIDERS.map((p) => p.id);
  const lowered = raw.toLowerCase();

  // Treat "default" / "none" / "clear" / "null" as a clear instruction.
  const isClear =
    lowered === 'default' ||
    lowered === 'none' ||
    lowered === 'clear' ||
    lowered === 'null';

  let nextValue: string | null;
  let displayValue: string;

  if (isClear) {
    nextValue = null;
    displayValue = '(default)';
  } else if (validIds.includes(lowered)) {
    nextValue = lowered;
    displayValue = lowered;
  } else {
    const suggestion = suggestClosest(lowered, validIds, 2);
    const hint = suggestion ? ` Did you mean '${suggestion}'?` : '';
    stderr.write(
      `ptah auth set-anthropic-route: unknown providerId '${raw}'.${hint} ` +
        `Available: default, ${validIds.join(', ')}\n`,
    );
    return ExitCode.UsageError;
  }

  return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
    const workspaceProvider = await (hooks.resolveWorkspaceProvider
      ? hooks.resolveWorkspaceProvider(ctx.container)
      : (ctx.container.resolve(
          PLATFORM_TOKENS.WORKSPACE_PROVIDER,
        ) as AuthWorkspaceProviderLike));

    if (typeof workspaceProvider.setConfiguration !== 'function') {
      await formatter.writeNotification('task.error', {
        ptah_code: 'internal_failure',
        message:
          'IWorkspaceProvider.setConfiguration is not available on this platform',
      });
      return ExitCode.InternalFailure;
    }

    await workspaceProvider.setConfiguration(
      'ptah',
      'anthropicProviderId',
      nextValue,
    );

    await formatter.writeNotification('auth.set_anthropic_route.applied', {
      anthropicProviderId: nextValue,
      display: displayValue,
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Thin wrapper around `transport.call` that throws on RPC error (so the
 * outer try/catch in `execute` can convert to an exit code) and returns
 * the unwrapped `data` payload on success. The CLI always treats an absent
 * `data` field as `null` (most read-only RPC methods return objects).
 */
async function callRpc<T = unknown>(
  transport: CliMessageTransport,
  method: string,
  params: unknown,
): Promise<T> {
  const response = await transport.call<unknown, T>(method, params);
  if (!response.success) {
    const err = new Error(response.error ?? `${method} failed`);
    if (response.errorCode) {
      (err as unknown as { code: string }).code = response.errorCode;
    }
    throw err;
  }
  return (response.data as T) ?? (null as unknown as T);
}

/** Re-export so tests can use the same JsonRpcServer reference if needed. */
export { JsonRpcServer, JsonRpcOAuthUrlOpener };
