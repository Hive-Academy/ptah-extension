/**
 * VS Code Language Model Service
 *
 * Thin wrapper around VsCodeLmProvider that adds:
 * - Retry logic with exponential backoff (3 attempts, 5s → 10s → 20s)
 * - Batch processing with concurrency control (5 concurrent)
 * - OutputValidationService integration for content quality
 * - Agent-specific prompt building utilities
 *
 * Delegates all VS Code LM API communication to VsCodeLmProvider from llm-abstraction.
 *
 * @module @ptah-extension/agent-generation/services
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared';
import { VsCodeLmProvider } from '@ptah-extension/llm-abstraction';
import { IOutputValidationService } from '../interfaces/output-validation.interface';
import { AgentProjectContext } from '../types/core.types';
import { AGENT_GENERATION_TOKENS } from '../di/tokens';

/**
 * Section customization request structure for batch processing
 */
export interface SectionCustomizationRequest {
  /** Unique identifier for the section */
  id: string;
  /** Topic/section name (e.g., 'TECH_STACK', 'BEST_PRACTICES') */
  topic: string;
  /** Project context for validation and prompt building */
  projectContext: AgentProjectContext;
  /** Sample file contents for reference in prompt */
  fileSamples: string[];
}

/**
 * VS Code LM Service - Orchestration layer for agent customization
 *
 * This service wraps VsCodeLmProvider to add reliability and validation:
 * - Retries failed LM requests with exponential backoff
 * - Validates generated content using OutputValidationService
 * - Processes multiple sections concurrently with controlled concurrency
 * - Builds agent-specific prompts from project context
 *
 * @example
 * ```typescript
 * const service = container.resolve(VsCodeLmService);
 * await service.initialize();
 *
 * const result = await service.customizeSection(
 *   'TECH_STACK',
 *   projectContext,
 *   ['sample-file-content']
 * );
 * ```
 */
@injectable()
export class VsCodeLmService {
  private readonly MAX_RETRIES = 3;
  private readonly BACKOFF_BASE_MS = 5000; // 5s → 10s → 20s exponential
  private readonly provider: VsCodeLmProvider;

  constructor(
    @inject(AGENT_GENERATION_TOKENS.OUTPUT_VALIDATION_SERVICE)
    private readonly validation: IOutputValidationService,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger
  ) {
    // Initialize VsCodeLmProvider with default model family
    this.provider = new VsCodeLmProvider({ family: 'gpt-4o' });
    this.logger.debug('VsCodeLmService created with gpt-4o model family');
  }

  /**
   * Initialize the underlying VS Code LM provider.
   * Must be called before using customizeSection or batchCustomize.
   *
   * @returns Result indicating success or initialization error
   */
  async initialize(): Promise<Result<void, Error>> {
    this.logger.debug('Initializing VsCodeLmService');

    const initResult = await this.provider.initialize();

    if (initResult.isErr()) {
      this.logger.error(
        'Failed to initialize VsCodeLmProvider',
        initResult.error!
      );
      return Result.err(
        new Error(
          `VS Code LM initialization failed: ${initResult.error!.message}`
        )
      );
    }

    this.logger.info('VsCodeLmService initialized successfully');
    return Result.ok(undefined);
  }

