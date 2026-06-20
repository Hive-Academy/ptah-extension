import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import { rpcSuccess, rpcError } from '@ptah-extension/core/testing';
import { TribunalDiscoveryService } from './tribunal-discovery.service';
import { TRIBUNAL_MAX_VENDOR_TILES } from './tribunal-state.service';
import type {
  AgentOrchestrationConfig,
  CliDetectionResult,
} from '@ptah-extension/shared';

function makeCli(
  overrides: Partial<CliDetectionResult> = {},
): CliDetectionResult {
  return {
    cli: 'codex',
    installed: true,
    supportsSteer: false,
    ...overrides,
  } as CliDetectionResult;
}

function makeConfig(
  detectedClis: CliDetectionResult[],
): AgentOrchestrationConfig {
  return {
    detectedClis,
    preferredAgentOrder: [],
    maxConcurrentAgents: 3,
    codexModel: '',
    copilotModel: '',
    cursorModel: '',
    cursorApiKeyConfigured: false,
    codexReasoningEffort: '',
    copilotReasoningEffort: '',
    codexAutoApprove: true,
    copilotAutoApprove: true,
    mcpPort: 51820,
    disabledClis: [],
    disabledMcpNamespaces: [],
    browserAllowLocalhost: false,
  };
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

  describe('discover — source + guards', () => {
    it('sources vendors from agent:getConfig', async () => {
      rpc.call.mockResolvedValue(rpcSuccess(makeConfig([makeCli()])));

      await service.discover();

      expect(rpc.call).toHaveBeenCalledWith('agent:getConfig', undefined);
    });

    it('returns empty array when RPC fails', async () => {
      rpc.call.mockResolvedValue(rpcError('Network error'));

      const result = await service.discover();
      expect(result).toHaveLength(0);
    });

    it('returns empty array when RPC succeeds with no data', async () => {
      rpc.call.mockResolvedValue({ isSuccess: () => true, data: null });

      const result = await service.discover();
      expect(result).toHaveLength(0);
    });
  });

  describe('discover — system CLI lanes', () => {
    it('maps codex to a single lane with cli/installed/available', async () => {
      rpc.call.mockResolvedValue(
        rpcSuccess(makeConfig([makeCli({ cli: 'codex', installed: true })])),
      );

      const result = await service.discover();
      expect(result).toHaveLength(1);

      const [{ lane, available, installed }] = result;
      expect(lane.cli).toBe('codex');
      expect(lane.laneId).toBe('codex');
      expect(lane.family).toBe('codex');
      expect(lane.displayName).toBe('Codex');
      expect(installed).toBe(true);
      expect(available).toBe(true);
      expect('model' in lane).toBe(false);
    });

    it('maps copilot to a single lane with human display name', async () => {
      rpc.call.mockResolvedValue(
        rpcSuccess(makeConfig([makeCli({ cli: 'copilot', installed: true })])),
      );

      const [vendor] = await service.discover();
      expect(vendor.lane.cli).toBe('copilot');
      expect(vendor.lane.laneId).toBe('copilot');
      expect(vendor.lane.displayName).toBe('Copilot');
    });

    it('marks a not-installed cursor as installed:false and available:false', async () => {
      rpc.call.mockResolvedValue(
        rpcSuccess(makeConfig([makeCli({ cli: 'cursor', installed: false })])),
      );

      const [vendor] = await service.discover();
      expect(vendor.lane.cli).toBe('cursor');
      expect(vendor.lane.displayName).toBe('Cursor');
      expect(vendor.installed).toBe(false);
      expect(vendor.available).toBe(false);
    });
  });

  describe('discover — ptah-cli per-provider lanes', () => {
    it('produces TWO distinct lanes for two ptah-cli providers (no collision)', async () => {
      rpc.call.mockResolvedValue(
        rpcSuccess(
          makeConfig([
            makeCli({
              cli: 'ptah-cli',
              installed: true,
              ptahCliId: 'a',
              ptahCliName: 'Moonshot Agent',
              providerId: 'moonshot',
              providerName: 'Moonshot',
            }),
            makeCli({
              cli: 'ptah-cli',
              installed: true,
              ptahCliId: 'b',
              ptahCliName: 'Z.AI Agent',
              providerId: 'z-ai',
              providerName: 'Z.AI',
            }),
          ]),
        ),
      );

      const result = await service.discover();
      expect(result).toHaveLength(2);

      const ids = result.map((v) => v.lane.laneId);
      expect(new Set(ids).size).toBe(2);
      expect(ids).toContain('ptah-cli|a');
      expect(ids).toContain('ptah-cli|b');

      const families = result.map((v) => v.lane.family);
      expect(families).toContain('moonshot');
      expect(families).toContain('z-ai');
    });

    it('uses ptahCliName as displayName and providerName as model', async () => {
      rpc.call.mockResolvedValue(
        rpcSuccess(
          makeConfig([
            makeCli({
              cli: 'ptah-cli',
              installed: true,
              ptahCliId: 'a',
              ptahCliName: 'Moonshot Agent',
              providerId: 'moonshot',
              providerName: 'Moonshot',
            }),
          ]),
        ),
      );

      const [vendor] = await service.discover();
      expect(vendor.lane.displayName).toBe('Moonshot Agent');
      expect(vendor.lane.model).toBe('Moonshot');
      expect(vendor.installed).toBe(true);
      expect(vendor.available).toBe(true);
    });

    it('falls back displayName ptahCliName→providerName→default', async () => {
      rpc.call.mockResolvedValue(
        rpcSuccess(
          makeConfig([
            makeCli({
              cli: 'ptah-cli',
              installed: true,
              ptahCliId: 'a',
              providerId: 'moonshot',
              providerName: 'Moonshot',
            }),
            makeCli({
              cli: 'ptah-cli',
              installed: true,
              ptahCliId: 'b',
            }),
          ]),
        ),
      );

      const [withProvider, bare] = await service.discover();
      expect(withProvider.lane.displayName).toBe('Moonshot');
      expect(bare.lane.displayName).toBe('Ptah CLI');
      expect('model' in bare.lane).toBe(false);
    });

    it('builds a stable distinct laneId when ptahCliId is absent', async () => {
      rpc.call.mockResolvedValue(
        rpcSuccess(
          makeConfig([
            makeCli({
              cli: 'ptah-cli',
              installed: true,
              providerId: 'moonshot',
            }),
            makeCli({
              cli: 'ptah-cli',
              installed: true,
              providerId: 'z-ai',
            }),
          ]),
        ),
      );

      const result = await service.discover();
      const ids = result.map((v) => v.lane.laneId);
      expect(new Set(ids).size).toBe(2);
      expect(ids).toContain('ptah-cli|moonshot');
      expect(ids).toContain('ptah-cli|z-ai');
    });
  });

  describe('discover — preferredRank ordering', () => {
    it('sorts ranked vendors ahead of unranked, ascending', async () => {
      rpc.call.mockResolvedValue(
        rpcSuccess(
          makeConfig([
            makeCli({ cli: 'cursor', installed: true }),
            makeCli({ cli: 'codex', installed: true, preferredRank: 1 }),
            makeCli({ cli: 'copilot', installed: true, preferredRank: 2 }),
          ]),
        ),
      );

      const result = await service.discover();
      expect(result.map((v) => v.lane.cli)).toEqual([
        'codex',
        'copilot',
        'cursor',
      ]);
    });

    it('treats rank 0 / absent as unranked (sorted last)', async () => {
      rpc.call.mockResolvedValue(
        rpcSuccess(
          makeConfig([
            makeCli({ cli: 'cursor', installed: true, preferredRank: 0 }),
            makeCli({ cli: 'codex', installed: true, preferredRank: 3 }),
          ]),
        ),
      );

      const result = await service.discover();
      expect(result.map((v) => v.lane.cli)).toEqual(['codex', 'cursor']);
    });
  });
});
