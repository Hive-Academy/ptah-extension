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

jest.mock('cross-spawn', () => ({ __esModule: true, default: jest.fn() }));

import crossSpawn from 'cross-spawn';

import { runSkillsCli } from './skills-sh-cli';

const crossSpawnMock = crossSpawn as unknown as jest.Mock;

class FakeChild extends EventEmitter {
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

  it('SIGTERMs the child and reports exit 124 on timeout', async () => {
    jest.useFakeTimers();
    try {
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
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects when the child cannot be spawned at all', async () => {
    const promise = runSkillsCli(['add', 'anthropics/skills'], 'C:\\staging');
    child.emit('error', new Error('spawn npx ENOENT'));

    await expect(promise).rejects.toThrow('spawn npx ENOENT');
  });
});
