import { Injectable, InjectionToken } from '@angular/core';

/** Rollback switch for Phase 4's incremental markdown and shared scroll path. */
export const INCREMENTAL_STREAMING_PRESENTATION_ENABLED = new InjectionToken<boolean>(
  'INCREMENTAL_STREAMING_PRESENTATION_ENABLED',
  { providedIn: 'root', factory: () => true },
);

/** Coalesces streaming scroll reads/writes into one browser frame. */
@Injectable({ providedIn: 'root' })
export class ScrollDirtyService {
  private readonly work = new Set<() => void>();
  private frame: number | null = null;

  markDirty(work: () => void): void {
    this.work.add(work);
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      const pending = [...this.work];
      this.work.clear();
      pending.forEach((callback) => callback());
    });
  }
}
