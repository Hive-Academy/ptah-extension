/**
 * `checker-runner.spec.ts` — TASK_2026_559 Batch 37a Task 37a.1.
 *
 * Fake-spawner cases for the limits every external checker runs under:
 * argument array and complete env passed as given, delayed spawn then
 * timeout, output overflow, non-zero exit, cancellation and spawn failure —
 * each ending with its own kind and a tree kill, never a silent success. No
 * real process is started: the tree kill is a recorded double.
 */

import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import type {
  IProcessSpawner,
  ProcessSpawnRequest,
  SpawnedProcessHandle,
} from '@ptah-extension/platform-core';
import { pickInheritedEnv, runChecker } from './checker-runner';

class FakeHandle extends EventEmitter implements SpawnedProcessHandle {
  readonly stdin = null;
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  pid: number | undefined;
  killed = false;
  exitCode: number | null = null;
  readonly kills: string[] = [];
  readonly whenSpawned: Promise<number | null>;

  constructor(options: { pid?: number | null; spawnDelayMs?: number } = {}) {
    super();
    const pid = options.pid === undefined ? 4242 : options.pid;
    this.whenSpawned = new Promise((resolve) => {
      setTimeout(() => {
        this.pid = pid ?? undefined;
        resolve(pid);
      }, options.spawnDelayMs ?? 0);
    });
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.killed = true;
    this.kills.push(signal ?? 'SIGTERM');
    return true;
  }

  /** Write output and exit, in the order a real child reports them. */
  exit(code: number, stdout = '', stderr = ''): void {
    if (stdout) this.stdout.emit('data', Buffer.from(stdout));
    if (stderr) this.stderr.emit('data', Buffer.from(stderr));
    this.exitCode = code;
    this.emit('exit', code, null);
    this.emit('close', code, null);
  }
}

class FakeSpawner implements IProcessSpawner {
  readonly requests: ProcessSpawnRequest[] = [];
  constructor(readonly handle: FakeHandle = new FakeHandle()) {}

