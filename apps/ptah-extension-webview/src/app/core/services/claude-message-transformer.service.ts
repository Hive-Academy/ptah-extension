/**
 * Claude Message Transformer Service
 * Converts raw Claude CLI stream messages to UI-friendly format
 * Handles content extraction, tool visualization, and file path detection
 */

import { Injectable } from '@angular/core';
import {
  ClaudeCliStreamMessage,
  ClaudeContent,
  ClaudeStreamData,
  ProcessedClaudeMessage,
  ContentProcessingResult,
  ToolUsageSummary,
  ExtractedFileInfo,
  ClaudeMessageTransformer,
  isTextContent,
  isToolUseContent,
  isToolResultContent,
  extractTextContent,
  extractToolUses,
  extractToolResults,
  extractFilePathsFromText,
  detectFileType,
  estimateTokenCount,
  CLAUDE_TOOL_TYPES,
} from '@ptah-extension/shared';
import { MessageId, SessionId } from '@ptah-extension/shared';

@Injectable({
  providedIn: 'root',
})
export class ClaudeMessageTransformerService implements ClaudeMessageTransformer {
  /**
   * Transform raw Claude CLI stream message to UI-friendly format
   */
  transform(cliMessage: ClaudeCliStreamMessage): ProcessedClaudeMessage {
    const { data, timestamp, sessionId, phase } = cliMessage;
    const { message } = data;

    // Extract basic information
    const messageId = message.id as MessageId;
    const role = message.role;
    const content = message.content;
    const model = message.model;
    const tokenUsage = message.usage;

    // Process content
    const contentProcessing = this.extractContent(content);
    const toolsUsed = contentProcessing.toolsUsed.map((tool) => tool.toolName);

    // Determine streaming status
    const isStreaming = phase === 'stream';
    const isComplete = phase === 'complete' || !isStreaming;

    return {
      id: messageId,
      sessionId,
      timestamp: new Date(timestamp).getTime(),
      role: role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : 'system',
      content,
      model,
      tokenUsage,
      toolsUsed,
      isComplete,
      isStreaming,
      hasImages: this.hasImageFiles(contentProcessing.extractedFiles),
      hasFiles: contentProcessing.extractedFiles.length > 0,
      filePaths: contentProcessing.extractedFiles.map((file) => file.path),
      rawMessage: cliMessage,
    };
  }

  /**
   * Extract and process content from Claude message
   */
  extractContent(content: readonly ClaudeContent[]): ContentProcessingResult {
    let renderedContent = '';
    const extractedFiles: ExtractedFileInfo[] = [];
    const toolsUsed: ToolUsageSummary[] = [];
    let hasCodeBlocks = false;
    const codeLanguages: string[] = [];

    for (const block of content) {
      if (isTextContent(block)) {
        // Process text content
        const text = block.text;
        renderedContent += this.processTextContent(text);

        // Extract file paths from text
        const filePaths = extractFilePathsFromText(text);
        filePaths.forEach((path) => {
          extractedFiles.push(this.createFileInfo(path));
        });

        // Check for code blocks
        if (this.hasCodeBlocks(text)) {
          hasCodeBlocks = true;
          const languages = this.extractCodeLanguages(text);
          codeLanguages.push(...languages);
        }
      } else if (isToolUseContent(block)) {
        // Process tool use
        toolsUsed.push({
          toolName: block.name,
          toolId: block.id,
          input: block.input,
          timestamp: Date.now(),
        });

        // Add tool visualization to rendered content
        renderedContent += this.renderToolUse(block);
      } else if (isToolResultContent(block)) {
        // Process tool result
        const existingTool = toolsUsed.find((tool) => tool.toolId === block.tool_use_id);
        if (existingTool) {
          // Update existing tool with result
          const updatedTool = {
            ...existingTool,
            result: block.content,
            isError: block.is_error,
          };
          const index = toolsUsed.indexOf(existingTool);
          toolsUsed[index] = updatedTool;
        }

        // Add tool result to rendered content
        renderedContent += this.renderToolResult(block);

        // Extract file paths from tool results
        const filePaths = extractFilePathsFromText(block.content);
        filePaths.forEach((path) => {
          extractedFiles.push(this.createFileInfo(path));
        });
      }
    }

    return {
      renderedContent: renderedContent.trim(),
      extractedFiles,
      toolsUsed,
      hasCodeBlocks,
      codeLanguages: [...new Set(codeLanguages)], // Remove duplicates
      estimatedTokens: estimateTokenCount(renderedContent),
    };
  }

  /**
   * Detect file information from text
   */
  detectFileInfo(text: string): readonly ExtractedFileInfo[] {
    const filePaths = extractFilePathsFromText(text);
    return filePaths.map((path) => this.createFileInfo(path));
  }

  /**
   * Extract tool usage from content
   */
  extractToolUsage(content: readonly ClaudeContent[]): readonly ToolUsageSummary[] {
    const toolUses = extractToolUses(content);
    const toolResults = extractToolResults(content);

    const toolSummaries: ToolUsageSummary[] = [];

    // Process tool uses
    toolUses.forEach((toolUse) => {
      const result = toolResults.find((result) => result.tool_use_id === toolUse.id);

      toolSummaries.push({
        toolName: toolUse.name,
        toolId: toolUse.id,
        input: toolUse.input,
        result: result?.content,
        isError: result?.is_error,
        timestamp: Date.now(),
      });
    });

    return toolSummaries;
  }

  /**
   * Private helper methods
   */

