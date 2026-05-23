/**
 * `ptah mcp-serve` command — stdio MCP server for external hosts.
 *
 * Hosts Ptah as a Model Context Protocol server over stdin/stdout so external
 * MCP clients (Claude Code, Cursor, Gemini CLI, etc.) can drive Ptah's agent
 * surface through their existing MCP integrations. The wire framing matches
 * `ptah interact` — JSON-RPC 2.0 over NDJSON — but the method namespace is
 * the MCP standard (`initialize`, `tools/list`, `tools/call`,
 * `notifications/cancelled`) instead of Ptah-flavored `task.*` / `session.*`
 * methods.
 *
 * Phase 2 lifecycle:
 *   1. Mint `mcp_host_session_id = ulid()` and export it via
 *      `PTAH_MCP_HOST_SESSION_ID` for downstream cost attribution (Phase 4).
 *   2. Register the `initialize` handler EAGERLY (before `withEngine`
 *      resolves) so a slow SDK bootstrap doesn't trigger the host's
 *      handshake timeout — Risk Register item #4. The same `JsonRpcServer`
 *      instance is reused after `withEngine` resolves; Phase 3 will swap
 *      in the real `tools/call` dispatcher.
 *   3. Bootstrap full DI via `withEngine({ mode: 'full', requireSdk: true })`.
 *   4. Resolve the `StdioMcpServerService`, attach the stdio transport,
 *      register `tools/list`, `tools/call`, `notifications/cancelled`.
 *   5. Emit `notifications/initialized` so the MCP host knows the surface
 *      is ready.
 *   6. SIGINT(130) / SIGTERM(143) / stdin-EOF(0) drain race against a 5s
 *      cap — direct port of `interact.ts:634-662`.
 *
 * stdout is RESERVED for the MCP wire. All boot/teardown logging goes to
 * stderr with the `[ptah-mcp]` prefix; `--verbose` does NOT relax this
 * (stdout must stay pristine).
 */

import type { Readable, Writable } from 'node:stream';

import { ulid } from 'ulid';

import { withEngine } from '../bootstrap/with-engine.js';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { JsonRpcServer, InvalidParamsError } from '../jsonrpc/server.js';
import { StdinReader } from '../io/stdin-reader.js';
import { StdoutWriter } from '../io/stdout-writer.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  registerMcpStdioServices,
  STDIO_MCP_SERVER_TOKEN,
  StdioTransport,
  type StdioMcpServerService,
  type StdioMcpServerInfo,
} from '@ptah-extension/vscode-lm-tools';
import type { MCPRequest } from '@ptah-extension/vscode-lm-tools';

export interface McpServeOptions {
  /**
   * Tool allowlist override. CSV string from the `--allow-tools` flag
   * already coerced by the router. When undefined, the full 7-tool MVP
   * catalog is advertised.
   */
  allowTools?: readonly string[];
}

export interface McpServeExecuteHooks {
  withEngine?: typeof withEngine;
  formatter?: Formatter;
  server?: JsonRpcServer;
  stdin?: Readable;
  stdout?: Writable;
  randomId?: () => string;
  exit?: (code: number) => void;
  installSignal?: (
    signal: 'SIGINT' | 'SIGTERM',
    handler: () => void,
  ) => () => void;
  version?: string;
  drainTimeoutMs?: number;
  returnExitCode?: boolean;
  serverFactory?: (logger: Logger) => StdioMcpServerService;
}

/** Build the `serverInfo` block advertised on `initialize`. */
function buildServerInfo(version: string): StdioMcpServerInfo {
  return { name: 'ptah', version };
}

/**
 * Cast an inbound `params` value into a structured MCP request object.
 * The wire-level `JsonRpcServer` strips the JSON-RPC envelope before
 * invoking the handler, so we re-synthesize the `MCPRequest` shape with a
 * synthetic id; the response id is then forwarded by `JsonRpcServer` via
 * its own correlation tracking.
 */
function buildMcpRequest(
  id: string | number,
  method: string,
  params: unknown,
): MCPRequest {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params:
      params !== null && typeof params === 'object'
        ? (params as Record<string, unknown>)
        : undefined,
  };
}

/**
 * Run `ptah mcp-serve`. Resolves to a process exit code; when
 * `hooks.returnExitCode === true` the code is returned to the caller
 * instead of invoking `process.exit`.
 *
 * Terminal events:
 *   - stdin EOF             → drain → exit 0
 *   - SIGINT                → drain → exit 130
 *   - SIGTERM               → drain → exit 143
 *   - Uncaught throw at top → stderr + exit 5
 */
