/**
 * `ptah gateway` command — messaging-gateway operations.
 *
 * Thin `withEngine({ thoth: 'oneshot' })` wrapper over the `gateway:*` RPC
 * namespace exposed in-process over the CLI transport.
 *
 *   status                      RPC `gateway:status`         -> gateway.status
 *   start                       RPC `gateway:start`          -> gateway.started
 *   stop                        RPC `gateway:stop`           -> gateway.stopped
 *   set-token <platform>        RPC `gateway:setToken`       -> gateway.token_set
 *   bindings                    RPC `gateway:listBindings`   -> gateway.bindings
 *   approve <bindingId>         RPC `gateway:approveBinding` -> gateway.binding_approved
 *   block <bindingId>           RPC `gateway:blockBinding`   -> gateway.binding_blocked
 *   messages                    RPC `gateway:listMessages`   -> gateway.messages
 *   test <platform>             RPC `gateway:test`           -> gateway.test
 *
 * `set-token` reads the secret from STDIN only (`--stdin`, the machine-mode
 * default) or an interactive masked prompt under `--human` on a real TTY. The
 * secret is NEVER accepted on argv (it would leak through process listings and
 * shell history) and never echoed into logs or NDJSON output.
 *
 * `start` under the one-shot tier emits an honest `adaptersLive: false` notice:
 * adapters only run live while a long-running Ptah host (`ptah interact` /
 * `ptah session start` / Ptah desktop) is alive.
 */

import type { Readable } from 'node:stream';

import { withEngine } from '../bootstrap/with-engine.js';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import { callRpc, oneshot } from './thoth-command-shared.js';
import type {
  GatewayApproveBindingResult,
  GatewayBlockBindingResult,
  GatewayListBindingsResult,
  GatewayListMessagesResult,
  GatewayPlatformId,
  GatewaySetTokenParams,
  GatewayStatusResult,
  GatewayTestResult,
} from '@ptah-extension/shared';

export type GatewaySubcommand =
  | 'status'
  | 'start'
  | 'stop'
  | 'set-token'
  | 'bindings'
  | 'approve'
  | 'block'
  | 'messages'
  | 'test';

export interface GatewayOptions {
  subcommand: GatewaySubcommand;
  /** For `set-token` / `test` / `start` / `stop` — platform identifier. */
  platform?: string;
  /** For `bindings` — optional platform filter. */
  filterPlatform?: string;
  /** For `bindings` — optional approval-status filter. */
  status?: string;
  /** For `approve` / `block` / `messages` — binding id. */
  bindingId?: string;
  /** For `approve` — 6-digit pairing code from the bot message. */
  code?: string;
  /** For `block` — terminal state override. */
  blockStatus?: string;
  /** For `messages` — page size. */
  limit?: number;
  /** For `messages` — cursor (createdAt <). */
  before?: number;
  /** For `test` — binding override. */
  testBindingId?: string;
  /** For `set-token` — read the secret from stdin (machine-mode default). */
  stdin?: boolean;
}

export interface GatewayStderrLike {
  write(chunk: string): boolean;
}

export interface GatewayPasswordPrompter {
  password(args: { message: string }): Promise<string | symbol>;
  isCancel(value: unknown): value is symbol;
}

export interface GatewayExecuteHooks {
  stderr?: GatewayStderrLike;
  formatter?: Formatter;
  withEngine?: typeof withEngine;
  /** Override stdin (used by `set-token --stdin`). */
  stdin?: Readable;
  /** Maximum wait for the stdin drain before aborting (default 30000ms). */
  stdinTimeoutMs?: number;
  /** Override the masked prompt (used by `set-token` under `--human` TTY). */
  prompter?: GatewayPasswordPrompter;
  /** Override TTY detection for the masked-prompt path. */
  isInteractive?: () => boolean;
}

const VALID_PLATFORMS: readonly GatewayPlatformId[] = [
  'telegram',
  'discord',
  'slack',
];
const VALID_APPROVAL_STATUSES: readonly string[] = [
  'pending',
  'approved',
  'rejected',
  'revoked',
];
const VALID_BLOCK_STATUSES: readonly string[] = ['rejected', 'revoked'];

