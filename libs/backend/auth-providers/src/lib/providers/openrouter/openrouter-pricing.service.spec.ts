import 'reflect-metadata';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import { OpenRouterPricingService } from './openrouter-pricing.service';

interface OpenRouterPricingShape {
  prompt: string;
  completion: string;
  input_cache_read?: string;
  input_cache_write?: string;
}

interface OpenRouterModelShape {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: OpenRouterPricingShape;
}

function sampleCatalog(): { data: OpenRouterModelShape[] } {
  return {
    data: [
      {
        id: 'anthropic/claude-opus-4-7',
        name: 'Claude Opus 4.7',
        context_length: 200_000,
        pricing: {
          prompt: '0.000015',
          completion: '0.000075',
          input_cache_read: '0.0000015',
          input_cache_write: '0.00001875',
        },
      },
      {
        id: 'moonshot/kimi-k2',
        name: 'Kimi K2',
        context_length: 128_000,
        pricing: {
          prompt: '0.0000005',
          completion: '0.0000025',
        },
      },
      {
        id: 'broken/no-prices',
        name: 'Broken',
        pricing: { prompt: 'not-a-number', completion: '0.0001' },
      },
      {
        id: 'broken/missing-prices',
        name: 'MissingPrices',
      },
    ],
  };
}

function mockFetchOnce(
  fetchMock: jest.Mock,
  body: unknown,
  init?: { status?: number; ok?: boolean },
): void {
  fetchMock.mockImplementationOnce(async () => ({
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: 'OK',
    text: async () => JSON.stringify(body),
  }));
}

function mockFetchFailureOnce(fetchMock: jest.Mock, message: string): void {
  fetchMock.mockImplementationOnce(async () => {
    throw new Error(message);
  });
}

