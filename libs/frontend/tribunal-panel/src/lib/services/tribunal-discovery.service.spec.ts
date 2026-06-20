import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import { rpcSuccess, rpcError } from '@ptah-extension/core/testing';
import { TribunalDiscoveryService } from './tribunal-discovery.service';
import { TRIBUNAL_MAX_VENDOR_TILES } from './tribunal-state.service';
import type { AvailableAgent } from '@ptah-extension/shared';

function makeAgent(overrides: Partial<AvailableAgent> = {}): AvailableAgent {
  return {
    id: 'codex',
    name: 'Codex',
    type: 'cli',
    available: true,
    ...overrides,
  } as AvailableAgent;
}

describe('TribunalDiscoveryService', () => {
  let service: TribunalDiscoveryService;
  let rpc: { call: jest.Mock };

  beforeEach(() => {
    rpc = { call: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        TribunalDiscoveryService,
        { provide: ClaudeRpcService, useValue: rpc },
      ],
    });

    service = TestBed.inject(TribunalDiscoveryService);
  });

  describe('maxVendors cap exposure', () => {
    it('exposes maxVendors equal to TRIBUNAL_MAX_VENDOR_TILES', () => {
      expect(service.maxVendors).toBe(TRIBUNAL_MAX_VENDOR_TILES);
      expect(service.maxVendors).toBe(8);
    });
  });

  describe('discover', () => {
    it('returns empty array when RPC fails', async () => {
      rpc.call.mockResolvedValue(rpcError('Network error'));

      const result = await service.discover();
      expect(result).toHaveLength(0);
    });

    it('returns empty array when RPC result has no data', async () => {
      rpc.call.mockResolvedValue({ isSuccess: () => false, data: null });

      const result = await service.discover();
      expect(result).toHaveLength(0);
    });

    it('filters out non-cli agent types', async () => {
      rpc.call.mockResolvedValue(
        rpcSuccess({
          availableAgents: [
            makeAgent({ id: 'codex', type: 'cli', available: true }),
            makeAgent({
              id: 'webagent',
              type: 'mcp' as unknown as AvailableAgent['type'],
              available: true,
            }),
          ],
        }),
      );

      const result = await service.discover();
      expect(result).toHaveLength(1);
      expect(result[0].lane.cli).toBeDefined();
    });

    it('maps AvailableAgent to DiscoveredVendor with lane, available, and installed', async () => {
      rpc.call.mockResolvedValue(
        rpcSuccess({
          availableAgents: [
            makeAgent({
              id: 'codex',
              name: 'Codex',
              type: 'cli',
              available: true,
              family: 'codex',
              provider: 'gpt-4o',
            }),
          ],
        }),
      );

      const result = await service.discover();
      expect(result).toHaveLength(1);

      const { lane, available, installed } = result[0];
      expect(available).toBe(true);
      expect(installed).toBeDefined();
      expect(lane.displayName).toBe('Codex');
      expect(lane.cli).toBe('codex');
    });

    it('uses agent.available as fallback for installed when installed is not present', async () => {
      rpc.call.mockResolvedValue(
        rpcSuccess({
          availableAgents: [
            makeAgent({
              id: 'copilot',
              name: 'Copilot',
              type: 'cli',
              available: true,
              family: 'copilot',
            }),
          ],
        }),
      );

      const [vendor] = await service.discover();
      expect(vendor.installed).toBe(true);
    });

    it('resolves cli to copilot for copilot family', async () => {
      rpc.call.mockResolvedValue(
        rpcSuccess({
          availableAgents: [
            makeAgent({
              id: 'copilot',
              name: 'Copilot',
              type: 'cli',
              family: 'copilot',
              available: true,
            }),
          ],
        }),
      );

      const [vendor] = await service.discover();
      expect(vendor.lane.cli).toBe('copilot');
    });

    it('resolves cli to cursor for cursor family', async () => {
      rpc.call.mockResolvedValue(
        rpcSuccess({
          availableAgents: [
            makeAgent({
              id: 'cursor',
              name: 'Cursor',
              type: 'cli',
              family: 'cursor',
              available: true,
            }),
          ],
        }),
      );

      const [vendor] = await service.discover();
      expect(vendor.lane.cli).toBe('cursor');
    });

    it('defaults cli to ptah-cli for unknown family', async () => {
      rpc.call.mockResolvedValue(
        rpcSuccess({
          availableAgents: [
            makeAgent({
              id: 'unknown-vendor',
              name: 'Unknown',
              type: 'cli',
              family: 'unknown-vendor',
              available: true,
            }),
          ],
        }),
      );

      const [vendor] = await service.discover();
      expect(vendor.lane.cli).toBe('ptah-cli');
    });

    it('includes provider in laneId when provider is present', async () => {
      rpc.call.mockResolvedValue(
        rpcSuccess({
          availableAgents: [
            makeAgent({
              id: 'codex',
              name: 'Codex',
              type: 'cli',
              family: 'codex',
              provider: 'gpt-5',
              available: true,
            }),
          ],
        }),
      );

      const [vendor] = await service.discover();
      expect(vendor.lane.laneId).toContain('gpt-5');
    });

    it('produces unique laneIds for two ptah-cli agents without a provider field', async () => {
      rpc.call.mockResolvedValue(
        rpcSuccess({
          availableAgents: [
            makeAgent({
              id: 'moonshot',
              name: 'Moonshot',
              type: 'cli',
              family: 'ptah-cli',
              available: true,
            }),
            makeAgent({
              id: 'zai',
              name: 'Z.AI',
              type: 'cli',
              family: 'ptah-cli',
              available: true,
            }),
          ],
        }),
      );

      const result = await service.discover();
      expect(result).toHaveLength(2);
      const ids = result.map((v) => v.lane.laneId);
      expect(new Set(ids).size).toBe(2);
      expect(ids).toContain('ptah-cli|moonshot');
      expect(ids).toContain('ptah-cli|zai');
    });

    it('sets lane.model from agent.provider when present', async () => {
      rpc.call.mockResolvedValue(
        rpcSuccess({
          availableAgents: [
            makeAgent({
              id: 'codex',
              name: 'Codex',
              type: 'cli',
              family: 'codex',
              provider: 'gpt-4o',
              available: true,
            }),
          ],
        }),
      );

      const [vendor] = await service.discover();
      expect(vendor.lane.model).toBe('gpt-4o');
    });

    it('omits lane.model when agent.provider is absent', async () => {
      rpc.call.mockResolvedValue(
        rpcSuccess({
          availableAgents: [
            makeAgent({
              id: 'codex',
              name: 'Codex',
              type: 'cli',
              family: 'codex',
              available: true,
            }),
          ],
        }),
      );

      const [vendor] = await service.discover();
      expect('model' in vendor.lane).toBe(false);
    });
  });
});
