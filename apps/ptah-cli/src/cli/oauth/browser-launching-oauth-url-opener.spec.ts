/**
 * Unit tests for `BrowserLaunchingOAuthUrlOpener`.
 *
 * The win32 case is the reason this spec exists. `start` is a cmd.exe BUILTIN,
 * so it cannot be spawned as an executable — the old code reached it with
 * `shell: this.platform === 'win32'` alongside an args array, which is the
 * `[DEP0190]` shape: the verification URL would be pasted into a cmd.exe
 * command line unescaped. Naming `cmd` as the executable gets the builtin with
 * the arguments still separate (TASK_2026_348).
 */

import { BrowserLaunchingOAuthUrlOpener } from './browser-launching-oauth-url-opener.js';

const URL = 'https://github.com/login/device';

interface SpawnCall {
  command: string;
  args: readonly string[];
  options: Record<string, unknown>;
}

function makeOpener(platform: NodeJS.Platform): {
  opener: BrowserLaunchingOAuthUrlOpener;
  calls: SpawnCall[];
  unref: jest.Mock;
} {
  const calls: SpawnCall[] = [];
  const unref = jest.fn();
  const opener = new BrowserLaunchingOAuthUrlOpener({
    platform,
    isTTY: true,
    env: {},
    stderrOpener: {
      openOAuthUrl: jest.fn().mockResolvedValue({ opened: false }),
    },
    spawner: (command, args, options) => {
      calls.push({
        command,
        args,
        options: options as unknown as Record<string, unknown>,
      });
      return { unref };
    },
  });
  return { opener, calls, unref };
}

describe('BrowserLaunchingOAuthUrlOpener', () => {
  it('reaches the cmd.exe `start` builtin without a shell option on win32', async () => {
    const { opener, calls, unref } = makeOpener('win32');

    const result = await opener.openOAuthUrl({
      provider: 'claude',
      verificationUri: URL,
    });

    expect(result).toEqual({ opened: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('cmd');
    // The empty string is `start`'s title argument. Without it, `start` reads a
    // quoted URL as the window title and opens nothing.
    expect(calls[0].args).toEqual(['/c', 'start', '', URL]);
    expect(calls[0].options).not.toHaveProperty('shell');
    expect(calls[0].options).toMatchObject({
      detached: true,
      stdio: 'ignore',
    });
    expect(unref).toHaveBeenCalled();
  });

  it('spawns `open` on darwin, unchanged and shell-free', async () => {
    const { opener, calls } = makeOpener('darwin');

    await opener.openOAuthUrl({ provider: 'claude', verificationUri: URL });

    expect(calls[0].command).toBe('open');
    expect(calls[0].args).toEqual([URL]);
    expect(calls[0].options).not.toHaveProperty('shell');
  });

  it('spawns `xdg-open` on linux, unchanged and shell-free', async () => {
    const { opener, calls } = makeOpener('linux');

    await opener.openOAuthUrl({ provider: 'claude', verificationUri: URL });

    expect(calls[0].command).toBe('xdg-open');
    expect(calls[0].args).toEqual([URL]);
    expect(calls[0].options).not.toHaveProperty('shell');
  });

  it('does not launch a browser without a TTY, or under CI / NO_BROWSER', async () => {
    for (const options of [
      { isTTY: false, env: {} },
      { isTTY: true, env: { CI: '1' } },
      { isTTY: true, env: { NO_BROWSER: '1' } },
    ]) {
      const spawner = jest.fn();
      const opener = new BrowserLaunchingOAuthUrlOpener({
        platform: 'win32',
        stderrOpener: {
          openOAuthUrl: jest.fn().mockResolvedValue({ opened: false }),
        },
        spawner,
        ...options,
      });

      const result = await opener.openOAuthUrl({
        provider: 'claude',
        verificationUri: URL,
      });

      expect(result).toEqual({ opened: false });
      expect(spawner).not.toHaveBeenCalled();
    }
  });

  it('reports not-opened when the spawn throws', async () => {
    const opener = new BrowserLaunchingOAuthUrlOpener({
      platform: 'linux',
      isTTY: true,
      env: {},
      stderrOpener: {
        openOAuthUrl: jest.fn().mockResolvedValue({ opened: false }),
      },
      spawner: () => {
        throw new Error('ENOENT');
      },
    });

    await expect(
      opener.openOAuthUrl({ provider: 'claude', verificationUri: URL }),
    ).resolves.toEqual({ opened: false });
  });
});
