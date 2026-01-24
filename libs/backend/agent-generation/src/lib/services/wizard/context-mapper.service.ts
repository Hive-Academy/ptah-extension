/**
 * WizardContextMapperService - Context Transformation Service
 * TASK_2025_115: Setup Wizard Service Decomposition
 *
 * Responsibility:
 * - Transform between frontend ProjectContext and backend AgentProjectContext
 * - Handle enum string-to-enum conversions
 * - Provide default values for optional fields
 *
 * Pattern Source: setup-wizard.service.ts:1833-1866
 * Extracted from: SetupWizardService.mapToAgentProjectContext()
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type { FrontendProjectContext } from '../../types/wizard.types';
import type { AgentProjectContext } from '../../types/core.types';

/**
 * Service responsible for transforming frontend-sent ProjectContext to backend AgentProjectContext.
 *
 * The frontend sends a simplified ProjectContext (strings, partial data) which needs to be
 * transformed to the full AgentProjectContext with proper enums and complete structure.
 *
 * This service handles:
 * - Type casting from frontend string types to backend enum types
 * - Providing sensible defaults for missing optional fields
 * - Handling null/undefined properties gracefully
 *
 * @injectable
 */
@injectable()
export class WizardContextMapperService {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {
    this.logger.debug('[WizardContextMapper] Service initialized');
  }

  /**
   * Map frontend ProjectContext to backend AgentProjectContext.
   *
   * Frontend sends simplified ProjectContext with string enums and partial data.
   * Backend requires full AgentProjectContext with proper types and complete structure.
   *
   * @param frontendContext - Simplified context from frontend wizard UI
   * @returns Complete AgentProjectContext for backend processing
   *
   * @example
   * ```typescript
   * const frontendContext = {
   *   rootPath: '/workspace',
   *   projectType: 'NodeJS',
   *   frameworks: ['NestJS']
   * };
   *
   * const backendContext = mapper.mapToAgentProjectContext(frontendContext);
   * // Returns: { rootPath: '/workspace', projectType: ProjectType.NodeJS, frameworks: [Framework.NestJS], ... }
   * ```
   */
  mapToAgentProjectContext(
    frontendContext: FrontendProjectContext
  ): AgentProjectContext {
    this.logger.debug(
      '[WizardContextMapper] Mapping frontend context to backend context',
      {
        frontendProjectType: frontendContext.projectType,
        hasFrameworks: !!frontendContext.frameworks?.length,
        hasMonorepoType: !!frontendContext.monorepoType,
      }
    );

    // Frontend sends simplified ProjectContext, map to full AgentProjectContext
    // Type assertions needed: frontend sends strings, backend expects enums
    const mappedContext: AgentProjectContext = {
      // Root path: prioritize rootPath over workspacePath (legacy field)
      rootPath: frontendContext.rootPath || frontendContext.workspacePath || '',

      // Cast string to ProjectType enum - frontend validates values match enum
      projectType:
        frontendContext.projectType as unknown as AgentProjectContext['projectType'],

      // Cast string array to Framework enum array
      frameworks: (frontendContext.frameworks ||
        []) as unknown as AgentProjectContext['frameworks'],

      // Cast string to MonorepoType enum (or undefined)
      monorepoType:
        frontendContext.monorepoType as unknown as AgentProjectContext['monorepoType'],

      // Frontend doesn't send full IndexedFile objects, use empty array
      relevantFiles: [] as AgentProjectContext['relevantFiles'],

      // Tech stack: provide defaults for missing fields
      techStack: {
        languages: frontendContext.techStack?.languages || [],
        frameworks: frontendContext.techStack?.frameworks || [],
        buildTools: frontendContext.techStack?.buildTools || [],
        testingFrameworks: frontendContext.techStack?.testingFrameworks || [],
        packageManager: frontendContext.techStack?.packageManager || 'npm',
      },

      // Code conventions: provide defaults for missing fields
      codeConventions: {
        indentation: frontendContext.codeConventions?.indentation ?? 'spaces',
        indentSize: frontendContext.codeConventions?.indentSize ?? 2,
        quoteStyle: frontendContext.codeConventions?.quoteStyle ?? 'single',
        semicolons: frontendContext.codeConventions?.semicolons ?? true,
        trailingComma: frontendContext.codeConventions?.trailingComma ?? 'es5',
      },
    };

    this.logger.debug(
      '[WizardContextMapper] Context mapping complete',
      {
        rootPath: mappedContext.rootPath,
        projectType: mappedContext.projectType,
        frameworkCount: mappedContext.frameworks.length,
        techStackLanguages: mappedContext.techStack.languages,
      }
    );

    return mappedContext;
  }
}
