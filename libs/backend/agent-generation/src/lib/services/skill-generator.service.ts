/**
 * Skill Generator Service
 *
 * Generates orchestration skills with project-specific customizations.
 * Creates SKILL.md and reference files tailored to the workspace context.
 *
 * @module @ptah-extension/agent-generation/services
 */

import { injectable, inject } from 'tsyringe';
import * as vscode from 'vscode';
import { Result } from '@ptah-extension/shared';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import {
  ISkillGeneratorService,
  SkillGenerationOptions,
  SkillGenerationResult,
} from '../interfaces/skill-generator.interface';
import { AgentProjectContext } from '../types/core.types';

/**
 * Template variable definitions for skill generation.
 */
interface TemplateVariables {
  PROJECT_TYPE: string;
  PROJECT_PATH: string;
  PROJECT_NAME: string;
  MONOREPO_CONFIG: string;
  AGENTS_LIST: string;
  BRANCH_PREFIX: string;
  FRAMEWORKS: string;
  LANGUAGES: string;
  BUILD_TOOLS: string;
  PACKAGE_MANAGER: string;
}

/**
 * Paths for generated skill files.
 */
const SKILL_FILE_PATHS = {
  SKILL_MD: '.claude/skills/orchestration/SKILL.md',
  AGENT_CATALOG: '.claude/skills/orchestration/references/agent-catalog.md',
  STRATEGIES: '.claude/skills/orchestration/references/strategies.md',
  TEAM_LEADER_MODES:
    '.claude/skills/orchestration/references/team-leader-modes.md',
  TASK_TRACKING: '.claude/skills/orchestration/references/task-tracking.md',
  CHECKPOINTS: '.claude/skills/orchestration/references/checkpoints.md',
  GIT_STANDARDS: '.claude/skills/orchestration/references/git-standards.md',
} as const;

/**
 * Template paths relative to the extension's template directory.
 */
const TEMPLATE_PATHS = {
  SKILL_MD: 'skills/orchestration/SKILL.template.md',
  AGENT_CATALOG: 'skills/orchestration/references/agent-catalog.template.md',
  STRATEGIES: 'skills/orchestration/references/strategies.template.md',
  TEAM_LEADER_MODES:
    'skills/orchestration/references/team-leader-modes.template.md',
  TASK_TRACKING: 'skills/orchestration/references/task-tracking.template.md',
  CHECKPOINTS: 'skills/orchestration/references/checkpoints.template.md',
  GIT_STANDARDS: 'skills/orchestration/references/git-standards.template.md',
} as const;

/**
 * Service for generating orchestration skills with project customization.
 *
 * Implements the complete skill generation workflow:
 * 1. Load templates from extension assets
 * 2. Build template variables from project context
 * 3. Substitute variables in templates
 * 4. Create directory structure
 * 5. Write generated files
 *
 * @example
 * ```typescript
 * const result = await skillGenerator.generateOrchestrationSkill({
 *   workspaceUri: vscode.workspace.workspaceFolders![0].uri,
 *   projectContext: context,
 *   selectedAgents: ['backend-developer', 'frontend-developer'],
 *   overwriteExisting: false
 * });
 * ```
 */
@injectable()
export class SkillGeneratorService implements ISkillGeneratorService {
  private readonly extensionUri: vscode.Uri;

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {
    // Get extension URI for template loading
    const extension = vscode.extensions.getExtension(
      'ptah-extension.ptah-extension-vscode'
    );
    if (extension) {
      this.extensionUri = extension.extensionUri;
    } else {
      // Fallback for development/testing - use workspace folder
      this.extensionUri =
        vscode.workspace.workspaceFolders?.[0]?.uri ||
        vscode.Uri.file(process.cwd());
    }
  }

