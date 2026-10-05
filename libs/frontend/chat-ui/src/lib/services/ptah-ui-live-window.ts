import { Injectable, computed, signal } from '@angular/core';
import type { Signal } from '@angular/core';

/**
 * Hard cap on the number of `ptah-ui` blocks per chat tab that stay live
 * (fully rendered and reactive) at once. Every block beyond the window
 * renders as an inert snapshot. Mirrors
 * `SURFACE_STORE_LIMITS.maxSurfacesPerRoutingId`
 * (`libs/shared/src/mcp-apps-contracts/surface-catalog.ts`) — the
 * per-context renderer load the host already accepts — so a coding-chat tab
 * never exceeds an accepted renderer budget.
 */
export const PTAH_UI_LIVE_CAP = 8;

/**
 * Hard cap on the number of block identity keys this window tracks
 * (registered or remembered for remount). Registrations beyond it evict the
 * oldest tracked entries, so an unbounded transcript costs bounded memory.
 */
export const PTAH_UI_TRACKED_KEY_CAP = 512;

/** One tracked block identity in the window's registry. */
interface PtahUiLiveEntry {
  readonly key: string;
  /** Transcript order; higher means newer. */
  readonly orderKey: number;
  /**
   * Monotonic registration sequence. Breaks `orderKey` ties in favor of the
   * later registration, and survives `release`, so a remounted block keeps
   * its original position in the window instead of taking a fresh one.
   */
  readonly seq: number;
  /** True once `release` unregistered the block; released keys are never live. */
  readonly released: boolean;
}

/**
 * PtahUiLiveWindow — per-tab live window over `ptah-ui` transcript blocks
 * (TASK_2026_610, decision 10 / L-5).
 *
 * `register` returns a signal that is `true` while the block is among the
 * `PTAH_UI_LIVE_CAP` registered keys with the highest `orderKey` (the newest
 * blocks); blocks outside the window render as inert snapshots. Ranking is
 * by `orderKey` alone, so out-of-order registration never matters except as
 * a tie-break (later registration wins).
 *
 * Provided by the transcript-scoped component — NOT `providedIn: 'root'` —
 * so each chat tab owns its own window, mirroring the component-scoped
 * `TranscriptRetentionService` precedent.
 *
 * `release` unregisters a destroyed block: its key stops counting as live
 * (the next-newest block takes the slot) but stays tracked until the
 * `PTAH_UI_TRACKED_KEY_CAP` eviction, so a re-registration — the remount
 * case — keeps the block's original position.
 *
 * Pure signal graph: no timers, no observers, no DOM access.
 */
@Injectable()
export class PtahUiLiveWindow {
  /**
   * Tracked entries in registration-sequence order, so the array's front is
   * always the oldest entry and eviction is a front splice.
   */
  private readonly _entries = signal<readonly PtahUiLiveEntry[]>([]);

  /** Live keys: the `PTAH_UI_LIVE_CAP` highest-`orderKey` registered keys. */
  private readonly _liveKeys = computed<ReadonlySet<string>>(() => {
    const registered = this._entries().filter((entry) => !entry.released);
    if (registered.length <= PTAH_UI_LIVE_CAP) {
      return new Set(registered.map((entry) => entry.key));
    }
    const ranked = [...registered].sort(
      (left, right) => right.orderKey - left.orderKey || right.seq - left.seq,
    );
    return new Set(ranked.slice(0, PTAH_UI_LIVE_CAP).map((entry) => entry.key));
  });

  /**
   * Live signals handed out by `register`, dropped by `release`. Bounded by
   * the mounted block count (a block releases on destroy).
   */
  private readonly _signals = new Map<string, Signal<boolean>>();

  /** Monotonic registration sequence counter. */
  private _nextSeq = 0;

  /**
   * Register (or re-register) the block `key` and return its live signal:
   * `true` while the block is among the `PTAH_UI_LIVE_CAP` registered keys
   * with the highest `orderKey`. Re-registering a released key keeps its
   * original entry position, covering the remount case.
   */
  register(key: string, orderKey: number): Signal<boolean> {
    const existing = this._signals.get(key);
    if (existing) {
      this.upsert(key, orderKey);
      return existing;
    }
    const live = computed<boolean>(() => this._liveKeys().has(key));
    this._signals.set(key, live);
    this.upsert(key, orderKey);
    return live;
  }

  /**
   * Unregister a destroyed block. Its key stops counting as live and the
   * next-newest block takes the slot, but the entry stays tracked for remount
   * position keeping. Releasing an unknown or already-released key is a no-op.
   */
  release(key: string): void {
    if (!this._signals.delete(key)) {
      return;
    }
    const entries = [...this._entries()];
    const index = entries.findIndex((entry) => entry.key === key);
    if (index < 0) {
      return;
    }
    entries[index] = { ...entries[index]!, released: true };
    this._entries.set(entries);
  }

  /**
   * Number of keys currently live. Read-only test seam for the instrumented
   * live-cap invariant (decision 10); no production caller.
   */
  liveCount(): number {
    return this._liveKeys().size;
  }

  private upsert(key: string, orderKey: number): void {
    const entries = [...this._entries()];
    const index = entries.findIndex((entry) => entry.key === key);
    if (index >= 0) {
      // Re-registration keeps the original entry (and its seq position);
      // only the order key and the released flag move.
      entries[index] = { ...entries[index]!, orderKey, released: false };
    } else {
      entries.push({ key, orderKey, seq: ++this._nextSeq, released: false });
      // Bound tracked memory: drop the oldest (lowest-seq) entries from the
      // front. The pushed entry has the highest seq, so it is never evicted
      // by its own registration.
      const overflow = entries.length - PTAH_UI_TRACKED_KEY_CAP;
      if (overflow > 0) {
        entries.splice(0, overflow);
      }
    }
    this._entries.set(entries);
  }
}
