import 'reflect-metadata';

jest.mock('@ptah-extension/auth-providers', () => ({
  AUTH_PROVIDERS_TOKENS: { SDK_CODEX_AUTH: Symbol.for('CodexAuthService') },
}));

import type { CliDetectionService } from '@ptah-extension/cli-agent-runtime';
import type { IModelDiscovery } from '@ptah-extension/platform-core';
import type { CodexAuthService } from '@ptah-extension/auth-providers';
import type { AgentListCliModelsResult } from '@ptah-extension/shared';
import { CliModelListService } from './cli-model-list.service';

function makeHarness() {
  const modelMap: AgentListCliModelsResult = {
    codex: [{ id: 'codex-curated', name: 'Codex curated' }],
    copilot: [{ id: 'copilot-curated', name: 'Copilot curated' }],
    cursor: [{ id: 'cursor-model', name: 'Cursor model' }],
    antigravity: [{ id: 'antigravity-model', name: 'Antigravity model' }],
    opencode: [{ id: 'provider/model', name: 'OpenCode model' }],
    pi: [{ id: 'pi-model', name: 'Pi model' }],
  };
  const cliDetection = {
    listModelsForAll: jest.fn().mockResolvedValue(modelMap),
  };
  const modelDiscovery = { getCopilotModels: jest.fn().mockResolvedValue([]) };
  const codexAuth = { listModels: jest.fn().mockResolvedValue([]) };
  const service = new CliModelListService(
    cliDetection as unknown as CliDetectionService,
    modelDiscovery as unknown as IModelDiscovery,
    codexAuth as unknown as CodexAuthService,
  );
  return { service, cliDetection, modelDiscovery, codexAuth, modelMap };
}

describe('CliModelListService', () => {
  it('preserves the serialized map and entry metadata when refinements are empty', async () => {
    const h = makeHarness();
    h.modelMap.cursor.push({
      id: 'fallback',
      name: 'Fallback',
      isFallback: true,
    });

    const result = await h.service.listAll();

    expect(JSON.stringify(result)).toBe(JSON.stringify(h.modelMap));
    expect(result.codex).toBe(h.modelMap.codex);
    expect(result.copilot).toBe(h.modelMap.copilot);
    expect(result.cursor).toBe(h.modelMap.cursor);
  });

  it('uses auth and host models with the existing naming and property order', async () => {
    const h = makeHarness();
    h.codexAuth.listModels.mockResolvedValue([
      { id: 'gpt-5.3-codex', name: 'Account model', contextLength: 100 },
      { id: 'gpt-5.4-ai', name: '' },
    ]);
    h.modelDiscovery.getCopilotModels.mockResolvedValue([
      { id: 'claude-opus-4.6', name: 'Ignored host name', contextLength: 100 },
    ]);

    expect(JSON.stringify(await h.service.listAll())).toBe(
      JSON.stringify({
        ...h.modelMap,
        codex: [
          { id: 'gpt-5.3-codex', name: 'Account model' },
          { id: 'gpt-5.4-ai', name: 'GPT 5.4 AI' },
        ],
        copilot: [{ id: 'claude-opus-4.6', name: 'Claude Opus 4.6' }],
      }),
    );
  });

  it.each(['codex', 'copilot', 'both'])(
    'keeps the detector lists when %s refinement fails',
    async (failure) => {
      const h = makeHarness();
      if (failure !== 'copilot') {
        h.codexAuth.listModels.mockRejectedValue(new Error('offline'));
      }
      if (failure !== 'codex') {
        h.modelDiscovery.getCopilotModels.mockRejectedValue(
          new Error('unavailable'),
        );
      }

      expect(await h.service.listAll()).toEqual(h.modelMap);
      expect(h.codexAuth.listModels).toHaveBeenCalledTimes(1);
      expect(h.modelDiscovery.getCopilotModels).toHaveBeenCalledTimes(1);
    },
  );

  it('returns empty arrays for missing detector entries', async () => {
    const h = makeHarness();
    h.cliDetection.listModelsForAll.mockResolvedValue({});
    expect(await h.service.listAll()).toEqual({
      codex: [],
      copilot: [],
      cursor: [],
      antigravity: [],
      opencode: [],
      pi: [],
    });
  });

  it('still refines live models when the detector has no entries', async () => {
    const h = makeHarness();
    h.cliDetection.listModelsForAll.mockResolvedValue({});
    h.codexAuth.listModels.mockResolvedValue([{ id: 'gpt-5', name: 'GPT 5' }]);
    const result = await h.service.listAll();
    expect(result.codex).toEqual([{ id: 'gpt-5', name: 'GPT 5' }]);
    expect(result.copilot).toEqual([]);
  });

  it('propagates a top-level detector failure to the existing RPC error handler', async () => {
    const h = makeHarness();
    const error = new Error('detector failed');
    h.cliDetection.listModelsForAll.mockRejectedValue(error);
    await expect(h.service.listAll()).rejects.toBe(error);
    expect(h.codexAuth.listModels).not.toHaveBeenCalled();
    expect(h.modelDiscovery.getCopilotModels).not.toHaveBeenCalled();
  });
});
