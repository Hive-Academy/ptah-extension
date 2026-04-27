/**
 * StreamingSurfaceRegistry specs — TASK_2026_107 Phase 2.
 *
 * What is in scope:
 *   - register / unregister / getAdapter happy paths
 *   - Idempotent re-registration replaces the prior adapter (component
 *     re-mount) without growing `size()`
 *   - Unregistering a non-existent surface is a graceful no-op
 *   - `surfaces()` and `size()` computeds reflect the live map
 *   - `getAdapter` returns the SAME adapter object across reads (no clone)
 *   - Unregister-after-register-after-unregister cycles stay clean
 *
 * What is intentionally OUT of scope:
 *   - Stream routing through the registry (that's `stream-router.service.spec.ts`)
 *   - The accumulator core's interaction with the adapter (that's
 *     `accumulator-core.service.spec.ts`)
 */

import { TestBed } from '@angular/core/testing';
import {
  createEmptyStreamingState,
  type StreamingState,
} from '@ptah-extension/chat-types';
import { SurfaceId } from '@ptah-extension/chat-state';

import {
  StreamingSurfaceRegistry,
  type SurfaceAdapter,
} from './streaming-surface-registry.service';

// ---------- Helpers --------------------------------------------------------

interface SurfaceProbe {
  surfaceId: SurfaceId;
  state: StreamingState;
  getState: jest.Mock<StreamingState, []>;
  setState: jest.Mock<void, [StreamingState]>;
}

/**
 * Build a fresh probe with its own state slot. The probe's `setState` swaps
 * the slot reference (mirroring the chat tab path) so tests can assert the
 * adapter actually mutates the surface's owning state.
 */
function makeSurface(): SurfaceProbe {
  const probe: SurfaceProbe = {
    surfaceId: SurfaceId.create(),
    state: createEmptyStreamingState(),
    getState: jest.fn<StreamingState, []>(),
    setState: jest.fn<void, [StreamingState]>(),
  };
  probe.getState.mockImplementation(() => probe.state);
  probe.setState.mockImplementation((next) => {
    probe.state = next;
  });
  return probe;
}

// ---------- Suite ----------------------------------------------------------

