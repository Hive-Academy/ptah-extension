/** A local, kernel-arbitrated lease for driving a session. */
export interface DriverHolder {
  kind: 'desktop' | 'worker' | 'cli';
  hostname: string;
  pid: number;
  label: string;
  acquiredAt: string;
  responding: boolean;
}

export type DriverLockAcquisition =
  | { ok: true; nonce: string }
  | { ok: false; holder: DriverHolder }
  | { ok: false; unavailable: string };

export interface HeldDriverLock {
  sessionId: string;
  owner: DriverHolder;
  purpose: 'drive' | 'refresh';
  nonce: string;
  state: 'held' | 'releasing' | 'stranded';
}

/**
 * Decides an operator release for the process that owns the session's drivers.
 * It calls `release` only while no owner exists, and holds off new owners until
 * `release` settles, so liveness and release form one step.
 */
export type DriverLockReleaseGate = (
  sessionId: string,
  release: () => Promise<'released' | 'stranded'>,
) => Promise<'in-use' | 'released' | 'stranded'>;

export interface ISessionDriverLock {
  setLiveRecordCheck(
    check: (sessionId: string) => boolean | Promise<boolean>,
  ): void;
  setReleaseGate(gate: DriverLockReleaseGate): void;
  acquire(
    sessionId: string,
    owner: DriverHolder,
    purpose?: 'drive' | 'refresh',
  ): Promise<DriverLockAcquisition>;
  annotate(sessionId: string, nonce: string, label: string): void;
  release(sessionId: string, nonce: string): Promise<'released' | 'stranded'>;
  holder(sessionId: string): Promise<DriverHolder | null>;
  held(): HeldDriverLock[];
  dispose(): Promise<void>;
}
