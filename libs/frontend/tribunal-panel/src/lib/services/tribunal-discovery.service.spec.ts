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

function requireLaneId(
  vendors: DiscoveredVendor[],
  laneId: string,
): DiscoveredVendor {
  const vendor = byLaneId(vendors, laneId);
  if (!vendor) throw new Error(`Vendor not found: ${laneId}`);
  return vendor;
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
      expect(byLaneId(result, 'codex#0')).toBeDefined();
      expect(byLaneId(result, 'ptah-cli|moonshot#0')).toBeDefined();
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
      const moonshot = byLaneId(result, 'ptah-cli|moonshot#0');

      expect(moonshot).toBeDefined();
      expect(moonshot?.available).toBe(false);
      expect(moonshot?.needsSetup).toBe(true);
      expect(moonshot?.lane.ptahCliId).toBeUndefined();
      expect(moonshot?.lane.providerId).toBe('moonshot');
    });

    it('includes Ollama Cloud, Z.AI and LM Studio provider lanes', async () => {
      rpc.call.mockResolvedValue(rpcSuccess(makeConfig([])));

      const result = await service.discover();

      expect(byLaneId(result, 'ptah-cli|z-ai#0')).toBeDefined();
      expect(byLaneId(result, 'ptah-cli|ollama-cloud#0')).toBeDefined();
      expect(byLaneId(result, 'ptah-cli|lm-studio#0')).toBeDefined();
      expect(byLaneId(result, 'ptah-cli|ollama#0')).toBeDefined();
      expect(byLaneId(result, 'ptah-cli|openrouter#0')).toBeDefined();
    });

    it('EXCLUDES the CLI-family provider entries (github-copilot/openai-codex) from ptah-cli lanes', async () => {
      rpc.call.mockResolvedValue(rpcSuccess(makeConfig([])));

      const result = await service.discover();

      expect(byLaneId(result, 'ptah-cli|github-copilot#0')).toBeUndefined();
      expect(byLaneId(result, 'ptah-cli|openai-codex#0')).toBeUndefined();
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

      expect(byLaneId(result, 'codex#0')?.lane.displayName).toBe('Codex');
      expect(byLaneId(result, 'copilot#0')?.lane.displayName).toBe('Copilot');
      expect(byLaneId(result, 'cursor#0')?.lane.displayName).toBe('Cursor');
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

      const codex = byLaneId(result, 'codex#0');
      expect(codex?.available).toBe(true);
      expect(codex?.needsSetup).toBe(false);
      expect(codex?.lane.providerId).toBeUndefined();
      expect(codex?.lane.model).toBeUndefined();

      const cursor = byLaneId(result, 'cursor#0');
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
      const moonshot = byLaneId(result, 'ptah-cli|moonshot#0');

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
      expect(byLaneId(result, 'ptah-cli|moonshot#0')?.lane.model).toBe(
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
      expect(byLaneId(result, 'ptah-cli|z-ai#0')?.available).toBe(true);
    });
  });

  describe('per-lane model metadata', () => {
    it('codex carries openai-codex as the model provider id and supports listing', async () => {
      rpc.call.mockResolvedValue(rpcSuccess(makeConfig([])));

      const result = await service.discover();
      const codex = byLaneId(result, 'codex#0');

      expect(codex?.supportsModelList).toBe(true);
      expect(codex?.modelProviderId).toBe('openai-codex');
      expect(codex?.baseKey).toBe('codex');
    });

    it('copilot carries github-copilot as the model provider id', async () => {
      rpc.call.mockResolvedValue(rpcSuccess(makeConfig([])));

      const result = await service.discover();
      const copilot = byLaneId(result, 'copilot#0');

      expect(copilot?.supportsModelList).toBe(true);
      expect(copilot?.modelProviderId).toBe('github-copilot');
    });

    it('cursor does NOT support model listing', async () => {
      rpc.call.mockResolvedValue(rpcSuccess(makeConfig([])));

      const result = await service.discover();
      const cursor = byLaneId(result, 'cursor#0');

      expect(cursor?.supportsModelList).toBe(false);
      expect(cursor?.modelProviderId).toBeUndefined();
    });

    it('ptah-cli lanes carry their providerId as the model provider id', async () => {
      rpc.call.mockResolvedValue(rpcSuccess(makeConfig([])));

      const result = await service.discover();
      const moonshot = byLaneId(result, 'ptah-cli|moonshot#0');

      expect(moonshot?.supportsModelList).toBe(true);
      expect(moonshot?.modelProviderId).toBe('moonshot');
      expect(moonshot?.baseKey).toBe('ptah-cli|moonshot');
    });
  });

  describe('listModelsFor', () => {
    it('calls provider:listModels with the lane model provider id', async () => {
      rpc.call.mockResolvedValue(rpcSuccess(makeConfig([])));
      const result = await service.discover();
      const codex = requireLaneId(result, 'codex#0');

      rpc.call.mockResolvedValue(
        rpcSuccess({
          models: [
            { id: 'gpt-5.1-codex-max', name: 'GPT-5.1 Codex Max' },
            { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex' },
          ],
          totalCount: 2,
        }),
      );

      const models = await service.listModelsFor(codex);

      expect(rpc.call).toHaveBeenLastCalledWith('provider:listModels', {
        toolUseOnly: false,
        providerId: 'openai-codex',
      });
      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('gpt-5.1-codex-max');
    });

    it('returns [] for a lane that does not support listing (cursor)', async () => {
      rpc.call.mockResolvedValue(rpcSuccess(makeConfig([])));
      const result = await service.discover();
      const cursor = requireLaneId(result, 'cursor#0');

      rpc.call.mockClear();
      const models = await service.listModelsFor(cursor);

      expect(models).toEqual([]);
      expect(rpc.call).not.toHaveBeenCalled();
    });

    it('returns [] when provider:listModels fails', async () => {
      rpc.call.mockResolvedValue(rpcSuccess(makeConfig([])));
      const result = await service.discover();
      const moonshot = requireLaneId(result, 'ptah-cli|moonshot#0');

      rpc.call.mockResolvedValue(rpcError('boom'));
      const models = await service.listModelsFor(moonshot);

      expect(models).toEqual([]);
    });
  });
});
