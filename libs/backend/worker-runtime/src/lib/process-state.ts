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
