/**
 * Core Type System for Agent Generation
 *
 * This module provides the foundational types for the intelligent project-adaptive
 * agent generation system. These types define the structure for agent templates,
 * project context analysis, generation options, and validation results.
 *
 * @module @ptah-extension/agent-generation/types
 */

import {
  ProjectType,
  Framework,
  MonorepoType,
  IndexedFile,
} from '@ptah-extension/workspace-intelligence';

/**
 * Template definition for agent generation.
 * Combines static content with LLM-customizable sections and variable substitution.
 *
 * Templates are stored as markdown files with YAML frontmatter containing metadata.
 * The content uses special markers for different section types:
 * - `{{variable}}` - Variable substitution
 * - `<!-- STATIC -->...<!-- /STATIC -->` - Static content (never modified by LLM)
 * - `<!-- LLM:topic -->...<!-- /LLM -->` - LLM-customizable section
 *
 * @example
 * ```typescript
 * const template: AgentTemplate = {
 *   id: 'backend-developer',
 *   name: 'Backend Developer',
 *   version: '1.0.0',
 *   content: '# Backend Developer\n\n{{projectContext}}\n\n<!-- LLM:architecture -->...',
 *   applicabilityRules: {
 *     projectTypes: [ProjectType.Node, ProjectType.Python],
 *     frameworks: [Framework.Express, Framework.Django],
 *     monorepoTypes: [],
 *     minimumRelevanceScore: 70,
 *     alwaysInclude: false
 *   },
 *   variables: [{
 *     name: 'projectContext',
 *     description: 'Project-specific context',
 *     required: true,
 *     source: 'project-context'
 *   }],
 *   llmSections: [{
 *     id: 'architecture',
 *     topic: 'Project architecture patterns',
 *     prompt: 'Describe the architectural patterns for this {{projectType}} project',
 *     maxTokens: 1000
 *   }]
 * };
 * ```
 */
export interface AgentTemplate {
  /**
   * Unique template identifier (e.g., 'backend-developer', 'orchestrate').
   * Must be kebab-case and match the filename without extension.
   */
  id: string;

  /**
   * Human-readable template name (e.g., 'Backend Developer', 'Orchestrate Command').
   * Used in UI displays and selection interfaces.
   */
  name: string;

  /**
   * Template version following semantic versioning (e.g., '1.0.0', '2.1.3').
   * Used for migration detection and update management.
   */
  version: string;

  /**
   * Template content in markdown format with special markers.
   * Contains the full agent/command content including STATIC, LLM, and VARIABLE sections.
   */
  content: string;

  /**
   * Rules determining when this template should be selected for a project.
   * Used by AgentSelectionService to score template relevance.
   */
  applicabilityRules: ApplicabilityRules;

  /**
   * Variables that can be substituted in the template content.
   * Variables use `{{variableName}}` syntax in the content.
   */
  variables: TemplateVariable[];

  /**
   * Sections that will be customized by LLM based on project context.
   * Each section is marked with `<!-- LLM:sectionId -->` in the content.
   */
  llmSections: LlmSection[];
}

/**
 * Rules for determining when a template should be selected for a project.
 *
 * Templates are scored based on how well they match the project characteristics.
 * A template is selected if its relevance score meets or exceeds the minimumRelevanceScore,
 * or if alwaysInclude is true.
 *
 * @example
 * ```typescript
 * // Template for Node.js backend projects with Express
 * const rules: ApplicabilityRules = {
 *   projectTypes: [ProjectType.Node],
 *   frameworks: [Framework.Express],
 *   monorepoTypes: [], // Applies to both monorepos and single projects
 *   minimumRelevanceScore: 70,
 *   alwaysInclude: false
 * };
 * ```
 */
export interface ApplicabilityRules {
  /**
   * Project types this template applies to.
   * If empty, applies to all project types.
   * Multiple types indicate the template is useful for any of these types.
   */
  projectTypes: ProjectType[];

  /**
   * Frameworks this template applies to.
   * If empty, applies to all frameworks.
   * Multiple frameworks indicate the template is useful for any of these frameworks.
   *
   * Supports both known Framework enum values and dynamically discovered
   * frameworks as strings (e.g., 'tailwindcss', 'redux').
   */
  frameworks: string[];

  /**
   * Monorepo types this template applies to.
   * If empty, applies to both monorepos and non-monorepos.
   * Specific types indicate the template is optimized for those monorepo tools.
   */
  monorepoTypes: MonorepoType[];

  /**
   * Minimum relevance score (0-100) required for this template to be selected.
   * Higher scores mean more selective (only included for highly relevant projects).
   * Lower scores mean more inclusive (included for most projects).
   *
   * Typical values:
   * - 90+: Highly specialized (e.g., React Native specific agent)
   * - 70-89: Moderately specialized (e.g., backend development agent)
   * - 50-69: General purpose (e.g., code reviewer agent)
   * - <50: Universal (e.g., help command)
   */
  minimumRelevanceScore: number;

