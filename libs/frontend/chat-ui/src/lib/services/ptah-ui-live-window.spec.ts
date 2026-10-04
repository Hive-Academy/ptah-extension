/**
 * PtahUiLiveWindow — per-tab live-window registry (TASK_2026_610 Batch B5a).
 * Verifies the decision-10 invariant (live blocks per tab ≤ 8 after every
 * registration), orderKey ranking (in-order and out-of-order arrivals),
 * remount position keeping across release/re-register, released keys not
 * counting toward the live window, and the 512 tracked-key cap's eviction.
 */

import type { Signal } from '@angular/core';
import {
  PTAH_UI_LIVE_CAP,
  PTAH_UI_TRACKED_KEY_CAP,
  PtahUiLiveWindow,
} from './ptah-ui-live-window';

/**
 * Registers `block-1`..`block-<count>` with orderKey = index, asserting
 * `liveCount() <= 8` after each registration, and returns their signals.
 */
function registerInOrder(
  service: PtahUiLiveWindow,
  count: number,
): Map<string, Signal<boolean>> {
  const signals = new Map<string, Signal<boolean>>();
  for (let i = 1; i <= count; i++) {
    signals.set(`block-${i}`, service.register(`block-${i}`, i));
    expect(service.liveCount()).toBeLessThanOrEqual(PTAH_UI_LIVE_CAP);
  }
  return signals;
}

describe('PtahUiLiveWindow', () => {
  it('keeps liveCount() <= 8 after each of 12 in-order registrations and keeps the 8 newest live', () => {
    const service = new PtahUiLiveWindow();
    const signals = registerInOrder(service, 12);

    expect(service.liveCount()).toBe(PTAH_UI_LIVE_CAP);
    // Blocks 1-4 fall outside the window; the 8 newest (5-12) are live.
    for (let i = 1; i <= 12; i++) {
      expect(signals.get(`block-${i}`)?.()).toBe(i >= 5);
    }
  });

  it('ranks by orderKey, not registration arrival order', () => {
    const service = new PtahUiLiveWindow();
    // Arrival order deliberately shuffled relative to orderKey.
    const arrivals: ReadonlyArray<{ key: string; orderKey: number }> = [
      { key: 'block-7', orderKey: 7 },
      { key: 'block-2', orderKey: 2 },
      { key: 'block-11', orderKey: 11 },
      { key: 'block-4', orderKey: 4 },
      { key: 'block-12', orderKey: 12 },
      { key: 'block-1', orderKey: 1 },
      { key: 'block-9', orderKey: 9 },
      { key: 'block-3', orderKey: 3 },
      { key: 'block-10', orderKey: 10 },
      { key: 'block-5', orderKey: 5 },
      { key: 'block-8', orderKey: 8 },
      { key: 'block-6', orderKey: 6 },
    ];
    const signals = new Map<string, Signal<boolean>>();
    for (const { key, orderKey } of arrivals) {
      signals.set(key, service.register(key, orderKey));
      expect(service.liveCount()).toBeLessThanOrEqual(PTAH_UI_LIVE_CAP);
    }

    expect(service.liveCount()).toBe(PTAH_UI_LIVE_CAP);
    for (const { key, orderKey } of arrivals) {
      expect(signals.get(key)?.()).toBe(orderKey >= 5);
    }
  });

  it('does not count a released key toward the live blocks', () => {
    const service = new PtahUiLiveWindow();
    const signals = registerInOrder(service, 3);

    expect(service.liveCount()).toBe(3);
    service.release('block-2');
    expect(service.liveCount()).toBe(2);
    expect(signals.get('block-2')?.()).toBe(false);
    expect(signals.get('block-1')?.()).toBe(true);
    expect(signals.get('block-3')?.()).toBe(true);

    // Releasing an unknown or already-released key is a no-op.
    service.release('block-2');
    service.release('never-registered');
    expect(service.liveCount()).toBe(2);
  });

  it('hands a released live slot to the next-newest block', () => {
    const service = new PtahUiLiveWindow();
    const signals = registerInOrder(service, 12);

    service.release('block-6');
    expect(service.liveCount()).toBe(PTAH_UI_LIVE_CAP);
    expect(signals.get('block-6')?.()).toBe(false);
    // block-4 (the newest block below the window) takes the slot.
    expect(signals.get('block-4')?.()).toBe(true);
    expect(signals.get('block-5')?.()).toBe(true);
  });

  it("keeps a released key's position when re-registered (remount case)", () => {
    const service = new PtahUiLiveWindow();
    const signals = registerInOrder(service, 12);

    // Destroy block 6 (live) and block 1 (snapshot); block 4 takes the slot.
    service.release('block-6');
    service.release('block-1');
    expect(service.liveCount()).toBe(PTAH_UI_LIVE_CAP);
    expect(signals.get('block-4')?.()).toBe(true);

    // Remount block 6 with its original orderKey: it keeps its position
    // (live again) and block 4 drops back to a snapshot.
    const remountedSix = service.register('block-6', 6);
    expect(remountedSix()).toBe(true);
    expect(signals.get('block-4')?.()).toBe(false);
    expect(service.liveCount()).toBe(PTAH_UI_LIVE_CAP);

    // Remount block 1 with its original orderKey: it stays a snapshot.
    const remountedOne = service.register('block-1', 1);
    expect(remountedOne()).toBe(false);
    expect(service.liveCount()).toBe(PTAH_UI_LIVE_CAP);

    // Block 12 (newest) survives a destroy/recreate cycle as live.
    service.release('block-12');
    const remountedTwelve = service.register('block-12', 12);
    expect(remountedTwelve()).toBe(true);
    expect(service.liveCount()).toBe(PTAH_UI_LIVE_CAP);

    // Re-registering a still-registered key returns the same signal and
    // changes nothing.
    expect(service.register('block-12', 12)).toBe(remountedTwelve);
    expect(service.liveCount()).toBe(PTAH_UI_LIVE_CAP);
  });

  it('caps tracked keys at 512 and evicts the oldest entry when exceeded', () => {
    const service = new PtahUiLiveWindow();
    // The FIRST registration carries the highest orderKey, so it is live
    // while also being the oldest tracked entry (lowest registration seq).
    const first = service.register('block-first', 1000);
    expect(first()).toBe(true);

    const signals = registerInOrder(service, PTAH_UI_TRACKED_KEY_CAP - 1);
    expect(service.liveCount()).toBe(PTAH_UI_LIVE_CAP);
    // Live: block-first (orderKey 1000) plus block-511..block-505 (the seven
    // newest below it); block-504 is the first snapshot below the window.
    expect(signals.get('block-505')?.()).toBe(true);
    expect(signals.get('block-504')?.()).toBe(false);

    // The 513th distinct key evicts the oldest tracked entry (block-first),
    // which drops out of the live window and hands its slot to block-504.
    const overflow = service.register('block-overflow', 0);
    expect(overflow()).toBe(false);
    expect(first()).toBe(false);
    expect(signals.get('block-504')?.()).toBe(true);
    expect(service.liveCount()).toBe(PTAH_UI_LIVE_CAP);
  });
});
