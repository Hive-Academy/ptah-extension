import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import { rpcSuccess, rpcError } from '@ptah-extension/core/testing';
import { TribunalDiscoveryService } from './tribunal-discovery.service';
import { TRIBUNAL_MAX_VENDOR_TILES } from './tribunal-state.service';
import type {
  AgentOrchestrationConfig,
  CliDetectionResult,
} from '@ptah-extension/shared';
import type { DiscoveredVendor } from './tribunal-discovery.service';

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

function byLaneId(
  vendors: DiscoveredVendor[],
  laneId: string,
): DiscoveredVendor | undefined {
  return vendors.find((v) => v.lane.laneId === laneId);
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

    it('lists the full catalog (all needsSetup) when RPC fails', async () => {
      rpc.call.mockResolvedValue(rpcError('Network error'));

      const result = await service.discover();

      expect(result.length).toBeGreaterThan(0);
      expect(result.every((v) => v.needsSetup)).toBe(true);
      expect(result.every((v) => !v.available)).toBe(true);
      expect(byLaneId(result, 'codex')).toBeDefined();
      expect(byLaneId(result, 'ptah-cli|moonshot')).toBeDefined();
    });

    it('lists the full catalog when RPC succeeds with no data', async () => {
      rpc.call.mockResolvedValue({ isSuccess: () => true, data: null });

      const result = await service.discover();
      expect(result.length).toBeGreaterThan(0);
      expect(result.every((v) => v.needsSetup)).toBe(true);
    });
  });

  describe('discover — catalog always present', () => {
    it('lists catalog providers EVEN WHEN not configured (needsSetup, no ptahCliId)', async () => {
      rpc.call.mockResolvedValue(rpcSuccess(makeConfig([])));

      const result = await service.discover();
      const moonshot = byLaneId(result, 'ptah-cli|moonshot');

      expect(moonshot).toBeDefined();
      expect(moonshot?.available).toBe(false);
      expect(moonshot?.needsSetup).toBe(true);
      expect(moonshot?.lane.ptahCliId).toBeUndefined();
      expect(moonshot?.lane.providerId).toBe('moonshot');
    });

    it('includes Ollama Cloud, Z.AI and LM Studio provider lanes', async () => {
      rpc.call.mockResolvedValue(rpcSuccess(makeConfig([])));

      const result = await service.discover();

      expect(byLaneId(result, 'ptah-cli|z-ai')).toBeDefined();
      expect(byLaneId(result, 'ptah-cli|ollama-cloud')).toBeDefined();
      expect(byLaneId(result, 'ptah-cli|lm-studio')).toBeDefined();
      expect(byLaneId(result, 'ptah-cli|ollama')).toBeDefined();
      expect(byLaneId(result, 'ptah-cli|openrouter')).toBeDefined();
    });

    it('EXCLUDES the CLI-family provider entries (github-copilot/openai-codex) from ptah-cli lanes', async () => {
      rpc.call.mockResolvedValue(rpcSuccess(makeConfig([])));

      const result = await service.discover();

      expect(byLaneId(result, 'ptah-cli|github-copilot')).toBeUndefined();
      expect(byLaneId(result, 'ptah-cli|openai-codex')).toBeUndefined();
    });

    it('produces no laneId collisions across the full catalog', async () => {
      rpc.call.mockResolvedValue(rpcSuccess(makeConfig([])));

      const result = await service.discover();
      const ids = result.map((v) => v.lane.laneId);

      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('discover — CLI family lanes', () => {
    it('always emits codex/copilot/cursor lanes', async () => {
      rpc.call.mockResolvedValue(rpcSuccess(makeConfig([])));

      const result = await service.discover();

      expect(byLaneId(result, 'codex')?.lane.displayName).toBe('Codex');
      expect(byLaneId(result, 'copilot')?.lane.displayName).toBe('Copilot');
      expect(byLaneId(result, 'cursor')?.lane.displayName).toBe('Cursor');
    });

    it('reflects installed=true as available, installed=false as needsSetup', async () => {
      rpc.call.mockResolvedValue(
        rpcSuccess(
          makeConfig([
            makeCli({ cli: 'codex', installed: true }),
            makeCli({ cli: 'cursor', installed: false }),
          ]),
        ),
      );

      const result = await service.discover();

      const codex = byLaneId(result, 'codex');
      expect(codex?.available).toBe(true);
      expect(codex?.needsSetup).toBe(false);
      expect(codex?.lane.providerId).toBeUndefined();
      expect(codex?.lane.model).toBeUndefined();

      const cursor = byLaneId(result, 'cursor');
      expect(cursor?.available).toBe(false);
      expect(cursor?.needsSetup).toBe(true);
    });
  });

  describe('discover — configured ptah-cli providers', () => {
    it('marks Moonshot available with ptahCliId when a configured agent exists', async () => {
      rpc.call.mockResolvedValue(
        rpcSuccess(
          makeConfig([
            makeCli({
              cli: 'ptah-cli',
              installed: true,
              ptahCliId: 'x',
              ptahCliName: 'Moonshot Agent',
              providerId: 'moonshot',
              providerName: 'Moonshot',
            }),
          ]),
        ),
      );

      const result = await service.discover();
      const moonshot = byLaneId(result, 'ptah-cli|moonshot');

      expect(moonshot?.available).toBe(true);
      expect(moonshot?.needsSetup).toBe(false);
      expect(moonshot?.lane.ptahCliId).toBe('x');
      expect(moonshot?.lane.family).toBe('moonshot');
      expect(moonshot?.lane.displayName).toBe('Moonshot (Kimi)');
    });

    it('carries the provider default opus tier as model', async () => {
      rpc.call.mockResolvedValue(
        rpcSuccess(
          makeConfig([
            makeCli({
              cli: 'ptah-cli',
              installed: true,
              ptahCliId: 'x',
              providerId: 'moonshot',
            }),
          ]),
        ),
      );

      const result = await service.discover();
      expect(byLaneId(result, 'ptah-cli|moonshot')?.lane.model).toBe(
        'kimi-k2.7-code',
      );
    });

    it('sorts available vendors ahead of needsSetup', async () => {
      rpc.call.mockResolvedValue(
        rpcSuccess(
          makeConfig([
            makeCli({
              cli: 'ptah-cli',
              installed: true,
              ptahCliId: 'x',
              providerId: 'z-ai',
            }),
          ]),
        ),
      );

      const result = await service.discover();
      const firstNeedsSetupIdx = result.findIndex((v) => v.needsSetup);
      const lastAvailableIdx =
        result.length - 1 - [...result].reverse().findIndex((v) => v.available);

      expect(lastAvailableIdx).toBeLessThan(firstNeedsSetupIdx);
      expect(byLaneId(result, 'ptah-cli|z-ai')?.available).toBe(true);
    });
  });
});
