/**
 * Prompt Designer Agent
 *
 * TASK_2025_137 Batch 2: Intelligent agent that analyzes workspaces and generates
 * project-specific guidance to append to PTAH_CORE_SYSTEM_PROMPT.
 *
 * This agent leverages:
 * - workspace-intelligence for project analysis
 * - llm-abstraction for structured LLM completions
 *
 * The generated guidance is cached to avoid regeneration overhead.
 */

import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type { z } from 'zod';
import {
  type PromptDesignerInput,
  type PromptDesignerOutput,
  type PromptDesignerConfig,
  type PromptGenerationProgress,
  PromptDesignerResponseSchema,
  DEFAULT_PROMPT_DESIGNER_CONFIG,
} from './prompt-designer.types';
import {
  PROMPT_DESIGNER_SYSTEM_PROMPT,
  buildGenerationUserPrompt,
  buildFallbackGuidance,
  FRAMEWORK_PROMPT_ADDITIONS,
} from './generation-prompts';
import {
  parseStructuredResponse,
  parseTextResponse,
  validateOutput,
  formatAsPromptSection,
  truncateToTokenBudget,
} from './response-parser';

/**
 * DI Token for LlmService - matches llm-abstraction library
 */
const LLM_SERVICE_TOKEN = 'LlmService';

/**
 * LLM Service interface for Prompt Designer
 *
 * This is a minimal interface matching llm-abstraction's LlmService.
 * The actual service is injected at runtime.
 */
interface IPromptDesignerLlmService {
  hasProvider(): boolean;
  getCompletion(
    systemPrompt: string,
    userPrompt: string
  ): Promise<LlmResult<string>>;
  getStructuredCompletion<T extends z.ZodTypeAny>(
    prompt: string,
    schema: T,
    config?: { temperature?: number; maxTokens?: number }
  ): Promise<LlmResult<z.infer<T>>>;
  countTokens(text: string): Promise<number>;
}

/**
 * Result type (matching llm-abstraction pattern)
 */
interface LlmResult<T> {
  isOk(): boolean;
  isErr(): boolean;
  value?: T;
  error?: { message: string; code: string; provider: string };
}

/**
 * PromptDesignerAgent - Generates project-specific guidance
 *
 * This agent orchestrates:
 * 1. Receiving project analysis from workspace-intelligence
 * 2. Building context-aware prompts
 * 3. Calling LLM for structured generation
 * 4. Parsing and validating responses
 * 5. Returning ready-to-use prompt sections
 */
