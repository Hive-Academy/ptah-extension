import { spawn, type SpawnOptions } from 'node:child_process';

import type { IOAuthUrlOpener } from '@ptah-extension/platform-cli';

import { StderrOAuthUrlOpener } from './stderr-oauth-url-opener.js';

type SpawnLike = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => { unref(): void };

export interface BrowserLaunchingOAuthUrlOpenerOptions {
  stderrOpener?: IOAuthUrlOpener;
  platform?: NodeJS.Platform;
  spawner?: SpawnLike;
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
}

export class BrowserLaunchingOAuthUrlOpener implements IOAuthUrlOpener {
  private readonly stderrOpener: IOAuthUrlOpener;
  private readonly platform: NodeJS.Platform;
  private readonly spawner: SpawnLike;
  private readonly env: NodeJS.ProcessEnv;
  private readonly isTTY: boolean;

  constructor(options: BrowserLaunchingOAuthUrlOpenerOptions = {}) {
    this.stderrOpener = options.stderrOpener ?? new StderrOAuthUrlOpener();
    this.platform = options.platform ?? process.platform;
    this.spawner = options.spawner ?? (spawn as unknown as SpawnLike);
    this.env = options.env ?? process.env;
    this.isTTY = options.isTTY ?? process.stdout.isTTY === true;
  }

  async openOAuthUrl(params: {
    provider: string;
    verificationUri: string;
    userCode?: string;
  }): Promise<{ opened: boolean; code?: string }> {
    await this.stderrOpener.openOAuthUrl(params);

    if (!this.isTTY) return { opened: false };
    if (this.env['NO_BROWSER']) return { opened: false };
    if (this.env['CI']) return { opened: false };

    try {
      const [command, args] = this.commandFor(params.verificationUri);
      const child = this.spawner(command, args, {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      return { opened: true };
    } catch {
      return { opened: false };
    }
  }

  /**
   * On win32 `start` is a cmd.exe builtin, not an executable, so it has to be
   * invoked through `cmd /c` — but as an ARGUMENT to cmd, never via
   * `shell: true` with an args array, which is the `[DEP0190]` shape (the URL
   * would reach cmd.exe unescaped). The empty string after `start` is its title
   * argument; without it `start` treats a quoted URL as the window title and
   * opens nothing (TASK_2026_348).
   */
  private commandFor(url: string): [string, string[]] {
    if (this.platform === 'win32') {
      return ['cmd', ['/c', 'start', '', url]];
    }
    if (this.platform === 'darwin') {
      return ['open', [url]];
    }
    return ['xdg-open', [url]];
  }
}
