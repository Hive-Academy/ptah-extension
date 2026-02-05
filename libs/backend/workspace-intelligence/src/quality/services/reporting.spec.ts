/**
 * Quality Reporting Services Unit Tests
 *
 * Tests for QualityHistoryService and QualityExportService.
 * Validates history persistence, eviction, export formatting,
 * and CSV escaping.
 *
 * TASK_2025_144: Phase G - Reporting and Visualization
 */

import 'reflect-metadata';

import type {
  QualityAssessment,
  QualityHistoryEntry,
  ProjectIntelligence,
  AntiPattern,
  QualityGap,
} from '@ptah-extension/shared';

import { QualityHistoryService } from './quality-history.service';
import { QualityExportService } from './quality-export.service';

// ============================================
// Test Helpers
// ============================================

/**
 * Creates a mock Logger with no-op methods
 */
function createMockLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    setLevel: jest.fn(),
    getLevel: jest.fn(),
  } as any;
}

/**
 * Creates a mock vscode.Memento (globalState)
 */
function createMockGlobalState() {
  const store = new Map<string, unknown>();
  return {
    get: jest.fn(<T>(key: string, defaultValue?: T): T => {
      return (store.get(key) as T) ?? (defaultValue as T);
    }),
    update: jest.fn(async (key: string, value: unknown): Promise<void> => {
      store.set(key, value);
    }),
    keys: jest.fn((): readonly string[] => {
      return Array.from(store.keys());
    }),
    _store: store,
  };
}

/**
 * Creates a sample QualityAssessment for testing
 */
function createSampleAssessment(
  overrides?: Partial<QualityAssessment>
): QualityAssessment {
  return {
    score: 75,
    antiPatterns: [
      {
        type: 'typescript-explicit-any',
        severity: 'warning',
        location: { file: 'src/user.service.ts', line: 10 },
        message: 'Explicit any type detected',
        suggestion: 'Replace any with specific type',
        frequency: 3,
      },
      {
        type: 'error-empty-catch',
        severity: 'error',
        location: { file: 'src/api.controller.ts', line: 25 },
        message: 'Empty catch block',
        suggestion: 'Add error handling logic',
        frequency: 1,
      },
      {
        type: 'angular-subscription-leak',
        severity: 'warning',
        location: { file: 'src/app.component.ts', line: 42 },
        message: 'Subscription without cleanup',
        suggestion: 'Use takeUntilDestroyed',
        frequency: 2,
      },
    ],
    gaps: [
      {
        area: 'TypeScript',
        priority: 'high',
        description: 'Excessive use of explicit any',
        recommendation: 'Enable strict mode',
      },
    ],
    strengths: ['Good error handling patterns', 'Well-structured architecture'],
    sampledFiles: [
      'src/user.service.ts',
      'src/api.controller.ts',
      'src/app.component.ts',
    ],
    analysisTimestamp: Date.now(),
    analysisDurationMs: 1500,
    ...overrides,
  };
}

/**
 * Creates a sample ProjectIntelligence for testing
 */
function createSampleIntelligence(
  overrides?: Partial<ProjectIntelligence>
): ProjectIntelligence {
  return {
    workspaceContext: {
      projectType: 'angular',
      framework: 'Angular',
      isMonorepo: true,
      monorepoType: 'Nx',
      dependencies: ['@angular/core', 'rxjs'],
      devDependencies: ['jest', 'typescript'],
      languages: ['TypeScript'],
      architecturePatterns: ['Component-Based', 'Dependency Injection'],
    },
    qualityAssessment: createSampleAssessment(),
    prescriptiveGuidance: {
      summary:
        'Code quality is acceptable (75/100). Primary areas for improvement: typescript type safety, error handling.',
      recommendations: [
        {
          priority: 1,
          category: 'TypeScript Type Safety',
          issue: 'Explicit any usage (3 occurrences in 1 file)',
          solution: 'Replace any with specific type definitions',
          exampleFiles: ['src/user.service.ts'],
        },
        {
          priority: 2,
          category: 'Error Handling',
          issue: 'Empty catch block',
          solution: 'Add error handling logic to catch blocks',
          exampleFiles: ['src/api.controller.ts'],
        },
      ],
      totalTokens: 200,
      wasTruncated: false,
    },
    timestamp: Date.now(),
    ...overrides,
  };
}

// ============================================
// QualityHistoryService Tests
// ============================================

