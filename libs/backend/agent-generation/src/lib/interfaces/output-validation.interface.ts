/**
 * Output Validation Interface
 *
 * Service interface for validating LLM-generated content for quality and safety.
 * Implements multi-layered validation to ensure generated agents are safe and useful.
 *
 * @module @ptah-extension/agent-generation/interfaces
 */

import { Result } from '@ptah-extension/shared';
import { ValidationResult, AgentProjectContext } from '../types/core.types';

/**
 * Service for validating LLM-generated content.
 *
 * Responsibilities:
 * - Schema validation (template structure, required sections)
 * - Safety validation (no malicious code, no sensitive data exposure)
 * - Factual accuracy checks (no hallucinated APIs, no invalid references)
 * - Coherence validation (content matches project context)
 * - Quality scoring (0-100 based on all validation factors)
 *
 * @example
 * ```typescript
 * const result = await validator.validate(generatedContent, projectContext);
 * if (result.isOk()) {
 *   const validation = result.value;
 *   if (validation.isValid && validation.score >= 70) {
 *     console.log('Content passed validation');
 *   } else {
 *     console.warn('Content has issues:', validation.issues);
 *   }
 * }
 * ```
 */
export interface IOutputValidationService {
  /**
   * Validate generated content for quality and safety.
   *
   * Performs comprehensive validation across multiple dimensions:
   *
   * 1. **Schema Validation**: Ensures template structure is intact
   *    - Required sections present
   *    - Markers properly formatted
   *    - YAML frontmatter valid
   *
   * 2. **Safety Validation**: Checks for security issues
   *    - No script injection
   *    - No sensitive data exposure (API keys, tokens, passwords)
   *    - No malicious URLs or external resources
   *
   * 3. **Factual Accuracy**: Validates content correctness
   *    - APIs and libraries exist in project
   *    - File paths are valid
   *    - Framework features are accurate
   *
   * 4. **Coherence Validation**: Ensures content matches context
   *    - References correct project type
   *    - Uses appropriate frameworks
   *    - Aligns with project conventions
   *
   * @param content - Generated content to validate
   * @param context - Extended project context for factual validation
   * @returns Result containing validation result with issues and score, or Error
   *
   * @example
   * ```typescript
   * const result = await service.validate(generatedContent, projectContext);
   * if (result.isErr()) {
   *   console.error('Validation failed:', result.error);
   *   return;
   * }
   *
   * const validation = result.value;
   * console.log(`Validation score: ${validation.score}/100`);
   *
   * if (!validation.isValid) {
   *   console.error('Validation failed with issues:');
   *   validation.issues.forEach(issue => {
   *     console.error(`[${issue.severity}] ${issue.message}`);
   *     if (issue.suggestion) {
   *       console.log(`  Suggestion: ${issue.suggestion}`);
   *     }
   *   });
   * }
   * ```
   */
  validate(
    content: string,
    context: AgentProjectContext
  ): Promise<Result<ValidationResult, Error>>;

  /**
   * Check for hallucinations in generated content.
   *
   * Specifically validates factual accuracy by checking for:
   * - Non-existent APIs or methods
   * - Invalid import statements
   * - References to non-existent files or directories
   * - Incorrect framework features or patterns
   * - Invalid configuration options
   *
   * Returns array of hallucination descriptions for manual review.
   *
   * @param content - Generated content to check for hallucinations
   * @param context - Extended project context for factual validation
   * @returns Result containing array of hallucination descriptions, or Error
   *
   * @example
   * ```typescript
   * const result = await service.checkHallucinations(content, projectContext);
   * if (result.isOk()) {
   *   const hallucinations = result.value;
   *   if (hallucinations.length > 0) {
   *     console.warn('Detected hallucinations:');
   *     hallucinations.forEach(h => console.warn(`- ${h}`));
   *   } else {
   *     console.log('No hallucinations detected');
   *   }
   * }
   * ```
   */
  checkHallucinations(
    content: string,
    context: AgentProjectContext
  ): Promise<Result<string[], Error>>;
}
