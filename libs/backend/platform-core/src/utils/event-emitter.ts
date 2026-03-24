/**
 * Simple event emitter utility for implementing IEvent<T>.
 *
 * Platform implementations use this to create events that match IEvent<T>.
 * NOT a public API — internal utility for platform implementations.
 */

import type { IEvent, IDisposable } from '../types/platform.types';

/**
 * Creates an IEvent<T> + fire function pair.
 *
 * Usage in platform implementations:
 *   const [onDidChange, fireChange] = createEvent<string>();
 *   // Expose onDidChange as the IEvent
 *   // Call fireChange(data) when the event occurs
 */
export function createEvent<T>(): [IEvent<T>, (data: T) => void] {
  const listeners = new Set<(e: T) => void>();

  const event: IEvent<T> = (listener: (e: T) => void): IDisposable => {
    listeners.add(listener);
    return {
      dispose() {
        listeners.delete(listener);
      },
    };
  };

  const fire = (data: T): void => {
    for (const listener of listeners) {
      try {
        listener(data);
      } catch {
        // Swallow listener errors to prevent one listener from breaking others
      }
    }
  };

  return [event, fire];
}
