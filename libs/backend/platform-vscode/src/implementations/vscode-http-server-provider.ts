/**
 * VscodeHttpServerProvider — IHttpServerProvider implementation using
 * `node:http`, for the VS Code extension host.
 *
 * The extension host is a Node.js runtime, so this wraps `http.createServer`
 * exactly like the CLI and Electron adapters. It exists so the shared
 * `McpDirectoryRpcHandlers` can construct in the VS Code host (which injects
 * `HTTP_SERVER_PROVIDER`) and so a loopback listener (e.g. an OAuth callback)
 * is available if needed.
 *
 * Lifecycle contract mirrors the interface docblock (idempotent `close()`,
 * bind-failure rejection, best-effort 500 on handler throw).
 */

import * as http from 'http';
import type {
  IHttpServerProvider,
  IHttpServerHandle,
  HttpServerRequestHandler,
} from '@ptah-extension/platform-core';

function writeFallback500(
  response: http.ServerResponse,
  message: string,
): void {
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
}

export class VscodeHttpServerProvider implements IHttpServerProvider {
  async listen(
    host: string,
    port: number,
    handler: HttpServerRequestHandler,
  ): Promise<IHttpServerHandle> {
    const server = http.createServer((req, res) => {
      Promise.resolve()
        .then(() => handler(req, res))
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          writeFallback500(res, message);
        });
    });
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
        server.close(() => resolve());
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
