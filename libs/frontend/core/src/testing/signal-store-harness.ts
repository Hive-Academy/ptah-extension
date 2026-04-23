import { isSignal } from '@angular/core';

/**
 * `makeSignalStoreHarness` — read-only snapshot view over a signal-based store.
 *
 * Frontend services in `libs/frontend/core` (e.g. `AppStateManager`,
 * `EffortStateService`) expose read-only signals — functions that return the
 * current value when called. Tests commonly want:
 *
 *   1. A point-in-time snapshot of the store's public state (to assert against).
 *   2. A way to flush pending microtasks (for tests that trigger async effects).
 *
 * This harness walks the store instance once at construction, discovers every
 * property whose value is a zero-arg function (i.e. a signal), and exposes
 * a `read()` helper that builds a fresh snapshot each call. Individual signals
 * remain accessible via `signal('name')` for targeted assertions.
 *
 * The harness is *not* a proxy — signals are re-read each time `read()` or
 * `signal(name)` is called, so callers always see the current value.
 *
 * @example
 * ```ts
 * const store = TestBed.inject(AppStateManager);
 * const harness = makeSignalStoreHarness(store);
 *
 * store.setCurrentView('analytics');
 * expect(harness.read().currentView).toBe('analytics');
 *
 * // Targeted access
 * expect(harness.signal('isLoading')).toBe(false);
 *
 * // Async flush
 * await harness.flush();
 * ```
 */

export interface SignalStoreHarness<TState> {
  /**
   * Snapshot every discovered signal on the store. Returns a plain object
   * whose keys mirror the signal names and whose values are the current
   * signal outputs.
   */
  read(): TState;

  /**
   * Read a single signal by name. Throws if the name is not a known signal.
   */
  signal<K extends keyof TState>(name: K): TState[K];

  /**
   * Advance pending microtasks. Equivalent to `await Promise.resolve()` — use
   * when the store has effects that resolve on the microtask queue (e.g. after
   * an awaited RPC call in `setEffort`).
   */
  flush(): Promise<void>;

  /** Names of every signal discovered on the store. */
  readonly signalNames: readonly (keyof TState)[];
}

/**
 * Build a read-only snapshot harness around a signal-based store instance.
 *
 * @param store - The store instance (e.g. `TestBed.inject(AppStateManager)`).
 * @param options - Optional include/exclude filters for signal discovery.
 */
export function makeSignalStoreHarness<TState extends object>(
  store: object,
  options?: {
    /** If provided, only these property names are treated as signals. */
    include?: readonly (keyof TState)[];
    /** Property names to skip (e.g. methods that happen to be zero-arg). */
    exclude?: readonly string[];
  },
): SignalStoreHarness<TState> {
  const excluded = new Set<string>(options?.exclude ?? []);

  const candidateNames =
    options?.include !== undefined
      ? (options.include as readonly string[])
      : discoverSignalNames(store, excluded);

  const signalNames = candidateNames as readonly (keyof TState)[];

  function readSignal<K extends keyof TState>(name: K): TState[K] {
    const fn = (store as Record<string, unknown>)[name as string];
    if (typeof fn !== 'function') {
      throw new Error(
        `[signal-store-harness] "${String(name)}" is not a signal on the store`,
      );
    }
    return (fn as () => TState[K])();
  }

  return {
    signalNames,
    read(): TState {
      const snapshot = {} as TState;
      for (const name of signalNames) {
        (snapshot as Record<string, unknown>)[name as string] =
          readSignal(name);
      }
      return snapshot;
    },
    signal<K extends keyof TState>(name: K): TState[K] {
      return readSignal(name);
    },
    async flush(): Promise<void> {
      // Two turns: one to let awaited promises settle, one to flush any
      // follow-up microtasks those handlers enqueue.
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

/**
 * Walk the store's own + prototype keys and return everything that looks like
 * a signal: a zero-arg function that is not a constructor and is not named in
 * the exclusion set. Private fields (prefixed with `_`) are skipped since
 * convention in this codebase is to expose read-only signals via `asReadonly`.
 */
function discoverSignalNames(
  store: object,
  excluded: ReadonlySet<string>,
): string[] {
  const names = new Set<string>();

  // Own enumerable properties (covers `readonly foo = signal(0).asReadonly()`
  // assignments in the class body).
  for (const key of Object.keys(store)) {
    if (shouldCollect(store, key, excluded)) {
      names.add(key);
    }
  }

  // Prototype chain (covers computed getters declared on the class prototype,
  // though in this codebase most signals live as own instance properties).
  let proto: object | null = Object.getPrototypeOf(store);
  while (proto && proto !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key === 'constructor') continue;
      if (shouldCollect(store, key, excluded)) {
        names.add(key);
      }
    }
    proto = Object.getPrototypeOf(proto);
  }

  return [...names];
}

function shouldCollect(
  store: object,
  key: string,
  excluded: ReadonlySet<string>,
): boolean {
  if (excluded.has(key)) return false;
  if (key.startsWith('_')) return false;
  const value = (store as Record<string, unknown>)[key];
  // `isSignal` is the authoritative check — it recognises `signal()`,
  // `computed()`, and `.asReadonly()` wrappers. Regular class methods
  // (e.g. `increment()`, even if zero-arg) are correctly rejected.
  return typeof value === 'function' && isSignal(value);
}
