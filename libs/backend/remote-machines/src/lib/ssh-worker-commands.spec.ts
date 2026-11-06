import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { runSshWorkerCommand } from './ssh-worker-commands';
import { WORKER_REMOTE_COMMAND } from '@ptah-extension/worker-protocol';

function fakeChild() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: jest.fn(),
  });
  return child;
}

it('uses exact argv and maps missing remote worker to version mismatch', async () => {
  const child = fakeChild();
  const spawn = jest.fn(() => child);
  const result = runSshWorkerCommand('remote', 'status', {}, spawn as never);
  expect(spawn).toHaveBeenCalledWith(
    'ssh',
    [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      '--',
      'remote',
      WORKER_REMOTE_COMMAND,
      'status',
      '--json',
    ],
    { shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stderr.write('command not found');
  child.emit('close', 127);
  await expect(result).rejects.toMatchObject({ code: 'version-mismatch' });
});

it('rejects invalid JSON from a successful command', async () => {
  const child = fakeChild();
  const result = runSshWorkerCommand(
    'remote',
    'pair',
    { ttlSeconds: 300, workspaces: ['w'] },
    (() => child) as never,
  );
  child.stdout.write('{broken');
  child.emit('close', 0);
  await expect(result).rejects.toMatchObject({ code: 'invalid-output' });
});

it('times out after 15 seconds and kills the child', async () => {
  jest.useFakeTimers();
  try {
    const child = fakeChild();
    const result = runSshWorkerCommand(
      'remote',
      'status',
      {},
      (() => child) as never,
    );
    jest.advanceTimersByTime(15_000);
    expect(child.kill).toHaveBeenCalledTimes(1);
    child.emit('close', null);
    await expect(result).rejects.toMatchObject({ code: 'unreachable' });
  } finally {
    jest.useRealTimers();
  }
});

it('parses valid status JSON', async () => {
  const child = fakeChild();
  const result = runSshWorkerCommand(
    'remote',
    'status',
    {},
    (() => child) as never,
  );
  const status = {
    machineId: 'm',
    displayName: 'Machine',
    ptahVersion: '1.0',
    protocol: 1,
    readiness: { checks: [], ready: true },
    pairing: { open: false },
    grants: [],
    locks: [],
  };
  child.stdout.write(JSON.stringify(status));
  child.emit('close', 0);
  await expect(result).resolves.toMatchObject(status);
});

it('adds pair options in order and validates them before spawning', async () => {
  const child = fakeChild();
  const spawn = jest.fn(() => child);
  const result = runSshWorkerCommand(
    'remote',
    'pair',
    { workspaces: ['w'], ttlSeconds: 300 },
    spawn as never,
  );
  expect((spawn.mock.calls as unknown[][])[0][1]).toEqual([
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=10',
    '--',
    'remote',
    WORKER_REMOTE_COMMAND,
    'pair',
    '--json',
    '--workspace',
    'w',
    '--ttl',
    '300',
  ]);
  child.emit('close', 1);
  await expect(result).rejects.toMatchObject({ code: 'unreachable' });
  await expect(
    runSshWorkerCommand(
      'remote',
      'pair',
      { workspaces: ['-bad'] },
      spawn as never,
    ),
  ).rejects.toThrow('Invalid workspace');
  await expect(
    runSshWorkerCommand('remote', 'pair', { ttlSeconds: 59 }, spawn as never),
  ).rejects.toThrow('TTL');
  expect(spawn).toHaveBeenCalledTimes(1);
});

it('maps thrown spawn and oversized stdout', async () => {
  await expect(
    runSshWorkerCommand('remote', 'status', {}, (() => {
      throw new Error('ENOENT');
    }) as never),
  ).rejects.toMatchObject({ code: 'unreachable' });
  const child = fakeChild();
  const result = runSshWorkerCommand(
    'remote',
    'status',
    {},
    (() => child) as never,
  );
  child.stdout.write('x'.repeat(1_000_001));
  child.emit('close', null);
  await expect(result).rejects.toMatchObject({
    code: 'invalid-output',
    message: expect.stringMatching(/output too large/),
  });
});

it('uses display name for version mismatch copy', async () => {
  const child = fakeChild();
  const result = runSshWorkerCommand(
    'alias',
    'status',
    {},
    (() => child) as never,
    'Office Mac',
  );
  child.emit('close', 127);
  await expect(result).rejects.toMatchObject({
    code: 'version-mismatch',
    message:
      'This Ptah build on Office Mac has no worker mode. Update the Ptah desktop app there.',
  });
});
