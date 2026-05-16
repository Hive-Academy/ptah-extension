/**
 * `ptah session` command — 10-sub-subcommand dispatcher.
 *
 * Drives the chat session surface end-to-end:
 *
 *   start [--profile <name>] [--task <text>] [--once]   chat:start (Full DI)
 *                                                        ChatBridge if --task
 *   resume <id> [--task <text>]                          chat:resume +
 *                                                        chat:continue if --task
 *                                                        ChatBridge if --task
 *   send <id> --task <text>                              chat:continue
 *                                                        ChatBridge required
 *   list                                                 session:list
 *                                                        + chat:running-agents
 *                                                        + agent:backgroundList
 *                                                        per session (best-effort)
 *   stop <id>                                            chat:abort
 *   delete <id>                                          session:delete
 *   rename <id> --to <name>                              session:rename
 *   load <id> [--out <path>]                             session:load
 *                                                        emits session.history
 *                                                        optionally writes JSON
 *   stats [--ids <csv>]                                  session:stats-batch
 *   validate <id>                                        session:validate
 *
 * Streaming sub-subcommands (`start|resume|send`) wire B10b's `ChatBridge` and
 * `ApprovalBridge` to the engine's `pushAdapter`. The bridge resolves the turn
 * promise on `chat:complete | chat:error | abort | timeout`. SIGINT triggers
 * `chat:abort` + bridge teardown + exit 130.
 *
 * Non-streaming sub-subcommands run under Full DI (the only mode supported by
 * `withEngine` today) and pass `workspacePath = workspaceProvider.getWorkspaceRoot()`
 * explicitly to RPC params per Blocker 5 of B10_EXPANSION.md (the backend's
 * `isAuthorizedWorkspace()` check rejects calls without it).
 *
 * State storage layout — `WORKSPACE_STATE_STORAGE` namespace `'sessions'`,
 * key `'sessions.<tabId>'`, value = `{ tabId, sdkSessionId?, name?, createdAt,
 * workspacePath }`. `start` writes a new entry; `resume`/`send`/`stop`/`delete`/
 * `rename` look up by tabId or fall back to treating the user-supplied id as
 * the tabId (allowing resume of externally-known SDK session ids).
 */

