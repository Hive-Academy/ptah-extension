import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import type { Logger } from '@ptah-extension/vscode-core';
import { probeCliStdout } from './cli-stdout-probe';

const mockSpawnCli = jest.fn();
const mockKillProcessTree = jest.fn();

jest.mock('./cli-adapter.utils', () => ({
  spawnCli: (...args: unknown[]) => mockSpawnCli(...args),
  killProcessTree: (...args: unknown[]) => mockKillProcessTree(...args),
}));

type FakeChild = EventEmitter & {
  stdout: PassThrough;
  kill: jest.Mock;
  pid: number;
  killed: boolean;
  whenSpawned: Promise<number | null>;
};

function createChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new PassThrough();
  child.kill = jest.fn();
  child.pid = 8675;
  child.killed = false;
  child.whenSpawned = Promise.resolve(child.pid);
  return child;
}

function createLogger(): { logger: Logger; warn: jest.Mock } {
  const warn = jest.fn();
  return { logger: { warn } as unknown as Logger, warn };
}

const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

describe('probeCliStdout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('collects and trims stdout until the process closes', async () => {
    const child = createChild();
    mockSpawnCli.mockReturnValue(child);

    const result = probeCliStdout('tool', ['models'], { timeoutMs: 1000 });
    child.stdout.write('  first\n');
    child.stdout.write('second  \n');
    await flush();
    child.emit('close', 0);

    await expect(result).resolves.toBe('first\nsecond');
    expect(mockSpawnCli).toHaveBeenCalledWith('tool', ['models'], {
      spawner: undefined,
      detached: true,
    });
  });

  it('resolves undefined for empty output', async () => {
    const child = createChild();
    mockSpawnCli.mockReturnValue(child);

    const result = probeCliStdout('tool', [], { timeoutMs: 1000 });
    child.emit('close', 0);

    await expect(result).resolves.toBeUndefined();
  });

  it('spawns detached and kills the process tree on timeout, not the child', async () => {
    jest.useFakeTimers();
    const child = createChild();
    mockSpawnCli.mockReturnValue(child);

    const result = probeCliStdout('tool', ['models'], { timeoutMs: 500 });
    jest.advanceTimersByTime(499);
    expect(child.kill).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);

    await expect(result).resolves.toBeUndefined();
    await Promise.resolve();
    expect(child.kill).not.toHaveBeenCalled();
    expect(mockKillProcessTree).toHaveBeenCalledTimes(1);
    expect(mockKillProcessTree).toHaveBeenCalledWith(child.pid);
  });

  it('resolves undefined and warns with the command only when spawnCli throws synchronously', async () => {
    mockSpawnCli.mockImplementation(() => {
      throw new Error('command line too long');
    });
    const { logger, warn } = createLogger();

    await expect(
      probeCliStdout('tool', ['--secret-arg'], { timeoutMs: 1000, logger }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.any(String), {
      command: 'tool',
      error: 'command line too long',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('--secret-arg');
  });

  it('resolves undefined when the process errors', async () => {
    const child = createChild();
    mockSpawnCli.mockReturnValue(child);
    const { logger, warn } = createLogger();

    const result = probeCliStdout('tool', [], { timeoutMs: 1000, logger });
    child.emit('error', new Error('ENOENT'));

    await expect(result).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.any(String), {
      command: 'tool',
      error: 'ENOENT',
    });
  });
});
