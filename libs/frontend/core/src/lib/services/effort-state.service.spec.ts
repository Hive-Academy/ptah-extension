/**
 * EffortStateService specs — RPC-backed reasoning-effort persistence.
 *
 * Coverage:
 *   - Initial state after construction triggers a `config:effort-get` RPC
 *     and populates `currentEffort` + `isLoaded`.
 *   - `setEffort` performs an optimistic update and persists via
 *     `config:effort-set`.
 *   - `setEffort` rolls back to the previous value when the RPC fails.
 *   - `setEffort` rolls back when the RPC throws.
 *
 * Helpers:
 *   - `createMockRpcService` / `rpcSuccess` / `rpcError` from
 *     `@ptah-extension/core/testing` — no real `ClaudeRpcService` is
 *     instantiated (avoids `VSCodeService` + `AppStateManager` DI pulls).
 *   - `makeSignalStoreHarness` reads `currentEffort` + `isLoaded` as a
 *     snapshot for assertions.
 *
 * Zoneless note: `setEffort` awaits promise chains only; no change detection
 * or `fakeAsync` is needed.
 */

import { TestBed } from '@angular/core/testing';
import type { EffortLevel } from '@ptah-extension/shared';
import { ClaudeRpcService } from './claude-rpc.service';
import { EffortStateService } from './effort-state.service';
import {
  createMockRpcService,
  makeSignalStoreHarness,
  rpcError,
  rpcSuccess,
  type MockRpcService,
} from '../../testing';

interface EffortStoreState {
  currentEffort: EffortLevel | undefined;
  isLoaded: boolean;
}

