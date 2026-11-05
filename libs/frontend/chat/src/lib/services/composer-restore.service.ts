import { Injectable, signal } from '@angular/core';

/**
 * Text that must go back into one tab's composer (TASK_2026_884): follow-ups
 * a Stop withdrew, a withdrawn queued item, or a follow-up that failed.
 *
 * Kept per tab until that tab's composer is shown and takes it, so a restore
 * for a hidden tab is not lost. Several restores for one tab join in the
 * order they arrived. No dependencies, so every composer can read it.
 */
@Injectable({ providedIn: 'root' })
export class ComposerRestoreService {
  private readonly pending = signal<ReadonlyMap<string, string>>(new Map());

  /** Queue `texts` (FIFO) for the tab's composer. Blank texts are skipped. */
  restore(tabId: string, texts: readonly string[]): void {
    const content = texts
      .map((text) => text.trim())
      .filter((text) => text.length > 0)
      .join('\n');
    if (!content) return;
    this.pending.update((current) => {
      const next = new Map(current);
      const earlier = next.get(tabId);
      next.set(tabId, earlier ? `${earlier}\n${content}` : content);
      return next;
    });
  }

  /** The text waiting for the tab's composer, or `null`. Reactive. */
  pendingFor(tabId: string): string | null {
    return this.pending().get(tabId) ?? null;
  }

  /** Take the tab's waiting text (the composer calls this once it shows it). */
  consume(tabId: string): string | null {
    const content = this.pending().get(tabId) ?? null;
    if (content !== null) this.discard(tabId);
    return content;
  }

  /** Forget the tab's waiting text (the tab closed). */
  discard(tabId: string): void {
    if (!this.pending().has(tabId)) return;
    this.pending.update((current) => {
      const next = new Map(current);
      next.delete(tabId);
      return next;
    });
  }
}
