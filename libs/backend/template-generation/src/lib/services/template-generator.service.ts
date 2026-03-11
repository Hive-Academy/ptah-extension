import { injectable, inject } from 'tsyringe';
import { Result } from '@ptah-extension/shared';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { WorkspaceAnalyzerService } from '@ptah-extension/workspace-intelligence';
import {
  ITemplateOrchestrator,
  ProjectConfig,
  ProjectContext,
} from '../interfaces';
import { TemplateGenerationError } from '../errors';
import * as vscode from 'vscode';
import path from 'path';

/**
 * Template Generator Service
 * Main entry point for generating templates from project context
 * Adapted from roocode-generator MemoryBankService
 */
@injectable()
export class TemplateGeneratorService {
  constructor(
    @inject(TOKENS.TEMPLATE_ORCHESTRATOR)
    private readonly orchestrator: ITemplateOrchestrator,
    @inject(TOKENS.WORKSPACE_ANALYZER_SERVICE)
    private readonly workspaceAnalyzer: WorkspaceAnalyzerService,
    @inject(TOKENS.LOGGER) private readonly logger: Logger
  ) {}

  /**
   * Generates template files using the provided project context
   * @param config Optional project configuration for generation settings
   * @returns Result with success message or error
   */
  public async generateTemplates(
    config?: ProjectConfig
  ): Promise<Result<string, Error>> {
    try {
      // Get workspace root from VS Code API
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        const error = new TemplateGenerationError('No workspace folder open', {
          operation: 'getWorkspaceRoot',
        });
        this.logger.error(error.message, error);
        return Result.err(error);
      }

      // Build project configuration
      const projectConfig: ProjectConfig = config ?? {
        name: path.basename(workspaceRoot),
        description: 'Auto-generated template documentation',
        baseDir: workspaceRoot,
        templateGeneration: {
          outputDir: path.join(workspaceRoot, 'generated-templates'),
        },
      };

      this.logger.info('Starting template generation from project context...');

      // Get project information from workspace analyzer
      const projectInfo = await this.workspaceAnalyzer.getProjectInfo();

      // Build ProjectContext from project info
      const projectContext: ProjectContext = {
        projectName: projectInfo.name,
        projectDescription:
          projectInfo.description || projectConfig.description,
        techStack: [
          ...projectInfo.dependencies,
          ...projectInfo.devDependencies,
        ],
        fileStructure: projectInfo.fileStatistics,
        projectType: projectInfo.type,
        totalFiles: projectInfo.totalFiles,
        hasGitRepository: projectInfo.gitRepository,
        version: projectInfo.version,
      };

      // Orchestrate template generation
      const result = await this.orchestrator.orchestrateGeneration(
        projectContext,
        projectConfig
      );

      if (result.isErr()) {
        if (result.error) {
          this.logger.error(
            `Template generation failed: ${result.error.message}`,
            result.error
          );
          return Result.err(result.error);
        } else {
          const unknownError = new Error(
            'Unknown error during template generation'
          );
          this.logger.error(unknownError.message, unknownError);
          return Result.err(unknownError);
        }
      }

      this.logger.info('Template generation completed successfully.');
      return Result.ok('Templates generated successfully.');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Unexpected error during template generation', err);
      return Result.err(err);
    }
  }
}
