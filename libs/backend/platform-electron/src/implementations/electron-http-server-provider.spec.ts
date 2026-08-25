import * as http from 'http';
import type { IncomingMessage, ServerResponse } from 'http';
import { ElectronHttpServerProvider } from './electron-http-server-provider';

function get(port: number, pathname: string): Promise<string> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: pathname }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve(body));
      })
      .on('error', reject);
  });
}

describe('ElectronHttpServerProvider', () => {
  it('binds an OS-assigned port and routes requests to the handler', async () => {
    const provider = new ElectronHttpServerProvider();
    let seenUrl: string | undefined;
    const handle = await provider.listen('127.0.0.1', 0, (req, res) => {
      seenUrl = (req as IncomingMessage).url;
      (res as ServerResponse).writeHead(200).end('ok');
    });
    try {
      expect(handle.port).toBeGreaterThan(0);
      expect(handle.host).toBe('127.0.0.1');
      const body = await get(handle.port, '/callback?code=abc');
      expect(body).toBe('ok');
      expect(seenUrl).toBe('/callback?code=abc');
    } finally {
      await handle.close();
    }
  });

  it('translates a thrown handler into a 500', async () => {
    const provider = new ElectronHttpServerProvider();
    const handle = await provider.listen('127.0.0.1', 0, () => {
      throw new Error('handler boom');
    });
    try {
      const body = await get(handle.port, '/');
      expect(body).toContain('internal_error');
    } finally {
      await handle.close();
    }
  });

  it('has an idempotent close()', async () => {
    const provider = new ElectronHttpServerProvider();
    const handle = await provider.listen('127.0.0.1', 0, (_req, res) => {
      (res as ServerResponse).end();
    });
    await handle.close();
    await expect(handle.close()).resolves.toBeUndefined();
  });
});
