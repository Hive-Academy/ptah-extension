import type {
  DriverHolder,
  DriverLockAcquisition,
  DriverLockReleaseGate,
  HeldDriverLock,
  ISessionDriverLock,
} from '../interfaces/session-driver-lock.interface';

/** macOS/local-only adapter; it makes no cross-process exclusion claim. */
export class NullSessionDriverLock implements ISessionDriverLock {
  setLiveRecordCheck(
    _check: (sessionId: string) => boolean | Promise<boolean>,
  ): void {
    /* no kernel control endpoint */
  }
  setReleaseGate(_gate: DriverLockReleaseGate): void {
    /* no kernel control endpoint */
  }
  private readonly entries = new Map<string, HeldDriverLock>();
  private nextNonce = 0;

  async acquire(
    sessionId: string,
    owner: DriverHolder,
    purpose: 'drive' | 'refresh' = 'drive',
  ): Promise<DriverLockAcquisition> {
    const existing = this.entries.get(sessionId);
    if (existing) return { ok: true, nonce: existing.nonce };
    const nonce = `null-${process.pid}-${++this.nextNonce}`;
    this.entries.set(sessionId, {
      sessionId,
      owner: { ...owner, responding: true },
      purpose,
      nonce,
      state: 'held',
    });
    return { ok: true, nonce };
  }

  annotate(sessionId: string, nonce: string, label: string): void {
    const entry = this.entries.get(sessionId);
    if (entry?.nonce === nonce) entry.owner.label = label;
  }

  async release(sessionId: string, nonce: string): Promise<'released'> {
    if (this.entries.get(sessionId)?.nonce === nonce)
      this.entries.delete(sessionId);
    return 'released';
  }

  async holder(sessionId: string): Promise<DriverHolder | null> {
    return this.entries.get(sessionId)?.owner ?? null;
  }

  held(): HeldDriverLock[] {
    return Array.from(this.entries.values(), (entry) => ({
      ...entry,
      owner: { ...entry.owner },
    }));
  }

  async dispose(): Promise<void> {
    this.entries.clear();
  }
}
