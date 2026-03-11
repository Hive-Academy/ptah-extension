/**
 * VS Code Language Model Service Interface
 *
 * Defines the contract for VS Code LM integration services.
 * Includes types for section customization and batch processing.
 *
 * @module @ptah-extension/agent-generation/interfaces
 */

import { Result } from '@ptah-extension/shared';
import { AgentProjectContext } from '../types/core.types';

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
 * VS Code LM Service Interface
 *
 * Provides LLM-powered content customization for agent generation.
 * Wraps VsCodeLmProvider to add reliability features:
 * - Retry logic with exponential backoff
 * - Batch processing with concurrency control
 * - Output validation integration
 */
export interface IVsCodeLmService {
  /**
   * Initialize the underlying VS Code LM provider.
   * Must be called before using customizeSection or batchCustomize.
   *
   * @returns Result indicating success or initialization error
   */
  initialize(): Promise<Result<void, Error>>;

  /**
   * Customize a single agent section with retry logic and validation.
   *
   * @param sectionTopic - Topic/section name to customize (e.g., 'TECH_STACK')
   * @param projectContext - Project context for validation and prompt building
   * @param fileSamples - Sample file contents to reference in prompt
   * @returns Customized content or empty string for fallback to generic content
   */
  customizeSection(
    sectionTopic: string,
    projectContext: AgentProjectContext,
    fileSamples: string[]
  ): Promise<Result<string, Error>>;

  /**
   * Batch customize multiple sections with concurrency control.
   *
   * @param sections - Array of section customization requests
   * @param concurrency - Maximum concurrent requests (default: 5)
   * @returns Map of section IDs to customization results
   */
  batchCustomize(
    sections: SectionCustomizationRequest[],
    concurrency?: number
  ): Promise<Map<string, Result<string, Error>>>;
}