import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { withEngine, SdkInitFailedError } from '../bootstrap/with-engine.js';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { emitFatalError } from '../output/stderr-json.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { PtahErrorCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';
import { ChatBridge } from '../session/chat-bridge.js';
import { ApprovalBridge } from '../session/approval-bridge.js';
import {
  PLATFORM_TOKENS,
  type IStateStorage,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type {
  SessionListResult,
  SessionLoadResult,
  SessionStatsBatchResult,
  SessionId,
  ISdkPermissionHandler,
} from '@ptah-extension/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionSubcommand =
  | 'start'
  | 'resume'
  | 'send'
  | 'list'
  | 'stop'
  | 'delete'
  | 'rename'
  | 'load'
  | 'stats'
  | 'validate';

export interface SessionOptions {
  subcommand: SessionSubcommand;
  /** For `resume | send | stop | delete | rename | load | validate`. */
  id?: string;
  /** For `start | resume | send` — initial / continuation prompt. */
  task?: string;
  /** For `start` — system prompt preset selection. */
  profile?: 'claude_code' | 'enhanced';
  /** For `start --once` — single-turn mode. Currently informational. */
  once?: boolean;
  /** For `rename --to <name>`. */
  to?: string;
  /** For `load --out <path>`. */
  out?: string;
  /** For `stats --ids <csv>` — comma-separated session ids. */
  ids?: string;
  /** Optional scope for forward-compat (e.g. `harness-skill`). Plumbed but unused today. */
  scope?: string;
  /** Optional explicit cwd override (proxies `globals.cwd`). */
  cwd?: string;
}

export interface SessionStderrLike {
  write(chunk: string): boolean;
}

export interface SessionExecuteHooks {
  stderr?: SessionStderrLike;
  formatter?: Formatter;
  withEngine?: typeof withEngine;
  /** Override hook for tests — defaults to `node:fs/promises.writeFile`. */
  writeFile?: (path: string, data: string) => Promise<void>;
  /** Override hook for tests — defaults to `node:crypto.randomUUID`. */
  randomUUID?: () => string;
  /**
   * Override hook for tests — installs a SIGINT handler. Returns an
   * unregistration function. Production: registers on `process`.
   */
  installSigint?: (handler: () => void) => () => void;
  /** Override the drain timeout (default 5_000 ms). */
  drainTimeoutMs?: number;
}

/** Persisted shape under `WORKSPACE_STATE_STORAGE` namespace `'sessions'`. */
export interface PersistedSession {
  /** Synthetic tab id chosen at `start` time — stable across resumes. */
  readonly tabId: string;
  /** Real SDK session UUID once `message_start` lands. May be absent before then. */
  readonly sdkSessionId?: string;
  /** User-supplied name (forward-compat; not currently set by `start`). */
  readonly name?: string;
  /** `Date.now()` at first `start`. */
  readonly createdAt: number;
  /** Workspace path that owns this session. Used as the auth check on resumes. */
  readonly workspacePath: string;
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/**
 * Convenience entry — wraps `execute` for the `start` sub-subcommand. Used by
 * `run.ts`/`execute-spec.ts`/`harness chat` (B10d) which want to fire a
 * single turn without re-deriving the SessionOptions struct themselves.
 */
export async function executeSessionStart(
  opts: {
    task?: string;
    profile?: string;
    once?: boolean;
    scope?: string;
    resumeId?: string;
    cwd?: string;
  },
  globals?: GlobalOptions,
  hooks: SessionExecuteHooks = {},
): Promise<number> {
  const profile =
    opts.profile === 'claude_code' || opts.profile === 'enhanced'
      ? opts.profile
      : undefined;
  const sessionOpts: SessionOptions = opts.resumeId
    ? {
        subcommand: 'resume',
        id: opts.resumeId,
        task: opts.task,
        scope: opts.scope,
        cwd: opts.cwd,
      }
    : {
        subcommand: 'start',
        task: opts.task,
        profile,
        once: opts.once,
        scope: opts.scope,
        cwd: opts.cwd,
      };
  const effectiveGlobals: GlobalOptions = globals ?? {
    json: true,
    human: false,
    cwd: opts.cwd ?? process.cwd(),
    quiet: false,
    verbose: false,
    noColor: true,
    autoApprove: false,
    reveal: false,
  };
  return execute(sessionOpts, effectiveGlobals, hooks);
}

export async function execute(
  opts: SessionOptions,
  globals: GlobalOptions,
  hooks: SessionExecuteHooks = {},
): Promise<number> {
  const formatter = hooks.formatter ?? buildFormatter(globals);
  const stderr: SessionStderrLike = hooks.stderr ?? process.stderr;
  const engine = hooks.withEngine ?? withEngine;

  try {
    switch (opts.subcommand) {
      case 'start':
        return await runStart(opts, globals, formatter, stderr, engine, hooks);
      case 'resume':
        return await runResume(opts, globals, formatter, stderr, engine, hooks);
      case 'send':
        return await runSend(opts, globals, formatter, stderr, engine, hooks);
      case 'list':
        return await runList(globals, formatter, engine);
      case 'stop':
        return await runStop(opts, globals, formatter, stderr, engine);
      case 'delete':
        return await runDelete(opts, globals, formatter, stderr, engine);
      case 'rename':
        return await runRename(opts, globals, formatter, stderr, engine);
      case 'load':
        return await runLoad(opts, globals, formatter, stderr, engine, hooks);
      case 'stats':
        return await runStats(opts, globals, formatter, engine);
      case 'validate':
        return await runValidate(opts, globals, formatter, stderr, engine);
      default: {
        const sub = opts.subcommand as string;
        stderr.write(`ptah session: unknown sub-command '${sub}'\n`);
        return ExitCode.UsageError;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Distinguish SDK-init failures from generic internal failures so JSON-RPC
    // clients see a deterministic `sdk_init_failed` code. The structured
    // stderr breadcrumb was already emitted by `withEngine` for SDK-init;
    // for internal_failure we emit it here so supervisors monitoring stderr
    // don't have to parse stdout.
    const isSdkInit = error instanceof SdkInitFailedError;
    const ptahCode: PtahErrorCode = isSdkInit
      ? 'sdk_init_failed'
      : 'internal_failure';
    if (!isSdkInit) {
      emitFatalError('internal_failure', message, {
        command: `session.${opts.subcommand}`,
      });
    }
    await formatter.writeNotification('task.error', {
      ptah_code: ptahCode,
      command: `session.${opts.subcommand}`,
      message,
    });
    return ExitCode.InternalFailure;
  }
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

const SESSIONS_NAMESPACE = 'sessions';

function storageKey(tabId: string): string {
  return `${SESSIONS_NAMESPACE}.${tabId}`;
}

function loadPersistedSession(
  storage: IStateStorage,
  id: string,
): PersistedSession | undefined {
  return storage.get<PersistedSession>(storageKey(id));
}

async function persistSession(
  storage: IStateStorage,
  entry: PersistedSession,
): Promise<void> {
  await storage.update(storageKey(entry.tabId), entry);
}

async function deletePersistedSession(
  storage: IStateStorage,
  tabId: string,
): Promise<void> {
  await storage.update(storageKey(tabId), undefined);
}

// ---------------------------------------------------------------------------
// Streaming sub-subcommands — start / resume / send
// ---------------------------------------------------------------------------

async function runStart(
  opts: SessionOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: SessionStderrLike,
  engine: typeof withEngine,
  hooks: SessionExecuteHooks,
): Promise<number> {
  const uuid = hooks.randomUUID ?? randomUUID;
  const tabId = uuid();

  const exitCode = await engine(globals, { mode: 'full' }, async (ctx) => {
    const workspaceProvider = ctx.container.resolve<IWorkspaceProvider>(
      PLATFORM_TOKENS.WORKSPACE_PROVIDER,
    );
    const storage = ctx.container.resolve<IStateStorage>(
      PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE,
    );
    const workspacePath =
      workspaceProvider.getWorkspaceRoot() ?? globals.cwd ?? process.cwd();

    // Persist BEFORE the RPC fires so `resume` can find the entry even if the
    // process dies mid-turn.
    const entry: PersistedSession = {
      tabId,
      createdAt: Date.now(),
      workspacePath,
    };
    await persistSession(storage, entry);

    await formatter.writeNotification('session.created', {
      session_id: tabId,
      tab_id: tabId,
    });

    return await runStreamingTurn({
      ctx,
      tabId,
      formatter,
      stderr,
      hooks,
      command: 'session.start',
      task: opts.task,
      rpcMethod: 'chat:start',
      buildParams: () => ({
        tabId,
        prompt: opts.task,
        workspacePath,
        options: opts.profile ? { preset: opts.profile } : undefined,
      }),
      // If --task was not given, the start RPC fires but no streaming turn is
      // expected — we just persist the synthetic id and return success. The
      // backend's chat:start with no prompt is effectively a session bootstrap.
      requireTask: false,
      onSessionResolved: async (sdkSessionId) => {
        const current = loadPersistedSession(storage, tabId);
        if (current) {
          await persistSession(storage, { ...current, sdkSessionId });
        }
        await formatter.writeNotification('session.id_resolved', {
          tab_id: tabId,
          session_id: sdkSessionId,
        });
      },
    });
  });

  if (opts.once === true) {
    // Windows pipes are async — without flushing the formatter writer and
    // draining stdout, the tail event is lost on `--once` exit.
    await formatter.close();

    const drainTimeoutMs = hooks.drainTimeoutMs ?? 5_000;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const drainPromise = new Promise<void>((res) => {
      process.stdout.write('', () => res());
    });
    const timeoutPromise = new Promise<void>((res) => {
      timeoutHandle = setTimeout(() => {
        process.stderr.write(
          `[ptah] stdout drain timeout (${drainTimeoutMs}ms); forcing exit\n`,
        );
        res();
      }, drainTimeoutMs);
    });

    try {
      await Promise.race([drainPromise, timeoutPromise]);
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }
    process.exit(exitCode);
  }

  return exitCode;
}

async function runResume(
  opts: SessionOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: SessionStderrLike,
  engine: typeof withEngine,
  hooks: SessionExecuteHooks,
): Promise<number> {
  if (!opts.id || opts.id.trim().length === 0) {
    stderr.write('ptah session resume: <id> is required\n');
    return ExitCode.UsageError;
  }
  const id = opts.id;

  return engine(globals, { mode: 'full' }, async (ctx) => {
    const workspaceProvider = ctx.container.resolve<IWorkspaceProvider>(
      PLATFORM_TOKENS.WORKSPACE_PROVIDER,
    );
    const storage = ctx.container.resolve<IStateStorage>(
      PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE,
    );
    const workspacePath =
      workspaceProvider.getWorkspaceRoot() ?? globals.cwd ?? process.cwd();

    const persisted = loadPersistedSession(storage, id);
    // If the persisted entry has a real SDK session id, use it; otherwise
    // treat the supplied `id` as the SDK session id directly. This permits
    // resuming an externally-known session UUID without prior `start`.
    const tabId = persisted?.tabId ?? id;
    const sdkSessionId = persisted?.sdkSessionId ?? id;

    // Always issue chat:resume first — backend re-hydrates the conversation.
    await callRpc(ctx.transport, 'chat:resume', {
      sessionId: sdkSessionId,
      tabId,
      workspacePath,
    });

    if (!opts.task || opts.task.trim().length === 0) {
      // Resume without a follow-up turn — emit ready and exit. This mirrors
      // the spec § 4.1.1 `session.ready` semantic for the non-streaming case.
      await formatter.writeNotification('session.ready', {
        session_id: sdkSessionId,
        tab_id: tabId,
      });
      return ExitCode.Success;
    }

    const exitCode = await runStreamingTurn({
      ctx,
      tabId,
      formatter,
      stderr,
      hooks,
      command: 'session.resume',
      task: opts.task,
      rpcMethod: 'chat:continue',
      buildParams: () => ({
        prompt: opts.task as string,
        sessionId: sdkSessionId,
        tabId,
        workspacePath,
      }),
      requireTask: true,
      onSessionResolved: async (resolvedId) => {
        const current = loadPersistedSession(storage, tabId);
        if (current) {
          await persistSession(storage, {
            ...current,
            sdkSessionId: resolvedId,
          });
        }
      },
    });
    return exitCode;
  });
}

async function runSend(
  opts: SessionOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: SessionStderrLike,
  engine: typeof withEngine,
  hooks: SessionExecuteHooks,
): Promise<number> {
  if (!opts.id || opts.id.trim().length === 0) {
    stderr.write('ptah session send: <id> is required\n');
    return ExitCode.UsageError;
  }
  if (!opts.task || opts.task.trim().length === 0) {
    stderr.write('ptah session send: --task <text> is required\n');
    return ExitCode.UsageError;
  }
  const id = opts.id;
  const task = opts.task;

  return engine(globals, { mode: 'full' }, async (ctx) => {
    const workspaceProvider = ctx.container.resolve<IWorkspaceProvider>(
      PLATFORM_TOKENS.WORKSPACE_PROVIDER,
    );
    const storage = ctx.container.resolve<IStateStorage>(
      PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE,
    );
    const workspacePath =
      workspaceProvider.getWorkspaceRoot() ?? globals.cwd ?? process.cwd();

    const persisted = loadPersistedSession(storage, id);
    const tabId = persisted?.tabId ?? id;
    const sdkSessionId = persisted?.sdkSessionId ?? id;

    return await runStreamingTurn({
      ctx,
      tabId,
      formatter,
      stderr,
      hooks,
      command: 'session.send',
      task,
      rpcMethod: 'chat:continue',
      buildParams: () => ({
        prompt: task,
        sessionId: sdkSessionId,
        tabId,
        workspacePath,
      }),
      requireTask: true,
      onSessionResolved: async (resolvedId) => {
        const current = loadPersistedSession(storage, tabId);
        if (current) {
          await persistSession(storage, {
            ...current,
            sdkSessionId: resolvedId,
          });
        }
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Streaming turn driver — shared by start/resume/send.
// ---------------------------------------------------------------------------

interface StreamingTurnArgs {
  readonly ctx: {
    readonly container: import('tsyringe').DependencyContainer;
    readonly transport: CliMessageTransport;
    readonly pushAdapter: import('node:events').EventEmitter;
  };
  readonly tabId: string;
  readonly formatter: Formatter;
  readonly stderr: SessionStderrLike;
  readonly hooks: SessionExecuteHooks;
  readonly command: string;
  readonly task: string | undefined;
  readonly rpcMethod: string;
  readonly buildParams: () => Record<string, unknown>;
  /** When true, the absence of a task is a usage error (handled by callers). */
  readonly requireTask: boolean;
  /** Invoked when the bridge resolves with a real SDK session id. */
  readonly onSessionResolved?: (sdkSessionId: string) => Promise<void>;
}

async function runStreamingTurn(args: StreamingTurnArgs): Promise<number> {
  const {
    ctx,
    tabId,
    formatter,
    stderr,
    hooks,
    command,
    task,
    rpcMethod,
    buildParams,
    onSessionResolved,
  } = args;

  // No-task fast path — fire the RPC, don't wire bridges, exit 0.
  if (!task || task.trim().length === 0) {
    try {
      await callRpc(ctx.transport, rpcMethod, buildParams());
      return ExitCode.Success;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await formatter.writeNotification('task.error', {
        ptah_code: 'unknown',
        command,
        message,
      });
      return ExitCode.GeneralError;
    }
  }

  // Build a thin notify shim around the formatter so the bridges see the
  // same JSON-RPC notify surface they receive in `interact` mode (where a
  // real `JsonRpcServer.notify` is wired). This keeps B10b unchanged while
  // letting non-interactive `session *` emit the same agent.* and
  // permission.request payloads.
  const jsonrpcShim = makeFormatterNotifyShim(formatter);

  const chatBridge = new ChatBridge(ctx.pushAdapter, jsonrpcShim);

  // ApprovalBridge needs ISdkPermissionHandler; resolve from the SDK module.
  // If the permission handler isn't registered (older bootstrap), we skip
  // approval wiring — the backend will time out at its own cap.
  let approvalBridge: ApprovalBridge | undefined;
  try {
    const permissionHandler = ctx.container.resolve<ISdkPermissionHandler>(
      SDK_TOKENS.SDK_PERMISSION_HANDLER,
    );
    approvalBridge = new ApprovalBridge(
      ctx.pushAdapter,
      jsonrpcShim,
      permissionHandler,
    );
    approvalBridge.attach();
  } catch (resolveError) {
    // Non-fatal — log to stderr and proceed without approval round-trip.
    const message =
      resolveError instanceof Error
        ? resolveError.message
        : String(resolveError);
    stderr.write(
      `[ptah] approval bridge unavailable (continuing without permission round-trip): ${message}\n`,
    );
  }

  // SIGINT — issue chat:abort then detach + exit 130. One-shot listener.
  const installSigint =
    hooks.installSigint ??
    ((handler: () => void) => {
      process.once('SIGINT', handler);
      return () => {
        process.off('SIGINT', handler);
      };
    });
  let aborted = false;
  const onSigint = (): void => {
    aborted = true;
    // Best-effort abort. We don't wait for the response — the bridge will
    // observe the chat:error or close the listeners on detach.
    void ctx.transport
      .call('chat:abort', { sessionId: tabId })
      .catch(() => undefined);
  };
  const uninstallSigint = installSigint(onSigint);

  try {
    const result = await chatBridge.runTurn({
      tabId,
      command,
      rpcCall: async () => {
        const resp = await ctx.transport.call(rpcMethod, buildParams());
        return { success: resp.success === true };
      },
    });

    if (result.success === true) {
      // The bridge resolved with a real SDK session id (post-message_start).
      // Persist it for follow-up resume/send.
      if (onSessionResolved && result.sessionId !== tabId) {
        await onSessionResolved(result.sessionId);
      }
      return ExitCode.Success;
    }

    // result.success === false — narrowed branch. The terminal `task.error`
    // notification was already emitted by ChatBridge.settle() before resolving.
    if (aborted || result.cancelled === true) {
      // SIGINT path — exit 130 (matching the conventional Ctrl+C exit code).
      return 130;
    }

    return ExitCode.GeneralError;
  } finally {
    approvalBridge?.detach();
    uninstallSigint();
  }
}

/**
 * Adapt the `Formatter` (writeNotification) to the `Pick<JsonRpcServer,
 * 'notify' | 'register' | 'unregister'>` shape the bridges depend on. The
 * `register / unregister` half is a stub for non-interactive runs — there is
 * no inbound JSON-RPC channel during `session start|resume|send`, so a
 * permission response from the operator is impossible. The ApprovalBridge
 * will register handlers but they'll never fire; on backend timeout the
 * ApprovalBridge's internal 300s timer kicks in and exits with code 3.
 */
function makeFormatterNotifyShim(formatter: Formatter): {
  notify: <TParams = unknown>(
    method: string,
    params?: TParams,
  ) => Promise<void>;
  register: (
    method: string,
    handler: (params: unknown) => Promise<unknown> | unknown,
  ) => void;
  unregister: (method: string) => void;
} {
  return {
    notify: async <TParams = unknown>(
      method: string,
      params?: TParams,
    ): Promise<void> => {
      await formatter.writeNotification(method, params);
    },
    register: () => {
      /* no-op — non-interactive mode has no inbound channel */
    },
    unregister: () => {
      /* no-op — non-interactive mode has no inbound channel */
    },
  };
}

// ---------------------------------------------------------------------------
// Non-streaming sub-subcommands — list / stop / delete / rename / load /
// stats / validate.
// ---------------------------------------------------------------------------

async function runList(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const workspaceProvider = ctx.container.resolve<IWorkspaceProvider>(
      PLATFORM_TOKENS.WORKSPACE_PROVIDER,
    );
    const workspacePath =
      workspaceProvider.getWorkspaceRoot() ?? globals.cwd ?? process.cwd();

    const result = await callRpc<SessionListResult>(
      ctx.transport,
      'session:list',
      { workspacePath },
    );

    // Best-effort enrichment: per-session running agents + background agents.
    // Errors per session are swallowed to keep the listing usable.
    const sessions = await Promise.all(
      (result?.sessions ?? []).map(async (s) => {
        const enriched: Record<string, unknown> = {
          id: s.id,
          name: s.name,
          createdAt: s.createdAt,
          lastActivityAt: s.lastActivityAt,
          messageCount: s.messageCount,
        };
        try {
          const running = await callRpc<{
            agents: { agentId: string; agentType: string }[];
          }>(ctx.transport, 'chat:running-agents', { sessionId: s.id });
          enriched['runningAgents'] = running?.agents ?? [];
        } catch {
          enriched['runningAgents'] = [];
        }
        try {
          const background = await callRpc<{ agents: unknown[] }>(
            ctx.transport,
            'agent:backgroundList',
            { sessionId: s.id },
          );
          enriched['backgroundAgents'] = background?.agents ?? [];
        } catch {
          enriched['backgroundAgents'] = [];
        }
        return enriched;
      }),
    );

    await formatter.writeNotification('session.list', {
      sessions,
      total: result?.total ?? sessions.length,
      hasMore: result?.hasMore ?? false,
      workspacePath,
    });
    return ExitCode.Success;
  });
}

async function runStop(
  opts: SessionOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: SessionStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.id || opts.id.trim().length === 0) {
    stderr.write('ptah session stop: <id> is required\n');
    return ExitCode.UsageError;
  }
  const id = opts.id;
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const storage = ctx.container.resolve<IStateStorage>(
      PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE,
    );
    const persisted = loadPersistedSession(storage, id);
    const sessionId = persisted?.sdkSessionId ?? id;

    await callRpc(ctx.transport, 'chat:abort', { sessionId });
    await formatter.writeNotification('session.stopped', {
      session_id: sessionId,
      tab_id: persisted?.tabId,
    });
    return ExitCode.Success;
  });
}

async function runDelete(
  opts: SessionOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: SessionStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.id || opts.id.trim().length === 0) {
    stderr.write('ptah session delete: <id> is required\n');
    return ExitCode.UsageError;
  }
  const id = opts.id;
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const storage = ctx.container.resolve<IStateStorage>(
      PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE,
    );
    const persisted = loadPersistedSession(storage, id);
    const sessionId = (persisted?.sdkSessionId ?? id) as SessionId;

    const result = await callRpc<{ success: boolean; error?: string }>(
      ctx.transport,
      'session:delete',
      { sessionId },
    );

    if (!result?.success) {
      await formatter.writeNotification('task.error', {
        ptah_code: 'unknown',
        command: 'session.delete',
        message: result?.error ?? 'session:delete failed',
        session_id: sessionId,
      });
      return ExitCode.GeneralError;
    }

    if (persisted) {
      await deletePersistedSession(storage, persisted.tabId);
    } else {
      await deletePersistedSession(storage, id);
    }

    await formatter.writeNotification('session.deleted', {
      session_id: sessionId,
      tab_id: persisted?.tabId,
    });
    return ExitCode.Success;
  });
}

async function runRename(
  opts: SessionOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: SessionStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.id || opts.id.trim().length === 0) {
    stderr.write('ptah session rename: <id> is required\n');
    return ExitCode.UsageError;
  }
  if (!opts.to || opts.to.trim().length === 0) {
    stderr.write('ptah session rename: --to <name> is required\n');
    return ExitCode.UsageError;
  }
  const id = opts.id;
  const newName = opts.to;
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const storage = ctx.container.resolve<IStateStorage>(
      PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE,
    );
    const persisted = loadPersistedSession(storage, id);
    const sessionId = (persisted?.sdkSessionId ?? id) as SessionId;

    const result = await callRpc<{ success: boolean; error?: string }>(
      ctx.transport,
      'session:rename',
      { sessionId, name: newName },
    );

    if (!result?.success) {
      await formatter.writeNotification('task.error', {
        ptah_code: 'unknown',
        command: 'session.rename',
        message: result?.error ?? 'session:rename failed',
        session_id: sessionId,
      });
      return ExitCode.GeneralError;
    }

    if (persisted) {
      await persistSession(storage, { ...persisted, name: newName });
    }

    await formatter.writeNotification('session.renamed', {
      session_id: sessionId,
      tab_id: persisted?.tabId,
      name: newName,
    });
    return ExitCode.Success;
  });
}

