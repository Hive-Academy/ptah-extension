/**
 * Shared Zod Schema for Project Analysis Validation
 *
 * Provides the single source of truth for validating LLM-produced
 * project analysis JSON and normalizing it into DeepProjectAnalysis.
 *
 * Used by:
 * - AgenticAnalysisService (SDK-powered analysis)
 * - SetupRpcHandlers (wizard:recommend-agents input validation)
 *
 * TASK_2025_145: Extracted to eliminate schema duplication (SERIOUS-7),
 * add normalization layer (CRITICAL-1), and fix codeConventions defaults (SERIOUS-1).
 *
 * @module @ptah-extension/agent-generation
 */

import { z } from 'zod';
import {
  ProjectType,
  Framework,
  MonorepoType,
} from '@ptah-extension/workspace-intelligence';
import type { DeepProjectAnalysis } from '../../types/analysis.types';
import type { CodeConventions } from '@ptah-extension/shared';

// ============================================================================
// Enum Lookup Maps (case-insensitive)
// ============================================================================

/**
 * Build a case-insensitive lookup map from an enum's values.
 * Maps normalized keys (lowercase, alphanumeric only) to enum values.
 */
function buildLookupMap<T extends string>(
  enumObj: Record<string, T>,
): Map<string, T> {
  const map = new Map<string, T>();
  for (const value of Object.values(enumObj)) {
    // Map the raw lowercase value: "node", "angular", "nestjs"
    map.set(value.toLowerCase(), value);
    // Also map alphanumeric-only version: "pnpmworkspaces" -> "pnpm-workspaces"
    const alphaOnly = value.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (alphaOnly !== value.toLowerCase()) {
      map.set(alphaOnly, value);
    }
  }
  return map;
}

const PROJECT_TYPE_MAP = buildLookupMap(ProjectType);
const FRAMEWORK_MAP = buildLookupMap(Framework);
const MONOREPO_TYPE_MAP = buildLookupMap(MonorepoType);

// Additional well-known aliases that LLMs commonly produce
const PROJECT_TYPE_ALIASES: Record<string, ProjectType> = {
  'node.js': ProjectType.Node,
  nodejs: ProjectType.Node,
  'react.js': ProjectType.React,
  reactjs: ProjectType.React,
  'vue.js': ProjectType.Vue,
  vuejs: ProjectType.Vue,
  'next.js': ProjectType.NextJS,
  next: ProjectType.NextJS,
  '.net': ProjectType.DotNet,
  'c#': ProjectType.DotNet,
  csharp: ProjectType.DotNet,
  typescript: ProjectType.Node,
  javascript: ProjectType.Node,
};

const FRAMEWORK_ALIASES: Record<string, Framework> = {
  'nest.js': Framework.NestJS,
  nest: Framework.NestJS,
  'next.js': Framework.NextJS,
  next: Framework.NextJS,
  'nuxt.js': Framework.Nuxt,
  'react.js': Framework.React,
  reactjs: Framework.React,
  'vue.js': Framework.Vue,
  vuejs: Framework.Vue,
  'fast-api': Framework.FastAPI,
  'ruby on rails': Framework.Rails,
  ror: Framework.Rails,
  'spring boot': Framework.Spring,
  springboot: Framework.Spring,
};

const MONOREPO_ALIASES: Record<string, MonorepoType> = {
  'pnpm workspaces': MonorepoType.PnpmWorkspaces,
  pnpm: MonorepoType.PnpmWorkspaces,
  'yarn workspaces': MonorepoType.YarnWorkspaces,
  yarn: MonorepoType.YarnWorkspaces,
  turbo: MonorepoType.Turborepo,
};

// ============================================================================
// Normalization Helpers
// ============================================================================

/**
 * Keyword patterns for extracting project type from descriptive LLM strings.
 * Ordered by specificity (most specific first) so "Next.js" matches before "React".
 */
