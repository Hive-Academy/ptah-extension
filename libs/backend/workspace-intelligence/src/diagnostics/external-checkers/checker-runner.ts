/**
 * runChecker — run one external checker process under fixed limits
 * (TASK_2026_559 Batch 37a, implementation-plan-languages.md "Tier 1").
 *
 * The process is created through the host's {@link IProcessSpawner}
 * (`process-spawner.interface.ts`), with an ARGUMENT ARRAY and no shell, and
 * the request's `env` is the child's COMPLETE environment: the caller builds
 * it from an allowlist ({@link pickInheritedEnv}), never by spreading
 * `process.env`.
 *
 * Limits, each ending the run with its own kind (never a silent success):
 * - `timeout` — the budget elapsed (measured from the call, so a spawn that is
 *   slow to start counts against it);
 * - `too-large` — stdout + stderr passed the byte cap;
 * - `cancelled` — the caller's `AbortSignal` fired;
 * - `spawn-failed` — the spawner threw or the child reported `error`.
 *
 * Every limit kills the whole process TREE: `killProcessTree` (taskkill /T on
 * win32, a process-group kill on POSIX, where the child is started
 * `detached` so it leads its own group), then the handle itself. The answer
 * is returned without waiting for the tree to die.
 *
 * Nothing here logs: paths and raw output stay with the caller, which decides
 * what (if anything) a fixed-text audit line may say.
 */

import { killProcessTree } from '@ptah-extension/platform-core';
import type {
  IProcessSpawner,
  SpawnedProcessHandle,
} from '@ptah-extension/platform-core';
import { readEnvVariable } from './go-binary-resolver';

/** Stdout + stderr bytes one run may produce (2 MiB). */
export const CHECKER_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

export interface CheckerRunRequest {
  readonly spawner: IProcessSpawner;
  /** Absolute path of the binary; never a bare name. */
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /** The child's complete environment. */
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly maxOutputBytes?: number;
  readonly signal?: AbortSignal;
}

export type CheckerRunResult =
  | {
      readonly kind: 'exited';
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
      readonly stdout: string;
      readonly stderr: string;
      readonly durationMs: number;
    }
  | {
      readonly kind: 'timeout' | 'too-large' | 'cancelled' | 'spawn-failed';
      readonly durationMs: number;
    };

export interface CheckerRunnerDependencies {
  /** Kill a process and its descendants. Defaults to `killProcessTree`. */
  readonly killTree?: (pid: number) => Promise<void>;
  readonly now?: () => number;
  readonly platform?: NodeJS.Platform;
  /** Told when a tree kill itself failed; the run's answer is unchanged. */
  readonly onKillError?: (error: unknown) => void;
}

/**
 * Copy only the named variables of the parent environment (win32: keys
 * matched without case, written under the name given here). A variable the
 * parent does not set is left out, never set to an empty string.
 */
export function pickInheritedEnv(
  parentEnv: Readonly<Record<string, string | undefined>>,
  names: readonly string[],
  platform: NodeJS.Platform,
): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const name of names) {
    const value = readEnvVariable(parentEnv, name, platform);
    if (value !== undefined) picked[name] = value;
  }
  return picked;
}

function toBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  return Buffer.from(String(chunk), 'utf8');
}

/** Kill the tree once the pid is known, then the handle itself. */
async function killTreeOf(
  handle: SpawnedProcessHandle,
  killTree: (pid: number) => Promise<void>,
): Promise<void> {
  const pid = handle.pid ?? (await handle.whenSpawned);
  if (pid !== null && pid !== undefined) {
    await killTree(pid);
  }
  handle.kill('SIGKILL');
}

export function runChecker(
  request: CheckerRunRequest,
  dependencies: CheckerRunnerDependencies = {},
): Promise<CheckerRunResult> {
  const now = dependencies.now ?? Date.now;
  const platform = dependencies.platform ?? process.platform;
  const killTree =
    dependencies.killTree ?? ((pid: number) => killProcessTree(pid, 'SIGKILL'));
  const maxOutputBytes = request.maxOutputBytes ?? CHECKER_MAX_OUTPUT_BYTES;
  const startedAt = now();
  const elapsed = (): number => Math.max(0, now() - startedAt);

  if (request.signal?.aborted) {
    return Promise.resolve({ kind: 'cancelled', durationMs: 0 });
  }

  return new Promise<CheckerRunResult>((resolve) => {
    let settled = false;
    let outputBytes = 0;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let handle: SpawnedProcessHandle | undefined;

    const onAbort = (): void => terminate('cancelled');

    function finish(result: CheckerRunResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onAbort);
      resolve(result);
    }

    function terminate(
      kind: 'timeout' | 'too-large' | 'cancelled' | 'spawn-failed',
    ): void {
      if (settled) return;
      finish({ kind, durationMs: elapsed() });
      // A child that reported `error` may still be alive; kill it as well.
      if (handle !== undefined) {
        killTreeOf(handle, killTree).catch((error: unknown) => {
          dependencies.onKillError?.(error);
        });
      }
    }

    function collect(target: Buffer[]): (chunk: unknown) => void {
      return (chunk: unknown) => {
        if (settled) return;
        const buffer = toBuffer(chunk);
        outputBytes += buffer.length;
        if (outputBytes > maxOutputBytes) {
          terminate('too-large');
          return;
        }
        target.push(buffer);
      };
    }

    // Declared before anything can call `finish`, which clears it.
    const timer = setTimeout(() => terminate('timeout'), request.timeoutMs);
    request.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      handle = request.spawner.spawnProcess({
        command: request.command,
        args: [...request.args],
        cwd: request.cwd,
        env: { ...request.env },
        // POSIX: lead a process group so the tree kill reaches descendants.
        detached: platform !== 'win32',
      });
    } catch (error: unknown) {
      // The spawner refused (bad command, no thread): reported below as its
      // own kind, which the caller turns into a fixed-text failure.
      void error;
    }
    if (handle === undefined) {
      terminate('spawn-failed');
      return;
    }

    handle.stdout?.on('data', collect(stdout));
    handle.stderr?.on('data', collect(stderr));
    handle.once('error', () => terminate('spawn-failed'));
    handle.once('close', (code, signal) => {
      finish({
        kind: 'exited',
        code,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        durationMs: elapsed(),
      });
    });
  });
}
