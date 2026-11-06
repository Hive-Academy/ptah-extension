import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileLockBusyError, withFileLock } from './file-lock';
import { processStartTime } from './process-state';

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

describe('owner identity (revise round 1)', () => {
  let child: ChildProcess | undefined;
  afterEach(() => {
    child?.kill('SIGKILL');
    child = undefined;
  });
  /** A live process other than this one. */
  async function liveOther(): Promise<number> {
    child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
      stdio: 'ignore',
    });
    await new Promise<void>((resolve, reject) => {
      child?.once('spawn', () => resolve());
      child?.once('error', reject);
    });
    if (!child.pid) throw new Error('No child PID');
    return child.pid;
  }
  const linux = process.platform === 'linux' ? it : it.skip;

  it('never steals from a live owner, however old its lock is', async () => {
    const file = join(directory, 'tokens.json');
    const pid = await liveOther();
    await plantLock(file, {
      pid,
      startedAt: await processStartTime(pid),
      nonce: 'slow-owner',
      acquiredAt: Date.now() - 120_000,
    });
    const operation = jest.fn(async () => 'ran');
    await expect(
      withFileLock(file, operation, { timeoutMs: 100 }),
    ).rejects.toBeInstanceOf(FileLockBusyError);
    expect(operation).not.toHaveBeenCalled();
    expect(
      await readFile(join(`${file}.lock`, 'owner.json'), 'utf8'),
    ).toContain('slow-owner');
  });

  linux(
    'steals a lock whose PID now names another process (PID reuse)',
    async () => {
      const file = join(directory, 'tokens.json');
      const pid = await liveOther();
      await plantLock(file, {
        pid,
        startedAt: 'a-different-start-time',
        nonce: 'dead-owner',
        acquiredAt: Date.now(),
      });
      await expect(withFileLock(file, async () => 'stolen')).resolves.toBe(
        'stolen',
      );
      expect(await readdir(directory)).toEqual([]);
    },
  );

  it('records its start time and never removes a lock another owner holds now', async () => {
    const file = join(directory, 'tokens.json');
    const reported: unknown[] = [];
    const result = await withFileLock(
      file,
      async () => {
        const owner = JSON.parse(
          await readFile(join(`${file}.lock`, 'owner.json'), 'utf8'),
        ) as { pid: number; startedAt: string | null; nonce: string };
        expect(owner.pid).toBe(process.pid);
        expect(owner.startedAt).toBe(await processStartTime(process.pid));
        expect(owner.nonce).toMatch(/^[0-9a-f]{32}$/);
        // Another owner took the lock while this operation ran.
        await rm(`${file}.lock`, { recursive: true, force: true });
        await plantLock(file, {
          pid: process.pid,
          startedAt: owner.startedAt,
          nonce: 'other-owner',
          acquiredAt: Date.now(),
        });
        return 'written';
      },
      { onReleaseError: (error) => reported.push(error) },
    );
    expect(result).toBe('written');
    expect(String(reported[0])).toContain('held by another owner');
    expect(
      await readFile(join(`${file}.lock`, 'owner.json'), 'utf8'),
    ).toContain('other-owner');
  });
});