  /**
   * Customize a single agent section with retry logic and validation.
   *
   * Implementation strategy:
   * 1. Build agent-specific prompt from project context
   * 2. Retry loop (max 3 attempts with exponential backoff):
   *    a. Call VsCodeLmProvider.getCompletion()
   *    b. Validate response with OutputValidationService
   *    c. Return on validation success
   *    d. Retry with backoff on failure
   * 3. Fallback to empty string if all retries exhausted
   *
   * @param sectionTopic - Topic/section name to customize (e.g., 'TECH_STACK')
   * @param projectContext - Project context for validation and prompt building
   * @param fileSamples - Sample file contents to reference in prompt
   * @returns Customized content or empty string for fallback to generic content
   */
  async customizeSection(
    sectionTopic: string,
    projectContext: AgentProjectContext,
    fileSamples: string[]
  ): Promise<Result<string, Error>> {
    const prompt = this.buildPrompt(sectionTopic, projectContext, fileSamples);

    // Retry loop with exponential backoff
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        this.logger.debug(
          `Attempt ${attempt}/${this.MAX_RETRIES} for section: ${sectionTopic}`
        );

        // Delegate to VsCodeLmProvider for LM communication
        const completionResult = await this.provider.getCompletion('', prompt);

        if (completionResult.isErr()) {
          throw completionResult.error!;
        }

        const response = completionResult.value!;

        // Validate response with OutputValidationService
        const validationResult = await this.validation.validate(
          response,
          projectContext
        );

        if (validationResult.isOk() && validationResult.value!.isValid) {
          this.logger.info(`Section customized successfully: ${sectionTopic}`, {
            attempt,
            score: validationResult.value!.score,
          });
          return Result.ok(response);
        } else {
          this.logger.warn(`Validation failed (attempt ${attempt})`, {
            score: validationResult.value?.score,
            issueCount: validationResult.value?.issues.length,
          });

          if (attempt < this.MAX_RETRIES) {
            // Retry with exponential backoff
            const backoffMs = this.BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
            this.logger.debug(`Retrying after ${backoffMs}ms backoff...`);
            await this.delay(backoffMs);
            continue;
          } else {
            // Max retries exhausted - use fallback
            this.logger.error(
              `Max retries exhausted for section: ${sectionTopic}`
            );
            return Result.ok(''); // Empty string signals fallback to generic content
          }
        }
      } catch (error) {
        this.logger.error(
          `LM request failed (attempt ${attempt})`,
          error as Error
        );

        if (attempt < this.MAX_RETRIES) {
          const backoffMs = this.BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
          this.logger.debug(`Retrying after ${backoffMs}ms backoff...`);
          await this.delay(backoffMs);
        } else {
          return Result.err(error as Error);
        }
      }
    }

    // Fallback if all retries fail (should not reach here, but safety net)
    return Result.ok('');
  }

  /**
   * Build agent-specific prompt for section customization.
   *
   * Prompt structure:
   * - Role: Expert software development coach
   * - Context: Project type, frameworks, languages
   * - File Samples: Up to 3 sample files for reference
   * - Task: Generate best practice guidance for specific section
   * - Requirements: Concrete examples, framework-specific, concise
   *
   * @param sectionTopic - Section name to customize
   * @param projectContext - Project context for personalization
   * @param fileSamples - Sample file contents (limited to first 3)
   * @returns Formatted prompt string
   */
  private buildPrompt(
    sectionTopic: string,
    projectContext: AgentProjectContext,
    fileSamples: string[]
  ): string {
    const frameworkName =
      projectContext.frameworks[0]?.toString() || 'this framework';

    return `You are an expert software development coach specializing in ${frameworkName}.

CONTEXT:
- Project Type: ${projectContext.projectType}
- Frameworks: ${projectContext.frameworks.join(', ')}
- Languages: ${projectContext.techStack.languages.join(', ')}

FILE SAMPLES:
${fileSamples.slice(0, 3).join('\n\n')}

TASK:
Generate best practice guidance for the "${sectionTopic}" section.

REQUIREMENTS:
1. Use concrete examples from the file samples above
2. Reference actual patterns detected in this codebase
3. Be specific to ${frameworkName}
4. Keep under 500 words
5. Use bullet points for readability

OUTPUT FORMAT:
Return ONLY markdown content. No section headers. No code fences around the entire output.`;
  }

  /**
   * Batch customize multiple sections with concurrency control.
   *
   * Processes sections in chunks to respect concurrency limit,
   * ensuring no more than N concurrent LM requests at once.
   *
   * @param sections - Array of section customization requests
   * @param concurrency - Maximum concurrent requests (default: 5)
   * @returns Map of section IDs to customization results
   */
  async batchCustomize(
    sections: SectionCustomizationRequest[],
    concurrency = 5
  ): Promise<Map<string, Result<string, Error>>> {
    this.logger.info(
      `Batch customizing ${sections.length} sections with concurrency ${concurrency}`
    );

    const results = new Map<string, Result<string, Error>>();

    // Process in chunks to respect concurrency limit
    const chunks = this.chunk(sections, concurrency);

    for (const chunk of chunks) {
      this.logger.debug(`Processing chunk of ${chunk.length} sections...`);

      // Process chunk concurrently
      const promises = chunk.map(async (section) => {
        const result = await this.customizeSection(
          section.topic,
          section.projectContext,
          section.fileSamples
        );
        return { id: section.id, result };
      });

      const chunkResults = await Promise.all(promises);

      // Collect results
      for (const { id, result } of chunkResults) {
        results.set(id, result);
      }
    }

    this.logger.info(`Batch customization complete`, {
      total: sections.length,
      successful: Array.from(results.values()).filter((r) => r.isOk()).length,
      failed: Array.from(results.values()).filter((r) => r.isErr()).length,
    });

    return results;
  }

  /**
   * Delay utility for exponential backoff.
   *
   * @param ms - Milliseconds to delay
   * @returns Promise that resolves after delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Chunk array into smaller arrays of specified size.
   *
   * @param array - Array to chunk
   * @param size - Chunk size
   * @returns Array of chunks
   */
  private chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
