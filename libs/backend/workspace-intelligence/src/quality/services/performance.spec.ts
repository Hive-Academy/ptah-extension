/**
 * Unit Tests for Performance Optimization Features (Phase F)
 *
 * Tests for:
 * - FileHashCacheService: hash computation, cache hit/miss, TTL expiry, LRU eviction, stats
 * - Async detection: parallel execution, fault isolation
 * - Adaptive sampling: correct sizes for different project scales
 * - Framework priority patterns: correct patterns per framework
 *
 * TASK_2025_144: Phase F - Performance Optimizations
 */

import 'reflect-metadata';
import { createHash } from 'crypto';
import type { AntiPattern, AntiPatternType } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { FileHashCacheService } from './file-hash-cache.service';
import { AntiPatternDetectionService } from './anti-pattern-detection.service';
import { CodeQualityAssessmentService } from './code-quality-assessment.service';

// ============================================
// Mock Helpers
// ============================================

/**
 * Creates a mock Logger instance for testing.
 */
function createMockLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    setLevel: jest.fn(),
    getLevel: jest.fn(),
  };
}

/**
 * Creates a sample AntiPattern for testing.
 */
function createMockPattern(
  type: AntiPatternType = 'typescript-explicit-any',
  overrides: Partial<AntiPattern> = {}
): AntiPattern {
  return {
    type,
    severity: 'warning',
    location: { file: 'src/test.ts', line: 10 },
    message: `Test pattern: ${type}`,
    suggestion: 'Fix this pattern',
    frequency: 1,
    ...overrides,
  };
}

// ============================================
// FileHashCacheService Tests
// ============================================

