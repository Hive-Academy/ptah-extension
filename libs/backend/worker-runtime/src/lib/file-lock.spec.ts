import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as net from 'node:net';
import { tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { FileLockBusyError, withFileLock } from './file-lock';

const linux = process.platform === 'linux' ? it : it.skip;

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ptah-worker-lock-'));
});
afterEach(async () => {
  jest.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

/**
 * The Linux abstract-socket name for `file`'s lock, spelled out here so a
 * change to the naming that would split one file into two locks fails a test.
 */
function linuxLockName(file: string): string {
  const digest = createHash('sha256')
    .update(resolve(file))
    .digest('hex')
    .slice(0, 32);
  return `ptah-worker-lock-${userInfo().uid}-${digest}`;
}

/** Another process that binds `file`'s lock endpoint and holds it until killed. */
async function holdInChild(file: string): Promise<ChildProcess> {
  // An env var cannot carry the leading NUL, so the name goes in argv.
  const script = `
    const net = require('node:net');
    const server = net.createServer((socket) => socket.destroy());
    server.on('error', (error) => { console.error(error.code); process.exit(2); });
    server.listen('\\0' + process.argv[1], () => process.stdout.write('ready\\n'));
  `;
  const child = spawn(process.execPath, ['-e', script, linuxLockName(file)], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise<void>((ready, fail) => {
    child.once('error', fail);
    child.once('exit', (code) => fail(new Error(`holder exited ${code}`)));
    child.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('ready')) ready();
    });
  });
  child.removeAllListeners('exit');
  return child;
}

async function killHard(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((done) => child.once('exit', done));
  child.kill('SIGKILL');
  await exited;
}

describe('across processes', () => {
  let child: ChildProcess | undefined;
  afterEach(async () => {
    if (child) await killHard(child);
    child = undefined;
  });

  linux(
    'reports the busy file at the deadline while another process holds the lock',
    async () => {
      const file = join(directory, 'tokens.json');
      child = await holdInChild(file);
      const operation = jest.fn(async () => 'ran');
      const started = Date.now();
      await expect(
        withFileLock(file, operation, { timeoutMs: 150 }),
      ).rejects.toMatchObject({
        name: 'FileLockBusyError',
        code: 'FILE_LOCK_BUSY',
        file,
      });
      expect(Date.now() - started).toBeGreaterThanOrEqual(140);
      expect(operation).not.toHaveBeenCalled();
    },
  );

  linux('is free as soon as the holding process is killed', async () => {
    const file = join(directory, 'tokens.json');
    child = await holdInChild(file);
    await expect(
      withFileLock(file, async () => 'ran', { timeoutMs: 50 }),
    ).rejects.toBeInstanceOf(FileLockBusyError);
    await killHard(child);
    // No takeover delay: the kernel freed the name with the process.
    await expect(
      withFileLock(file, async () => 'ran', { timeoutMs: 0 }),
    ).resolves.toBe('ran');
  });

  linux(
    'releases the lock for other processes after the operation',
    async () => {
      const file = join(directory, 'tokens.json');
      await withFileLock(file, async () => undefined);
      child = await holdInChild(file);
      expect(child.exitCode).toBeNull();
    },
  );
});

linux('serializes callers in this process', async () => {
  const file = join(directory, 'tokens.json');
  const order: string[] = [];
  let release!: () => void;
  const first = withFileLock(file, async () => {
    order.push('first start');
    await new Promise<void>((done) => {
      release = done;
    });
    order.push('first end');
  });
  while (!release) await new Promise((wake) => setTimeout(wake, 1));
  const second = withFileLock(file, async () => {
    order.push('second');
  });
  release();
  await Promise.all([first, second]);
  expect(order).toEqual(['first start', 'first end', 'second']);
});

linux('propagates an operation error and releases the lock', async () => {
  const file = join(directory, 'tokens.json');
  await expect(
    withFileLock(file, async () => {
      throw new Error('write failed');
    }),
  ).rejects.toThrow('write failed');
  await expect(
    withFileLock(file, async () => 'recovered', { timeoutMs: 0 }),
  ).resolves.toBe('recovered');
});

linux(
  'keeps the operation result and error over a failed lock release',
  async () => {
    const file = join(directory, 'tokens.json');
    const releaseError = new Error('close failed');
    const close = net.Server.prototype.close;
    jest.spyOn(net.Server.prototype, 'close').mockImplementation(function (
      this: net.Server,
      callback,
    ) {
      // Really free the endpoint, then report a failure to the caller.
      return close.call(this, () => callback?.(releaseError));
    });
    const reported: unknown[] = [];
    const onReleaseError = (error: unknown) => reported.push(error);
    await expect(
      withFileLock(file, async () => 'written', { onReleaseError }),
    ).resolves.toBe('written');
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
  },
);

linux('ignores a lock directory left by an older version', async () => {
  const file = join(directory, 'tokens.json');
  await mkdir(`${file}.lock`);
  await writeFile(
    join(`${file}.lock`, 'owner.json'),
    JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }),
  );
  await expect(
    withFileLock(file, async () => 'ran', { timeoutMs: 0 }),
  ).resolves.toBe('ran');
});