const PROJECT_TYPE_KEYWORDS: Array<{ pattern: RegExp; type: ProjectType }> = [
  { pattern: /\bnext\.?js\b/i, type: ProjectType.NextJS },
  { pattern: /\bangular\b/i, type: ProjectType.Angular },
  { pattern: /\breact\b/i, type: ProjectType.React },
  { pattern: /\bvue\.?js?\b/i, type: ProjectType.Vue },
  { pattern: /\bnest\.?js\b/i, type: ProjectType.Node },
  { pattern: /\bnode\.?js\b/i, type: ProjectType.Node },
  { pattern: /\btypescript\b/i, type: ProjectType.Node },
  { pattern: /\bjavascript\b/i, type: ProjectType.Node },
  {
    pattern: /\bpython\b|django\b|flask\b|fastapi\b/i,
    type: ProjectType.Python,
  },
  { pattern: /\bjava\b|spring\b/i, type: ProjectType.Java },
  { pattern: /\brust\b|cargo\b/i, type: ProjectType.Rust },
  { pattern: /\bgo\b|golang\b/i, type: ProjectType.Go },
  {
    pattern: /\b\.net\b|dotnet\b|c#\b|csharp\b|blazor\b/i,
    type: ProjectType.DotNet,
  },
  { pattern: /\bphp\b|laravel\b|symfony\b/i, type: ProjectType.PHP },
  { pattern: /\bruby\b|rails\b/i, type: ProjectType.Ruby },
];

/**
 * Resolve a raw LLM string to a ProjectType enum value.
 * Uses case-insensitive matching with alias fallback, then keyword extraction
 * from descriptive strings like "React SPA with Supabase Backend".
 */
export function resolveProjectType(raw: string | number): ProjectType {
  const str = String(raw).trim();
  const lower = str.toLowerCase();

  // Direct match on lowercase enum value
  const directMatch = PROJECT_TYPE_MAP.get(lower);
  if (directMatch) return directMatch as ProjectType;

  // Alias match
  const aliasMatch = PROJECT_TYPE_ALIASES[lower];
  if (aliasMatch) return aliasMatch;

  // Alphanumeric-only match (strips dots, hyphens, etc.)
  const alphaOnly = lower.replace(/[^a-z0-9]/g, '');
  const alphaMatch = PROJECT_TYPE_MAP.get(alphaOnly);
  if (alphaMatch) return alphaMatch as ProjectType;

  // Check aliases with alphanumeric-only key
  for (const [aliasKey, aliasValue] of Object.entries(PROJECT_TYPE_ALIASES)) {
    if (aliasKey.replace(/[^a-z0-9]/g, '') === alphaOnly) {
      return aliasValue;
    }
  }

  // Keyword extraction: scan descriptive strings for known project type keywords.
  // Handles LLM outputs like "React SPA with Supabase Backend", "Angular Nx Monorepo",
  // "Next.js Full-Stack App", etc.
  for (const { pattern, type } of PROJECT_TYPE_KEYWORDS) {
    if (pattern.test(str)) {
      return type;
    }
  }

  return ProjectType.General;
}

/**
 * Resolve a raw LLM string to a Framework enum value, or undefined if no match.
 */
function resolveFramework(raw: string | number): Framework | undefined {
  const str = String(raw).trim();
  const lower = str.toLowerCase();

  // Direct match
  const directMatch = FRAMEWORK_MAP.get(lower);
  if (directMatch) return directMatch as Framework;

  // Alias match
  const aliasMatch = FRAMEWORK_ALIASES[lower];
  if (aliasMatch) return aliasMatch;

  // Alphanumeric-only match
  const alphaOnly = lower.replace(/[^a-z0-9]/g, '');
  const alphaMatch = FRAMEWORK_MAP.get(alphaOnly);
  if (alphaMatch) return alphaMatch as Framework;

  // Check aliases with alphanumeric-only key
  for (const [aliasKey, aliasValue] of Object.entries(FRAMEWORK_ALIASES)) {
    if (aliasKey.replace(/[^a-z0-9]/g, '') === alphaOnly) {
      return aliasValue;
    }
  }

  return undefined;
}

/**
 * Resolve a raw LLM string to a MonorepoType enum value, or undefined if no match.
 */
