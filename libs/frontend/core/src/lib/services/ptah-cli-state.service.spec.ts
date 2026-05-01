/**
 * PtahCliStateService specs — agent selection state for chat routing.
 *
 * Coverage:
 *   - Constructor triggers `ptahCli:list` RPC and populates `_agents`.
 *   - `enabledAgents` computed filters by `enabled` AND `status === 'available'`.
 *   - `selectedAgent` / `selectedAgentName` / `hasPtahCliSelected` computeds.
 *   - `selectAgent` / `clearSelection` mutate `selectedAgentId`.
 *   - `loadAgents` clears selection if selected agent becomes invalid after
 *     a refresh.
 *   - `loadAgents` concurrent-guard via `_isLoading`.
 *
 * Helpers:
 *   - `createMockRpcService` from `@ptah-extension/core/testing`.
 *   - `makeSignalStoreHarness` for snapshot assertions.
 */

import { TestBed } from '@angular/core/testing';
import type { PtahCliSummary } from '@ptah-extension/shared';
import { ClaudeRpcService } from './claude-rpc.service';
import { PtahCliStateService } from './ptah-cli-state.service';
import {
  createMockRpcService,
  makeSignalStoreHarness,
  rpcError,
  rpcSuccess,
  type MockRpcService,
} from '../../testing';

/** Minimal shape of the read-only signals exposed by PtahCliStateService. */
interface PtahCliStoreState {
  agents: readonly PtahCliSummary[];
  enabledAgents: readonly PtahCliSummary[];
  selectedAgentId: string | null;
  hasPtahCliSelected: boolean;
  selectedAgent: PtahCliSummary | null;
  selectedAgentName: string | null;
  isLoading: boolean;
  isLoaded: boolean;
}

function makeAgent(overrides: Partial<PtahCliSummary> = {}): PtahCliSummary {
  return {
    id: 'agent-a',
    name: 'Agent A',
    providerName: 'ptah',
    providerId: 'ptah',
    hasApiKey: true,
    status: 'available',
    enabled: true,
    modelCount: 1,
    ...overrides,
  };
}