  /**
   * Whether to always include this template regardless of relevance score.
   * Use for essential agents/commands that every project needs (e.g., help, orchestrate).
   */
  alwaysInclude: boolean;
}

/**
 * Variable definition for template substitution.
 *
 * Variables are placeholders in the template content that get replaced with
 * project-specific or user-provided values during generation.
 *
 * @example
 * ```typescript
 * const variable: TemplateVariable = {
 *   name: 'projectName',
 *   description: 'The name of the project',
 *   defaultValue: 'my-project',
 *   required: true,
 *   source: 'project-context'
 * };
 * // In template: "Welcome to {{projectName}}"
 * // After substitution: "Welcome to ptah-extension"
 * ```
 */
export interface TemplateVariable {
  /**
   * Variable name used in template content (without curly braces).
   * Must be camelCase and match `{{name}}` placeholders in the content.
   */
  name: string;

  /**
   * Human-readable description of what this variable represents.
   * Used in documentation and validation error messages.
   */
  description: string;

  /**
   * Default value to use if the variable cannot be resolved.
   * If undefined and variable is required, generation will fail.
   */
  defaultValue?: string;

  /**
   * Whether this variable must be provided for successful generation.
   * Required variables without values will cause validation errors.
   */
  required: boolean;

  /**
   * Source of the variable value.
   * - 'project-context': Extracted from workspace analysis (e.g., projectType, frameworks)
   * - 'user-input': Provided by user through the setup wizard
   * - 'llm-generated': Generated by LLM based on project analysis
   */
  source: 'project-context' | 'user-input' | 'llm-generated';
}

/**
 * Section of template that will be customized by LLM.
 *
 * LLM sections are marked in the template content with special comments:
 * `<!-- LLM:sectionId -->content<!-- /LLM -->`
 *
 * During generation, these sections are replaced with LLM-generated content
 * tailored to the specific project context.
 *
 * @example
 * ```typescript
 * const section: LlmSection = {
 *   id: 'architecture',
 *   topic: 'Project Architecture Patterns',
 *   prompt: 'Analyze the project structure and describe the architectural patterns used in this {{projectType}} project with {{frameworks}}. Focus on layer separation, dependency management, and code organization.',
 *   maxTokens: 1000
 * };
 * ```
 */
export interface LlmSection {
  /**
   * Unique section identifier matching the marker in template content.
   * Must be kebab-case and match `<!-- LLM:id -->` markers.
   */
  id: string;

  /**
   * Human-readable topic or purpose of this section.
   * Used in progress tracking and validation messages.
   */
  topic: string;

  /**
   * Prompt to send to LLM for generating customized content.
   * Can include variable substitutions (e.g., {{projectType}}).
   * Should be specific and provide clear instructions for the LLM.
   */
  prompt: string;

  /**
   * Maximum number of tokens for the LLM response.
   * If undefined, uses the default limit from VsCodeLmService.
   * Typical values: 500-2000 depending on section complexity.
   */
  maxTokens?: number;
}

/**
 * Extended project context for agent generation.
 * Builds on workspace-intelligence analysis with additional metadata
 * needed for template selection and customization.
 *
 * @example
 * ```typescript
 * const context: AgentProjectContext = {
 *   projectType: ProjectType.Node,
 *   frameworks: [Framework.Express],
 *   monorepoType: MonorepoType.Nx,
 *   rootPath: '/workspace/ptah-extension',
 *   relevantFiles: [...indexedFiles],
 *   techStack: {
 *     languages: ['TypeScript', 'JavaScript'],
 *     frameworks: ['Express', 'NestJS'],
 *     buildTools: ['Nx', 'esbuild'],
 *     testingFrameworks: ['Jest', 'Vitest'],
 *     packageManager: 'npm'
 *   },
 *   codeConventions: {
 *     indentation: 'spaces',
 *     indentSize: 2,
 *     quoteStyle: 'single',
 *     semicolons: true,
 *     trailingComma: 'es5'
 *   }
 * };
 * ```
 */
export interface AgentProjectContext {
  /**
   * Detected project type from workspace analysis.
   * Primary factor in template selection scoring.
   */
  projectType: ProjectType;

  /**
   * Detected frameworks used in the project.
   * Used for template selection and LLM customization.
   *
   * Supports both known Framework enum values and dynamically discovered
   * frameworks as strings (e.g., 'tailwindcss', 'redux', 'zustand').
   */
  frameworks: string[];

