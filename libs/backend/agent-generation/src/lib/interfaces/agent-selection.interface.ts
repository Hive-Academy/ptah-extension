/**
 * Agent Selection Interface
 *
 * Service interface for selecting appropriate agents based on project analysis.
 * Implements relevance scoring algorithm to match templates to project characteristics.
 *
 * @module @ptah-extension/agent-generation/interfaces
 */

import { Result } from '@ptah-extension/shared';
import { AgentTemplate, AgentProjectContext } from '../types/core.types';

/**
 * Selection criteria result for a template.
 *
 * Contains the template, its calculated relevance score, and the specific
 * criteria that matched the project context.
 */
export interface SelectionResult {
  /**
   * The agent template that was scored.
   */
  template: AgentTemplate;

  /**
   * Relevance score (0-100) indicating how well the template matches the project.
   *
   * Score ranges:
   * - 90-100: Highly relevant, strongly recommended
   * - 70-89: Relevant, recommended for most projects
   * - 50-69: Moderately relevant, optional
   * - <50: Low relevance, not recommended
   */
  relevanceScore: number;

  /**
   * List of criteria that matched, explaining why this template was selected.
   *
   * Examples:
   * - 'Project type matches: Node'
   * - 'Framework matches: Express'
   * - 'Monorepo type matches: Nx'
   * - 'Always include flag set'
   */
  matchedCriteria: string[];
}

/**
 * Service for selecting appropriate agents based on project analysis.
 *
 * Responsibilities:
 * - Calculate relevance scores for templates based on project context
 * - Apply selection threshold to filter templates
 * - Support user overrides (manual selection/deselection)
 * - Provide audit trail of selection reasoning
 * - Handle edge cases (unknown project type, no matches)
 *
 * @example
 * ```typescript
 * const result = await agentSelector.selectAgents(projectContext, 70);
 * if (result.isOk()) {
 *   const selections = result.value;
 *   console.log(`Selected ${selections.length} agents:`);
 *   selections.forEach(s => {
 *     console.log(`- ${s.template.name} (score: ${s.relevanceScore})`);
 *   });
 * }
 * ```
 */
export interface IAgentSelectionService {
  /**
   * Select agents based on project context.
   *
   * Scores all available templates against the project context and returns
   * those that meet or exceed the relevance threshold. Results are sorted
   * by relevance score in descending order.
   *
   * @param context - Extended project context from workspace analysis
   * @param threshold - Minimum relevance score (0-100) for inclusion (default: 50)
   * @returns Result containing array of selection results, or Error if selection fails
   *
   * @example
   * ```typescript
   * const result = await service.selectAgents(projectContext, 70);
   * if (result.isErr()) {
   *   console.error('Selection failed:', result.error);
   *   return;
   * }
   *
   * // Process selected agents
   * const selections = result.value;
   * for (const selection of selections) {
   *   console.log(`${selection.template.name}: ${selection.relevanceScore}`);
   *   console.log(`Matched criteria: ${selection.matchedCriteria.join(', ')}`);
   * }
   * ```
   */
  selectAgents(
    context: AgentProjectContext,
    threshold?: number
  ): Promise<Result<SelectionResult[], Error>>;

  /**
   * Calculate relevance score for a template.
   *
   * Scores a single template against project context using the following factors:
   * - Project type match (weight: 40%)
   * - Framework match (weight: 30%)
   * - Monorepo type match (weight: 20%)
   * - Always include flag (weight: 10%)
   *
   * @param template - Agent template to score
   * @param context - Extended project context from workspace analysis
   * @returns Result containing relevance score (0-100), or Error if calculation fails
   *
   * @example
   * ```typescript
   * const result = await service.calculateRelevance(template, projectContext);
   * if (result.isOk()) {
   *   const score = result.value;
   *   if (score >= 70) {
   *     console.log(`Template "${template.name}" is highly relevant (${score})`);
   *   }
   * }
   * ```
   */
  calculateRelevance(
    template: AgentTemplate,
    context: AgentProjectContext
  ): Promise<Result<number, Error>>;
}
