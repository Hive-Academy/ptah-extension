/**
 * Spawn-shape spec for `runSkillsCli`.
 *
 * Split from `skills-sh-cli.spec.ts` because that file deliberately runs the
 * real guard and the real argv builder with nothing mocked; this one mocks the
 * child process, so keeping them apart preserves that property.
 *
 * What it pins: the `npx skills …` call goes through `cross-spawn` and carries
 * NO `shell` option. It used to pass `shell: true` with an args array — the
 * `[DEP0190]` shape, in which cmd.exe receives `source` and `skillId`
 * concatenated into one unescaped command line, so the three validation layers
 * above this call are the only thing between a user-supplied `owner/repo` and a
 * shell (TASK_2026_348). `cross-spawn` runs the same Windows `npx.cmd` shim via
 * `cmd.exe /d /s /c` with each argument escaped.
 */

import { EventEmitter } from 'events';

const mockExecFile = jest.fn((...args: unknown[]) =>
  (args.at(-1) as (error: null, stdout: string, stderr: string) => void)(
    null,
    '',
    '',
  ),
);
jest.mock('node:child_process', () => ({
  ...jest.requireActual('node:child_process'),
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

jest.mock('cross-spawn', () => ({ __esModule: true, default: jest.fn() }));

import crossSpawn from 'cross-spawn';

import { runSkillsCli } from './skills-sh-cli';

const crossSpawnMock = crossSpawn as unknown as jest.Mock;

class FakeChild extends EventEmitter {
  readonly pid = 2468;
  readonly killed = false;
  readonly stdout = new EventEmitter() as EventEmitter & {
    setEncoding: jest.Mock;
  };
  readonly stderr = new EventEmitter() as EventEmitter & {
    setEncoding: jest.Mock;
  };
  readonly kill = jest.fn();

  constructor() {
    super();
    (this.stdout as { setEncoding: jest.Mock }).setEncoding = jest.fn();
    (this.stderr as { setEncoding: jest.Mock }).setEncoding = jest.fn();
  }
}

let child: FakeChild;

beforeEach(() => {
  jest.clearAllMocks();
  child = new FakeChild();
  crossSpawnMock.mockImplementation(() => child);
});

describe('runSkillsCli', () => {
  it('spawns npx through cross-spawn with no shell option', async () => {
    const promise = runSkillsCli(['add', 'anthropics/skills'], 'C:\\staging');

    expect(crossSpawnMock).toHaveBeenCalledTimes(1);
    const [command, args, options] = crossSpawnMock.mock.calls[0];
    expect(command).toBe('npx');
    expect(args).toEqual(['skills', 'add', 'anthropics/skills']);
    expect(options).not.toHaveProperty('shell');
    expect(options).toMatchObject({
      cwd: 'C:\\staging',
      env: expect.objectContaining({ FORCE_COLOR: '0', NO_COLOR: '1' }),
    });

    child.stdout.emit('data', 'installed\n');
    child.stderr.emit('data', 'warn\n');
    child.emit('close', 0);

    await expect(promise).resolves.toEqual({
      stdout: 'installed\n',
      stderr: 'warn\n',
      exitCode: 0,
    });
  });

  it('passes cwd as undefined when the caller gives none', async () => {
    const promise = runSkillsCli(['add', 'anthropics/skills'], '');
    expect(crossSpawnMock.mock.calls[0][2].cwd).toBeUndefined();

    child.emit('close', 0);
    await promise;
  });

  it('reports a non-zero exit code unchanged', async () => {
    const promise = runSkillsCli(['add', 'bad/repo'], 'C:\\staging');
    child.stderr.emit('data', 'not found');
    child.emit('close', 1);

    await expect(promise).resolves.toEqual({
      stdout: '',
      stderr: 'not found',
      exitCode: 1,
    });
  });

  it('tree-kills the spawned npx process and reports exit 124 on timeout', async () => {
    jest.useFakeTimers();
    const realPlatform = process.platform;
    try {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true,
      });
      const promise = runSkillsCli(
        ['add', 'anthropics/skills'],
        'C:\\staging',
        50,
      );
      jest.advanceTimersByTime(50);

      await expect(promise).resolves.toEqual({
        stdout: '',
        stderr: 'CLI timed out after 50ms',
        exitCode: 124,
      });
      await Promise.resolve();
      expect(child.kill).not.toHaveBeenCalled();
      expect(mockExecFile).toHaveBeenCalledWith(
        'taskkill',
        ['/pid', '2468', '/T', '/F'],
        expect.any(Function),
      );
    } finally {
      Object.defineProperty(process, 'platform', {
        value: realPlatform,
        configurable: true,
      });
      jest.useRealTimers();
    }
  });

  it('escalates to SIGKILL when a POSIX npx process survives SIGTERM', async () => {
    jest.useFakeTimers();
    const realPlatform = process.platform;
    const kill = jest.spyOn(process, 'kill').mockReturnValue(true);
    try {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true,
      });
      const promise = runSkillsCli(
        ['add', 'anthropics/skills'],
        '/tmp/staging',
        50,
      );
      jest.advanceTimersByTime(50);
      await expect(promise).resolves.toMatchObject({ exitCode: 124 });
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(5_000);

      expect(kill).toHaveBeenCalledWith(-2468, 'SIGTERM');
      expect(kill).toHaveBeenCalledWith(-2468, 0);
      expect(kill).toHaveBeenCalledWith(-2468, 'SIGKILL');
    } finally {
      jest.restoreAllMocks();
      Object.defineProperty(process, 'platform', {
        value: realPlatform,
        configurable: true,
      });
      jest.useRealTimers();
    }
  });

  it('escalates to SIGKILL if npx process leader exits but group descendants remain alive', async () => {
    jest.useFakeTimers();
    const realPlatform = process.platform;
    const kill = jest
      .spyOn(process, 'kill')
      .mockImplementation((pid, signal) => {
        if (signal === 0) {
          if (pid === 2468) {
            throw new Error('ESRCH');
          }
          if (pid === -2468) {
            return true;
          }
        }
        return true;
      });
    try {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true,
      });

      const promise = runSkillsCli(
        ['add', 'anthropics/skills'],
        '/tmp/staging',
        50,
      );
      jest.advanceTimersByTime(50);
      await expect(promise).resolves.toMatchObject({ exitCode: 124 });
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(5_000);

      expect(kill).toHaveBeenCalledWith(-2468, 'SIGTERM');
      expect(kill).toHaveBeenCalledWith(-2468, 0);
      expect(kill).toHaveBeenCalledWith(-2468, 'SIGKILL');
    } finally {
      jest.restoreAllMocks();
      Object.defineProperty(process, 'platform', {
        value: realPlatform,
        configurable: true,
      });
      jest.useRealTimers();
    }
  });

  it('rejects when the child cannot be spawned at all', async () => {
    const promise = runSkillsCli(['add', 'anthropics/skills'], 'C:\\staging');
    child.emit('error', new Error('spawn npx ENOENT'));

    await expect(promise).rejects.toThrow('spawn npx ENOENT');
  });
});
