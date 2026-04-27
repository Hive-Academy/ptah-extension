/**
 * Token Counter Service Tests
 *
 * Tests the LRU caching and delegation behavior of TokenCounterService.
 * Native token-counting behavior (vscode.lm, gpt-tokenizer) is covered by
 * ITokenCounter contract tests in platform-vscode and platform-electron.
 */

import 'reflect-metadata'; // Required for tsyringe
import { createMockTokenCounter } from '@ptah-extension/platform-core/testing';
import type { MockTokenCounter } from '@ptah-extension/platform-core/testing';
import { TokenCounterService } from './token-counter.service';

describe('TokenCounterService', () => {
  let service: TokenCounterService;
  let mockTokenCounter: MockTokenCounter;

  beforeEach(() => {
    mockTokenCounter = createMockTokenCounter({ maxInputTokens: 8000 });
    service = new TokenCounterService(mockTokenCounter);
  });

  afterEach(() => {
    service.dispose();
  });

  describe('countTokens', () => {
    it('should delegate to the injected ITokenCounter', async () => {
      mockTokenCounter.countTokens.mockResolvedValueOnce(100);

      const count = await service.countTokens('test text');

      expect(count).toBe(100);
      expect(mockTokenCounter.countTokens).toHaveBeenCalledWith('test text');
    });

    it('should propagate whatever value the token counter returns', async () => {
      mockTokenCounter.countTokens.mockResolvedValueOnce(1);

      const count = await service.countTokens('test');

      expect(count).toBe(1);
    });

    it('should surface token counter rejections', async () => {
      mockTokenCounter.countTokens.mockRejectedValueOnce(
        new Error('API Error'),
      );

      await expect(service.countTokens('testing')).rejects.toThrow('API Error');
    });

    it('should cache token counts when cache key provided', async () => {
      mockTokenCounter.countTokens.mockResolvedValue(50);

      const count1 = await service.countTokens('test text', 'key1');
      const count2 = await service.countTokens('different text', 'key1');

      expect(count1).toBe(50);
      expect(count2).toBe(50); // Same cached value
      expect(mockTokenCounter.countTokens).toHaveBeenCalledTimes(1);
    });

    it('should not cache when no cache key provided', async () => {
      mockTokenCounter.countTokens.mockResolvedValue(50);

      await service.countTokens('test text');
      await service.countTokens('test text');

      expect(mockTokenCounter.countTokens).toHaveBeenCalledTimes(2);
    });

    it('should forward distinct inputs without cache key to the counter', async () => {
      mockTokenCounter.countTokens
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(2);

      const count1 = await service.countTokens('a');
      const count2 = await service.countTokens('abcd');
      const count3 = await service.countTokens('abcde');

      expect(count1).toBe(1);
      expect(count2).toBe(1);
      expect(count3).toBe(2);
      expect(mockTokenCounter.countTokens).toHaveBeenCalledTimes(3);
    });
  });

  describe('getMaxInputTokens', () => {
    it('should return max input tokens from the injected counter', async () => {
      const maxTokens = await service.getMaxInputTokens();

      expect(maxTokens).toBe(8000);
      expect(mockTokenCounter.getMaxInputTokens).toHaveBeenCalled();
    });

    it('should return null when counter reports unavailable', async () => {
      mockTokenCounter.getMaxInputTokens.mockResolvedValueOnce(null);

      const maxTokens = await service.getMaxInputTokens();

      expect(maxTokens).toBeNull();
    });

    it('should surface counter rejections', async () => {
      mockTokenCounter.getMaxInputTokens.mockRejectedValueOnce(
        new Error('API Error'),
      );

      await expect(service.getMaxInputTokens()).rejects.toThrow('API Error');
    });
  });

  describe('cache management', () => {
    it('should clear cache on clearCache call', async () => {
      mockTokenCounter.countTokens.mockResolvedValue(50);
      await service.countTokens('test', 'key1');

      service.clearCache();
      await service.countTokens('test', 'key1');

      expect(mockTokenCounter.countTokens).toHaveBeenCalledTimes(2);
    });

    it('should dispose service and clear cache', async () => {
      mockTokenCounter.countTokens.mockResolvedValue(50);
      await service.countTokens('test', 'key1');

      service.dispose();
      service = new TokenCounterService(mockTokenCounter);
      await service.countTokens('test', 'key1');

      expect(mockTokenCounter.countTokens).toHaveBeenCalledTimes(2);
    });
  });
});
