/**
 * Generation Prompts for Prompt Designer Agent
 *
 * to generate project-specific guidance.
 *
 * These prompts are carefully crafted to produce consistent, actionable
 * output that integrates well with PTAH_CORE_SYSTEM_PROMPT.
 *
 * NOTE: All framework-specific and tooling-specific hard-coded guidance has been
 * removed. The LLM receives the full dependency list and generates guidance
 * dynamically based on what it discovers — no pre-built dictionaries.
 */

import type { PromptDesignerInput } from './prompt-designer.types';
import type {
  QualityAssessment,
  PrescriptiveGuidance,
} from '@ptah-extension/shared';

/**
 * System prompt for the Prompt Designer Agent
 *
 * This establishes the agent's role and output expectations.
 */
export const PROMPT_DESIGNER_SYSTEM_PROMPT = `You are a Prompt Designer Agent. Your task is to generate concise, actionable guidance for an AI assistant that will help developers in a specific project.

CRITICAL CONSTRAINTS:
- Do NOT attempt to call any tools or explore the filesystem.
- ALL project information you need is provided in the PROJECT ANALYSIS DATA in the user prompt.
- Base every piece of generated guidance EXCLUSIVELY on the provided analysis data.
- Do NOT fabricate, guess, or assume any project details not present in the analysis data.

## Your Role

You analyze project metadata (type, framework, dependencies) and generate tailored instructions that help the AI assistant understand:
1. What this project is and its key technologies
2. Framework-specific patterns to follow
3. Coding standards derived from the project's tooling
4. Architecture guidelines and boundaries

## Output Quality Requirements

- Be SPECIFIC to this project. Avoid generic advice that applies to all projects.
- Keep each section focused and actionable.
- Use imperative language ("Use...", "Follow...", "Prefer...").
- Reference specific frameworks, libraries, and patterns from the project.
- If the project uses TypeScript, emphasize type safety.
- If it's a monorepo, emphasize library boundaries.

## Token Budget

Each section must stay under 400 tokens. Total output should be under 1600 tokens.
Prioritize the most impactful guidance over comprehensive coverage.`;

/**
 * Build quality context section for inclusion in generation prompts.
 *
 * Formats quality assessment data into a concise prompt section that helps
 * the LLM generate quality-specific guidance.
 *
 * Supports two data sources:
 * - antiPatterns: Line-level anti-patterns from file-sampling analysis (legacy)
 * - gaps: Area-level quality gaps from agentic analysis (current)
 *
 * @param assessment - Quality assessment (from agentic analysis or legacy pipeline)
 * @param guidance - Prescriptive guidance with prioritized recommendations
 * @returns Formatted quality context string (under 300 tokens) or empty string if no data
 */
export function buildQualityContextPrompt(
  assessment: QualityAssessment | undefined,
  guidance: PrescriptiveGuidance | undefined,
): string {
  // Return empty if no assessment or no detected issues from either source
  const hasAntiPatterns = assessment?.antiPatterns?.length ?? 0;
  const hasGaps = assessment?.gaps?.length ?? 0;
  if (!assessment || (hasAntiPatterns === 0 && hasGaps === 0)) {
    return '';
  }

  const parts: string[] = [];

  // Quality score header
  parts.push(`## Code Quality Context (Score: ${assessment.score}/100)`);
  parts.push('');

  // Top 5 detected anti-patterns (by frequency, then severity) — legacy source
  if (assessment.antiPatterns.length > 0) {
    const sortedPatterns = [...assessment.antiPatterns].sort((a, b) => {
      if (b.frequency !== a.frequency) {
        return b.frequency - a.frequency;
      }
      const severityOrder: Record<string, number> = {
        error: 3,
        warning: 2,
        info: 1,
      };
      const getSeverityScore = (s: string): number => severityOrder[s] ?? 0;
      return getSeverityScore(b.severity) - getSeverityScore(a.severity);
    });

    const topIssues = sortedPatterns.slice(0, 5);
    parts.push('### Detected Issues:');
    for (const pattern of topIssues) {
      const severityBadge =
        pattern.severity === 'error'
          ? '[ERROR]'
          : pattern.severity === 'warning'
            ? '[WARN]'
            : '[INFO]';
      parts.push(
        `- ${severityBadge} ${pattern.message} (${pattern.frequency} occurrences)`,
      );
    }
    parts.push('');
  }

  // Top 5 quality gaps (by priority) — agentic analysis source
  if (assessment.gaps.length > 0) {
    const priorityOrder: Record<string, number> = {
      high: 3,
      medium: 2,
      low: 1,
    };
    const sortedGaps = [...assessment.gaps].sort(
      (a, b) =>
        (priorityOrder[b.priority] ?? 0) - (priorityOrder[a.priority] ?? 0),
    );

    const topGaps = sortedGaps.slice(0, 5);
    parts.push('### Quality Gaps:');
    for (const gap of topGaps) {
      const badge =
        gap.priority === 'high'
          ? '[HIGH]'
          : gap.priority === 'medium'
            ? '[MEDIUM]'
            : '[LOW]';
      parts.push(`- ${badge} **${gap.area}**: ${gap.description}`);
    }
    parts.push('');
  }

  // Strengths (from agentic analysis)
  if (assessment.strengths.length > 0) {
    const topStrengths = assessment.strengths.slice(0, 3);
    parts.push('### Strengths:');
    for (const strength of topStrengths) {
      parts.push(`- ${strength}`);
    }
    parts.push('');
  }

  // Top 3 recommendations from guidance
  if (guidance && guidance.recommendations.length > 0) {
    const topRecommendations = guidance.recommendations.slice(0, 3);
    parts.push('### Top Recommendations:');
    for (const rec of topRecommendations) {
      parts.push(`- **${rec.category}**: ${rec.solution}`);
    }
    parts.push('');
  }

  // Instruction for the LLM
  parts.push(
    '**Note:** Include specific guidance addressing these quality issues in the Quality Guidance section.',
  );

  return parts.join('\n');
}

