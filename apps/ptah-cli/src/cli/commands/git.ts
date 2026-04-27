/**
 * `ptah git` command — git repo introspection + worktrees + source control.
 *
 * TASK_2026_104 Sub-batch B5d.
 *
 * Sub-commands (per task-description.md §3.1) — all delegate to the shared
 * GitRpcHandlers (lifted in B5b):
 *
 *   info                                            git:info
 *   worktrees                                       git:worktrees
 *   add-worktree --branch <b> [--path <p>] [--create]   git:addWorktree
 *   remove-worktree --path <p> [--force]            git:removeWorktree
 *   stage --paths <a,b,c>                           git:stage
 *   unstage --paths <a,b,c>                         git:unstage
 *   discard --paths <a,b,c> --confirm               git:discard (DESTRUCTIVE)
 *   commit --message <msg>                          git:commit
 *   show-file --path <p>                            git:showFile
 *
 * `discard` requires the explicit `--confirm` flag. Without it the command
 * exits ExitCode.UsageError without dispatching the destructive RPC.
 *
 * No DI mocking in production; tests inject hooks via {@link GitExecuteHooks}.
 */

import { withEngine } from '../bootstrap/with-engine.js';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';

export type GitSubcommand =
  | 'info'
  | 'worktrees'
  | 'add-worktree'
  | 'remove-worktree'
  | 'stage'
  | 'unstage'
  | 'discard'
  | 'commit'
  | 'show-file';

export interface GitOptions {
  subcommand: GitSubcommand;
  /** add-worktree, remove-worktree, show-file */
  path?: string;
  /** add-worktree */
  branch?: string;
  /** add-worktree */
  createBranch?: boolean;
  /** remove-worktree */
  force?: boolean;
  /** stage / unstage / discard */
  paths?: string[];
  /** discard */
  confirm?: boolean;
  /** commit */
  message?: string;
}

export interface GitStderrLike {
  write(chunk: string): boolean;
}

export interface GitExecuteHooks {
  stderr?: GitStderrLike;
  formatter?: Formatter;
  withEngine?: typeof withEngine;
}

export async function execute(
  opts: GitOptions,
  globals: GlobalOptions,
  hooks: GitExecuteHooks = {},
): Promise<number> {
  const formatter = hooks.formatter ?? buildFormatter(globals);
  const stderr: GitStderrLike = hooks.stderr ?? process.stderr;
  const engine = hooks.withEngine ?? withEngine;

  try {
    switch (opts.subcommand) {
      case 'info':
        return await runInfo(globals, formatter, engine);
      case 'worktrees':
        return await runWorktrees(globals, formatter, engine);
      case 'add-worktree':
        return await runAddWorktree(opts, globals, formatter, stderr, engine);
      case 'remove-worktree':
        return await runRemoveWorktree(
          opts,
          globals,
          formatter,
          stderr,
          engine,
        );
      case 'stage':
        return await runStage(opts, globals, formatter, stderr, engine);
      case 'unstage':
        return await runUnstage(opts, globals, formatter, stderr, engine);
      case 'discard':
        return await runDiscard(opts, globals, formatter, stderr, engine);
      case 'commit':
        return await runCommit(opts, globals, formatter, stderr, engine);
      case 'show-file':
        return await runShowFile(opts, globals, formatter, stderr, engine);
      default:
        stderr.write(
          `ptah git: unknown sub-command '${String(opts.subcommand)}'\n`,
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
// Sub-command runners
// ---------------------------------------------------------------------------

async function runInfo(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<unknown>(ctx.transport, 'git:info', {});
    await formatter.writeNotification('git.info', wrapResult(result));
    return ExitCode.Success;
  });
}

async function runWorktrees(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<unknown>(ctx.transport, 'git:worktrees', {});
    await formatter.writeNotification('git.worktrees', wrapResult(result));
    return ExitCode.Success;
  });
}