describe('PtahCliStateService', () => {
  let rpc: MockRpcService;

  function createService(): PtahCliStateService {
    TestBed.configureTestingModule({
      providers: [
        PtahCliStateService,
        { provide: ClaudeRpcService, useValue: rpc },
      ],
    });
    return TestBed.inject(PtahCliStateService);
  }

  beforeEach(() => {
    rpc = createMockRpcService();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('initial load on construction', () => {
    it('calls ptahCli:list and populates agents', async () => {
      const agents = [
        makeAgent({ id: 'a', enabled: true, status: 'available' }),
        makeAgent({ id: 'b', enabled: false, status: 'available' }),
        makeAgent({ id: 'c', enabled: true, status: 'error' }),
      ];
      rpc.call.mockResolvedValueOnce(rpcSuccess({ agents }));

      const service = createService();
      const harness = makeSignalStoreHarness<PtahCliStoreState>(service);

      await harness.flush();

      expect(rpc.call).toHaveBeenCalledWith('ptahCli:list', {});
      expect(harness.signal('agents')).toHaveLength(3);
      expect(harness.signal('isLoaded')).toBe(true);
      expect(harness.signal('isLoading')).toBe(false);
    });

    it('marks isLoaded=true even when the RPC fails', async () => {
      rpc.call.mockResolvedValueOnce(rpcError('no agents'));

      const service = createService();
      const harness = makeSignalStoreHarness<PtahCliStoreState>(service);

      await harness.flush();

      expect(harness.signal('isLoaded')).toBe(true);
      expect(harness.signal('agents')).toEqual([]);
    });

    it('marks isLoaded=true when the RPC throws', async () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();
      rpc.call.mockRejectedValueOnce(new Error('boom'));

      const service = createService();
      const harness = makeSignalStoreHarness<PtahCliStoreState>(service);

      await harness.flush();

      expect(harness.signal('isLoaded')).toBe(true);
      consoleError.mockRestore();
    });
  });

  describe('computed derivations', () => {
    it('enabledAgents filters by enabled && status === "available"', async () => {
      const agents = [
        makeAgent({ id: 'ok', enabled: true, status: 'available' }),
        makeAgent({ id: 'disabled', enabled: false, status: 'available' }),
        makeAgent({ id: 'broken', enabled: true, status: 'error' }),
      ];
      rpc.call.mockResolvedValueOnce(rpcSuccess({ agents }));

      const service = createService();
      const harness = makeSignalStoreHarness<PtahCliStoreState>(service);
      await harness.flush();

      const enabled = harness.signal('enabledAgents');
      expect(enabled).toHaveLength(1);
      expect(enabled[0].id).toBe('ok');
    });

    it('selectedAgent / selectedAgentName / hasPtahCliSelected follow selectedAgentId', async () => {
      const agents = [
        makeAgent({ id: 'x', name: 'Alpha' }),
        makeAgent({ id: 'y', name: 'Beta' }),
      ];
      rpc.call.mockResolvedValueOnce(rpcSuccess({ agents }));

      const service = createService();
      const harness = makeSignalStoreHarness<PtahCliStoreState>(service);
      await harness.flush();

      expect(harness.signal('hasPtahCliSelected')).toBe(false);
      expect(harness.signal('selectedAgent')).toBeNull();
      expect(harness.signal('selectedAgentName')).toBeNull();

      service.selectAgent('y');
      expect(harness.signal('hasPtahCliSelected')).toBe(true);
      expect(harness.signal('selectedAgent')?.id).toBe('y');
      expect(harness.signal('selectedAgentName')).toBe('Beta');
    });

    it('selectedAgent is null when the selected id is not in the agents list', async () => {
      rpc.call.mockResolvedValueOnce(
        rpcSuccess({ agents: [makeAgent({ id: 'only' })] }),
      );

      const service = createService();
      const harness = makeSignalStoreHarness<PtahCliStoreState>(service);
      await harness.flush();

      service.selectAgent('missing');
      expect(harness.signal('hasPtahCliSelected')).toBe(true);
      expect(harness.signal('selectedAgent')).toBeNull();
      expect(harness.signal('selectedAgentName')).toBeNull();
    });
  });

  describe('mutations', () => {
    it('selectAgent(null) clears selection (same as clearSelection)', async () => {
      rpc.call.mockResolvedValueOnce(
        rpcSuccess({ agents: [makeAgent({ id: 'a' })] }),
      );
      const service = createService();
      const harness = makeSignalStoreHarness<PtahCliStoreState>(service);
      await harness.flush();

      service.selectAgent('a');
      expect(harness.signal('selectedAgentId')).toBe('a');

      service.clearSelection();
      expect(harness.signal('selectedAgentId')).toBeNull();

      service.selectAgent('a');
      service.selectAgent(null);
      expect(harness.signal('selectedAgentId')).toBeNull();
    });
  });

  describe('refresh behavior', () => {
    it('clears selection when the previously selected agent is removed on refresh', async () => {
      rpc.call.mockResolvedValueOnce(
        rpcSuccess({
          agents: [makeAgent({ id: 'keep' }), makeAgent({ id: 'remove' })],
        }),
      );
      const service = createService();
      const harness = makeSignalStoreHarness<PtahCliStoreState>(service);
      await harness.flush();

      service.selectAgent('remove');
      expect(harness.signal('selectedAgentId')).toBe('remove');

      // Refresh: 'remove' is gone.
      rpc.call.mockResolvedValueOnce(
        rpcSuccess({ agents: [makeAgent({ id: 'keep' })] }),
      );
      await service.refresh();

      expect(harness.signal('selectedAgentId')).toBeNull();
    });

    it('clears selection when the agent still exists but is now disabled', async () => {
      rpc.call.mockResolvedValueOnce(
        rpcSuccess({
          agents: [makeAgent({ id: 'a', enabled: true, status: 'available' })],
        }),
      );
      const service = createService();
      const harness = makeSignalStoreHarness<PtahCliStoreState>(service);
      await harness.flush();
      service.selectAgent('a');

      rpc.call.mockResolvedValueOnce(
        rpcSuccess({
          agents: [makeAgent({ id: 'a', enabled: false, status: 'available' })],
        }),
      );
      await service.refresh();

      expect(harness.signal('selectedAgentId')).toBeNull();
    });

    it('loadAgents is a no-op while already loading (_isLoading guard)', async () => {
      // Resolve the initial load with one agent.
      rpc.call.mockResolvedValueOnce(
        rpcSuccess({ agents: [makeAgent({ id: 'only' })] }),
      );
      const service = createService();
      const harness = makeSignalStoreHarness<PtahCliStoreState>(service);
      await harness.flush();

      // Queue a never-resolving second call, then invoke loadAgents twice in
      // rapid succession — the second invocation should be short-circuited.
      let resolveInflight: ((value: unknown) => void) | undefined;
      rpc.call.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveInflight = resolve;
          }),
      );

      const first = service.loadAgents();
      const second = service.loadAgents();
      await second; // Returns immediately because _isLoading was true for the second call

      // Only one "ptahCli:list" should be in flight.
      const listCalls = rpc.call.mock.calls.filter(
        (c: unknown[]) => c[0] === 'ptahCli:list',
      );
      // 1 initial load + 1 new load = 2 (not 3)
      expect(listCalls).toHaveLength(2);

      // Clean up the in-flight promise.
      resolveInflight?.(rpcSuccess({ agents: [] }));
      await first;
      expect(harness.signal('isLoading')).toBe(false);
    });
  });
});
