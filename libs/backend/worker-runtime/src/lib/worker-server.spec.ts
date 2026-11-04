import { get } from 'node:http';
import { WebSocket } from 'ws';
import {
  createWorkerServer,
  MAX_WORKER_CONNECTIONS,
  type WorkerServer,
} from './worker-server';
import { PairingWindow } from './pairing-window';
import { TokenStore } from './token-store';
import { WorkspaceRegistry } from './workspace-registry';
import { workerPaths } from './paths';

const paths = workerPaths('/tmp/ptah-worker-server-spec');
let server: WorkerServer | undefined;
let socket: WebSocket | undefined;
afterEach(async () => {
  socket?.terminate();
  socket = undefined;
  await server?.close();
  server = undefined;
});

function options(host = '127.0.0.1') {
  return {
    host,
    port: 0,
    identity: { machineId: 'm', displayName: 'machine', ptahVersion: '1' },
    pairing: new PairingWindow(new WorkspaceRegistry(paths), 'm'),
    tokens: new TokenStore(paths),
    handle: jest.fn().mockResolvedValue({}),
  };
}

it('refuses a LAN bind before opening a listener', async () => {
  await expect(createWorkerServer(options('0.0.0.0'))).rejects.toThrow(
    'loopback literal',
  );
});

it('closes a non-hello pre-auth call without dispatching a handler', async () => {
  const input = options();
  server = await createWorkerServer(input);
  socket = new WebSocket(`ws://127.0.0.1:${server.port}/rpc`);
  await new Promise<void>((resolve, reject) => {
    socket?.once('open', resolve);
    socket?.once('error', reject);
  });
  const closed = new Promise<number>((resolve) =>
    socket?.once('close', resolve),
  );
  socket.send(
    JSON.stringify({
      v: 1,
      kind: 'req',
      id: '1',
      method: 'session.list',
      params: {},
    }),
  );
  expect(await closed).toBe(4403);
  expect(input.handle).not.toHaveBeenCalled();
});

it('rejects an Origin header during upgrade', async () => {
  server = await createWorkerServer(options());
  socket = new WebSocket(`ws://127.0.0.1:${server.port}/rpc`, {
    origin: 'https://example.com',
  });
  await expect(
    new Promise<void>((resolve, reject) => {
      socket?.once('open', resolve);
      socket?.once('error', reject);
    }),
  ).rejects.toThrow();
});

it('rejects a forged Host during upgrade', async () => {
  server = await createWorkerServer(options());
  socket = new WebSocket(`ws://127.0.0.1:${server.port}/rpc`, {
    headers: { Host: `evil.example:${server.port}` },
  });
  await expect(
    new Promise<void>((resolve, reject) => {
      socket?.once('open', resolve);
      socket?.once('error', reject);
    }),
  ).rejects.toThrow();
});

it('names the occupied port', async () => {
  server = await createWorkerServer(options());
  await expect(
    createWorkerServer({ ...options(), port: server.port }),
  ).rejects.toThrow(String(server.port));
});

it('returns 404 for an ordinary HTTP path', async () => {
  server = await createWorkerServer(options());
  const status = await new Promise<number | undefined>((resolve, reject) => {
    get(`http://127.0.0.1:${server?.port}/elsewhere`, (response) => {
      response.resume();
      resolve(response.statusCode);
    }).on('error', reject);
  });
  expect(status).toBe(404);
});

it('closes connections past the cap with THROTTLED and accepts again after one leaves', async () => {
  expect(MAX_WORKER_CONNECTIONS).toBe(64);
  server = await createWorkerServer({ ...options(), maxConnections: 2 });
  const port = server.port;
  const open = async (): Promise<WebSocket> => {
    const next = new WebSocket(`ws://127.0.0.1:${port}/rpc`);
    await new Promise<void>((resolve, reject) => {
      next.once('open', resolve);
      next.once('error', reject);
    });
    return next;
  };
  const first = await open();
  const second = await open();
  const third = await open();
  try {
    const code = await new Promise<number>((resolve) =>
      third.once('close', resolve),
    );
    expect(code).toBe(4429);
    expect(server.connections.size).toBe(2);
    const gone = new Promise((resolve) => first.once('close', resolve));
    first.close();
    await gone;
    while (server.connections.size > 1)
      await new Promise((resolve) => setTimeout(resolve, 5));
    const fourth = await open();
    expect(server.connections.size).toBe(2);
    fourth.terminate();
  } finally {
    for (const item of [first, second, third]) item.terminate();
  }
});
