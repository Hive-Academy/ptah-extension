import { mkdtemp, rm } from 'node:fs/promises';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { RPC_METHOD_NAMES } from '@ptah-extension/shared';
import { ADMIN_METHODS, REMOTE_METHODS } from '@ptah-extension/worker-protocol';
import { createWorkerServer, type WorkerServer } from './worker-server';
import { PairingWindow } from './pairing-window';
import { TokenStore } from './token-store';
import { WorkspaceRegistry } from './workspace-registry';
import { workerPaths } from './paths';
import { redactLogRecord, redactText } from './redact';

const METHOD_NOT_ALLOWED = 4403;

let directory: string;
let server: WorkerServer | undefined;
const sockets: WebSocket[] = [];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ptah-worker-security-'));
});
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await server?.close();
  server = undefined;
  await rm(directory, { recursive: true, force: true });
});

function options(host = '127.0.0.1') {
  const paths = workerPaths(directory);
  return {
    host,
    port: 0,
    identity: { machineId: 'm', displayName: 'machine', ptahVersion: '1' },
    pairing: new PairingWindow(new WorkspaceRegistry(paths), 'm'),
    tokens: new TokenStore(paths),
    handle: jest.fn().mockResolvedValue({ secretSessionData: true }),
  };
}

function frame(id: string, method: string, params: unknown = {}): string {
  return JSON.stringify({ v: 1, kind: 'req', id, method, params });
}

function connect(
  port: number,
  clientOptions?: ConstructorParameters<typeof WebSocket>[2],
): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/rpc`, clientOptions);
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

interface Outcome {
  code: number;
  received: string[];
}

async function callAndWaitForClose(
  port: number,
  frames: string[],
): Promise<Outcome> {
  const socket = await connect(port);
  const received: string[] = [];
  socket.on('message', (data) => received.push(data.toString()));
  const closed = new Promise<number>((resolve) =>
    socket.once('close', (code) => resolve(code)),
  );
  for (const text of frames) socket.send(text);
  return { code: await closed, received };
}

describe('pre-auth method gate', () => {
  const remoteNames = [
    ...new Set<string>([...REMOTE_METHODS, ...ADMIN_METHODS]),
  ];
  const inProcessNames = [...new Set<string>(RPC_METHOD_NAMES)];

  it('covers a non-empty in-process and remote method set', () => {
    expect(inProcessNames.length).toBeGreaterThan(0);
    expect(remoteNames.length).toBeGreaterThan(0);
  });

  it('closes 4403 for every RPC_METHOD_NAMES and remote method sent before auth, with no handler call and no data', async () => {
    const input = options();
    server = await createWorkerServer(input);
    const violations: string[] = [];
    for (const method of [...inProcessNames, ...remoteNames]) {
      const { code, received } = await callAndWaitForClose(server.port, [
        frame('1', method),
      ]);
      if (code !== METHOD_NOT_ALLOWED || received.length > 0)
        violations.push(`${method}: code=${code} frames=${received.length}`);
    }
    expect(violations).toEqual([]);
    expect(input.handle).not.toHaveBeenCalled();
  }, 120_000);

  it('closes 4403 for a non-pre-auth method sent after hello but before auth', async () => {
    const input = options();
    server = await createWorkerServer(input);
    const hello = frame('1', 'hello', {
      protocol: { min: 1, max: 1 },
      client: { name: 'c', version: '1' },
    });
    const methods = [...remoteNames, ...inProcessNames.slice(0, 20)];
    for (const method of methods) {
      const { code, received } = await callAndWaitForClose(server.port, [
        hello,
        frame('2', method),
      ]);
      expect(code).toBe(METHOD_NOT_ALLOWED);
      // only the hello response may appear; never anything for the method
      expect(received.join('')).not.toContain('secretSessionData');
      expect(received.filter((text) => text.includes('"id":"2"'))).toEqual([]);
    }
    expect(input.handle).not.toHaveBeenCalled();
  }, 60_000);

  it('answers hello itself without reaching the handler', async () => {
    const input = options();
    server = await createWorkerServer(input);
    const socket = await connect(server.port);
    const reply = new Promise<string>((resolve) =>
      socket.once('message', (data) => resolve(data.toString())),
    );
    socket.send(
      frame('1', 'hello', {
        protocol: { min: 1, max: 1 },
        client: { name: 'c', version: '1' },
      }),
    );
    expect(await reply).not.toContain('secretSessionData');
    expect(input.handle).not.toHaveBeenCalled();
  });
});

describe('listener binding', () => {
  it.each(['0.0.0.0', '192.168.1.20', '10.0.0.5', '::', 'localhost'])(
    'refuses %s before opening a listener',
    async (host) => {
      await expect(createWorkerServer(options(host))).rejects.toThrow(
        'loopback literal',
      );
    },
  );

  it('binds the loopback literal', async () => {
    server = await createWorkerServer(options());
    expect(server.host).toBe('127.0.0.1');
    expect(server.port).toBeGreaterThan(0);
  });
});

describe('upgrade request validation', () => {
  async function rejected(
    path: string,
    clientOptions?: ConstructorParameters<typeof WebSocket>[2],
  ): Promise<void> {
    if (!server) throw new Error('server not started');
    const socket = new WebSocket(
      `ws://127.0.0.1:${server.port}${path}`,
      clientOptions,
    );
    sockets.push(socket);
    await expect(
      new Promise<void>((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      }),
    ).rejects.toThrow();
  }

  it.each(['evil.example', 'example.com', '192.168.1.20', '127.0.0.1'])(
    'refuses Host %s with a wrong host or port',
    async (name) => {
      server = await createWorkerServer(options());
      // 127.0.0.1 without the matching port is also wrong.
      await rejected('/rpc', { headers: { Host: name } });
      await rejected('/rpc', { headers: { Host: `${name}:1` } });
    },
  );

  it.each([
    'https://example.com',
    'http://127.0.0.1',
    'null',
    'vscode-webview://abc',
  ])('refuses Origin %s', async (origin) => {
    server = await createWorkerServer(options());
    await rejected('/rpc', { origin });
  });

  it.each(['/', '/rpc/', '/rpcx', '/other', '/rpc?x=1'])(
    'does not upgrade path %s',
    async (path) => {
      server = await createWorkerServer(options());
      await rejected(path);
    },
  );

  it.each(['/', '/rpc', '/other'])(
    'answers a plain HTTP GET %s with 404',
    async (path) => {
      server = await createWorkerServer(options());
      const status = await new Promise<number | undefined>(
        (resolve, reject) => {
          get(`http://127.0.0.1:${server?.port}${path}`, (response) => {
            response.resume();
            resolve(response.statusCode);
          }).on('error', reject);
        },
      );
      expect(status).toBe(404);
    },
  );

  it('accepts a valid Host on /rpc without Origin', async () => {
    server = await createWorkerServer(options());
    const socket = await connect(server.port);
    expect(socket.readyState).toBe(WebSocket.OPEN);
  });
});

