/**
 * `ptah cron` command — scheduled-job operations.
 *
 * Thin `withEngine({ thoth: 'oneshot' })` wrapper over the `cron:*` RPC
 * namespace exposed in-process over the CLI transport.
 *
 *   list [--enabled-only]                 RPC `cron:list`     -> cron.list
 *   get <id>                              RPC `cron:get`      -> cron.job
 *   create --name --cron-expr --prompt    RPC `cron:create`   -> cron.created
 *   update <id> [patch flags]             RPC `cron:update`   -> cron.updated
 *   delete <id>                           RPC `cron:delete`   -> cron.deleted
 *   toggle <id> --enabled <bool>          RPC `cron:toggle`   -> cron.toggled
 *   run-now <id>                          RPC `cron:runNow`   -> cron.run
 *   runs <id> [--limit --offset]          RPC `cron:runs`     -> cron.runs
 *   next-fire <id>                        RPC `cron:nextFire` -> cron.next_fire
 */

import { withEngine } from '../bootstrap/with-engine.js';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';
import type {
  CronCreateParams,
  CronCreateResult,
  CronDeleteResult,
  CronGetResult,
  CronListResult,
  CronNextFireResult,
  CronRunNowResult,
  CronRunsResult,
  CronToggleResult,
  CronUpdateParams,
  CronUpdateResult,
} from '@ptah-extension/shared';

export type CronSubcommand =
  | 'list'
  | 'get'
  | 'create'
  | 'update'
  | 'delete'
  | 'toggle'
  | 'run-now'
  | 'runs'
  | 'next-fire';

export interface CronOptions {
  subcommand: CronSubcommand;
  /** For `get` / `update` / `delete` / `toggle` / `run-now` / `runs` / `next-fire`. */
  id?: string;
  /** For `list` — restrict to enabled jobs. */
  enabledOnly?: boolean;
  /** For `create` / `update`. */
  name?: string;
  /** For `create` / `update`. */
  cronExpr?: string;
  /** For `create` / `update`. */
  prompt?: string;
  /** For `create` / `update`. */
  timezone?: string;
  /** For `create` / `update`. */
  workspaceRoot?: string;
  /** For `create` / `update` / `toggle`. */
  enabled?: boolean;
  /** For `runs` — page size. */
  limit?: number;
  /** For `runs` — page offset. */
  offset?: number;
}

export interface CronStderrLike {
  write(chunk: string): boolean;
}

export interface CronExecuteHooks {
  stderr?: CronStderrLike;
  formatter?: Formatter;
  withEngine?: typeof withEngine;
}

