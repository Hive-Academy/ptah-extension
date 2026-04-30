/**
 * `ptah proxy` command — Anthropic-compatible HTTP proxy MVP.
 *
 * TASK_2026_104 P2 (Anthropic-compatible HTTP proxy).
 *
 * Three subcommands per `task-description.md`:
 *   - `ptah proxy start [...flags]` — bind the HTTP listener, mint a token,
 *     and run until SIGINT / SIGTERM / `proxy.shutdown` RPC.
 *   - `ptah proxy stop`             — Phase 2 deferred (TODO comment below).
 *   - `ptah proxy status`           — Phase 2 deferred (TODO comment below).
 *
 * The `start` action bootstraps DI via `withEngine({ mode: 'full' })` so the
 * proxy has full access to the chat surface (`chat:start`, `chat:chunk`,
 * etc.) plus the workspace MCP collector RPCs. The lifecycle blocks until
 * a terminal signal fires; teardown drains the proxy, deletes the token
 * file, and lets `withEngine` dispose the container.
 *
 * Permission gate enforcement: the proxy refuses to start when neither
 * `--auto-approve` nor an embedded `ptah interact` host is detected. When
 * embedded, the parent `interact` is responsible for installing the
 * `ApprovalBridge` — the proxy just verifies the env-var marker.
 *
 * All notifications go through the structured stderr formatter when there
 * is no JSON-RPC peer (i.e. when launched standalone). When embedded, the
 * caller wires a `JsonRpcServer` into `executeWith` so notifications flow
 * over stdout instead.
 *
 * No commit, no backwards compat — direct in-place command.
 */