function resolveMonorepoType(
  raw: string | null | undefined,
): MonorepoType | undefined {
  if (!raw) return undefined;

  const lower = raw.trim().toLowerCase();

  // Direct match
  const directMatch = MONOREPO_TYPE_MAP.get(lower);
  if (directMatch) return directMatch as MonorepoType;

  // Alias match
  const aliasMatch = MONOREPO_ALIASES[lower];
  if (aliasMatch) return aliasMatch;

  // Alphanumeric-only match
  const alphaOnly = lower.replace(/[^a-z0-9]/g, '');
  const alphaMatch = MONOREPO_TYPE_MAP.get(alphaOnly);
  if (alphaMatch) return alphaMatch as MonorepoType;

  // Check aliases with alphanumeric-only key
  for (const [aliasKey, aliasValue] of Object.entries(MONOREPO_ALIASES)) {
    if (aliasKey.replace(/[^a-z0-9]/g, '') === alphaOnly) {
      return aliasValue;
    }
  }

  return undefined;
}

// ============================================================================
// Zod Schema
// ============================================================================

/**
 * Shared Zod schema for project analysis validation.
 *
 * Validates the structure of analysis data from LLM output or frontend input.
 * Provides sensible defaults for all required fields to prevent runtime errors.
 *
 * TASK_2025_145:
 * - codeConventions uses .default() instead of .optional() (SERIOUS-1)
 * - trailingComma included in defaults since CodeConventions requires it
 */
