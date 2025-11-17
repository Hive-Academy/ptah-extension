/**
 * Search Files Tool
 *
 * Provides intelligent file search capabilities with relevance scoring
 */

import * as vscode from 'vscode';
import { inject, injectable } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { CorrelationId } from '@ptah-extension/shared';
import { ContextOrchestrationService } from '@ptah-extension/workspace-intelligence';
import { ISearchFilesParameters } from '../types/tool-parameters';

@injectable()
export class SearchFilesTool
  implements vscode.LanguageModelTool<ISearchFilesParameters>
{
  constructor(
    @inject(TOKENS.CONTEXT_ORCHESTRATION_SERVICE)
    private readonly contextOrchestration: ContextOrchestrationService
  ) {}

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ISearchFilesParameters>
  ): Promise<vscode.PreparedToolInvocation> {
    const { query, includeImages, maxResults } = options.input;

    return {
      invocationMessage: `Searching for files matching "${query}"...`,
      confirmationMessages: {
        title: 'Search Files',
        message: new vscode.MarkdownString(
          `Search for files matching **"${query}"**?` +
            (includeImages ? '\n\n- Include images' : '') +
            (maxResults ? `\n- Max results: ${maxResults}` : '')
        ),
      },
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ISearchFilesParameters>
  ): Promise<vscode.LanguageModelToolResult> {
    try {
      const { query, includeImages = false, maxResults = 20 } = options.input;

      const result = await this.contextOrchestration.searchFiles({
        requestId: `search-${Date.now()}` as CorrelationId,
        query,
        includeImages,
        maxResults,
      });

      if (!result.success || !result.results || result.results.length === 0) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `No files found matching "${query}". Try:\n` +
              `- Using different search terms\n` +
              `- Checking file extensions\n` +
              `- Using wildcards (*.ts, *.json)`
          ),
        ]);
      }

      const fileList = result.results
        .map(
          (file: { relativePath: string; fileType: string }) =>
            `- ${file.relativePath} (${file.fileType})`
        )
        .join('\n');

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `Found ${result.results.length} files:\n\n${fileList}`
        ),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to search files: ${message}`);
    }
  }
}