/**
 * Build the user prompt for generating project guidance
 *
 * @param input - Project analysis data
 * @param qualityContext - Optional quality context section (from buildQualityContextPrompt)
 * @returns User prompt string
 */
export function buildGenerationUserPrompt(
  input: PromptDesignerInput,
  qualityContext?: string,
): string {
  const dependencyList = input.dependencies.slice(0, 20).join(', ');
  const devDependencyList = input.devDependencies.slice(0, 15).join(', ');

  const basePrompt = `## Project Analysis

**Project Type:** ${input.projectType}
**Framework:** ${input.framework || 'Not detected'}
**Monorepo:** ${
    input.isMonorepo ? `Yes (${input.monorepoType || 'Unknown type'})` : 'No'
  }
**Workspace Path:** ${input.workspacePath}

**Key Dependencies:**
${dependencyList || 'None detected'}

**Dev Dependencies:**
${devDependencyList || 'None detected'}

${
  input.sampleFilePaths && input.sampleFilePaths.length > 0
    ? `**Sample Files:**
${input.sampleFilePaths.map((p) => `- ${p}`).join('\n')}`
    : ''
}

## Your Task

Generate guidance in these ${
    qualityContext ? 'five' : 'four'
  } categories. Keep each section under 400 tokens.

### 1. Project Context
A brief description of what this project is based on its dependencies and structure.
Include: main purpose, key technologies, target platform/environment.

### 2. Framework Guidelines
Specific patterns and best practices for the detected framework(s).
Focus on: component patterns, state management, data flow, testing approaches.
Reference specific libraries from the dependencies.

### 3. Coding Standards
SOLID principles application, naming conventions, error handling.
Derive standards from detected tooling (ESLint configs, TypeScript settings).
Include: type safety expectations, import organization, code structure.

### 4. Architecture Notes
${
  input.isMonorepo
    ? `This is a ${
        input.monorepoType || 'monorepo'
      } - emphasize library boundaries and dependency rules.`
    : 'Single-project structure - focus on folder organization and module boundaries.'
}
Include: key abstractions, import patterns, layer boundaries.`;

  // Add quality guidance section if quality context is provided
  let prompt = basePrompt;
  if (qualityContext) {
    prompt += `

### 5. Quality Guidance (Optional)
Based on the Code Quality Context below, provide specific guidance for addressing the detected issues.
Focus on: preventing anti-patterns, improving error handling, maintaining code quality.
Keep this section under 300 tokens.

${qualityContext}`;
  }

  // Append additional analysis context from multi-phase analysis
  if (input.additionalContext) {
    prompt += `

## Additional Analysis Context

The following analysis data provides deeper insight into the project's quality and improvement opportunities.
Use this to generate more specific, actionable guidance in all sections above.

${input.additionalContext}`;
  }

  return prompt;
}

/**
 * Build fallback guidance when LLM is unavailable.
 *
 * Generates generic guidance from the project metadata without
 * any hard-coded framework-specific advice. The guidance is basic
 * but accurate — it lists what was detected and provides universal
 * software engineering best practices.
 */
export function buildFallbackGuidance(input: PromptDesignerInput): string {
  const parts: string[] = [];

  // Project context fallback
  parts.push(`## Project Context

This is a ${input.projectType} project${
    input.framework ? ` using ${input.framework}` : ''
  }.${
    input.isMonorepo
      ? ` It's organized as a ${input.monorepoType || 'monorepo'}.`
      : ''
  }`);

  // Framework guidelines — list detected dependencies for context
  if (input.framework) {
    const deps = input.dependencies.slice(0, 10);
    const depsText =
      deps.length > 0 ? `\n\nKey dependencies: ${deps.join(', ')}` : '';
    parts.push(`## Framework Guidelines

Follow established patterns and best practices for ${input.framework}.
Reference the project's existing code for conventions and patterns.${depsText}`);
  }

  // Coding standards — universal best practices
  const standards: string[] = [
    '- Follow consistent naming conventions used in the existing codebase',
    '- Keep functions small and focused on a single responsibility',
    '- Handle errors explicitly at system boundaries',
  ];

  if (input.devDependencies.some((d) => d.includes('typescript'))) {
    standards.push('- Use TypeScript strict mode features; avoid `any` types');
  }
  if (input.devDependencies.some((d) => d.includes('eslint'))) {
    standards.push('- Follow the configured ESLint rules');
  }
  if (input.devDependencies.some((d) => d.includes('prettier'))) {
    standards.push('- Use Prettier for consistent formatting');
  }

  parts.push(`## Coding Standards

${standards.join('\n')}`);

  // Architecture notes
  if (input.isMonorepo) {
    parts.push(`## Architecture Notes

This is a ${
      input.monorepoType || 'monorepo'
    } structure. Respect library boundaries and follow the established dependency graph. Avoid circular dependencies between libraries.`);
  }

  return parts.join('\n\n');
}
