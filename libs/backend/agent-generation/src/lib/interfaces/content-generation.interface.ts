/**
 * Content Generation Interface
 *
 * Service interface for generating agent content using templates and LLM customization.
 * Coordinates variable substitution and LLM-based section customization.
 *
 * @module @ptah-extension/agent-generation/interfaces
 */

import { Result } from '@ptah-extension/shared';
import type { GenerationStreamPayload } from '@ptah-extension/shared';
import {
  AgentTemplate,
  AgentProjectContext,
  LlmCustomization,
} from '../types/core.types';

/**
 * SDK configuration for internal query execution during content generation.
 */
export interface ContentGenerationSdkConfig {
  isPremium: boolean;
  mcpServerRunning: boolean;
  mcpPort?: number;
  model?: string;
  /** Callback for real-time stream events (text, tool calls, thinking) */
  onStreamEvent?: (event: GenerationStreamPayload) => void;
  /** Enhanced prompt content to include in the generation system prompt */
  enhancedPromptContent?: string;
  /** Absolute paths to plugin directories */
  pluginPaths?: string[];
}

/**
 * Service for generating agent content using templates and LLM.
 *
 * Responsibilities:
 * - Orchestrate template variable substitution
 * - Generate LLM customizations for marked sections
 * - Assemble final agent content from template + customizations
 * - Handle LLM errors with fallback content
 * - Track token usage per customization
 *
 * @example
 * ```typescript
 * const result = await contentGenerator.generateContent(template, projectContext);
 * if (result.isOk()) {
 *   const content = result.value;
 *   console.log('Generated agent content:', content.substring(0, 100) + '...');
 * }
 * ```
 */
export interface IContentGenerationService {
  /**
   * Generate content for an agent template.
   *
   * Performs the complete content generation workflow:
   * 1. Substitute variables ({{variableName}}) with project-specific values
   * 2. Generate LLM customizations for marked sections (<!-- LLM:id -->)
   * 3. Replace LLM section markers with generated content
   * 4. Validate final content structure
   *
   * If LLM customization fails, falls back to original template content
   * for that section (with substituted variables).
   *
   * @param template - Agent template to generate content from
   * @param context - Extended project context for variable substitution and LLM prompts
   * @returns Result containing final generated content, or Error if generation fails
   *
   * @example
   * ```typescript
   * const result = await service.generateContent(template, projectContext);
   * if (result.isErr()) {
   *   console.error('Generation failed:', result.error);
   *   return;
   * }
   *
   * const { content, description } = result.value;
   * console.log(`Generated ${content.length} characters, description: ${description}`);
   * ```
   */
  generateContent(
    template: AgentTemplate,
    context: AgentProjectContext,
    sdkConfig?: ContentGenerationSdkConfig,
  ): Promise<Result<{ content: string; description: string }, Error>>;

  /**
   * Generate LLM customizations for template sections.
   *
   * Processes all LLM-marked sections in the template, sending customization
   * prompts to the LLM and collecting responses. Each section is customized
   * independently to avoid context pollution.
   *
   * Customizations include:
   * - Original prompt (after variable substitution)
   * - Generated content from LLM
   * - Token usage for this section
   *
   * @param template - Agent template containing LLM sections to customize
   * @param context - Extended project context for prompt customization
   * @returns Result containing array of customizations, or Error if generation fails
   *
   * @example
   * ```typescript
   * const result = await service.generateLlmSections(template, projectContext);
   * if (result.isOk()) {
   *   const customizations = result.value;
   *   console.log(`Generated ${customizations.length} customizations`);
   *
   *   const totalTokens = customizations.reduce((sum, c) => sum + c.tokensUsed, 0);
   *   console.log(`Total tokens used: ${totalTokens}`);
   * }
   * ```
   */
  generateLlmSections(
    template: AgentTemplate,
    context: AgentProjectContext,
  ): Promise<Result<LlmCustomization[], Error>>;
}