  /**
   * Monorepo type if the project is a monorepo.
   * Undefined for non-monorepo projects.
   */
  monorepoType?: MonorepoType;

  /**
   * Absolute path to the project root directory.
   * Used for file path resolution and workspace operations.
   */
  rootPath: string;

  /**
   * Key files relevant to agent generation and project understanding.
   * Typically includes configuration files, entry points, and critical modules.
   */
  relevantFiles: IndexedFile[];

  /**
   * Summary of the project's technology stack.
   * Used in LLM prompts and variable substitution.
   */
  techStack: TechStackSummary;

  /**
   * Code style conventions detected from the project.
   * Used in LLM prompts to ensure generated content matches project style.
   */
  codeConventions: CodeConventions;

  /**
   * Full wizard analysis data when available.
   * Carries all deep analysis fields (architecture patterns, test coverage,
   * language distribution, code conventions, etc.) for rich LLM prompting.
   */
  fullAnalysis?: import('@ptah-extension/shared').ProjectAnalysisResult;

  /**
   * Path to the multi-phase analysis directory.
   * When present, ContentGenerationService reads rich analysis files
   * instead of using formatAnalysisData().
   */
  analysisDir?: string;
}

/**
 * Summary of project's technology stack.
 * Extracted from package.json, requirements.txt, and other dependency files.
 */
export interface TechStackSummary {
  /**
   * Programming languages detected in the project (e.g., 'TypeScript', 'Python').
   * Ordered by prevalence (most used first).
   */
  languages: string[];

  /**
   * Frameworks and major libraries used (e.g., 'React', 'Express', 'Django').
   * Includes both frontend and backend frameworks.
   */
  frameworks: string[];

  /**
   * Build tools and task runners (e.g., 'Webpack', 'Vite', 'esbuild', 'Nx').
   */
  buildTools: string[];

  /**
   * Testing frameworks and libraries (e.g., 'Jest', 'Mocha', 'pytest').
   */
  testingFrameworks: string[];

  /**
   * Package manager used by the project (e.g., 'npm', 'yarn', 'pnpm', 'pip').
   */
  packageManager: string;
}

/**
 * Code style conventions detected from project files.
 * Used to ensure generated agents match the project's existing code style.
 */
export interface CodeConventions {
  /**
   * Indentation style: tabs or spaces.
   */
  indentation: 'tabs' | 'spaces';

  /**
   * Number of spaces per indentation level (if using spaces).
   * Common values: 2, 4.
   */
  indentSize: number;

  /**
   * Quote style preference: single or double quotes.
   */
  quoteStyle: 'single' | 'double';

  /**
   * Whether to use semicolons at end of statements.
   */
  semicolons: boolean;

  /**
   * Trailing comma style in multi-line structures.
   * - 'none': No trailing commas
   * - 'es5': Trailing commas in ES5-compatible positions (arrays, objects)
   * - 'all': Trailing commas everywhere possible (including function parameters)
   */
  trailingComma: 'none' | 'es5' | 'all';
}

/**
 * LLM-generated customization for a template section.
 * Records the input prompt, generated content, and token usage.
 */
export interface LlmCustomization {
  /**
   * ID of the section that was customized (matches LlmSection.id).
   */
  sectionId: string;

  /**
   * Original prompt sent to the LLM (after variable substitution).
   */
  originalPrompt: string;

  /**
   * Content generated by the LLM for this section.
   */
  generatedContent: string;

  /**
   * Number of tokens used for this generation (prompt + completion).
   */
  tokensUsed: number;
}

/**
 * Result of generating an agent from a template.
 * Contains the final generated content, all substitutions made, and metadata.
 *
 * @example
 * ```typescript
 * const generated: GeneratedAgent = {
 *   sourceTemplateId: 'backend-developer',
 *   sourceTemplateVersion: '1.0.0',
 *   content: '# Backend Developer\n\n...',
 *   variables: {
 *     projectName: 'ptah-extension',
 *     projectType: 'Node.js',
 *     frameworks: 'Express, NestJS'
 *   },
 *   customizations: [{
 *     sectionId: 'architecture',
 *     originalPrompt: '...',
 *     generatedContent: '...',
 *     tokensUsed: 850
 *   }],
 *   generatedAt: new Date(),
 *   filePath: '.claude/agents/backend-developer.md'
 * };
 * ```
 */
export interface GeneratedAgent {
  /**
   * ID of the template used to generate this agent.
   * Used for version tracking and migration detection.
   */
  sourceTemplateId: string;

  /**
   * Version of the template at generation time.
   * Used to detect when updates are available.
   */
  sourceTemplateVersion: string;

  /**
   * Final generated content ready to be written to file.
   * Includes all variable substitutions and LLM customizations.
   */
  content: string;