export const ProjectAnalysisZodSchema = z.object({
  // Core project identification
  projectType: z.union([z.string(), z.number()]),
  frameworks: z.array(z.union([z.string(), z.number()])).default([]),
  // LLMs often return `false` or `true` instead of null/string for monorepoType
  monorepoType: z.preprocess((val) => {
    if (typeof val === 'boolean') return val ? 'unknown' : null;
    if (val === '' || val === 'none' || val === 'None' || val === 'N/A')
      return null;
    return val;
  }, z.string().optional().nullable()),

  // Architecture patterns with confidence scoring
  // LLMs sometimes return plain strings instead of objects — normalize them
  architecturePatterns: z.preprocess(
    (val) => {
      if (!Array.isArray(val)) return [];
      return val.map((item) => {
        if (typeof item === 'string') {
          return {
            name: item,
            confidence: 50,
            evidence: [],
            description: item,
          };
        }
        return item;
      });
    },
    z
      .array(
        z.object({
          name: z.string(),
          confidence: z.number().min(0).max(100).default(50),
          evidence: z.array(z.string()).default([]),
          description: z.string().optional(),
        }),
      )
      .default([]),
  ),

  // Key file locations organized by purpose
  // LLMs sometimes return a single string instead of an array — normalize
  keyFileLocations: z.preprocess(
    (val) => {
      if (!val || typeof val !== 'object') return {};
      const obj = val as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string') {
          result[key] = [value];
        } else {
          result[key] = value;
        }
      }
      return result;
    },
    z
      .object({
        entryPoints: z.array(z.string()).default([]),
        configs: z.array(z.string()).default([]),
        testDirectories: z.array(z.string()).default([]),
        apiRoutes: z.array(z.string()).default([]),
        components: z.array(z.string()).default([]),
        services: z.array(z.string()).default([]),
        models: z.array(z.string()).optional(),
        repositories: z.array(z.string()).optional(),
        utilities: z.array(z.string()).optional(),
      })
      .default({
        entryPoints: [],
        configs: [],
        testDirectories: [],
        apiRoutes: [],
        components: [],
        services: [],
      }),
  ),

  // Language distribution statistics
  // LLMs sometimes return an object like {TypeScript: 80, CSS: 20} instead of an array
  // LLMs sometimes return percentages > 100 (e.g. raw file counts) — clamp to 0-100
  languageDistribution: z.preprocess(
    (val) => {
      let arr: unknown[];
      if (Array.isArray(val)) {
        arr = val;
      } else if (val && typeof val === 'object' && !Array.isArray(val)) {
        arr = Object.entries(val as Record<string, unknown>).map(
          ([language, value]) => ({
            language,
            percentage: typeof value === 'number' ? value : 0,
            fileCount: 0,
          }),
        );
      } else {
        return [];
      }
      // Clamp percentages to 0-100 before Zod validation
      return arr.map((item) => {
        if (item && typeof item === 'object' && 'percentage' in item) {
          const obj = item as Record<string, unknown>;
          const pct =
            typeof obj['percentage'] === 'number'
              ? (obj['percentage'] as number)
              : 0;
          return { ...obj, percentage: Math.min(100, Math.max(0, pct)) };
        }
        return item;
      });
    },
    z
      .array(
        z.object({
          language: z.string(),
          percentage: z.number().min(0).max(100).default(0),
          fileCount: z.number().min(0).default(0),
          linesOfCode: z.number().min(0).optional(),
        }),
      )
      .default([]),
  ),

  // Code health diagnostics
  existingIssues: z
    .object({
      errorCount: z.number().min(0).default(0),
      warningCount: z.number().min(0).default(0),
      infoCount: z.number().min(0).default(0),
      errorsByType: z.record(z.string(), z.number()).default({}),
      warningsByType: z.record(z.string(), z.number()).default({}),
      topErrors: z
        .array(
          z.object({
            message: z.string(),
            count: z.number(),
            source: z.string(),
          }),
        )
        .optional(),
    })
    .default({
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      errorsByType: {},
      warningsByType: {},
    }),

  // Code conventions detection - REQUIRED with defaults (SERIOUS-1 fix)
  // Each field uses .catch() to fall back to defaults when LLM provides invalid values
  codeConventions: z
    .object({
      indentation: z.enum(['tabs', 'spaces']).catch('spaces'),
      indentSize: z.number().min(1).max(8).catch(2),
      quoteStyle: z.enum(['single', 'double']).catch('single'),
      semicolons: z.boolean().catch(true),
      trailingComma: z.enum(['none', 'es5', 'all']).catch('es5'),
      namingConventions: z
        .object({
          files: z.string().optional(),
          classes: z.string().optional(),
          functions: z.string().optional(),
          variables: z.string().optional(),
          constants: z.string().optional(),
          interfaces: z.string().optional(),
          types: z.string().optional(),
        })
        .optional(),
      maxLineLength: z.number().optional(),
      usePrettier: z.boolean().optional(),
      useEslint: z.boolean().optional(),
      additionalTools: z.array(z.string()).optional(),
    })
    .default({
      indentation: 'spaces',
      indentSize: 2,
      quoteStyle: 'single',
      semicolons: true,
      trailingComma: 'es5',
    }),

  // Test coverage estimation
  testCoverage: z
    .object({
      percentage: z.number().min(0).max(100).default(0),
      hasTests: z.boolean().default(false),
      testFramework: z.string().optional().nullable(),
      hasUnitTests: z.boolean().default(false),
      hasIntegrationTests: z.boolean().default(false),
      hasE2eTests: z.boolean().default(false),
      testFileCount: z.number().min(0).optional(),
      sourceFileCount: z.number().min(0).optional(),
      testToSourceRatio: z.number().min(0).optional(),
    })
    .default({
      percentage: 0,
      hasTests: false,
      hasUnitTests: false,
      hasIntegrationTests: false,
      hasE2eTests: false,
    }),

  // Quality assessment from agentic analysis (TASK_2025_151)
  // The LLM agent assesses code quality based on its MCP tool exploration.
  // All fields optional with defaults for backward compatibility with
  // analysis runs that predate quality integration.
  qualityAssessment: z
    .object({
      qualityScore: z.number().min(0).max(100).default(0),
      qualityIssues: z
        .array(
          z.object({
            area: z.string(),
            severity: z.enum(['high', 'medium', 'low']).catch('medium'),
            description: z.string(),
            recommendation: z.string(),
            affectedFiles: z.array(z.string()).optional(),
          }),
        )
        .default([]),
      strengths: z.array(z.string()).default([]),
      recommendations: z
        .array(
          z.object({
            priority: z.number().min(1).default(1),
            category: z.string(),
            issue: z.string(),
            solution: z.string(),
          }),
        )
        .default([]),
    })
    .optional(),

  // Optional metadata — present in the LLM output schema for prompt alignment
  // (the system prompt asks the agent to report these) but not consumed
  // downstream in DeepProjectAnalysis. Kept here so Zod doesn't reject them.
  fileCount: z.number().min(0).optional(),
  languages: z.array(z.string()).optional(),
});