  spawnProcess(request: ProcessSpawnRequest): SpawnedProcessHandle {
    this.requests.push(request);
    return this.handle;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const BASE = {
  command: '/usr/local/go/bin/go',
  args: ['vet', '-json', './a'],
  cwd: '/work/mod',
  env: { PATH: '/usr/local/go/bin', GOFLAGS: '-mod=readonly' },
  timeoutMs: 1_000,
};

describe('runChecker', () => {
  it('passes the argument array, cwd and the complete env as given, and collects output', async () => {
    const spawner = new FakeSpawner();
    const run = runChecker(
      { ...BASE, spawner },
      { killTree: jest.fn(), platform: 'linux' },
    );
    spawner.handle.exit(0, '{"a":1}', '# pkg\n');

    const result = await run;

    expect(spawner.requests).toEqual([
      {
        command: BASE.command,
        args: BASE.args,
        cwd: BASE.cwd,
        env: BASE.env,
        detached: true,
      },
    ]);
    expect(result).toMatchObject({
      kind: 'exited',
      code: 0,
      stdout: '{"a":1}',
      stderr: '# pkg\n',
    });
  });

  it('does not start a process group on win32 (taskkill /T walks the tree there)', async () => {
    const spawner = new FakeSpawner();
    const run = runChecker(
      { ...BASE, spawner },
      { killTree: jest.fn(), platform: 'win32' },
    );
    spawner.handle.exit(0);
    await run;
    expect(spawner.requests[0].detached).toBe(false);
  });

  it('delayed spawn then timeout: answers `timeout` and tree-kills the pid once it is known', async () => {
    const handle = new FakeHandle({ spawnDelayMs: 60 });
    const killTree = jest.fn(async () => undefined);

    const result = await runChecker(
      { ...BASE, spawner: new FakeSpawner(handle), timeoutMs: 15 },
      { killTree },
    );

    expect(result.kind).toBe('timeout');
    expect(killTree).not.toHaveBeenCalled();
    await delay(100);
    expect(killTree).toHaveBeenCalledWith(4242);
    expect(handle.kills).toEqual(['SIGKILL']);
  });

  it('output over the cap: answers `too-large` and kills the tree', async () => {
    const spawner = new FakeSpawner();
    const killTree = jest.fn(async () => undefined);
    const run = runChecker(
      { ...BASE, spawner, maxOutputBytes: 8 },
      { killTree },
    );
    await spawner.handle.whenSpawned;
    spawner.handle.stdout.emit('data', Buffer.from('12345'));
    spawner.handle.stderr.emit('data', Buffer.from('6789'));

    const result = await run;
    await delay(0);

    expect(result.kind).toBe('too-large');
    expect(killTree).toHaveBeenCalledWith(4242);
  });

  it('passes a non-zero exit through with its output (the caller decides what it means)', async () => {
    const spawner = new FakeSpawner();
    const run = runChecker({ ...BASE, spawner }, { killTree: jest.fn() });
    spawner.handle.exit(1, '', 'go: something failed\n');

    expect(await run).toMatchObject({
      kind: 'exited',
      code: 1,
      stderr: 'go: something failed\n',
    });
  });

  it('cancellation mid-run: answers `cancelled` and kills the tree', async () => {
    const spawner = new FakeSpawner();
    const killTree = jest.fn(async () => undefined);
    const controller = new AbortController();
    const run = runChecker(
      { ...BASE, spawner, signal: controller.signal },
      { killTree },
    );
    await spawner.handle.whenSpawned;
    controller.abort();

    const result = await run;
    await delay(0);

    expect(result.kind).toBe('cancelled');
    expect(killTree).toHaveBeenCalledWith(4242);
    // Output after the cancellation is never collected into an answer.
    spawner.handle.exit(0, 'late');
  });

  it('an already-aborted signal spawns nothing', async () => {
    const spawner = new FakeSpawner();
    const controller = new AbortController();
    controller.abort();

    const result = await runChecker(
      { ...BASE, spawner, signal: controller.signal },
      { killTree: jest.fn() },
    );

    expect(result.kind).toBe('cancelled');
    expect(spawner.requests).toEqual([]);
  });

  it('a spawner that throws answers `spawn-failed`', async () => {
    const spawner: IProcessSpawner = {
      spawnProcess: () => {
        throw new Error('ENOENT');
      },
    };
    const result = await runChecker(
      { ...BASE, spawner },
      { killTree: jest.fn() },
    );
    expect(result.kind).toBe('spawn-failed');
  });

  it('a child `error` answers `spawn-failed` and still kills whatever started', async () => {
    const spawner = new FakeSpawner();
    const killTree = jest.fn(async () => undefined);
    const run = runChecker({ ...BASE, spawner }, { killTree });
    spawner.handle.emit('error', new Error('EACCES'));

    expect((await run).kind).toBe('spawn-failed');
    await delay(10);
    expect(killTree).toHaveBeenCalledWith(4242);
  });

  it('a child that never started (pid null) is killed through its handle only', async () => {
    const handle = new FakeHandle({ pid: null });
    const killTree = jest.fn(async () => undefined);

    const result = await runChecker(
      { ...BASE, spawner: new FakeSpawner(handle), timeoutMs: 5 },
      { killTree },
    );
    await delay(10);

    expect(result.kind).toBe('timeout');
    expect(killTree).not.toHaveBeenCalled();
    expect(handle.kills).toEqual(['SIGKILL']);
  });

  it('a failing tree kill is reported to onKillError and does not change the answer', async () => {
    const handle = new FakeHandle();
    const onKillError = jest.fn();

    const result = await runChecker(
      { ...BASE, spawner: new FakeSpawner(handle), timeoutMs: 5 },
      {
        killTree: async () => {
          throw new Error('taskkill failed');
        },
        onKillError,
      },
    );
    await delay(10);

    expect(result.kind).toBe('timeout');
    expect(onKillError).toHaveBeenCalledTimes(1);
  });
});

describe('pickInheritedEnv', () => {
  it('copies only the named variables; absent ones are left out, never emptied', () => {
    const parent = {
      HOME: '/home/u',
      NODE_OPTIONS: '--require evil',
      GOFLAGS: '-toolexec=evil',
    };
    expect(pickInheritedEnv(parent, ['HOME', 'LANG'], 'linux')).toEqual({
      HOME: '/home/u',
    });
  });

  it('matches names without case on win32 and writes them under the given name', () => {
    expect(
      pickInheritedEnv({ systemroot: 'C:\\Windows' }, ['SystemRoot'], 'win32'),
    ).toEqual({ SystemRoot: 'C:\\Windows' });
  });
});
