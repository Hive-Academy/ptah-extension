/**
 * Prompt Designer Agent
 *
 * TASK_2025_137 Batch 2: Intelligent agent that analyzes workspaces and generates
 * project-specific guidance to append to PTAH_CORE_SYSTEM_PROMPT.
 *
 * This agent is now a pure prompt builder + result parser with NO LLM dependency.
 * The actual LLM call is handled by EnhancedPromptsService via InternalQueryService.
 *
 * Public API:
 * - buildPrompts(input, qualityContext?): returns system + user prompts and JSON Schema
 * - parseAndValidateOutput(structuredOutput, onProgress?): parses SDK output into PromptDesignerOutput
 * - enforceTokenBudgets(output): truncates sections exceeding token budgets
 * - generateFallbackGuidance(input, qualityAssessment?, fallbackReason?): template-based fallback
 * - formatAsPrompt(output): formats PromptDesignerOutput for system prompt
 */

import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type {
  QualityAssessment,
  PrescriptiveGuidance,
} from '@ptah-extension/shared';
import {
  type PromptDesignerInput,
  type PromptDesignerOutput,
  type PromptDesignerConfig,
  type PromptGenerationProgress,
  type PromptDesignerResponse,
  PromptDesignerResponseSchema,
  DEFAULT_PROMPT_DESIGNER_CONFIG,
} from './prompt-designer.types';
import {
  PROMPT_DESIGNER_SYSTEM_PROMPT,
  buildGenerationUserPrompt,
  buildFallbackGuidance,
  buildQualityContextPrompt,
} from './generation-prompts';
import {
  parseStructuredResponse,
  validateOutput,
  formatAsPromptSection,
  truncateToTokenBudget,
} from './response-parser';

/**
 * PromptDesignerAgent - Pure prompt builder + result parser
 *
 * Responsibilities:
 * 1. Build prompts + JSON Schema for SDK structured output
 * 2. Parse and validate SDK structured output into PromptDesignerOutput
 * 3. Enforce token budgets on generated sections
 * 4. Generate fallback guidance when LLM is unavailable
 * 5. Format output as prompt sections
 *
 * The actual SDK call is handled by the caller (EnhancedPromptsService).
 */
