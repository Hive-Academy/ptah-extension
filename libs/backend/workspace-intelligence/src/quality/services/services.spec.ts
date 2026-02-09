/**
 * Unit Tests for Quality Assessment Services
 *
 * Tests all quality assessment services with mocked dependencies:
 * - AntiPatternDetectionService
 * - CodeQualityAssessmentService
 * - PrescriptiveGuidanceService
 * - ProjectIntelligenceService
 *
 * TASK_2025_141: Unified Project Intelligence with Code Quality Assessment
 */

import 'reflect-metadata';
import { AntiPatternDetectionService } from './anti-pattern-detection.service';
import { CodeQualityAssessmentService } from './code-quality-assessment.service';
import { PrescriptiveGuidanceService } from './prescriptive-guidance.service';
import { ProjectIntelligenceService } from './project-intelligence.service';
import { Logger } from '@ptah-extension/vscode-core';
import { WorkspaceIndexerService } from '../../file-indexing/workspace-indexer.service';
import { FileSystemService } from '../../services/file-system.service';
import { FileRelevanceScorerService } from '../../context-analysis/file-relevance-scorer.service';
import { ProjectDetectorService } from '../../project-analysis/project-detector.service';
import { FrameworkDetectorService } from '../../project-analysis/framework-detector.service';
import { MonorepoDetectorService } from '../../project-analysis/monorepo-detector.service';
import { DependencyAnalyzerService } from '../../project-analysis/dependency-analyzer.service';
import type { SampledFile } from '../interfaces';
import type {
  QualityAssessment,
  WorkspaceContext,
  AntiPattern,
} from '@ptah-extension/shared';
import { FileType, Framework } from '../../types/workspace.types';
import type { IndexedFile, FileIndex } from '../../types/workspace.types';
import * as vscode from 'vscode';

// Mock VS Code API
jest.mock('vscode', () => ({
  Uri: {
    file: (path: string) => ({ fsPath: path, scheme: 'file' }),
  },
}));

// ============================================
// Mock Logger Factory
// ============================================

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

// ============================================
// AntiPatternDetectionService Tests
// ============================================

