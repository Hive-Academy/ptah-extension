/**
 * Agent Customization Service
 *
 * Wraps ptah.ai.invokeAgent() for LLM-powered agent template customization.
 * Provides reliability through retry logic, batch processing, and quality validation.
 *
 * Key responsibilities:
 * - Build context-aware customization tasks for LLM
 * - Delegate to ptah.ai.invokeAgent() for actual LLM invocation
 * - Validate LLM output using OutputValidationService (3-tier validation)
 * - Batch process multiple sections with concurrency control (5 concurrent max)
 * - Provide fallback to empty string on validation failures (signals generic content usage)
 * - Retry failed requests with exponential backoff (2 retries: 3s → 6s)
 *
 * @module @ptah-extension/agent-generation/services
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared';
import { PtahAPIBuilder } from '@ptah-extension/vscode-lm-tools';
import { IOutputValidationService } from '../interfaces/output-validation.interface';
import { ITemplateStorageService } from '../interfaces/template-storage.interface';
import {
  IAgentCustomizationService,
  CustomizationRequest,
} from '../interfaces/agent-customization.interface';
import { AgentProjectContext } from '../types/core.types';
import { AGENT_GENERATION_TOKENS } from '../di/tokens';

/**
 * Custom error for LLM validation fallback scenarios.
 * Indicates that all retry attempts failed validation, caller should use generic content.
 */
export class AgentCustomizationFallbackError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly lastValidationScore?: number
  ) {
    super(message);
    this.name = 'AgentCustomizationFallbackError';
  }
}

/**
 * Agent Customization Service
 *
 * Facade service for LLM-powered template section customization.
 * Uses ptah.ai.invokeAgent() to invoke cost-effective models (gpt-4o-mini, haiku)
 * for generating project-specific content in agent templates.
 *
 * **Design Pattern**: Facade with Retry + Validation
 * - Wraps complex ptah.ai API with simple interface
 * - Adds reliability through retry mechanism
 * - Ensures quality through validation pipeline
 *
 * **Reliability Guarantees**:
 * - 2 retry attempts with exponential backoff (3s → 6s)
 * - 3-tier validation (schema, safety, factual accuracy)
 * - Graceful degradation to empty string (signals generic content fallback)
 *
 * @example
 * ```typescript
 * const service = container.resolve(AgentCustomizationService);
 *
 * // Single section customization
 * const result = await service.customizeSection(
 *   'Best Practices',
 *   'backend-developer',
 *   projectContext
 * );
 *
 * if (result.isOk()) {
 *   const content = result.value; // Customized content or empty string (fallback)
 * }
 *
 * // Batch customization (5 concurrent)
 * const sections = [
 *   { sectionId: 'bp', sectionTopic: 'Best Practices', templateId: 'backend-developer', projectContext },
 *   { sectionId: 'ts', sectionTopic: 'Tech Stack', templateId: 'backend-developer', projectContext }
 * ];
 * const results = await service.batchCustomize(sections);
 * ```
 */
@injectable()
export class AgentCustomizationService implements IAgentCustomizationService {
  private readonly MAX_RETRIES = 2; // 2 retries = 3 total attempts
  private readonly BACKOFF_BASE_MS = 3000; // 3s → 6s exponential backoff
  private readonly DEFAULT_MODEL = 'gpt-4o-mini'; // 150x cheaper than GPT-4

  constructor(
    @inject(TOKENS.PTAH_API_BUILDER)
    private readonly ptahApiBuilder: PtahAPIBuilder,
    @inject(AGENT_GENERATION_TOKENS.OUTPUT_VALIDATION_SERVICE)
    private readonly validator: IOutputValidationService,
    @inject(AGENT_GENERATION_TOKENS.TEMPLATE_STORAGE_SERVICE)
    private readonly templateStorage: ITemplateStorageService,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger
  ) {
    this.logger.debug('AgentCustomizationService initialized');
  }