export async function execute(
  opts: McpServeOptions,
  globals: GlobalOptions,
  hooks: McpServeExecuteHooks = {},
): Promise<number> {
  const formatter = hooks.formatter ?? buildFormatter(globals);
  const engine = hooks.withEngine ?? withEngine;
  const randomId = hooks.randomId ?? ulid;
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
  const serverInfo = buildServerInfo(version);
  const mcpHostSessionId = randomId();
  const priorSessionIdSet = Object.prototype.hasOwnProperty.call(
    process.env,
    'PTAH_MCP_HOST_SESSION_ID',
  );
  const priorSessionId: string | undefined = priorSessionIdSet
    ? process.env['PTAH_MCP_HOST_SESSION_ID']
    : undefined;
  process.env['PTAH_MCP_HOST_SESSION_ID'] = mcpHostSessionId;

  process.stderr.write(
    `[ptah-mcp] starting (session=${mcpHostSessionId}, pid=${process.pid}, version=${version})\n`,
  );

  const stdoutWriter = new StdoutWriter({
    output: hooks.stdout ?? process.stdout,
  });
  const stdinReader = new StdinReader({
    input: hooks.stdin ?? process.stdin,
  });
  const server = hooks.server ?? new JsonRpcServer();

  let cachedServerService: StdioMcpServerService | null = null;
  let sdkReady = false;

  server.register('initialize', async (params: unknown): Promise<unknown> => {
    const req = buildMcpRequest(randomId(), 'initialize', params);
    if (cachedServerService !== null) {
      const resp = cachedServerService.handleInitialize(req, serverInfo);
      return (resp.result ?? null) as unknown;
    }
    return {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo,
    };
  });

  server.start(stdinReader, stdoutWriter);

  let resolveDrain: (code: number) => void = () => undefined;
  const drainPromise = new Promise<number>((resolve) => {
    resolveDrain = resolve;
  });
  let shuttingDown = false;
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

  let resolvedExitCode: number | null = null;
  let transport: StdioTransport | null = null;

  try {
    await engine(globals, { mode: 'full', requireSdk: true }, async (ctx) => {
      const logger = ctx.container.resolve<Logger>(TOKENS.LOGGER);
      registerMcpStdioServices(ctx.container, logger);

      const stdioServer =
        hooks.serverFactory !== undefined
          ? hooks.serverFactory(logger)
          : ctx.container.resolve<StdioMcpServerService>(
              STDIO_MCP_SERVER_TOKEN,
            );
      cachedServerService = stdioServer;
      sdkReady = true;

      transport = new StdioTransport({
        notifier: {
          notify: <TParams>(method: string, params?: TParams): Promise<void> =>
            server.notify(method, params),
        },
      });
      await transport.start();

      server.register(
        'tools/list',
        async (params: unknown): Promise<unknown> => {
          const req = buildMcpRequest(randomId(), 'tools/list', params);
          const resp = stdioServer.handleToolsList(req, opts.allowTools);
          return (resp.result ?? null) as unknown;
        },
      );

      server.register(
        'tools/call',
        async (params: unknown): Promise<unknown> => {
          if (!sdkReady) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'SDK not initialized — `ptah mcp-serve` is still bootstrapping.',
                },
              ],
              isError: true,
              structuredContent: { ptah_code: 'sdk_init_failed' },
            };
          }
          const req = buildMcpRequest(randomId(), 'tools/call', params);
          const resp = await stdioServer.handleToolsCall(req);
          if (resp.error !== undefined) {
            if (resp.error.code === -32602) {
              throw new InvalidParamsError(resp.error.message, resp.error.data);
            }
            const err = new Error(resp.error.message);
            (err as unknown as { code: number; data: unknown }).code =
              resp.error.code;
            (err as unknown as { code: number; data: unknown }).data =
              resp.error.data;
            throw err;
          }
          return (resp.result ?? null) as unknown;
        },
      );

      server.register(
        'notifications/cancelled',
        async (params: unknown): Promise<void> => {
          await stdioServer.handleCancelled(params);
        },
      );

      await server.notify('notifications/initialized', {
        serverInfo,
        mcpHostSessionId,
      });

      process.stderr.write(
        `[ptah-mcp] ready (tools=${(opts.allowTools ?? []).join(',') || 'mvp:7'})\n`,
      );

      const exitCode = await drainPromise;
      await drainWithTimeout(async () => {
        stdinSource.off('end', onStdinEnd);
        stdinSource.off('close', onStdinEnd);
        uninstallSigint();
        uninstallSigterm();
        if (transport !== null) {
          await transport.stop();
        }
        server.stop();
        await formatter.close();
        if (priorSessionIdSet && priorSessionId !== undefined) {
          process.env['PTAH_MCP_HOST_SESSION_ID'] = priorSessionId;
        } else {
          delete process.env['PTAH_MCP_HOST_SESSION_ID'];
        }
      }, drainTimeoutMs);

      resolvedExitCode = exitCode;
      process.stderr.write(`[ptah-mcp] shut down (exit=${exitCode})\n`);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[ptah-mcp] fatal: ${message}\n`);
    resolvedExitCode = ExitCode.InternalFailure;
  }

  const code = resolvedExitCode ?? ExitCode.Success;
  if (hooks.returnExitCode === true) {
    return code;
  }
  exit(code);
  return code;
}

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
            `[ptah-mcp] drain error: ${
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
