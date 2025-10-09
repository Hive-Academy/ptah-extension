/**
 * Token Counter Service Tests
 */

import { TokenCounterService } from './token-counter.service';
import * as vscode from 'vscode';

// Mock language model type
interface MockLanguageModel {
  countTokens: jest.Mock<Promise<number>, [string]>;
  maxInputTokens: number;
}

// Mock VS Code module
jest.mock('vscode', () => ({
  lm: {
    selectChatModels: jest.fn(),
  },
}));

describe('TokenCounterService', () => {
  let service: TokenCounterService;
  let mockSelectChatModels: jest.MockedFunction<
    typeof vscode.lm.selectChatModels
  >;

  beforeEach(() => {
    service = new TokenCounterService();
    mockSelectChatModels = vscode.lm.selectChatModels as jest.MockedFunction<
      typeof vscode.lm.selectChatModels
    >;
    jest.clearAllMocks();
  });

  afterEach(() => {
    service.dispose();
  });

  describe('countTokens', () => {
    it('should use native API when available', async () => {
      // Arrange
      const mockModel: MockLanguageModel = {
        countTokens: jest.fn().mockResolvedValue(100),
        maxInputTokens: 8000,
      };
      mockSelectChatModels.mockResolvedValue([
        mockModel as unknown as vscode.LanguageModelChat,
      ]);

      // Act
      const count = await service.countTokens('test text');

      // Assert
      expect(count).toBe(100);
      expect(mockModel.countTokens).toHaveBeenCalledWith('test text');
      expect(mockSelectChatModels).toHaveBeenCalledWith({ vendor: 'copilot' });
    });

    it('should fall back to estimation when API unavailable', async () => {
      // Arrange
      mockSelectChatModels.mockResolvedValue([]);

      // Act
      const count = await service.countTokens('test'); // 4 chars ≈ 1 token

      // Assert
      expect(count).toBe(1);
    });

    it('should fall back to estimation on API error', async () => {
      // Arrange
      mockSelectChatModels.mockRejectedValue(new Error('API Error'));

      // Act
      const count = await service.countTokens('testing'); // 7 chars ≈ 2 tokens

      // Assert
      expect(count).toBe(2);
    });

    it('should cache token counts when cache key provided', async () => {
      // Arrange
      const mockModel: MockLanguageModel = {
        countTokens: jest.fn().mockResolvedValue(50),
        maxInputTokens: 8000,
      };
      mockSelectChatModels.mockResolvedValue([
        mockModel as unknown as vscode.LanguageModelChat,
      ]);

      // Act
      const count1 = await service.countTokens('test text', 'key1');
      const count2 = await service.countTokens('different text', 'key1');

      // Assert
      expect(count1).toBe(50);
      expect(count2).toBe(50); // Same cached value
      expect(mockModel.countTokens).toHaveBeenCalledTimes(1); // Only called once
    });

    it('should not cache when no cache key provided', async () => {
      // Arrange
      const mockModel: MockLanguageModel = {
        countTokens: jest.fn().mockResolvedValue(50),
        maxInputTokens: 8000,
      };
      mockSelectChatModels.mockResolvedValue([
        mockModel as unknown as vscode.LanguageModelChat,
      ]);

      // Act
      await service.countTokens('test text');
      await service.countTokens('test text');

      // Assert
      expect(mockModel.countTokens).toHaveBeenCalledTimes(2); // Called twice, no caching
    });

    it('should estimate tokens conservatively', async () => {
      // Arrange
      mockSelectChatModels.mockResolvedValue([]);

      // Act
      const count1 = await service.countTokens('a'); // 1 char = 1 token
      const count2 = await service.countTokens('abcd'); // 4 chars = 1 token
      const count3 = await service.countTokens('abcde'); // 5 chars = 2 tokens (ceil)

      // Assert
      expect(count1).toBe(1);
      expect(count2).toBe(1);
      expect(count3).toBe(2);
    });
  });

  describe('getMaxInputTokens', () => {
    it('should return max input tokens from model', async () => {
      // Arrange
      const mockModel: MockLanguageModel = {
        countTokens: jest.fn(),
        maxInputTokens: 8000,
      };
      mockSelectChatModels.mockResolvedValue([
        mockModel as unknown as vscode.LanguageModelChat,
      ]);

      // Act
      const maxTokens = await service.getMaxInputTokens();

      // Assert
      expect(maxTokens).toBe(8000);
    });

    it('should return null when no models available', async () => {
      // Arrange
      mockSelectChatModels.mockResolvedValue([]);

      // Act
      const maxTokens = await service.getMaxInputTokens();

      // Assert
      expect(maxTokens).toBeNull();
    });

    it('should return null on API error', async () => {
      // Arrange
      mockSelectChatModels.mockRejectedValue(new Error('API Error'));

      // Act
      const maxTokens = await service.getMaxInputTokens();

      // Assert
      expect(maxTokens).toBeNull();
    });
  });

  describe('cache management', () => {
    it('should clear cache on clearCache call', async () => {
      // Arrange
      const mockModel: MockLanguageModel = {
        countTokens: jest.fn().mockResolvedValue(50),
        maxInputTokens: 8000,
      };
      mockSelectChatModels.mockResolvedValue([
        mockModel as unknown as vscode.LanguageModelChat,
      ]);
      await service.countTokens('test', 'key1');

      // Act
      service.clearCache();
      await service.countTokens('test', 'key1');

      // Assert
      expect(mockModel.countTokens).toHaveBeenCalledTimes(2); // Called twice after cache clear
    });

    it('should dispose service and clear cache', async () => {
      // Arrange
      const mockModel: MockLanguageModel = {
        countTokens: jest.fn().mockResolvedValue(50),
        maxInputTokens: 8000,
      };
      mockSelectChatModels.mockResolvedValue([
        mockModel as unknown as vscode.LanguageModelChat,
      ]);
      await service.countTokens('test', 'key1');

      // Act
      service.dispose();
      service = new TokenCounterService(); // New instance
      mockSelectChatModels.mockResolvedValue([
        mockModel as unknown as vscode.LanguageModelChat,
      ]);
      await service.countTokens('test', 'key1');

      // Assert
      expect(mockModel.countTokens).toHaveBeenCalledTimes(2); // Called twice, cache cleared on dispose
    });
  });
});
