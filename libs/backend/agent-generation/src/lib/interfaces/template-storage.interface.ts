/**
 * Template Storage Interface
 *
 * Service interface for loading and managing agent templates from storage.
 * Templates are stored as markdown files with YAML frontmatter containing metadata.
 *
 * @module @ptah-extension/agent-generation/interfaces
 */

import { Result } from '@ptah-extension/shared';
import { AgentTemplate } from '../types/core.types';

/**
 * Service for loading and managing agent templates.
 *
 * Responsibilities:
 * - Load templates from filesystem (extension/templates/agents/)
 * - Parse YAML frontmatter and markdown content
 * - Validate template structure and metadata
 * - Cache templates for performance
 * - Filter templates by project context
 *
 * @example
 * ```typescript
 * const result = await templateStorage.loadAllTemplates();
 * if (result.isOk()) {
 *   const templates = result.value;
 *   console.log(`Loaded ${templates.length} templates`);
 * }
 * ```
 */
export interface ITemplateStorageService {
  /**
   * Load all available templates from storage.
   *
   * Reads all .template.md files from the templates directory, parses their
   * YAML frontmatter, and validates their structure.
   *
   * @returns Result containing array of all templates, or Error if loading fails
   *
   * @example
   * ```typescript
   * const result = await service.loadAllTemplates();
   * if (result.isErr()) {
   *   console.error('Failed to load templates:', result.error);
   *   return;
   * }
   * const templates = result.value;
   * ```
   */
  loadAllTemplates(): Promise<Result<AgentTemplate[], Error>>;

  /**
   * Load a specific template by ID.
   *
   * Loads a single template file, parses its content, and validates structure.
   * Template ID must match the filename without the .template.md extension.
   *
   * @param templateId - Unique template identifier (e.g., 'backend-developer')
   * @returns Result containing the template, or Error if not found or invalid
   *
   * @example
   * ```typescript
   * const result = await service.loadTemplate('backend-developer');
   * if (result.isOk()) {
   *   console.log(`Loaded template: ${result.value.name}`);
   * }
   * ```
   */
  loadTemplate(templateId: string): Promise<Result<AgentTemplate, Error>>;

  /**
   * Get templates matching project context.
   *
   * Filters templates based on project type, allowing quick retrieval of
   * potentially relevant templates before full relevance scoring.
   *
   * @param projectType - Project type string (e.g., 'Node', 'React', 'Python')
   * @returns Result containing filtered templates, or Error if filtering fails
   *
   * @example
   * ```typescript
   * const result = await service.getApplicableTemplates('Node');
   * if (result.isOk()) {
   *   const nodeTemplates = result.value;
   *   console.log(`Found ${nodeTemplates.length} templates for Node projects`);
   * }
   * ```
   */
  getApplicableTemplates(
    projectType: string
  ): Promise<Result<AgentTemplate[], Error>>;
}
