/**
 * Get Relevant Files Tool
 *
 * Suggests relevant files based on task context using AI-powered relevance scoring
 */

import * as vscode from 'vscode';
import { inject, injectable } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { CorrelationId } from '@ptah-extension/shared';
import { ContextOrchestrationService } from '@ptah-extension/workspace-intelligence';
import { IGetRelevantFilesParameters } from '../types/tool-parameters';

@injectable()
export class GetRelevantFilesTool
  implements vscode.LanguageModelTool<IGetRelevantFilesParameters>
{
  constructor(
    @inject(TOKENS.CONTEXT_ORCHESTRATION_SERVICE)
    private readonly contextOrchestration: ContextOrchestrationService
  ) {}

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IGetRelevantFilesParameters>
  ): Promise<vscode.PreparedToolInvocation> {
    const { taskDescription } = options.input;

    return {
      invocationMessage: 'Finding relevant files for the task...',
      confirmationMessages: {
        title: 'Get Relevant Files',
        message: new vscode.MarkdownString(
          `Find files relevant to:\n\n> ${taskDescription}`
        ),
      },
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IGetRelevantFilesParameters>
  ): Promise<vscode.LanguageModelToolResult> {
    try {
      const { taskDescription } = options.input;

      const result = await this.contextOrchestration.getFileSuggestions({
        requestId: `suggestions-${Date.now()}` as CorrelationId,
        query: taskDescription,
        limit: 10,
      });

      if (
        !result.success ||
        !result.suggestions ||
        result.suggestions.length === 0
      ) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `No relevant files found for task: "${taskDescription}". ` +
              `This might be a new feature or the task description needs more specific details.`
          ),
        ]);
      }

      const suggestionList = result.suggestions
        .map(
          (file: { relativePath: string; fileType: string; size: number }) =>
            `- **${file.relativePath}** (${file.fileType})\n` +
            `  Size: ${file.size} bytes`
        )
        .join('\n');
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `Relevant files for "${taskDescription}":\n\n${suggestionList}`
        ),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get relevant files: ${message}`);
    }
  }
}
