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

export interface ISessionDriverLock {
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
