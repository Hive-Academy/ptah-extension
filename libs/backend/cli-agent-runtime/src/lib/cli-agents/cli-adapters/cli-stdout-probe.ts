/**
 * One-shot CLI stdout probe shared by the adapters that list models by running
 * their binary (`grok models`, `pi --list-models`).
 *
 * Kept beside `cli-adapter.utils.ts` rather than inside it so that it reaches
 * `spawnCli` and `killProcessTree` through the module's exports: the adapter
 * specs replace them by mocking `./cli-adapter.utils`, and a call from inside
 * that module would bypass the mock.
 */
import type { IProcessSpawner } from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';
import { killProcessTree, spawnCli } from './cli-adapter.utils';

export interface ProbeCliStdoutOptions {
  readonly spawner?: IProcessSpawner;
  /** The process tree is killed and the probe yields undefined after this long. */
  readonly timeoutMs: number;
  /** Told when the command could not start; receives the command and the error message only. */
  readonly logger?: Logger;
}

/**
 * Run `binary args` and resolve its trimmed stdout. Never throws: resolves
 * undefined on a start failure (including `spawnCli`'s synchronous refusal of
 * an over-long command line), a process error, a timeout or empty output.
 *
 * On timeout the whole process tree is killed via `killProcessTree` — the same
 * `detached: true` + `whenSpawned` pattern as `probeCliVersion` — because a
 * bare `child.kill()` signals only the direct child: on Windows that is
 * cmd.exe behind a `.cmd` shim (the real CLI survives), and on POSIX the
 * child's grandchildren survive unless the child is a process-group leader.
 */
export function probeCliStdout(
  binary: string,
  args: string[],
  options: ProbeCliStdoutOptions,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    let spawned: ReturnType<typeof spawnCli> | undefined;
    try {
      spawned = spawnCli(binary, args, {
        spawner: options.spawner,
        detached: true,
      });
    } catch (error: unknown) {
      options.logger?.warn('[probeCliStdout] command could not start', {
        command: binary,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (!spawned) {
      resolve(undefined);
      return;
    }
    const child = spawned;
    let stdout = '';
    const timer = setTimeout(() => {
      void child.whenSpawned.then((pid) => {
        if (pid && !child.killed) {
          void killProcessTree(pid);
        }
      });
      resolve(undefined);
    }, options.timeoutMs);

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (data: string) => {
      stdout += data;
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(stdout.trim() || undefined);
    });
    child.on('error', (error: Error) => {
      clearTimeout(timer);
      options.logger?.warn('[probeCliStdout] command failed', {
        command: binary,
        error: error.message,
      });
      resolve(undefined);
    });
  });
}