describe('EffortStateService', () => {
  let rpc: MockRpcService;

  function createService(): EffortStateService {
    TestBed.configureTestingModule({
      providers: [
        EffortStateService,
        { provide: ClaudeRpcService, useValue: rpc },
      ],
    });
    return TestBed.inject(EffortStateService);
  }

  beforeEach(() => {
    rpc = createMockRpcService();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('initial load (config:effort-get)', () => {
    it('populates currentEffort from the backend response and marks isLoaded=true', async () => {
      rpc.call.mockImplementation(async (method: string) => {
        if (method === 'config:effort-get') {
          return rpcSuccess({ effort: 'high' as EffortLevel });
        }
        return rpcSuccess(undefined);
      });

      const service = createService();
      const harness = makeSignalStoreHarness<EffortStoreState>(service);

      await harness.flush();

      expect(rpc.call).toHaveBeenCalledWith('config:effort-get', {});
      expect(harness.read()).toEqual({
        currentEffort: 'high',
        isLoaded: true,
      });
    });

    it('marks isLoaded=true and leaves currentEffort undefined when the RPC fails', async () => {
      rpc.call.mockResolvedValue(rpcError('backend down'));

      const service = createService();
      const harness = makeSignalStoreHarness<EffortStoreState>(service);

      await harness.flush();

      expect(harness.read()).toEqual({
        currentEffort: undefined,
        isLoaded: true,
      });
    });

    it('marks isLoaded=true even when the initial RPC throws', async () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();
      rpc.call.mockRejectedValueOnce(new Error('network blown'));

      const service = createService();
      const harness = makeSignalStoreHarness<EffortStoreState>(service);

      await harness.flush();

      expect(harness.signal('isLoaded')).toBe(true);
      expect(harness.signal('currentEffort')).toBeUndefined();
      consoleError.mockRestore();
    });
  });

  describe('setEffort()', () => {
    it('performs an optimistic update and persists via config:effort-set', async () => {
      rpc.call.mockResolvedValue(rpcSuccess({ effort: undefined }));
      const service = createService();
      const harness = makeSignalStoreHarness<EffortStoreState>(service);
      await harness.flush();

      rpc.call.mockResolvedValueOnce(rpcSuccess({ success: true }));
      const pending = service.setEffort('max');

      // Optimistic: value is visible before the RPC resolves.
      expect(harness.signal('currentEffort')).toBe('max');

      await expect(pending).resolves.toBe(true);

      expect(rpc.call).toHaveBeenCalledWith('config:effort-set', {
        effort: 'max',
        sessionId: null,
      });
      expect(harness.signal('currentEffort')).toBe('max');
    });

    it('rolls back to the previous value when the persistence RPC reports failure', async () => {
      rpc.call.mockResolvedValue(rpcSuccess({ effort: 'low' as EffortLevel }));
      const service = createService();
      const harness = makeSignalStoreHarness<EffortStoreState>(service);
      await harness.flush();
      expect(harness.signal('currentEffort')).toBe('low');

      const consoleError = jest.spyOn(console, 'error').mockImplementation();
      rpc.call.mockResolvedValueOnce(rpcError('rejected'));

      await expect(service.setEffort('high')).resolves.toBe(false);

      expect(harness.signal('currentEffort')).toBe('low');
      consoleError.mockRestore();
    });

    it('rolls back when the persistence RPC throws', async () => {
      rpc.call.mockResolvedValue(
        rpcSuccess({ effort: 'medium' as EffortLevel }),
      );
      const service = createService();
      const harness = makeSignalStoreHarness<EffortStoreState>(service);
      await harness.flush();
      expect(harness.signal('currentEffort')).toBe('medium');

      const consoleError = jest.spyOn(console, 'error').mockImplementation();
      rpc.call.mockRejectedValueOnce(new Error('offline'));

      await expect(service.setEffort('low')).resolves.toBe(false);

      expect(harness.signal('currentEffort')).toBe('medium');
      consoleError.mockRestore();
    });

    it('supports clearing effort back to undefined (SDK default)', async () => {
      rpc.call.mockResolvedValue(rpcSuccess({ effort: 'high' as EffortLevel }));
      const service = createService();
      const harness = makeSignalStoreHarness<EffortStoreState>(service);
      await harness.flush();

      rpc.call.mockResolvedValueOnce(rpcSuccess({ success: true }));
      await service.setEffort(undefined);

      expect(rpc.call).toHaveBeenCalledWith('config:effort-set', {
        effort: undefined,
        sessionId: null,
      });
      expect(harness.signal('currentEffort')).toBeUndefined();
    });
  });

  describe('read/write ordering', () => {
    function deferred(): { promise: Promise<void>; resolve: () => void } {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => (resolve = r));
      return { promise, resolve };
    }

    /**
     * Fake backend: `config:effort-set` stores the value, `config:effort-get` returns the stored
     * value as of the call. A queued gate holds the next call's response until it is released.
     */
    function fakeBackend(initial: EffortLevel | undefined) {
      const state = { stored: initial, gates: [] as Promise<void>[] };
      rpc.call.mockImplementation(async (method: string, params: unknown) => {
        const gate = state.gates.shift();
        if (method === 'config:effort-set') {
          if (gate) await gate;
          state.stored = (params as { effort: EffortLevel | undefined }).effort;
          return rpcSuccess({ success: true });
        }
        const snapshot = state.stored;
        if (gate) await gate;
        return rpcSuccess({ effort: snapshot });
      });
      return state;
    }

    function effortGets(): number {
      return rpc.call.mock.calls.filter(([m]) => m === 'config:effort-get')
        .length;
    }

    it('drops a read that started before a write and re-reads after it', async () => {
      const backend = fakeBackend('low');
      const service = createService();
      const harness = makeSignalStoreHarness<EffortStoreState>(service);
      await harness.flush();

      const staleRead = deferred();
      backend.gates.push(staleRead.promise);
      const refresh = service.refreshEffort();

      await expect(service.setEffort('high')).resolves.toBe(true);
      staleRead.resolve();
      await refresh;
      await harness.flush();

      expect(harness.signal('currentEffort')).toBe('high');
      expect(effortGets()).toBe(3);
    });

    it('defers the re-read of a read that overlaps a pending write until the write ends', async () => {
      const backend = fakeBackend('low');
      const service = createService();
      const harness = makeSignalStoreHarness<EffortStoreState>(service);
      await harness.flush();

      const write = deferred();
      backend.gates.push(write.promise);
      const pendingWrite = service.setEffort('max');

      await service.refreshEffort();
      expect(harness.signal('currentEffort')).toBe('max');
      expect(effortGets()).toBe(2);

      write.resolve();
      await pendingWrite;
      await harness.flush();

      expect(harness.signal('currentEffort')).toBe('max');
      expect(effortGets()).toBe(3);
    });

    it('takes the backend value on the re-read, not the value of the overlapping write', async () => {
      // The write lands in a slot the backend no longer resolves to (e.g. the old provider's).
      const backend = fakeBackend('low');
      const service = createService();
      const harness = makeSignalStoreHarness<EffortStoreState>(service);
      await harness.flush();

      const staleRead = deferred();
      backend.gates.push(staleRead.promise);
      const refresh = service.refreshEffort();

      const write = service.setEffort('high');
      await write;
      backend.stored = 'medium';
      staleRead.resolve();
      await refresh;
      await harness.flush();

      expect(harness.signal('currentEffort')).toBe('medium');
    });

    it('restores the previous effort when the write fails, even with a read in flight', async () => {
      fakeBackend('low');
      const service = createService();
      const harness = makeSignalStoreHarness<EffortStoreState>(service);
      await harness.flush();

      const consoleError = jest.spyOn(console, 'error').mockImplementation();
      const staleRead = deferred();
      rpc.call.mockImplementationOnce(async () => {
        await staleRead.promise;
        return rpcSuccess({ effort: 'medium' as EffortLevel });
      });
      const refresh = service.refreshEffort();
      rpc.call.mockResolvedValueOnce(rpcError('rejected'));

      await expect(service.setEffort('high')).resolves.toBe(false);
      expect(harness.signal('currentEffort')).toBe('low');
      staleRead.resolve();
      await refresh;
      await harness.flush();

      expect(harness.signal('currentEffort')).toBe('low');
      consoleError.mockRestore();
    });

    it('applies only the newest of two overlapping reads, in either resolve order', async () => {
      const backend = fakeBackend('low');
      const service = createService();
      const harness = makeSignalStoreHarness<EffortStoreState>(service);
      await harness.flush();

      const first = deferred();
      const second = deferred();
      backend.gates.push(first.promise);
      const firstRead = service.refreshEffort();
      backend.stored = 'high';
      backend.gates.push(second.promise);
      const secondRead = service.refreshEffort();

      second.resolve();
      await secondRead;
      first.resolve();
      await firstRead;

      expect(harness.signal('currentEffort')).toBe('high');
    });

    it('marks isLoaded=true when the initial read is dropped by a write', async () => {
      const backend = fakeBackend('low');
      const initialRead = deferred();
      backend.gates.push(initialRead.promise);
      const service = createService();
      const harness = makeSignalStoreHarness<EffortStoreState>(service);

      await service.setEffort('high');
      initialRead.resolve();
      await harness.flush();
      await harness.flush();

      expect(harness.read()).toEqual({ currentEffort: 'high', isLoaded: true });
    });

    it('applies a read that starts after the write finished', async () => {
      const backend = fakeBackend('low');
      const service = createService();
      const harness = makeSignalStoreHarness<EffortStoreState>(service);
      await harness.flush();

      await service.setEffort('high');
      backend.stored = 'medium';
      await service.refreshEffort();

      expect(harness.signal('currentEffort')).toBe('medium');
    });
  });
});
