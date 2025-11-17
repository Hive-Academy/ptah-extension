/**
 * Analyze Workspace Tool
 *
 * Provides workspace analysis capabilities to language models, including:
 * - Project type detection (React, Angular, NestJS, etc.)
 * - Framework detection
 * - Monorepo structure analysis
 * - Architecture patterns
 */

import * as vscode from 'vscode';
import { inject, injectable } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { WorkspaceAnalyzerService } from '@ptah-extension/workspace-intelligence';
import { IAnalyzeWorkspaceParameters } from '../types/tool-parameters';

@injectable()
export class AnalyzeWorkspaceTool
  implements vscode.LanguageModelTool<IAnalyzeWorkspaceParameters>
{
  constructor(
    @inject(TOKENS.WORKSPACE_ANALYZER_SERVICE)
    private readonly workspaceAnalyzer: WorkspaceAnalyzerService
  ) {}

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IAnalyzeWorkspaceParameters>
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage:
        'Analyzing workspace structure and project configuration...',
      confirmationMessages: {
        title: 'Analyze Workspace',
        message: new vscode.MarkdownString(
          'Analyze the workspace to detect project type, frameworks, and architecture patterns?'
        ),
      },
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IAnalyzeWorkspaceParameters>
  ): Promise<vscode.LanguageModelToolResult> {
    try {
      const workspaceInfo =
        await this.workspaceAnalyzer.getCurrentWorkspaceInfo();
      const structure =
        await this.workspaceAnalyzer.analyzeWorkspaceStructure();
      const projectInfo = await this.workspaceAnalyzer.getProjectInfo();
      const contextRecs =
        await this.workspaceAnalyzer.getContextRecommendations();

      if (!workspaceInfo || !structure) {
        throw new Error('No workspace folder open');
      }

      // Format as LLM-friendly response
      const result = {
        name: workspaceInfo.name,
        path: workspaceInfo.path,
        projectType: workspaceInfo.projectType,
        frameworks: workspaceInfo.frameworks || [],
        hasPackageJson: workspaceInfo.hasPackageJson,
        hasTsConfig: workspaceInfo.hasTsConfig,
        dependencies: projectInfo.dependencies,
        devDependencies: projectInfo.devDependencies,
        contextRecommendations: {
          recommended: contextRecs.recommendedFiles,
          critical: contextRecs.criticalFiles,
          frameworkSpecific: contextRecs.frameworkSpecific,
        },
      };

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `Workspace Analysis:\n\n${JSON.stringify(result, null, 2)}`
        ),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(
        `Failed to analyze workspace: ${message}. Ensure a workspace folder is open in VS Code.`
      );
    }
  }
}