/** Inferred type from the Zod schema after parsing */
export type ProjectAnalysisZodOutput = z.infer<typeof ProjectAnalysisZodSchema>;

// ============================================================================
// Normalization Function
// ============================================================================

/**
 * Normalize Zod-validated analysis output into a properly typed DeepProjectAnalysis.
 *
 * Performs case-insensitive mapping from LLM-produced strings to workspace-intelligence
 * enum values (ProjectType, Framework, MonorepoType). Fills in sensible defaults for
 * any required fields the LLM may have omitted.
 *
 * TASK_2025_145 CRITICAL-1: Replaces the unsafe `as unknown as DeepProjectAnalysis` cast.
 *
 * @param zodData - Zod-validated schema output
 * @returns Properly typed DeepProjectAnalysis with enum values
 */
export function normalizeAgentOutput(
  zodData: ProjectAnalysisZodOutput,
): DeepProjectAnalysis {
  // Resolve projectType from LLM string to enum
  const projectType = resolveProjectType(zodData.projectType);

  if (projectType === ProjectType.General) {
    console.warn(
      `[analysis-schema] projectType "${String(
        zodData.projectType,
      )}" could not be resolved to a known ProjectType; falling back to General`,
    );
  }

  // Resolve frameworks, keeping both known enum values AND dynamic string values
  // This allows discovered frameworks (Tailwind, Redux, etc.) to be preserved
  const resolvedFrameworks = zodData.frameworks.map((f) => {
    const resolved = resolveFramework(f);
    return {
      raw: f,
      resolved,
      // If resolved to enum, use enum value; otherwise keep original string
      final: resolved !== undefined ? resolved : String(f),
    };
  });

  const dynamicFrameworks = resolvedFrameworks.filter(
    (r) => r.resolved === undefined,
  );
  if (dynamicFrameworks.length > 0) {
    console.log(
      `[analysis-schema] Dynamic frameworks discovered: ${dynamicFrameworks
        .map((r) => `"${String(r.raw)}"`)
        .join(', ')}`,
    );
  }

  // Keep all frameworks: known ones as enum values, unknown ones as strings
  const frameworks = resolvedFrameworks.map((r) => r.final);

  // Resolve monorepoType
  const monorepoType = resolveMonorepoType(zodData.monorepoType);

  // codeConventions is guaranteed to have all required fields by Zod defaults,
  // including trailingComma which uses .default('es5') at the field level.
  // Cast required because Zod 4 inference under ts-jest treats `.default()`
  // fields as optional in `_output`, while `tsc --noEmit` narrows them to
  // required. Runtime values always have these fields populated.
  const codeConventions = zodData.codeConventions as CodeConventions;

  // Preserve the agent's original rich description (e.g., "React SPA with Supabase Backend")
  // while the enum is a best-effort infrastructure mapping
  const rawProjectTypeStr = String(zodData.projectType).trim();
  const projectTypeDescription =
    rawProjectTypeStr !== projectType ? rawProjectTypeStr : undefined;

  // Build the properly typed result
  const result: DeepProjectAnalysis = {
    projectType,
    projectTypeDescription,
    frameworks,
    architecturePatterns: zodData.architecturePatterns,
    keyFileLocations: zodData.keyFileLocations,
    languageDistribution: zodData.languageDistribution,
    existingIssues: zodData.existingIssues,
    codeConventions,
    testCoverage: zodData.testCoverage,
  };

  // Only include monorepoType if resolved
  if (monorepoType) {
    result.monorepoType = monorepoType;
  }

  // Map quality assessment fields (TASK_2025_151)
  if (zodData.qualityAssessment) {
    const qa = zodData.qualityAssessment;

    result.qualityScore = qa.qualityScore;

    // Map qualityIssues → QualityGap[]
    if (qa.qualityIssues.length > 0) {
      result.qualityGaps = qa.qualityIssues.map((issue) => ({
        area: issue.area,
        priority: issue.severity as 'high' | 'medium' | 'low',
        description: issue.description,
        recommendation: issue.recommendation,
      }));
    }

    // Map recommendations → PrescriptiveGuidance
    if (qa.recommendations.length > 0) {
      result.prescriptiveGuidance = {
        summary: qa.recommendations
          .slice(0, 3)
          .map((r) => r.issue)
          .join('; '),
        recommendations: qa.recommendations.map((r) => ({
          priority: r.priority,
          category: r.category,
          issue: r.issue,
          solution: r.solution,
        })),
        totalTokens: 0,
        wasTruncated: false,
      };
    }

    // Build simplified QualityAssessment for downstream consumers
    result.qualityAssessment = {
      score: qa.qualityScore,
      antiPatterns: [], // Not available from agentic analysis (no line-level scanning)
      gaps: result.qualityGaps ?? [],
      strengths: qa.strengths,
      sampledFiles: [],
      analysisTimestamp: Date.now(),
      analysisDurationMs: 0,
    };
  }

  return result;
}

