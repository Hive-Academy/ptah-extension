/**
 * StreamingSurfaceRegistry.
 *
 * Owns the `SurfaceId → SurfaceAdapter` relation. A "surface" is a non-tab
 * consumer of the streaming pipeline (setup-wizard analysis phase, harness
 * builder operation). Each surface adapter exposes a per-consumer state
 * slot via `getState`/`setState` so the canonical `StreamingAccumulatorCore`
 * (in `@ptah-extension/chat-streaming`) can mutate it without knowing
 * anything about the consumer's storage layout.
 *
 * Design notes:
 *   - Signal-backed Map for testability — consumers and tests can assert
 *     on `size()` without poking private fields.
 *   - Re-registering an existing surface id REPLACES the adapter (idempotent
 *     bind during component re-mount).
 *   - Unregistering a non-existent id is a graceful no-op.
 */

import { Injectable, computed, signal } from '@angular/core';
import type { SurfaceId } from '@ptah-extension/chat-state';
import type { StreamingState } from '@ptah-extension/chat-types';

/**
 * Adapter contract every surface satisfies. The accumulator core reads
 * the current state via `getState()` and writes the swapped state via
 * `setState(newState)` (currently used only on `compaction_complete`,
 * which mints a fresh `StreamingState` object — see
 * `AccumulatorResult.replacementState`).
 *
 * Implementations are typically backed by a signal:
 *   ```ts
 *   const _state = signal<StreamingState>(createEmptyStreamingState());
 *   surfaceRegistry.register(surfaceId, () => _state(), (next) => _state.set(next));
 *   ```
 */
export interface SurfaceAdapter {
  getState(): StreamingState;
  setState(state: StreamingState): void;
}

@Injectable({ providedIn: 'root' })
export class StreamingSurfaceRegistry {
  private readonly _byId = signal<ReadonlyMap<SurfaceId, SurfaceAdapter>>(
    new Map(),
  );
  private readonly _interactive = signal<ReadonlySet<SurfaceId>>(new Set());

  /** Total number of registered surfaces. */
  readonly size = computed(() => this._byId().size);

  /** All registered surface ids, snapshot. */
  readonly surfaces = computed<readonly SurfaceId[]>(() =>
    Array.from(this._byId().keys()),
  );

  /**
   * Register a surface adapter. If the surface id is already registered,
   * the previous adapter is replaced (component re-mount idempotency).
   *
   * `options.interactive` (default false) marks a surface as a permission /
   * AskUserQuestion target. Interactive surfaces (the harness workflow
   * surface) keep prompts alive and receive surface-attached prompt targets
   * via `StreamRouter`; non-interactive surfaces (wizard/harness analysis)
   * keep the auto-deny / auto-answer full-auto behavior.
   */
  register(
    surfaceId: SurfaceId,
    getState: () => StreamingState,
    setState: (state: StreamingState) => void,
    options?: { interactive?: boolean },
  ): void {
    const adapter: SurfaceAdapter = { getState, setState };
    this._byId.update((prev) => {
      const next = new Map(prev);
      next.set(surfaceId, adapter);
      return next;
    });
    const interactive = options?.interactive ?? false;
    this._interactive.update((prev) => {
      if (interactive === prev.has(surfaceId)) return prev;
      const next = new Set(prev);
      if (interactive) {
        next.add(surfaceId);
      } else {
        next.delete(surfaceId);
      }
      return next;
    });
  }

  /** True iff the surface was registered with `{ interactive: true }`. */
  isInteractive(surfaceId: SurfaceId): boolean {
    return this._interactive().has(surfaceId);
  }

  /**
   * Unregister a surface. No-op if the surface is not registered (close
   * race tolerance — the wizard/harness lifecycle may dispatch unregister
   * twice in some redux/stream-error paths).
   */
  unregister(surfaceId: SurfaceId): void {
    if (!this._byId().has(surfaceId)) return;
    this._byId.update((prev) => {
      const next = new Map(prev);
      next.delete(surfaceId);
      return next;
    });
    this._interactive.update((prev) => {
      if (!prev.has(surfaceId)) return prev;
      const next = new Set(prev);
      next.delete(surfaceId);
      return next;
    });
  }

  /**
   * Lookup the adapter for a surface. Returns null if unregistered. The
   * caller (typically `StreamRouter.routeStreamEventForSurface`) treats a
   * null return as "no live consumer for this event" and drops the event.
   */
  getAdapter(surfaceId: SurfaceId): SurfaceAdapter | null {
    return this._byId().get(surfaceId) ?? null;
  }
}