describe('QualityHistoryService', () => {
  let service: QualityHistoryService;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockGlobalState: ReturnType<typeof createMockGlobalState>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockGlobalState = createMockGlobalState();
    service = new QualityHistoryService(mockLogger, mockGlobalState as any);
  });

  describe('recordAssessment', () => {
    it('should record a new assessment in history', () => {
      const assessment = createSampleAssessment();

      service.recordAssessment(assessment);

      expect(mockGlobalState.update).toHaveBeenCalledWith(
        'ptah.quality.history',
        expect.any(Array)
      );

      const storedEntries = mockGlobalState._store.get(
        'ptah.quality.history'
      ) as QualityHistoryEntry[];
      expect(storedEntries).toHaveLength(1);
      expect(storedEntries[0].score).toBe(75);
      expect(storedEntries[0].patternCount).toBe(3);
      expect(storedEntries[0].filesAnalyzed).toBe(3);
    });

    it('should compute category counts from anti-patterns', () => {
      const assessment = createSampleAssessment();

      service.recordAssessment(assessment);

      const storedEntries = mockGlobalState._store.get(
        'ptah.quality.history'
      ) as QualityHistoryEntry[];
      const entry = storedEntries[0];

      // typescript-explicit-any -> category 'typescript'
      // error-empty-catch -> category 'error'
      // angular-subscription-leak -> category 'angular'
      expect(entry.categoryCounts).toEqual({
        typescript: 1,
        error: 1,
        angular: 1,
      });
    });

    it('should prepend new entries (newest first)', () => {
      const assessment1 = createSampleAssessment({
        score: 60,
        analysisTimestamp: 1000,
      });
      const assessment2 = createSampleAssessment({
        score: 80,
        analysisTimestamp: 2000,
      });

      service.recordAssessment(assessment1);
      service.recordAssessment(assessment2);

      const storedEntries = mockGlobalState._store.get(
        'ptah.quality.history'
      ) as QualityHistoryEntry[];
      expect(storedEntries).toHaveLength(2);
      expect(storedEntries[0].score).toBe(80); // Newest first
      expect(storedEntries[1].score).toBe(60);
    });

    it('should evict oldest entries when exceeding MAX_ENTRIES (100)', () => {
      // Record 102 assessments
      for (let i = 0; i < 102; i++) {
        const assessment = createSampleAssessment({
          score: i,
          analysisTimestamp: i * 1000,
        });
        service.recordAssessment(assessment);
      }

      const storedEntries = mockGlobalState._store.get(
        'ptah.quality.history'
      ) as QualityHistoryEntry[];
      expect(storedEntries).toHaveLength(100);

      // Newest (101) should be first
      expect(storedEntries[0].score).toBe(101);
      // Oldest retained should be score 2 (0 and 1 were evicted)
      expect(storedEntries[99].score).toBe(2);
    });

    it('should handle assessment with no anti-patterns', () => {
      const assessment = createSampleAssessment({
        score: 100,
        antiPatterns: [],
      });

      service.recordAssessment(assessment);

      const storedEntries = mockGlobalState._store.get(
        'ptah.quality.history'
      ) as QualityHistoryEntry[];
      expect(storedEntries[0].patternCount).toBe(0);
      expect(storedEntries[0].categoryCounts).toEqual({});
    });

    it('should handle storage errors gracefully', () => {
      mockGlobalState.get.mockImplementation(() => {
        throw new Error('Storage error');
      });

      // Should not throw
      expect(() =>
        service.recordAssessment(createSampleAssessment())
      ).not.toThrow();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('getHistory', () => {
    it('should return empty array when no history exists', () => {
      const result = service.getHistory();
      expect(result).toEqual([]);
    });

    it('should return entries with default limit (30)', () => {
      // Record 50 assessments
      for (let i = 0; i < 50; i++) {
        service.recordAssessment(createSampleAssessment({ score: i }));
      }

      const result = service.getHistory();
      expect(result).toHaveLength(30);
    });

    it('should respect custom limit', () => {
      for (let i = 0; i < 20; i++) {
        service.recordAssessment(createSampleAssessment({ score: i }));
      }

      const result = service.getHistory(5);
      expect(result).toHaveLength(5);
    });

    it('should return all entries if fewer than limit', () => {
      for (let i = 0; i < 3; i++) {
        service.recordAssessment(createSampleAssessment({ score: i }));
      }

      const result = service.getHistory(30);
      expect(result).toHaveLength(3);
    });

    it('should handle corrupted storage gracefully', () => {
      mockGlobalState._store.set('ptah.quality.history', 'not-an-array');

      const result = service.getHistory();
      expect(result).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('clearHistory', () => {
    it('should clear all history entries', () => {
      for (let i = 0; i < 10; i++) {
        service.recordAssessment(createSampleAssessment({ score: i }));
      }

      service.clearHistory();

      const result = service.getHistory();
      expect(result).toEqual([]);
    });

    it('should write empty array to globalState', () => {
      service.clearHistory();

      expect(mockGlobalState.update).toHaveBeenCalledWith(
        'ptah.quality.history',
        []
      );
    });
  });
});

// ============================================
// QualityExportService Tests
// ============================================

describe('QualityExportService', () => {
  let service: QualityExportService;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    service = new QualityExportService(mockLogger);
  });

  describe('exportMarkdown', () => {
    it('should generate valid Markdown report', () => {
      const intelligence = createSampleIntelligence();

      const result = service.exportMarkdown(intelligence);

      expect(result).toContain('# Code Quality Report');
      expect(result).toContain('**Score**: 75/100');
      expect(result).toContain('**Project**: angular (Angular)');
      expect(result).toContain('## Summary');
      expect(result).toContain('## Anti-Patterns Detected');
      expect(result).toContain('## Quality Gaps');
      expect(result).toContain('## Strengths');
      expect(result).toContain('## Recommendations');
    });

    it('should include anti-patterns table with correct rows', () => {
      const intelligence = createSampleIntelligence();

      const result = service.exportMarkdown(intelligence);

      expect(result).toContain(
        '| Type | Severity | File | Line | Frequency | Message |'
      );
      expect(result).toContain('typescript-explicit-any');
      expect(result).toContain('error-empty-catch');
      expect(result).toContain('angular-subscription-leak');
    });

    it('should include quality gaps table', () => {
      const intelligence = createSampleIntelligence();

      const result = service.exportMarkdown(intelligence);

      expect(result).toContain(
        '| Area | Priority | Description | Recommendation |'
      );
      expect(result).toContain('TypeScript');
      expect(result).toContain('high');
    });

    it('should include strengths list', () => {
      const intelligence = createSampleIntelligence();

      const result = service.exportMarkdown(intelligence);

      expect(result).toContain('- Good error handling patterns');
      expect(result).toContain('- Well-structured architecture');
    });

    it('should include recommendations', () => {
      const intelligence = createSampleIntelligence();

      const result = service.exportMarkdown(intelligence);

      expect(result).toContain('**[TypeScript Type Safety]**');
      expect(result).toContain('Example files:');
      expect(result).toContain('`src/user.service.ts`');
    });

    it('should handle empty assessment data', () => {
      const intelligence = createSampleIntelligence({
        qualityAssessment: createSampleAssessment({
          score: 100,
          antiPatterns: [],
          gaps: [],
          strengths: [],
          sampledFiles: [],
        }),
        prescriptiveGuidance: {
          summary: 'Excellent code quality.',
          recommendations: [],
          totalTokens: 50,
          wasTruncated: false,
        },
      });

      const result = service.exportMarkdown(intelligence);

      expect(result).toContain('No anti-patterns detected. Excellent!');
      expect(result).toContain('No quality gaps identified.');
      expect(result).toContain('No specific strengths identified.');
      expect(result).toContain('No recommendations at this time.');
    });

    it('should include incremental stats when available', () => {
      const intelligence = createSampleIntelligence({
        qualityAssessment: createSampleAssessment({
          incrementalStats: {
            cachedFiles: 8,
            freshFiles: 7,
            cacheHitRate: 0.533,
          },
        }),
      });

      const result = service.exportMarkdown(intelligence);

      expect(result).toContain('## Analysis Statistics');
      expect(result).toContain('**Cached Files**: 8');
      expect(result).toContain('**Fresh Files**: 7');
      expect(result).toContain('**Cache Hit Rate**: 53.3%');
    });

    it('should escape pipe characters in table cells', () => {
      const intelligence = createSampleIntelligence({
        qualityAssessment: createSampleAssessment({
          antiPatterns: [
            {
              type: 'typescript-explicit-any',
              severity: 'warning',
              location: { file: 'src/test|file.ts', line: 1 },
              message: 'Message with | pipe',
              suggestion: 'Fix it',
              frequency: 1,
            },
          ],
        }),
      });

      const result = service.exportMarkdown(intelligence);

      // Pipe should be escaped in table cells
      expect(result).toContain('src/test\\|file.ts');
      expect(result).toContain('Message with \\| pipe');
    });

    it('should include footer', () => {
      const intelligence = createSampleIntelligence();

      const result = service.exportMarkdown(intelligence);

      expect(result).toContain(
        '*Generated by Ptah Extension - Code Quality Assessment*'
      );
    });
  });

  describe('exportJson', () => {
    it('should generate valid JSON', () => {
      const intelligence = createSampleIntelligence();

      const result = service.exportJson(intelligence);

      const parsed = JSON.parse(result);
      expect(parsed).toEqual(intelligence);
    });

    it('should use 2-space indentation', () => {
      const intelligence = createSampleIntelligence();

      const result = service.exportJson(intelligence);

      // Verify indentation: lines should start with spaces (multiples of 2)
      const lines = result.split('\n');
      const indentedLines = lines.filter((l) => l.startsWith('  '));
      expect(indentedLines.length).toBeGreaterThan(0);
    });

    it('should handle empty assessment data', () => {
      const intelligence = createSampleIntelligence({
        qualityAssessment: createSampleAssessment({
          antiPatterns: [],
          gaps: [],
          strengths: [],
        }),
      });

      const result = service.exportJson(intelligence);
      const parsed = JSON.parse(result);

      expect(parsed.qualityAssessment.antiPatterns).toEqual([]);
      expect(parsed.qualityAssessment.gaps).toEqual([]);
    });
  });

  describe('exportCsv', () => {
    it('should generate valid CSV with header', () => {
      const intelligence = createSampleIntelligence();

      const result = service.exportCsv(intelligence);

      const lines = result.split('\n');
      expect(lines[0]).toBe(
        'type,severity,file,line,column,frequency,message,suggestion'
      );
    });

    it('should include one row per anti-pattern', () => {
      const intelligence = createSampleIntelligence();

      const result = service.exportCsv(intelligence);

      const lines = result.split('\n');
      // Header + 3 anti-patterns
      expect(lines).toHaveLength(4);
    });

    it('should handle fields with commas by quoting', () => {
      const intelligence = createSampleIntelligence({
        qualityAssessment: createSampleAssessment({
          antiPatterns: [
            {
              type: 'typescript-explicit-any',
              severity: 'warning',
              location: { file: 'src/user.service.ts', line: 10 },
              message: 'Message with, comma',
              suggestion: 'Fix this, please',
              frequency: 1,
            },
          ],
        }),
      });

      const result = service.exportCsv(intelligence);
      const lines = result.split('\n');

      // Fields with commas should be quoted
      expect(lines[1]).toContain('"Message with, comma"');
      expect(lines[1]).toContain('"Fix this, please"');
    });

    it('should handle fields with double quotes by escaping', () => {
      const intelligence = createSampleIntelligence({
        qualityAssessment: createSampleAssessment({
          antiPatterns: [
            {
              type: 'typescript-explicit-any',
              severity: 'warning',
              location: { file: 'src/user.service.ts', line: 10 },
              message: 'Replace "any" with type',
              suggestion: 'Use "string" or "number"',
              frequency: 1,
            },
          ],
        }),
      });

      const result = service.exportCsv(intelligence);
      const lines = result.split('\n');

      // Double quotes should be escaped as ""
      expect(lines[1]).toContain('"Replace ""any"" with type"');
      expect(lines[1]).toContain('"Use ""string"" or ""number"""');
    });

    it('should handle fields with newlines by quoting', () => {
      const intelligence = createSampleIntelligence({
        qualityAssessment: createSampleAssessment({
          antiPatterns: [
            {
              type: 'typescript-explicit-any',
              severity: 'warning',
              location: { file: 'src/user.service.ts', line: 10 },
              message: 'Line one\nLine two',
              suggestion: 'Fix it',
              frequency: 1,
            },
          ],
        }),
      });

      const result = service.exportCsv(intelligence);

      // The field with newline should be quoted
      expect(result).toContain('"Line one\nLine two"');
    });

    it('should handle missing line and column with empty strings', () => {
      const intelligence = createSampleIntelligence({
        qualityAssessment: createSampleAssessment({
          antiPatterns: [
            {
              type: 'typescript-explicit-any',
              severity: 'warning',
              location: { file: 'src/user.service.ts' },
              message: 'Some message',
              suggestion: 'Fix it',
              frequency: 1,
            },
          ],
        }),
      });

      const result = service.exportCsv(intelligence);
      const lines = result.split('\n');
      const fields = lines[1].split(',');

      // line (index 3) and column (index 4) should be empty
      expect(fields[3]).toBe('');
      expect(fields[4]).toBe('');
    });

    it('should generate only header for empty anti-patterns', () => {
      const intelligence = createSampleIntelligence({
        qualityAssessment: createSampleAssessment({
          antiPatterns: [],
        }),
      });

      const result = service.exportCsv(intelligence);
      const lines = result.split('\n');

      expect(lines).toHaveLength(1); // Header only
      expect(lines[0]).toBe(
        'type,severity,file,line,column,frequency,message,suggestion'
      );
    });
  });
});