import { withEngine } from '../bootstrap/with-engine.js';
import { ExitCode, type ExitCodeValue } from '../jsonrpc/types.js';
import { emitFatalError } from '../output/stderr-json.js';
import type { GlobalOptions } from '../router.js';
import {
  PLATFORM_TOKENS,
  type IHttpServerProvider,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { AnthropicProxyService } from '../../services/proxy/anthropic-proxy.service.js';

/** Options accepted by `ptah proxy start`. */
export interface ProxyStartOptions {
  /** TCP port to bind. Required for `start`. */
  port?: number;
  /** Bind host (default `localhost` — dual-stack IPv4/IPv6 loopback). */
  host?: string;
  /** Idle-timeout in seconds (0 disables — default). */
  idleTimeout?: number;
  /** Workspace MCP / plugin-skill exposure (default true). */
  exposeWorkspaceTools?: boolean;
}

/**
 * `ptah proxy start` — long-running HTTP listener.
 *
 * Resolves to an exit code so the router can set `process.exitCode` instead
 * of calling `process.exit` directly (matches the pattern used by every
 * other Batch 5+ command).
 */
export async function executeStart(
  opts: ProxyStartOptions,
  globals: GlobalOptions,
): Promise<number> {
  // ---- Validate flags -----------------------------------------------------
  if (typeof opts.port !== 'number' || !Number.isFinite(opts.port)) {
    emitFatalError('proxy_invalid_request', '`--port <n>` is required', {
      command: 'proxy start',
    });
    return ExitCode.UsageError;
  }
  if (opts.port < 0 || opts.port > 65535 || !Number.isInteger(opts.port)) {
    emitFatalError(
      'proxy_invalid_request',
      `--port must be an integer in [0, 65535] (got ${opts.port})`,
      { command: 'proxy start' },
    );
    return ExitCode.UsageError;
  }

  // Use 'localhost' (rather than '127.0.0.1') so Node's dual-stack DNS resolution
  // applies — clients that prefer IPv6 (::1) can still reach the proxy on hosts
  // where the loopback iface only exposes one of the two address families.
  const host = opts.host ?? 'localhost';
  // `--auto-approve` is a global flag (see `program.option` in router.ts) so
  // we read it from `globals` rather than the subcommand-level `opts` to
  // avoid commander's parent/subcommand option-name conflict (the value lands
  // on the parent only when both are declared).
  const autoApprove = globals.autoApprove === true;
  const exposeWorkspaceTools = opts.exposeWorkspaceTools !== false;
  const embedded = process.env['PTAH_INTERACT_ACTIVE'] === '1';

  // Permission gate fail-fast.
  if (!autoApprove && !embedded) {
    emitFatalError(
      'permission_gate_unavailable',
      '`ptah proxy start` requires either `--auto-approve` or to be launched embedded inside `ptah interact`',
      { command: 'proxy start' },
    );
    return ExitCode.AuthRequired;
  }

  let exitCode: ExitCodeValue = ExitCode.Success;

  try {
    await withEngine(globals, { mode: 'full' }, async (ctx) => {
      const httpProvider = ctx.container.resolve<IHttpServerProvider>(
        PLATFORM_TOKENS.HTTP_SERVER_PROVIDER,
      );
      const workspaceProvider = ctx.container.resolve<IWorkspaceProvider>(
        PLATFORM_TOKENS.WORKSPACE_PROVIDER,
      );
      const workspacePath =
        workspaceProvider.getWorkspaceRoot() ?? globals.cwd ?? process.cwd();

      const proxy = new AnthropicProxyService(
        {
          host,
          port: opts.port as number,
          exposeWorkspaceTools,
          autoApprove,
          workspacePath,
          idleTimeoutSeconds: opts.idleTimeout ?? 0,
        },
        httpProvider,
        ctx.transport,
        ctx.pushAdapter,
        // No JSON-RPC peer when standalone — notifications drop. When
        // embedded inside `interact`, the parent process bridges the proxy
        // by importing this command's internals (see Phase 2 TODO below).
      );

      try {
        const { port, host: boundHost, tokenPath } = await proxy.start();
        // Surface the bound address to stderr so supervisors can scrape it
        // when the JSON-RPC stdout channel is unavailable.
        process.stderr.write(
          `[ptah] proxy listening on http://${boundHost}:${port} (token: ${tokenPath})\n`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emitFatalError('proxy_bind_failed', message, {
          command: 'proxy start',
          host,
          port: opts.port,
        });
        exitCode = ExitCode.GeneralError;
        return;
      }

      // Block until SIGINT / SIGTERM. EOF on stdin is NOT used because
      // the standalone proxy doesn't read stdin.
      let resolveBlock: (() => void) | null = null;
      const blockPromise = new Promise<void>((resolve) => {
        resolveBlock = resolve;
      });
      const onSigint = (): void => {
        process.stderr.write('[ptah] proxy received sigint, shutting down\n');
        resolveBlock?.();
      };
      const onSigterm = (): void => {
        process.stderr.write('[ptah] proxy received sigterm, shutting down\n');
        resolveBlock?.();
      };
      process.once('SIGINT', onSigint);
      process.once('SIGTERM', onSigterm);

      try {
        await blockPromise;
      } finally {
        process.off('SIGINT', onSigint);
        process.off('SIGTERM', onSigterm);
        await proxy.stop('shutdown');
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emitFatalError('internal_failure', message, {
      command: 'proxy start',
    });
    return ExitCode.InternalFailure;
  }

  return exitCode;
}

/**
 * `ptah proxy stop` — Phase 2 deferred.
 *
 * TODO (Phase 2): wire by reading `~/.ptah/proxy/<port>.token` and POSTing
 * to a future `/admin/shutdown` endpoint. The MVP only supports lifecycle
 * via SIGINT / SIGTERM / `proxy.shutdown` RPC.
 */
export async function executeStop(
  _opts: { port?: number },
  _globals: GlobalOptions,
): Promise<number> {
  process.stderr.write(
    '[ptah] proxy stop is deferred to Phase 2 — send SIGINT to the running `ptah proxy start` process or call the `proxy.shutdown` RPC from `ptah interact`\n',
  );
  return ExitCode.UsageError;
}

/**
 * `ptah proxy status` — Phase 2 deferred.
 *
 * TODO (Phase 2): inspect `~/.ptah/proxy/*.token` and probe `/healthz` on
 * each candidate port. The MVP has no way to enumerate running proxies.
 */
export async function executeStatus(
  _opts: Record<string, never>,
  _globals: GlobalOptions,
): Promise<number> {
  process.stderr.write(
    '[ptah] proxy status is deferred to Phase 2 — check `~/.ptah/proxy/*.token` for active proxies\n',
  );
  return ExitCode.UsageError;
}
