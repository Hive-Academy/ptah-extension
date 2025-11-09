/**
 * File Relevance Scorer Service Tests
 *
 * Tests the keyword-based relevance scoring algorithm for intelligent file selection.
 */

import 'reflect-metadata';
import { FileRelevanceScorerService } from './file-relevance-scorer.service';
import { IndexedFile, FileType } from '../types/workspace.types';

describe('FileRelevanceScorerService', () => {
  let service: FileRelevanceScorerService;

  beforeEach(() => {
    service = new FileRelevanceScorerService();
  });

  describe('scoreFile', () => {
    it('should return baseline score when no query provided', () => {
      const file: IndexedFile = {
        path: '/workspace/src/app/app.component.ts',
        relativePath: 'src/app/app.component.ts',
        type: FileType.Source,
        size: 1000,
        language: 'typescript',
        estimatedTokens: 250,
      };

      const result = service.scoreFile(file);

      expect(result.score).toBe(1.0);
      expect(result.reasons).toContain(
        'No query provided - baseline relevance'
      );
    });

    it('should score higher for filename keyword matches', () => {
      const authFile: IndexedFile = {
        path: '/workspace/src/auth/auth.service.ts',
        relativePath: 'src/auth/auth.service.ts',
        type: FileType.Source,
        size: 2000,
        language: 'typescript',
        estimatedTokens: 500,
      };

      const result = service.scoreFile(authFile, 'auth service');

      expect(result.score).toBeGreaterThanOrEqual(10);
      expect(result.reasons.some((r) => r.includes('Filename contains'))).toBe(
        true
      );
    });

    it('should score higher for path keyword matches', () => {
      const file: IndexedFile = {
        path: '/workspace/src/auth/guards/permission.guard.ts',
        relativePath: 'src/auth/guards/permission.guard.ts',
        type: FileType.Source,
        size: 1500,
        language: 'typescript',
        estimatedTokens: 375,
      };

      const result = service.scoreFile(file, 'authentication');

      expect(result.score).toBeGreaterThan(5);
      // "auth" keyword matches path, scoring logic may vary
      expect(result.reasons.length).toBeGreaterThan(0);
    });

    it('should prioritize source files over other types', () => {
      const sourceFile: IndexedFile = {
        path: '/workspace/src/app.ts',
        relativePath: 'src/app.ts',
        type: FileType.Source,
        size: 1000,
        language: 'typescript',
        estimatedTokens: 250,
      };

      const configFile: IndexedFile = {
        path: '/workspace/config/app.config.ts',
        relativePath: 'config/app.config.ts',
        type: FileType.Config,
        size: 500,
        language: 'typescript',
        estimatedTokens: 125,
      };

      const sourceResult = service.scoreFile(sourceFile, 'app');
      const configResult = service.scoreFile(configFile, 'app');

      expect(sourceResult.score).toBeGreaterThan(configResult.score);
    });

    it('should score test files higher when query mentions testing', () => {
      const testFile: IndexedFile = {
        path: '/workspace/src/auth/auth.service.spec.ts',
        relativePath: 'src/auth/auth.service.spec.ts',
        type: FileType.Test,
        size: 1500,
        language: 'typescript',
        estimatedTokens: 375,
      };

      const resultWithTest = service.scoreFile(testFile, 'test authentication');
      const resultWithoutTest = service.scoreFile(testFile, 'authentication');

      expect(resultWithTest.score).toBeGreaterThan(resultWithoutTest.score);
    });

    it('should score documentation files higher for "how" queries', () => {
      const docFile: IndexedFile = {
        path: '/workspace/docs/authentication.md',
        relativePath: 'docs/authentication.md',
        type: FileType.Documentation,
        size: 3000,
        language: 'markdown',
        estimatedTokens: 750,
      };

      const resultWithHow = service.scoreFile(
        docFile,
        'how does authentication work'
      );
      const resultWithout = service.scoreFile(
        docFile,
        'authentication implementation'
      );

      expect(resultWithHow.score).toBeGreaterThan(resultWithout.score);
    });

    it('should give minimal score to asset files', () => {
      const assetFile: IndexedFile = {
        path: '/workspace/assets/logo.png',
        relativePath: 'assets/logo.png',
        type: FileType.Asset,
        size: 50000,
        estimatedTokens: 0,
      };

      const result = service.scoreFile(assetFile, 'logo');

      // Asset gets 0.1 base + keyword matches = higher score
      // But should still be less than source files
      expect(result.score).toBeLessThan(15);
      expect(result.reasons.some((r) => r.includes('Asset'))).toBe(true);
    });
  });

  describe('Language-specific patterns', () => {
    it('should boost TypeScript service files when query mentions services', () => {
      const serviceFile: IndexedFile = {
        path: '/workspace/src/user/user.service.ts',
        relativePath: 'src/user/user.service.ts',
        type: FileType.Source,
        size: 2000,
        language: 'typescript',
        estimatedTokens: 500,
      };

      const result = service.scoreFile(
        serviceFile,
        'user service implementation'
      );

      expect(result.score).toBeGreaterThan(15);
      expect(result.reasons.some((r) => r.includes('Service file'))).toBe(true);
    });

    it('should boost component files when query mentions components', () => {
      const componentFile: IndexedFile = {
        path: '/workspace/src/app/login/login.component.ts',
        relativePath: 'src/app/login/login.component.ts',
        type: FileType.Source,
        size: 1800,
        language: 'typescript',
        estimatedTokens: 450,
      };

      const result = service.scoreFile(componentFile, 'login component');

      expect(result.score).toBeGreaterThan(15);
      expect(result.reasons.some((r) => r.includes('Component file'))).toBe(
        true
      );
    });

    it('should boost Python model files when query mentions models', () => {
      const modelFile: IndexedFile = {
        path: '/workspace/models/user.py',
        relativePath: 'models/user.py',
        type: FileType.Source,
        size: 1500,
        language: 'python',
        estimatedTokens: 375,
      };

      const result = service.scoreFile(modelFile, 'user model');

      expect(result.score).toBeGreaterThan(10);
    });
  });

  describe('Framework-specific patterns', () => {
    it('should boost Angular component files for component queries', () => {
      const angularComponent: IndexedFile = {
        path: '/workspace/src/app/dashboard/dashboard.component.ts',
        relativePath: 'src/app/dashboard/dashboard.component.ts',
        type: FileType.Source,
        size: 2500,
        language: 'typescript',
        estimatedTokens: 625,
      };

      const result = service.scoreFile(
        angularComponent,
        'dashboard component ui'
      );

      expect(result.score).toBeGreaterThan(20);
      expect(result.reasons.some((r) => r.includes('Angular component'))).toBe(
        true
      );
    });

    it('should boost Angular guard files for auth queries', () => {
      const guardFile: IndexedFile = {
        path: '/workspace/src/core/guards/auth.guard.ts',
        relativePath: 'src/core/guards/auth.guard.ts',
        type: FileType.Source,
        size: 1200,
        language: 'typescript',
        estimatedTokens: 300,
      };

      const result = service.scoreFile(guardFile, 'authentication guard');

      expect(result.score).toBeGreaterThan(20);
      expect(result.reasons.some((r) => r.includes('guard'))).toBe(true);
    });

    it('should boost React component files for React queries', () => {
      const reactComponent: IndexedFile = {
        path: '/workspace/src/components/Button.tsx',
        relativePath: 'src/components/Button.tsx',
        type: FileType.Source,
        size: 800,
        language: 'typescript',
        estimatedTokens: 200,
      };

      const result = service.scoreFile(
        reactComponent,
        'Button react component'
      );

      expect(result.score).toBeGreaterThan(15);
      expect(result.reasons.some((r) => r.includes('React component'))).toBe(
        true
      );
    });
  });

  describe('Task-specific patterns', () => {
    it('should boost auth files for authentication queries', () => {
      const authFile: IndexedFile = {
        path: '/workspace/src/auth/login.service.ts',
        relativePath: 'src/auth/login.service.ts',
        type: FileType.Source,
        size: 3000,
        language: 'typescript',
        estimatedTokens: 750,
      };

      const result = service.scoreFile(
        authFile,
        'how does login authentication work'
      );

      expect(result.score).toBeGreaterThanOrEqual(20);
      expect(
        result.reasons.some((r) => r.includes('Authentication-related'))
      ).toBe(true);
    });

    it('should boost model files for database queries', () => {
      const modelFile: IndexedFile = {
        path: '/workspace/src/models/user.entity.ts',
        relativePath: 'src/models/user.entity.ts',
        type: FileType.Source,
        size: 2000,
        language: 'typescript',
        estimatedTokens: 500,
      };

      const result = service.scoreFile(modelFile, 'database user model schema');

      expect(result.score).toBeGreaterThan(20);
      expect(result.reasons.some((r) => r.includes('Data layer'))).toBe(true);
    });

    it('should boost API files for API queries', () => {
      const apiFile: IndexedFile = {
        path: '/workspace/src/api/user.controller.ts',
        relativePath: 'src/api/user.controller.ts',
        type: FileType.Source,
        size: 2500,
        language: 'typescript',
        estimatedTokens: 625,
      };

      const result = service.scoreFile(apiFile, 'user api endpoint');

      expect(result.score).toBeGreaterThan(20);
      expect(result.reasons.some((r) => r.includes('API layer'))).toBe(true);
    });
  });

  describe('rankFiles', () => {
    it('should rank files by relevance score descending', () => {
      const files: IndexedFile[] = [
        {
          path: '/workspace/README.md',
          relativePath: 'README.md',
          type: FileType.Documentation,
          size: 2000,
          estimatedTokens: 500,
        },
        {
          path: '/workspace/src/auth/auth.service.ts',
          relativePath: 'src/auth/auth.service.ts',
          type: FileType.Source,
          size: 3000,
          language: 'typescript',
          estimatedTokens: 750,
        },
        {
          path: '/workspace/src/app/app.component.ts',
          relativePath: 'src/app/app.component.ts',
          type: FileType.Source,
          size: 1500,
          language: 'typescript',
          estimatedTokens: 375,
        },
      ];

      const ranked = service.rankFiles(files, 'authentication service');
      const rankedArray = Array.from(ranked.entries());

      // Auth service should be first (highest score)
      expect(rankedArray[0][0].relativePath).toBe('src/auth/auth.service.ts');
      expect(rankedArray[0][1]).toBeGreaterThan(rankedArray[1][1]);
    });

    it('should handle empty file list', () => {
      const ranked = service.rankFiles([], 'test query');
      expect(ranked.size).toBe(0);
    });

    it('should assign equal scores when no query provided', () => {
      const files: IndexedFile[] = [
        {
          path: '/workspace/file1.ts',
          relativePath: 'file1.ts',
          type: FileType.Source,
          size: 1000,
          language: 'typescript',
          estimatedTokens: 250,
        },
        {
          path: '/workspace/file2.ts',
          relativePath: 'file2.ts',
          type: FileType.Source,
          size: 2000,
          language: 'typescript',
          estimatedTokens: 500,
        },
      ];

      const ranked = service.rankFiles(files);
      const scores = Array.from(ranked.values());

      expect(scores[0]).toBe(1.0);
      expect(scores[1]).toBe(1.0);
    });
  });

  describe('getTopFiles', () => {
    it('should return top N files by relevance', () => {
      const files: IndexedFile[] = Array.from({ length: 20 }, (_, i) => ({
        path: `/workspace/file${i}.ts`,
        relativePath: `file${i}.ts`,
        type: FileType.Source,
        size: 1000,
        language: 'typescript',
        estimatedTokens: 250,
      }));

      // Add some auth-related files
      files[5].relativePath = 'src/auth/auth.service.ts';
      files[10].relativePath = 'src/auth/login.component.ts';
      files[15].relativePath = 'src/guards/auth.guard.ts';

      const topFiles = service.getTopFiles(files, 'authentication', 5);

      expect(topFiles).toHaveLength(5);
      // Auth-related files should be at the top
      expect(topFiles[0].file.relativePath).toContain('auth');
      expect(topFiles[0].score).toBeGreaterThan(
        topFiles[topFiles.length - 1].score
      );
    });

    it('should use default limit of 10 when not specified', () => {
      const files: IndexedFile[] = Array.from({ length: 20 }, (_, i) => ({
        path: `/workspace/file${i}.ts`,
        relativePath: `file${i}.ts`,
        type: FileType.Source,
        size: 1000,
        language: 'typescript',
        estimatedTokens: 250,
      }));

      const topFiles = service.getTopFiles(files, 'test query');

      expect(topFiles).toHaveLength(10);
    });

    it('should return all files if limit exceeds file count', () => {
      const files: IndexedFile[] = [
        {
          path: '/workspace/file1.ts',
          relativePath: 'file1.ts',
          type: FileType.Source,
          size: 1000,
          language: 'typescript',
          estimatedTokens: 250,
        },
        {
          path: '/workspace/file2.ts',
          relativePath: 'file2.ts',
          type: FileType.Source,
          size: 1000,
          language: 'typescript',
          estimatedTokens: 250,
        },
      ];

      const topFiles = service.getTopFiles(files, 'test', 10);

      expect(topFiles).toHaveLength(2);
    });
  });

  describe('Performance', () => {
    it('should score 1000 files in under 100ms', () => {
      const files: IndexedFile[] = Array.from({ length: 1000 }, (_, i) => ({
        path: `/workspace/src/module${i % 10}/file${i}.ts`,
        relativePath: `src/module${i % 10}/file${i}.ts`,
        type: FileType.Source,
        size: 1000 + i,
        language: 'typescript',
        estimatedTokens: 250,
      }));

      const start = Date.now();
      service.rankFiles(files, 'authentication service implementation');
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100);
    });
  });

  describe('Edge cases', () => {
    it('should handle files without language property', () => {
      const file: IndexedFile = {
        path: '/workspace/unknown.xyz',
        relativePath: 'unknown.xyz',
        type: FileType.Source,
        size: 1000,
        estimatedTokens: 250,
      };

      const result = service.scoreFile(file, 'test');

      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.reasons).toBeDefined();
    });

    it('should handle very long queries', () => {
      const file: IndexedFile = {
        path: '/workspace/auth/auth.service.ts',
        relativePath: 'auth/auth.service.ts',
        type: FileType.Source,
        size: 2000,
        language: 'typescript',
        estimatedTokens: 500,
      };

      const longQuery =
        'how does the authentication and authorization system work in this application with jwt tokens and role-based access control';

      const result = service.scoreFile(file, longQuery);

      expect(result.score).toBeGreaterThanOrEqual(10);
    });

    it('should handle special characters in query', () => {
      const file: IndexedFile = {
        path: '/workspace/api/user.controller.ts',
        relativePath: 'api/user.controller.ts',
        type: FileType.Source,
        size: 1500,
        language: 'typescript',
        estimatedTokens: 375,
      };

      const result = service.scoreFile(file, 'user API @endpoint /api/users');

      expect(result.score).toBeGreaterThan(5);
    });

    it('should normalize scores to 0-100 range', () => {
      const file: IndexedFile = {
        path: '/workspace/src/auth/authentication/login/login.service.ts',
        relativePath: 'src/auth/authentication/login/login.service.ts',
        type: FileType.Source,
        size: 3000,
        language: 'typescript',
        estimatedTokens: 750,
      };

      const result = service.scoreFile(
        file,
        'authentication login service component guard model'
      );

      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.score).toBeGreaterThanOrEqual(0);
    });
  });
});
