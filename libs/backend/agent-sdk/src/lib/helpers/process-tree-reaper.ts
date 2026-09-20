import { execFile } from 'node:child_process';

/** Must remain aligned with cli-agent-runtime's canonical KILL_GRACE_PERIOD. */
export const PROCESS_TREE_KILL_GRACE_MS = 5_000;
const PROCESS_LIVENESS_POLL_MS = 100;

/** Private agent-sdk mirror; importing cli-agent-runtime would form a cycle. */
export async function killProcessTree(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    try {
      await new Promise<void>((resolve) => {
        execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () =>
          resolve(),
        );
      });
    } catch {
      // Best effort: the process may already have exited.
    }
    return;
  }

  const killGroup = (signal: NodeJS.Signals): void => {
    try {
      process.kill(-pid, signal);
    } catch {
      try {
        process.kill(pid, signal);
      } catch {
        // Best effort: the process may already have exited.
      }
    }
  };

  killGroup('SIGTERM');

  await new Promise<void>((resolve) => {
    let waited = 0;
    const poll = (): void => {
      try {
        process.kill(pid, 0);
      } catch {
        resolve();
        return;
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
