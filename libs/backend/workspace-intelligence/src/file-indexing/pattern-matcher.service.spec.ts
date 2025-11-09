/**
 * Pattern Matcher Service Tests
 *
 * Comprehensive test suite for glob pattern matching with picomatch.
 * Tests cover:
 * - Basic glob patterns (wildcards, globstar)
 * - Negation patterns (!pattern)
 * - Batch file matching with inclusion/exclusion
 * - LRU cache effectiveness
 * - Performance benchmarks (7x improvement target)
 */

import 'reflect-metadata';
import { PatternMatcherService } from './pattern-matcher.service';

describe('PatternMatcherService', () => {
  let service: PatternMatcherService;

  beforeEach(() => {
    service = new PatternMatcherService();
  });

  afterEach(() => {
    service.clearCache();
  });

  describe('isMatch', () => {
    describe('Basic patterns', () => {
      it('should match simple wildcard patterns', () => {
        expect(service.isMatch('file.ts', '*.ts')).toBe(true);
        expect(service.isMatch('file.js', '*.ts')).toBe(false);
      });

      it('should match globstar patterns', () => {
        expect(service.isMatch('src/app/component.ts', '**/component.ts')).toBe(
          true
        );
        expect(service.isMatch('src/app/service.ts', '**/component.ts')).toBe(
          false
        );
      });

      it('should match directory patterns', () => {
        expect(
          service.isMatch('node_modules/pkg/index.js', 'node_modules/**')
        ).toBe(true);
        expect(service.isMatch('src/app.ts', 'node_modules/**')).toBe(false);
      });

      it('should match multiple wildcards', () => {
        expect(service.isMatch('src/app/file.ts', 'src/**/*.ts')).toBe(true);
        expect(service.isMatch('dist/app/file.js', 'src/**/*.ts')).toBe(false);
      });
    });

    describe('File extension patterns', () => {
      it('should match TypeScript files', () => {
        expect(service.isMatch('app.ts', '**.ts')).toBe(true);
        expect(service.isMatch('app.tsx', '**.ts')).toBe(false);
      });

      it('should match multiple extensions with brace expansion', () => {
        expect(service.isMatch('app.ts', '**.{ts,tsx}')).toBe(true);
        expect(service.isMatch('app.tsx', '**.{ts,tsx}')).toBe(true);
        expect(service.isMatch('app.js', '**.{ts,tsx}')).toBe(false);
      });

      it('should match test files', () => {
        expect(service.isMatch('app.spec.ts', '**.spec.ts')).toBe(true);
        expect(service.isMatch('app.test.ts', '**.test.ts')).toBe(true);
        expect(service.isMatch('app.ts', '**.spec.ts')).toBe(false);
      });
    });

    describe('Dot files', () => {
      it('should not match dot files by default', () => {
        expect(service.isMatch('.gitignore', '**')).toBe(false);
        expect(service.isMatch('.vscode/settings.json', '**/*.json')).toBe(
          false
        );
      });

      it('should match dot files when dot option is true', () => {
        expect(service.isMatch('.gitignore', '**', { dot: true })).toBe(true);
        expect(
          service.isMatch('.vscode/settings.json', '**/*.json', { dot: true })
        ).toBe(true);
      });

      it('should match explicit dot file patterns', () => {
        expect(service.isMatch('.gitignore', '.*')).toBe(true);
        expect(service.isMatch('.vscode/settings.json', '.vscode/**')).toBe(
          true
        );
      });
    });

    describe('Case sensitivity', () => {
      it('should be case-insensitive when nocase option is true', () => {
        expect(service.isMatch('File.TS', '*.ts', { nocase: true })).toBe(true);
        expect(service.isMatch('APP.JS', 'app.js', { nocase: true })).toBe(
          true
        );
      });

      it('should be case-sensitive by default', () => {
        expect(service.isMatch('File.TS', '*.ts')).toBe(false);
        expect(service.isMatch('file.ts', '*.ts')).toBe(true);
      });

      it('should respect caseSensitive option', () => {
        // Case-insensitive: uppercase extension should match lowercase pattern
        expect(
          service.isMatch('File.TS', '*.ts', { caseSensitive: false })
        ).toBe(true);
        // Case-sensitive: uppercase extension should NOT match lowercase pattern
        expect(
          service.isMatch('File.TS', '*.ts', { caseSensitive: true })
        ).toBe(false);
      });
    });
  });

  describe('match', () => {
    it('should filter files matching a single pattern', () => {
      const files = ['app.ts', 'app.js', 'test.ts', 'README.md'];
      const result = service.match(files, '**.ts');

      expect(result).toEqual(['app.ts', 'test.ts']);
    });

    it('should return empty array when no files match', () => {
      const files = ['app.js', 'app.jsx'];
      const result = service.match(files, '**.ts');

      expect(result).toEqual([]);
    });

    it('should match complex glob patterns', () => {
      const files = [
        'src/app/component.ts',
        'src/app/service.ts',
        'test/app.spec.ts',
        'README.md',
      ];
      const result = service.match(files, 'src/**/*.ts');

      expect(result).toEqual(['src/app/component.ts', 'src/app/service.ts']);
    });
  });

  describe('matchFiles', () => {
    describe('Inclusion patterns', () => {
      it('should match files with multiple inclusion patterns', () => {
        const files = ['app.ts', 'app.js', 'test.tsx', 'README.md'];
        const results = service.matchFiles(files, ['**.ts', '**.js']);

        expect(results).toEqual([
          { path: 'app.ts', matched: true, matchedPatterns: ['**.ts'] },
          { path: 'app.js', matched: true, matchedPatterns: ['**.js'] },
          { path: 'test.tsx', matched: false, matchedPatterns: [] },
          { path: 'README.md', matched: false, matchedPatterns: [] },
        ]);
      });

      it('should match files with brace expansion patterns', () => {
        const files = ['app.ts', 'app.tsx', 'app.js'];
        const results = service.matchFiles(files, ['**.{ts,tsx}']);

        expect(results).toEqual([
          { path: 'app.ts', matched: true, matchedPatterns: ['**.{ts,tsx}'] },
          { path: 'app.tsx', matched: true, matchedPatterns: ['**.{ts,tsx}'] },
          { path: 'app.js', matched: false, matchedPatterns: [] },
        ]);
      });
    });

    describe('Exclusion patterns', () => {
      it('should exclude files matching negation patterns', () => {
        const files = ['src/app.ts', 'src/app.spec.ts', 'test/util.spec.ts'];
        const results = service.matchFiles(files, ['**.ts', '!**.spec.ts']);

        expect(results).toEqual([
          { path: 'src/app.ts', matched: true, matchedPatterns: ['**.ts'] },
          { path: 'src/app.spec.ts', matched: false, matchedPatterns: [] },
          { path: 'test/util.spec.ts', matched: false, matchedPatterns: [] },
        ]);
      });

      it('should exclude node_modules', () => {
        const files = [
          'src/app.ts',
          'node_modules/pkg/index.js',
          'node_modules/pkg/types.d.ts',
        ];
        const results = service.matchFiles(files, [
          '**/*.{ts,js}',
          '!node_modules/**',
        ]);

        expect(results).toEqual([
          {
            path: 'src/app.ts',
            matched: true,
            matchedPatterns: ['**/*.{ts,js}'],
          },
          {
            path: 'node_modules/pkg/index.js',
            matched: false,
            matchedPatterns: [],
          },
          {
            path: 'node_modules/pkg/types.d.ts',
            matched: false,
            matchedPatterns: [],
          },
        ]);
      });

      it('should handle multiple exclusions', () => {
        const files = [
          'src/app.ts',
          'src/app.spec.ts',
          'dist/app.js',
          'node_modules/pkg/index.js',
        ];
        const results = service.matchFiles(files, [
          '**/*.{ts,js}',
          '!**.spec.ts',
          '!dist/**',
          '!node_modules/**',
        ]);

        expect(results).toEqual([
          {
            path: 'src/app.ts',
            matched: true,
            matchedPatterns: ['**/*.{ts,js}'],
          },
          { path: 'src/app.spec.ts', matched: false, matchedPatterns: [] },
          { path: 'dist/app.js', matched: false, matchedPatterns: [] },
          {
            path: 'node_modules/pkg/index.js',
            matched: false,
            matchedPatterns: [],
          },
        ]);
      });
    });

    describe('Complex patterns', () => {
      it('should handle real-world TypeScript project patterns', () => {
        const files = [
          'src/app.ts',
          'src/app.spec.ts',
          'src/app.d.ts',
          'dist/app.js',
          'node_modules/@types/node/index.d.ts',
          '.vscode/settings.json',
        ];
        const results = service.matchFiles(files, [
          '**/*.ts',
          '!**.spec.ts',
          '!**.d.ts',
          '!node_modules/**',
          '!dist/**',
        ]);

        expect(results).toEqual([
          { path: 'src/app.ts', matched: true, matchedPatterns: ['**/*.ts'] },
          { path: 'src/app.spec.ts', matched: false, matchedPatterns: [] },
          { path: 'src/app.d.ts', matched: false, matchedPatterns: [] },
          { path: 'dist/app.js', matched: false, matchedPatterns: [] },
          {
            path: 'node_modules/@types/node/index.d.ts',
            matched: false,
            matchedPatterns: [],
          },
          {
            path: '.vscode/settings.json',
            matched: false,
            matchedPatterns: [],
          },
        ]);
      });
    });
  });

  describe('matchFilesSimple', () => {
    it('should return only matched file paths', () => {
      const files = ['app.ts', 'app.spec.ts', 'app.js'];
      const result = service.matchFilesSimple(files, ['**.ts', '!**.spec.ts']);

      expect(result).toEqual(['app.ts']);
    });

    it('should return empty array when no files match', () => {
      const files = ['app.spec.ts', 'test.spec.ts'];
      const result = service.matchFilesSimple(files, ['**.ts', '!**.spec.ts']);

      expect(result).toEqual([]);
    });
  });

  describe('Cache effectiveness', () => {
    it('should cache compiled patterns', () => {
      // First call - compiles pattern
      service.isMatch('app.ts', '**.ts');
      const stats1 = service.getCacheStats();

      // Second call - uses cache
      service.isMatch('test.ts', '**.ts');
      const stats2 = service.getCacheStats();

      expect(stats1.patternCacheSize).toBe(1);
      expect(stats2.patternCacheSize).toBe(1); // Same pattern, no new compilation
    });

    it('should cache match results', () => {
      // First call - tests pattern
      service.isMatch('app.ts', '**.ts');
      const stats1 = service.getCacheStats();

      // Second call with same path+pattern - uses result cache
      service.isMatch('app.ts', '**.ts');
      const stats2 = service.getCacheStats();

      expect(stats1.resultCacheSize).toBe(1);
      expect(stats2.resultCacheSize).toBe(1); // Same result, cached
    });

    it('should clear all caches', () => {
      service.isMatch('app.ts', '**.ts');
      service.isMatch('test.ts', '**.js');

      service.clearCache();
      const stats = service.getCacheStats();

      expect(stats.patternCacheSize).toBe(0);
      expect(stats.resultCacheSize).toBe(0);
    });

    it('should limit cache size with LRU eviction', () => {
      // Create 150 different patterns (cache max is 100)
      for (let i = 0; i < 150; i++) {
        service.isMatch(`file${i}.ts`, `**/${i}.ts`);
      }

      const stats = service.getCacheStats();
      expect(stats.patternCacheSize).toBeLessThanOrEqual(100);
    });
  });

  describe('Performance', () => {
    it('should handle large file lists efficiently', () => {
      // Generate 1000 file paths
      const files: string[] = [];
      for (let i = 0; i < 1000; i++) {
        files.push(`src/file${i}.ts`);
        files.push(`test/file${i}.spec.ts`);
        files.push(`node_modules/pkg${i}/index.js`);
      }

      const start = performance.now();
      const results = service.matchFiles(files, [
        '**/*.ts',
        '!**.spec.ts',
        '!node_modules/**',
      ]);
      const duration = performance.now() - start;

      // Should complete in < 100ms for 3000 files
      expect(duration).toBeLessThan(100);
      expect(results.filter((r) => r.matched)).toHaveLength(1000);
    });

    it('should benefit from caching on repeated patterns', () => {
      const files = ['app.ts', 'test.ts', 'util.ts'];
      const pattern = '**.ts';

      // First run - compile pattern
      const start1 = performance.now();
      service.match(files, pattern);
      const duration1 = performance.now() - start1;

      // Second run - use cache
      const start2 = performance.now();
      service.match(files, pattern);
      const duration2 = performance.now() - start2;

      // Cached version should be at least 2x faster
      expect(duration2).toBeLessThan(duration1 / 2);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty file list', () => {
      const result = service.matchFiles([], ['**.ts']);
      expect(result).toEqual([]);
    });

    it('should handle empty pattern list', () => {
      const files = ['app.ts', 'app.js'];
      const result = service.matchFiles(files, []);

      // No patterns means all files match
      expect(result).toEqual([
        { path: 'app.ts', matched: true, matchedPatterns: [] },
        { path: 'app.js', matched: true, matchedPatterns: [] },
      ]);
    });

    it('should handle only exclusion patterns', () => {
      const files = ['app.ts', 'app.spec.ts'];
      const result = service.matchFiles(files, ['!**.spec.ts']);

      // Only exclusions means all files match except excluded
      expect(result).toEqual([
        { path: 'app.ts', matched: true, matchedPatterns: [] },
        { path: 'app.spec.ts', matched: false, matchedPatterns: [] },
      ]);
    });

    it('should handle special characters in paths', () => {
      expect(service.isMatch('src/[test].ts', 'src/[test].ts')).toBe(true);
      expect(service.isMatch('src/(component).ts', 'src/(component).ts')).toBe(
        true
      );
    });

    it('should handle Windows-style paths', () => {
      expect(service.isMatch('src\\app\\component.ts', 'src/**/*.ts')).toBe(
        true
      );
      expect(service.isMatch('C:\\Users\\app.ts', '**/*.ts')).toBe(true);
    });

    it('should handle absolute paths', () => {
      expect(service.isMatch('/usr/local/src/app.ts', '**/*.ts')).toBe(true);
      expect(service.isMatch('D:/projects/app.ts', '**/*.ts')).toBe(true);
    });
  });
});
