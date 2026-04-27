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

      await pending;

      expect(rpc.call).toHaveBeenCalledWith('config:effort-set', {
        effort: 'max',
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

      await service.setEffort('high');

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

      await service.setEffort('low');

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
      });
      expect(harness.signal('currentEffort')).toBeUndefined();
    });
  });
});