  /**
   * Generate the complete orchestration skill structure.
   */
  async generateOrchestrationSkill(
    options: SkillGenerationOptions
  ): Promise<Result<SkillGenerationResult, Error>> {
    const { workspaceUri, projectContext, selectedAgents, overwriteExisting } =
      options;

    this.logger.info('Starting skill generation', {
      workspacePath: workspaceUri.fsPath,
      selectedAgentCount: selectedAgents.length,
      overwriteExisting,
    });

    const result: SkillGenerationResult = {
      filesCreated: [],
      filesSkipped: [],
      customizations: new Map(),
    };

    try {
      // Build template variables from project context
      const variables = this.buildTemplateVariables(
        projectContext,
        selectedAgents,
        workspaceUri
      );

      // Create directory structure
      await this.ensureDirectoryStructure(workspaceUri);

      // Generate SKILL.md
      const skillResult = await this.generateFile(
        workspaceUri,
        TEMPLATE_PATHS.SKILL_MD,
        SKILL_FILE_PATHS.SKILL_MD,
        variables,
        overwriteExisting
      );
      this.processFileResult(skillResult, SKILL_FILE_PATHS.SKILL_MD, result);

      // Generate reference files
      const referenceFiles = [
        {
          template: TEMPLATE_PATHS.AGENT_CATALOG,
          target: SKILL_FILE_PATHS.AGENT_CATALOG,
        },
        {
          template: TEMPLATE_PATHS.STRATEGIES,
          target: SKILL_FILE_PATHS.STRATEGIES,
        },
        {
          template: TEMPLATE_PATHS.TEAM_LEADER_MODES,
          target: SKILL_FILE_PATHS.TEAM_LEADER_MODES,
        },
        {
          template: TEMPLATE_PATHS.TASK_TRACKING,
          target: SKILL_FILE_PATHS.TASK_TRACKING,
        },
        {
          template: TEMPLATE_PATHS.CHECKPOINTS,
          target: SKILL_FILE_PATHS.CHECKPOINTS,
        },
        {
          template: TEMPLATE_PATHS.GIT_STANDARDS,
          target: SKILL_FILE_PATHS.GIT_STANDARDS,
        },
      ];

      for (const { template, target } of referenceFiles) {
        const fileResult = await this.generateFile(
          workspaceUri,
          template,
          target,
          variables,
          overwriteExisting
        );
        this.processFileResult(fileResult, target, result);
      }

      this.logger.info('Skill generation complete', {
        filesCreated: result.filesCreated.length,
        filesSkipped: result.filesSkipped.length,
      });

      return Result.ok(result);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error('Skill generation failed', { error: errorMessage });
      return Result.err(
        new Error(`Failed to generate orchestration skill: ${errorMessage}`)
      );
    }
  }

