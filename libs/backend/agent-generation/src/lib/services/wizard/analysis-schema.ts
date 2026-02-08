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

// ============================================================================
// Enum Lookup Maps (case-insensitive)
// ============================================================================

/**
 * Build a case-insensitive lookup map from an enum's values.
 * Maps normalized keys (lowercase, alphanumeric only) to enum values.
 */
function buildLookupMap<T extends string>(
  enumObj: Record<string, T>
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
 * Resolve a raw LLM string to a ProjectType enum value.
 * Uses case-insensitive matching with alias fallback.
 */
function resolveProjectType(raw: string | number): ProjectType {
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
  raw: string | undefined
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
  monorepoType: z.string().optional(),

  // Architecture patterns with confidence scoring
  architecturePatterns: z
    .array(
      z.object({
        name: z.string(),
        confidence: z.number().min(0).max(100),
        evidence: z.array(z.string()),
        description: z.string().optional(),
      })
    )
    .default([]),

  // Key file locations organized by purpose
  keyFileLocations: z
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

  // Language distribution statistics
  languageDistribution: z
    .array(
      z.object({
        language: z.string(),
        percentage: z.number().min(0).max(100),
        fileCount: z.number().min(0),
        linesOfCode: z.number().min(0).optional(),
      })
    )
    .default([]),

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
          })
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
  codeConventions: z
    .object({
      indentation: z.enum(['tabs', 'spaces']),
      indentSize: z.number().min(1).max(8),
      quoteStyle: z.enum(['single', 'double']),
      semicolons: z.boolean(),
      trailingComma: z.enum(['none', 'es5', 'all']).default('es5'),
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
      testFramework: z.string().optional(),
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
  zodData: ProjectAnalysisZodOutput
): DeepProjectAnalysis {
  // Resolve projectType from LLM string to enum
  const projectType = resolveProjectType(zodData.projectType);

  if (projectType === ProjectType.General) {
    console.warn(
      `[analysis-schema] projectType "${String(
        zodData.projectType
      )}" could not be resolved to a known ProjectType; falling back to General`
    );
  }

  // Resolve frameworks, filtering out unrecognized values
  const resolvedFrameworks = zodData.frameworks.map((f) => ({
    raw: f,
    resolved: resolveFramework(f),
  }));

  const filteredOut = resolvedFrameworks.filter(
    (r) => r.resolved === undefined
  );
  if (filteredOut.length > 0) {
    console.warn(
      `[analysis-schema] Unrecognized frameworks filtered out: ${filteredOut
        .map((r) => `"${String(r.raw)}"`)
        .join(', ')}`
    );
  }

  const frameworks = resolvedFrameworks
    .map((r) => r.resolved)
    .filter((f): f is Framework => f !== undefined);

  // Resolve monorepoType
  const monorepoType = resolveMonorepoType(zodData.monorepoType);

  // codeConventions is guaranteed to have all required fields by Zod defaults,
  // including trailingComma which uses .default('es5') at the field level.
  const codeConventions = zodData.codeConventions;

  // Build the properly typed result
  const result: DeepProjectAnalysis = {
    projectType,
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

  return result;
}
