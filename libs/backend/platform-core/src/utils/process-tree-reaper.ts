import { execFile } from 'node:child_process';

/** Grace period for SIGTERM before SIGKILL escalation. */
export const PROCESS_TREE_KILL_GRACE_MS = 5_000;

const PROCESS_LIVENESS_POLL_MS = 100;

/**
 * Resolve `taskkill` from `%SystemRoot%\System32` rather than letting Windows
 * search `PATH`. A bare name is resolved through `PATH`, so any writable
 * directory ahead of System32 can interpose its own `taskkill.exe` and receive
 * a forced tree kill (`typescript:S4036`). `SystemRoot` is set on every
 * supported Windows host; the bare name remains as a fallback for an
 * environment that has unset it.
 */
function resolveTaskkill(): string {
  const systemRoot = process.env['SystemRoot'] ?? process.env['windir'];
  return systemRoot ? `${systemRoot}\\System32\\taskkill.exe` : 'taskkill';
}

/**
 * Only ESRCH proves the group is gone. EPERM means it still exists but this
 * process may not signal it, which must not end the poll.
 */
function isEsrch(error: unknown): boolean {
  return (
    error instanceof Error &&
    (('code' in error && (error as NodeJS.ErrnoException).code === 'ESRCH') ||
      error.message.includes('ESRCH'))
  );
}

/**
 * Best-effort cross-platform process-tree termination.
 *
 * Windows delegates tree traversal and forced termination to `taskkill`.
 * POSIX first signals the process group, falls back to the single pid when no
 * group exists, and escalates after the grace period only while the pid remains
 * alive. An already-exited process is the successful fast path.
 */
export async function killProcessTree(
  pid: number,
  signal: NodeJS.Signals = 'SIGTERM',
  onError?: (error: unknown) => void,
): Promise<void> {
  if (process.platform === 'win32') {
    try {
      await new Promise<void>((resolve, reject) => {
        execFile(
          resolveTaskkill(),
          ['/pid', String(pid), '/T', '/F'],
          (error: Error | null) => (error ? reject(error) : resolve()),
        );
      });
    } catch (error: unknown) {
      onError?.(error);
    }
    return;
  }

  const killGroup = (nextSignal: NodeJS.Signals): void => {
    try {
      process.kill(-pid, nextSignal);
    } catch {
      try {
        process.kill(pid, nextSignal);
      } catch {
        // Best effort: the process may already have exited.
      }
    }
  };

  killGroup(signal);

  await new Promise<void>((resolve) => {
    let waited = 0;
    const poll = (): void => {
      try {
        // Probe the GROUP, not the leader: a leader that exits while a
        // descendant survives would otherwise read as "gone" and the descendant
        // would never be escalated to SIGKILL.
        process.kill(-pid, 0); // liveness probe — throws ESRCH once the group is gone
        // degradation-audit: optional-capability - ESRCH means the process group
        // has already exited, which is the awaited success outcome, not a failure;
        // resolving here is the normal fast path this poll exists for.
      } catch (error: unknown) {
        if (isEsrch(error)) {
          resolve();
          return;
        }
      }

      waited += PROCESS_LIVENESS_POLL_MS;
      if (waited >= PROCESS_TREE_KILL_GRACE_MS) {
        killGroup('SIGKILL');
        resolve();
        return;
      }

      setTimeout(poll, PROCESS_LIVENESS_POLL_MS).unref?.();
    };

    setTimeout(poll, PROCESS_LIVENESS_POLL_MS).unref?.();
  });
}