// ============================================================================
// JSON Schema for SDK Structured Output
// ============================================================================

/**
 * Build a JSON Schema for the Claude Agent SDK `outputFormat` option.
 *
 * This schema constrains the agent's final response to valid analysis JSON.
 * The SDK enforces this via guided generation (constrained decoding) and
 * auto-retries on failure (`error_max_structured_output_retries`).
 *
 * The Zod schema above is still used for normalization AFTER the SDK returns
 * the structured output (case-insensitive enum mapping, default filling).
 */
export function buildAnalysisJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      projectType: {
        type: 'string',
        description:
          'Primary project type, e.g. "react", "angular", "node", "python", "nextjs", "vue", "java", "go", "rust", "dotnet", "php", "ruby". Use a descriptive string like "React SPA with Supabase Backend" if helpful.',
      },
      frameworks: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Detected frameworks and libraries, e.g. ["react", "tailwindcss", "vite", "supabase"].',
      },
      monorepoType: {
        type: ['string', 'null'],
        description:
          'Monorepo tool if detected: "nx", "lerna", "turborepo", "pnpm-workspaces", "yarn-workspaces". null if not a monorepo.',
      },
      architecturePatterns: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            confidence: { type: 'number', minimum: 0, maximum: 100 },
            evidence: { type: 'array', items: { type: 'string' } },
            description: { type: 'string' },
          },
          required: ['name', 'confidence'],
        },
        description:
          'Detected architecture patterns (DDD, Layered, MVC, Microservices, Hexagonal, Component-Based, Clean-Architecture) with confidence 0-100.',
      },
      keyFileLocations: {
        type: 'object',
        properties: {
          entryPoints: { type: 'array', items: { type: 'string' } },
          configs: { type: 'array', items: { type: 'string' } },
          testDirectories: { type: 'array', items: { type: 'string' } },
          apiRoutes: { type: 'array', items: { type: 'string' } },
          components: { type: 'array', items: { type: 'string' } },
          services: { type: 'array', items: { type: 'string' } },
          models: { type: 'array', items: { type: 'string' } },
          repositories: { type: 'array', items: { type: 'string' } },
          utilities: { type: 'array', items: { type: 'string' } },
        },
        description: 'Key file paths organized by purpose.',
      },
      languageDistribution: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            language: { type: 'string' },
            percentage: {
              type: 'number',
              minimum: 0,
              maximum: 100,
              description: 'Percentage of codebase (0-100). Must sum to ~100.',
            },
            fileCount: { type: 'number', minimum: 0 },
          },
          required: ['language', 'percentage', 'fileCount'],
        },
        description:
          'Language distribution as percentages. Each entry has language name, percentage (0-100), and file count.',
      },
      existingIssues: {
        type: 'object',
        properties: {
          errorCount: { type: 'number', minimum: 0 },
          warningCount: { type: 'number', minimum: 0 },
          infoCount: { type: 'number', minimum: 0 },
          errorsByType: {
            type: 'object',
            additionalProperties: { type: 'number' },
          },
          warningsByType: {
            type: 'object',
            additionalProperties: { type: 'number' },
          },
        },
        required: ['errorCount', 'warningCount', 'infoCount'],
        description: 'Code health diagnostics: error, warning, info counts.',
      },
      codeConventions: {
        type: 'object',
        properties: {
          indentation: { type: 'string', enum: ['tabs', 'spaces'] },
          indentSize: { type: 'number', minimum: 1, maximum: 8 },
          quoteStyle: { type: 'string', enum: ['single', 'double'] },
          semicolons: { type: 'boolean' },
          trailingComma: { type: 'string', enum: ['none', 'es5', 'all'] },
          namingConventions: {
            type: 'object',
            properties: {
              files: { type: 'string' },
              classes: { type: 'string' },
              functions: { type: 'string' },
              variables: { type: 'string' },
            },
          },
          usePrettier: { type: 'boolean' },
          useEslint: { type: 'boolean' },
        },
        required: ['indentation', 'indentSize', 'quoteStyle', 'semicolons'],
        description: 'Detected code style conventions.',
      },
      testCoverage: {
        type: 'object',
        properties: {
          percentage: { type: 'number', minimum: 0, maximum: 100 },
          hasTests: { type: 'boolean' },
          testFramework: { type: ['string', 'null'] },
          hasUnitTests: { type: 'boolean' },
          hasIntegrationTests: { type: 'boolean' },
          hasE2eTests: { type: 'boolean' },
          testFileCount: { type: 'number', minimum: 0 },
          sourceFileCount: { type: 'number', minimum: 0 },
        },
        required: ['percentage', 'hasTests'],
        description: 'Test coverage estimation.',
      },
      qualityAssessment: {
        type: 'object',
        properties: {
          qualityScore: {
            type: 'number',
            minimum: 0,
            maximum: 100,
            description:
              'Overall code quality score (0-100). Consider: type safety, error handling, architecture adherence, code organization, dependency management, security practices.',
          },
          qualityIssues: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                area: {
                  type: 'string',
                  description:
                    'Quality area: "TypeScript", "Error Handling", "Architecture", "Testing", "Security", "Performance", "Dependencies", "Code Organization".',
                },
                severity: {
                  type: 'string',
                  enum: ['high', 'medium', 'low'],
                },
                description: {
                  type: 'string',
                  description: 'Specific quality issue found.',
                },
                recommendation: {
                  type: 'string',
                  description: 'Actionable fix recommendation.',
                },
                affectedFiles: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Example file paths where issue was observed.',
                },
              },
              required: ['area', 'severity', 'description', 'recommendation'],
            },
            description:
              'Quality issues found during analysis. Include anti-patterns, missing best practices, and code smells.',
          },
          strengths: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Best practices the codebase follows well (e.g., "Consistent use of dependency injection", "Comprehensive error handling in API layer").',
          },
          recommendations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                priority: {
                  type: 'number',
                  minimum: 1,
                  description: 'Priority rank (1 = highest priority).',
                },
                category: { type: 'string' },
                issue: {
                  type: 'string',
                  description: 'What needs improvement.',
                },
                solution: {
                  type: 'string',
                  description: 'How to fix it.',
                },
              },
              required: ['priority', 'category', 'issue', 'solution'],
            },
            description: 'Prioritized quality improvement recommendations.',
          },
        },
        required: [
          'qualityScore',
          'qualityIssues',
          'strengths',
          'recommendations',
        ],
        description:
          'Code quality assessment based on codebase exploration. Evaluate type safety, error handling, architecture adherence, testing practices, security, and code organization.',
      },
    },
    required: [
      'projectType',
      'frameworks',
      'architecturePatterns',
      'keyFileLocations',
      'languageDistribution',
      'existingIssues',
      'codeConventions',
      'testCoverage',
      'qualityAssessment',
    ],
  };
}
