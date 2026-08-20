import {
  Injectable,
  InjectionToken,
  Injector,
  Signal,
  Type,
  effect,
  inject,
  signal,
} from '@angular/core';
import type { LazyViewLoader } from '../tokens/lazy-view-components.token';

/**
 * Resolves {@link LazyViewLoader} tokens into a materialised component class,
 * but only once the consumer says the surface is actually wanted.
 *
 * `*ngComponentOutlet` needs a concrete `Type<unknown>` and cannot await a
 * Promise, so every deferred view needs an async wrapper. This is that wrapper.
 *
 * **Trigger-gated, not read-gated.** The dynamic import starts when `trigger()`
 * first evaluates to `true` — never when the returned signal is first read. A
 * read-gated implementation (a bare `computed()` that imports on first read)
 * would fire every registered loader on the first change-detection pass and undo
 * the entire code split.
 *
 * @see TASK_2026_187
 */
@Injectable({ providedIn: 'root' })
export class LazyViewService {
  private readonly injector = inject(Injector);

  /**
   * Returns a signal that stays `null` until `trigger()` first returns `true`,
   * then resolves to the loaded component class.
   *
   * - The loader fires **exactly once**, even if the trigger flips
   *   `true → false → true`.
   * - A token with no provider (optional injection misses) leaves the signal
   *   `null` forever and never throws — the caller's `@else` spinner stays up,
   *   which is the same behaviour the eager `inject(TOKEN, { optional: true })`
   *   form had.
   * - A rejected import is logged and leaves the signal `null`; it is not
   *   retried, because a failed chunk fetch is not something a re-render fixes.
   *
   * @param token Token bound to a `LazyViewLoader` via `useValue`.
   * @param trigger Reactive predicate. Read inside an `effect`, so any signal it
   *   touches is tracked; the loader fires on the first `true` reading.
   */
  resolveWhen(
    token: InjectionToken<LazyViewLoader>,
    trigger: () => boolean,
  ): Signal<Type<unknown> | null> {
    const resolved = signal<Type<unknown> | null>(null);
    const loader = this.injector.get(token, null, { optional: true });

    // No provider bound (e.g. a host that deliberately omits this surface):
    // stay null forever rather than throwing at template time.
    if (loader === null) {
      return resolved.asReadonly();
    }

    let started = false;
    effect(
      () => {
        // Reading the trigger inside the effect is what registers the
        // dependency — this is the gate. Do NOT hoist it into a computed that
        // the template reads, or the import becomes read-gated.
        if (!trigger() || started) {
          return;
        }
        started = true;
        void loader().then(
          (component) => resolved.set(component),
          (error: unknown) => {
            console.error(
              `[LazyViewService] Failed to load ${token.toString()}`,
              error,
            );
          },
        );
      },
      { injector: this.injector },
    );

    return resolved.asReadonly();
  }
}
