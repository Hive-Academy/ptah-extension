/**
 * Context Size Optimizer Service Tests
 *
 * Tests intelligent file selection within token budgets for Claude CLI integration.
 */

import 'reflect-metadata';

// Mock vscode module before imports
jest.mock('vscode', () => ({}), { virtual: true });

import { ContextSizeOptimizerService } from './context-size-optimizer.service';
import { FileRelevanceScorerService } from './file-relevance-scorer.service';
import { TokenCounterService } from '../services/token-counter.service';
import { IndexedFile, FileType } from '../types/workspace.types';

describe('ContextSizeOptimizerService', () => {
  let service: ContextSizeOptimizerService;
  let mockRelevanceScorer: jest.Mocked<FileRelevanceScorerService>;
  let mockTokenCounter: jest.Mocked<TokenCounterService>;

  beforeEach(() => {
    mockRelevanceScorer = {
      scoreFile: jest.fn(),
      rankFiles: jest.fn(),
      getTopFiles: jest.fn(),
    } as unknown as jest.Mocked<FileRelevanceScorerService>;

    mockTokenCounter = {
      countTokens: jest.fn().mockResolvedValue(100),
      estimateTokens: jest.fn().mockReturnValue(100),
      getMaxInputTokens: jest.fn().mockResolvedValue(200000),
    } as unknown as jest.Mocked<TokenCounterService>;

    service = new ContextSizeOptimizerService(
      mockRelevanceScorer,
      mockTokenCounter
    );
  });

  describe('optimizeContext', () => {
    it('should select files within token budget', async () => {
      const files: IndexedFile[] = [
        {
          path: '/workspace/file1.ts',
          relativePath: 'file1.ts',
          type: FileType.Source,
          size: 1000,
          estimatedTokens: 250,
        },
        {
          path: '/workspace/file2.ts',
          relativePath: 'file2.ts',
          type: FileType.Source,
          size: 2000,
          estimatedTokens: 500,
        },
        {
          path: '/workspace/file3.ts',
          relativePath: 'file3.ts',
          type: FileType.Source,
          size: 3000,
          estimatedTokens: 750,
        },
      ];

      // Mock ranking with decreasing relevance scores
      const rankedFiles = new Map([
        [files[0], 100],
        [files[1], 80],
        [files[2], 60],
      ]);
      mockRelevanceScorer.rankFiles.mockReturnValue(rankedFiles);

      const result = await service.optimizeContext({
        files,
        query: 'test query',
        maxTokens: 1000,
        responseReserve: 200,
      });

      // Available budget: 1000 - 200 = 800 tokens
      // file1 (250) + file2 (500) = 750 tokens (within budget)
      // file3 (750) would exceed budget
      expect(result.selectedFiles).toHaveLength(2);
      expect(result.excludedFiles).toHaveLength(1);
      expect(result.totalTokens).toBe(750);
      expect(result.tokensRemaining).toBe(50);
    });

    it('should respect default token limits', async () => {
      const files: IndexedFile[] = [
        {
          path: '/workspace/large.ts',
          relativePath: 'large.ts',
          type: FileType.Source,
          size: 100000,
          estimatedTokens: 25000,
        },
      ];

      mockRelevanceScorer.rankFiles.mockReturnValue(new Map([[files[0], 100]]));

      const result = await service.optimizeContext({
        files,
        query: 'test',
        // Uses defaults: maxTokens=200,000, responseReserve=50,000
      });

      expect(result.selectedFiles).toHaveLength(1);
      expect(result.totalTokens).toBe(25000);
      expect(result.tokensRemaining).toBe(125000); // 150,000 - 25,000
    });

    it('should exclude all files when budget is too small', async () => {
      const files: IndexedFile[] = [
        {
          path: '/workspace/huge.ts',
          relativePath: 'huge.ts',
          type: FileType.Source,
          size: 200000,
          estimatedTokens: 50000,
        },
      ];

      mockRelevanceScorer.rankFiles.mockReturnValue(new Map([[files[0], 100]]));

      const result = await service.optimizeContext({
        files,
        query: 'test',
        maxTokens: 10000,
        responseReserve: 5000,
      });

      // Available: 10000 - 5000 = 5000 tokens
      // File needs 50,000 tokens
      expect(result.selectedFiles).toHaveLength(0);
      expect(result.excludedFiles).toHaveLength(1);
      expect(result.totalTokens).toBe(0);
      expect(result.tokensRemaining).toBe(5000);
    });

    it('should calculate correct reduction percentage', async () => {
      const files: IndexedFile[] = Array.from({ length: 10 }, (_, i) => ({
        path: `/workspace/file${i}.ts`,
        relativePath: `file${i}.ts`,
        type: FileType.Source,
        size: 1000,
        estimatedTokens: 1000,
      }));

      // Rank files with decreasing scores
      const rankedFiles = new Map(
        files.map((file, index) => [file, 100 - index * 10])
      );
      mockRelevanceScorer.rankFiles.mockReturnValue(rankedFiles);

      const result = await service.optimizeContext({
        files,
        query: 'test',
        maxTokens: 5000,
        responseReserve: 0,
      });

      // Total before: 10 files * 1000 tokens = 10,000 tokens
      // Selected: 5 files * 1000 tokens = 5,000 tokens
      // Reduction: (10,000 - 5,000) / 10,000 = 50%
      expect(result.stats.reductionPercentage).toBe(50);
      expect(result.stats.totalFiles).toBe(10);
      expect(result.stats.selectedFiles).toBe(5);
      expect(result.stats.excludedFiles).toBe(5);
    });

    it('should calculate average relevance of selected files', async () => {
      const files: IndexedFile[] = [
        {
          path: '/workspace/file1.ts',
          relativePath: 'file1.ts',
          type: FileType.Source,
          size: 1000,
          estimatedTokens: 100,
        },
        {
          path: '/workspace/file2.ts',
          relativePath: 'file2.ts',
          type: FileType.Source,
          size: 1000,
          estimatedTokens: 100,
        },
        {
          path: '/workspace/file3.ts',
          relativePath: 'file3.ts',
          type: FileType.Source,
          size: 1000,
          estimatedTokens: 100,
        },
      ];

      // Rank with specific scores: 100, 80, 60
      mockRelevanceScorer.rankFiles.mockReturnValue(
        new Map([
          [files[0], 100],
          [files[1], 80],
          [files[2], 60],
        ])
      );

      const result = await service.optimizeContext({
        files,
        query: 'test',
        maxTokens: 250,
        responseReserve: 0,
      });

      // Selects first 2 files (200 tokens)
      // Average relevance: (100 + 80) / 2 = 90
      expect(result.stats.averageRelevance).toBe(90);
    });

    it('should handle empty file list', async () => {
      mockRelevanceScorer.rankFiles.mockReturnValue(new Map());

      const result = await service.optimizeContext({
        files: [],
        query: 'test',
      });

      expect(result.selectedFiles).toHaveLength(0);
      expect(result.excludedFiles).toHaveLength(0);
      expect(result.totalTokens).toBe(0);
      expect(result.stats.totalFiles).toBe(0);
      expect(result.stats.reductionPercentage).toBe(0);
    });
  });

  describe('estimateOptimization', () => {
    it('should return stats without performing full optimization', async () => {
      const files: IndexedFile[] = [
        {
          path: '/workspace/file1.ts',
          relativePath: 'file1.ts',
          type: FileType.Source,
          size: 1000,
          estimatedTokens: 250,
        },
      ];

      mockRelevanceScorer.rankFiles.mockReturnValue(new Map([[files[0], 100]]));

      const stats = await service.estimateOptimization({
        files,
        query: 'test',
      });

      expect(stats.totalFiles).toBe(1);
      expect(stats.selectedFiles).toBeGreaterThanOrEqual(0);
      expect(stats.excludedFiles).toBeGreaterThanOrEqual(0);
      expect(stats.reductionPercentage).toBeGreaterThanOrEqual(0);
      expect(stats.averageRelevance).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getRecommendedBudget', () => {
    it('should return highest budget for monorepos', () => {
      const budget = service.getRecommendedBudget('monorepo');
      expect(budget).toBe(200_000);
    });

    it('should return moderate budget for libraries', () => {
      const budget = service.getRecommendedBudget('library');
      expect(budget).toBe(150_000);
    });

    it('should return standard budget for applications', () => {
      const budget = service.getRecommendedBudget('application');
      expect(budget).toBe(175_000);
    });

    it('should return conservative budget for unknown types', () => {
      const budget = service.getRecommendedBudget('unknown');
      expect(budget).toBe(150_000);
    });
  });

  describe('getRecommendedResponseReserve', () => {
    it('should reserve more tokens for code generation queries', async () => {
      const reserve = await service.getRecommendedResponseReserve(
        'generate authentication service'
      );
      expect(reserve).toBe(75_000);
    });

    it('should reserve standard tokens for explanation queries', async () => {
      const reserve = await service.getRecommendedResponseReserve(
        'how does authentication work'
      );
      expect(reserve).toBe(50_000);
    });

    it('should reserve minimal tokens for simple queries', async () => {
      const reserve = await service.getRecommendedResponseReserve('list files');
      expect(reserve).toBe(30_000);
    });

    it('should handle refactoring queries', async () => {
      const reserve = await service.getRecommendedResponseReserve(
        'refactor user service to use dependency injection'
      );
      expect(reserve).toBe(75_000);
    });
  });

  describe('optimizeWithAdaptiveBudget', () => {
    it('should use monorepo budget for large codebases', async () => {
      const files: IndexedFile[] = Array.from({ length: 1000 }, (_, i) => ({
        path: `/workspace/file${i}.ts`,
        relativePath: `file${i}.ts`,
        type: FileType.Source,
        size: 1000,
        estimatedTokens: 100,
      }));

      const rankedFiles = new Map(
        files.map((file, index) => [file, 100 - index * 0.1])
      );
      mockRelevanceScorer.rankFiles.mockReturnValue(rankedFiles);

      const result = await service.optimizeWithAdaptiveBudget(
        files,
        'test query'
      );

      // Should use monorepo budget (200,000 tokens)
      expect(result.stats.totalFiles).toBe(1000);
      expect(result.selectedFiles.length).toBeGreaterThan(0);
    });

    it('should use application budget for small codebases', async () => {
      const files: IndexedFile[] = Array.from({ length: 50 }, (_, i) => ({
        path: `/workspace/file${i}.ts`,
        relativePath: `file${i}.ts`,
        type: FileType.Source,
        size: 1000,
        estimatedTokens: 100,
      }));

      const rankedFiles = new Map(
        files.map((file, index) => [file, 100 - index * 2])
      );
      mockRelevanceScorer.rankFiles.mockReturnValue(rankedFiles);

      const result = await service.optimizeWithAdaptiveBudget(
        files,
        'generate new feature'
      );

      // Uses application budget + code generation reserve
      expect(result.selectedFiles.length).toBeGreaterThan(0);
    });
  });

  describe('Integration scenarios', () => {
    it('should optimize for typical Claude CLI use case', async () => {
      // Simulate real workspace with various file types
      const files: IndexedFile[] = [
        {
          path: '/workspace/src/auth/auth.service.ts',
          relativePath: 'src/auth/auth.service.ts',
          type: FileType.Source,
          size: 3000,
          language: 'typescript',
          estimatedTokens: 750,
        },
        {
          path: '/workspace/src/auth/auth.guard.ts',
          relativePath: 'src/auth/auth.guard.ts',
          type: FileType.Source,
          size: 1500,
          language: 'typescript',
          estimatedTokens: 375,
        },
        {
          path: '/workspace/README.md',
          relativePath: 'README.md',
          type: FileType.Documentation,
          size: 2000,
          estimatedTokens: 500,
        },
        {
          path: '/workspace/package.json',
          relativePath: 'package.json',
          type: FileType.Config,
          size: 500,
          estimatedTokens: 125,
        },
      ];

      // Rank auth files highly for auth query
      mockRelevanceScorer.rankFiles.mockReturnValue(
        new Map([
          [files[0], 95], // auth.service.ts
          [files[1], 90], // auth.guard.ts
          [files[2], 20], // README.md
          [files[3], 10], // package.json
        ])
      );

      const result = await service.optimizeContext({
        files,
        query: 'how does authentication work',
        maxTokens: 2000,
        responseReserve: 500,
      });

      // Available: 2000 - 500 = 1500 tokens
      // Should select: auth.service.ts (750) + auth.guard.ts (375) + package.json (125) = 1250 tokens
      expect(result.selectedFiles.length).toBeGreaterThanOrEqual(2);
      expect(result.selectedFiles[0].relativePath).toContain('auth');
      expect(result.totalTokens).toBeLessThanOrEqual(1500);
    });
  });

  describe('Performance', () => {
    it('should optimize 1000 files in under 100ms', async () => {
      const files: IndexedFile[] = Array.from({ length: 1000 }, (_, i) => ({
        path: `/workspace/file${i}.ts`,
        relativePath: `file${i}.ts`,
        type: FileType.Source,
        size: 1000,
        estimatedTokens: 250,
      }));

      const rankedFiles = new Map(
        files.map((file, index) => [file, 100 - index * 0.1])
      );
      mockRelevanceScorer.rankFiles.mockReturnValue(rankedFiles);

      const start = Date.now();
      await service.optimizeContext({
        files,
        query: 'test',
      });
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100);
    });
  });
});
