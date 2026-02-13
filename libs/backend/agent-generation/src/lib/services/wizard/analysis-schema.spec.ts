/**
 * Unit Tests for analysis-schema.ts
 *
 * Tests the shared Zod schema (ProjectAnalysisZodSchema) and normalization
 * function (normalizeAgentOutput) that transform LLM-produced analysis JSON
 * into properly typed DeepProjectAnalysis objects.
 *
 * TASK_2025_145 SERIOUS-2: Ensures correct case-insensitive enum resolution,
 * fallback behavior, and codeConventions defaults.
 */

import 'reflect-metadata';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';

// Mock workspace-intelligence to avoid transitive vscode dependency.
// Enum values must match the real enum values (all lowercase strings).
jest.mock('@ptah-extension/workspace-intelligence', () => ({
  ProjectType: {
    Node: 'node',
    React: 'react',
    Vue: 'vue',
    Angular: 'angular',
    NextJS: 'nextjs',
    Python: 'python',
    Java: 'java',
    Rust: 'rust',
    Go: 'go',
    DotNet: 'dotnet',
    PHP: 'php',
    Ruby: 'ruby',
    General: 'general',
    Unknown: 'unknown',
  },
  Framework: {
    React: 'react',
    Vue: 'vue',
    Angular: 'angular',
    NextJS: 'nextjs',
    Nuxt: 'nuxt',
    Express: 'express',
    Django: 'django',
    Laravel: 'laravel',
    Rails: 'rails',
    Svelte: 'svelte',
    Astro: 'astro',
    NestJS: 'nestjs',
    Fastify: 'fastify',
    Flask: 'flask',
    FastAPI: 'fastapi',
    Spring: 'spring',
  },
  MonorepoType: {
    Nx: 'nx',
    Lerna: 'lerna',
    Rush: 'rush',
    Turborepo: 'turborepo',
    PnpmWorkspaces: 'pnpm-workspaces',
    YarnWorkspaces: 'yarn-workspaces',
  },
}));

import {
  ProjectAnalysisZodSchema,
  normalizeAgentOutput,
} from './analysis-schema';

/**
 * Helper to build a minimal valid Zod input object.
 * Only requires projectType; everything else uses Zod defaults.
 */
function buildMinimalInput(overrides: Record<string, unknown> = {}) {
  return {
    projectType: 'node',
    ...overrides,
  };
}

/**
 * Helper: parse input through Zod and then normalize.
 */
function parseAndNormalize(raw: Record<string, unknown>) {
  const zodResult = ProjectAnalysisZodSchema.safeParse(raw);
  if (!zodResult.success) {
    throw new Error(
      `Zod validation failed: ${zodResult.error.issues
        .map((i) => `${String(i.path.join('.'))}: ${i.message}`)
        .join('; ')}`
    );
  }
  return normalizeAgentOutput(zodResult.data);
}

describe('ProjectAnalysisZodSchema', () => {
  it('should accept minimal input and apply all defaults', () => {
    const result = ProjectAnalysisZodSchema.safeParse({ projectType: 'node' });
    expect(result.success).toBe(true);

    if (result.success) {
      // Verify defaults are applied
      expect(result.data.frameworks).toEqual([]);
      expect(result.data.architecturePatterns).toEqual([]);
      expect(result.data.keyFileLocations.entryPoints).toEqual([]);
      expect(result.data.languageDistribution).toEqual([]);
      expect(result.data.existingIssues.errorCount).toBe(0);
      expect(result.data.testCoverage.percentage).toBe(0);
      expect(result.data.testCoverage.hasTests).toBe(false);
    }
  });

  it('should apply codeConventions defaults when omitted', () => {
    const result = ProjectAnalysisZodSchema.safeParse({ projectType: 'node' });
    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.codeConventions).toEqual({
        indentation: 'spaces',
        indentSize: 2,
        quoteStyle: 'single',
        semicolons: true,
        trailingComma: 'es5',
      });
    }
  });

  it('should default trailingComma to es5 when codeConventions is provided but trailingComma is omitted', () => {
    const result = ProjectAnalysisZodSchema.safeParse({
      projectType: 'node',
      codeConventions: {
        indentation: 'tabs',
        indentSize: 4,
        quoteStyle: 'double',
        semicolons: false,
        // trailingComma omitted -- should default to 'es5'
      },
    });
    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.codeConventions.trailingComma).toBe('es5');
      expect(result.data.codeConventions.indentation).toBe('tabs');
      expect(result.data.codeConventions.indentSize).toBe(4);
      expect(result.data.codeConventions.quoteStyle).toBe('double');
      expect(result.data.codeConventions.semicolons).toBe(false);
    }
  });

  it('should accept fileCount and languages as optional metadata', () => {
    const result = ProjectAnalysisZodSchema.safeParse({
      projectType: 'node',
      fileCount: 150,
      languages: ['TypeScript', 'JavaScript'],
    });
    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.fileCount).toBe(150);
      expect(result.data.languages).toEqual(['TypeScript', 'JavaScript']);
    }
  });

  it('should recover from invalid codeConventions values using .catch() defaults', () => {
    const result = ProjectAnalysisZodSchema.safeParse({
      projectType: 'node',
      codeConventions: {
        indentation: 'mixed', // invalid — should fall back to 'spaces'
        indentSize: 2,
        quoteStyle: 'single',
        semicolons: true,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.codeConventions.indentation).toBe('spaces');
    }
  });
});

