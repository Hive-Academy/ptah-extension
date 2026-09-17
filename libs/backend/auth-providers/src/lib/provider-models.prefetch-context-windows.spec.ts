/**
 * `prefetchPricing()` is the FIRST model fetch on a cold start — it runs before
 * the user has configured any API key — and the OpenRouter payload it parses
 * carries `context_length` for every model. Both of its branches used to call
 * only `feedPricingMap()`, which stores prices and not windows, so every
 * provider-reported context window was discarded until some other fetch path
 * happened to run (PR #493 review C).
 */

import 'reflect-metadata';

import axios from 'axios';
import {
  createMockConfigManager,
  type MockConfigManager,
} from '@ptah-extension/vscode-core/testing';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { getModelContextWindow, type AuthEnv } from '@ptah-extension/shared';
import type { ConfigManager, Logger } from '@ptah-extension/vscode-core';
import type { WorkspaceScopeResolver } from '@ptah-extension/settings-core';

import { ProviderModelsService } from './provider-models.service';
import { ActiveProviderResolver } from './auth/active-provider-resolver';

jest.mock('axios');

const mockedGet = axios.get as unknown as jest.Mock;

function makeService(): {
  service: ProviderModelsService;
  config: MockConfigManager;
} {
  const logger = createMockLogger();
  const config = createMockConfigManager({ values: {} });
  const authEnv: AuthEnv = {};
  const scope = {
    read: <T>(): T | undefined => undefined,
  } as unknown as WorkspaceScopeResolver;
  const service = new ProviderModelsService(
    logger as unknown as Logger,
    config as unknown as ConfigManager,
    authEnv,
    new ActiveProviderResolver(scope),
  );
  return { service, config };
}

/** One OpenRouter catalogue row: a real window, deliberately no price. */
function unpricedRow(id: string, contextLength: number) {
  return {
    id,
    name: id,
    description: '',
    context_length: contextLength,
    supported_parameters: ['tools'],
    pricing: {},
  };
}

async function runPrefetch(service: ProviderModelsService): Promise<number> {
  // The implementation waits 3 s before its first attempt so a cold start does
  // not race extension activation.
  const pending = service.prefetchPricing();
  await jest.advanceTimersByTimeAsync(3000);
  return pending;
}

describe('ProviderModelsService.prefetchPricing — discovered context windows', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockedGet.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('registers provider-reported windows from a fresh fetch, even with no pricing', async () => {
    const modelId = 'gpt-ctx-prefetch-fresh-493';
    mockedGet.mockResolvedValue({
      data: { data: [unpricedRow(modelId, 333_000)] },
    });
    const { service } = makeService();
    expect(getModelContextWindow(modelId)).toBe(0);

    await runPrefetch(service);

    expect(getModelContextWindow(modelId)).toBe(333_000);
  });

  it('registers windows again on the cached branch', async () => {
    const modelId = 'gpt-ctx-prefetch-cached-493';
    mockedGet.mockResolvedValue({
      data: { data: [unpricedRow(modelId, 444_000)] },
    });
    const { service } = makeService();
    await runPrefetch(service);

    const recordSpy = jest.spyOn(
      service as unknown as {
        recordContextWindows: (models: readonly unknown[]) => void;
      },
      'recordContextWindows',
    );
    mockedGet.mockClear();

    await runPrefetch(service);

    // Served entirely from the prefetch cache — and it still feeds the window
    // registry, so a process that only ever takes this branch is not left
    // without any provider-reported window.
    expect(mockedGet).not.toHaveBeenCalled();
    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(recordSpy.mock.calls[0][0]).toEqual([
      expect.objectContaining({ id: modelId, contextLength: 444_000 }),
    ]);
  });
});
