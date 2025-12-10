/**
 * Content Generation Service
 *
 * Renders agent templates by substituting variables and injecting LLM-customized sections.
 * Coordinates variable substitution, conditional processing, LLM section injection,
 * and static section preservation.
 *
 * @module @ptah-extension/agent-generation/services
 */

import { injectable, inject } from 'tsyringe';
import { Result } from '@ptah-extension/shared';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import * as path from 'path';
import { IContentGenerationService } from '../interfaces/content-generation.interface';
import {
  AgentTemplate,
  AgentProjectContext,
  LlmCustomization,
  TemplateVariable,
} from '../types/core.types';
import { ContentGenerationError } from '../errors/generation.error';
import { processTemplate } from '../utils/content-processor';

/**
 * Service for generating agent content using templates and LLM customization.
 *
 * Implements the complete content generation workflow:
 * 1. Extract and preserve static sections
 * 2. Substitute variables with project-specific values
 * 3. Process conditional blocks ({{#if}})
 * 4. Inject LLM-generated customizations
 * 5. Restore static sections
 *
 * @example
 * ```typescript
 * const result = await service.generateContent(template, projectContext);
 * if (result.isOk()) {
 *   const content = result.value;
 *   console.log('Generated:', content);
 * }
 * ```
 */
@injectable()
export class ContentGenerationService implements IContentGenerationService {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * Generate content for an agent template.
   *
   * Performs complete content generation:
   * - Substitutes variables ({{variableName}})
   * - Processes conditionals ({{#if CONDITION}})
   * - Generates LLM customizations
   * - Injects LLM sections
   * - Preserves static sections
   *
   * @param template - Agent template to generate content from
   * @param context - Project context for variable substitution and LLM prompts
   * @returns Result containing final generated content, or Error
   */
  async generateContent(
    template: AgentTemplate,
    context: AgentProjectContext
  ): Promise<Result<string, Error>> {
    try {
      this.logger.info('Starting content generation', {
        templateId: template.id,
        templateVersion: template.version,
      });

      // 1. Extract and preserve static sections
      const staticSections = this.extractStaticSections(template.content);
      this.logger.debug('Extracted static sections', {
        count: staticSections.size,
      });

      // 2. Substitute variables
      let content = this.substituteVariables(
        template.content,
        context,
        template.variables
      );

      // 3. Process conditionals
      content = this.processConditionals(content, context);

      // 4. Generate LLM customizations
      const customizationsResult = await this.generateLlmSections(
        template,
        context
      );
      if (customizationsResult.isErr()) {
        this.logger.warn('LLM customization failed, using fallback content', {
          error: customizationsResult.error?.message || 'Unknown error',
        });
        // Continue with variables substituted but no LLM customizations
      }

      // 5. Inject LLM sections (if available)
      if (customizationsResult.isOk() && customizationsResult.value) {
        content = this.injectLlmSections(content, customizationsResult.value);
      }

      // 6. Restore static sections
      content = this.restoreStaticSections(content, staticSections);

      this.logger.info('Content generation complete', {
        templateId: template.id,
        contentLength: content.length,
      });

      return Result.ok(content);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error('Content generation failed', {
        templateId: template.id,
        error: errorMessage,
      });
      return Result.err(
        new ContentGenerationError(
          `Failed to generate content: ${errorMessage}`,
          'content',
          template.name,
          {
            templateId: template.id,
            context: { projectType: context.projectType },
          }
        )
      );
    }
  }

  /**
   * Generate LLM customizations for template sections.
   *
   * Processes all LLM-marked sections in the template, sending prompts to the LLM.
   * Currently returns empty array (LLM integration is in next task).
   *
   * @param template - Agent template containing LLM sections
   * @param context - Project context for prompt customization
   * @returns Result containing array of customizations, or Error
   */
  async generateLlmSections(
    template: AgentTemplate,
    context: AgentProjectContext
  ): Promise<Result<LlmCustomization[], Error>> {
    try {
      this.logger.info('Generating LLM sections', {
        templateId: template.id,
        sectionCount: template.llmSections.length,
      });

      // Extract LLM section markers from content
      const llmSectionRegex = /<!-- LLM:(\w+) -->([\s\S]*?)<!-- \/LLM -->/g;
      const matches = Array.from(template.content.matchAll(llmSectionRegex));

      if (matches.length === 0) {
        this.logger.debug('No LLM sections found in template', {
          templateId: template.id,
        });
        return Result.ok([]);
      }

      // Validate that all section IDs in content have corresponding definitions
      for (const match of matches) {
        const sectionId = match[1];
        const section = template.llmSections.find((s) => s.id === sectionId);
        if (!section) {
          return Result.err(
            new ContentGenerationError(
              `LLM section '${sectionId}' found in content but not defined in template.llmSections`,
              'llm',
              template.name,
              { sectionId, templateId: template.id }
            )
          );
        }
      }

      // TODO (Task 1.5 - AgentCustomizationService):
      // This will be implemented by AgentCustomizationService
      // For now, return empty array - content will use fallback (original template content)
      this.logger.debug(
        'LLM integration not yet implemented, using fallback content',
        {
          templateId: template.id,
        }
      );

      return Result.ok([]);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error('LLM section generation failed', {
        templateId: template.id,
        error: errorMessage,
      });
      return Result.err(
        new ContentGenerationError(
          `Failed to generate LLM sections: ${errorMessage}`,
          'llm',
          template.name,
          { templateId: template.id }
        )
      );
    }
  }

  /**
   * Substitute variables in content with values from context.
   *
   * Replaces {{variableName}} placeholders using this priority:
   * 1. Values from AgentProjectContext
   * 2. defaultValue from TemplateVariable definition
   * 3. Empty string (with warning)
   *
   * @param content - Content with variable placeholders
   * @param context - Project context containing values
   * @param variables - Variable definitions with metadata
   * @returns Content with variables substituted
   */
  private substituteVariables(
    content: string,
    context: AgentProjectContext,
    variables: TemplateVariable[]
  ): string {
    // Build context-to-variable mapping
    const contextVariables = this.buildContextVariables(context);

    // Process each defined variable
    for (const variable of variables) {
      let value = contextVariables[variable.name];

      // If not found in context, try default value
      if (value === undefined) {
        if (variable.defaultValue !== undefined) {
          value = variable.defaultValue;
          this.logger.debug('Using default value for variable', {
            variable: variable.name,
            defaultValue: value,
          });
        } else {
          if (variable.required) {
            this.logger.warn('Required variable not found', {
              variable: variable.name,
              description: variable.description,
            });
          }
          value = '';
        }
      }

      // Substitute the variable
      const regex = new RegExp(`\\{\\{${variable.name}\\}\\}`, 'g');
      content = content.replace(regex, value);
    }

    // Check for remaining unsubstituted variables
    const remainingVars = content.match(/\{\{(\w+)\}\}/g);
    if (remainingVars && remainingVars.length > 0) {
      this.logger.warn('Unsubstituted variables found in content', {
        variables: remainingVars,
      });
    }

    return content;
  }

  /**
   * Build variable map from project context.
   *
   * Maps AgentProjectContext properties to template variable values.
   *
   * @param context - Project context
   * @returns Map of variable names to values
   */
  private buildContextVariables(
    context: AgentProjectContext
  ): Record<string, string> {
    return {
      projectName: path.basename(context.rootPath),
      projectType: context.projectType,
      frameworks: context.frameworks.join(', '),
      monorepoType: context.monorepoType || 'none',
      languages: context.techStack.languages.join(', '),
      buildTools: context.techStack.buildTools.join(', '),
      testingFrameworks: context.techStack.testingFrameworks.join(', '),
      packageManager: context.techStack.packageManager,
      indentation: context.codeConventions.indentation,
      indentSize: context.codeConventions.indentSize.toString(),
      quoteStyle: context.codeConventions.quoteStyle,
      semicolons: context.codeConventions.semicolons.toString(),
      trailingComma: context.codeConventions.trailingComma,
    };
  }

  /**
   * Process conditional blocks in content.
   *
   * Handles {{#if CONDITION}}...{{/if}} blocks with nested support.
   * Evaluates condition against context variables.
   *
   * Supported conditions:
   * - {{#if variableName}} - Truthy check
   * - {{#if !variableName}} - Falsy check
   *
   * @param content - Content with conditional blocks
   * @param context - Project context for condition evaluation
   * @returns Content with conditionals processed
   */
  private processConditionals(
    content: string,
    context: AgentProjectContext
  ): string {
    const contextVariables = this.buildContextVariables(context);

    // Process conditionals recursively (supports nesting)
    let processed = content;
    let previousContent: string;
    let iterations = 0;
    const maxIterations = 10; // Prevent infinite loops

    do {
      previousContent = processed;
      processed = this.processConditionalPass(processed, contextVariables);
      iterations++;
    } while (processed !== previousContent && iterations < maxIterations);

    if (iterations >= maxIterations) {
      this.logger.warn('Conditional processing hit max iterations', {
        maxIterations,
      });
    }

    // Check for unclosed conditionals
    const unclosedStart = processed.match(/\{\{#if\s+(\w+)\}\}/);
    const unclosedEnd = processed.match(/\{\{\/if\}\}/);
    if (unclosedStart && !unclosedEnd) {
      this.logger.error('Unclosed conditional block detected', {
        condition: unclosedStart[1],
        position: processed.indexOf(unclosedStart[0]),
      });
    }

    return processed;
  }

  /**
   * Process one pass of conditionals (for nested support).
   *
   * @param content - Content to process
   * @param variables - Variable values for condition evaluation
   * @returns Content with one level of conditionals processed
   */
  private processConditionalPass(
    content: string,
    variables: Record<string, string>
  ): string {
    // Match {{#if condition}}content{{/if}} (non-greedy)
    const conditionalRegex = /\{\{#if\s+(!?)(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/;
    const match = content.match(conditionalRegex);

    if (!match) {
      return content;
    }

    const [fullMatch, negation, variableName, conditionalContent] = match;
    const variableValue = variables[variableName];

    // Evaluate condition
    let condition: boolean;
    if (negation === '!') {
      // Negated condition - true if variable is falsy
      condition =
        !variableValue || variableValue === 'false' || variableValue === '0';
    } else {
      // Normal condition - true if variable is truthy
      condition =
        !!variableValue && variableValue !== 'false' && variableValue !== '0';
    }

    this.logger.debug('Evaluating conditional', {
      variable: variableName,
      negation: !!negation,
      value: variableValue,
      condition,
    });

    // Replace conditional with content or empty string
    const replacement = condition ? conditionalContent : '';
    return content.replace(fullMatch, replacement);
  }

  /**
   * Inject LLM-generated content into template sections.
   *
   * Replaces <!-- LLM:id -->...<!-- /LLM --> markers with generated content.
   *
   * @param content - Content with LLM section markers
   * @param customizations - LLM-generated customizations
   * @returns Content with LLM sections injected
   */
  private injectLlmSections(
    content: string,
    customizations: LlmCustomization[]
  ): string {
    let processed = content;

    for (const customization of customizations) {
      const sectionRegex = new RegExp(
        `<!-- LLM:${customization.sectionId} -->([\\s\\S]*?)<!-- \\/LLM -->`,
        'g'
      );

      const matches = Array.from(processed.matchAll(sectionRegex));
      if (matches.length === 0) {
        this.logger.warn('LLM section marker not found in content', {
          sectionId: customization.sectionId,
        });
        continue;
      }

      if (matches.length > 1) {
        this.logger.warn('Multiple LLM section markers found', {
          sectionId: customization.sectionId,
          count: matches.length,
        });
      }

      // Replace with generated content
      processed = processed.replace(
        sectionRegex,
        customization.generatedContent
      );

      this.logger.debug('Injected LLM section', {
        sectionId: customization.sectionId,
        contentLength: customization.generatedContent.length,
        tokensUsed: customization.tokensUsed,
      });
    }

    return processed;
  }

  /**
   * Extract static sections from content for preservation.
   *
   * Static sections are marked with <!-- STATIC -->...<!-- /STATIC -->.
   * These sections are never modified by variable substitution or LLM.
   *
   * @param content - Content with static section markers
   * @returns Map of placeholder IDs to original static content
   */
  private extractStaticSections(content: string): Map<string, string> {
    const staticSections = new Map<string, string>();
    const staticRegex = /<!-- STATIC -->([\s\S]*?)<!-- \/STATIC -->/g;
    const matches = Array.from(content.matchAll(staticRegex));

    for (let i = 0; i < matches.length; i++) {
      const staticContent = matches[i][1];
      const placeholder = `__STATIC_SECTION_${i}__`;
      staticSections.set(placeholder, staticContent);
    }

    this.logger.debug('Extracted static sections', {
      count: staticSections.size,
    });

    return staticSections;
  }

  /**
   * Restore static sections to content after processing.
   *
   * Replaces placeholder markers with original static content.
   *
   * @param content - Content with static section placeholders
   * @param sections - Map of placeholder IDs to original content
   * @returns Content with static sections restored
   */
  private restoreStaticSections(
    content: string,
    sections: Map<string, string>
  ): string {
    let processed = content;

    // Remove static markers and replace with placeholders during processing
    const staticRegex = /<!-- STATIC -->([\s\S]*?)<!-- \/STATIC -->/g;
    let i = 0;
    processed = processed.replace(staticRegex, () => {
      const placeholder = `__STATIC_SECTION_${i}__`;
      i++;
      return placeholder;
    });

    // Restore original content
    for (const [placeholder, originalContent] of sections.entries()) {
      processed = processed.replace(placeholder, originalContent);
    }

    return processed;
  }
}