  /**
   * Map of variable names to their substituted values.
   * Useful for debugging and regeneration.
   */
  variables: Record<string, string>;

  /**
   * All LLM-generated customizations applied to this agent.
   * Ordered by section appearance in the template.
   */
  customizations: LlmCustomization[];

  /**
   * Timestamp when this agent was generated.
   * Used for freshness checks and migration decisions.
   */
  generatedAt: Date;

  /**
   * Target file path where this agent should be written.
   * Relative to workspace root (e.g., '.claude/agents/backend-developer.md').
   */
  filePath: string;
}

/**
 * Options for controlling the agent generation process.
 *
 * @example
 * ```typescript
 * const options: GenerationOptions = {
 *   threshold: 70,
 *   includeOptional: true,
 *   autoApprove: false,
 *   variableOverrides: {
 *     projectName: 'My Custom Name'
 *   }
 * };
 * ```
 */
export interface GenerationOptions {
  /**
   * Minimum relevance score threshold (0-100) for template selection.
   * Templates with scores below this threshold are excluded.
   * Default: 50
   */
  threshold: number;

  /**
   * Whether to include templates marked as optional.
   * Optional templates have lower relevance scores but may be useful.
   * Default: true
   */
  includeOptional: boolean;

  /**
   * Whether to automatically approve LLM-generated content without user review.
   * If false, user must review and approve each LLM customization.
   * Default: false (requires manual approval)
   */
  autoApprove: boolean;

  /**
   * Custom variable values that override defaults and project-derived values.
   * Useful for testing or manual customization.
   */
  variableOverrides?: Record<string, string>;
}

/**
 * Summary of agent generation results.
 * Provides high-level statistics and detailed results for each agent.
 *
 * @example
 * ```typescript
 * const summary: GenerationSummary = {
 *   totalAgents: 5,
 *   successful: 4,
 *   failed: 1,
 *   durationMs: 45000,
 *   warnings: ['LLM customization failed for backend-developer section "examples", using fallback'],
 *   agents: [...generatedAgents]
 * };
 * ```
 */
export interface GenerationSummary {
  /**
   * Total number of agents attempted to generate.
   */
  totalAgents: number;

  /**
   * Number of agents successfully generated and written.
   */
  successful: number;

  /**
   * Number of agents that failed to generate.
   */
  failed: number;

  /**
   * Total time taken for generation in milliseconds.
   */
  durationMs: number;

  /**
   * Warning messages from the generation process.
   * Non-fatal issues like fallbacks to generic content.
   */
  warnings: string[];

  /**
   * All successfully generated agents.
   */
  agents: GeneratedAgent[];

  /**
   * Whether enhanced prompts were used during Phase 3 customization.
   * True when project-specific enhanced prompt content was provided and
   * prepended to the LLM system prompt for section customization.
   */
  enhancedPromptsUsed?: boolean;

  /**
   * Per-CLI agent distribution results (Phase 5).
   * Present when targetClis was specified in OrchestratorGenerationOptions.
   * TASK_2025_160: Multi-CLI agent distribution
   */
  cliResults?: import('@ptah-extension/shared').CliGenerationResult[];
}

/**
 * Result of validating LLM-generated content.
 * Includes validation status, detailed issues, and quality score.
 *
 * @example
 * ```typescript
 * const validation: ValidationResult = {
 *   isValid: false,
 *   issues: [{
 *     severity: 'error',
 *     message: 'Content contains potentially malicious code execution',
 *     suggestion: 'Remove script tags and external URLs'
 *   }],
 *   score: 45
 * };
 * ```
 */
export interface ValidationResult {
  /**
   * Whether the content passed all validation checks.
   * If false, the content should not be used and may need regeneration.
   */
  isValid: boolean;

  /**
   * List of validation issues found.
   * Includes errors, warnings, and informational messages.
   */
  issues: ValidationIssue[];

  /**
   * Overall quality score (0-100).
   * Based on schema compliance, safety, factual accuracy, and coherence.
   *
   * Score ranges:
   * - 90-100: Excellent, ready to use
   * - 70-89: Good, minor issues
   * - 50-69: Acceptable, notable issues
   * - <50: Poor, should be regenerated
   */
  score: number;
}

/**
 * Individual validation issue found in LLM-generated content.
 */
export interface ValidationIssue {
  /**
   * Severity level of the issue.
   * - 'error': Critical issue, content cannot be used
   * - 'warning': Significant issue, content may need review
   * - 'info': Minor issue or suggestion for improvement
   */
  severity: 'error' | 'warning' | 'info';

  /**
   * Human-readable description of the issue.
   */
  message: string;

  /**
   * Suggested fix for the issue (if available).
   * May include code snippets or specific instructions.
   */
  suggestion?: string;
}
