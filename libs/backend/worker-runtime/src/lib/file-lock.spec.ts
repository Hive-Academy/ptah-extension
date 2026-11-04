import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileLockBusyError, withFileLock } from './file-lock';

jest.mock('node:fs/promises', () => {
  const actual =
    jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises');
  return { ...actual, rm: jest.fn(actual.rm) };
});

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ptah-worker-lock-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

/** A PID whose process has exited. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ['-e', '']);
  if (!child.pid) throw new Error('No child PID');
  return child.pid;
}

async function plantLock(file: string, owner: unknown): Promise<void> {
  await mkdir(`${file}.lock`);
  await writeFile(join(`${file}.lock`, 'owner.json'), JSON.stringify(owner));
}

it('serializes competing writers and releases the lock after failure', async () => {
  const file = join(directory, 'tokens.json');
  const order: string[] = [];
  let release!: () => void;
  const first = withFileLock(file, async () => {
    order.push('first start');
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    order.push('first end');
  });
  try {
    while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
    const second = withFileLock(file, async () => {
      order.push('second');
    });
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['first start', 'first end', 'second']);
    await expect(
      withFileLock(file, async () => {
        throw new Error('write failed');
      }),
    ).rejects.toThrow('write failed');
    await expect(withFileLock(file, async () => 'recovered')).resolves.toBe(
      'recovered',
    );
    // Neither the lock nor a staging directory is left behind.
    expect(await readdir(directory)).toEqual([]);
  } finally {
    release?.();
    await first;
  }
});

it('steals a lock whose owner process is dead', async () => {
  const file = join(directory, 'tokens.json');
  await plantLock(file, { pid: deadPid(), acquiredAt: Date.now() });
  await expect(withFileLock(file, async () => 'stolen')).resolves.toBe(
    'stolen',
  );
  expect(await readdir(directory)).toEqual([]);
});

it('steals a lock with an unreadable owner record', async () => {
  const file = join(directory, 'tokens.json');
  await mkdir(`${file}.lock`);
  await writeFile(join(`${file}.lock`, 'owner.json'), 'not json');
  await expect(withFileLock(file, async () => 'stolen')).resolves.toBe(
    'stolen',
  );
});

it('waits for a live owner and reports the busy file at the deadline', async () => {
  const file = join(directory, 'tokens.json');
  await plantLock(file, { pid: process.pid, acquiredAt: Date.now() });
  const operation = jest.fn(async () => 'ran');
  await expect(
    withFileLock(file, operation, { timeoutMs: 100 }),
  ).rejects.toBeInstanceOf(FileLockBusyError);
  expect(operation).not.toHaveBeenCalled();
});

it('keeps the operation result and error over a failed lock release', async () => {
  const file = join(directory, 'tokens.json');
  const rmMock = jest.mocked(fsPromises.rm);
  const releaseError = Object.assign(new Error('EACCES'), { code: 'EACCES' });
  const reported: unknown[] = [];
  const onReleaseError = (error: unknown) => reported.push(error);
  const actualRm =
    jest.requireActual<typeof import('node:fs/promises')>(
      'node:fs/promises',
    ).rm;
  const failNextRelease = () =>
    // The first rm is the staging cleanup after acquire; the second is release.
    rmMock.mockImplementationOnce(actualRm).mockRejectedValueOnce(releaseError);
  failNextRelease();
  await expect(
    withFileLock(file, async () => 'written', { onReleaseError }),
  ).resolves.toBe('written');
  // The lock left behind is ours (a live PID): clear it for the next case.
  await actualRm(`${file}.lock`, { recursive: true, force: true });
  failNextRelease();
  await expect(
    withFileLock(
      file,
      async () => {
        throw new Error('write failed');
      },
      { onReleaseError },
    ),
  ).rejects.toThrow('write failed');
  expect(reported).toEqual([releaseError, releaseError]);
});
