/**
 * Agent Selection Service
 *
 * Selects all available agent templates for generation.
 * All agents are always recommended — the LLM and project analysis
 * provide the intelligence, not hard-coded scoring rules.
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
 * - Load all available agent templates
 * - Select all agents (intelligence comes from LLM, not scoring rules)
 * - Build descriptive context criteria from project characteristics
 * - Log selection for audit trail
 *
 * @example
 * ```typescript
 * const result = await agentSelector.selectAgents(projectContext);
 * if (result.isOk()) {
 *   const selections = result.value;
 *   console.log(`Selected ${selections.length} agents`);
 * }
 * ```
 */
@injectable()
export class AgentSelectionService implements IAgentSelectionService {
  constructor(
    @inject(AGENT_GENERATION_TOKENS.TEMPLATE_STORAGE_SERVICE)
    private readonly templateStorage: ITemplateStorageService,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger
  ) {
    this.logger.debug('AgentSelectionService initialized');
  }

  /**
   * Select all available agent templates.
   *
   * All templates are selected with maximum relevance — the LLM
   * customization in Phase 3 handles project-specific adaptation.
   *
   * @param context - Extended project context from workspace analysis
   * @param _threshold - Ignored (kept for interface compatibility)
   * @returns Result containing array of all templates as selection results
   */
  async selectAgents(
    context: AgentProjectContext,
    _threshold?: number
  ): Promise<Result<SelectionResult[], Error>> {
    try {
      this.logger.debug('Selecting agents', {
        projectType: context.projectType,
        frameworks: context.frameworks,
      });

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

      // Select all templates — intelligence comes from LLM customization
      const selectedTemplates: SelectionResult[] = templates.map(
        (template) => ({
          template,
          relevanceScore: 100,
          matchedCriteria: this.buildCriteria(template, context),
        })
      );

      // Log selection summary
      this.logger.info('Agent selection complete', {
        totalTemplates: templates.length,
        selectedCount: selectedTemplates.length,
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
   * Always returns 100 — all agents are relevant.
   *
   * @param _template - Agent template (unused)
   * @param _context - Project context (unused)
   * @returns Result containing 100
   */
  async calculateRelevance(
    _template: AgentTemplate,
    _context: AgentProjectContext
  ): Promise<Result<number, Error>> {
    return Result.ok(100);
  }

  /**
   * Build descriptive criteria from project context.
   *
   * @param template - Template being selected
   * @param context - Project context
   * @returns Array of context descriptions
   */
  private buildCriteria(
    template: AgentTemplate,
    context: AgentProjectContext
  ): string[] {
    const criteria: string[] = [];

    criteria.push(`Project type: ${context.projectType}`);

    if (context.frameworks.length > 0) {
      criteria.push(`Frameworks: ${context.frameworks.join(', ')}`);
    }

    if (context.monorepoType) {
      criteria.push(`Monorepo: ${context.monorepoType}`);
    }

    if (context.techStack.languages.length > 0) {
      criteria.push(`Languages: ${context.techStack.languages.join(', ')}`);
    }

    return criteria;
  }
}