const ADAPTERS_LIVE_NOTICE =
  'adapters serve while a long-running Ptah process (ptah interact / ptah session start / Ptah desktop) is alive';

export async function execute(
  opts: GatewayOptions,
  globals: GlobalOptions,
  hooks: GatewayExecuteHooks = {},
): Promise<number> {
  const formatter = hooks.formatter ?? buildFormatter(globals);
  const stderr: GatewayStderrLike = hooks.stderr ?? process.stderr;
  const engine = hooks.withEngine ?? withEngine;

  try {
    switch (opts.subcommand) {
      case 'status':
        return await runStatus(globals, formatter, engine);
      case 'start':
        return await runStart(opts, globals, formatter, stderr, engine);
      case 'stop':
        return await runStop(opts, globals, formatter, stderr, engine);
      case 'set-token':
        return await runSetToken(
          opts,
          globals,
          formatter,
          stderr,
          engine,
          hooks,
        );
      case 'bindings':
        return await runBindings(opts, globals, formatter, stderr, engine);
      case 'approve':
        return await runApprove(opts, globals, formatter, stderr, engine);
      case 'block':
        return await runBlock(opts, globals, formatter, stderr, engine);
      case 'messages':
        return await runMessages(opts, globals, formatter, stderr, engine);
      case 'test':
        return await runTest(opts, globals, formatter, stderr, engine);
      default:
        stderr.write(
          `ptah gateway: unknown sub-command '${String(opts.subcommand)}'\n`,
        );
        return ExitCode.UsageError;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await formatter.writeNotification('task.error', {
      ptah_code: 'internal_failure',
      message,
    });
    return ExitCode.InternalFailure;
  }
}

async function runStatus(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, oneshot(), async (ctx) => {
    const result = await callRpc<GatewayStatusResult>(
      ctx.transport,
      'gateway:status',
      {},
    );
    await formatter.writeNotification('gateway.status', {
      enabled: result?.enabled ?? false,
      adapters: (result?.adapters ?? []).map((a) => ({ ...a, running: false })),
      adaptersLive: false,
    });
    return ExitCode.Success;
  });
}

async function runStart(
  opts: GatewayOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: GatewayStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  const platform = optionalPlatform(opts.platform, stderr, 'start');
  if (platform === false) return ExitCode.UsageError;

  return engine(globals, oneshot(), async (ctx) => {
    const params: { platform?: GatewayPlatformId } = {};
    if (platform !== undefined) params.platform = platform;

    await callRpc(ctx.transport, 'gateway:start', params);
    await formatter.writeNotification('gateway.started', {
      adaptersLive: false,
      startConfirmed: false,
      notice: ADAPTERS_LIVE_NOTICE,
    });
    return ExitCode.Success;
  });
}

async function runStop(
  opts: GatewayOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: GatewayStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  const platform = optionalPlatform(opts.platform, stderr, 'stop');
  if (platform === false) return ExitCode.UsageError;

  return engine(globals, oneshot(), async (ctx) => {
    const params: { platform?: GatewayPlatformId } = {};
    if (platform !== undefined) params.platform = platform;

    await callRpc(ctx.transport, 'gateway:stop', params);
    await formatter.writeNotification('gateway.stopped', { ok: true });
    return ExitCode.Success;
  });
}

