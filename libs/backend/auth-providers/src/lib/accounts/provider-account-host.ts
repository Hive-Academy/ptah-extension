import { createHash, randomBytes } from 'node:crypto';
import { readlinkSync } from 'node:fs';
import { hostname } from 'node:os';

/**
 * The host process that owns a run lease or an auth operation, recorded with
 * the row so a later process can prove the owner is gone (migrations 0061 and
 * 0062).
 *
 * `machine` is a digest of the machine the pid is meaningful on. A process can
 * only observe processes in its own pid space, so a row from any other machine
 * (another container, WSL against a Windows host, a shared home directory) is
 * never judged and stays held. See `computeLeaseMachine`.
 */
export interface ProviderAccountLeaseHost {
  readonly pid: number;
  readonly machine: string;
}

/**
 * Digest of the pid space this process lives in.
 *
 * - win32 and darwin: platform and host name.
 * - linux: platform, host name and the pid namespace (`/proc/self/ns/pid`,
 *   e.g. `pid:[4026531836]`). Two containers can share a host name and still
 *   have separate pid namespaces, where a pid probe says nothing about the
 *   other one.
 * - linux with an unreadable namespace: a per-process random value instead, so
 *   no other process ever records the same machine and nothing is reclaimed
 *   across processes (fail closed).
 *
 * `readPidNamespace` is called only on linux.
 */
export function computeLeaseMachine(platform: NodeJS.Platform, host: string, readPidNamespace: () => string): string {
  let parts = `${platform}\0${host}`;
  if (platform === 'linux') {
    let namespace: string;
    try {
      namespace = `ns\0${readPidNamespace()}`;
    } catch {
      // degradation-audit: optional-capability — an unknown pid namespace gets a machine no other process shares (fail closed)
      namespace = `random\0${randomBytes(32).toString('hex')}`;
    }
    parts = `${parts}\0${namespace}`;
  }
  return createHash('sha256').update(parts).digest('hex');
}

/** Answers whether a process with `pid` exists right now on this machine. */
export type ProcessExistsProbe = (pid: number) => boolean;

/** This process, computed once. */
export const CURRENT_LEASE_HOST: ProviderAccountLeaseHost = Object.freeze({
  pid: process.pid,
  machine: computeLeaseMachine(process.platform, hostname(), () => readlinkSync('/proc/self/ns/pid')),
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