describe('AntiPatternDetectionService', () => {
  let service: AntiPatternDetectionService;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    service = new AntiPatternDetectionService(mockLogger);
  });

  describe('detectPatterns', () => {
    it('should detect explicit any type in TypeScript file', () => {
      const content = `
function processData(data: any) {
  return data;
}
`;
      const patterns = service.detectPatterns(content, 'src/service.ts');

      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns.some((p) => p.type === 'typescript-explicit-any')).toBe(
        true
      );
    });

    it('should detect @ts-ignore comment', () => {
      const content = `
// @ts-ignore
const invalid = badCode();
`;
      const patterns = service.detectPatterns(content, 'src/hack.ts');

      expect(patterns.some((p) => p.type === 'typescript-ts-ignore')).toBe(
        true
      );
    });

    it('should detect empty catch block', () => {
      const content = `
try {
  riskyOperation();
} catch (e) { }
`;
      const patterns = service.detectPatterns(content, 'src/handler.ts');

      expect(patterns.some((p) => p.type === 'error-empty-catch')).toBe(true);
    });

    it('should return empty array for clean code', () => {
      const content = `
function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
`;
      const patterns = service.detectPatterns(content, 'src/greet.ts');

      expect(patterns.length).toBe(0);
    });

    it('should return empty array for unsupported file extension', () => {
      const content = `
def process(data):
    return data
`;
      const patterns = service.detectPatterns(content, 'src/script.py');

      expect(patterns.length).toBe(0);
    });

    it('should return empty array for file without extension', () => {
      const content = 'some content';
      const patterns = service.detectPatterns(content, 'Dockerfile');

      expect(patterns.length).toBe(0);
    });

    it('should include suggestion for each detected pattern', () => {
      const content = `const data: any = null;`;
      const patterns = service.detectPatterns(content, 'src/file.ts');

      expect(patterns.length).toBe(1);
      expect(patterns[0].suggestion).toBeDefined();
      expect(patterns[0].suggestion.length).toBeGreaterThan(0);
    });

    it('should include correct location information', () => {
      const content = `const x = 1;
const data: any = null;
const y = 2;`;
      const patterns = service.detectPatterns(content, 'src/file.ts');

      expect(patterns[0].location.file).toBe('src/file.ts');
      expect(patterns[0].location.line).toBe(2);
    });
  });

  describe('detectPatternsInFiles', () => {
    it('should aggregate patterns across multiple files', () => {
      const files: SampledFile[] = [
        {
          path: 'src/file1.ts',
          content: `const a: any = 1;`,
          language: 'typescript',
          estimatedTokens: 10,
        },
        {
          path: 'src/file2.ts',
          content: `const b: any = 2;`,
          language: 'typescript',
          estimatedTokens: 10,
        },
        {
          path: 'src/file3.ts',
          content: `const c: any = 3;`,
          language: 'typescript',
          estimatedTokens: 10,
        },
      ];

      const patterns = service.detectPatternsInFiles(files);

      expect(patterns.length).toBe(1); // All same type aggregated
      expect(patterns[0].frequency).toBe(3);
    });

    it('should return empty array for empty file list', () => {
      const patterns = service.detectPatternsInFiles([]);

      expect(patterns.length).toBe(0);
    });

    it('should return empty array for files with no patterns', () => {
      const files: SampledFile[] = [
        {
          path: 'src/clean.ts',
          content: `function add(a: number, b: number): number { return a + b; }`,
          language: 'typescript',
          estimatedTokens: 20,
        },
      ];

      const patterns = service.detectPatternsInFiles(files);

      expect(patterns.length).toBe(0);
    });

    it('should sort patterns by frequency descending', () => {
      const files: SampledFile[] = [
        {
          path: 'src/file1.ts',
          content: `const a: any = 1;`,
          language: 'typescript',
          estimatedTokens: 10,
        },
        {
          path: 'src/file2.ts',
          content: `const b: any = 2;`,
          language: 'typescript',
          estimatedTokens: 10,
        },
        {
          path: 'src/file3.ts',
          content: `// @ts-ignore\nconst x = 1;`,
          language: 'typescript',
          estimatedTokens: 10,
        },
      ];

      const patterns = service.detectPatternsInFiles(files);

      // any appears twice, ts-ignore once
      expect(patterns[0].frequency).toBeGreaterThanOrEqual(
        patterns[patterns.length - 1].frequency
      );
    });

    it('should build aggregated message with file count', () => {
      const files: SampledFile[] = [
        {
          path: 'src/file1.ts',
          content: `const a: any = 1;`,
          language: 'typescript',
          estimatedTokens: 10,
        },
        {
          path: 'src/file2.ts',
          content: `const b: any = 2;`,
          language: 'typescript',
          estimatedTokens: 10,
        },
      ];

      const patterns = service.detectPatternsInFiles(files);

      expect(patterns[0].message).toContain('2 occurrences');
      expect(patterns[0].message).toContain('2 files');
    });
  });

  describe('calculateScore', () => {
    it('should return 100 for no patterns', () => {
      const score = service.calculateScore([], 10);

      expect(score).toBe(100);
    });

    it('should deduct 10 points for error severity', () => {
      const patterns: AntiPattern[] = [
        {
          type: 'error-empty-catch',
          severity: 'error',
          location: { file: 'test.ts' },
          message: 'Empty catch',
          suggestion: 'Handle error',
          frequency: 1,
        },
      ];

      const score = service.calculateScore(patterns, 1);

      expect(score).toBe(90);
    });

    it('should deduct 5 points for warning severity', () => {
      const patterns: AntiPattern[] = [
        {
          type: 'typescript-explicit-any',
          severity: 'warning',
          location: { file: 'test.ts' },
          message: 'Explicit any',
          suggestion: 'Use specific type',
          frequency: 1,
        },
      ];

      const score = service.calculateScore(patterns, 1);

      expect(score).toBe(95);
    });

    it('should deduct 2 points for info severity', () => {
      const patterns: AntiPattern[] = [
        {
          type: 'typescript-non-null-assertion',
          severity: 'info',
          location: { file: 'test.ts' },
          message: 'Non-null assertion',
          suggestion: 'Use optional chaining',
          frequency: 1,
        },
      ];

      const score = service.calculateScore(patterns, 1);

      expect(score).toBe(98);
    });

    it('should cap frequency impact at 3x multiplier', () => {
      const patterns: AntiPattern[] = [
        {
          type: 'typescript-explicit-any',
          severity: 'warning',
          location: { file: 'test.ts' },
          message: 'Explicit any',
          suggestion: 'Use specific type',
          frequency: 100, // Very high frequency
        },
      ];

      const score = service.calculateScore(patterns, 50);

      // Should only deduct 5 * 3 = 15, not 5 * 100 = 500
      expect(score).toBe(85);
    });

    it('should not go below 0', () => {
      const patterns: AntiPattern[] = Array(20).fill({
        type: 'error-empty-catch',
        severity: 'error',
        location: { file: 'test.ts' },
        message: 'Error',
        suggestion: 'Fix',
        frequency: 3,
      });

      const score = service.calculateScore(patterns, 50);

      expect(score).toBe(0);
    });

    it('should combine deductions from multiple patterns', () => {
      const patterns: AntiPattern[] = [
        {
          type: 'typescript-explicit-any',
          severity: 'warning',
          location: { file: 'test.ts' },
          message: 'Any',
          suggestion: 'Fix',
          frequency: 1,
        },
        {
          type: 'error-empty-catch',
          severity: 'error',
          location: { file: 'test.ts' },
          message: 'Empty',
          suggestion: 'Fix',
          frequency: 1,
        },
      ];

      const score = service.calculateScore(patterns, 2);

      // 100 - 5 (warning) - 10 (error) = 85
      expect(score).toBe(85);
    });
  });
});