describe('StreamingSurfaceRegistry (TASK_2026_107 Phase 2)', () => {
  let registry: StreamingSurfaceRegistry;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    registry = TestBed.inject(StreamingSurfaceRegistry);
  });

  // ---- register / getAdapter ----------------------------------------------

  describe('register() + getAdapter()', () => {
    it('registers a surface and returns the same adapter via getAdapter()', () => {
      const probe = makeSurface();
      registry.register(probe.surfaceId, probe.getState, probe.setState);

      const adapter = registry.getAdapter(probe.surfaceId);
      expect(adapter).not.toBeNull();
      expect(registry.size()).toBe(1);

      // Adapter delegates to the registered closures.
      adapter?.getState();
      expect(probe.getState).toHaveBeenCalledTimes(1);

      const swap = createEmptyStreamingState();
      adapter?.setState(swap);
      expect(probe.setState).toHaveBeenCalledWith(swap);
      expect(probe.state).toBe(swap);
    });

    it('returns the same adapter object across repeated getAdapter() reads (no clone)', () => {
      const probe = makeSurface();
      registry.register(probe.surfaceId, probe.getState, probe.setState);

      const a = registry.getAdapter(probe.surfaceId);
      const b = registry.getAdapter(probe.surfaceId);

      expect(a).not.toBeNull();
      expect(b).toBe(a);
    });

    it('register() with two distinct surface ids tracks both independently', () => {
      const p1 = makeSurface();
      const p2 = makeSurface();
      registry.register(p1.surfaceId, p1.getState, p1.setState);
      registry.register(p2.surfaceId, p2.getState, p2.setState);

      expect(registry.size()).toBe(2);
      expect(new Set(registry.surfaces())).toEqual(
        new Set([p1.surfaceId, p2.surfaceId]),
      );
      expect(registry.getAdapter(p1.surfaceId)).not.toBe(
        registry.getAdapter(p2.surfaceId),
      );
    });
  });

  // ---- Idempotent re-register --------------------------------------------

  describe('register() idempotency on re-register (component re-mount)', () => {
    it('re-registering an existing surface REPLACES the adapter without growing size()', () => {
      const surfaceId = SurfaceId.create();

      const firstProbe = makeSurface();
      registry.register(surfaceId, firstProbe.getState, firstProbe.setState);
      expect(registry.size()).toBe(1);

      const secondProbe = makeSurface();
      registry.register(surfaceId, secondProbe.getState, secondProbe.setState);
      expect(registry.size()).toBe(1);

      // The new adapter delegates to the second probe's closures.
      const adapter = registry.getAdapter(surfaceId);
      adapter?.getState();
      expect(secondProbe.getState).toHaveBeenCalledTimes(1);
      expect(firstProbe.getState).not.toHaveBeenCalled();

      const swap = createEmptyStreamingState();
      adapter?.setState(swap);
      expect(secondProbe.setState).toHaveBeenCalledWith(swap);
      expect(firstProbe.setState).not.toHaveBeenCalled();
    });

    it('re-register replaces the adapter object reference (callers must re-read getAdapter)', () => {
      const surfaceId = SurfaceId.create();
      const firstProbe = makeSurface();
      registry.register(surfaceId, firstProbe.getState, firstProbe.setState);
      const oldAdapter: SurfaceAdapter | null = registry.getAdapter(surfaceId);

      const secondProbe = makeSurface();
      registry.register(surfaceId, secondProbe.getState, secondProbe.setState);
      const newAdapter = registry.getAdapter(surfaceId);

      expect(newAdapter).not.toBeNull();
      expect(newAdapter).not.toBe(oldAdapter);
    });
  });

  // ---- unregister ---------------------------------------------------------

  describe('unregister()', () => {
    it('unregister() drops the surface and getAdapter() returns null afterward', () => {
      const probe = makeSurface();
      registry.register(probe.surfaceId, probe.getState, probe.setState);
      expect(registry.size()).toBe(1);

      registry.unregister(probe.surfaceId);

      expect(registry.size()).toBe(0);
      expect(registry.getAdapter(probe.surfaceId)).toBeNull();
      expect(registry.surfaces()).toEqual([]);
    });

    it('unregister() is a graceful no-op for a never-registered surface', () => {
      const ghostId = SurfaceId.create();

      expect(() => registry.unregister(ghostId)).not.toThrow();
      expect(registry.size()).toBe(0);
    });

    it('double-unregister is idempotent (close-race tolerance)', () => {
      const probe = makeSurface();
      registry.register(probe.surfaceId, probe.getState, probe.setState);
      registry.unregister(probe.surfaceId);

      expect(() => registry.unregister(probe.surfaceId)).not.toThrow();
      expect(registry.size()).toBe(0);
    });

    it('unregistering one of N surfaces leaves the others intact', () => {
      const p1 = makeSurface();
      const p2 = makeSurface();
      const p3 = makeSurface();
      registry.register(p1.surfaceId, p1.getState, p1.setState);
      registry.register(p2.surfaceId, p2.getState, p2.setState);
      registry.register(p3.surfaceId, p3.getState, p3.setState);

      registry.unregister(p2.surfaceId);

      expect(registry.size()).toBe(2);
      expect(new Set(registry.surfaces())).toEqual(
        new Set([p1.surfaceId, p3.surfaceId]),
      );
      expect(registry.getAdapter(p2.surfaceId)).toBeNull();
      expect(registry.getAdapter(p1.surfaceId)).not.toBeNull();
      expect(registry.getAdapter(p3.surfaceId)).not.toBeNull();
    });
  });

  // ---- register → unregister → register cycles ---------------------------

  describe('register → unregister → register cycles', () => {
    it('a fresh registration after unregister installs a new working adapter', () => {
      const surfaceId = SurfaceId.create();

      const first = makeSurface();
      registry.register(surfaceId, first.getState, first.setState);
      registry.unregister(surfaceId);
      expect(registry.getAdapter(surfaceId)).toBeNull();

      const second = makeSurface();
      registry.register(surfaceId, second.getState, second.setState);

      const adapter = registry.getAdapter(surfaceId);
      expect(adapter).not.toBeNull();
      adapter?.getState();
      expect(second.getState).toHaveBeenCalled();
      expect(first.getState).not.toHaveBeenCalled();
    });
  });

  // ---- computed signals reflect mutations --------------------------------

  describe('computed signals stay in sync with the underlying map', () => {
    it('size() and surfaces() update reactively after register/unregister', () => {
      expect(registry.size()).toBe(0);
      expect(registry.surfaces()).toEqual([]);

      const p = makeSurface();
      registry.register(p.surfaceId, p.getState, p.setState);
      expect(registry.size()).toBe(1);
      expect(registry.surfaces()).toEqual([p.surfaceId]);

      registry.unregister(p.surfaceId);
      expect(registry.size()).toBe(0);
      expect(registry.surfaces()).toEqual([]);
    });
  });
});