describe('OpenRouterPricingService', () => {
  let service: OpenRouterPricingService;
  let logger: ReturnType<typeof createMockLogger>;
  let fetchMock: jest.Mock;
  let originalFetch: typeof globalThis.fetch | undefined;

  beforeEach(() => {
    logger = createMockLogger();
    service = new OpenRouterPricingService(logger as unknown as Logger);
    fetchMock = jest.fn();
    originalFetch = globalThis.fetch;
    (globalThis as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;
  });

  afterEach(() => {
    if (originalFetch) {
      (globalThis as unknown as { fetch: typeof globalThis.fetch }).fetch =
        originalFetch;
    }
    jest.restoreAllMocks();
  });

  describe('getPricing — happy path', () => {
    it('returns pricing for the full OpenRouter id', async () => {
      mockFetchOnce(fetchMock, sampleCatalog());
      const result = await service.getPricing('anthropic/claude-opus-4-7');
      expect(result).not.toBeNull();
      expect(result?.inputCostPerToken).toBeCloseTo(15e-6);
      expect(result?.outputCostPerToken).toBeCloseTo(75e-6);
      expect(result?.cacheReadCostPerToken).toBeCloseTo(1.5e-6);
      expect(result?.cacheCreationCostPerToken).toBeCloseTo(18.75e-6);
      expect(result?.maxTokens).toBe(200_000);
      expect(result?.provider).toBe('openrouter');
    });

    it('returns pricing when looked up by stripped-prefix id', async () => {
      mockFetchOnce(fetchMock, sampleCatalog());
      const result = await service.getPricing('claude-opus-4-7');
      expect(result).not.toBeNull();
      expect(result?.inputCostPerToken).toBeCloseTo(15e-6);
    });

    it('returns pricing for a non-anthropic model via stripped id', async () => {
      mockFetchOnce(fetchMock, sampleCatalog());
      const result = await service.getPricing('kimi-k2');
      expect(result).not.toBeNull();
      expect(result?.outputCostPerToken).toBeCloseTo(2.5e-6);
    });

    it('omits cache fields when OpenRouter omits them', async () => {
      mockFetchOnce(fetchMock, sampleCatalog());
      const result = await service.getPricing('moonshot/kimi-k2');
      expect(result?.cacheReadCostPerToken).toBeUndefined();
      expect(result?.cacheCreationCostPerToken).toBeUndefined();
    });
  });

  describe('getPricing — misses', () => {
    it('returns null for an unknown id', async () => {
      mockFetchOnce(fetchMock, sampleCatalog());
      const result = await service.getPricing('totally/unknown');
      expect(result).toBeNull();
    });

    it('returns null when the catalog entry has unparseable prompt price', async () => {
      mockFetchOnce(fetchMock, sampleCatalog());
      const result = await service.getPricing('broken/no-prices');
      expect(result).toBeNull();
    });

    it('returns null when the catalog entry has no pricing block', async () => {
      mockFetchOnce(fetchMock, sampleCatalog());
      const result = await service.getPricing('broken/missing-prices');
      expect(result).toBeNull();
    });

    it('returns null for empty / non-string ids without fetching', async () => {
      const empty = await service.getPricing('');
      expect(empty).toBeNull();
      const nullish = await service.getPricing(undefined as unknown as string);
      expect(nullish).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('TTL caching', () => {
    it('serves later calls from the in-memory cache without re-fetching', async () => {
      mockFetchOnce(fetchMock, sampleCatalog());
      await service.getPricing('anthropic/claude-opus-4-7');
      await service.getPricing('anthropic/claude-opus-4-7');
      await service.getPricing('moonshot/kimi-k2');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('re-fetches once the TTL has elapsed', async () => {
      jest.useFakeTimers();
      mockFetchOnce(fetchMock, sampleCatalog());
      await service.getPricing('anthropic/claude-opus-4-7');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      jest.setSystemTime(Date.now() + 5 * 60 * 1000 + 1);
      mockFetchOnce(fetchMock, sampleCatalog());
      await service.getPricing('anthropic/claude-opus-4-7');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
    });
  });

  describe('in-flight dedup', () => {
    it('dedups concurrent fetches to a single network call', async () => {
      let resolveFetch: (() => void) | undefined;
      fetchMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFetch = () =>
              resolve({
                ok: true,
                status: 200,
                statusText: 'OK',
                text: async () => JSON.stringify(sampleCatalog()),
              } as unknown as Response);
          }),
      );

      const concurrent = Promise.all([
        service.getPricing('anthropic/claude-opus-4-7'),
        service.getPricing('anthropic/claude-opus-4-7'),
        service.getPricing('moonshot/kimi-k2'),
        service.getPricing('claude-opus-4-7'),
      ]);

      expect(resolveFetch).toBeDefined();
      resolveFetch?.();
      const results = await concurrent;
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(results[0]?.inputCostPerToken).toBeCloseTo(15e-6);
      expect(results[1]?.inputCostPerToken).toBeCloseTo(15e-6);
      expect(results[2]?.outputCostPerToken).toBeCloseTo(2.5e-6);
      expect(results[3]?.inputCostPerToken).toBeCloseTo(15e-6);
    });
  });

  describe('HTTP failure', () => {
    it('returns null when the fetch throws, and retries on the next call', async () => {
      mockFetchFailureOnce(fetchMock, 'network down');
      const first = await service.getPricing('anthropic/claude-opus-4-7');
      expect(first).toBeNull();
      mockFetchOnce(fetchMock, sampleCatalog());
      const second = await service.getPricing('anthropic/claude-opus-4-7');
      expect(second).not.toBeNull();
      expect(second?.inputCostPerToken).toBeCloseTo(15e-6);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('returns null when the response is HTTP 500', async () => {
      fetchMock.mockImplementationOnce(async () => ({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'upstream broken',
      }));
      const result = await service.getPricing('anthropic/claude-opus-4-7');
      expect(result).toBeNull();
    });

    it('returns null when the body is missing the data array', async () => {
      mockFetchOnce(fetchMock, { unexpected: true });
      const result = await service.getPricing('anthropic/claude-opus-4-7');
      expect(result).toBeNull();
    });
  });
});
