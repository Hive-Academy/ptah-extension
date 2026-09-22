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
    '%s returns only reviewed static IDs with or without credentials',
    async (id) => {
      const unknown = {
        id: 'unreviewed-model',
        name: 'Unreviewed',
        description: 'Unreviewed fixture',
        contextLength: 100,
        supportsToolUse: true,
      };
      const config = createMockConfigManager({
        values: { [`provider.${id}.modelCatalog`]: { models: [unknown] } },
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
      const network = jest.spyOn(axios, 'get');
      for (const key of [null, 'configured-key']) {
        const result = await service.fetchModels(id, key);
        expect(result.isStatic).toBe(true);
        expect(result.models.map((m) => m.id)).toEqual(
          Object.keys(OPENCODE_MODEL_ROUTES[id]),
        );
        expect(result.totalCount).toBe(id === 'opencode-zen' ? 66 : 31);
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
      expect(network).not.toHaveBeenCalled();
      expect(config.get).not.toHaveBeenCalledWith(
        `provider.${id}.modelCatalog`,
      );
      expect(config.set).not.toHaveBeenCalled();
      expect(getAnthropicProvider('opencode-go')?.pricingModel).toBe(
        'subscription',
      );
    },
  );
});
