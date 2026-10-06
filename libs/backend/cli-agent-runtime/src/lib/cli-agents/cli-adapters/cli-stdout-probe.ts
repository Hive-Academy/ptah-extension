/**
 * One-shot CLI stdout probe shared by the adapters that list models by running
 * their binary (`grok models`, `pi --list-models`).
 *
 * Kept beside `cli-adapter.utils.ts` rather than inside it so that it reaches
 * `spawnCli` through the module's export: the adapter specs replace `spawnCli`
 * by mocking `./cli-adapter.utils`, and a call from inside that module would
 * bypass the mock.
 */
import type { IProcessSpawner } from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';
import { spawnCli } from './cli-adapter.utils';

export interface ProbeCliStdoutOptions {
  readonly spawner?: IProcessSpawner;
  /** The child is killed and the probe yields undefined after this long. */
  readonly timeoutMs: number;
  /** Told when the command could not start; receives the command and the error message only. */
  readonly logger?: Logger;
}

/**
 * Run `binary args` and resolve its trimmed stdout. Never throws: resolves
 * undefined on a start failure (including `spawnCli`'s synchronous refusal of
 * an over-long command line), a process error, a timeout or empty output.
 */
export function probeCliStdout(
  binary: string,
  args: string[],
  options: ProbeCliStdoutOptions,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    let spawned: ReturnType<typeof spawnCli> | undefined;
    try {
      spawned = spawnCli(binary, args, { spawner: options.spawner });
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
      child.kill();
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
