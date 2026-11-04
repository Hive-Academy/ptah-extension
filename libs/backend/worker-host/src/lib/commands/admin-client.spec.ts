import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import type { WorkerPaths } from '@ptah-extension/worker-runtime';
import { adminCall } from './admin-client';
import { WorkerNotRunningError } from './status';

// adminCall loads the runtime barrel, which loads the engine graph: warm it
// outside the case timeouts, platform-core first.
beforeAll(async () => {
  await import('@ptah-extension/platform-core');
  await import('@ptah-extension/worker-runtime');
  await import('@ptah-extension/worker-protocol');
}, 180_000);

const CASE_TIMEOUT = 60_000;

let home: string;
let paths: WorkerPaths;
let squatter: WebSocketServer | undefined;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'ptah-worker-admin-client-'));
  const { workerPaths } = await import('@ptah-extension/worker-runtime');
  paths = workerPaths(home);
  await mkdir(paths.directory, { recursive: true });
  await writeFile(paths.adminKey, Buffer.alloc(32, 7), { mode: 0o600 });
});
afterEach(async () => {
  await new Promise<void>((resolve) =>
    squatter ? squatter.close(() => resolve()) : resolve(),
  );
  squatter = undefined;
  await rm(home, { recursive: true, force: true });
});

/** A listener on the endpoint port that answers `hello` as another machine. */
async function listen(machineId: string): Promise<{
  port: number;
  methods: string[];
}> {
  const methods: string[] = [];
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  squatter = server;
  await new Promise<void>((resolve) => server.once('listening', resolve));
  server.on('connection', (socket) =>
    socket.on('message', (data) => {
      const frame = JSON.parse(data.toString()) as {
        id: string;
        method: string;
      };
      methods.push(frame.method);
      socket.send(
        JSON.stringify({
          v: 1,
          kind: 'res',
          id: frame.id,
          ok: true,
          result:
            frame.method === 'hello'
              ? {
                  protocol: 1,
                  worker: { machineId, displayName: 'x', ptahVersion: '1' },
                }
              : { role: 'admin' },
        }),
      );
    }),
  );
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  return { port: address.port, methods };
}

async function writeEndpoint(record: unknown): Promise<void> {
  await writeFile(paths.endpoint, JSON.stringify(record), { mode: 0o600 });
}

it(
  'does not send the admin key to a listener that answers as another machine',
  async () => {
    const { workerMachineId } = await import('@ptah-extension/worker-runtime');
    const { port, methods } = await listen('machine_someone_else');
    await writeEndpoint({
      host: '127.0.0.1',
      port,
      pid: process.pid,
      machineId: workerMachineId(),
    });
    await expect(adminCall(paths, 'admin.status', {})).rejects.toThrow(
      'not this worker; the admin key was not sent',
    );
    expect(methods).toEqual(['hello']);
  },
  CASE_TIMEOUT,
);

it(
  'treats an endpoint whose owner process is dead as a stopped service',
  async () => {
    const { workerMachineId } = await import('@ptah-extension/worker-runtime');
    const { port, methods } = await listen(workerMachineId());
    const child = spawnSync(process.execPath, ['-e', '']);
    await writeEndpoint({
      host: '127.0.0.1',
      port,
      pid: child.pid,
      machineId: workerMachineId(),
    });
    await expect(adminCall(paths, 'admin.status', {})).rejects.toBeInstanceOf(
      WorkerNotRunningError,
    );
    expect(methods).toEqual([]);
  },
  CASE_TIMEOUT,
);

it(
  'refuses an endpoint record that does not name its owner',
  async () => {
    const { port, methods } = await listen('machine_x');
    await writeEndpoint({ host: '127.0.0.1', port });
    await expect(adminCall(paths, 'admin.status', {})).rejects.toThrow(
      'does not name its owner',
    );
    expect(methods).toEqual([]);
  },
  CASE_TIMEOUT,
);