// ============================================
// CodeQualityAssessmentService Tests
// ============================================

describe('CodeQualityAssessmentService', () => {
  let service: CodeQualityAssessmentService;
  let mockLogger: jest.Mocked<Logger>;
  let mockIndexer: jest.Mocked<WorkspaceIndexerService>;
  let mockFileSystem: jest.Mocked<FileSystemService>;
  let mockRelevanceScorer: jest.Mocked<FileRelevanceScorerService>;
  let mockAntiPatternDetector: jest.Mocked<AntiPatternDetectionService>;

  beforeEach(() => {
    mockLogger = createMockLogger();

    mockIndexer = {
      indexWorkspace: jest.fn(),
    } as unknown as jest.Mocked<WorkspaceIndexerService>;

    mockFileSystem = {
      readFile: jest.fn(),
    } as unknown as jest.Mocked<FileSystemService>;

    mockRelevanceScorer = {
      getTopFiles: jest.fn(),
    } as unknown as jest.Mocked<FileRelevanceScorerService>;

    mockAntiPatternDetector = {
      detectPatterns: jest.fn(),
      detectPatternsInFiles: jest.fn(),
      calculateScore: jest.fn(),
    } as unknown as jest.Mocked<AntiPatternDetectionService>;

    const mockFileHashCache = {
      getHash: jest.fn(),
      setHash: jest.fn(),
      hasChanged: jest.fn().mockReturnValue(true),
      updateHash: jest.fn(),
      getCachedPatterns: jest.fn(),
      setCachedPatterns: jest.fn(),
      getCachedFiles: jest.fn().mockReturnValue([]),
      clearCache: jest.fn(),
      getStats: jest.fn().mockReturnValue({ totalCached: 0, cacheHitRate: 0 }),
    };

    service = new CodeQualityAssessmentService(
      mockLogger,
      mockIndexer,
      mockFileSystem,
      mockRelevanceScorer,
      mockAntiPatternDetector,
      mockFileHashCache as never
    );
  });

  describe('sampleFiles', () => {
    const defaultConfig = {
      maxFiles: 15,
      entryPointCount: 3,
      highRelevanceCount: 8,
      randomCount: 4,
      priorityPatterns: ['service', 'component'],
      excludePatterns: ['*.spec.ts'],
    };

    it('should return empty array when workspace has no source files', async () => {
      const mockFileIndex: FileIndex = {
        files: [],
        ignoredPatterns: [],
        totalFiles: 0,
        totalSize: 0,
      };
      mockIndexer.indexWorkspace.mockResolvedValue(mockFileIndex);

      const workspaceUri = vscode.Uri.file('D:\\test\\project');
      const files = await service.sampleFiles(workspaceUri, defaultConfig);

      expect(files.length).toBe(0);
    });

    it('should filter out test files', async () => {
      const indexedFiles: IndexedFile[] = [
        {
          path: 'D:\\test\\src\\service.ts',
          relativePath: 'src/service.ts',
          size: 100,
          estimatedTokens: 50,
          type: FileType.Source,
        },
        {
          path: 'D:\\test\\src\\service.spec.ts',
          relativePath: 'src/service.spec.ts',
          size: 200,
          estimatedTokens: 100,
          type: FileType.Test,
        },
      ];

      const mockFileIndex: FileIndex = {
        files: indexedFiles,
        ignoredPatterns: [],
        totalFiles: 2,
        totalSize: 300,
      };
      mockIndexer.indexWorkspace.mockResolvedValue(mockFileIndex);

      mockRelevanceScorer.getTopFiles.mockReturnValue([]);
      mockFileSystem.readFile.mockResolvedValue('file content');

      const workspaceUri = vscode.Uri.file('D:\\test\\project');
      const files = await service.sampleFiles(workspaceUri, defaultConfig);

      // Only the non-test file should be sampled
      expect(files.length).toBe(1);
      expect(files[0].path).toBe('src/service.ts');
    });

    it('should filter out declaration files', async () => {
      const indexedFiles: IndexedFile[] = [
        {
          path: 'D:\\test\\src\\types.d.ts',
          relativePath: 'src/types.d.ts',
          size: 100,
          estimatedTokens: 50,
          type: FileType.Source,
        },
        {
          path: 'D:\\test\\src\\utils.ts',
          relativePath: 'src/utils.ts',
          size: 100,
          estimatedTokens: 50,
          type: FileType.Source,
        },
      ];

      const mockFileIndex: FileIndex = {
        files: indexedFiles,
        ignoredPatterns: [],
        totalFiles: 2,
        totalSize: 200,
      };
      mockIndexer.indexWorkspace.mockResolvedValue(mockFileIndex);

      mockRelevanceScorer.getTopFiles.mockReturnValue([]);
      mockFileSystem.readFile.mockResolvedValue('file content');

      const workspaceUri = vscode.Uri.file('D:\\test\\project');
      const files = await service.sampleFiles(workspaceUri, defaultConfig);

      expect(files.length).toBe(1);
      expect(files[0].path).toBe('src/utils.ts');
    });

    it('should prioritize entry point files', async () => {
      const indexedFiles: IndexedFile[] = [
        {
          path: 'D:\\test\\src\\main.ts',
          relativePath: 'src/main.ts',
          size: 100,
          estimatedTokens: 50,
          type: FileType.Source,
        },
        {
          path: 'D:\\test\\src\\index.ts',
          relativePath: 'src/index.ts',
          size: 100,
          estimatedTokens: 50,
          type: FileType.Source,
        },
        {
          path: 'D:\\test\\src\\other.ts',
          relativePath: 'src/other.ts',
          size: 100,
          estimatedTokens: 50,
          type: FileType.Source,
        },
      ];

      const mockFileIndex: FileIndex = {
        files: indexedFiles,
        ignoredPatterns: [],
        totalFiles: 3,
        totalSize: 300,
      };
      mockIndexer.indexWorkspace.mockResolvedValue(mockFileIndex);

      mockRelevanceScorer.getTopFiles.mockReturnValue([]);
      mockFileSystem.readFile.mockResolvedValue('file content');

      const workspaceUri = vscode.Uri.file('D:\\test\\project');
      const files = await service.sampleFiles(workspaceUri, {
        ...defaultConfig,
        entryPointCount: 2,
        highRelevanceCount: 0,
        randomCount: 0,
        maxFiles: 2,
      });

      expect(files.length).toBe(2);
      const paths = files.map((f) => f.path);
      expect(paths).toContain('src/main.ts');
      expect(paths).toContain('src/index.ts');
    });

    it('should handle file read errors gracefully', async () => {
      const indexedFiles: IndexedFile[] = [
        {
          path: 'D:\\test\\src\\good.ts',
          relativePath: 'src/good.ts',
          size: 100,
          estimatedTokens: 50,
          type: FileType.Source,
        },
        {
          path: 'D:\\test\\src\\bad.ts',
          relativePath: 'src/bad.ts',
          size: 100,
          estimatedTokens: 50,
          type: FileType.Source,
        },
      ];

      const mockFileIndex: FileIndex = {
        files: indexedFiles,
        ignoredPatterns: [],
        totalFiles: 2,
        totalSize: 200,
      };
      mockIndexer.indexWorkspace.mockResolvedValue(mockFileIndex);

      mockRelevanceScorer.getTopFiles.mockReturnValue([]);
      // Make readFile succeed for good.ts, fail for bad.ts
      mockFileSystem.readFile.mockImplementation(
        async (uri: { fsPath: string }) => {
          if (uri.fsPath.includes('bad.ts')) {
            throw new Error('File read error');
          }
          return 'good content';
        }
      );

      const workspaceUri = vscode.Uri.file('D:\\test\\project');
      const files = await service.sampleFiles(workspaceUri, defaultConfig);

      expect(files.length).toBe(1);
      expect(files[0].path).toBe('src/good.ts');
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('assessQuality', () => {
    it('should return neutral assessment for empty workspace', async () => {
      const mockFileIndex: FileIndex = {
        files: [],
        ignoredPatterns: [],
        totalFiles: 0,
        totalSize: 0,
      };
      mockIndexer.indexWorkspace.mockResolvedValue(mockFileIndex);

      const workspaceUri = vscode.Uri.file('D:\\test\\project');
      const assessment = await service.assessQuality(workspaceUri);

      expect(assessment.score).toBe(50);
      expect(assessment.antiPatterns.length).toBe(0);
      expect(assessment.gaps.length).toBe(1);
      expect(assessment.gaps[0].area).toBe('Analysis');
    });

    it('should calculate assessment with antiPatterns', async () => {
      const indexedFiles: IndexedFile[] = [
        {
          path: 'D:\\test\\src\\service.ts',
          relativePath: 'src/service.ts',
          size: 100,
          estimatedTokens: 50,
          type: FileType.Source,
        },
      ];

      const mockFileIndex: FileIndex = {
        files: indexedFiles,
        ignoredPatterns: [],
        totalFiles: 1,
        totalSize: 100,
      };
      mockIndexer.indexWorkspace.mockResolvedValue(mockFileIndex);

      mockFileSystem.readFile.mockResolvedValue('const x: any = 1;');
      mockRelevanceScorer.getTopFiles.mockReturnValue([]);

      const mockPatterns: AntiPattern[] = [
        {
          type: 'typescript-explicit-any',
          severity: 'warning',
          location: { file: 'src/service.ts', line: 1 },
          message: 'Explicit any',
          suggestion: 'Use specific type',
          frequency: 1,
        },
      ];

      mockAntiPatternDetector.detectPatternsInFiles.mockReturnValue(
        mockPatterns
      );
      mockAntiPatternDetector.calculateScore.mockReturnValue(85);

      const workspaceUri = vscode.Uri.file('D:\\test\\project');
      const assessment = await service.assessQuality(workspaceUri);

      expect(assessment.score).toBe(85);
      expect(assessment.antiPatterns.length).toBe(1);
      expect(assessment.sampledFiles.length).toBe(1);
      expect(assessment.analysisDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('should identify gaps from antiPatterns', async () => {
      const indexedFiles: IndexedFile[] = [
        {
          path: 'D:\\test\\src\\service.ts',
          relativePath: 'src/service.ts',
          size: 100,
          estimatedTokens: 50,
          type: FileType.Source,
        },
      ];

      const mockFileIndex: FileIndex = {
        files: indexedFiles,
        ignoredPatterns: [],
        totalFiles: 1,
        totalSize: 100,
      };
      mockIndexer.indexWorkspace.mockResolvedValue(mockFileIndex);

      mockFileSystem.readFile.mockResolvedValue('code');
      mockRelevanceScorer.getTopFiles.mockReturnValue([]);

      const mockPatterns: AntiPattern[] = [
        {
          type: 'typescript-explicit-any',
          severity: 'warning',
          location: { file: 'src/service.ts' },
          message: 'Explicit any',
          suggestion: 'Fix it',
          frequency: 5,
        },
      ];

      mockAntiPatternDetector.detectPatternsInFiles.mockReturnValue(
        mockPatterns
      );
      mockAntiPatternDetector.calculateScore.mockReturnValue(75);

      const workspaceUri = vscode.Uri.file('D:\\test\\project');
      const assessment = await service.assessQuality(workspaceUri);

      expect(assessment.gaps.length).toBeGreaterThan(0);
      expect(
        assessment.gaps.some((g) => g.area.toLowerCase().includes('typescript'))
      ).toBe(true);
    });

    it('should identify strengths when categories have no issues', async () => {
      const indexedFiles: IndexedFile[] = [
        {
          path: 'D:\\test\\src\\clean.ts',
          relativePath: 'src/clean.ts',
          size: 100,
          estimatedTokens: 50,
          type: FileType.Source,
        },
      ];

      const mockFileIndex: FileIndex = {
        files: indexedFiles,
        ignoredPatterns: [],
        totalFiles: 1,
        totalSize: 100,
      };
      mockIndexer.indexWorkspace.mockResolvedValue(mockFileIndex);

      mockFileSystem.readFile.mockResolvedValue(
        'function clean(): string { return "ok"; }'
      );
      mockRelevanceScorer.getTopFiles.mockReturnValue([]);
      mockAntiPatternDetector.detectPatternsInFiles.mockReturnValue([]);
      mockAntiPatternDetector.calculateScore.mockReturnValue(100);

      const workspaceUri = vscode.Uri.file('D:\\test\\project');
      const assessment = await service.assessQuality(workspaceUri);

      expect(assessment.strengths.length).toBeGreaterThan(0);
    });
  });
});

// ============================================
// PrescriptiveGuidanceService Tests
// ============================================

describe('PrescriptiveGuidanceService', () => {
  let service: PrescriptiveGuidanceService;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    service = new PrescriptiveGuidanceService(mockLogger);
  });

  describe('generateGuidance', () => {
    const mockContext: WorkspaceContext = {
      projectType: 'node',
      isMonorepo: false,
      dependencies: [],
      devDependencies: [],
      languages: ['TypeScript'],
      architecturePatterns: [],
    };

    it('should generate positive guidance for clean codebase', () => {
      const assessment: QualityAssessment = {
        score: 100,
        antiPatterns: [],
        gaps: [],
        strengths: ['Clean code'],
        sampledFiles: ['src/app.ts'],
        analysisTimestamp: Date.now(),
        analysisDurationMs: 100,
      };

      const guidance = service.generateGuidance(assessment, mockContext);

      expect(guidance.summary).toContain('Excellent');
      expect(guidance.wasTruncated).toBe(false);
    });

    it('should generate recommendations from antiPatterns', () => {
      const assessment: QualityAssessment = {
        score: 70,
        antiPatterns: [
          {
            type: 'typescript-explicit-any',
            severity: 'warning',
            location: { file: 'src/service.ts' },
            message: 'Explicit Any Type',
            suggestion: 'Use specific type',
            frequency: 5,
          },
        ],
        gaps: [],
        strengths: [],
        sampledFiles: ['src/service.ts'],
        analysisTimestamp: Date.now(),
        analysisDurationMs: 100,
      };

      const guidance = service.generateGuidance(assessment, mockContext);

      expect(guidance.recommendations.length).toBeGreaterThan(0);
      expect(guidance.recommendations[0].issue).toBeDefined();
      expect(guidance.recommendations[0].solution).toBeDefined();
    });

    it('should respect token budget', () => {
      const assessment: QualityAssessment = {
        score: 50,
        antiPatterns: Array(20)
          .fill(null)
          .map((_, i) => ({
            type: `type-${i}` as 'typescript-explicit-any',
            severity: 'warning' as const,
            location: { file: `file${i}.ts` },
            message: `Issue ${i}`,
            suggestion: `Fix ${i}`,
            frequency: i + 1,
          })),
        gaps: [],
        strengths: [],
        sampledFiles: [],
        analysisTimestamp: Date.now(),
        analysisDurationMs: 100,
      };

      const guidance = service.generateGuidance(
        assessment,
        mockContext,
        200 // Very small budget
      );

      expect(guidance.wasTruncated).toBe(true);
      expect(guidance.recommendations.length).toBeLessThan(20);
    });

    it('should prioritize by frequency and severity', () => {
      const assessment: QualityAssessment = {
        score: 60,
        antiPatterns: [
          {
            type: 'typescript-explicit-any',
            severity: 'warning',
            location: { file: 'src/a.ts' },
            message: 'Warning',
            suggestion: 'Fix warning',
            frequency: 10,
          },
          {
            type: 'error-empty-catch',
            severity: 'error',
            location: { file: 'src/b.ts' },
            message: 'Error',
            suggestion: 'Fix error',
            frequency: 2,
          },
        ],
        gaps: [],
        strengths: [],
        sampledFiles: [],
        analysisTimestamp: Date.now(),
        analysisDurationMs: 100,
      };

      const guidance = service.generateGuidance(assessment, mockContext);

      // Higher frequency warning * 2 (weight) = 20, error * 3 (weight) * 2 = 6
      // So warning should be first
      expect(guidance.recommendations[0].category.toLowerCase()).toContain(
        'typescript'
      );
    });

    it('should include example files in recommendations', () => {
      const assessment: QualityAssessment = {
        score: 70,
        antiPatterns: [
          {
            type: 'typescript-explicit-any',
            severity: 'warning',
            location: { file: 'src/service.ts' },
            message: 'Any type',
            suggestion: 'Fix',
            frequency: 1,
          },
        ],
        gaps: [],
        strengths: [],
        sampledFiles: ['src/service.ts'],
        analysisTimestamp: Date.now(),
        analysisDurationMs: 100,
      };

      const guidance = service.generateGuidance(assessment, mockContext);

      expect(guidance.recommendations[0].exampleFiles).toBeDefined();
      expect(guidance.recommendations[0].exampleFiles?.length).toBeGreaterThan(
        0
      );
    });

    it('should generate summary with quality level', () => {
      const assessment: QualityAssessment = {
        score: 45,
        antiPatterns: [
          {
            type: 'error-empty-catch',
            severity: 'error',
            location: { file: 'src/handler.ts' },
            message: 'Empty catch',
            suggestion: 'Handle error',
            frequency: 5,
          },
        ],
        gaps: [],
        strengths: [],
        sampledFiles: [],
        analysisTimestamp: Date.now(),
        analysisDurationMs: 100,
      };

      const guidance = service.generateGuidance(assessment, mockContext);

      expect(guidance.summary).toContain('45/100');
      expect(
        guidance.summary.toLowerCase().includes('needs improvement') ||
          guidance.summary.toLowerCase().includes('poor')
      ).toBe(true);
    });

    it('should add framework-specific recommendations for clean codebase', () => {
      const contextWithFramework: WorkspaceContext = {
        ...mockContext,
        framework: 'Angular',
      };

      const assessment: QualityAssessment = {
        score: 100,
        antiPatterns: [],
        gaps: [],
        strengths: [],
        sampledFiles: [],
        analysisTimestamp: Date.now(),
        analysisDurationMs: 100,
      };

      const guidance = service.generateGuidance(
        assessment,
        contextWithFramework
      );

      expect(
        guidance.recommendations.some((r) => r.issue.includes('advanced'))
      ).toBe(true);
    });
  });
});

// ============================================
// ProjectIntelligenceService Tests
// ============================================

describe('ProjectIntelligenceService', () => {
  let service: ProjectIntelligenceService;
  let mockLogger: jest.Mocked<Logger>;
  let mockProjectDetector: jest.Mocked<ProjectDetectorService>;
  let mockFrameworkDetector: jest.Mocked<FrameworkDetectorService>;
  let mockMonorepoDetector: jest.Mocked<MonorepoDetectorService>;
  let mockDependencyAnalyzer: jest.Mocked<DependencyAnalyzerService>;
  let mockQualityAssessment: jest.Mocked<CodeQualityAssessmentService>;
  let mockGuidanceService: jest.Mocked<PrescriptiveGuidanceService>;

  beforeEach(() => {
    mockLogger = createMockLogger();

    mockProjectDetector = {
      detectProjectType: jest.fn(),
    } as unknown as jest.Mocked<ProjectDetectorService>;

    mockFrameworkDetector = {
      detectFrameworks: jest.fn(),
    } as unknown as jest.Mocked<FrameworkDetectorService>;

    mockMonorepoDetector = {
      detectMonorepo: jest.fn(),
    } as unknown as jest.Mocked<MonorepoDetectorService>;

    mockDependencyAnalyzer = {
      analyzeDependencies: jest.fn(),
    } as unknown as jest.Mocked<DependencyAnalyzerService>;

    mockQualityAssessment = {
      assessQuality: jest.fn(),
    } as unknown as jest.Mocked<CodeQualityAssessmentService>;

    mockGuidanceService = {
      generateGuidance: jest.fn(),
    } as unknown as jest.Mocked<PrescriptiveGuidanceService>;

    service = new ProjectIntelligenceService(
      mockLogger,
      mockProjectDetector,
      mockFrameworkDetector,
      mockMonorepoDetector,
      mockDependencyAnalyzer,
      mockQualityAssessment,
      mockGuidanceService
    );
  });

  describe('getIntelligence', () => {
    const setupDefaultMocks = () => {
      mockProjectDetector.detectProjectType.mockResolvedValue('node' as any);
      mockFrameworkDetector.detectFrameworks.mockResolvedValue(new Map());
      mockMonorepoDetector.detectMonorepo.mockResolvedValue({
        isMonorepo: false,
        type: undefined,
      } as any);
      mockDependencyAnalyzer.analyzeDependencies.mockResolvedValue({
        dependencies: [],
        devDependencies: [],
      } as any);
      mockQualityAssessment.assessQuality.mockResolvedValue({
        score: 80,
        antiPatterns: [],
        gaps: [],
        strengths: ['Clean code'],
        sampledFiles: [],
        analysisTimestamp: Date.now(),
        analysisDurationMs: 100,
      });
      mockGuidanceService.generateGuidance.mockReturnValue({
        summary: 'Good quality',
        recommendations: [],
        totalTokens: 50,
        wasTruncated: false,
      });
    };

    it('should combine workspace context with quality assessment', async () => {
      setupDefaultMocks();

      const workspaceUri = vscode.Uri.file('D:\\test\\project');
      const intel = await service.getIntelligence(workspaceUri);

      expect(intel.workspaceContext).toBeDefined();
      expect(intel.qualityAssessment).toBeDefined();
      expect(intel.prescriptiveGuidance).toBeDefined();
      expect(intel.timestamp).toBeDefined();
    });

    it('should use cached data within TTL', async () => {
      setupDefaultMocks();

      const workspaceUri = vscode.Uri.file('D:\\test\\project');

      // First call - should compute
      const intel1 = await service.getIntelligence(workspaceUri);

      // Second call - should use cache
      const intel2 = await service.getIntelligence(workspaceUri);

      expect(intel1.timestamp).toBe(intel2.timestamp);
      expect(mockProjectDetector.detectProjectType).toHaveBeenCalledTimes(1);
    });

    it('should return minimal intelligence on error', async () => {
      mockProjectDetector.detectProjectType.mockRejectedValue(
        new Error('Detection failed')
      );

      const workspaceUri = vscode.Uri.file('D:\\test\\project');
      const intel = await service.getIntelligence(workspaceUri);

      expect(intel.workspaceContext.projectType).toBe('unknown');
      expect(intel.qualityAssessment.score).toBe(50);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('getWorkspaceContext', () => {
    it('should build context from detection services', async () => {
      mockProjectDetector.detectProjectType.mockResolvedValue('angular' as any);
      mockFrameworkDetector.detectFrameworks.mockResolvedValue(
        new Map([[vscode.Uri.file('D:\\test'), Framework.Angular]])
      );
      mockMonorepoDetector.detectMonorepo.mockResolvedValue({
        isMonorepo: true,
        type: 'nx',
      } as any);
      mockDependencyAnalyzer.analyzeDependencies.mockResolvedValue({
        dependencies: [{ name: '@angular/core', version: '^17.0.0' }],
        devDependencies: [{ name: 'typescript', version: '^5.0.0' }],
      } as any);

      const workspaceUri = vscode.Uri.file('D:\\test\\project');
      const context = await service.getWorkspaceContext(workspaceUri);

      expect(context.projectType).toBe('angular');
      expect(context.isMonorepo).toBe(true);
      expect(context.monorepoType).toBe('nx');
      expect(context.dependencies).toContain('@angular/core');
      expect(context.devDependencies).toContain('typescript');
    });

    it('should return minimal context on error', async () => {
      mockProjectDetector.detectProjectType.mockRejectedValue(
        new Error('Failed')
      );

      const workspaceUri = vscode.Uri.file('D:\\test\\project');
      const context = await service.getWorkspaceContext(workspaceUri);

      expect(context.projectType).toBe('unknown');
      expect(context.isMonorepo).toBe(false);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('invalidateCache', () => {
    it('should clear cache for workspace', async () => {
      mockProjectDetector.detectProjectType.mockResolvedValue('node' as any);
      mockFrameworkDetector.detectFrameworks.mockResolvedValue(new Map());
      mockMonorepoDetector.detectMonorepo.mockResolvedValue({
        isMonorepo: false,
      } as any);
      mockDependencyAnalyzer.analyzeDependencies.mockResolvedValue({
        dependencies: [],
        devDependencies: [],
      } as any);
      mockQualityAssessment.assessQuality.mockResolvedValue({
        score: 80,
        antiPatterns: [],
        gaps: [],
        strengths: [],
        sampledFiles: [],
        analysisTimestamp: Date.now(),
        analysisDurationMs: 100,
      });
      mockGuidanceService.generateGuidance.mockReturnValue({
        summary: 'OK',
        recommendations: [],
        totalTokens: 10,
        wasTruncated: false,
      });

      const workspaceUri = vscode.Uri.file('D:\\test\\project');

      // First call - cache populated
      await service.getIntelligence(workspaceUri);

      // Invalidate
      service.invalidateCache(workspaceUri);

      // Second call - should recompute
      await service.getIntelligence(workspaceUri);

      expect(mockProjectDetector.detectProjectType).toHaveBeenCalledTimes(2);
    });

    it('should handle invalidation of non-cached workspace', () => {
      const workspaceUri = vscode.Uri.file('D:\\test\\nonexistent');

      // Should not throw
      expect(() => service.invalidateCache(workspaceUri)).not.toThrow();
    });
  });
});
