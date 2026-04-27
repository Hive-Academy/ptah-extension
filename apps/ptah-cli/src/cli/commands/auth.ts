/**
 * `ptah auth` command — sub-dispatcher for status / login / logout / test.
 *
 * TASK_2026_104 Batch 8d.
 *
 * Sub-commands (per task-description.md §3.1 and B8_EXPANSION.md §3):
 *
 *   status                — Read-only. Calls `auth:getAuthStatus` +
 *                           `auth:getHealth` + `auth:getApiKeyStatus`.
 *                           Redacts API keys unless `--reveal`.
 *   login copilot         — Headless device-code OAuth via `headless-flow.ts`.
 *                           Composes JsonRpc opener if a peer is attached,
 *                           stderr opener otherwise.
 *   login codex           — Out-of-band: prints instructions to stderr.
 *                           Codex login writes `~/.codex/auth.json` itself.
 *   login claude          — Settings-based: prints "use provider set-key".
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
  SDK_TOKENS,
  type ICopilotAuthService,
} from '@ptah-extension/agent-sdk';

import { withEngine } from '../bootstrap/with-engine.js';
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
export type AuthSubcommand = 'status' | 'login' | 'logout' | 'test';

/** Providers accepted by `auth login` / `auth logout` / `auth test`. */
export type AuthProvider =
  | 'copilot'
  | 'codex'
  | 'claude'
  | 'anthropic'
  | string;

export interface AuthOptions {
  subcommand: AuthSubcommand;
  /** For login/logout/test sub-commands. */
  provider?: AuthProvider;
  /** For `logout codex --force`: skip confirmation. */
  force?: boolean;
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
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const transport = ctx.transport;

    const status = await callRpc(transport, 'auth:getAuthStatus', {});
    const health = await callRpc(transport, 'auth:getHealth', undefined);
    const apiKey = await callRpc(transport, 'auth:getApiKeyStatus', {});

    const reveal = globals.reveal === true;
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
    // Out-of-band login. We DO emit the lifecycle notifications so machine
    // consumers see consistent envelopes, but we do not poll — the user must
    // re-run `ptah auth status` to confirm completion.
    await formatter.writeNotification('auth.login.start', {
      provider,
      timestamp: new Date().toISOString(),
    });
    const url = 'https://platform.openai.com/account/codex';
    await formatter.writeNotification('auth.login.url', {
      provider,
      verification_uri: url,
      opened: false,
      message: 'Run `codex login --device-auth` in a terminal to authenticate.',
    });
    stderr.write(
      'Run `codex login --device-auth` in a terminal, then re-run ' +
        '`ptah auth status` to verify.\n',
    );
    return ExitCode.Success;
  }

  if (provider === 'claude' || provider === 'anthropic') {
    // Settings-based: print the canonical command for setting the key.
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

  return engine(globals, { mode: 'full' }, async (ctx) => {
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
    return engine(globals, { mode: 'full' }, async (ctx) => {
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