async function runLoad(
  opts: SessionOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: SessionStderrLike,
  engine: typeof withEngine,
  hooks: SessionExecuteHooks,
): Promise<number> {
  if (!opts.id || opts.id.trim().length === 0) {
    stderr.write('ptah session load: <id> is required\n');
    return ExitCode.UsageError;
  }
  const id = opts.id;
  const writeFile =
    hooks.writeFile ?? ((p: string, d: string) => fs.writeFile(p, d, 'utf8'));

  return engine(globals, { mode: 'full' }, async (ctx) => {
    const storage = ctx.container.resolve<IStateStorage>(
      PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE,
    );
    const persisted = loadPersistedSession(storage, id);
    const sessionId = (persisted?.sdkSessionId ?? id) as SessionId;

    const result = await callRpc<SessionLoadResult>(
      ctx.transport,
      'session:load',
      { sessionId },
    );

    await formatter.writeNotification('session.history', {
      session_id: sessionId,
      tab_id: persisted?.tabId,
      messages: result?.messages ?? [],
      agentSessions: result?.agentSessions ?? [],
    });

    if (opts.out && opts.out.trim().length > 0) {
      await writeFile(opts.out, JSON.stringify(result ?? {}, null, 2));
    }

    return ExitCode.Success;
  });
}

