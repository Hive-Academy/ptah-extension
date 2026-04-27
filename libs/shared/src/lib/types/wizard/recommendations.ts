/**
 * Setup Wizard agent recommendations + project analysis result.
 *
 * Extracted from setup-wizard.types.ts (TASK_2025_291 Wave C2) — zero behavior change.
 */

import type {
  ArchitecturePattern,
  DiagnosticSummary,
  KeyFileLocations,
  LanguageStats,
  TestCoverageEstimate,
} from './analysis';
import type { CodeConventions } from './conventions';

// ============================================================================
// Agent Recommendation Types
// ============================================================================

/**
 * Agent category for grouping and display.
 */
export type AgentCategory =
  | 'planning'
  | 'development'
  | 'qa'
  | 'specialist'
  | 'creative';

/**
 * Agent recommendation based on deep project analysis.
 *
 * Provides a scored recommendation for each agent based on
 * how well it matches the project's characteristics.
 *
 * @example
 * ```typescript
 * const recommendation: AgentRecommendation = {
 *   agentId: 'backend-developer',
 *   agentName: 'Backend Developer',
 *   relevanceScore: 92,
 *   matchedCriteria: [
 *     'NestJS framework detected',
 *     'TypeORM entities found',
 *     'REST API routes detected'
 *   ],
 *   category: 'development',
 *   recommended: true,
 *   description: 'Implements APIs, database logic, and server-side code',
 *   icon: 'server'
 * };
 * ```
 */
export interface AgentRecommendation {
  /** Unique agent identifier (kebab-case). Matches template file name. */
  agentId: string;
  /** Human-readable agent name. Used for display in the wizard UI. */
  agentName: string;
  /** Relevance score (0-100) based on project analysis. */
  relevanceScore: number;
  /** List of criteria that contributed to the score. */
  matchedCriteria: string[];
  /** Agent category ('planning', 'development', 'qa', 'specialist', 'creative'). */
  category: AgentCategory;
  /** Whether this agent is recommended (score >= 75). */
  recommended: boolean;
  /** Optional: Agent description for display. */
  description?: string;
  /** Optional: Icon identifier for UI display. */
  icon?: string;
}

// ============================================================================
// Project Analysis Result Types
// ============================================================================

/**
 * Project analysis result for RPC communication.
 * Simplified version using string types for cross-boundary safety.
 *
 * This interface is used for communication between frontend and backend,
 * avoiding dependencies on workspace-intelligence enums.
 *
 * @example
 * ```typescript
 * const result: ProjectAnalysisResult = {
 *   projectType: 'Node.js',
 *   fileCount: 250,
 *   languages: ['TypeScript', 'JavaScript'],
 *   frameworks: ['NestJS', 'Angular'],
 *   monorepoType: 'Nx',
 *   architecturePatterns: [{ name: 'Layered', confidence: 85, evidence: [] }],
 *   keyFileLocations: { entryPoints: [], configs: [], ... },
 *   existingIssues: { errorCount: 5, warningCount: 20, ... },
 *   testCoverage: { percentage: 72, hasTests: true, ... }
 * };
 * ```
 */
export interface ProjectAnalysisResult {
  /**
   * Project type enum value as string (e.g., 'angular', 'node', 'react').
   * Best-effort mapping for infrastructure code compatibility.
   */
  projectType: string;

  /**
   * Agent's rich project type description (e.g., "React SPA with Supabase Backend",
   * "Angular Nx Monorepo with NestJS API"). Preserves the agent's intelligent analysis.
   * This is what the frontend should display to users.
   */
  projectTypeDescription?: string;

  /** Total file count in the project. */
  fileCount: number;
  /** Programming languages detected (as strings). */
  languages: string[];
  /** Frameworks detected (as strings). */
  frameworks: string[];
  /** Monorepo type if applicable (e.g., 'Nx', 'Lerna', 'Turborepo'). */
  monorepoType?: string;
  /** Architecture patterns with confidence scores. */
  architecturePatterns: ArchitecturePattern[];
  /** Key file locations organized by purpose. */
  keyFileLocations: KeyFileLocations;
  /** Language distribution statistics. */
  languageDistribution?: LanguageStats[];
  /** Code health issues summary. */
  existingIssues: DiagnosticSummary;
  /** Test coverage estimate. */
  testCoverage: TestCoverageEstimate;
  /** Code conventions detected. */
  codeConventions?: CodeConventions;

  // ========================================
  // Quality Assessment Fields (TASK_2025_151)
  // All fields optional for backward compatibility
  // ========================================

  /**
   * Overall code quality score (0-100).
   * Assessed by the agentic analysis based on codebase exploration.
   */
  qualityScore?: number;

  /**
   * Quality issues found during analysis.
   * Anti-patterns, missing best practices, and code smells.
   */
  qualityIssues?: Array<{
    area: string;
    severity: 'high' | 'medium' | 'low';
    description: string;
    recommendation: string;
    affectedFiles?: string[];
  }>;

  /**
   * Identified strengths — best practices the codebase follows well.
   */
  qualityStrengths?: string[];

  /**
   * Prioritized quality improvement recommendations.
   */
  qualityRecommendations?: Array<{
    priority: number;
    category: string;
    issue: string;
    solution: string;
  }>;
}