describe('normalizeAgentOutput', () => {
  let consoleWarnSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {
      /* suppress warnings in test output */
    });
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  // ========================================================================
  // Project Type Resolution (tests resolveProjectType indirectly)
  // ========================================================================

  describe('projectType resolution', () => {
    it('should resolve "Angular" (capitalized) to ProjectType.Angular', () => {
      const result = parseAndNormalize(
        buildMinimalInput({ projectType: 'Angular' })
      );
      expect(result.projectType).toBe('angular');
    });

    it('should resolve "angular" (lowercase) to ProjectType.Angular', () => {
      const result = parseAndNormalize(
        buildMinimalInput({ projectType: 'angular' })
      );
      expect(result.projectType).toBe('angular');
    });

    it('should resolve "Node.js" (dotted name) to ProjectType.Node', () => {
      const result = parseAndNormalize(
        buildMinimalInput({ projectType: 'Node.js' })
      );
      expect(result.projectType).toBe('node');
    });

    it('should resolve "React" to ProjectType.React', () => {
      const result = parseAndNormalize(
        buildMinimalInput({ projectType: 'React' })
      );
      expect(result.projectType).toBe('react');
    });

    it('should resolve "Python" to ProjectType.Python', () => {
      const result = parseAndNormalize(
        buildMinimalInput({ projectType: 'Python' })
      );
      expect(result.projectType).toBe('python');
    });

    it('should resolve "TypeScript" to ProjectType.Node via alias', () => {
      const result = parseAndNormalize(
        buildMinimalInput({ projectType: 'TypeScript' })
      );
      expect(result.projectType).toBe('node');
    });

    it('should resolve "C#" to ProjectType.DotNet via alias', () => {
      const result = parseAndNormalize(
        buildMinimalInput({ projectType: 'C#' })
      );
      expect(result.projectType).toBe('dotnet');
    });

    it('should fall back to ProjectType.General for "UnknownThing"', () => {
      const result = parseAndNormalize(
        buildMinimalInput({ projectType: 'UnknownThing' })
      );
      expect(result.projectType).toBe('general');
    });

    it('should log a warning when falling back to General', () => {
      parseAndNormalize(buildMinimalInput({ projectType: 'UnknownThing' }));
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('UnknownThing')
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('falling back to General')
      );
    });

    it('should not log a warning for a known project type', () => {
      parseAndNormalize(buildMinimalInput({ projectType: 'Angular' }));
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should handle numeric projectType input', () => {
      // Zod schema accepts z.union([z.string(), z.number()])
      // Number will be stringified and likely fall back to General
      const result = parseAndNormalize(buildMinimalInput({ projectType: 42 }));
      expect(result.projectType).toBe('general');
    });
  });

  // ========================================================================
  // Framework Resolution (tests resolveFramework indirectly)
  // ========================================================================

  describe('framework resolution', () => {
    it('should resolve "NestJS" (capitalized) to Framework.NestJS', () => {
      const result = parseAndNormalize(
        buildMinimalInput({ frameworks: ['NestJS'] })
      );
      expect(result.frameworks).toEqual(['nestjs']);
    });

    it('should resolve "nestjs" (lowercase) to Framework.NestJS', () => {
      const result = parseAndNormalize(
        buildMinimalInput({ frameworks: ['nestjs'] })
      );
      expect(result.frameworks).toEqual(['nestjs']);
    });

    it('should resolve "Angular" to Framework.Angular', () => {
      const result = parseAndNormalize(
        buildMinimalInput({ frameworks: ['Angular'] })
      );
      expect(result.frameworks).toEqual(['angular']);
    });

    it('should resolve "Nest.js" (alias) to Framework.NestJS', () => {
      const result = parseAndNormalize(
        buildMinimalInput({ frameworks: ['Nest.js'] })
      );
      expect(result.frameworks).toEqual(['nestjs']);
    });

    it('should preserve unrecognized frameworks as strings', () => {
      const result = parseAndNormalize(
        buildMinimalInput({ frameworks: ['Unknown'] })
      );
      expect(result.frameworks).toEqual(['Unknown']);
    });

    it('should log discovered dynamic frameworks', () => {
      const consoleLogSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});
      try {
        parseAndNormalize(
          buildMinimalInput({ frameworks: ['Angular', 'UnknownFramework'] })
        );
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining('UnknownFramework')
        );
      } finally {
        consoleLogSpy.mockRestore();
      }
    });

    it('should resolve multiple mixed-case frameworks', () => {
      const result = parseAndNormalize(
        buildMinimalInput({ frameworks: ['React', 'NestJS', 'Express'] })
      );
      expect(result.frameworks).toEqual(
        expect.arrayContaining(['react', 'nestjs', 'express'])
      );
      expect(result.frameworks).toHaveLength(3);
    });

    it('should handle empty frameworks array', () => {
      const result = parseAndNormalize(buildMinimalInput({ frameworks: [] }));
      expect(result.frameworks).toEqual([]);
    });

    it('should handle frameworks defaulting when omitted', () => {
      const result = parseAndNormalize(buildMinimalInput());
      expect(result.frameworks).toEqual([]);
    });
  });

  // ========================================================================
  // Monorepo Type Resolution
  // ========================================================================

  describe('monorepoType resolution', () => {
    it('should resolve "Nx" to MonorepoType.Nx', () => {
      const result = parseAndNormalize(
        buildMinimalInput({ monorepoType: 'Nx' })
      );
      expect(result.monorepoType).toBe('nx');
    });

    it('should resolve "Turborepo" to MonorepoType.Turborepo', () => {
      const result = parseAndNormalize(
        buildMinimalInput({ monorepoType: 'Turborepo' })
      );
      expect(result.monorepoType).toBe('turborepo');
    });

    it('should resolve "pnpm workspaces" (alias) to MonorepoType.PnpmWorkspaces', () => {
      const result = parseAndNormalize(
        buildMinimalInput({ monorepoType: 'pnpm workspaces' })
      );
      expect(result.monorepoType).toBe('pnpm-workspaces');
    });

    it('should omit monorepoType when not provided', () => {
      const result = parseAndNormalize(buildMinimalInput());
      expect(result.monorepoType).toBeUndefined();
    });

    it('should omit monorepoType when unrecognized', () => {
      const result = parseAndNormalize(
        buildMinimalInput({ monorepoType: 'SomeUnknownMonorepo' })
      );
      expect(result.monorepoType).toBeUndefined();
    });

    it('should handle monorepoType: false (LLM returns boolean instead of null)', () => {
      const result = parseAndNormalize(
        buildMinimalInput({ monorepoType: false })
      );
      expect(result.monorepoType).toBeUndefined();
    });

    it('should handle monorepoType: true (LLM returns boolean instead of string)', () => {
      // true is converted to "unknown" which doesn't match any MonorepoType enum
      const zodResult = ProjectAnalysisZodSchema.safeParse(
        buildMinimalInput({ monorepoType: true })
      );
      expect(zodResult.success).toBe(true);
    });

    it('should handle monorepoType: "none" as null', () => {
      const result = parseAndNormalize(
        buildMinimalInput({ monorepoType: 'none' })
      );
      expect(result.monorepoType).toBeUndefined();
    });

    it('should handle monorepoType: "" (empty string) as null', () => {
      const result = parseAndNormalize(buildMinimalInput({ monorepoType: '' }));
      expect(result.monorepoType).toBeUndefined();
    });
  });

  // ========================================================================
  // Language Distribution Resilience
  // ========================================================================

  describe('languageDistribution resilience', () => {
    it('should clamp percentages > 100 to 100', () => {
      const result = parseAndNormalize(
        buildMinimalInput({
          languageDistribution: [
            { language: 'TypeScript', percentage: 250, fileCount: 250 },
            { language: 'CSS', percentage: 50, fileCount: 50 },
          ],
        })
      );
      expect(result.languageDistribution[0].percentage).toBe(100);
      expect(result.languageDistribution[1].percentage).toBe(50);
    });

    it('should clamp negative percentages to 0', () => {
      const result = parseAndNormalize(
        buildMinimalInput({
          languageDistribution: [
            { language: 'TypeScript', percentage: -10, fileCount: 0 },
          ],
        })
      );
      expect(result.languageDistribution[0].percentage).toBe(0);
    });

    it('should handle object-format language distribution from LLM', () => {
      const result = parseAndNormalize(
        buildMinimalInput({
          languageDistribution: { TypeScript: 80, CSS: 20 },
        })
      );
      expect(result.languageDistribution).toHaveLength(2);
      expect(
        result.languageDistribution.find((l) => l.language === 'TypeScript')
          ?.percentage
      ).toBe(80);
    });
  });

  // ========================================================================
  // codeConventions defaults
  // ========================================================================

  describe('codeConventions defaults', () => {
    it('should produce valid codeConventions with all required fields when input is minimal', () => {
      const result = parseAndNormalize(buildMinimalInput());

      expect(result.codeConventions).toBeDefined();
      expect(result.codeConventions.indentation).toBe('spaces');
      expect(result.codeConventions.indentSize).toBe(2);
      expect(result.codeConventions.quoteStyle).toBe('single');
      expect(result.codeConventions.semicolons).toBe(true);
      expect(result.codeConventions.trailingComma).toBe('es5');
    });

    it('should preserve provided codeConventions values', () => {
      const result = parseAndNormalize(
        buildMinimalInput({
          codeConventions: {
            indentation: 'tabs',
            indentSize: 4,
            quoteStyle: 'double',
            semicolons: false,
            trailingComma: 'all',
          },
        })
      );

      expect(result.codeConventions.indentation).toBe('tabs');
      expect(result.codeConventions.indentSize).toBe(4);
      expect(result.codeConventions.quoteStyle).toBe('double');
      expect(result.codeConventions.semicolons).toBe(false);
      expect(result.codeConventions.trailingComma).toBe('all');
    });

    it('should default trailingComma when codeConventions provided without it', () => {
      const result = parseAndNormalize(
        buildMinimalInput({
          codeConventions: {
            indentation: 'spaces',
            indentSize: 2,
            quoteStyle: 'single',
            semicolons: true,
          },
        })
      );

      expect(result.codeConventions.trailingComma).toBe('es5');
    });
  });

  // ========================================================================
  // Full normalizeAgentOutput integration
  // ========================================================================

  describe('full normalization', () => {
    it('should produce a valid DeepProjectAnalysis from capitalized LLM-style input', () => {
      const result = parseAndNormalize({
        projectType: 'Angular',
        frameworks: ['NestJS', 'Angular', 'TailwindCSS'],
        monorepoType: 'Nx',
        architecturePatterns: [
          {
            name: 'Layered',
            confidence: 90,
            evidence: ['libs/', 'apps/'],
          },
        ],
        keyFileLocations: {
          entryPoints: ['src/main.ts'],
          configs: ['tsconfig.json'],
          testDirectories: ['src/tests'],
          apiRoutes: [],
          components: ['src/app'],
          services: ['src/services'],
        },
        languageDistribution: [
          { language: 'TypeScript', percentage: 95, fileCount: 280 },
        ],
        existingIssues: {
          errorCount: 5,
          warningCount: 12,
          infoCount: 0,
          errorsByType: {},
          warningsByType: {},
        },
        codeConventions: {
          indentation: 'spaces',
          indentSize: 2,
          quoteStyle: 'single',
          semicolons: true,
          trailingComma: 'es5',
        },
        testCoverage: {
          percentage: 75,
          hasTests: true,
          hasUnitTests: true,
          hasIntegrationTests: false,
          hasE2eTests: true,
        },
      });

      // Enum values should be lowercase
      expect(result.projectType).toBe('angular');
      expect(result.monorepoType).toBe('nx');

      // NestJS and Angular resolved to enum values, TailwindCSS preserved as dynamic string
      expect(result.frameworks).toContain('nestjs');
      expect(result.frameworks).toContain('angular');
      expect(result.frameworks).toContain('TailwindCSS');

      // Data preserved
      expect(result.architecturePatterns).toHaveLength(1);
      expect(result.architecturePatterns[0].name).toBe('Layered');
      expect(result.keyFileLocations.entryPoints).toEqual(['src/main.ts']);
      expect(result.existingIssues.errorCount).toBe(5);
      expect(result.testCoverage.percentage).toBe(75);
    });

    it('should produce a valid result from completely minimal input', () => {
      const result = parseAndNormalize({ projectType: 'node' });

      expect(result.projectType).toBe('node');
      expect(result.frameworks).toEqual([]);
      expect(result.monorepoType).toBeUndefined();
      expect(result.architecturePatterns).toEqual([]);
      expect(result.keyFileLocations.entryPoints).toEqual([]);
      expect(result.languageDistribution).toEqual([]);
      expect(result.existingIssues.errorCount).toBe(0);
      expect(result.codeConventions.indentation).toBe('spaces');
      expect(result.testCoverage.hasTests).toBe(false);
    });
  });
});
