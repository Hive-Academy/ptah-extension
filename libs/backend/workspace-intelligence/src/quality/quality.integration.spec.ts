/**
 * Integration Tests for Quality Assessment Pipeline
 *
 * Tests the full quality assessment pipeline from file sampling
 * to prescriptive guidance generation with real fixtures.
 */

import 'reflect-metadata';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { AntiPatternDetectionService } from './services/anti-pattern-detection.service';
import { PrescriptiveGuidanceService } from './services/prescriptive-guidance.service';
import { RuleRegistry, ALL_RULES } from './rules';
import type { SampledFile } from './interfaces';
import type {
  QualityAssessment,
  WorkspaceContext,
  AntiPattern,
} from '@ptah-extension/shared';
import { Logger } from '@ptah-extension/vscode-core';

// Mock VS Code API
jest.mock('vscode', () => ({
  Uri: {
    file: (fsPath: string) => ({ fsPath, scheme: 'file' }),
  },
}));

// ============================================
// Test Fixtures
// ============================================

/**
 * Creates a mock logger for testing
 */
function createMockLogger(): jest.Mocked<Logger> {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    lifecycle: jest.fn(),
    dispose: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

/**
 * Test fixture files with known anti-patterns
 */
const TEST_FIXTURES: Record<string, string> = {
  // TypeScript anti-patterns
  'any-usage.ts': `
/**
 * File with explicit any usage
 */
export function processData(data: any): any {
  const result: any = {};
  result.value = data;
  return result;
}

export const handler = (input: any) => {
  return input;
};
`,

  // Error handling anti-patterns
  'bad-error-handling.ts': `
/**
 * File with poor error handling
 */
export async function fetchData(url: string): Promise<void> {
  try {
    const response = await fetch(url);
    await response.json();
  } catch (e) { }

  try {
    await someOperation();
  } catch (error) {
    console.log(error);
  }
}

async function someOperation(): Promise<void> {
  // Implementation
}
`,

  // Architecture anti-patterns
  'too-many-imports.ts': `
import { A } from './a';
import { B } from './b';
import { C } from './c';
import { D } from './d';
import { E } from './e';
import { F } from './f';
import { G } from './g';
import { H } from './h';
import { I } from './i';
import { J } from './j';
import { K } from './k';
import { L } from './l';
import { M } from './m';
import { N } from './n';
import { O } from './o';
import { P } from './p';

export function doSomething(): void {
  // Uses all imports
}
`,

  // Clean file (no anti-patterns)
  'clean.ts': `
/**
 * A clean TypeScript file with no anti-patterns
 */
export interface User {
  id: string;
  name: string;
  email: string;
}

export function createUser(data: Partial<User>): User {
  return {
    id: data.id ?? generateId(),
    name: data.name ?? 'Anonymous',
    email: data.email ?? 'unknown@example.com',
  };
}

function generateId(): string {
  return Math.random().toString(36).substring(2);
}
`,

  // Mixed anti-patterns
  'mixed-issues.ts': `
// @ts-ignore
const legacyCode = badFunction();

export function handleRequest(req: any): void {
  try {
    process(req);
  } catch (e) { }
}

const data = obj!.nested!.value;

function process(request: any): void {
  console.log(request);
}
`,
};

/**
 * Configuration-only file (should be handled gracefully)
 */
const CONFIG_ONLY_FIXTURES: Record<string, string> = {
  'package.json': `{
  "name": "test-project",
  "version": "1.0.0"
}`,
  'tsconfig.json': `{
  "compilerOptions": {
    "target": "ES2022",
    "strict": true
  }
}`,
  '.eslintrc.json': `{
  "extends": ["eslint:recommended"]
}`,
};

// ============================================
// Integration Test Suite
// ============================================

describe('Quality Assessment Pipeline Integration', () => {
  let tempDir: string;
  let antiPatternService: AntiPatternDetectionService;
  let guidanceService: PrescriptiveGuidanceService;
  let mockLogger: jest.Mocked<Logger>;

  beforeAll(() => {
    // Create temporary directory for test fixtures
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-test-'));

    // Write test fixture files
    for (const [filename, content] of Object.entries(TEST_FIXTURES)) {
      fs.writeFileSync(path.join(tempDir, filename), content, 'utf-8');
    }
  });

  afterAll(() => {
    // Clean up temporary directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    mockLogger = createMockLogger();
    antiPatternService = new AntiPatternDetectionService(mockLogger);
    guidanceService = new PrescriptiveGuidanceService(mockLogger);
  });

  describe('Full Pipeline: Detection to Guidance', () => {
    it('should detect anti-patterns and generate guidance for problematic files', async () => {
      // Arrange: Create sampled files from fixtures
      const sampledFiles: SampledFile[] = Object.entries(TEST_FIXTURES)
        .filter(([name]) => name.endsWith('.ts'))
        .map(([name, content]) => ({
          path: name,
          content,
          language: 'typescript',
          estimatedTokens: Math.ceil(content.length / 4),
        }));

      // Act: Detect patterns
      const antiPatterns =
        await antiPatternService.detectPatternsInFiles(sampledFiles);

      // Assert: Patterns detected
      expect(antiPatterns.length).toBeGreaterThan(0);

      // Verify specific patterns detected
      const patternTypes = antiPatterns.map((p) => p.type);
      expect(patternTypes).toContain('typescript-explicit-any');
      expect(patternTypes).toContain('error-empty-catch');
      expect(patternTypes).toContain('typescript-ts-ignore');
      expect(patternTypes).toContain('arch-too-many-imports');
    });

    it('should calculate quality score accurately', async () => {
      // Arrange
      const sampledFiles: SampledFile[] = Object.entries(TEST_FIXTURES)
        .filter(([name]) => name.endsWith('.ts'))
        .map(([name, content]) => ({
          path: name,
          content,
          language: 'typescript',
          estimatedTokens: Math.ceil(content.length / 4),
        }));

      // Act
      const antiPatterns =
        await antiPatternService.detectPatternsInFiles(sampledFiles);
      const score = antiPatternService.calculateScore(
        antiPatterns,
        sampledFiles.length,
      );

      // Assert: Score should reflect issues
      expect(score).toBeLessThan(100);
      expect(score).toBeGreaterThan(0);

      // With multiple issues, score should be meaningfully reduced
      expect(score).toBeLessThan(80);
    });

    it('should generate prescriptive guidance from assessment', async () => {
      // Arrange
      const sampledFiles: SampledFile[] = Object.entries(TEST_FIXTURES)
        .filter(([name]) => name.endsWith('.ts'))
        .map(([name, content]) => ({
          path: name,
          content,
          language: 'typescript',
          estimatedTokens: Math.ceil(content.length / 4),
        }));

      const antiPatterns =
        await antiPatternService.detectPatternsInFiles(sampledFiles);
      const score = antiPatternService.calculateScore(
        antiPatterns,
        sampledFiles.length,
      );

      const assessment: QualityAssessment = {
        score,
        antiPatterns,
        gaps: [],
        strengths: [],
        sampledFiles: sampledFiles.map((f) => f.path),
        analysisTimestamp: Date.now(),
        analysisDurationMs: 50,
      };

      const context: WorkspaceContext = {
        projectType: 'node',
        isMonorepo: false,
        dependencies: [],
        devDependencies: [],
        languages: ['TypeScript'],
        architecturePatterns: [],
      };

      // Act
      const guidance = guidanceService.generateGuidance(assessment, context);

      // Assert
      expect(guidance.summary).toBeDefined();
      expect(guidance.recommendations.length).toBeGreaterThan(0);
      expect(guidance.totalTokens).toBeGreaterThan(0);

      // Verify recommendations address detected issues
      const categories = guidance.recommendations.map((r) =>
        r.category.toLowerCase(),
      );
      expect(
        categories.some((c) => c.includes('typescript') || c.includes('error')),
      ).toBe(true);
    });

    it('should handle clean codebase correctly', async () => {
      // Arrange: Only clean file
      const sampledFiles: SampledFile[] = [
        {
          path: 'clean.ts',
          content: TEST_FIXTURES['clean.ts'],
          language: 'typescript',
          estimatedTokens: 100,
        },
      ];

      // Act
      const antiPatterns =
        await antiPatternService.detectPatternsInFiles(sampledFiles);
      const score = antiPatternService.calculateScore(antiPatterns, 1);

      // Assert
      expect(antiPatterns.length).toBe(0);
      expect(score).toBe(100);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty file list', async () => {
      // Act
      const antiPatterns = await antiPatternService.detectPatternsInFiles([]);
      const score = antiPatternService.calculateScore([], 0);

      // Assert
      expect(antiPatterns.length).toBe(0);
      expect(score).toBe(100);
    });

    it('should handle config-only workspace gracefully', async () => {
      // Arrange: Files that shouldn't be analyzed (wrong extensions)
      const configFiles: SampledFile[] = Object.entries(
        CONFIG_ONLY_FIXTURES,
      ).map(([name, content]) => ({
        path: name,
        content,
        language: name.endsWith('.json') ? 'json' : 'unknown',
        estimatedTokens: Math.ceil(content.length / 4),
      }));

      // Act: JSON files won't match TypeScript rules
      const antiPatterns =
        await antiPatternService.detectPatternsInFiles(configFiles);
      const score = antiPatternService.calculateScore(
        antiPatterns,
        configFiles.length,
      );

      // Assert: No patterns for non-source files
      expect(antiPatterns.length).toBe(0);
      expect(score).toBe(100);
    });

    it('should handle files with mixed extensions', async () => {
      // Arrange
      const mixedFiles: SampledFile[] = [
        {
          path: 'script.ts',
          content: 'const x: any = 1;',
          language: 'typescript',
          estimatedTokens: 10,
        },
        {
          path: 'data.json',
          content: '{"key": "value"}',
          language: 'json',
          estimatedTokens: 5,
        },
        {
          path: 'readme.md',
          content: '# Readme',
          language: 'markdown',
          estimatedTokens: 2,
        },
      ];

      // Act
      const antiPatterns =
        await antiPatternService.detectPatternsInFiles(mixedFiles);

      // Assert: Only TypeScript file should have patterns detected
      expect(antiPatterns.length).toBe(1);
      expect(antiPatterns[0].type).toBe('typescript-explicit-any');
    });

    it('should handle very large files within reasonable limits', async () => {
      // Arrange: Generate a large file
      const largeContent = Array(600).fill('const x = 1;').join('\n');
      const largeFile: SampledFile = {
        path: 'large-file.ts',
        content: largeContent,
        language: 'typescript',
        estimatedTokens: 2400,
      };

      // Act
      const antiPatterns = await antiPatternService.detectPatternsInFiles([
        largeFile,
      ]);

      // Assert: Should detect arch-file-too-large
      expect(antiPatterns.some((p) => p.type === 'arch-file-too-large')).toBe(
        true,
      );
    });
  });

  describe('Pattern Frequency Aggregation', () => {
    it('should correctly aggregate same pattern across multiple files', async () => {
      // Arrange: Multiple files with same issue
      const files: SampledFile[] = [
        {
          path: 'file1.ts',
          content: 'const a: any = 1;',
          language: 'typescript',
          estimatedTokens: 10,
        },
        {
          path: 'file2.ts',
          content: 'const b: any = 2;',
          language: 'typescript',
          estimatedTokens: 10,
        },
        {
          path: 'file3.ts',
          content: 'const c: any = 3;',
          language: 'typescript',
          estimatedTokens: 10,
        },
      ];

      // Act
      const antiPatterns =
        await antiPatternService.detectPatternsInFiles(files);

      // Assert: All occurrences aggregated into one entry
      const anyPatterns = antiPatterns.filter(
        (p) => p.type === 'typescript-explicit-any',
      );
      expect(anyPatterns.length).toBe(1);
      expect(anyPatterns[0].frequency).toBe(3);
    });

    it('should track affected files in aggregated message', async () => {
      // Arrange
      const files: SampledFile[] = [
        {
          path: 'a.ts',
          content: 'const x: any = 1;',
          language: 'typescript',
          estimatedTokens: 10,
        },
        {
          path: 'b.ts',
          content: 'const y: any = 2;',
          language: 'typescript',
          estimatedTokens: 10,
        },
      ];

      // Act
      const antiPatterns =
        await antiPatternService.detectPatternsInFiles(files);

      // Assert
      expect(antiPatterns[0].message).toContain('2 files');
    });
  });

  describe('Guidance Token Budget', () => {
    it('should truncate recommendations when budget exceeded', () => {
      // Arrange: Create assessment with many patterns
      const manyPatterns: AntiPattern[] = Array(15)
        .fill(null)
        .map((_, i) => ({
          type: `pattern-${i}` as 'typescript-explicit-any',
          severity: 'warning' as const,
          location: { file: `file${i}.ts` },
          message: `Issue ${i}`,
          suggestion: `Fix issue ${i} by doing something specific`,
          frequency: i + 1,
        }));

      const assessment: QualityAssessment = {
        score: 40,
        antiPatterns: manyPatterns,
        gaps: [],
        strengths: [],
        sampledFiles: [],
        analysisTimestamp: Date.now(),
        analysisDurationMs: 50,
      };

      const context: WorkspaceContext = {
        projectType: 'node',
        isMonorepo: false,
        dependencies: [],
        devDependencies: [],
        languages: ['TypeScript'],
        architecturePatterns: [],
      };

      // Act: Generate with small budget
      const guidance = guidanceService.generateGuidance(
        assessment,
        context,
        250, // Very small budget
      );

      // Assert
      expect(guidance.wasTruncated).toBe(true);
      expect(guidance.recommendations.length).toBeLessThan(15);
      expect(guidance.totalTokens).toBeLessThanOrEqual(250);
    });

    it('should always include at least one recommendation', () => {
      // Arrange
      const patterns: AntiPattern[] = [
        {
          type: 'typescript-explicit-any',
          severity: 'warning',
          location: { file: 'test.ts' },
          message: 'Any usage',
          suggestion: 'Fix',
          frequency: 1,
        },
      ];

      const assessment: QualityAssessment = {
        score: 90,
        antiPatterns: patterns,
        gaps: [],
        strengths: [],
        sampledFiles: [],
        analysisTimestamp: Date.now(),
        analysisDurationMs: 10,
      };

      const context: WorkspaceContext = {
        projectType: 'node',
        isMonorepo: false,
        dependencies: [],
        devDependencies: [],
        languages: ['TypeScript'],
        architecturePatterns: [],
      };

      // Act: Generate with tiny budget
      const guidance = guidanceService.generateGuidance(
        assessment,
        context,
        50, // Tiny budget
      );

      // Assert: Still has at least one recommendation
      expect(guidance.recommendations.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Rule Registry Integration', () => {
    it('should have all rule categories represented', () => {
      const categories = new Set(ALL_RULES.map((r) => r.category));

      expect(categories.has('typescript')).toBe(true);
      expect(categories.has('error-handling')).toBe(true);
      expect(categories.has('architecture')).toBe(true);
      expect(categories.has('testing')).toBe(true);
    });

    it('should filter rules by extension correctly', () => {
      const registry = new RuleRegistry();

      const tsRules = registry.getRulesForExtension('.ts');
      const specRules = registry.getRulesForExtension('.spec.ts');

      // .ts should get TypeScript, error handling, and architecture rules
      expect(tsRules.length).toBeGreaterThan(5);

      // .spec.ts should only get testing rules
      expect(specRules.length).toBe(2);
      expect(specRules.every((r) => r.category === 'testing')).toBe(true);
    });

    it('should allow rule configuration', () => {
      const registry = new RuleRegistry();

      // Disable a rule
      registry.configureRule('typescript-explicit-any', { enabled: false });

      const rules = registry.getRules();
      const anyRule = rules.find((r) => r.id === 'typescript-explicit-any');

      expect(anyRule).toBeUndefined();

      // Re-enable
      registry.configureRule('typescript-explicit-any', { enabled: true });

      const rulesAfter = registry.getRules();
      const anyRuleAfter = rulesAfter.find(
        (r) => r.id === 'typescript-explicit-any',
      );

      expect(anyRuleAfter).toBeDefined();
    });
  });

  describe('Performance', () => {
    it('should complete analysis in reasonable time', async () => {
      // Arrange
      const sampledFiles: SampledFile[] = Object.entries(TEST_FIXTURES)
        .filter(([name]) => name.endsWith('.ts'))
        .map(([name, content]) => ({
          path: name,
          content,
          language: 'typescript',
          estimatedTokens: Math.ceil(content.length / 4),
        }));

      const startTime = Date.now();

      // Act
      const antiPatterns =
        await antiPatternService.detectPatternsInFiles(sampledFiles);
      const score = antiPatternService.calculateScore(
        antiPatterns,
        sampledFiles.length,
      );

      const assessment: QualityAssessment = {
        score,
        antiPatterns,
        gaps: [],
        strengths: [],
        sampledFiles: sampledFiles.map((f) => f.path),
        analysisTimestamp: Date.now(),
        analysisDurationMs: 0,
      };

      const context: WorkspaceContext = {
        projectType: 'node',
        isMonorepo: false,
        dependencies: [],
        devDependencies: [],
        languages: ['TypeScript'],
        architecturePatterns: [],
      };

      guidanceService.generateGuidance(assessment, context);

      const duration = Date.now() - startTime;

      // Assert: Should complete quickly for small fixture set
      expect(duration).toBeLessThan(1000); // Less than 1 second
    });

    it('should handle batch of 50 files within performance target', async () => {
      // Arrange: Create 50 files
      const files: SampledFile[] = Array(50)
        .fill(null)
        .map((_, i) => ({
          path: `file${i}.ts`,
          content: `
            const value${i}: any = ${i};
            try { doSomething(); } catch (e) { }
            // @ts-ignore
            const legacy${i} = bad();
          `,
          language: 'typescript',
          estimatedTokens: 50,
        }));

      const startTime = Date.now();

      // Act
      const antiPatterns =
        await antiPatternService.detectPatternsInFiles(files);
      antiPatternService.calculateScore(antiPatterns, files.length);

      const duration = Date.now() - startTime;

      // Assert: Should complete within 5 seconds (NFR-001 requirement)
      expect(duration).toBeLessThan(5000);
    });
  });
});