  /**
   * Customize a single template section using LLM.
   *
   * **Execution Flow**:
   * 1. Build customization task from section topic + project context
   * 2. Get template file path from template storage
   * 3. Invoke ptah.ai.invokeAgent() with template + task
   * 4. Validate LLM output (3-tier: schema, safety, factual)
   * 5. If validation fails: retry with simplified task
   * 6. If retry exhausted: return empty string (fallback to generic content)
   *
   * **Error Handling**:
   * - Validation failure → Retry with simplified task (up to 2 retries)
   * - Network/API error → Retry with exponential backoff
   * - All retries exhausted → Return empty string (NOT error)
   *
   * @param sectionTopic - Section name to customize (e.g., 'Best Practices')
   * @param templateId - Template identifier (e.g., 'backend-developer')
   * @param projectContext - Project context for validation and task building
   * @returns Customized content string, or empty string if all retries fail
   *
   * @example
   * ```typescript
   * const result = await service.customizeSection(
   *   'Best Practices',
   *   'backend-developer',
   *   projectContext
   * );
   *
   * if (result.isOk()) {
   *   if (result.value === '') {
   *     console.log('Fallback to generic content - customization failed validation');
   *   } else {
   *     console.log('Customization successful:', result.value);
   *   }
   * }
   * ```
   */
  async customizeSection(
    sectionTopic: string,
    templateId: string,
    projectContext: AgentProjectContext
  ): Promise<Result<string, Error>> {
    this.logger.info('Customizing template section', {
      sectionTopic,
      templateId,
      projectType: projectContext.projectType,
    });

    // Get template path from storage service
    const templateResult = await this.templateStorage.loadTemplate(templateId);
    if (templateResult.isErr()) {
      this.logger.error(
        `Failed to load template: ${templateId}`,
        templateResult.error!
      );
      return Result.err(
        new Error(
          `Template not found: ${templateId} - ${templateResult.error!.message}`
        )
      );
    }

    // Build ptah.ai API
    let ptahApi;
    try {
      ptahApi = this.ptahApiBuilder.build();
    } catch (error) {
      this.logger.error('Failed to build Ptah API', error as Error);
      return Result.err(
        new Error(`Ptah API initialization failed: ${(error as Error).message}`)
      );
    }

    // Retry loop with exponential backoff
    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        this.logger.debug(
          `Customization attempt ${attempt + 1}/${this.MAX_RETRIES + 1}`,
          { sectionTopic, templateId }
        );

        // Build customization task (simplified on retries)
        const task = this.buildCustomizationTask(
          sectionTopic,
          projectContext,
          attempt > 0 // Simplify task on retry
        );

        // Call ptah.ai.invokeAgent() - delegates to VS Code LM API
        // Uses template file as system prompt + task as user message
        const templatePath = this.getTemplatePath(templateId);
        const response = await ptahApi.ai.invokeAgent(
          templatePath,
          task,
          this.DEFAULT_MODEL
        );

        this.logger.debug('LLM response received', {
          responseLength: response.length,
          sectionTopic,
        });

        // Validate LLM output (3-tier: schema, safety, factual)
        // CRITICAL: Distinguish infrastructure errors from content validation failures
        let validationResult;
        try {
          validationResult = await this.validator.validate(
            response,
            projectContext
          );
        } catch (error) {
          // Unexpected error in validation service (infrastructure failure)
          this.logger.error(
            'Validation service threw unexpected error',
            error as Error
          );
          return Result.err(
            new Error(`Validation service error: ${(error as Error).message}`)
          );
        }

        // Check if validation service returned an error (infrastructure failure)
        if (validationResult.isErr()) {
          this.logger.error(
            'Validation service unavailable',
            validationResult.error!
          );
          return Result.err(
            new Error(
              `Validation service unavailable: ${
                validationResult.error!.message
              }`
            )
          );
        }

        // Validation service succeeded, check content quality
        const validation = validationResult.value!;

        if (validation.isValid && validation.score >= 70) {
          this.logger.info('Section customization successful', {
            sectionTopic,
            attempt: attempt + 1,
            score: validation.score,
          });
          return Result.ok(response);
        } else {
          // Content validation failed (not infrastructure failure) - retry is appropriate
          this.logger.warn('Content validation failed', {
            sectionTopic,
            attempt: attempt + 1,
            score: validation.score,
            issueCount: validation.issues.length,
            issues: validation.issues.map((i) => i.message),
          });

          // Retry if attempts remaining
          if (attempt < this.MAX_RETRIES) {
            const backoffMs = this.calculateBackoff(attempt);
            this.logger.debug(`Retrying after ${backoffMs}ms backoff...`);
            await this.delay(backoffMs);
            continue;
          } else {
            // Max retries exhausted - return fallback error
            this.logger.error('Max retries exhausted - validation failed', {
              sectionTopic,
              finalScore: validation.score,
            });
            return Result.err(
              new AgentCustomizationFallbackError(
                `All ${
                  this.MAX_RETRIES + 1
                } validation attempts failed. Caller should use generic content.`,
                this.MAX_RETRIES + 1,
                validation.score
              )
            );
          }
        }
      } catch (error) {
        this.logger.error(
          `LLM invocation error (attempt ${attempt + 1})`,
          error as Error
        );

        if (attempt < this.MAX_RETRIES) {
          const backoffMs = this.calculateBackoff(attempt);
          this.logger.debug(`Retrying after ${backoffMs}ms backoff...`);
          await this.delay(backoffMs);
          continue;
        } else {
          // Max retries exhausted - return error (not fallback)
          // API errors are different from validation failures
          return Result.err(
            new Error(
              `LLM invocation failed after ${this.MAX_RETRIES + 1} attempts: ${
                (error as Error).message
              }`
            )
          );
        }
      }
    }

    // Should not reach here, but safety net
    this.logger.error(
      'Unexpected: reached end of retry loop without returning',
      { sectionTopic }
    );
    return Result.err(
      new AgentCustomizationFallbackError(
        `Unexpected retry loop exit. Caller should use generic content.`,
        this.MAX_RETRIES + 1
      )
    );
  }

  /**
   * Batch customize multiple sections with concurrency control.
   *
   * Processes sections in chunks to respect concurrency limit (default: 5).
   * Each section is customized independently with full retry + validation.
   *
   * **Concurrency Strategy**:
   * - Process sections in chunks of N (default: 5)
   * - Each chunk processed in parallel with Promise.all()
   * - Chunks processed sequentially to respect concurrency limit
   *
   * **Failure Handling**:
   * - Individual section failures do NOT fail the entire batch
   * - Failed sections return Result.err in the results map
   * - Successful sections return Result.ok with content or empty string
   *
   * @param sections - Array of section customization requests
   * @param concurrency - Maximum concurrent LLM requests (default: 5)
   * @returns Map of section IDs to customization results
   *
   * @example
   * ```typescript
   * const sections = [
   *   { sectionId: 'bp', sectionTopic: 'Best Practices', templateId: 'backend-developer', projectContext },
   *   { sectionId: 'ts', sectionTopic: 'Tech Stack', templateId: 'backend-developer', projectContext },
   *   { sectionId: 'arch', sectionTopic: 'Architecture', templateId: 'backend-developer', projectContext }
   * ];
   *
   * const results = await service.batchCustomize(sections, 5);
   *
   * for (const [sectionId, result] of results) {
   *   if (result.isOk()) {
   *     console.log(`Section ${sectionId}: ${result.value || 'FALLBACK'}`);
   *   } else {
   *     console.error(`Section ${sectionId} failed:`, result.error);
   *   }
   * }
   * ```
   */
  async batchCustomize(
    sections: CustomizationRequest[],
    concurrency = 5
  ): Promise<Map<string, Result<string, Error>>> {
    this.logger.info(
      `Batch customizing ${sections.length} sections with concurrency ${concurrency}`
    );

    const results = new Map<string, Result<string, Error>>();

    // Process sections in chunks to respect concurrency limit
    const chunks = this.chunk(sections, concurrency);

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      this.logger.debug(
        `Processing chunk ${chunkIndex + 1}/${chunks.length} (${
          chunk.length
        } sections)...`
      );

      // Process chunk concurrently
      const promises = chunk.map(async (section) => {
        const result = await this.customizeSection(
          section.sectionTopic,
          section.templateId,
          section.projectContext
        );
        return { sectionId: section.sectionId, result };
      });

      const chunkResults = await Promise.all(promises);

      // Collect results
      for (const { sectionId, result } of chunkResults) {
        results.set(sectionId, result);
      }

      this.logger.debug(`Chunk ${chunkIndex + 1} complete`, {
        successful: chunkResults.filter((r) => r.result.isOk()).length,
        failed: chunkResults.filter((r) => r.result.isErr()).length,
      });
    }

    const successCount = Array.from(results.values()).filter((r) =>
      r.isOk()
    ).length;
    const failureCount = Array.from(results.values()).filter((r) =>
      r.isErr()
    ).length;
    const fallbackCount = Array.from(results.values()).filter(
      (r) => r.isOk() && r.value === ''
    ).length;

    this.logger.info('Batch customization complete', {
      total: sections.length,
      successful: successCount - fallbackCount,
      fallbacks: fallbackCount,
      failed: failureCount,
    });

    return results;
  }

  /**
   * Build customization task for LLM.
   *
   * Creates a prompt that instructs the LLM to generate project-specific
   * content for a template section based on project context.
   *
   * **Task Structure**:
   * - Context: Project type, tech stack, frameworks
   * - Goal: Customize the section for this specific project
   * - Requirements: 5-10 bullet points, actionable guidance, no generic advice
   * - Format: Markdown without code fences
   *
   * **Simplification on Retry**:
   * When `isRetry=true`, the task is simplified to increase success rate:
   * - Shorter output requirement (3-5 bullets instead of 5-10)
   * - More explicit formatting instructions
   * - Clearer expectations
   *
   * @param sectionTopic - Section name to customize
   * @param projectContext - Project context for personalization
   * @param isRetry - Whether this is a retry attempt (simplifies task)
   * @returns Formatted task string for LLM
   *
   * @private
   */
  private buildCustomizationTask(
    sectionTopic: string,
    projectContext: AgentProjectContext,
    isRetry: boolean
  ): string {
    const frameworks = projectContext.frameworks.join(', ') || 'this project';
    const languages = projectContext.techStack.languages.join(', ');
    const buildTools = projectContext.techStack.buildTools.join(', ');

    if (isRetry) {
      // Simplified task for retry attempts
      return `
Customize the "${sectionTopic}" section for this project:

Project Type: ${projectContext.projectType}
Languages: ${languages}
Frameworks: ${frameworks}
Build Tools: ${buildTools}

Provide 3-5 SHORT bullet points specific to this tech stack.
Focus on actionable guidance. NO generic advice.

Return ONLY markdown bullet points. NO code fences. NO section headers.
      `.trim();
    }

    // Full task for initial attempt
    return `
Customize the "${sectionTopic}" section for this project:

Project Type: ${projectContext.projectType}
Tech Stack:
  - Languages: ${languages}
  - Frameworks: ${frameworks}
  - Build Tools: ${buildTools}

Code Conventions:
  - Indentation: ${projectContext.codeConventions.indentation} (${
      projectContext.codeConventions.indentSize
    } spaces)
  - Quotes: ${projectContext.codeConventions.quoteStyle}
  - Semicolons: ${projectContext.codeConventions.semicolons ? 'yes' : 'no'}

Provide 5-10 bullet points specific to this project's tech stack and patterns.
Focus on actionable guidance, not generic advice.
Reference actual frameworks and tools used in this project.

Return ONLY markdown content. NO section headers. NO code fences around the entire output.
    `.trim();
  }

  /**
   * Get template file path for ptah.ai.invokeAgent().
   *
   * Converts template ID to file path in extension's template directory.
   * Path format: `.claude/agents/{templateId}.md`
   *
   * @param templateId - Template identifier
   * @returns Relative file path to template
   *
   * @private
   */
  private getTemplatePath(templateId: string): string {
    // Template paths follow Claude convention: .claude/agents/{id}.md
    return `.claude/agents/${templateId}.md`;
  }

  /**
   * Calculate exponential backoff delay.
   *
   * Uses formula: BASE_MS * 2^attempt
   * - Attempt 0: 3000ms (3s)
   * - Attempt 1: 6000ms (6s)
   *
   * @param attempt - Retry attempt number (0-indexed)
   * @returns Backoff delay in milliseconds
   *
   * @private
   */
  private calculateBackoff(attempt: number): number {
    return this.BACKOFF_BASE_MS * Math.pow(2, attempt);
  }

  /**
   * Delay utility for exponential backoff.
   *
   * @param ms - Milliseconds to delay
   * @returns Promise that resolves after delay
   *
   * @private
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Chunk array into smaller arrays of specified size.
   *
   * Used for batch processing with concurrency control.
   *
   * @param array - Array to chunk
   * @param size - Chunk size
   * @returns Array of chunks
   *
   * @private
   */
  private chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