@injectable()
export class PromptDesignerAgent {
  private config: PromptDesignerConfig = DEFAULT_PROMPT_DESIGNER_CONFIG;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(LLM_SERVICE_TOKEN)
    private readonly llmService: IPromptDesignerLlmService
  ) {}

  /**
   * Configure the agent
   *
   * @param config - Partial configuration to merge
   */
  configure(config: Partial<PromptDesignerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Generate project-specific guidance
   *
   * @param input - Project analysis data
   * @param onProgress - Optional callback for progress updates
   * @returns Generated guidance or null if generation fails
   */
  async generateGuidance(
    input: PromptDesignerInput,
    onProgress?: (progress: PromptGenerationProgress) => void
  ): Promise<PromptDesignerOutput | null> {
    this.logger.info('PromptDesignerAgent: Starting guidance generation', {
      projectType: input.projectType,
      framework: input.framework,
      isMonorepo: input.isMonorepo,
    });

    onProgress?.({
      status: 'analyzing',
      message: 'Analyzing project structure...',
      progress: 10,
    });

    // Check if LLM service is available
    if (!this.llmService.hasProvider()) {
      this.logger.warn(
        'PromptDesignerAgent: LLM service not available, using fallback'
      );
      return this.generateFallbackGuidance(input);
    }

    onProgress?.({
      status: 'generating',
      message: 'Generating project-specific guidance...',
      progress: 30,
    });

    try {
      // Build the enhanced system prompt
      const systemPrompt = this.buildEnhancedSystemPrompt(input.framework);

      // Build the user prompt with project details
      const userPrompt = buildGenerationUserPrompt(input);

      // Try structured completion first
      const output = await this.tryStructuredCompletion(
        systemPrompt,
        userPrompt,
        onProgress
      );

      if (output) {
        // Validate output quality
        const validation = validateOutput(output);
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

        return output;
      }

      // Fall back to text completion
      return await this.tryTextCompletion(systemPrompt, userPrompt, onProgress);
    } catch (error) {
      this.logger.error('PromptDesignerAgent: Generation failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      onProgress?.({
        status: 'error',
        message: 'Generation failed, using fallback',
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Return fallback guidance on error
      return this.generateFallbackGuidance(input);
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
   * Build enhanced system prompt with framework-specific additions
   */
  private buildEnhancedSystemPrompt(framework?: string): string {
    let prompt = PROMPT_DESIGNER_SYSTEM_PROMPT;

    if (framework) {
      const frameworkKey = framework.toLowerCase();
      const addition = FRAMEWORK_PROMPT_ADDITIONS[frameworkKey];
      if (addition) {
        prompt += `\n\n## Framework-Specific Notes\n${addition}`;
      }
    }

    return prompt;
  }

  /**
   * Try structured completion with Zod schema
   */
  private async tryStructuredCompletion(
    systemPrompt: string,
    userPrompt: string,
    onProgress?: (progress: PromptGenerationProgress) => void
  ): Promise<PromptDesignerOutput | null> {
    try {
      // Create the full prompt
      const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;

      const result = await this.llmService.getStructuredCompletion(
        fullPrompt,
        PromptDesignerResponseSchema,
        {
          temperature: this.config.temperature,
          maxTokens: this.config.maxTotalTokens * 2, // Allow headroom
        }
      );

      if (result.isErr() || !result.value) {
        this.logger.warn('PromptDesignerAgent: Structured completion failed', {
          error: result.error?.message ?? 'Unknown error',
        });
        return null;
      }

      onProgress?.({
        status: 'generating',
        message: 'Parsing response...',
        progress: 70,
      });

      // Parse the structured response
      const countTokens = async (text: string) =>
        this.llmService.countTokens(text);
      const output = await parseStructuredResponse(result.value, countTokens);

      // Truncate sections if needed
      return this.enforceTokenBudgets(output);
    } catch (error) {
      this.logger.warn('PromptDesignerAgent: Structured completion error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Try text completion (fallback for models without structured output)
   */
  private async tryTextCompletion(
    systemPrompt: string,
    userPrompt: string,
    onProgress?: (progress: PromptGenerationProgress) => void
  ): Promise<PromptDesignerOutput | null> {
    try {
      const result = await this.llmService.getCompletion(
        systemPrompt,
        userPrompt
      );

      if (result.isErr() || !result.value) {
        this.logger.warn('PromptDesignerAgent: Text completion failed', {
          error: result.error?.message ?? 'Unknown error',
        });
        return null;
      }

      onProgress?.({
        status: 'generating',
        message: 'Parsing text response...',
        progress: 70,
      });

      // Parse the text response
      const countTokens = async (text: string) =>
        this.llmService.countTokens(text);
      const output = await parseTextResponse(result.value, countTokens);

      if (!output) {
        this.logger.warn('PromptDesignerAgent: Could not parse text response');
        return null;
      }

      // Truncate sections if needed
      return this.enforceTokenBudgets(output);
    } catch (error) {
      this.logger.warn('PromptDesignerAgent: Text completion error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Enforce token budgets on each section
   */
  private enforceTokenBudgets(
    output: PromptDesignerOutput
  ): PromptDesignerOutput {
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
   */
  private generateFallbackGuidance(
    input: PromptDesignerInput
  ): PromptDesignerOutput {
    const fallbackText = buildFallbackGuidance(input);

    // Estimate tokens (4 chars per token)
    const estimatedTokens = Math.ceil(fallbackText.length / 4);

    return {
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
      generatedAt: Date.now(),
      totalTokens: estimatedTokens,
      tokenBreakdown: {
        projectContext: Math.ceil(estimatedTokens / 4),
        frameworkGuidelines: Math.ceil(estimatedTokens / 4),
        codingStandards: Math.ceil(estimatedTokens / 4),
        architectureNotes: Math.ceil(estimatedTokens / 4),
      },
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