  /**
   * Check if orchestration skill already exists in the workspace.
   */
  async skillExists(workspaceUri: vscode.Uri): Promise<boolean> {
    const skillPath = vscode.Uri.joinPath(
      workspaceUri,
      SKILL_FILE_PATHS.SKILL_MD
    );
    try {
      await vscode.workspace.fs.stat(skillPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the list of files that would be generated.
   */
  getGeneratedFilePaths(): string[] {
    return Object.values(SKILL_FILE_PATHS);
  }

  /**
   * Build template variables from project context.
   */
  private buildTemplateVariables(
    context: AgentProjectContext,
    selectedAgents: string[],
    workspaceUri: vscode.Uri
  ): TemplateVariables {
    const projectName = workspaceUri.fsPath.split(/[/\\]/).pop() || 'project';

    // Build monorepo configuration text
    let monorepoConfig = '';
    if (context.monorepoType) {
      monorepoConfig = `This is a ${context.monorepoType} monorepo. Use appropriate commands and paths for monorepo structure.`;
    }

    // Build agents list
    const agentsList = selectedAgents
      .map((agent) => `- ${agent}`)
      .join('\n');

    // Determine branch prefix based on project type
    const branchPrefix = this.determineBranchPrefix(context);

    return {
      PROJECT_TYPE: String(context.projectType),
      PROJECT_PATH: workspaceUri.fsPath.replace(/\\/g, '\\\\'),
      PROJECT_NAME: projectName,
      MONOREPO_CONFIG: monorepoConfig,
      AGENTS_LIST: agentsList || '- No agents selected',
      BRANCH_PREFIX: branchPrefix,
      FRAMEWORKS: context.techStack.frameworks.join(', ') || 'None detected',
      LANGUAGES: context.techStack.languages.join(', ') || 'None detected',
      BUILD_TOOLS: context.techStack.buildTools.join(', ') || 'None detected',
      PACKAGE_MANAGER: context.techStack.packageManager || 'npm',
    };
  }

  /**
   * Determine the git branch prefix convention based on project context.
   */
  private determineBranchPrefix(context: AgentProjectContext): string {
    // Default prefixes based on common conventions
    if (context.monorepoType) {
      return 'feature/TASK_';
    }
    return 'feature/';
  }

  /**
   * Ensure the skill directory structure exists.
   */
  private async ensureDirectoryStructure(
    workspaceUri: vscode.Uri
  ): Promise<void> {
    const directories = [
      '.claude',
      '.claude/skills',
      '.claude/skills/orchestration',
      '.claude/skills/orchestration/references',
    ];

    for (const dir of directories) {
      const dirUri = vscode.Uri.joinPath(workspaceUri, dir);
      try {
        await vscode.workspace.fs.stat(dirUri);
      } catch {
        await vscode.workspace.fs.createDirectory(dirUri);
        this.logger.debug('Created directory', { path: dir });
      }
    }
  }

  /**
   * Generate a single file from template.
   */
  private async generateFile(
    workspaceUri: vscode.Uri,
    templatePath: string,
    targetPath: string,
    variables: TemplateVariables,
    overwriteExisting: boolean
  ): Promise<
    | { status: 'created'; customizations: string[] }
    | { status: 'skipped' }
    | { status: 'error'; error: string }
  > {
    const targetUri = vscode.Uri.joinPath(workspaceUri, targetPath);

    // Check if file exists and skip if not overwriting
    if (!overwriteExisting) {
      try {
        await vscode.workspace.fs.stat(targetUri);
        this.logger.debug('Skipping existing file', { path: targetPath });
        return { status: 'skipped' };
      } catch {
        // File doesn't exist, proceed with creation
      }
    }

    try {
      // Load template content
      const templateContent = await this.loadTemplate(templatePath);

      // Substitute variables
      const { content, customizations } = this.substituteVariables(
        templateContent,
        variables
      );

      // Write file
      await vscode.workspace.fs.writeFile(
        targetUri,
        Buffer.from(content, 'utf8')
      );

      this.logger.debug('Generated file', {
        path: targetPath,
        customizationCount: customizations.length,
      });

      return { status: 'created', customizations };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to generate file', {
        path: targetPath,
        error: errorMessage,
      });
      return { status: 'error', error: errorMessage };
    }
  }

  /**
   * Load template content from extension assets.
   */
  private async loadTemplate(templatePath: string): Promise<string> {
    // Try loading from extension's template directory
    const templateUri = vscode.Uri.joinPath(
      this.extensionUri,
      'libs/backend/agent-generation/templates',
      templatePath
    );

    try {
      const content = await vscode.workspace.fs.readFile(templateUri);
      this.logger.debug('Template loaded from extension path', {
        path: templateUri.fsPath,
      });
      return Buffer.from(content).toString('utf8');
    } catch (extensionError) {
      // Log warning about fallback
      this.logger.warn('Extension template path failed, using workspace fallback', {
        attemptedPath: templateUri.fsPath,
        error: extensionError instanceof Error ? extensionError.message : String(extensionError),
      });

      // Fallback: Try loading from workspace's templates (for development)
      const workspaceTemplateUri = vscode.Uri.joinPath(
        vscode.workspace.workspaceFolders?.[0]?.uri ||
          vscode.Uri.file(process.cwd()),
        'libs/backend/agent-generation/templates',
        templatePath
      );

      try {
        const content = await vscode.workspace.fs.readFile(workspaceTemplateUri);
        this.logger.warn('Template loaded from WORKSPACE FALLBACK path', {
          path: workspaceTemplateUri.fsPath,
          note: 'This may indicate extension deployment issue in production',
        });
        return Buffer.from(content).toString('utf8');
      } catch (fallbackError) {
        this.logger.error('Template loading failed completely', {
          extensionPath: templateUri.fsPath,
          workspacePath: workspaceTemplateUri.fsPath,
        });
        throw new Error(
          `Failed to load template: ${templatePath}. Tried ${templateUri.fsPath} and ${workspaceTemplateUri.fsPath}`
        );
      }
    }
  }

  /**
   * Escape special characters in a value to prevent regex/template injection.
   * Prevents recursive substitution when values contain {{...}} patterns.
   */
  private escapeTemplateValue(value: string): string {
    // Escape backslashes first (before adding more)
    // Then escape $ (special in replace())
    // Then escape curly braces to prevent template pattern matching
    return value
      .replace(/\\/g, '\\\\')
      .replace(/\$/g, '$$$$') // $$ becomes $ in replace()
      .replace(/\{\{/g, '\\{\\{')
      .replace(/\}\}/g, '\\}\\}');
  }

  /**
   * Substitute template variables in content.
   */
  private substituteVariables(
    content: string,
    variables: TemplateVariables
  ): { content: string; customizations: string[] } {
    const customizations: string[] = [];
    let processed = content;

    // Substitute each variable with escaped value
    for (const [key, value] of Object.entries(variables)) {
      const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      const matches = processed.match(pattern);

      if (matches && matches.length > 0) {
        // Escape the value to prevent recursive substitution and regex issues
        const escapedValue = this.escapeTemplateValue(value);
        processed = processed.replace(pattern, escapedValue);
        customizations.push(`Substituted {{${key}}} with project-specific value`);
      }
    }

    // Log any remaining unsubstituted variables (for debugging)
    const remainingVars = processed.match(/\{\{[A-Z_]+\}\}/g);
    if (remainingVars && remainingVars.length > 0) {
      this.logger.warn('Unsubstituted template variables found', {
        variables: remainingVars,
      });
    }

    return { content: processed, customizations };
  }

  /**
   * Process file generation result and update the summary.
   */
  private processFileResult(
    fileResult:
      | { status: 'created'; customizations: string[] }
      | { status: 'skipped' }
      | { status: 'error'; error: string },
    targetPath: string,
    result: SkillGenerationResult
  ): void {
    if (fileResult.status === 'created') {
      result.filesCreated.push(targetPath);
      result.customizations.set(targetPath, fileResult.customizations);
    } else if (fileResult.status === 'skipped') {
      result.filesSkipped.push(targetPath);
    }
    // Errors are logged but don't stop the overall process
  }
}