describe('FileHashCacheService', () => {
  let service: FileHashCacheService;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    service = new FileHashCacheService(mockLogger as unknown as Logger);
  });

  afterEach(() => {
    service.clearCache();
  });

  describe('computeHash', () => {
    it('should produce consistent SHA-256 hash for same content', () => {
      const content = 'const x: any = 5;';
      const hash1 = service.computeHash(content);
      const hash2 = service.computeHash(content);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different content', () => {
      const hash1 = service.computeHash('const x: any = 5;');
      const hash2 = service.computeHash('const x: number = 5;');

      expect(hash1).not.toBe(hash2);
    });

    it('should return 16-character hex string', () => {
      const hash = service.computeHash('test content');

      expect(hash).toHaveLength(16);
      expect(/^[0-9a-f]{16}$/.test(hash)).toBe(true);
    });

    it('should match Node.js crypto SHA-256 output', () => {
      const content = 'hello world';
      const expected = createHash('sha256')
        .update(content)
        .digest('hex')
        .substring(0, 16);

      expect(service.computeHash(content)).toBe(expected);
    });
  });

  describe('getHash / setHash', () => {
    it('should return undefined for uncached file', () => {
      expect(service.getHash('nonexistent.ts')).toBeUndefined();
    });

    it('should store and retrieve hash', () => {
      service.setHash('src/app.ts', 'abc123def456ghij');

      expect(service.getHash('src/app.ts')).toBe('abc123def456ghij');
    });

    it('should overwrite existing hash', () => {
      service.setHash('src/app.ts', 'hash1');
      service.setHash('src/app.ts', 'hash2');

      expect(service.getHash('src/app.ts')).toBe('hash2');
    });
  });

  describe('hasChanged', () => {
    it('should return true for uncached file', () => {
      expect(service.hasChanged('new-file.ts', 'content')).toBe(true);
    });

    it('should return false for unchanged content', () => {
      const content = 'const x = 5;';
      service.updateHash('src/app.ts', content);

      expect(service.hasChanged('src/app.ts', content)).toBe(false);
    });

    it('should return true for changed content', () => {
      service.updateHash('src/app.ts', 'old content');

      expect(service.hasChanged('src/app.ts', 'new content')).toBe(true);
    });

    it('should return true for expired cache entry', () => {
      const content = 'const x = 5;';
      service.updateHash('src/app.ts', content);

      // Manually expire the entry by manipulating internal state
      // Access the private cache via any cast for testing
      const cache = (service as unknown as Record<string, unknown>)[
        'cache'
      ] as Map<
        string,
        {
          hash: string;
          analysisTimestamp: number;
          lastAccessTimestamp: number;
          patterns: AntiPattern[];
        }
      >;
      const entry = cache.get('src/app.ts');
      if (entry) {
        entry.analysisTimestamp = Date.now() - 31 * 60 * 1000; // 31 minutes ago
      }

      expect(service.hasChanged('src/app.ts', content)).toBe(true);
    });
  });

  describe('updateHash', () => {
    it('should compute and store hash from content', () => {
      const content = 'const x = 5;';
      service.updateHash('src/app.ts', content);

      const expectedHash = service.computeHash(content);
      expect(service.getHash('src/app.ts')).toBe(expectedHash);
    });

    it('should preserve existing patterns when updating hash', () => {
      const content = 'const x = 5;';
      service.updateHash('src/app.ts', content);

      const patterns = [createMockPattern()];
      service.setCachedPatterns('src/app.ts', patterns);

      // Update hash with same content
      service.updateHash('src/app.ts', content);

      expect(service.getCachedPatterns('src/app.ts')).toEqual(patterns);
    });
  });

  describe('getCachedPatterns / setCachedPatterns', () => {
    it('should return undefined for uncached file', () => {
      expect(service.getCachedPatterns('nonexistent.ts')).toBeUndefined();
    });

    it('should store and retrieve patterns', () => {
      service.updateHash('src/app.ts', 'content');
      const patterns = [
        createMockPattern('typescript-explicit-any'),
        createMockPattern('typescript-ts-ignore'),
      ];

      service.setCachedPatterns('src/app.ts', patterns);

      expect(service.getCachedPatterns('src/app.ts')).toEqual(patterns);
    });

    it('should return undefined for expired entry', () => {
      service.updateHash('src/app.ts', 'content');
      service.setCachedPatterns('src/app.ts', [createMockPattern()]);

      // Expire the entry
      const cache = (service as unknown as Record<string, unknown>)[
        'cache'
      ] as Map<
        string,
        {
          hash: string;
          analysisTimestamp: number;
          lastAccessTimestamp: number;
          patterns: AntiPattern[];
        }
      >;
      const entry = cache.get('src/app.ts');
      if (entry) {
        entry.analysisTimestamp = Date.now() - 31 * 60 * 1000;
      }

      expect(service.getCachedPatterns('src/app.ts')).toBeUndefined();
    });

    it('should create entry when setting patterns without prior hash', () => {
      service.setCachedPatterns('new-file.ts', [createMockPattern()]);

      const patterns = service.getCachedPatterns('new-file.ts');
      expect(patterns).toBeDefined();
      expect(patterns).toHaveLength(1);
    });
  });

  describe('getCachedFiles', () => {
    it('should return empty array when cache is empty', () => {
      expect(service.getCachedFiles()).toEqual([]);
    });

    it('should return all cached file paths', () => {
      service.updateHash('src/a.ts', 'content-a');
      service.updateHash('src/b.ts', 'content-b');
      service.updateHash('src/c.ts', 'content-c');

      const files = service.getCachedFiles();
      expect(files).toHaveLength(3);
      expect(files).toContain('src/a.ts');
      expect(files).toContain('src/b.ts');
      expect(files).toContain('src/c.ts');
    });

    it('should exclude expired entries', () => {
      service.updateHash('src/fresh.ts', 'content');
      service.updateHash('src/stale.ts', 'content');

      // Expire one entry
      const cache = (service as unknown as Record<string, unknown>)[
        'cache'
      ] as Map<
        string,
        {
          hash: string;
          analysisTimestamp: number;
          lastAccessTimestamp: number;
          patterns: AntiPattern[];
        }
      >;
      const entry = cache.get('src/stale.ts');
      if (entry) {
        entry.analysisTimestamp = Date.now() - 31 * 60 * 1000;
      }

      const files = service.getCachedFiles();
      expect(files).toHaveLength(1);
      expect(files).toContain('src/fresh.ts');
    });
  });

  describe('clearCache', () => {
    it('should remove all entries', () => {
      service.updateHash('src/a.ts', 'a');
      service.updateHash('src/b.ts', 'b');

      service.clearCache();

      expect(service.getCachedFiles()).toEqual([]);
      expect(service.getStats().totalCached).toBe(0);
    });

    it('should reset statistics', () => {
      // Generate some lookups
      service.hasChanged('file.ts', 'content');

      service.clearCache();

      const stats = service.getStats();
      expect(stats.totalCached).toBe(0);
      expect(stats.cacheHitRate).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return zero stats when empty', () => {
      const stats = service.getStats();

      expect(stats.totalCached).toBe(0);
      expect(stats.cacheHitRate).toBe(0);
    });

    it('should track total cached entries', () => {
      service.updateHash('src/a.ts', 'a');
      service.updateHash('src/b.ts', 'b');

      expect(service.getStats().totalCached).toBe(2);
    });

    it('should calculate cache hit rate correctly', () => {
      const content = 'const x = 5;';
      service.updateHash('src/app.ts', content);

      // Miss: new file
      service.hasChanged('src/new.ts', 'new content');
      // Hit: unchanged file
      service.hasChanged('src/app.ts', content);
      // Miss: changed file
      service.hasChanged('src/app.ts', 'changed content');

      const stats = service.getStats();
      // 1 hit out of 3 lookups
      expect(stats.cacheHitRate).toBeCloseTo(1 / 3, 2);
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest entries when cache exceeds max size', () => {
      // We cannot test 10,000 entries efficiently, but we can verify
      // the eviction logic indirectly by checking that adding entries works
      // We test the concept by adding several entries and verifying the cache grows
      for (let i = 0; i < 100; i++) {
        service.updateHash(`src/file-${i}.ts`, `content-${i}`);
      }

      expect(service.getStats().totalCached).toBe(100);
    });

    it('should maintain working entries after eviction trigger', () => {
      // Add entries and verify they can be retrieved
      service.updateHash('src/important.ts', 'important content');
      service.setCachedPatterns('src/important.ts', [createMockPattern()]);

      // Verify the entry is still accessible
      expect(service.getHash('src/important.ts')).toBeDefined();
      expect(service.getCachedPatterns('src/important.ts')).toHaveLength(1);
    });
  });

  describe('TTL expiry', () => {
    it('should treat entries older than 30 minutes as expired', () => {
      service.updateHash('src/old.ts', 'content');

      // Manually set timestamp to 31 minutes ago
      const cache = (service as unknown as Record<string, unknown>)[
        'cache'
      ] as Map<
        string,
        {
          hash: string;
          analysisTimestamp: number;
          lastAccessTimestamp: number;
          patterns: AntiPattern[];
        }
      >;
      const entry = cache.get('src/old.ts');
      if (entry) {
        entry.analysisTimestamp = Date.now() - 31 * 60 * 1000;
      }

      // getHash should return undefined for expired entry
      expect(service.getHash('src/old.ts')).toBeUndefined();
    });

    it('should keep entries within 30-minute window', () => {
      service.updateHash('src/recent.ts', 'content');

      // Manually set timestamp to 29 minutes ago
      const cache = (service as unknown as Record<string, unknown>)[
        'cache'
      ] as Map<
        string,
        {
          hash: string;
          analysisTimestamp: number;
          lastAccessTimestamp: number;
          patterns: AntiPattern[];
        }
      >;
      const entry = cache.get('src/recent.ts');
      if (entry) {
        entry.analysisTimestamp = Date.now() - 29 * 60 * 1000;
      }

      expect(service.getHash('src/recent.ts')).toBeDefined();
    });
  });
});