describe('log redaction', () => {
  const token = 'ptw1.0123456789AB.' + 'S3cretTokenValue_-abc123';
  const code = 'ABCD-2EFG';
  const adminKey = Buffer.alloc(32, 7).toString('base64url');

  it('removes tokens and pairing codes from text', () => {
    const line = redactText(`auth ${token} pair ${code} done`);
    expect(line).not.toContain('S3cretTokenValue');
    expect(line).not.toContain(code);
    expect(line).toContain('ptw1.0123456789AB.***');
  });

  it('removes secrets from nested records, arrays and secret-named fields', () => {
    const record = redactLogRecord({
      message: `token ${token}`,
      list: [`code ${code}`, { adminKey, nested: { token } }],
      params: { pairingCode: code, code },
    });
    const serialised = JSON.stringify(record);
    expect(serialised).not.toContain('S3cretTokenValue');
    expect(serialised).not.toContain(code);
    expect(serialised).not.toContain(adminKey);
  });

  it('redacts the admin key sent in the auth frame field named admin', () => {
    const adminKey = 'A'.repeat(43);
    const record = redactLogRecord({
      method: 'auth',
      params: { admin: adminKey },
    });
    expect(JSON.stringify(record)).not.toContain(adminKey);
  });

  it('redacts a bare base64url admin key inside free text', () => {
    const adminKey = 'abcDEF0123456789_-abcDEF0123456789_-abcDEF0';
    expect(adminKey).toHaveLength(43);
    expect(redactText(`admin key ${adminKey} loaded`)).not.toContain(adminKey);
  });
});