async function runSetToken(
  opts: GatewayOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: GatewayStderrLike,
  engine: typeof withEngine,
  hooks: GatewayExecuteHooks,
): Promise<number> {
  const platform = requirePlatform(opts.platform, stderr, 'set-token');
  if (platform === null) return ExitCode.UsageError;

  const interactive = (hooks.isInteractive ?? defaultIsInteractive)(globals);
  const useStdin = opts.stdin === true || !interactive;

  let secret: string;
  let slackAppToken: string | undefined;

  if (useStdin) {
    const timeoutMs = hooks.stdinTimeoutMs ?? 30000;
    const raw = await readAllStream(hooks.stdin ?? process.stdin, timeoutMs);
    if (raw === STDIN_TIMEOUT) {
      stderr.write(
        `ptah gateway set-token: timed out after ${timeoutMs}ms waiting for stdin\n`,
      );
      return ExitCode.UsageError;
    }
    const lines = raw.split(/\r?\n/).filter((line) => line.length > 0);
    secret = (lines[0] ?? '').trim();
    if (platform === 'slack' && lines.length > 1) {
      slackAppToken = (lines[1] ?? '').trim();
    }
  } else {
    const prompter = hooks.prompter;
    if (!prompter) {
      stderr.write(
        'ptah gateway set-token: no masked prompt available — pipe the token via --stdin\n',
      );
      return ExitCode.UsageError;
    }
    const entered = await prompter.password({
      message: `Paste the ${platform} bot token`,
    });
    if (prompter.isCancel(entered)) {
      stderr.write('ptah gateway set-token: cancelled\n');
      return ExitCode.UsageError;
    }
    secret = String(entered).trim();
    if (platform === 'slack') {
      const app = await prompter.password({
        message: 'Paste the Slack app-level token (xapp-...)',
      });
      if (prompter.isCancel(app)) {
        stderr.write('ptah gateway set-token: cancelled\n');
        return ExitCode.UsageError;
      }
      const appTrimmed = String(app).trim();
      if (appTrimmed.length > 0) slackAppToken = appTrimmed;
    }
  }

  if (secret.length === 0) {
    stderr.write('ptah gateway set-token: empty token\n');
    return ExitCode.UsageError;
  }

  return engine(globals, oneshot(), async (ctx) => {
    const params: GatewaySetTokenParams = { platform, token: secret };
    if (slackAppToken !== undefined) params.slackAppToken = slackAppToken;

    await callRpc(ctx.transport, 'gateway:setToken', params);
    await formatter.writeNotification('gateway.token_set', {
      platform,
      ok: true,
      slackAppToken: slackAppToken !== undefined,
    });
    return ExitCode.Success;
  });
}

async function runBindings(
  opts: GatewayOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: GatewayStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  const platform = optionalPlatform(opts.filterPlatform, stderr, 'bindings');
  if (platform === false) return ExitCode.UsageError;

  if (
    opts.status !== undefined &&
    !VALID_APPROVAL_STATUSES.includes(opts.status)
  ) {
    stderr.write(
      `ptah gateway bindings: --status must be one of ${VALID_APPROVAL_STATUSES.join('|')}\n`,
    );
    return ExitCode.UsageError;
  }

  return engine(globals, oneshot(), async (ctx) => {
    const params: { platform?: GatewayPlatformId; status?: string } = {};
    if (platform !== undefined) params.platform = platform;
    if (opts.status !== undefined) params.status = opts.status;

    const result = await callRpc<GatewayListBindingsResult>(
      ctx.transport,
      'gateway:listBindings',
      params,
    );
    await formatter.writeNotification('gateway.bindings', {
      bindings: result?.bindings ?? [],
    });
    return ExitCode.Success;
  });
}

async function runApprove(
  opts: GatewayOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: GatewayStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  const bindingId = requireBindingId(opts, stderr, 'approve');
  if (bindingId === null) return ExitCode.UsageError;
  if (!opts.code || opts.code.trim().length === 0) {
    stderr.write('ptah gateway approve: --code <pairing-code> is required\n');
    return ExitCode.UsageError;
  }
  const code = opts.code.trim();

  return engine(globals, oneshot(), async (ctx) => {
    const result = await callRpc<GatewayApproveBindingResult>(
      ctx.transport,
      'gateway:approveBinding',
      { bindingId, code },
    );
    await formatter.writeNotification('gateway.binding_approved', {
      bindingId,
      ok: result?.ok ?? false,
      binding: result?.ok === true ? result.binding : null,
      error: result?.ok === false ? result.error : null,
    });
    if (result?.ok === false) return ExitCode.UsageError;
    return ExitCode.Success;
  });
}

async function runBlock(
  opts: GatewayOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: GatewayStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  const bindingId = requireBindingId(opts, stderr, 'block');
  if (bindingId === null) return ExitCode.UsageError;
  if (
    opts.blockStatus !== undefined &&
    !VALID_BLOCK_STATUSES.includes(opts.blockStatus)
  ) {
    stderr.write(
      `ptah gateway block: --status must be one of ${VALID_BLOCK_STATUSES.join('|')}\n`,
    );
    return ExitCode.UsageError;
  }

  return engine(globals, oneshot(), async (ctx) => {
    const params: { bindingId: string; status?: 'rejected' | 'revoked' } = {
      bindingId,
    };
    if (opts.blockStatus !== undefined) {
      params.status = opts.blockStatus as 'rejected' | 'revoked';
    }

    const result = await callRpc<GatewayBlockBindingResult>(
      ctx.transport,
      'gateway:blockBinding',
      params,
    );
    await formatter.writeNotification('gateway.binding_blocked', {
      bindingId,
      binding: result?.binding ?? null,
    });
    return ExitCode.Success;
  });
}