async function runStats(
  opts: SessionOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  const sessionIds = parseCsv(opts.ids);

  return engine(globals, { mode: 'full' }, async (ctx) => {
    const workspaceProvider = ctx.container.resolve<IWorkspaceProvider>(
      PLATFORM_TOKENS.WORKSPACE_PROVIDER,
    );
    const workspacePath =
      workspaceProvider.getWorkspaceRoot() ?? globals.cwd ?? process.cwd();

    const result = await callRpc<SessionStatsBatchResult>(
      ctx.transport,
      'session:stats-batch',
      { sessionIds, workspacePath },
    );

    for (const entry of result?.sessionStats ?? []) {
      await formatter.writeNotification('session.stats', entry);
    }
    return ExitCode.Success;
  });
}

async function runValidate(
  opts: SessionOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: SessionStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.id || opts.id.trim().length === 0) {
    stderr.write('ptah session validate: <id> is required\n');
    return ExitCode.UsageError;
  }
  const id = opts.id;
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const workspaceProvider = ctx.container.resolve<IWorkspaceProvider>(
      PLATFORM_TOKENS.WORKSPACE_PROVIDER,
    );
    const storage = ctx.container.resolve<IStateStorage>(
      PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE,
    );
    const workspacePath =
      workspaceProvider.getWorkspaceRoot() ?? globals.cwd ?? process.cwd();

    const persisted = loadPersistedSession(storage, id);
    const sessionId = (persisted?.sdkSessionId ?? id) as SessionId;

    const result = await callRpc<{ exists: boolean; filePath?: string }>(
      ctx.transport,
      'session:validate',
      { sessionId, workspacePath },
    );

    await formatter.writeNotification('session.valid', {
      session_id: sessionId,
      tab_id: persisted?.tabId,
      valid: result?.exists === true,
      filePath: result?.filePath,
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// Helpers — module-private.
// ---------------------------------------------------------------------------

function parseCsv(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
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
