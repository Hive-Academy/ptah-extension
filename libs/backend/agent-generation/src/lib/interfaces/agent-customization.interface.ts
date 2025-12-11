/**
 * Agent Customization Service Interface
 *
 * Defines the contract for LLM-powered agent template customization.
 * Includes types for section customization requests and batch processing.
 *
 * @module @ptah-extension/agent-generation/interfaces
 */

import { Result } from '@ptah-extension/shared';
import { AgentProjectContext } from '../types/core.types';

/**
 * Section customization request for batch processing
 */
export interface CustomizationRequest {
  /** Unique identifier for tracking this request */
  sectionId: string;

  /** Topic/section name (e.g., 'Best Practices', 'Tech Stack', 'Architecture Patterns') */
  sectionTopic: string;

  /** Template identifier (e.g., 'backend-developer', 'frontend-developer') */
  templateId: string;

  /** Project context for customization and validation */
  projectContext: AgentProjectContext;
}

/**
 * Agent Customization Service Interface
 *
 * Provides LLM-powered content customization for agent generation.
 * Uses ptah.ai.invokeAgent() for cost-effective model invocation.
 *
 * **Reliability Guarantees**:
 * - Retry logic with exponential backoff
 * - 3-tier validation (schema, safety, factual accuracy)
 * - Graceful degradation to empty string (signals generic content fallback)
 */
export interface IAgentCustomizationService {
  /**
   * Customize a single template section using LLM.
   *
   * @param sectionTopic - Section name to customize (e.g., 'Best Practices')
   * @param templateId - Template identifier (e.g., 'backend-developer')
   * @param projectContext - Project context for validation and task building
   * @returns Customized content string, or empty string if all retries fail
   */
  customizeSection(
    sectionTopic: string,
    templateId: string,
    projectContext: AgentProjectContext
  ): Promise<Result<string, Error>>;

  /**
   * Batch customize multiple sections with concurrency control.
   *
   * @param sections - Array of section customization requests
   * @param concurrency - Maximum concurrent LLM requests (default: 5)
   * @returns Map of section IDs to customization results
   */
  batchCustomize(
    sections: CustomizationRequest[],
    concurrency?: number
  ): Promise<Map<string, Result<string, Error>>>;
}
