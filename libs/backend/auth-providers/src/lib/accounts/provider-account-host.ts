import { createHash } from 'node:crypto';
import { hostname } from 'node:os';

/**
 * The host process that owns a run lease, recorded with the lease so a later
 * process can prove the owner is gone (migration 0061).
 *
 * `machine` is a digest of the platform and host name. A process can only
 * observe processes on its own machine, so a lease from any other machine
 * (another container, WSL against a Windows host, a shared home directory) is
 * never judged and stays held.
 */
export interface ProviderAccountLeaseHost {
  readonly pid: number;
  readonly machine: string;
}

/** Answers whether a process with `pid` exists right now on this machine. */
export type ProcessExistsProbe = (pid: number) => boolean;

/** This process, computed once. */
export const CURRENT_LEASE_HOST: ProviderAccountLeaseHost = Object.freeze({
  pid: process.pid,
  machine: createHash('sha256').update(`${process.platform}\0${hostname()}`).digest('hex'),
});

/**
 * `process.kill(pid, 0)` sends nothing; it only asks the OS. Only `ESRCH` (no
 * such process, which on Windows includes an exited one) proves absence.
 * `EPERM` means a process exists that this user may not signal. Any other
 * failure proves nothing, so the owner is treated as alive.
 */
export const processExists: ProcessExistsProbe = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    // Only ESRCH proves the owner gone; every other failure keeps the lease held.
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
  }
};

/** The recorded owner of a lease: its host process and, once spawned, its Claude child. */
export interface ProviderAccountLeaseOwner {
  readonly pid: number | null;
  readonly machine: string | null;
  readonly childPid: number | null;
}

/**
 * True only when the lease's run is proved over: the lease names a host on
 * this machine, no process with the host pid exists, and no process with the
 * recorded Claude child pid exists either. The child can outlive a crashed
 * host (Windows does not end a process tree with its parent), so host death
 * alone proves nothing once a child was recorded. A lease whose child was
 * never recorded had no child spawned by the time the host recorded it.
 * A reused pid reads as alive and keeps the lease held: that delays recovery,
 * it never takes a lease from a live run. A legacy lease without an owner
 * (written before migration 0061) is never proved over.
 */
export function leaseOwnerGone(owner: ProviderAccountLeaseOwner,
  current: ProviderAccountLeaseHost = CURRENT_LEASE_HOST, exists: ProcessExistsProbe = processExists): boolean {
  if (owner.pid === null || owner.machine === null || owner.machine !== current.machine) return false;
  if (owner.pid === current.pid) return false;
  if (exists(owner.pid)) return false;
  return owner.childPid === null || !exists(owner.childPid);
}
