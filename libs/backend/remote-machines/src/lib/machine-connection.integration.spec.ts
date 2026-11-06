import 'reflect-metadata';
jest.mock('@ptah-extension/rpc-handlers', () => ({
  capabilities: (value: unknown) => value,
  RPC_CAPABILITIES: [],
}));
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect as netConnect } from 'node:net';
import {
  createWorkerServer,
  PairingWindow,
  TokenStore,
  WorkspaceRegistry,
  workerPaths,
  type WorkerServer,
} from '@ptah-extension/worker-runtime';
import { MachineConnection } from './machine-connection';

let server: WorkerServer | undefined;
let directory: string;
let connection: MachineConnection | undefined;
afterAll(async () => {
  connection?.dispose();
  await server?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

it('connects over a real Duplex, round-trips a call, then schedules retry on server close', async () => {
  directory = await mkdtemp(join(tmpdir(), 'ptah-machine-duplex-'));
  const paths = workerPaths(directory);
  const tokens = new TokenStore(paths);
  const grant = { machineId: 'm', workspaceIds: [] };
  const issued = await tokens.issue('desktop', grant);
  server = await createWorkerServer({
    port: 0,
    identity: {
      machineId: 'm',
      displayName: 'machine',
      ptahVersion: 'test-version',
    },
    pairing: new PairingWindow(new WorkspaceRegistry(paths), 'm'),
    tokens,
    handle: async (method) => {
      if (method === 'workspaces.list') return [];
      throw new Error(`Unexpected method ${method}`);
    },
  });
  const port = server.port;
  connection = new MachineConnection({
    machineId: 'm',
    alias: 'host',
    token: issued.token,
    workerMachineId: 'm',
    ptahVersion: 'test-version',
    port,
    createTransport: () => netConnect(port, '127.0.0.1'),
    random: () => 0,
  });
  await connection.connect();
  expect(connection.state).toBe('connected');
  expect(await connection.call('workspaces.list', {})).toEqual([]);
  const wrong = new MachineConnection({
    machineId: 'local',
    alias: 'host',
    token: issued.token,
    workerMachineId: 'different-worker',
    ptahVersion: 'test-version',
    port,
    createTransport: () => netConnect(port, '127.0.0.1'),
  });
  await expect(wrong.connect()).rejects.toThrow();
  expect(wrong.state).toBe('unpaired');
  expect(wrong.reason).toContain('different worker answers on host');
  wrong.dispose();
  await server.close();
  server = undefined;
  for (let i = 0; i < 30 && connection.state === 'connected'; i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  expect(connection.state).toBe('offline');
  expect(connection.nextRetryAt).toBeGreaterThan(Date.now());
  connection.dispose();
  connection = undefined;
}, 15000);
