import { DestroyRef, Injectable, Signal, inject, signal } from '@angular/core';
import type { TranscriptRetentionService } from './transcript-retention.service';

/** One instance is provided by each visible Rail board. */
@Injectable()
export class RailTranscriptRetentionCoordinator {
  private readonly destroyRef = inject(DestroyRef);
  private readonly owners = new Map<string, TranscriptRetentionService>();
  private readonly active = signal<ReadonlyMap<TranscriptRetentionService, Signal<string | null>>>(new Map());
  private readonly recency = new Map<string, number>();
  private readonly count = signal(0);
  readonly distinctRetainedCount = this.count.asReadonly();
  private clock = 0;

  constructor() {
    this.destroyRef.onDestroy(() => {
      for (const host of [...this.active().keys()]) this.releaseHost(host);
    });
  }

  register(host: TranscriptRetentionService, activeTabId: Signal<string | null>): void {
    const next = new Map(this.active());
    next.set(host, activeTabId);
    this.active.set(next);
  }

  /** Reading this predicate in a computed view tracks every other pane's live tab. */
  liveElsewhere(host: TranscriptRetentionService, tabId: string): boolean {
    for (const [other, activeTabId] of this.active()) {
      if (other !== host && activeTabId() === tabId) return true;
    }
    return false;
  }

  touch(host: TranscriptRetentionService, tabId: string): void {
    const previous = this.owners.get(tabId);
    if (previous && previous !== host) {
      // Remove the old frozen tree first, but preserve the cache during transfer.
      previous.releaseForTransfer(tabId);
    }
    host.retainFromCoordinator(tabId);
    this.owners.set(tabId, host);
    this.recency.set(tabId, ++this.clock);
    this.count.set(this.owners.size);
    this.evict();
  }

  release(host: TranscriptRetentionService, tabId: string): void {
    if (this.owners.get(tabId) !== host) return;
    this.owners.delete(tabId);
    this.recency.delete(tabId);
    host.releaseFromCoordinator(tabId);
    this.count.set(this.owners.size);
  }

  releaseHost(host: TranscriptRetentionService): void {
    for (const [id, owner] of [...this.owners]) {
      if (owner === host) this.release(host, id);
    }
    const next = new Map(this.active());
    next.delete(host);
    this.active.set(next);
  }

  private evict(): void {
    while (this.owners.size > 4) {
      let victim: string | null = null;
      let oldest = Infinity;
      for (const [id, owner] of this.owners) {
        if (this.active().get(owner)?.() === id) continue;
        const tick = this.recency.get(id) ?? 0;
        if (tick < oldest) { oldest = tick; victim = id; }
      }
      if (victim === null) return;
      const owner = this.owners.get(victim);
      if (!owner) return;
      this.release(owner, victim);
    }
  }
}