@injectable()
export class PromptDesignerAgent {
  private config: PromptDesignerConfig = DEFAULT_PROMPT_DESIGNER_CONFIG;

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * Configure the agent
   *
   * @param config - Partial configuration to merge
   */
  configure(config: Partial<PromptDesignerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Build prompts and JSON Schema for the SDK structured output call.
   *
   * Quality data is expected to be pre-computed and passed via input.qualityAssessment
   * and input.prescriptiveGuidance (populated by the agentic analysis in Step 1).
   *
   * @param input - Project analysis data (including pre-computed quality assessment)
   * @param qualityContext - Optional pre-built quality context string
   * @returns Object with systemPrompt, userPrompt, outputSchema, and quality data
   */
  async buildPrompts(
    input: PromptDesignerInput,
    qualityContext?: string
  ): Promise<{
    systemPrompt: string;
    userPrompt: string;
    outputSchema: Record<string, unknown>;
    qualityAssessment?: QualityAssessment;
    prescriptiveGuidance?: PrescriptiveGuidance;
  }> {
    this.logger.info('PromptDesignerAgent: Building prompts', {
      projectType: input.projectType,
      framework: input.framework,
      isMonorepo: input.isMonorepo,
      hasQualityData: !!input.qualityAssessment,
    });

    // Quality data comes pre-computed from the agentic analysis (Step 1).
    // No separate quality assessment pipeline needed.
    const qualityAssessment: QualityAssessment | undefined =
      input.qualityAssessment;
    const prescriptiveGuidance: PrescriptiveGuidance | undefined =
      input.prescriptiveGuidance;

    // Build quality context for prompt if not provided and assessment available
    const effectiveQualityContext =
      qualityContext ??
      (qualityAssessment && prescriptiveGuidance
        ? buildQualityContextPrompt(qualityAssessment, prescriptiveGuidance)
        : undefined);

    const systemPrompt = PROMPT_DESIGNER_SYSTEM_PROMPT;
    const userPrompt = buildGenerationUserPrompt(
      input,
      effectiveQualityContext
    );

    // Build JSON Schema from the Zod schema for SDK outputFormat
    const outputSchema = this.buildJsonSchema();

    return {
      systemPrompt,
      userPrompt,
      outputSchema,
      qualityAssessment,
      prescriptiveGuidance,
    };
  }

  /**
   * Parse and validate structured output from SDK into PromptDesignerOutput.
   *
   * Takes the raw structured_output from an SDK result message and:
   * 1. Parses it via parseStructuredResponse
   * 2. Enforces token budgets on each section
   * 3. Validates output quality
   *
   * @param structuredOutput - Raw structured output from SDK
   * @param onProgress - Optional progress callback
   * @returns Parsed and validated PromptDesignerOutput, or null on failure
   */
  async parseAndValidateOutput(
    structuredOutput: unknown,
    onProgress?: (progress: PromptGenerationProgress) => void
  ): Promise<PromptDesignerOutput | null> {
    try {
      onProgress?.({
        status: 'generating',
        message: 'Parsing response...',
        progress: 70,
      });

      // Use a simple token estimator (4 chars per token)
      const countTokens = async (text: string) => Math.ceil(text.length / 4);

      const output = await parseStructuredResponse(
        structuredOutput as PromptDesignerResponse,
        countTokens
      );

      // Enforce token budgets
      const budgeted = this.enforceTokenBudgets(output);

      // Validate output quality
      const validation = validateOutput(budgeted);
      if (!validation.valid) {
        this.logger.warn('PromptDesignerAgent: Output validation issues', {
          issues: validation.issues,
        });
      }

      onProgress?.({
        status: 'complete',
        message: 'Guidance generated successfully',
        progress: 100,
      });

      return budgeted;
    } catch (error) {
      this.logger.error(
        'PromptDesignerAgent: Failed to parse structured output',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return null;
    }
  }

  /**
   * Format generated output as a prompt section
   *
   * @param output - Generated guidance
   * @returns Formatted string ready for appending to system prompt
   */
  formatAsPrompt(output: PromptDesignerOutput): string {
    return formatAsPromptSection(output);
  }

  /**
   * Enforce token budgets on each section
   */
  enforceTokenBudgets(output: PromptDesignerOutput): PromptDesignerOutput {
    const maxSection = this.config.maxSectionTokens;

    // Truncate sections that exceed budget
    if (output.tokenBreakdown.projectContext > maxSection) {
      output.projectContext = truncateToTokenBudget(
        output.projectContext,
        maxSection,
        output.tokenBreakdown.projectContext
      );
    }

    if (output.tokenBreakdown.frameworkGuidelines > maxSection) {
      output.frameworkGuidelines = truncateToTokenBudget(
        output.frameworkGuidelines,
        maxSection,
        output.tokenBreakdown.frameworkGuidelines
      );
    }

    if (output.tokenBreakdown.codingStandards > maxSection) {
      output.codingStandards = truncateToTokenBudget(
        output.codingStandards,
        maxSection,
        output.tokenBreakdown.codingStandards
      );
    }

    if (output.tokenBreakdown.architectureNotes > maxSection) {
      output.architectureNotes = truncateToTokenBudget(
        output.architectureNotes,
        maxSection,
        output.tokenBreakdown.architectureNotes
      );
    }

    // Recalculate total (approximate, since we used truncation)
    output.totalTokens = Math.min(
      output.totalTokens,
      this.config.maxTotalTokens
    );

    return output;
  }

  /**
   * Generate fallback guidance when LLM is unavailable
   *
   * @param input - Project analysis data
   * @param qualityAssessment - Optional quality assessment for quality guidance generation
   * @param fallbackReason - Reason for using fallback guidance
   * @returns Fallback guidance output with usedFallback flag set
   */
  generateFallbackGuidance(
    input: PromptDesignerInput,
    qualityAssessment?: QualityAssessment,
    fallbackReason?: string
  ): PromptDesignerOutput {
    const fallbackText = buildFallbackGuidance(input);

    // Estimate tokens (4 chars per token)
    const estimatedTokens = Math.ceil(fallbackText.length / 4);

    const output: PromptDesignerOutput = {
      projectContext: this.extractSection(fallbackText, 'Project Context'),
      frameworkGuidelines: this.extractSection(
        fallbackText,
        'Framework Guidelines'
      ),
      codingStandards: this.extractSection(fallbackText, 'Coding Standards'),
      architectureNotes: this.extractSection(
        fallbackText,
        'Architecture Notes'
      ),
      usedFallback: true,
      fallbackReason: fallbackReason ?? 'Fallback guidance generated',
      generatedAt: Date.now(),
      totalTokens: estimatedTokens,
      tokenBreakdown: {
        projectContext: Math.ceil(estimatedTokens / 4),
        frameworkGuidelines: Math.ceil(estimatedTokens / 4),
        codingStandards: Math.ceil(estimatedTokens / 4),
        architectureNotes: Math.ceil(estimatedTokens / 4),
      },
    };

    // Generate quality guidance from assessment if score indicates issues
    if (qualityAssessment && qualityAssessment.score < 70) {
      const topIssues = qualityAssessment.antiPatterns
        .slice(0, 3)
        .map((p) => `- ${p.message}`)
        .join('\n');

      output.qualityGuidance = `## Code Quality Considerations\n\nQuality score: ${qualityAssessment.score}/100.\n\nTop issues detected:\n${topIssues}`;
      output.qualityScore = qualityAssessment.score;
      output.qualityAssessment = qualityAssessment;

      // Update token breakdown for quality guidance
      const qualityGuidanceTokens = Math.ceil(
        output.qualityGuidance.length / 4
      );
      output.tokenBreakdown.qualityGuidance = qualityGuidanceTokens;
      output.totalTokens += qualityGuidanceTokens;
    } else if (qualityAssessment) {
      // Include quality data even if score is good
      output.qualityScore = qualityAssessment.score;
      output.qualityAssessment = qualityAssessment;
    }

    return output;
  }

  /**
   * Build JSON Schema from PromptDesignerResponseSchema for SDK outputFormat.
   *
   * Converts the Zod schema to a JSON Schema object that the SDK can use
   * to constrain the agent's output format.
   */
  private buildJsonSchema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        projectContext: {
          type: 'string',
          description:
            'Brief description of what this project is and its key technologies (under 400 tokens)',
        },
        frameworkGuidelines: {
          type: 'string',
          description:
            'Specific patterns and best practices for the detected frameworks (under 500 tokens)',
        },
        codingStandards: {
          type: 'string',
          description:
            'SOLID principles, naming conventions, error handling derived from the project (under 400 tokens)',
        },
        architectureNotes: {
          type: 'string',
          description:
            'Library boundaries, dependency rules, import patterns, key abstractions (under 400 tokens)',
        },
        qualityGuidance: {
          type: 'string',
          description:
            'Quality-specific guidance based on detected code issues (under 300 tokens)',
        },
      },
      required: [
        'projectContext',
        'frameworkGuidelines',
        'codingStandards',
        'architectureNotes',
      ],
    };
  }

  /**
   * Extract a section from fallback text
   */
  private extractSection(text: string, sectionName: string): string {
    const regex = new RegExp(
      `## ${sectionName}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`,
      'i'
    );
    const match = text.match(regex);
    return match?.[1]?.trim() || '';
  }
}
