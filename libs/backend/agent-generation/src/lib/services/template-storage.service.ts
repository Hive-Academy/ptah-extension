/**
 * Template Storage Service
 *
 * Loads, parses, and caches agent templates from the filesystem.
 * Templates are markdown files with YAML frontmatter containing metadata.
 *
 * @module @ptah-extension/agent-generation/services
 */

import { injectable, inject } from 'tsyringe';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import matter from 'gray-matter';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared';
import { ITemplateStorageService } from '../interfaces/template-storage.interface';
import { AgentTemplate } from '../types/core.types';
import { TemplateError } from '../errors/template.error';

/**
 * Service for loading and managing agent templates from storage.
 *
 * Responsibilities:
 * - Load templates from extension/templates/agents/ directory
 * - Parse YAML frontmatter and markdown content
 * - Validate template structure and metadata
 * - Cache templates in memory for performance
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
@injectable()
export class TemplateStorageService implements ITemplateStorageService {
  /**
   * In-memory cache for loaded templates.
   * Key: template ID, Value: parsed AgentTemplate
   */
  private readonly templateCache = new Map<string, AgentTemplate>();

  /**
   * Absolute path to the templates directory.
   * Defaults to extension/templates/agents/ if not specified.
   */
  private readonly templatesPath: string;

  /**
   * Flag indicating if templates have been loaded at least once.
   * Used to avoid redundant directory scans.
   */
  private templatesLoaded = false;

  /**
   * Template file extension pattern.
   */
  private readonly TEMPLATE_EXTENSION = '.template.md';

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    templatesPath?: string
  ) {
    // Default to extension/templates/agents/ if not specified
    // In production, this will be injected by the extension's DI container
    this.templatesPath =
      templatesPath || join(__dirname, '..', '..', 'templates', 'agents');

    this.logger.debug('TemplateStorageService initialized', {
      templatesPath: this.templatesPath,
    });
  }

  /**
   * Load all available templates from storage.
   *
   * Reads all .template.md files from the templates directory, parses their
   * YAML frontmatter, and validates their structure. Results are cached for
   * subsequent calls.
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
  async loadAllTemplates(): Promise<Result<AgentTemplate[], Error>> {
    try {
      this.logger.debug('Loading all templates', {
        templatesPath: this.templatesPath,
        cacheSize: this.templateCache.size,
      });

      // If templates already loaded and cached, return cached versions
      if (this.templatesLoaded && this.templateCache.size > 0) {
        this.logger.debug('Returning cached templates', {
          count: this.templateCache.size,
        });
        return Result.ok(Array.from(this.templateCache.values()));
      }

      // Read template directory
      let files: string[];
      try {
        files = await readdir(this.templatesPath);
      } catch (error) {
        // Directory doesn't exist or not readable
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          this.logger.warn('Templates directory does not exist', {
            templatesPath: this.templatesPath,
          });
          return Result.ok([]); // Empty directory is valid
        }
        throw error; // Re-throw other errors
      }

      // Filter to only .template.md files
      const templateFiles = files.filter((file) =>
        file.endsWith(this.TEMPLATE_EXTENSION)
      );

      if (templateFiles.length === 0) {
        this.logger.warn('No template files found', {
          templatesPath: this.templatesPath,
        });
        this.templatesLoaded = true;
        return Result.ok([]);
      }

      // Load each template file
      const templates: AgentTemplate[] = [];
      const errors: Error[] = [];

      for (const file of templateFiles) {
        const templateId = file.replace(this.TEMPLATE_EXTENSION, '');
        const result = await this.loadTemplateFromDisk(templateId, file);

        if (result.isOk()) {
          templates.push(result.value!);
          this.templateCache.set(templateId, result.value!);
        } else {
          // Log error but continue loading other templates
          this.logger.error(`Failed to load template: ${file}`, result.error!);
          errors.push(result.error!);
        }
      }

      this.templatesLoaded = true;

      // If no templates loaded successfully, return error
      if (templates.length === 0 && errors.length > 0) {
        return Result.err(
          new TemplateError(
            `Failed to load all templates. First error: ${errors[0].message}`,
            'all-templates',
            'TEMPLATE_PARSE_ERROR',
            { errorCount: errors.length }
          )
        );
      }

      this.logger.info('Templates loaded successfully', {
        successCount: templates.length,
        errorCount: errors.length,
      });

      return Result.ok(templates);
    } catch (error) {
      this.logger.error('Unexpected error loading templates', error as Error);
      return Result.err(
        new TemplateError(
          `Unexpected error loading templates: ${(error as Error).message}`,
          'all-templates',
          'TEMPLATE_PARSE_ERROR'
        )
      );
    }
  }

  /**
   * Load a specific template by ID.
   *
   * Loads a single template file, parses its content, and validates structure.
   * Template ID must match the filename without the .template.md extension.
   * Results are cached for subsequent calls.
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
  async loadTemplate(
    templateId: string
  ): Promise<Result<AgentTemplate, Error>> {
    try {
      this.logger.debug('Loading template', { templateId });

      // Check cache first
      const cached = this.templateCache.get(templateId);
      if (cached) {
        this.logger.debug('Template found in cache', { templateId });
        return Result.ok(cached);
      }

      // Load from disk
      const fileName = `${templateId}${this.TEMPLATE_EXTENSION}`;
      const result = await this.loadTemplateFromDisk(templateId, fileName);

      if (result.isOk()) {
        // Cache the loaded template
        this.templateCache.set(templateId, result.value!);
        this.logger.info('Template loaded and cached', { templateId });
      }

      return result;
    } catch (error) {
      this.logger.error(
        `Error loading template: ${templateId}`,
        error as Error
      );
      return Result.err(
        new TemplateError(
          `Error loading template ${templateId}: ${(error as Error).message}`,
          templateId,
          'TEMPLATE_PARSE_ERROR'
        )
      );
    }
  }

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
  async getApplicableTemplates(
    projectType: string
  ): Promise<Result<AgentTemplate[], Error>> {
    try {
      this.logger.debug('Getting applicable templates', { projectType });

      // Ensure all templates are loaded
      const allTemplatesResult = await this.loadAllTemplates();
      if (allTemplatesResult.isErr()) {
        return allTemplatesResult;
      }

      const allTemplates = allTemplatesResult.value!;

      // Filter templates by project type
      const applicableTemplates = allTemplates.filter((template) => {
        // Always include templates marked as alwaysInclude
        if (template.applicabilityRules.alwaysInclude) {
          return true;
        }

        // Include if projectTypes is empty (applies to all)
        if (template.applicabilityRules.projectTypes.length === 0) {
          return true;
        }

        // Include if project type matches
        return template.applicabilityRules.projectTypes.some(
          (type) => type.toString().toLowerCase() === projectType.toLowerCase()
        );
      });

      this.logger.info('Applicable templates filtered', {
        projectType,
        totalTemplates: allTemplates.length,
        applicableCount: applicableTemplates.length,
      });

      return Result.ok(applicableTemplates);
    } catch (error) {
      this.logger.error(
        `Error filtering templates for project type: ${projectType}`,
        error as Error
      );
      return Result.err(
        new TemplateError(
          `Error filtering templates for project type ${projectType}: ${
            (error as Error).message
          }`,
          projectType,
          'TEMPLATE_PARSE_ERROR'
        )
      );
    }
  }

  /**
   * Load a template file from disk and parse it.
   *
   * @param templateId - Template identifier for error messages
   * @param fileName - Filename to read (e.g., 'backend-developer.template.md')
   * @returns Result containing parsed template, or Error if loading/parsing fails
   */
  private async loadTemplateFromDisk(
    templateId: string,
    fileName: string
  ): Promise<Result<AgentTemplate, Error>> {
    try {
      const filePath = join(this.templatesPath, fileName);

      // Read file content
      let fileContent: string;
      try {
        fileContent = await readFile(filePath, 'utf-8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return Result.err(
            new TemplateError(
              `Template file not found: ${fileName}`,
              templateId,
              'TEMPLATE_NOT_FOUND',
              { filePath }
            )
          );
        }
        throw error; // Re-throw other errors
      }

      // Parse YAML frontmatter
      let parsed: matter.GrayMatterFile<string>;
      try {
        parsed = matter(fileContent);
      } catch (error) {
        return Result.err(
          new TemplateError(
            `Failed to parse YAML frontmatter in ${fileName}: ${
              (error as Error).message
            }`,
            templateId,
            'TEMPLATE_PARSE_ERROR',
            { filePath }
          )
        );
      }

      // Validate and extract frontmatter
      const frontmatter = parsed.data;
      const content = parsed.content;

      // Validate required fields
      const validationResult = this.validateTemplate(
        templateId,
        frontmatter,
        content
      );
      if (validationResult.isErr()) {
        return Result.err(validationResult.error!);
      }

      // Build AgentTemplate object
      const template: AgentTemplate = {
        id: frontmatter['id'] || templateId,
        name: frontmatter['name'],
        version: frontmatter['version'],
        content,
        applicabilityRules: frontmatter['applicabilityRules'],
        variables: frontmatter['variables'] || [],
        llmSections: frontmatter['llmSections'] || [],
      };

      return Result.ok(template);
    } catch (error) {
      return Result.err(
        new TemplateError(
          `Unexpected error loading template ${templateId}: ${
            (error as Error).message
          }`,
          templateId,
          'TEMPLATE_PARSE_ERROR'
        )
      );
    }
  }

  /**
   * Validate template structure and required fields.
   *
   * @param templateId - Template identifier for error messages
   * @param frontmatter - Parsed YAML frontmatter
   * @param content - Template markdown content
   * @returns Result.ok() if valid, Result.err() with specific error if invalid
   */
  private validateTemplate(
    templateId: string,
    frontmatter: Record<string, unknown>,
    content: string
  ): Result<void, Error> {
    // Required fields in frontmatter
    const requiredFields = ['name', 'version', 'applicabilityRules'];

    for (const field of requiredFields) {
      if (!frontmatter[field]) {
        return Result.err(
          new TemplateError(
            `Missing required field in template: ${field}`,
            templateId,
            'TEMPLATE_VALIDATION_ERROR',
            { missingField: field }
          )
        );
      }
    }

    // Validate applicabilityRules structure
    const rules = frontmatter['applicabilityRules'] as Record<string, unknown>;
    if (!rules) {
      return Result.err(
        new TemplateError(
          'Missing applicabilityRules in template',
          templateId,
          'TEMPLATE_VALIDATION_ERROR'
        )
      );
    }

    // Validate required applicabilityRules fields
    const requiredRuleFields = [
      'projectTypes',
      'frameworks',
      'monorepoTypes',
      'minimumRelevanceScore',
      'alwaysInclude',
    ];

    for (const field of requiredRuleFields) {
      if (rules[field] === undefined || rules[field] === null) {
        return Result.err(
          new TemplateError(
            `Missing required field in applicabilityRules: ${field}`,
            templateId,
            'TEMPLATE_VALIDATION_ERROR',
            { missingField: `applicabilityRules.${field}` }
          )
        );
      }
    }

    // Validate arrays
    if (!Array.isArray(rules['projectTypes'])) {
      return Result.err(
        new TemplateError(
          'applicabilityRules.projectTypes must be an array',
          templateId,
          'TEMPLATE_VALIDATION_ERROR'
        )
      );
    }

    if (!Array.isArray(rules['frameworks'])) {
      return Result.err(
        new TemplateError(
          'applicabilityRules.frameworks must be an array',
          templateId,
          'TEMPLATE_VALIDATION_ERROR'
        )
      );
    }

    if (!Array.isArray(rules['monorepoTypes'])) {
      return Result.err(
        new TemplateError(
          'applicabilityRules.monorepoTypes must be an array',
          templateId,
          'TEMPLATE_VALIDATION_ERROR'
        )
      );
    }

    // Validate minimumRelevanceScore
    if (
      typeof rules['minimumRelevanceScore'] !== 'number' ||
      rules['minimumRelevanceScore'] < 0 ||
      rules['minimumRelevanceScore'] > 100
    ) {
      return Result.err(
        new TemplateError(
          'applicabilityRules.minimumRelevanceScore must be a number between 0 and 100',
          templateId,
          'TEMPLATE_VALIDATION_ERROR'
        )
      );
    }

    // Validate alwaysInclude
    if (typeof rules['alwaysInclude'] !== 'boolean') {
      return Result.err(
        new TemplateError(
          'applicabilityRules.alwaysInclude must be a boolean',
          templateId,
          'TEMPLATE_VALIDATION_ERROR'
        )
      );
    }

    // Validate content not empty
    if (!content || content.trim().length === 0) {
      return Result.err(
        new TemplateError(
          'Template content cannot be empty',
          templateId,
          'TEMPLATE_VALIDATION_ERROR'
        )
      );
    }

    return Result.ok(undefined);
  }

  /**
   * Clear the template cache.
   * Useful for testing or forcing a reload of templates.
   */
  clearCache(): void {
    this.logger.debug('Clearing template cache', {
      cacheSize: this.templateCache.size,
    });
    this.templateCache.clear();
    this.templatesLoaded = false;
  }

  /**
   * Get cache statistics.
   * Useful for monitoring and debugging.
   */
  getCacheStats(): { size: number; loaded: boolean } {
    return {
      size: this.templateCache.size,
      loaded: this.templatesLoaded,
    };
  }
}
