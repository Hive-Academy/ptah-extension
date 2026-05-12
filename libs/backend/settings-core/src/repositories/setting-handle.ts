import type { IDisposable } from '@ptah-extension/platform-core';

/**
 * Typed accessor for a single application setting.
 *
 * Provides a clean, prose-readable API:
 *   const effort = reasoningSettings.effort;
 *   const current = effort.get();
 *   await effort.set('high');
 *   const sub = effort.watch((v) => console.log('effort changed to', v));
 *   sub.dispose();
 */
export interface SettingHandle<T> {
  /** Read the current value. Returns the definition default if nothing is persisted. */
  get(): T;

  /** Persist a new value. Validates against the definition's Zod schema. */
  set(value: T): Promise<void>;

  /**
   * Subscribe to value changes.
   * The callback fires immediately with the current value, then on every change.
   * Dispose the returned handle to unsubscribe.
   */
  watch(cb: (value: T) => void): IDisposable;
}
