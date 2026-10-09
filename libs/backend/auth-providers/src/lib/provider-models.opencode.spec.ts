import 'reflect-metadata';
import axios from 'axios';
import { createMockConfigManager } from '@ptah-extension/vscode-core/testing';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { ConfigManager, Logger } from '@ptah-extension/vscode-core';
import type { WorkspaceScopeResolver } from '@ptah-extension/settings-core';
import {
  OPENCODE_MODEL_ROUTES,
  getAnthropicProvider,
} from '@ptah-extension/shared';
import { ActiveProviderResolver } from './auth/active-provider-resolver';
import { ProviderModelsService } from './provider-models.service';

describe('ProviderModelsService OpenCode catalog', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(['opencode-zen', 'opencode-go'] as const)(
    '%s returns the whole reviewed route table when the public list cannot be read',
    async (id) => {
      const unknown = {
        id: 'unreviewed-model',
        name: 'Unreviewed',
        description: 'Unreviewed fixture',
        contextLength: 100,
        supportsToolUse: true,
      };
      const config = createMockConfigManager({
        values: {
          [`provider.${id}.modelCatalog`]: {
            models: [unknown],
            timestamp: Date.now(),
          },
        },
      });
      const service = new ProviderModelsService(
        createMockLogger() as unknown as Logger,
        config as unknown as ConfigManager,
        {},
        new ActiveProviderResolver({
          read: () => undefined,
        } as unknown as WorkspaceScopeResolver),
      );
      const dynamic = jest.fn(async () => [unknown]);
      service.registerDynamicFetcher(id, dynamic);
      const network = jest
        .spyOn(axios, 'get')
        .mockRejectedValue(new Error('offline'));
      for (const key of [null, 'configured-key']) {
        const result = await service.fetchModels(id, key);
        expect(result.isStatic).toBe(true);
        expect(result.models.map((m) => m.id)).toEqual(
          Object.keys(OPENCODE_MODEL_ROUTES[id]),
        );
        expect(result.totalCount).toBe(id === 'opencode-zen' ? 78 : 35);
        for (const model of result.models)
          expect(model).toMatchObject({
            contextLength: 0,
            supportsToolUse: true,
          });
        // Every OpenCode model is tool-capable (measured: 103/103 on
        // GET /api/model), so a toolUseOnly request must return the WHOLE
        // catalog. Asserting [] here would pin the opposite bug.
        expect(await service.fetchModels(id, key, true)).toEqual(result);
      }
      expect(dynamic).not.toHaveBeenCalled();
      // Only the public list, never with the user's key.
      for (const [url, options] of network.mock.calls) {
        expect(url).toBe(`${getAnthropicProvider(id)?.baseUrl}/models`);
        expect(JSON.stringify(options)).not.toContain('configured-key');
      }
      expect(config.get).not.toHaveBeenCalledWith(
        `provider.${id}.modelCatalog`,
      );
      expect(config.set).not.toHaveBeenCalled();
      expect(getAnthropicProvider('opencode-go')?.pricingModel).toBe(
        'subscription',
      );
    },
  );

  it.each(['opencode-zen', 'opencode-go'] as const)(
    '%s drops routed IDs the public list no longer serves and ignores unrouted ones',
    async (id) => {
      const routed = Object.keys(OPENCODE_MODEL_ROUTES[id]);
      const stillLive = routed.slice(0, 3);
      jest.spyOn(axios, 'get').mockResolvedValue({
        data: {
          data: [...stillLive, 'no-route-model'].map((m) => ({ id: m })),
        },
      });
      const service = new ProviderModelsService(
        createMockLogger() as unknown as Logger,
        createMockConfigManager({ values: {} }) as unknown as ConfigManager,
        {},
        new ActiveProviderResolver({
          read: () => undefined,
        } as unknown as WorkspaceScopeResolver),
      );
      const result = await service.fetchModels(id, null);
      expect(result.models.map((m) => m.id)).toEqual(stillLive);
      expect(result.isStatic).toBe(false);
    },
  );
});