  private processTextContent(text: string): string {
    // Basic markdown processing - can be enhanced with full markdown parser
    let processed = text;

    // Handle basic markdown formatting
    processed = this.processMarkdown(processed);

    // Make file paths clickable
    processed = this.makeFilePathsClickable(processed);

    return processed + '\n\n';
  }

  private processMarkdown(text: string): string {
    // Basic markdown processing - this can be enhanced with a proper markdown parser
    let processed = text;

    // Code blocks
    processed = processed.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, language, code) => {
      const lang = language || 'text';
      return `<div class="code-block" data-language="${lang}">
        <div class="code-header">
          <span class="code-language">${lang}</span>
          <button class="copy-button" onclick="navigator.clipboard.writeText(\`${code.replace(/`/g, '\\`')}\`)">
            Copy
          </button>
        </div>
        <pre><code class="language-${lang}">${this.escapeHtml(code)}</code></pre>
      </div>`;
    });

    // Inline code
    processed = processed.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

    // Bold
    processed = processed.replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>');

    // Italic
    processed = processed.replace(/\*([^\*]+)\*/g, '<em>$1</em>');

    return processed;
  }

  private makeFilePathsClickable(text: string): string {
    const filePaths = extractFilePathsFromText(text);
    let processed = text;

    filePaths.forEach((path) => {
      const fileType = detectFileType(path);
      const fileIcon = this.getFileTypeIcon(fileType);
      const clickableLink = `<span class="file-path clickable" data-path="${path}" onclick="this.handleFileClick('${path}')">
        ${fileIcon} ${path}
      </span>`;

      processed = processed.replace(path, clickableLink);
    });

    return processed;
  }

  private renderToolUse(toolUse: any): string {
    const toolName = toolUse.name;
    const toolIcon = this.getToolIcon(toolName);
    const inputDisplay = this.formatToolInput(toolUse.input);

    return `
      <div class="tool-usage tool-use" data-tool="${toolName}" data-tool-id="${toolUse.id}">
        <div class="tool-header">
          ${toolIcon}
          <span class="tool-name">${toolName}</span>
          <span class="tool-status running">Running...</span>
        </div>
        <div class="tool-input">
          ${inputDisplay}
        </div>
      </div>
    `;
  }

  private renderToolResult(toolResult: any): string {
    const isError = toolResult.is_error;
    const statusClass = isError ? 'error' : 'success';
    const statusText = isError ? 'Error' : 'Completed';

    return `
      <div class="tool-result ${statusClass}" data-tool-id="${toolResult.tool_use_id}">
        <div class="tool-result-header">
          <span class="tool-status ${statusClass}">${statusText}</span>
        </div>
        <div class="tool-output">
          <pre><code>${this.escapeHtml(toolResult.content)}</code></pre>
        </div>
      </div>
    `;
  }

  private formatToolInput(input: Record<string, unknown>): string {
    const entries = Object.entries(input);
    if (entries.length === 0) return '<em>No parameters</em>';

    return `
      <div class="tool-parameters">
        ${entries
          .map(
            ([key, value]) => `
          <div class="parameter">
            <span class="parameter-name">${key}:</span>
            <span class="parameter-value">${this.formatParameterValue(value)}</span>
          </div>
        `,
          )
          .join('')}
      </div>
    `;
  }

  private formatParameterValue(value: unknown): string {
    if (typeof value === 'string') {
      // Check if it's a file path
      if (extractFilePathsFromText(value).length > 0) {
        const fileType = detectFileType(value);
        const icon = this.getFileTypeIcon(fileType);
        return `${icon} <code>${value}</code>`;
      }
      return `<code>${value}</code>`;
    }

    if (typeof value === 'object' && value !== null) {
      return `<code>${JSON.stringify(value, null, 2)}</code>`;
    }

    return `<code>${String(value)}</code>`;
  }

  private createFileInfo(path: string): ExtractedFileInfo {
    const fileType = detectFileType(path);
    const extension = path.toLowerCase().substring(path.lastIndexOf('.'));

    return {
      path,
      isImage: fileType === 'image',
      isClickable: true,
      type: 'file', // Could be enhanced to detect directories
      extension,
    };
  }

  private hasImageFiles(files: readonly ExtractedFileInfo[]): boolean {
    return files.some((file) => file.isImage);
  }

  private hasCodeBlocks(text: string): boolean {
    return /```[\s\S]*?```/.test(text);
  }

  private extractCodeLanguages(text: string): string[] {
    const matches = text.match(/```(\w+)/g);
    if (!matches) return [];

    return matches.map((match) => match.replace('```', '')).filter((lang) => lang.length > 0);
  }

  private getToolIcon(toolName: string): string {
    const iconMap: Record<string, string> = {
      Read: '📖',
      Write: '✏️',
      Edit: '📝',
      Glob: '🔍',
      Grep: '🔎',
      Bash: '💻',
      MultiEdit: '📝',
      WebFetch: '🌐',
      WebSearch: '🔍',
    };

    return iconMap[toolName] || '🔧';
  }

  private getFileTypeIcon(fileType: string): string {
    const iconMap: Record<string, string> = {
      image: '🖼️',
      code: '📄',
      text: '📃',
      unknown: '📎',
    };

    return iconMap[fileType] || '📎';
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Handle file click events
   */
  handleFileClick(filePath: string): void {
    // This will be called from the HTML - emit an event or use a service
    // For now, just log it - this can be enhanced to open files in VS Code
    console.log('File clicked:', filePath);

    // Could emit an event to open the file in VS Code
    // this.fileOpenService.openFile(filePath);
  }
}
