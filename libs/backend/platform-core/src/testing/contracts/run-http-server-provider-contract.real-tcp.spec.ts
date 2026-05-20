import 'reflect-metadata';
import * as http from 'node:http';
import type {
  IHttpServerProvider,
  IHttpServerHandle,
  HttpServerRequestHandler,
} from '../../interfaces/http-server-provider.interface';
import { runHttpServerProviderContract } from './run-http-server-provider-contract';

function createRealTcpProvider(): IHttpServerProvider {
  return {
    async listen(
      host: string,
      port: number,
      handler: HttpServerRequestHandler,
    ): Promise<IHttpServerHandle> {
      const server = http.createServer((req, res) => {
        try {
          const result = handler(req, res);
          if (result && typeof (result as Promise<void>).catch === 'function') {
            (result as Promise<void>).catch(() => {
              if (!res.headersSent) res.writeHead(500);
              if (!res.writableEnded) res.end();
            });
          }
        } catch {
          if (!res.headersSent) res.writeHead(500);
          if (!res.writableEnded) res.end();
        }
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
        typeof address === 'object' && address !== null ? address.port : 0;

      let closed = false;
      const handle: IHttpServerHandle = {
        port: boundPort,
        host,
        close(): Promise<void> {
          if (closed) return Promise.resolve();
          closed = true;
          return new Promise((resolve) => {
            server.close(() => resolve());
          });
        },
      };
      return handle;
    },
  };
}

runHttpServerProviderContract('real-tcp-node-http-provider', () => ({
  provider: createRealTcpProvider(),
  sendsRealRequests: true,
}));