async function runMessages(
  opts: GatewayOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: GatewayStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  const bindingId = requireBindingId(opts, stderr, 'messages');
  if (bindingId === null) return ExitCode.UsageError;

  return engine(globals, oneshot(), async (ctx) => {
    const params: { bindingId: string; limit?: number; before?: number } = {
      bindingId,
    };
    if (opts.limit !== undefined) params.limit = opts.limit;
    if (opts.before !== undefined) params.before = opts.before;

    const result = await callRpc<GatewayListMessagesResult>(
      ctx.transport,
      'gateway:listMessages',
      params,
    );
    await formatter.writeNotification('gateway.messages', {
      bindingId,
      messages: result?.messages ?? [],
    });
    return ExitCode.Success;
  });
}

async function runTest(
  opts: GatewayOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: GatewayStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  const platform = requirePlatform(opts.platform, stderr, 'test');
  if (platform === null) return ExitCode.UsageError;

  return engine(globals, oneshot(), async (ctx) => {
    const params: { platform: GatewayPlatformId; bindingId?: string } = {
      platform,
    };
    if (opts.testBindingId !== undefined) {
      params.bindingId = opts.testBindingId;
    }

    const result = await callRpc<GatewayTestResult>(
      ctx.transport,
      'gateway:test',
      params,
    );
    await formatter.writeNotification('gateway.test', {
      platform,
      ok: result?.ok ?? false,
      bindingId: result?.ok === true ? result.bindingId : null,
      externalMsgId: result?.ok === true ? result.externalMsgId : null,
      error: result?.ok === false ? result.error : null,
    });
    if (result?.ok === false) return ExitCode.UsageError;
    return ExitCode.Success;
  });
}

function defaultIsInteractive(globals: GlobalOptions): boolean {
  if (globals.json === true) return false;
  if (globals.quiet === true) return false;
  return process.stdout.isTTY === true;
}

function requirePlatform(
  value: string | undefined,
  stderr: GatewayStderrLike,
  verb: string,
): GatewayPlatformId | null {
  if (!value || value.trim().length === 0) {
    stderr.write(
      `ptah gateway ${verb}: <platform> is required (${VALID_PLATFORMS.join('|')})\n`,
    );
    return null;
  }
  if (!isPlatform(value)) {
    stderr.write(
      `ptah gateway ${verb}: unknown platform '${value}' (${VALID_PLATFORMS.join('|')})\n`,
    );
    return null;
  }
  return value;
}

function optionalPlatform(
  value: string | undefined,
  stderr: GatewayStderrLike,
  verb: string,
): GatewayPlatformId | undefined | false {
  if (value === undefined) return undefined;
  if (!isPlatform(value)) {
    stderr.write(
      `ptah gateway ${verb}: unknown platform '${value}' (${VALID_PLATFORMS.join('|')})\n`,
    );
    return false;
  }
  return value;
}

function isPlatform(value: string): value is GatewayPlatformId {
  return (VALID_PLATFORMS as readonly string[]).includes(value);
}

function requireBindingId(
  opts: GatewayOptions,
  stderr: GatewayStderrLike,
  verb: string,
): string | null {
  if (!opts.bindingId || opts.bindingId.trim().length === 0) {
    stderr.write(`ptah gateway ${verb}: <bindingId> is required\n`);
    return null;
  }
  return opts.bindingId.trim();
}

const STDIN_TIMEOUT = Symbol('stdin-timeout');

async function readAllStream(
  stream: Readable,
  timeoutMs: number,
): Promise<string | typeof STDIN_TIMEOUT> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<typeof STDIN_TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(STDIN_TIMEOUT), timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
  });

  const drain = (async (): Promise<string> => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  })();

  try {
    return await Promise.race([drain, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
