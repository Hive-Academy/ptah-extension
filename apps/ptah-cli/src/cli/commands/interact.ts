/**
 * `ptah interact` command — full bidirectional A2A JSON-RPC stdio bridge.
 *
 * The canonical persistent JSON-RPC 2.0 stdio loop that an A2A peer (Electron
 * app, IDE plugin, automation harness) drives end-to-end:
 *
 *   1. Bootstraps full DI ONCE via `withEngine({ mode: 'full' })`.
 *   2. Attaches the `EventPipe` to the push adapter so non-chat backend
 *      events (setup-wizard.*, harness.*, plugin.*, mcp.*, agent.*, etc.)
 *      flow out as JSON-RPC notifications.
 *   3. Wires `ApprovalBridge` — backend permission/question requests
 *      ↔ JSON-RPC `permission.request | question.ask` notifications + inbound
 *      `permission.response | question.response` handlers.
 *   4. Holds a singleton `ChatBridge` (B10b) used by `task.submit` to bridge
 *      the backend's fire-and-forget `chat:start | chat:continue` RPCs into
 *      JSON-RPC turn-completion semantics (`agent.thought | agent.message |
 *      agent.tool_use | agent.tool_result` while in flight; `chat:complete |
 *      chat:error | task.cancel` settle the turn).
 *   5. Emits `session.ready { session_id, version, capabilities,
 *      protocol_version: '2.0' }` ONCE at startup, AFTER bridges attach but
 *      BEFORE inbound handlers register — per spec § 4.1.1.
 *   6. Registers the four inbound A2A handlers:
 *        - `task.submit`     — start/continue a turn, await completion
 *        - `task.cancel`     — race the in-flight runTurn with `chat:abort`
 *        - `session.shutdown`— respond `{shutdown:true}` then drain & exit 0
 *        - `session.history` — proxy `session:load` (best-effort trim)
 *   7. EOF / SIGINT / SIGTERM → graceful drain (≤ 5s) + `process.exit({0|130|143})`.
 *
 * Concurrency invariants:
 *   - Only ONE turn may be in flight (`currentTurnId !== null` rejects new
 *     `task.submit` with `-32603 'turn already in flight'`).
 *   - `task.cancel` against the in-flight turn races with the `runTurn`
 *     promise via an `AbortController` per-turn; the result resolves
 *     `{success:false, cancelled:true}`.
 *   - The drain path is idempotent — multiple `session.shutdown | EOF | SIGINT`
 *     re-entries early-exit on `shuttingDown`.
 *
 * No DI imports beyond `@ptah-extension/{platform-core, agent-sdk, shared}`.
 * The bridges and the JSON-RPC server are constructed in this file (with
 * test-injectable hooks). Tests pass `PassThrough` streams + a vanilla
 * `EventEmitter` and assert on the NDJSON line wire.
 */

import { randomUUID as nodeRandomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Readable, Writable } from 'node:stream';