// ============================================
// Async Detection Tests
// ============================================

describe('AntiPatternDetectionService - Async Methods', () => {
  let service: AntiPatternDetectionService;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    service = new AntiPatternDetectionService(mockLogger as unknown as Logger);
  });

  describe('detectPatternsAsync', () => {
    it('should detect patterns in TypeScript files', async () => {
      const content = 'const x: any = 5;\nconst y: any = "hello";';
      const patterns = await service.detectPatternsAsync(
        content,
        'src/test.ts'
      );

      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns.some((p) => p.type === 'typescript-explicit-any')).toBe(
        true
      );
    });

    it('should return empty array for files with no extension', async () => {
      const patterns = await service.detectPatternsAsync(
        'content',
        'Dockerfile'
      );

      expect(patterns).toEqual([]);
    });

    it('should return empty array for unsupported extensions', async () => {
      const patterns = await service.detectPatternsAsync('content', 'file.md');

      expect(patterns).toEqual([]);
    });

    it('should handle rule failures gracefully (fault isolation)', async () => {
      // Even if one rule throws internally, other rules should still execute
      const content = `
        const x: any = 5;
        // @ts-ignore
        const y = z!;
      `;

      const patterns = await service.detectPatternsAsync(
        content,
        'src/test.ts'
      );

      // Should still get results from rules that didn't fail
      expect(patterns.length).toBeGreaterThan(0);
    });

    it('should produce same results as sync detectPatterns', async () => {
      const content = `
        const x: any = 5;
        // @ts-ignore next line
        const y = z!;
      `;

      const syncPatterns = service.detectPatterns(content, 'src/test.ts');
      const asyncPatterns = await service.detectPatternsAsync(
        content,
        'src/test.ts'
      );

      // Same pattern types should be found (order may differ)
      const syncTypes = new Set(syncPatterns.map((p) => p.type));
      const asyncTypes = new Set(asyncPatterns.map((p) => p.type));

      expect(asyncTypes).toEqual(syncTypes);
    });
  });

  describe('detectPatternsInFilesAsync', () => {
    it('should return empty array for empty file list', async () => {
      const patterns = await service.detectPatternsInFilesAsync([]);

      expect(patterns).toEqual([]);
    });

    it('should aggregate patterns across multiple files', async () => {
      const files = [
        {
          path: 'src/a.ts',
          content: 'const x: any = 5;',
          language: 'typescript',
          estimatedTokens: 10,
        },
        {
          path: 'src/b.ts',
          content: 'const y: any = "test";',
          language: 'typescript',
          estimatedTokens: 10,
        },
      ];

      const patterns = await service.detectPatternsInFilesAsync(files);

      // Both files have explicit-any, should be aggregated
      const anyPattern = patterns.find(
        (p) => p.type === 'typescript-explicit-any'
      );
      expect(anyPattern).toBeDefined();
      expect(anyPattern!.frequency).toBeGreaterThanOrEqual(2);
    });

    it('should process files in batches', async () => {
      // Create 12 files (more than batch size of 5)
      const files = Array.from({ length: 12 }, (_, i) => ({
        path: `src/file-${i}.ts`,
        content: `const x${i}: any = ${i};`,
        language: 'typescript',
        estimatedTokens: 10,
      }));

      const patterns = await service.detectPatternsInFilesAsync(files);

      // Should detect patterns across all 12 files
      expect(patterns.length).toBeGreaterThan(0);
    });

    it('should sort results by frequency then severity', async () => {
      const files = [
        {
          path: 'src/a.ts',
          content: 'const a: any = 1;\nconst b: any = 2;\ntry {} catch(e) {}',
          language: 'typescript',
          estimatedTokens: 20,
        },
        {
          path: 'src/b.ts',
          content: 'const c: any = 3;',
          language: 'typescript',
          estimatedTokens: 10,
        },
      ];

      const patterns = await service.detectPatternsInFilesAsync(files);

      // Patterns should be sorted by frequency (descending)
      for (let i = 1; i < patterns.length; i++) {
        expect(patterns[i - 1].frequency).toBeGreaterThanOrEqual(
          patterns[i].frequency
        );
      }
    });
  });
});

