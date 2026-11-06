import { readFile } from 'node:fs/promises';

/**
 * Whether a process ID names a live process of this user. `foreign` is a live
 * process this user may not signal (EPERM), so it is never a worker of ours.
 */
export type ProcessState = 'alive' | 'dead' | 'foreign';

export function processState(pid: number): ProcessState {
  if (!Number.isInteger(pid) || pid <= 0) return 'dead';
  try {
    // Signal 0 checks existence and permission without delivering anything.
    process.kill(pid, 0);
    return 'alive';
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? error.code
        : undefined;
    if (code === 'ESRCH') return 'dead';
    if (code === 'EPERM') return 'foreign';
    throw error;
  }
}

/**
 * The process start time, in clock ticks since boot (`/proc/<pid>/stat`
 * field 22), on Linux. Two processes that share a PID differ here. Null where
 * `/proc` is unavailable or the process is gone.
 */
export async function processStartTime(pid: number): Promise<string | null> {
  if (process.platform !== 'linux' || !Number.isInteger(pid) || pid <= 0)
    return null;
  let stat: string;
  try {
    stat = await readFile(`/proc/${pid}/stat`, 'utf8');
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? error.code
        : undefined;
    if (code === 'ENOENT' || code === 'ESRCH') return null;
    throw error;
  }
  // The command name (field 2) may contain spaces; fields after it are plain.
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  return fields[19] ?? null;
}
