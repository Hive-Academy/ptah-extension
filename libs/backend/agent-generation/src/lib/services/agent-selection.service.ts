/**
 * Agent Selection Service
 *
 * Scores agent templates for relevance to project context and selects agents above threshold.
 * Implements a multi-factor scoring algorithm with configurable threshold and user override support.
 *
 * @module @ptah-extension/agent-generation/services
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared';
import {
  IAgentSelectionService,
  SelectionResult,
} from '../interfaces/agent-selection.interface';
import { ITemplateStorageService } from '../interfaces/template-storage.interface';
import { AgentTemplate, AgentProjectContext } from '../types/core.types';
import { AGENT_GENERATION_TOKENS } from '../di/tokens';

/**
 * Agent Selection Service
 *
 * Responsibilities:
 * - Score each agent template (0-100) based on project characteristics
 * - Apply selection threshold (default: 50)
 * - Handle user overrides (manual selection/deselection)
 * - Log selection reasoning for audit trail
 * - Handle edge cases (unknown project, no matches)
 *
 * Pattern: Scoring Algorithm with Rule Engine
 * Reference: FileRelevanceScorerService from workspace-intelligence
 *
 * @example
 * ```typescript
 * const result = await agentSelector.selectAgents(projectContext, 70);
 * if (result.isOk()) {
 *   const selections = result.value;
 *   console.log(`Selected ${selections.length} agents`);
 * }
 * ```
 */
@injectable()
export class AgentSelectionService implements IAgentSelectionService {
  /**
   * Default relevance threshold for agent selection.
   * Templates with scores below this threshold are excluded.
   */
  private readonly DEFAULT_THRESHOLD = 50;

  /**
   * Core agents that are always included when no agents meet threshold.
   * Ensures basic functionality even for unknown project types.
   */
  private readonly CORE_AGENTS = [
    'orchestrate',
    'team-leader',
    'backend-developer',
  ];

  constructor(
    @inject(AGENT_GENERATION_TOKENS.TEMPLATE_STORAGE_SERVICE)
    private readonly templateStorage: ITemplateStorageService,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger
  ) {
    this.logger.debug('AgentSelectionService initialized');
  }