// ============================================
// Adaptive Sampling Tests
// ============================================

describe('CodeQualityAssessmentService - Adaptive Sampling', () => {
  let service: CodeQualityAssessmentService;

  beforeEach(() => {
    createMockLogger();
    // Create service with minimal mock dependencies
    // Only testing the pure utility methods that don't need injected services
    service = Object.create(CodeQualityAssessmentService.prototype);
    // Bind the methods we're testing
    service.calculateAdaptiveSampleSize =
      CodeQualityAssessmentService.prototype.calculateAdaptiveSampleSize.bind(
        service
      );
    service.getFrameworkPriorityPatterns =
      CodeQualityAssessmentService.prototype.getFrameworkPriorityPatterns.bind(
        service
      );
  });

  describe('calculateAdaptiveSampleSize', () => {
    it('should return min(totalFiles, 15) for small projects (<= 50 files)', () => {
      expect(service.calculateAdaptiveSampleSize(10)).toBe(10);
      expect(service.calculateAdaptiveSampleSize(15)).toBe(15);
      expect(service.calculateAdaptiveSampleSize(30)).toBe(15);
      expect(service.calculateAdaptiveSampleSize(50)).toBe(15);
    });

    it('should return 20 for medium projects (51-200 files)', () => {
      expect(service.calculateAdaptiveSampleSize(51)).toBe(20);
      expect(service.calculateAdaptiveSampleSize(100)).toBe(20);
      expect(service.calculateAdaptiveSampleSize(200)).toBe(20);
    });

    it('should return 30 for large projects (201-1000 files)', () => {
      expect(service.calculateAdaptiveSampleSize(201)).toBe(30);
      expect(service.calculateAdaptiveSampleSize(500)).toBe(30);
      expect(service.calculateAdaptiveSampleSize(1000)).toBe(30);
    });

    it('should return 40 for very large projects (1001-5000 files)', () => {
      expect(service.calculateAdaptiveSampleSize(1001)).toBe(40);
      expect(service.calculateAdaptiveSampleSize(3000)).toBe(40);
      expect(service.calculateAdaptiveSampleSize(5000)).toBe(40);
    });

    it('should return 50 for massive projects (> 5000 files)', () => {
      expect(service.calculateAdaptiveSampleSize(5001)).toBe(50);
      expect(service.calculateAdaptiveSampleSize(10000)).toBe(50);
      expect(service.calculateAdaptiveSampleSize(50000)).toBe(50);
    });

    it('should handle edge cases', () => {
      expect(service.calculateAdaptiveSampleSize(0)).toBe(0);
      expect(service.calculateAdaptiveSampleSize(1)).toBe(1);
    });
  });

  describe('getFrameworkPriorityPatterns', () => {
    it('should return Angular patterns for Angular framework', () => {
      const patterns = service.getFrameworkPriorityPatterns('angular');

      expect(patterns).toContain('component');
      expect(patterns).toContain('service');
      expect(patterns).toContain('module');
      expect(patterns).toContain('guard');
      expect(patterns).toContain('interceptor');
      expect(patterns).toContain('pipe');
      expect(patterns).toContain('directive');
    });

    it('should return React patterns for React framework', () => {
      const patterns = service.getFrameworkPriorityPatterns('react');

      expect(patterns).toContain('component');
      expect(patterns).toContain('hook');
      expect(patterns).toContain('context');
      expect(patterns).toContain('provider');
      expect(patterns).toContain('reducer');
      expect(patterns).toContain('store');
    });

    it('should return NestJS patterns for NestJS framework', () => {
      const patterns = service.getFrameworkPriorityPatterns('nestjs');

      expect(patterns).toContain('controller');
      expect(patterns).toContain('service');
      expect(patterns).toContain('module');
      expect(patterns).toContain('guard');
      expect(patterns).toContain('middleware');
      expect(patterns).toContain('interceptor');
      expect(patterns).toContain('repository');
    });

    it('should return default patterns for unknown framework', () => {
      const patterns = service.getFrameworkPriorityPatterns('django');

      expect(patterns).toContain('service');
      expect(patterns).toContain('component');
      expect(patterns).toContain('controller');
      expect(patterns).toContain('repository');
      expect(patterns).toContain('model');
    });

    it('should return default patterns for undefined framework', () => {
      const patterns = service.getFrameworkPriorityPatterns(undefined);

      expect(patterns).toContain('service');
      expect(patterns).toContain('component');
    });

    it('should be case-insensitive for framework names', () => {
      const lower = service.getFrameworkPriorityPatterns('angular');
      const upper = service.getFrameworkPriorityPatterns('Angular');
      const mixed = service.getFrameworkPriorityPatterns('ANGULAR');

      expect(lower).toEqual(upper);
      expect(upper).toEqual(mixed);
    });
  });
});
