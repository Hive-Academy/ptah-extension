/**
 * `ptah workspace` command — workspace folder management.
 *
 * Sub-commands (per task-description.md §3.1):
 *
 *   info                       RPC `workspace:getInfo`
 *   add --path <dir>           RPC `workspace:registerFolder` (no native picker
 *                              in headless mode — `--path` is required)
 *   remove --path <dir>        RPC `workspace:removeFolder`
 *   switch --path <dir>        RPC `workspace:switch`
 *
 * The shared WorkspaceRpcHandlers (lifted in B5a) backs every method. The
 * CLI's workspace provider has no `showOpenDialog`, so `workspace:addFolder`
 * is intentionally NOT exposed — `add` always uses `workspace:registerFolder`
 * with an explicit path argument.
 *
 * No DI mocking in production; tests inject hooks via {@link WorkspaceExecuteHooks}.
 */

import { withEngine } from '../bootstrap/with-engine.js';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';

export type WorkspaceSubcommand = 'info' | 'add' | 'remove' | 'switch';

export interface WorkspaceOptions {
  subcommand: WorkspaceSubcommand;
  /** For add / remove / switch — the folder path. */
  path?: string;
}

export interface WorkspaceStderrLike {
  write(chunk: string): boolean;
}

export interface WorkspaceExecuteHooks {
  stderr?: WorkspaceStderrLike;
  formatter?: Formatter;
  withEngine?: typeof withEngine;
}

export async function execute(
  opts: WorkspaceOptions,
  globals: GlobalOptions,
  hooks: WorkspaceExecuteHooks = {},
): Promise<number> {
  const formatter = hooks.formatter ?? buildFormatter(globals);
  const stderr: WorkspaceStderrLike = hooks.stderr ?? process.stderr;
  const engine = hooks.withEngine ?? withEngine;

  try {
    switch (opts.subcommand) {
      case 'info':
        return await runInfo(globals, formatter, engine);
      case 'add':
        return await runAdd(opts, globals, formatter, stderr, engine);
      case 'remove':
        return await runRemove(opts, globals, formatter, stderr, engine);
      case 'switch':
        return await runSwitch(opts, globals, formatter, stderr, engine);
      default:
        stderr.write(
          `ptah workspace: unknown sub-command '${String(opts.subcommand)}'\n`,
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

async function runInfo(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<unknown>(
      ctx.transport,
      'workspace:getInfo',
      undefined,
    );
    await formatter.writeNotification('workspace.info', wrapResult(result));
    return ExitCode.Success;
  });
}

async function runAdd(
  opts: WorkspaceOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: WorkspaceStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.path) {
    stderr.write(
      'ptah workspace add: --path is required (no native picker in headless mode)\n',
    );
    return ExitCode.UsageError;
  }
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<{
      success?: boolean;
      path?: string;
      name?: string;
      error?: string;
    }>(ctx.transport, 'workspace:registerFolder', { path: opts.path });
    if (result?.success === false) {
      throw new Error(result.error ?? 'workspace:registerFolder failed');
    }
    await formatter.writeNotification('workspace.added', {
      path: result?.path ?? opts.path,
      name: result?.name,
    });
    return ExitCode.Success;
  });
}

async function runRemove(
  opts: WorkspaceOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: WorkspaceStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.path) {
    stderr.write('ptah workspace remove: --path is required\n');
    return ExitCode.UsageError;
  }
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<{ success?: boolean; error?: string }>(
      ctx.transport,
      'workspace:removeFolder',
      { path: opts.path },
    );
    if (result?.success === false) {
      throw new Error(result.error ?? 'workspace:removeFolder failed');
    }
    await formatter.writeNotification('workspace.removed', {
      path: opts.path,
    });
    return ExitCode.Success;
  });
}

async function runSwitch(
  opts: WorkspaceOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: WorkspaceStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.path) {
    stderr.write('ptah workspace switch: --path is required\n');
    return ExitCode.UsageError;
  }
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<{
      success?: boolean;
      path?: string;
      name?: string;
      encodedPath?: string;
      error?: string;
    }>(ctx.transport, 'workspace:switch', { path: opts.path });
    if (result?.success === false) {
      throw new Error(result.error ?? 'workspace:switch failed');
    }
    await formatter.writeNotification('workspace.switched', {
      path: result?.path ?? opts.path,
      name: result?.name,
      encodedPath: result?.encodedPath,
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapResult(result: unknown): Record<string, unknown> {
  if (result === null || result === undefined) return {};
  if (typeof result === 'object' && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  return { result };
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
