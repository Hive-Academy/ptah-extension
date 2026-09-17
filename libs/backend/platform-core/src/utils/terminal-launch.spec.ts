import * as os from 'node:os';
import * as path from 'node:path';
import {
  TERMINAL_EXIT_PROBE_MS,
  prepareTerminalLaunch,
  spawnTerminalProcess,
  terminalCommand,
  terminalExecutableCandidates,
} from './terminal-launch';

describe('terminal launch', () => {
  const root = path.resolve('workspace root');

  function terminal(executable: string) {
    return {
      id: 'terminal' as const,
      displayName: 'Terminal',
      executablePath: path.resolve(executable),
    };
  }

  describe('terminalExecutableCandidates', () => {
    it('prefers Git Bash beside the git install found on PATH on Windows', () => {
      expect(
        terminalExecutableCandidates(
          'win32',
          {
            PATH: 'C:\\Windows\\System32;D:\\Tools\\Git\\cmd;E:\\Git2\\mingw64\\bin',
            ProgramFiles: 'C:\\Program Files',
            LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
            ComSpec: 'C:\\Windows\\System32\\cmd.exe',
          },
          'C:\\Users\\me',
        ),
      ).toEqual([
        'D:\\Tools\\Git\\git-bash.exe',
        'E:\\Git2\\git-bash.exe',
        'C:\\Program Files\\Git\\git-bash.exe',
        'C:\\Users\\me\\AppData\\Local\\Programs\\Git\\git-bash.exe',
        'C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe',
        'C:\\Windows\\System32\\cmd.exe',
      ]);
    });

    it('deduplicates the Program Files candidates case-insensitively', () => {
      const candidates = terminalExecutableCandidates(
        'win32',
        {
          PATH: 'C:\\Program Files\\Git\\cmd',
          ProgramFiles: 'C:\\Program Files',
          ProgramW6432: 'c:\\program files',
        },
        'C:\\Users\\me',
      );
      expect(
        candidates.filter((c) => c.toLowerCase().endsWith('git-bash.exe'))
          .length,
      ).toBe(2);
    });

    it('uses open on macOS and common emulators on Linux', () => {
      expect(terminalExecutableCandidates('darwin', {}, '/Users/me')).toEqual([
        '/usr/bin/open',
      ]);
      expect(terminalExecutableCandidates('linux', {}, '/home/me')[0]).toBe(
        '/usr/bin/x-terminal-emulator',
      );
      expect(terminalCommand('win32')).toBe('git-bash');
      expect(terminalCommand('darwin')).toBe('open');
      expect(terminalCommand('linux')).toBe('x-terminal-emulator');
    });
  });

  describe('prepareTerminalLaunch', () => {
    it('passes the root to Git Bash as one argv element', () => {
      expect(
        prepareTerminalLaunch(terminal('Git/git-bash.exe'), root, 'win32'),
      ).toEqual({
        command: path.resolve('Git/git-bash.exe'),
        args: [`--cd=${root}`],
        cwd: root,
        detached: false,
        needsConsole: true,
      });
    });

    it('never puts the root in argv for Windows Terminal or cmd', () => {
      const hostile = path.resolve('a; cmd /c calc & echo');
      const wt = prepareTerminalLaunch(terminal('wt.exe'), hostile, 'win32');
      expect(wt.args).toEqual(['-d', '.']);
      expect(wt.cwd).toBe(hostile);

      const cmd = prepareTerminalLaunch(terminal('cmd.exe'), hostile, 'win32');
      expect(cmd.args).toEqual(['/d', '/c', 'start', '', 'cmd.exe']);
      expect(cmd.cwd).toBe(hostile);
      expect(cmd.needsConsole).toBe(false);
    });

    it('opens Terminal.app on macOS and detaches POSIX launches', () => {
      expect(prepareTerminalLaunch(terminal('open'), root, 'darwin')).toEqual({
        command: path.resolve('open'),
        args: ['-a', 'Terminal', root],
        cwd: root,
        detached: true,
        needsConsole: false,
      });
    });

    it('passes the working directory flag each Linux emulator expects', () => {
      expect(
        prepareTerminalLaunch(terminal('gnome-terminal'), root, 'linux').args,
      ).toEqual([`--working-directory=${root}`]);
      expect(
        prepareTerminalLaunch(terminal('konsole'), root, 'linux').args,
      ).toEqual(['--workdir', root]);
      expect(
        prepareTerminalLaunch(terminal('x-terminal-emulator'), root, 'linux'),
      ).toMatchObject({ args: [], cwd: root, detached: true });
    });

    it('rejects a non-terminal target, a relative root and a missing path', () => {
      expect(() =>
        prepareTerminalLaunch(
          {
            id: 'zed',
            displayName: 'Zed',
            executablePath: path.resolve('zed'),
          },
          root,
        ),
      ).toThrow('Zed is not a terminal');
      expect(() =>
        prepareTerminalLaunch(terminal('xterm'), 'relative', 'linux'),
      ).toThrow('Workspace root must be absolute');
      expect(() =>
        prepareTerminalLaunch(
          { id: 'terminal', displayName: 'Terminal' },
          root,
        ),
      ).toThrow('Terminal has no executable launch path');
    });
  });

  describe('spawnTerminalProcess', () => {
    /**
     * What one fake handle reports. `exitCode` is the synchronous read the
     * probe does when the child may already be dead; `error` is delivered to
     * the probe's `error` listener at attach time.
     */
    interface FakeOutcome {
      readonly pid: number | null;
      readonly exitCode?: number | null;
      readonly error?: Error;
    }

    /** A spawner whose Nth call returns the Nth outcome. */
    function fakeSpawner(outcomes: readonly FakeOutcome[]): {
      readonly spawnProcess: jest.Mock;
    } {
      const handles = outcomes.map((outcome) => ({
        whenSpawned: Promise.resolve(outcome.pid),
        exitCode: outcome.exitCode ?? null,
        once: (
          event: 'exit' | 'error',
          listener: (...args: unknown[]) => void,
        ) => {
          if (event === 'error' && outcome.error) listener(outcome.error);
        },
        off: () => undefined,
      }));
      return { spawnProcess: jest.fn(() => handles.shift() as never) };
    }

    function terminalTarget(executablePath: string) {
      return {
        id: 'terminal' as const,
        displayName: 'Terminal',
        executablePath,
      };
    }

    /** The Linux list's first entry: the Debian alternatives link. */
    const linuxTerminal = '/usr/bin/x-terminal-emulator';

    const linuxList = [
      linuxTerminal,
      '/usr/bin/gnome-terminal',
      '/usr/bin/konsole',
      '/usr/bin/xfce4-terminal',
      '/usr/bin/xterm',
    ];

    it('spawns the launch plan through the spawner', async () => {
      const { spawnProcess } = fakeSpawner([{ pid: 42, exitCode: 0 }]);

      await expect(
        spawnTerminalProcess(
          { spawnProcess } as never,
          terminalTarget(linuxTerminal),
          root,
          'linux',
        ),
      ).resolves.toBeUndefined();
      expect(spawnProcess).toHaveBeenCalledTimes(1);
      expect(spawnProcess).toHaveBeenCalledWith({
        command: path.normalize(linuxTerminal),
        args: [],
        cwd: root,
        env: process.env,
        detached: true,
        needsConsole: false,
      });
    });

    it('rejects when the terminal never started', async () => {
      const { spawnProcess } = fakeSpawner([{ pid: null }]);

      await expect(
        spawnTerminalProcess(
          { spawnProcess } as never,
          terminalTarget(path.resolve('xterm')),
          root,
          'linux',
        ),
      ).rejects.toThrow('Failed to launch Terminal');
      expect(spawnProcess).toHaveBeenCalledTimes(1);
    });

    it('attempts only the detected candidate when it is not in the built-in list', async () => {
      const { spawnProcess } = fakeSpawner([{ pid: 1, exitCode: 0 }]);

      await expect(
        spawnTerminalProcess(
          { spawnProcess } as never,
          terminalTarget(path.resolve('custom-terminal')),
          root,
          'linux',
        ),
      ).resolves.toBeUndefined();
      expect(spawnProcess).toHaveBeenCalledTimes(1);
    });

    it('tries the next candidate when the first candidate never starts', async () => {
      const { spawnProcess } = fakeSpawner([
        { pid: null },
        { pid: 123, exitCode: 0 },
      ]);

      await expect(
        spawnTerminalProcess(
          { spawnProcess } as never,
          terminalTarget(linuxTerminal),
          root,
          'linux',
        ),
      ).resolves.toBeUndefined();

      expect(spawnProcess).toHaveBeenCalledTimes(2);
      expect(spawnProcess).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          command: path.normalize(linuxTerminal),
        }),
      );
      expect(spawnProcess).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          command: path.normalize('/usr/bin/gnome-terminal'),
        }),
      );
    });

    it('walks the whole built-in list before failing on a non-Windows host', async () => {
      const { spawnProcess } = fakeSpawner(
        linuxList.map(() => ({ pid: null })),
      );

      await expect(
        spawnTerminalProcess(
          { spawnProcess } as never,
          terminalTarget(linuxTerminal),
          root,
          'linux',
        ),
      ).rejects.toThrow('Failed to launch Terminal');

      expect(
        spawnProcess.mock.calls.map(
          ([request]) => (request as { command: string }).command,
        ),
      ).toEqual(linuxList.map((candidate) => path.normalize(candidate)));
    });

    it('tries the next candidate when the first candidate starts and exits at once with a non-zero code', async () => {
      const { spawnProcess } = fakeSpawner([
        { pid: 100, exitCode: 1 },
        { pid: 101, exitCode: 0 },
      ]);

      await expect(
        spawnTerminalProcess(
          { spawnProcess } as never,
          terminalTarget(linuxTerminal),
          root,
          'linux',
        ),
      ).resolves.toBeUndefined();
      expect(spawnProcess).toHaveBeenCalledTimes(2);
    });

    it('tries the next candidate when the spawner reports an error after the start', async () => {
      const { spawnProcess } = fakeSpawner([
        { pid: 11, error: new Error('spawn EACCES') },
        { pid: 12, exitCode: 0 },
      ]);

      await expect(
        spawnTerminalProcess(
          { spawnProcess } as never,
          terminalTarget(linuxTerminal),
          root,
          'linux',
        ),
      ).resolves.toBeUndefined();
      expect(spawnProcess).toHaveBeenCalledTimes(2);
    });

    it('answers as soon as the last candidate starts, without waiting out the probe', async () => {
      jest.useFakeTimers();
      try {
        // macOS has exactly one candidate, so nothing can rescue a bad
        // launch and the wait would buy nothing. Timers never advance here:
        // the call has to settle on its own.
        const { spawnProcess } = fakeSpawner([{ pid: 77 }]);

        await expect(
          spawnTerminalProcess(
            { spawnProcess } as never,
            terminalTarget('/usr/bin/open'),
            root,
            'darwin',
          ),
        ).resolves.toBeUndefined();
        expect(spawnProcess).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it('reports success when the candidate stays alive through the probe window', async () => {
      jest.useFakeTimers();
      try {
        const { spawnProcess } = fakeSpawner([{ pid: 42 }]);

        const pending = spawnTerminalProcess(
          { spawnProcess } as never,
          terminalTarget(linuxTerminal),
          root,
          'linux',
        );
        const assertion = expect(pending).resolves.toBeUndefined();
        await jest.advanceTimersByTimeAsync(TERMINAL_EXIT_PROBE_MS);
        await assertion;
        expect(spawnProcess).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    describe('the built-in win32 list (production call shape)', () => {
      const originalComSpec = process.env['ComSpec'];

      beforeEach(() => {
        // The cmd.exe fallback must stay absolute on every host the suite
        // runs on (CI is Linux), so the test drives the ComSpec the built-in
        // list is built from.
        process.env['ComSpec'] = '/mock/path/cmd.exe';
      });

      afterEach(() => {
        if (originalComSpec === undefined) delete process.env['ComSpec'];
        else process.env['ComSpec'] = originalComSpec;
      });

      /** The wt.exe list entry, built the way production builds it. */
      function detectedWtPath(): string {
        const localAppData =
          process.env['LOCALAPPDATA'] ??
          path.win32.join(os.homedir(), 'AppData', 'Local');
        return path.win32.join(
          localAppData,
          'Microsoft',
          'WindowsApps',
          'wt.exe',
        );
      }

      it('falls back from a detected wt.exe to the cmd.exe candidate', async () => {
        const wt = detectedWtPath();
        const { spawnProcess } = fakeSpawner([
          { pid: null },
          { pid: 5, exitCode: 0 },
        ]);

        await expect(
          spawnTerminalProcess(
            { spawnProcess } as never,
            terminalTarget(wt),
            root,
            'win32',
          ),
        ).resolves.toBeUndefined();

        expect(spawnProcess).toHaveBeenCalledTimes(2);
        expect(spawnProcess).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({ command: path.normalize(wt) }),
        );
        expect(spawnProcess).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({
            command: path.normalize('/mock/path/cmd.exe'),
          }),
        );
      });

      it('counts a clean immediate exit of the WindowsApps wt.exe alias as a successful handoff', async () => {
        // A healthy app alias hands the request to Windows Terminal and exits
        // 0. Reading that as a broken package would open a second, unasked-for
        // cmd.exe window next to the terminal the user did get.
        const wt = detectedWtPath();
        const { spawnProcess } = fakeSpawner([{ pid: 9, exitCode: 0 }]);

        await expect(
          spawnTerminalProcess(
            { spawnProcess } as never,
            terminalTarget(wt),
            root,
            'win32',
          ),
        ).resolves.toBeUndefined();

        expect(spawnProcess).toHaveBeenCalledTimes(1);
      });

      it('falls back when the WindowsApps wt.exe stub exits non-zero', async () => {
        const wt = detectedWtPath();
        const { spawnProcess } = fakeSpawner([
          { pid: 9, exitCode: 1 },
          { pid: 10, exitCode: 0 },
        ]);

        await expect(
          spawnTerminalProcess(
            { spawnProcess } as never,
            terminalTarget(wt),
            root,
            'win32',
          ),
        ).resolves.toBeUndefined();

        expect(spawnProcess).toHaveBeenCalledTimes(2);
        expect(spawnProcess).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({
            command: path.normalize('/mock/path/cmd.exe'),
          }),
        );
      });

      it('counts the cmd.exe start trampoline fast clean exit as success', async () => {
        const { spawnProcess } = fakeSpawner([{ pid: 7, exitCode: 0 }]);

        await expect(
          spawnTerminalProcess(
            { spawnProcess } as never,
            terminalTarget('/mock/path/cmd.exe'),
            root,
            'win32',
          ),
        ).resolves.toBeUndefined();
        expect(spawnProcess).toHaveBeenCalledTimes(1);
      });
    });
  });
});
