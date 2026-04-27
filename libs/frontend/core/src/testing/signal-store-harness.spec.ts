/**
 * Smoke tests for `makeSignalStoreHarness` — verifies signal discovery,
 * snapshot construction, and microtask flushing against a real signal store.
 */

import { Injectable, signal, computed } from '@angular/core';
import { makeSignalStoreHarness } from './signal-store-harness';

interface TinyStoreState {
  count: number;
  doubled: number;
  label: string;
}

@Injectable()
class TinyStore {
  private readonly _count = signal(0);
  private readonly _label = signal('init');

  readonly count = this._count.asReadonly();
  readonly label = this._label.asReadonly();
  readonly doubled = computed(() => this._count() * 2);

  increment(): void {
    this._count.update((n) => n + 1);
  }

  async setLabelAsync(next: string): Promise<void> {
    await Promise.resolve();
    this._label.set(next);
  }
}

describe('makeSignalStoreHarness', () => {
  it('discovers signals and reads a snapshot of their current values', () => {
    const store = new TinyStore();
    const harness = makeSignalStoreHarness<TinyStoreState>(store);

    expect(harness.signalNames).toEqual(
      expect.arrayContaining(['count', 'label', 'doubled']),
    );

    const snap = harness.read();
    expect(snap).toEqual({ count: 0, label: 'init', doubled: 0 });
  });

  it('re-reads signals on every read() / signal() call (not a frozen snapshot)', () => {
    const store = new TinyStore();
    const harness = makeSignalStoreHarness<TinyStoreState>(store);

    expect(harness.signal('count')).toBe(0);
    store.increment();
    store.increment();
    expect(harness.signal('count')).toBe(2);
    expect(harness.signal('doubled')).toBe(4);
    expect(harness.read().count).toBe(2);
  });

  it('flush() awaits microtasks so async state mutations become visible', async () => {
    const store = new TinyStore();
    const harness = makeSignalStoreHarness<TinyStoreState>(store);

    const pending = store.setLabelAsync('done');
    await harness.flush();
    await pending;

    expect(harness.signal('label')).toBe('done');
  });
});
