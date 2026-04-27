/**
 * StreamingSurfaceRegistry — TASK_2026_107 Phase 2.
 *
 * Owns the `SurfaceId → SurfaceAdapter` relation. A "surface" is a non-tab
 * consumer of the streaming pipeline (setup-wizard analysis phase, harness
 * builder operation). Each surface adapter exposes a per-consumer state
 * slot via `getState`/`setState` so the canonical `StreamingAccumulatorCore`
 * (in `@ptah-extension/chat-streaming`) can mutate it without knowing
 * anything about the consumer's storage layout.
 *
 * Phase 2 ships this in shadow mode — `StreamRouter.routeStreamEventForSurface`
 * resolves adapters through this registry, but no caller (wizard / harness)
 * has been wired in yet. The registry has zero behaviour-affecting writes
 * until Phase 3 / Phase 4 lands.
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

  /** Total number of registered surfaces. */
  readonly size = computed(() => this._byId().size);

  /** All registered surface ids, snapshot. */
  readonly surfaces = computed<readonly SurfaceId[]>(() =>
    Array.from(this._byId().keys()),
  );

  /**
   * Register a surface adapter. If the surface id is already registered,
   * the previous adapter is replaced (component re-mount idempotency).
   */
  register(
    surfaceId: SurfaceId,
    getState: () => StreamingState,
    setState: (state: StreamingState) => void,
  ): void {
    const adapter: SurfaceAdapter = { getState, setState };
    this._byId.update((prev) => {
      const next = new Map(prev);
      next.set(surfaceId, adapter);
      return next;
    });
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
