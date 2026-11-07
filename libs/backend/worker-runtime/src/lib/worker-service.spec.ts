import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { PairingWindow } from './pairing-window';
import { TokenStore } from './token-store';
import { WorkspaceRegistry } from './workspace-registry';
import { workerPaths } from './paths';
import { WorkerService } from './worker-service';

let directory: string;
let service: WorkerService | undefined;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ptah-worker-service-'));
});
afterEach(async () => {
  await service?.stop();
  service = undefined;
  await rm(directory, { recursive: true, force: true });
});

it('registers a workspace, writes a private endpoint and removes it on shutdown', async () => {
  const paths = workerPaths(directory);
  const registry = new WorkspaceRegistry(paths);
  const releaseLocks = jest.fn().mockResolvedValue(undefined);
  service = new WorkerService({
    paths,
    registry,
    workspacePaths: [directory],
    argv: [],
    onSigterm: false,
    driver: { onAppendFailed: jest.fn() },
    releaseLocks,
    readiness: async () => ({ ready: true, checks: [] }),
    host: '127.0.0.1',
    port: 0,
    identity: { machineId: 'm', displayName: 'machine', ptahVersion: '1' },
    pairing: new PairingWindow(registry, 'm'),
    tokens: new TokenStore(paths),
    handle: async () => ({}),
  });
  await service.start();
  expect(registry.list()).toHaveLength(1);
  // The owner PID and machine ID let operator commands verify the listener.
  expect(JSON.parse(await readFile(paths.endpoint, 'utf8'))).toEqual({
    ...service.endpoint,
    pid: process.pid,
    machineId: 'm',
  });
  expect((await stat(paths.endpoint)).mode & 0o777).toBe(0o600);
  await service.stop();
  expect(releaseLocks).toHaveBeenCalledTimes(1);
  await expect(stat(paths.endpoint)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('refuses auto approval before binding', async () => {
  const paths = workerPaths(directory);
  const registry = new WorkspaceRegistry(paths);
  service = new WorkerService({
    paths,
    registry,
    workspacePaths: [],
    argv: ['--auto-approve'],
    onSigterm: false,
    driver: { onAppendFailed: jest.fn() },
    releaseLocks: async () => undefined,
    readiness: async () => ({ ready: true, checks: [] }),
    port: 0,
    identity: { machineId: 'm', displayName: 'machine', ptahVersion: '1' },
    pairing: new PairingWindow(registry, 'm'),
    tokens: new TokenStore(paths),
    handle: async () => ({}),
  });
  await expect(service.start()).rejects.toThrow('manual approval');
  expect(service.endpoint).toBeUndefined();
});

it('wires log append failure to the driver abort callback', async () => {
  const paths = workerPaths(directory);
  const registry = new WorkspaceRegistry(paths);
  const onAppendFailed = jest.fn();
  service = new WorkerService({
    paths,
    registry,
    workspacePaths: [directory],
    argv: [],
    onSigterm: false,
    driver: { onAppendFailed },
    releaseLocks: async () => undefined,
    readiness: async () => ({ ready: true, checks: [] }),
    port: 0,
    identity: { machineId: 'm', displayName: 'machine', ptahVersion: '1' },
    pairing: new PairingWindow(registry, 'm'),
    tokens: new TokenStore(paths),
    handle: async () => ({}),
  });
  await service.start();
  const writer = await service.openSession('session_1');
  await expect(writer.enqueue('worker:turn.begin', {})).rejects.toMatchObject({
    code: 'SESSION_LOG_FAILED',
  });
  expect(onAppendFailed).toHaveBeenCalledWith('session_1');
});

it('refuses readiness failure before binding', async () => {
  const paths = workerPaths(directory);
  const registry = new WorkspaceRegistry(paths);
  service = new WorkerService({
    paths,
    registry,
    workspacePaths: [],
    argv: [],
    onSigterm: false,
    driver: { onAppendFailed: jest.fn() },
    releaseLocks: async () => undefined,
    readiness: async () => ({
      ready: false,
      checks: [{ id: 'runtime', label: 'Node', status: 'fail' }],
    }),
    port: 0,
    identity: { machineId: 'm', displayName: 'machine', ptahVersion: '1' },
    pairing: new PairingWindow(registry, 'm'),
    tokens: new TokenStore(paths),
    handle: async () => ({}),
  });
  await expect(service.start()).rejects.toThrow('runtime');
  expect(service.endpoint).toBeUndefined();
});

describe('shutdown goodbye', () => {
  async function startWithClient(): Promise<{
    frames: Promise<unknown>;
    socket: WebSocket;
  }> {
    const paths = workerPaths(directory);
    const registry = new WorkspaceRegistry(paths);
    service = new WorkerService({
      paths,
      registry,
      workspacePaths: [],
      argv: [],
      driver: { onAppendFailed: jest.fn() },
      releaseLocks: async () => undefined,
      readiness: async () => ({ ready: true, checks: [] }),
      host: '127.0.0.1',
      port: 0,
      identity: { machineId: 'm', displayName: 'machine', ptahVersion: '1' },
      pairing: new PairingWindow(registry, 'm'),
      tokens: new TokenStore(paths),
      handle: async () => ({}),
    });
    await service.start();
    const socket = new WebSocket(
      `ws://127.0.0.1:${service.endpoint?.port}/rpc`,
    );
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    const frames = new Promise<unknown>((resolve) =>
      socket.once('message', (data) => resolve(JSON.parse(data.toString()))),
    );
    return { frames, socket };
  }

  it('sends ctl goodbye to connected clients on stop', async () => {
    const { frames, socket } = await startWithClient();
    await service?.stop();
    expect(await frames).toMatchObject({
      kind: 'ctl',
      type: 'goodbye',
      payload: { reason: 'shutdown' },
    });
    socket.terminate();
  });

  it('sends ctl goodbye and removes the endpoint when SIGTERM arrives', async () => {
    let onTerm: (() => void) | undefined;
    const spy = jest.spyOn(process, 'on').mockImplementation(((
      event: string,
      listener: () => void,
    ) => {
      if (event === 'SIGTERM') onTerm = listener;
      return process;
    }) as unknown as typeof process.on);
    let started: Awaited<ReturnType<typeof startWithClient>>;
    try {
      started = await startWithClient();
    } finally {
      spy.mockRestore();
    }
    expect(onTerm).toBeDefined();
    onTerm?.();
    expect(await started.frames).toMatchObject({
      kind: 'ctl',
      type: 'goodbye',
    });
    await service?.stop();
    await expect(stat(workerPaths(directory).endpoint)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    started.socket.terminate();
  });
});

it('closes every live connection of a revoked token and refreshes the grant of another', async () => {
  const paths = workerPaths(directory);
  const registry = new WorkspaceRegistry(paths);
  const tokens = new TokenStore(paths);
  const grant = { machineId: 'm', workspaceIds: ['w1'] };
  const revoked = await tokens.issue('laptop', grant);
  const kept = await tokens.issue('phone', grant);
  const seen: unknown[] = [];
  service = new WorkerService({
    paths,
    registry,
    workspacePaths: [],
    argv: [],
    onSigterm: false,
    driver: { onAppendFailed: jest.fn() },
    releaseLocks: async () => undefined,
    readiness: async () => ({ ready: true, checks: [] }),
    host: '127.0.0.1',
    port: 0,
    identity: { machineId: 'm', displayName: 'machine', ptahVersion: '1' },
    pairing: new PairingWindow(registry, 'm'),
    tokens,
    handle: async (_method, _params, connectionGrant) => {
      seen.push(connectionGrant);
      return [];
    },
  });
  await service.start();
  const connect = async (token: string) => {
    const socket = new WebSocket(
      `ws://127.0.0.1:${service?.endpoint?.port}/rpc`,
    );
    const frames: { id?: string; type?: string }[] = [];
    socket.on('message', (data) => frames.push(JSON.parse(data.toString())));
    const closed = new Promise<number>((resolve) =>
      socket.once('close', resolve),
    );
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    const send = (id: string, method: string, params: unknown) =>
      socket.send(JSON.stringify({ v: 1, kind: 'req', id, method, params }));
    send('1', 'hello', {
      protocol: { min: 1, max: 1 },
      client: { name: 'c', version: '1' },
    });
    send('2', 'auth', { token });
    while (!frames.some((frame) => frame.id === '2'))
      await new Promise((resolve) => setTimeout(resolve, 5));
    return { socket, frames, closed, send };
  };
  const a = await connect(revoked.token);
  const b = await connect(revoked.token);
  const other = await connect(kept.token);
  try {
    expect(service.closeTokenConnections(revoked.tokenId, 'another')).toBe(2);
    expect(await a.closed).toBe(4410);
    expect(await b.closed).toBe(4410);
    for (const item of [a, b])
      expect(item.frames).toContainEqual(
        expect.objectContaining({ type: 'goodbye' }),
      );
    service.refreshGrant(kept.tokenId, {
      machineId: 'm',
      workspaceIds: ['w1', 'w2'],
    });
    other.send('3', 'workspaces.list', {});
    while (!other.frames.some((frame) => frame.id === '3'))
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(seen).toEqual([{ machineId: 'm', workspaceIds: ['w1', 'w2'] }]);
  } finally {
    for (const item of [a, b, other]) item.socket.terminate();
  }
});
