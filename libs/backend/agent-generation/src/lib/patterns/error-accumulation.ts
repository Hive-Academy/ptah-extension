import { Result } from '@ptah-extension/shared';

/**
 * Error details for failed generation items.
 *
 * Captures both what failed and where in the generation process the failure occurred.
 *
 * @template TPhase - String literal type for phase names (e.g., 'template-processing' | 'content-generation')
 */
export interface GenerationErrorDetails<TPhase extends string = string> {
  /** The item that failed (e.g., agent name, template name, file path) */
  item: string;
  /** The error that occurred */
  error: Error;
  /** The phase where the error occurred */
  phase: TPhase;
}

/**
 * Result of a batch generation with partial success support.
 *
 * Allows generation processes to continue even when individual items fail,
 * collecting both successes and failures for comprehensive reporting.
 *
 * @template T - Type of successfully generated items
 * @template TPhase - String literal type for phase names
 */
export interface PartialSuccessResult<T, TPhase extends string = string> {
  /** Successfully generated items */
  successful: T[];
  /** Failed items with error details */
  errors: GenerationErrorDetails<TPhase>[];
  /** Whether all items succeeded */
  isComplete: boolean;
}

/**
 * Execute a batch of generation tasks with partial success support.
 * Failed items are collected but don't stop the entire batch.
 *
 * **Use Case**: When generating multiple agents/templates/files, and you want
 * to maximize successful outputs rather than failing fast on the first error.
 *
 * **Pattern Origin**: Extracted from roocode-generator's MemoryBankOrchestrator
 * which generates multiple memory bank files and collects errors per file.
 *
 * @example
 * ```typescript
 * const result = await generateWithPartialSuccess(
 *   ['agent1', 'agent2', 'agent3'],
 *   async (agentName) => {
 *     const content = await generateAgent(agentName);
 *     return content.isOk()
 *       ? Result.ok({ name: agentName, content: content.value })
 *       : Result.err(content.error);
 *   },
 *   'content-generation'
 * );
 *
 * console.log(`Generated ${result.successful.length}, failed ${result.errors.length}`);
 * if (!result.isComplete) {
 *   result.errors.forEach(err => {
 *     console.error(`${err.item} failed at ${err.phase}: ${err.error.message}`);
 *   });
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Real-world usage: Generate multiple memory bank files
 * const fileTypes = ['architecture', 'codebase', 'development'];
 * const result = await generateWithPartialSuccess(
 *   fileTypes,
 *   async (fileType) => {
 *     const template = await loadTemplate(fileType);
 *     if (template.isErr()) return template;
 *
 *     const content = await generateContent(template.value);
 *     return content;
 *   },
 *   'file-generation'
 * );
 *
 * // Even if 'codebase' fails, we still get 'architecture' and 'development'
 * await writeResults(result.successful);
 *
 * // Log partial failure, but don't block workflow
 * if (result.errors.length > 0) {
 *   logger.warn(`Partial failure: ${result.errors.length} files failed`);
 * }
 * ```
 *
 * @param items - Array of item identifiers to process (e.g., agent names, file paths)
 * @param generateFn - Async function that generates content for one item
 * @param phase - Current phase name for error tracking
 * @returns Promise resolving to partial success result with both successes and errors
 */
export async function generateWithPartialSuccess<
  T,
  TPhase extends string = string
>(
  items: string[],
  generateFn: (item: string) => Promise<Result<T, Error>>,
  phase: TPhase
): Promise<PartialSuccessResult<T, TPhase>> {
  const errors: GenerationErrorDetails<TPhase>[] = [];
  const successful: T[] = [];

  for (const item of items) {
    const result = await generateFn(item);
    if (result.isErr()) {
      errors.push({ item, error: result.error!, phase });
      continue; // Don't fail entire batch
    }
    successful.push(result.value!);
  }

  return {
    successful,
    errors,
    isComplete: errors.length === 0,
  };
}