  /**
   * Select agents based on project context.
   *
   * Scores all available templates against the project context and returns
   * those that meet or exceed the relevance threshold. Results are sorted
   * by relevance score in descending order.
   *
   * Algorithm:
   * 1. Load all templates from storage
   * 2. Score each template against project context
   * 3. Filter by threshold
   * 4. Sort by score (descending)
   * 5. Fallback to core agents if no matches
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
  async selectAgents(
    context: AgentProjectContext,
    threshold: number = this.DEFAULT_THRESHOLD
  ): Promise<Result<SelectionResult[], Error>> {
    try {
      this.logger.debug('Selecting agents', {
        projectType: context.projectType,
        frameworks: context.frameworks,
        threshold,
      });

      // Validate threshold
      if (threshold < 0 || threshold > 100) {
        return Result.err(
          new Error(
            `Invalid threshold: ${threshold}. Must be between 0 and 100`
          )
        );
      }

      // Load all templates
      const templatesResult = await this.templateStorage.loadAllTemplates();
      if (templatesResult.isErr()) {
        this.logger.error('Failed to load templates', templatesResult.error!);
        return Result.err(templatesResult.error!);
      }

      const templates = templatesResult.value!;

      if (templates.length === 0) {
        this.logger.warn('No templates available for selection');
        return Result.ok([]);
      }

      // Score all templates
      const scoredTemplates: SelectionResult[] = [];

      for (const template of templates) {
        const scoreResult = await this.calculateRelevance(template, context);

        if (scoreResult.isErr()) {
          this.logger.warn(
            `Failed to score template: ${template.id}`,
            scoreResult.error!
          );
          continue; // Skip templates that fail scoring
        }

        const score = scoreResult.value!;

        // Build matched criteria list
        const matchedCriteria = this.buildMatchedCriteria(
          template,
          context,
          score
        );

        scoredTemplates.push({
          template,
          relevanceScore: score,
          matchedCriteria,
        });
      }

      // Filter by threshold
      let selectedTemplates = scoredTemplates.filter(
        (result) => result.relevanceScore >= threshold
      );

      // Fallback: If no templates meet threshold, select top 3 by score
      if (selectedTemplates.length === 0) {
        this.logger.warn(
          `No templates meet threshold ${threshold}, selecting top 3 by score`
        );

        selectedTemplates = scoredTemplates
          .sort((a, b) => b.relevanceScore - a.relevanceScore)
          .slice(0, 3);

        // Additional fallback: If still no templates, use core agents
        if (selectedTemplates.length === 0) {
          this.logger.warn('No templates scored, falling back to core agents');

          const coreAgents = templates.filter((t) =>
            this.CORE_AGENTS.includes(t.id)
          );

          selectedTemplates = coreAgents.map((template) => ({
            template,
            relevanceScore: 50, // Baseline score for core agents
            matchedCriteria: ['Core agent (fallback)'],
          }));
        }
      }

      // Sort by relevance score (descending)
      selectedTemplates.sort((a, b) => b.relevanceScore - a.relevanceScore);

      // Log selection summary
      this.logger.info('Agent selection complete', {
        totalTemplates: templates.length,
        selectedCount: selectedTemplates.length,
        threshold,
        topAgent:
          selectedTemplates.length > 0
            ? selectedTemplates[0].template.name
            : 'none',
      });

      // Log each selected agent's reasoning
      selectedTemplates.forEach((selection) => {
        this.logger.debug('Selected agent', {
          agentId: selection.template.id,
          agentName: selection.template.name,
          score: selection.relevanceScore,
          criteria: selection.matchedCriteria,
        });
      });

      return Result.ok(selectedTemplates);
    } catch (error) {
      this.logger.error(
        'Unexpected error during agent selection',
        error as Error
      );
      return Result.err(
        new Error(`Agent selection failed: ${(error as Error).message}`)
      );
    }
  }

  /**
   * Calculate relevance score for a template.
   *
   * Scores a single template against project context using the following factors:
   * - Project type match (weight: 40%)
   * - Framework match (weight: 30%)
   * - Monorepo type match (weight: 20%)
   * - Always include flag (weight: 10%)
   *
   * Scoring Algorithm:
   * - Base: Project type match = 40 points
   * - Tech: Framework match = 10 points per match, max 30
   * - Repo: Monorepo type match = 20 points
   * - Override: Always include = 100 points (bypasses all other scoring)
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
  async calculateRelevance(
    template: AgentTemplate,
    context: AgentProjectContext
  ): Promise<Result<number, Error>> {
    try {
      let score = 0;

      // Always include flag (100 points - overrides all other scoring)
      if (template.applicabilityRules.alwaysInclude) {
        this.logger.debug('Template always included', {
          templateId: template.id,
          score: 100,
        });
        return Result.ok(100);
      }

      // Base score: Project type match (0-40 points)
      if (
        template.applicabilityRules.projectTypes.length === 0 ||
        template.applicabilityRules.projectTypes.some(
          (type) => type === context.projectType
        )
      ) {
        score += 40;
      }

      // Tech stack match (0-30 points)
      // 10 points per framework match, max 30 points
      const frameworkMatches = template.applicabilityRules.frameworks.filter(
        (framework) => context.frameworks.includes(framework)
      );
      score += Math.min(30, frameworkMatches.length * 10);

      // Monorepo type match (0-20 points)
      if (context.monorepoType) {
        if (
          template.applicabilityRules.monorepoTypes.length === 0 ||
          template.applicabilityRules.monorepoTypes.includes(
            context.monorepoType
          )
        ) {
          score += 20;
        }
      } else {
        // Not a monorepo - give partial credit if template doesn't require monorepo
        if (template.applicabilityRules.monorepoTypes.length === 0) {
          score += 10; // Half credit for monorepo-agnostic templates
        }
      }

      // Architecture match (0-10 points) - Future enhancement
      // Currently not implemented in AgentProjectContext type
      // Reserved for future use when we add architecture detection

      // Normalize score to 0-100 range
      const normalizedScore = Math.max(0, Math.min(100, score));

      this.logger.debug('Template relevance calculated', {
        templateId: template.id,
        templateName: template.name,
        score: normalizedScore,
        projectTypeMatch: template.applicabilityRules.projectTypes.includes(
          context.projectType
        ),
        frameworkMatches: frameworkMatches.length,
        monorepoMatch: context.monorepoType
          ? template.applicabilityRules.monorepoTypes.includes(
              context.monorepoType
            )
          : false,
      });

      return Result.ok(normalizedScore);
    } catch (error) {
      this.logger.error(
        `Error calculating relevance for template: ${template.id}`,
        error as Error
      );
      return Result.err(
        new Error(
          `Relevance calculation failed for ${template.id}: ${
            (error as Error).message
          }`
        )
      );
    }
  }

  /**
   * Build human-readable matched criteria list for a template.
   *
   * Creates a list of reasons why a template was selected, useful for
   * audit trails and user transparency.
   *
   * @param template - Template being scored
   * @param context - Project context
   * @param score - Calculated relevance score
   * @returns Array of matched criteria descriptions
   *
   * @private
   */
  private buildMatchedCriteria(
    template: AgentTemplate,
    context: AgentProjectContext,
    score: number
  ): string[] {
    const criteria: string[] = [];

    // Always include flag
    if (template.applicabilityRules.alwaysInclude) {
      criteria.push('Always include flag set');
      return criteria; // Short-circuit for always-include templates
    }

    // Project type match
    if (
      template.applicabilityRules.projectTypes.length === 0 ||
      template.applicabilityRules.projectTypes.some(
        (type) => type === context.projectType
      )
    ) {
      if (template.applicabilityRules.projectTypes.length === 0) {
        criteria.push('Project type: All projects');
      } else {
        criteria.push(`Project type matches: ${context.projectType}`);
      }
    }

    // Framework matches
    const frameworkMatches = template.applicabilityRules.frameworks.filter(
      (framework) => context.frameworks.includes(framework)
    );
    if (frameworkMatches.length > 0) {
      criteria.push(`Framework matches: ${frameworkMatches.join(', ')}`);
    }

    // Monorepo type match
    if (context.monorepoType) {
      if (
        template.applicabilityRules.monorepoTypes.length === 0 ||
        template.applicabilityRules.monorepoTypes.includes(context.monorepoType)
      ) {
        if (template.applicabilityRules.monorepoTypes.length === 0) {
          criteria.push('Monorepo type: All monorepos');
        } else {
          criteria.push(`Monorepo type matches: ${context.monorepoType}`);
        }
      }
    } else if (template.applicabilityRules.monorepoTypes.length === 0) {
      criteria.push('Monorepo type: Not required');
    }

    // Score-based criteria
    if (score >= 90) {
      criteria.push('Highly relevant (score >= 90)');
    } else if (score >= 70) {
      criteria.push('Relevant (score >= 70)');
    } else if (score >= 50) {
      criteria.push('Moderately relevant (score >= 50)');
    }

    // Fallback if no criteria matched
    if (criteria.length === 0) {
      criteria.push(`Low relevance (score: ${score})`);
    }

    return criteria;
  }
}
