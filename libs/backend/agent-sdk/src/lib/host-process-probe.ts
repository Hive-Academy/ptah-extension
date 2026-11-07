/**
 * Whether a process with this pid exists. `process.kill(pid, 0)` sends no
 * signal; it only asks the OS. Only `ESRCH` (no such process, which on Windows
 * includes an exited one) proves absence. `EPERM` means a process exists that
 * this user may not signal, and any other failure proves nothing, so both
 * count as alive.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    // degradation-audit: optional-capability - the probe's answer is the
    // error code itself; only ESRCH proves the process gone.
    return !(
      error instanceof Error &&
      'code' in error &&
      error.code === 'ESRCH'
    );
  }
}
