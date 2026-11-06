import { createServer, type Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { WORKER_CLOSE_CODES } from '@ptah-extension/worker-protocol';
import { WorkerConnection, type ConnectionOptions } from './connection';

/**
 * Open connections the worker serves at once. Remote desktops arrive through
 * `ssh -W`, one connection each; past the cap a new connection is closed
 * with THROTTLED before it can send a frame.
 */
export const MAX_WORKER_CONNECTIONS = 64;

export interface WorkerServerOptions extends ConnectionOptions {
  host?: '127.0.0.1' | '::1' | string;
  port?: number;
  /** Test seam; default {@link MAX_WORKER_CONNECTIONS}. */
  maxConnections?: number;
}

export interface WorkerServer {
  readonly host: string;
  readonly port: number;
  readonly connections: ReadonlySet<WorkerConnection>;
  close(): Promise<void>;
}

export async function createWorkerServer(
  options: WorkerServerOptions,
): Promise<WorkerServer> {
  const host = options.host ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== '::1')
    throw new Error('Worker listener requires a loopback literal');
  const requestedPort = options.port ?? 41873;
  const maxConnections = options.maxConnections ?? MAX_WORKER_CONNECTIONS;
  const server: Server = createServer((request, response) => {
    response.statusCode = 404;
    response.end();
  });
  const webSockets = new WebSocketServer({
    noServer: true,
    maxPayload: 1024 * 1024,
  });
  const connections = new Set<WorkerConnection>();
  const validRequest = (
    hostHeader: string | undefined,
    origin: string | undefined,
    port: number,
  ): boolean =>
    origin === undefined &&
    (hostHeader === `127.0.0.1:${port}` ||
      hostHeader === `localhost:${port}` ||
      (host === '::1' && hostHeader === `[::1]:${port}`));
  server.on('upgrade', (request, socket, head) => {
    const address = server.address();
    const port =
      address && typeof address !== 'string' ? address.port : requestedPort;
    if (
      request.url !== '/rpc' ||
      !validRequest(request.headers.host, request.headers.origin, port)
    ) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    webSockets.handleUpgrade(request, socket, head, (webSocket) => {
      if (connections.size >= maxConnections) {
        webSocket.close(WORKER_CLOSE_CODES.THROTTLED);
        return;
      }
      const connection = new WorkerConnection(webSocket, options);
      connections.add(connection);
      webSocket.on('close', () => connections.delete(connection));
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(requestedPort, host, () => {
        server.off('error', reject);
        resolve();
      });
    });
  } catch (error) {
    webSockets.close();
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'EADDRINUSE'
    )
      throw new Error(`Worker port ${requestedPort} is already in use`, {
        cause: error,
      });
    throw error;
  }
  const address = server.address();
  const port =
    address && typeof address !== 'string' ? address.port : requestedPort;
  return {
    host,
    port,
    connections,
    close: async () => {
      for (const connection of connections) connection.close();
      const forceClose = setTimeout(() => {
        for (const socket of webSockets.clients) socket.terminate();
      }, 1000);
      try {
        await new Promise<void>((resolve) => webSockets.close(() => resolve()));
      } finally {
        clearTimeout(forceClose);
      }
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