export async function execute(
  opts: CronOptions,
  globals: GlobalOptions,
  hooks: CronExecuteHooks = {},
): Promise<number> {
  const formatter = hooks.formatter ?? buildFormatter(globals);
  const stderr: CronStderrLike = hooks.stderr ?? process.stderr;
  const engine = hooks.withEngine ?? withEngine;

  try {
    switch (opts.subcommand) {
      case 'list':
        return await runList(opts, globals, formatter, engine);
      case 'get':
        return await runGet(opts, globals, formatter, stderr, engine);
      case 'create':
        return await runCreate(opts, globals, formatter, stderr, engine);
      case 'update':
        return await runUpdate(opts, globals, formatter, stderr, engine);
      case 'delete':
        return await runDelete(opts, globals, formatter, stderr, engine);
      case 'toggle':
        return await runToggle(opts, globals, formatter, stderr, engine);
      case 'run-now':
        return await runRunNow(opts, globals, formatter, stderr, engine);
      case 'runs':
        return await runRuns(opts, globals, formatter, stderr, engine);
      case 'next-fire':
        return await runNextFire(opts, globals, formatter, stderr, engine);
      default:
        stderr.write(
          `ptah cron: unknown sub-command '${String(opts.subcommand)}'\n`,
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

async function runList(
  opts: CronOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, oneshot(), async (ctx) => {
    const result = await callRpc<CronListResult>(ctx.transport, 'cron:list', {
      enabledOnly: opts.enabledOnly === true,
    });
    await formatter.writeNotification('cron.list', {
      jobs: result?.jobs ?? [],
    });
    return ExitCode.Success;
  });
}

async function runGet(
  opts: CronOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: CronStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  const id = requireId(opts, stderr, 'get');
  if (id === null) return ExitCode.UsageError;

  return engine(globals, oneshot(), async (ctx) => {
    const result = await callRpc<CronGetResult>(ctx.transport, 'cron:get', {
      id,
    });
    await formatter.writeNotification('cron.job', {
      id,
      job: result?.job ?? null,
    });
    return ExitCode.Success;
  });
}

async function runCreate(
  opts: CronOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: CronStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!nonEmpty(opts.name)) {
    stderr.write('ptah cron create: --name is required\n');
    return ExitCode.UsageError;
  }
  if (!nonEmpty(opts.cronExpr)) {
    stderr.write('ptah cron create: --cron-expr is required\n');
    return ExitCode.UsageError;
  }
  if (!nonEmpty(opts.prompt)) {
    stderr.write('ptah cron create: --prompt is required\n');
    return ExitCode.UsageError;
  }

  const params: CronCreateParams = {
    name: opts.name,
    cronExpr: opts.cronExpr,
    prompt: opts.prompt,
  };
  if (opts.timezone !== undefined) params.timezone = opts.timezone;
  if (opts.workspaceRoot !== undefined) {
    params.workspaceRoot = opts.workspaceRoot;
  }
  if (opts.enabled !== undefined) params.enabled = opts.enabled;

  return engine(globals, oneshot(), async (ctx) => {
    const result = await callRpc<CronCreateResult>(
      ctx.transport,
      'cron:create',
      params,
    );
    await formatter.writeNotification('cron.created', {
      job: result?.job ?? null,
    });
    return ExitCode.Success;
  });
}

async function runUpdate(
  opts: CronOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: CronStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  const id = requireId(opts, stderr, 'update');
  if (id === null) return ExitCode.UsageError;

  const patch: CronUpdateParams['patch'] = {};
  if (opts.name !== undefined) patch.name = opts.name;
  if (opts.cronExpr !== undefined) patch.cronExpr = opts.cronExpr;
  if (opts.prompt !== undefined) patch.prompt = opts.prompt;
  if (opts.timezone !== undefined) patch.timezone = opts.timezone;
  if (opts.workspaceRoot !== undefined)
    patch.workspaceRoot = opts.workspaceRoot;
  if (opts.enabled !== undefined) patch.enabled = opts.enabled;

  if (Object.keys(patch).length === 0) {
    stderr.write(
      'ptah cron update: at least one of --name / --cron-expr / --prompt / --timezone / --workspace-root / --enabled is required\n',
    );
    return ExitCode.UsageError;
  }

  return engine(globals, oneshot(), async (ctx) => {
    const result = await callRpc<CronUpdateResult>(
      ctx.transport,
      'cron:update',
      { id, patch },
    );
    await formatter.writeNotification('cron.updated', {
      job: result?.job ?? null,
    });
    return ExitCode.Success;
  });
}

async function runDelete(
  opts: CronOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: CronStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  const id = requireId(opts, stderr, 'delete');
  if (id === null) return ExitCode.UsageError;

  return engine(globals, oneshot(), async (ctx) => {
    const result = await callRpc<CronDeleteResult>(
      ctx.transport,
      'cron:delete',
      { id },
    );
    await formatter.writeNotification('cron.deleted', {
      id,
      ok: result?.ok ?? false,
    });
    return ExitCode.Success;
  });
}

async function runToggle(
  opts: CronOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: CronStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  const id = requireId(opts, stderr, 'toggle');
  if (id === null) return ExitCode.UsageError;
  if (opts.enabled === undefined) {
    stderr.write('ptah cron toggle: --enabled <true|false> is required\n');
    return ExitCode.UsageError;
  }
  const enabled = opts.enabled;

  return engine(globals, oneshot(), async (ctx) => {
    const result = await callRpc<CronToggleResult>(
      ctx.transport,
      'cron:toggle',
      { id, enabled },
    );
    await formatter.writeNotification('cron.toggled', {
      id,
      enabled,
      job: result?.job ?? null,
    });
    return ExitCode.Success;
  });
}

async function runRunNow(
  opts: CronOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: CronStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  const id = requireId(opts, stderr, 'run-now');
  if (id === null) return ExitCode.UsageError;

  return engine(globals, oneshot(), async (ctx) => {
    const result = await callRpc<CronRunNowResult>(
      ctx.transport,
      'cron:runNow',
      { id },
    );
    await formatter.writeNotification('cron.run', {
      id,
      run: result?.run ?? null,
    });
    return ExitCode.Success;
  });
}

async function runRuns(
  opts: CronOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: CronStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  const id = requireId(opts, stderr, 'runs');
  if (id === null) return ExitCode.UsageError;

  return engine(globals, oneshot(), async (ctx) => {
    const params: { id: string; limit?: number; offset?: number } = { id };
    if (opts.limit !== undefined) params.limit = opts.limit;
    if (opts.offset !== undefined) params.offset = opts.offset;

    const result = await callRpc<CronRunsResult>(
      ctx.transport,
      'cron:runs',
      params,
    );
    await formatter.writeNotification('cron.runs', {
      id,
      runs: result?.runs ?? [],
    });
    return ExitCode.Success;
  });
}

async function runNextFire(
  opts: CronOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: CronStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  const id = requireId(opts, stderr, 'next-fire');
  if (id === null) return ExitCode.UsageError;

  return engine(globals, oneshot(), async (ctx) => {
    const result = await callRpc<CronNextFireResult>(
      ctx.transport,
      'cron:nextFire',
      { id },
    );
    await formatter.writeNotification('cron.next_fire', {
      id,
      nextRunAt: result?.nextRunAt ?? null,
    });
    return ExitCode.Success;
  });
}

function oneshot(): {
  mode: 'full';
  requireSdk: false;
  thoth: 'oneshot';
} {
  return { mode: 'full', requireSdk: false, thoth: 'oneshot' };
}

function nonEmpty(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function requireId(
  opts: CronOptions,
  stderr: CronStderrLike,
  verb: string,
): string | null {
  if (!opts.id || opts.id.trim().length === 0) {
    stderr.write(`ptah cron ${verb}: <id> is required\n`);
    return null;
  }
  return opts.id;
}

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
