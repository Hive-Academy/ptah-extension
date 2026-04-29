/**
 * CliHttpServerProvider — IHttpServerProvider implementation using `node:http`.
 *
 * TASK_2026_104 P2 (Anthropic-compatible HTTP proxy).
 *
 * Wraps Node's built-in `http.createServer` so the proxy service stays
 * test-mockable and platform-agnostic. No new npm dependencies — only the
 * built-in `node:http` module.
 *
 * Lifecycle contract (mirrors the interface docblock):
 *   - `listen(host, port, handler)` resolves once the server has bound. Pass
 *     `port: 0` to let the OS assign a free port — the actual bound port is
 *     returned via `IHttpServerHandle.port`.
 *   - Bind failures (`EADDRINUSE`, `EACCES`, etc.) reject the returned promise
 *     with the underlying Node error — callers map these to the
 *     `proxy_bind_failed` PtahErrorCode.
 *   - `close()` is idempotent: the second invocation resolves on the first
 *     close's completion without throwing.
 *   - Handler exceptions are caught and translated to a 500 Internal Server
 *     Error response (best-effort — the proxy service writes its own SSE
 *     error events when streaming has already started).
 */

import * as http from 'http';
import type {
  IHttpServerProvider,
  IHttpServerHandle,
  HttpServerRequestHandler,
} from '@ptah-extension/platform-core';

/**
 * Best-effort 500 fallback when a handler throws BEFORE writing any response.
 * If the response has already started streaming, we just end it — the SSE
 * translator is responsible for surfacing in-flight errors as `error` events.
 */
function writeFallback500(
  response: http.ServerResponse,
  message: string,
): void {
  try {
    if (!response.headersSent) {
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          type: 'error',
          error: { type: 'internal_error', message },
        }),
      );
    } else if (!response.writableEnded) {
      response.end();
    }
  } catch {
    // Response already destroyed — nothing else we can do.
  }
}

export class CliHttpServerProvider implements IHttpServerProvider {
  async listen(
    host: string,
    port: number,
    handler: HttpServerRequestHandler,
  ): Promise<IHttpServerHandle> {
    const server = http.createServer((req, res) => {
      // Wrap user handler so a thrown error never reaches the listener loop.
      Promise.resolve()
        .then(() => handler(req, res))
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          writeFallback500(res, message);
        });
    });

    // Bind and resolve once the server is listening — or reject on bind failure.
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => {
        server.removeListener('listening', onListening);
        reject(err);
      };
      const onListening = (): void => {
        server.removeListener('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });

    const address = server.address();
    const boundPort =
      address && typeof address === 'object' ? address.port : port;
    const boundHost =
      address && typeof address === 'object' ? address.address : host;

    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => {
      if (closing) return closing;
      closing = new Promise<void>((resolve) => {
        // `server.close()` only stops accepting new connections; existing
        // keep-alive sockets stay open. Force-close idle sockets so we don't
        // hang the process on shutdown.
        server.close(() => resolve());
        // Best-effort: close idle sockets immediately. Node 18.2+ ships
        // closeIdleConnections / closeAllConnections — guard for older runtimes.
        const maybeCloseIdle = (
          server as unknown as { closeIdleConnections?: () => void }
        ).closeIdleConnections;
        if (typeof maybeCloseIdle === 'function') {
          maybeCloseIdle.call(server);
        }
      });
      return closing;
    };

    return {
      port: boundPort,
      host: boundHost,
      close,
    };
  }
}