async function runAddWorktree(
  opts: GitOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: GitStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.branch) {
    stderr.write('ptah git add-worktree: --branch is required\n');
    return ExitCode.UsageError;
  }
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<{ success?: boolean; error?: string }>(
      ctx.transport,
      'git:addWorktree',
      {
        branch: opts.branch,
        path: opts.path,
        createBranch: opts.createBranch === true,
      },
    );
    if (result?.success === false) {
      throw new Error(result.error ?? 'git:addWorktree failed');
    }
    await formatter.writeNotification('git.worktree.added', {
      branch: opts.branch,
      path: opts.path,
      createBranch: opts.createBranch === true,
      ...wrapResult(result),
    });
    return ExitCode.Success;
  });
}

async function runRemoveWorktree(
  opts: GitOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: GitStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.path) {
    stderr.write('ptah git remove-worktree: --path is required\n');
    return ExitCode.UsageError;
  }
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<{ success?: boolean; error?: string }>(
      ctx.transport,
      'git:removeWorktree',
      { path: opts.path, force: opts.force === true },
    );
    if (result?.success === false) {
      throw new Error(result.error ?? 'git:removeWorktree failed');
    }
    await formatter.writeNotification('git.worktree.removed', {
      path: opts.path,
      force: opts.force === true,
    });
    return ExitCode.Success;
  });
}

async function runStage(
  opts: GitOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: GitStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.paths || opts.paths.length === 0) {
    stderr.write('ptah git stage: --paths <a,b,c> requires a non-empty list\n');
    return ExitCode.UsageError;
  }
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<{ success?: boolean; error?: string }>(
      ctx.transport,
      'git:stage',
      { paths: opts.paths },
    );
    if (result?.success === false) {
      throw new Error(result.error ?? 'git:stage failed');
    }
    await formatter.writeNotification('git.staged', {
      paths: opts.paths,
    });
    return ExitCode.Success;
  });
}

async function runUnstage(
  opts: GitOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: GitStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.paths || opts.paths.length === 0) {
    stderr.write(
      'ptah git unstage: --paths <a,b,c> requires a non-empty list\n',
    );
    return ExitCode.UsageError;
  }
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<{ success?: boolean; error?: string }>(
      ctx.transport,
      'git:unstage',
      { paths: opts.paths },
    );
    if (result?.success === false) {
      throw new Error(result.error ?? 'git:unstage failed');
    }
    await formatter.writeNotification('git.unstaged', {
      paths: opts.paths,
    });
    return ExitCode.Success;
  });
}

async function runDiscard(
  opts: GitOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: GitStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.paths || opts.paths.length === 0) {
    stderr.write(
      'ptah git discard: --paths <a,b,c> requires a non-empty list\n',
    );
    return ExitCode.UsageError;
  }
  if (opts.confirm !== true) {
    stderr.write(
      'ptah git discard: refusing to discard without --confirm (this is destructive)\n',
    );
    return ExitCode.UsageError;
  }
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<{ success?: boolean; error?: string }>(
      ctx.transport,
      'git:discard',
      { paths: opts.paths },
    );
    if (result?.success === false) {
      throw new Error(result.error ?? 'git:discard failed');
    }
    await formatter.writeNotification('git.discarded', {
      paths: opts.paths,
    });
    return ExitCode.Success;
  });
}

async function runCommit(
  opts: GitOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: GitStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.message || !opts.message.trim()) {
    stderr.write(
      'ptah git commit: --message is required and must not be empty\n',
    );
    return ExitCode.UsageError;
  }
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<{ success?: boolean; error?: string }>(
      ctx.transport,
      'git:commit',
      { message: opts.message },
    );
    if (result?.success === false) {
      throw new Error(result.error ?? 'git:commit failed');
    }
    await formatter.writeNotification('git.committed', {
      message: opts.message,
      ...wrapResult(result),
    });
    return ExitCode.Success;
  });
}

async function runShowFile(
  opts: GitOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: GitStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.path) {
    stderr.write('ptah git show-file: --path is required\n');
    return ExitCode.UsageError;
  }
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<{ content?: string }>(
      ctx.transport,
      'git:showFile',
      { path: opts.path },
    );
    await formatter.writeNotification('git.file', {
      path: opts.path,
      content: result?.content ?? '',
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