import { withEngine } from '../bootstrap/with-engine.js';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { EventPipe } from '../output/event-pipe.js';
import { JsonRpcServer } from '../jsonrpc/server.js';
import { StdinReader } from '../io/stdin-reader.js';
import { StdoutWriter } from '../io/stdout-writer.js';
import { ChatBridge } from '../session/chat-bridge.js';
import { ApprovalBridge } from '../session/approval-bridge.js';
import { buildSessionDescribe } from '../session/session-describe.builder.js';
import { ExitCode, JSONRPC_SCHEMA_VERSION } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import {
  PLATFORM_TOKENS,
  type IHttpServerProvider,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type { ISdkPermissionHandler } from '@ptah-extension/shared';
import {
  AnthropicProxyService,
  type AnthropicProxyConfig,
  type ProxyNotifier,
} from '../../services/proxy/anthropic-proxy.service.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';
import type { CliWebviewManagerAdapter } from '../../transport/cli-webview-manager-adapter.js';

export interface InteractOptions {
  /** Optional resume target — currently only echoed in `session.ready`. */
  session?: string;
  /** Boot an embedded Anthropic-compatible HTTP proxy. */
  proxyStart?: boolean;
  /** TCP port for the embedded proxy (0 = OS-assigned). */
  proxyPort?: number;
  /** Bind host for the embedded proxy. */
  proxyHost?: string;
  /** Surface workspace MCP tools via embedded proxy. */
  proxyExposeWorkspaceTools?: boolean;
}

/**
 * Minimal surface of `AnthropicProxyService` consumed by `interact.ts`.
 * Defined here so the `proxyServiceFactory` hook can deliver a
 * `jest.Mocked<AnthropicProxyServiceLike>` without leaking any `as any`
 * casts into the spec.
 */
export interface AnthropicProxyServiceLike {
  start(): Promise<{
    port: number;
    host: string;
    tokenPath: string;
    /** Sha256 fingerprint of the bearer token. */
    tokenFingerprint: string;
  }>;
  stop(reason?: 'shutdown' | 'sigint' | 'rpc'): Promise<void>;
  registerShutdownRpc(
    server: Pick<JsonRpcServer, 'register' | 'unregister'>,
  ): () => void;
}

/** Production factory — wires the real `AnthropicProxyService` constructor. */
function defaultProxyServiceFactory(
  config: AnthropicProxyConfig,
  httpProvider: IHttpServerProvider,
  transport: CliMessageTransport,
  pushAdapter: CliWebviewManagerAdapter,
  notifier: ProxyNotifier,
): AnthropicProxyServiceLike {
  return new AnthropicProxyService(
    config,
    httpProvider,
    transport,
    pushAdapter,
    notifier,
  );
}

/**
 * Test-injection seam. Production callers omit every field; the defaults wire
 * the real engine, real `process.std{in,out}`, real `process.exit`, etc.
 *
 * Splitting the seams here lets the spec drive the loop deterministically
 * with `PassThrough` streams + fake exit + fake clock without monkey-patching
 * Node globals.
 */
export interface InteractExecuteHooks {
  /** Override the DI bootstrap (default: production `withEngine`). */
  withEngine?: typeof withEngine;
  /** Override the formatter (default: `buildFormatter(globals)`). */
  formatter?: Formatter;
  /** Override the JSON-RPC server (default: a new `JsonRpcServer`). */
  server?: JsonRpcServer;
  /** Override stdin source (default: `process.stdin`). */
  stdin?: Readable;
  /** Override stdout sink (default: `process.stdout`). */
  stdout?: Writable;
  /** Override `crypto.randomUUID` (default: `node:crypto.randomUUID`). */
  randomUUID?: () => string;
  /** Override `process.exit` (default: real). Tests pass a `jest.fn()`. */
  exit?: (code: number) => void;
  /**
   * Override SIGINT/SIGTERM installer. Receives the signal name + handler;
   * returns an unregistration function. Production: `process.on(signal, h)`.
   */
  installSignal?: (
    signal: 'SIGINT' | 'SIGTERM',
    handler: () => void,
  ) => () => void;
  /** Override the package version (default: `'0.1.0'` per package.json). */
  version?: string;
  /** Override the drain timeout (default 5_000 ms — spec § 9 criterion). */
  drainTimeoutMs?: number;
  /**
   * When true, the body returns the resolved exit code instead of calling
   * `exit`. Used by tests that want to await the natural settle without an
   * `exit()` mock.
   */
  returnExitCode?: boolean;
  /**
   * Test seam for the embedded proxy lifecycle. Production callers omit this;
   * `defaultProxyServiceFactory` wires the real `AnthropicProxyService`
   * constructor. Tests inject a `jest.Mocked<AnthropicProxyServiceLike>`.
   */
  proxyServiceFactory?: (
    config: AnthropicProxyConfig,
    httpProvider: IHttpServerProvider,
    transport: CliMessageTransport,
    pushAdapter: CliWebviewManagerAdapter,
    notifier: ProxyNotifier,
  ) => AnthropicProxyServiceLike;
}

interface TaskSubmitParams {
  task: string;
  cwd?: string;
  profile?: 'claude_code' | 'enhanced';
}

interface TaskCancelParams {
  turn_id: string;
}

interface SessionHistoryParams {
  limit?: number;
}

interface RunTurnResult {
  turn_id: string;
  complete: boolean;
  cancelled?: boolean;
  error?: string;
  session_id?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asTaskSubmit(params: unknown): TaskSubmitParams {
  if (!isPlainObject(params)) throw new Error('task.submit: params required');
  const task = params['task'];
  if (typeof task !== 'string' || task.length === 0) {
    throw new Error("task.submit: 'task' (non-empty string) required");
  }
  const cwd = typeof params['cwd'] === 'string' ? params['cwd'] : undefined;
  const profileRaw = params['profile'];
  const profile =
    profileRaw === 'claude_code' || profileRaw === 'enhanced'
      ? profileRaw
      : undefined;
  const out: TaskSubmitParams = { task };
  if (cwd !== undefined) out.cwd = cwd;
  if (profile !== undefined) out.profile = profile;
  return out;
}

function asTaskCancel(params: unknown): TaskCancelParams {
  if (!isPlainObject(params)) throw new Error('task.cancel: params required');
  const turnId = params['turn_id'];
  if (typeof turnId !== 'string' || turnId.length === 0) {
    throw new Error("task.cancel: 'turn_id' required");
  }
  return { turn_id: turnId };
}

function asSessionHistory(params: unknown): SessionHistoryParams {
  if (!isPlainObject(params)) return {};
  const limit = params['limit'];
  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
    return { limit };
  }
  return {};
}

/**
 * Run the `ptah interact` command. Resolves to a process exit code; when
 * `hooks.returnExitCode === true` the exit code is returned to the caller
 * instead of invoking `process.exit`.
 *
 * The loop runs until one of the following terminal events fires:
 *   - stdin EOF              → graceful drain → exit 0
 *   - `session.shutdown` RPC → respond `{shutdown:true}` → drain → exit 0
 *   - SIGINT                 → drain → exit 130
 *   - SIGTERM                → drain → exit 143
 *   - Uncaught throw at top  → emit `task.error{ptah_code:'internal_failure'}` → exit 5
 */
export async function execute(
  opts: InteractOptions,
  globals: GlobalOptions,
  hooks: InteractExecuteHooks = {},
): Promise<number> {
  const formatter = hooks.formatter ?? buildFormatter(globals);
  const engine = hooks.withEngine ?? withEngine;
  const uuid = hooks.randomUUID ?? nodeRandomUUID;
  const proxyServiceFactory =
    hooks.proxyServiceFactory ?? defaultProxyServiceFactory;
  const exit =
    hooks.exit ??
    ((code: number): void => {
      process.exit(code);
    });
  const installSignal =
    hooks.installSignal ??
    ((signal, handler) => {
      process.on(signal, handler);
      return () => {
        process.off(signal, handler);
      };
    });
  const drainTimeoutMs = hooks.drainTimeoutMs ?? 5_000;
  const version = hooks.version ?? '0.1.0';

  if (hooks.stdin === undefined && process.stdin.isTTY === true) {
    process.stderr.write(
      '[ptah] interact: waiting for newline-delimited JSON-RPC 2.0 requests on stdin.\n' +
        '[ptah] each request is one JSON object per line, e.g. ' +
        '{"jsonrpc":"2.0","id":1,"method":"task.submit","params":{"task":"..."}}\n' +
        '[ptah] exit with Ctrl-D (EOF) or Ctrl-C. For a one-shot human run prefer ' +
        '`ptah session start --task "..." --once --human`.\n',
    );
  }

  let resolvedExitCode: number | null = null;

  try {
    await engine(globals, { mode: 'full' }, async (ctx) => {
      const priorInteractActiveSet = Object.prototype.hasOwnProperty.call(
        process.env,
        'PTAH_INTERACT_ACTIVE',
      );
      const priorInteractActive: string | undefined = priorInteractActiveSet
        ? process.env['PTAH_INTERACT_ACTIVE']
        : undefined;
      process.env['PTAH_INTERACT_ACTIVE'] = '1';
      const tabId = uuid();
      let sessionId: string = tabId;
      let firstTurn = true;
      let currentTurnId: string | null = null;
      let inFlightAbort: AbortController | null = null;
      let shuttingDown = false;

      const workspaceProvider = ctx.container.resolve<IWorkspaceProvider>(
        PLATFORM_TOKENS.WORKSPACE_PROVIDER,
      );
      const workspacePath =
        workspaceProvider.getWorkspaceRoot() ?? globals.cwd ?? process.cwd();
      const stdoutWriter = new StdoutWriter({
        output: hooks.stdout ?? process.stdout,
      });
      const stdinReader = new StdinReader({
        input: hooks.stdin ?? process.stdin,
      });
      const server = hooks.server ?? new JsonRpcServer();
      const jsonrpcShim = {
        notify: <TParams = unknown>(
          method: string,
          params?: TParams,
        ): Promise<void> => server.notify(method, params),
        register: (
          method: string,
          handler: (params: unknown) => Promise<unknown> | unknown,
        ): void => server.register(method, handler),
        unregister: (method: string): void => server.unregister(method),
      };
      const eventPipe = new EventPipe(formatter, {
        verbose: globals.verbose === true,
      });
      eventPipe.attach(ctx.pushAdapter as unknown as EventEmitter);
      const chatBridge = new ChatBridge(
        ctx.pushAdapter as unknown as EventEmitter,
        jsonrpcShim,
      );
      let approvalBridge: ApprovalBridge | undefined;
      try {
        const permissionHandler = ctx.container.resolve<ISdkPermissionHandler>(
          SDK_TOKENS.SDK_PERMISSION_HANDLER,
        );
        approvalBridge = new ApprovalBridge(
          ctx.pushAdapter as unknown as EventEmitter,
          jsonrpcShim,
          permissionHandler,
        );
        approvalBridge.attach();
      } catch (resolveError) {
        const message =
          resolveError instanceof Error
            ? resolveError.message
            : String(resolveError);
        process.stderr.write(
          `[ptah] approval bridge unavailable (continuing without permission round-trip): ${message}\n`,
        );
      }
      server.start(stdinReader, stdoutWriter);
      let embeddedProxy: AnthropicProxyServiceLike | null = null;
      let embeddedProxyUnregister: (() => void) | null = null;
      if (opts.proxyStart === true) {
        const httpProvider = ctx.container.resolve<IHttpServerProvider>(
          PLATFORM_TOKENS.HTTP_SERVER_PROVIDER,
        );
        const proxyConfig: AnthropicProxyConfig = {
          host: opts.proxyHost ?? '127.0.0.1',
          port: typeof opts.proxyPort === 'number' ? opts.proxyPort : 0,
          exposeWorkspaceTools: opts.proxyExposeWorkspaceTools === true,
          autoApprove: false,
          workspacePath,
        };
        const proxyNotifier: ProxyNotifier = {
          notify: <T = unknown>(method: string, params?: T): Promise<void> =>
            server.notify(method, params),
        };
        embeddedProxy = proxyServiceFactory(
          proxyConfig,
          httpProvider,
          ctx.transport,
          ctx.pushAdapter,
          proxyNotifier,
        );
        const bound = await embeddedProxy.start();
        embeddedProxyUnregister = embeddedProxy.registerShutdownRpc(server);
        process.stderr.write(
          `[ptah] proxy listening on http://${bound.host}:${bound.port}\n`,
        );
      }
      let resolveDrain: (code: number) => void = () => undefined;
      const drainPromise = new Promise<number>((resolve) => {
        resolveDrain = resolve;
      });
      const setExit = (code: number): void => {
        if (shuttingDown) return;
        shuttingDown = true;
        resolveDrain(code);
      };
      const stdinSource = hooks.stdin ?? process.stdin;
      const onStdinEnd = (): void => {
        setExit(ExitCode.Success);
      };
      stdinSource.once('end', onStdinEnd);
      stdinSource.once('close', onStdinEnd);
      const uninstallSigint = installSignal('SIGINT', () => {
        setExit(130);
      });
      const uninstallSigterm = installSignal('SIGTERM', () => {
        setExit(143);
      });
      await server.notify('session.ready', {
        session_id: tabId,
        version,
        schema_version: JSONRPC_SCHEMA_VERSION,
        capabilities: ['chat', 'session', 'permission', 'question'],
        protocol_version: '2.0',
      });
      await server.notify('system.schema.version', {
        version: JSONRPC_SCHEMA_VERSION,
        cliVersion: version,
      });

      server.register(
        'task.submit',
        async (params: unknown): Promise<RunTurnResult> => {
          if (currentTurnId !== null) {
            throw new Error(
              `turn already in flight (current_turn_id=${currentTurnId})`,
            );
          }
          const { task, profile } = asTaskSubmit(params);
          const turnId = uuid();
          currentTurnId = turnId;

          const abortController = new AbortController();
          inFlightAbort = abortController;

          const rpcMethod = firstTurn ? 'chat:start' : 'chat:continue';
          const rpcParams: Record<string, unknown> = firstTurn
            ? {
                tabId,
                prompt: task,
                workspacePath,
                ...(profile ? { options: { preset: profile } } : {}),
              }
            : {
                tabId,
                prompt: task,
                sessionId,
                workspacePath,
              };

          try {
            const result = await chatBridge.runTurn({
              tabId,
              command: 'task.submit',
              rpcCall: async () => {
                const resp = await ctx.transport.call<unknown, unknown>(
                  rpcMethod,
                  rpcParams,
                );
                return { success: resp.success === true };
              },
              abortSignal: abortController.signal,
            });

            firstTurn = false;
            if (result.success === true) {
              if (result.sessionId && result.sessionId !== tabId) {
                sessionId = result.sessionId;
              }
              return { turn_id: turnId, complete: true };
            }
            const out: RunTurnResult = {
              turn_id: turnId,
              complete: false,
            };
            if (result.cancelled === true) out.cancelled = true;
            if (typeof result.error === 'string') out.error = result.error;
            if (result.sessionId) out.session_id = result.sessionId;
            return out;
          } finally {
            currentTurnId = null;
            inFlightAbort = null;
          }
        },
      );

      server.register(
        'task.cancel',
        async (
          params: unknown,
        ): Promise<{
          cancelled: boolean;
          turn_id?: string;
          reason?: string;
        }> => {
          const { turn_id } = asTaskCancel(params);
          if (turn_id !== currentTurnId || inFlightAbort === null) {
            return { cancelled: false, reason: 'no matching turn' };
          }

          await ctx.transport.call('chat:abort', { sessionId: tabId });

          inFlightAbort.abort();
          return { cancelled: true, turn_id };
        },
      );

      server.register(
        'session.shutdown',
        async (): Promise<{
          shutdown: boolean;
        }> => {
          setImmediate(() => {
            setExit(ExitCode.Success);
          });
          return { shutdown: true };
        },
      );

      server.register(
        'session.history',
        async (
          params: unknown,
        ): Promise<{
          messages: unknown[];
          session_id: string;
        }> => {
          const { limit } = asSessionHistory(params);
          const resp = await ctx.transport.call<
            unknown,
            { messages?: unknown[] }
          >('session:load', {
            sessionId,
            workspacePath,
          });
          if (!resp.success) {
            throw new Error(resp.error ?? 'session:load failed');
          }
          const all = resp.data?.messages ?? [];
          const trimmed =
            limit !== undefined && all.length > limit
              ? all.slice(all.length - limit)
              : all;
          return { messages: trimmed, session_id: sessionId };
        },
      );
      server.register(
        'rpc.call',
        async (
          params: unknown,
        ): Promise<{ success: boolean; data?: unknown; error?: string }> => {
          if (
            params === null ||
            typeof params !== 'object' ||
            typeof (params as { method?: unknown }).method !== 'string'
          ) {
            throw new Error(
              'rpc.call requires { method: string, params?: unknown }',
            );
          }
          const { method, params: methodParams } = params as {
            method: string;
            params?: unknown;
          };
          const resp = await ctx.transport.call<unknown, unknown>(
            method,
            methodParams ?? {},
          );
          const out: { success: boolean; data?: unknown; error?: string } = {
            success: resp.success === true,
          };
          if (resp.data !== undefined) out.data = resp.data;
          if (typeof resp.error === 'string') out.error = resp.error;
          return out;
        },
      );

      server.register('session.describe', async () =>
        buildSessionDescribe({
          mode: 'interact',
          version,
          schemaVersion: JSONRPC_SCHEMA_VERSION,
          methods: server.getRegisteredMethods(),
        }),
      );

      server.register('session.methods', async () => ({
        methods: server.getRegisteredMethods(),
      }));

      const exitCode = await drainPromise;
      await drainWithTimeout(async () => {
        stdinSource.off('end', onStdinEnd);
        stdinSource.off('close', onStdinEnd);
        uninstallSigint();
        uninstallSigterm();
        if (inFlightAbort !== null) {
          inFlightAbort.abort();
        }
        approvalBridge?.detach();
        eventPipe.detach();
        if (embeddedProxy !== null) {
          try {
            await embeddedProxy.stop('shutdown');
          } catch (proxyStopErr) {
            process.stderr.write(
              `[ptah] embedded proxy stop error: ${
                proxyStopErr instanceof Error
                  ? proxyStopErr.message
                  : String(proxyStopErr)
              }\n`,
            );
          }
        }
        if (embeddedProxyUnregister !== null) {
          embeddedProxyUnregister();
        }
        server.stop();

        await formatter.close();
        if (priorInteractActiveSet && priorInteractActive !== undefined) {
          process.env['PTAH_INTERACT_ACTIVE'] = priorInteractActive;
        } else {
          delete process.env['PTAH_INTERACT_ACTIVE'];
        }
      }, drainTimeoutMs);

      resolvedExitCode = exitCode;
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const ptahCode =
      (err as { ptahCode?: string }).ptahCode ?? 'internal_failure';

    await formatter.writeNotification('task.error', {
      ptah_code: ptahCode,
      command: 'interact',
      message,
    });

    if (globals.verbose === true && err instanceof Error && err.stack) {
      process.stderr.write(`${err.stack}\n`);
    }
    resolvedExitCode = ExitCode.InternalFailure;
  }

  const code = resolvedExitCode ?? ExitCode.Success;

  if (hooks.returnExitCode === true) {
    return code;
  }
  exit(code);
  return code;
}

/**
 * Race a teardown closure against `timeoutMs`. The closure is started
 * immediately; if it doesn't settle in time we resolve anyway. Errors thrown
 * inside the closure are swallowed (logged to stderr) — drain MUST be
 * best-effort.
 */
async function drainWithTimeout(
  drain: () => Promise<void>,
  timeoutMs: number,
): Promise<void> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<void>((resolve) => {
    timeoutHandle = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([
      (async () => {
        try {
          await drain();
        } catch (err) {
          process.stderr.write(
            `[ptah] interact drain error: ${
              err instanceof Error ? err.message : String(err)
            }\n`,
          );
        }
      })(),
      timeoutPromise,
    ]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}
