/**
 * Claude Message Transformer Service
 *
 * Pure message transformation logic with zero dependencies
 * Converts raw Claude CLI stream messages to UI-friendly format
 * Handles content extraction, tool visualization, and file path detection
 *
 * Migration Notes:
 * - Migrated from: apps/ptah-extension-webview/src/app/core/services/claude-message-transformer.service.ts
 * - Pure transformation logic - zero external dependencies
 * - Simplified HTML rendering (webview will handle actual rendering)
 * - Removed DOM manipulation (document.createElement) - use DOMParser in browser context
 * - All methods remain for backward compatibility
 */

import { Injectable } from '@angular/core';
import { MessageId, SessionId } from '@ptah-extension/shared';

/**
 * Simplified interfaces for transformer service
 * Full types are in @ptah-extension/shared but simplified here for standalone operation
 */

export interface ClaudeContent {
  type: string;
  text?: string;
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

export interface ClaudeStreamData {
  message: {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: readonly ClaudeContent[];
    model?: string;
    usage?: {
      input_tokens: number;
      output_tokens: number;
    };
  };
}

export interface ClaudeCliStreamMessage {
  data: ClaudeStreamData;
  timestamp: string | number;
  sessionId: SessionId;
  phase: 'stream' | 'complete';
}

export interface ProcessedClaudeMessage {
  id: MessageId;
  sessionId: SessionId;
  timestamp: number;
  type: 'user' | 'assistant' | 'system';
  content: readonly ClaudeContent[];
  model?: string;
  tokenUsage?: {
    input_tokens: number;
    output_tokens: number;
  };
  toolsUsed?: string[];
  isComplete?: boolean;
  isStreaming?: boolean;
  hasImages?: boolean;
  hasFiles?: boolean;
  filePaths?: string[];
  rawMessage?: ClaudeCliStreamMessage;
}

export interface ExtractedFileInfo {
  path: string;
  isImage: boolean;
  isClickable: boolean;
  type: 'file' | 'directory';
  extension: string;
}

export interface ToolUsageSummary {
  toolName: string;
  toolId: string;
  input: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  timestamp: number;
}

export interface ContentProcessingResult {
  renderedContent: string;
  extractedFiles: ExtractedFileInfo[];
  toolsUsed: ToolUsageSummary[];
  hasCodeBlocks: boolean;
  codeLanguages: string[];
  estimatedTokens: number;
}

/**
 * Claude Message Transformer Service
 *
 * Responsibilities:
 * - Transform raw Claude CLI messages to UI-friendly format
 * - Extract and process content (text, tools, files)
 * - Detect file paths and types
 * - Visualize tool usage
 * - Estimate token counts
 */
@Injectable({
  providedIn: 'root',
})
export class ClaudeMessageTransformerService {
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
      timestamp:
        typeof timestamp === 'number'
          ? timestamp
          : new Date(timestamp).getTime(),
      type:
        role === 'user'
          ? 'user'
          : role === 'assistant'
          ? 'assistant'
          : 'system',
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
      if (this.isTextContent(block)) {
        // Process text content
        const text = block.text || '';
        renderedContent += this.processTextContent(text);

        // Extract file paths from text
        const filePaths = this.extractFilePathsFromText(text);
        filePaths.forEach((path) => {
          extractedFiles.push(this.createFileInfo(path));
        });

        // Check for code blocks
        if (this.hasCodeBlocks(text)) {
          hasCodeBlocks = true;
          const languages = this.extractCodeLanguages(text);
          codeLanguages.push(...languages);
        }
      } else if (this.isToolUseContent(block)) {
        // Process tool use
        toolsUsed.push({
          toolName: block.name || 'unknown',
          toolId: block.id || '',
          input: block.input || {},
          timestamp: Date.now(),
        });

        // Add tool visualization to rendered content
        renderedContent += this.renderToolUse(block);
      } else if (this.isToolResultContent(block)) {
        // Process tool result
        const existingTool = toolsUsed.find(
          (tool) => tool.toolId === block.tool_use_id
        );
        if (existingTool) {
          // Update existing tool with result
          existingTool.result = block.content;
          existingTool.isError = block.is_error;
        }

        // Add tool result to rendered content
        renderedContent += this.renderToolResult(block);

        // Extract file paths from tool results
        const filePaths = this.extractFilePathsFromText(block.content || '');
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
      estimatedTokens: this.estimateTokenCount(renderedContent),
    };
  }

  /**
   * Detect file information from text
   */
  detectFileInfo(text: string): readonly ExtractedFileInfo[] {
    const filePaths = this.extractFilePathsFromText(text);
    return filePaths.map((path) => this.createFileInfo(path));
  }

  /**
   * Extract tool usage from content
   */
  extractToolUsage(
    content: readonly ClaudeContent[]
  ): readonly ToolUsageSummary[] {
    const toolUses = this.extractToolUses(content);
    const toolResults = this.extractToolResults(content);

    const toolSummaries: ToolUsageSummary[] = [];

    // Process tool uses
    toolUses.forEach((toolUse) => {
      const result = toolResults.find(
        (result) => result.tool_use_id === toolUse.id
      );

      toolSummaries.push({
        toolName: toolUse.name || 'unknown',
        toolId: toolUse.id || '',
        input: toolUse.input || {},
        result: result?.content,
        isError: result?.is_error,
        timestamp: Date.now(),
      });
    });

    return toolSummaries;
  }

  // Type guard helpers
  private isTextContent(
    block: ClaudeContent
  ): block is ClaudeContent & { text: string } {
    return block.type === 'text' && typeof block.text === 'string';
  }

  private isToolUseContent(block: ClaudeContent): boolean {
    return block.type === 'tool_use' && typeof block.name === 'string';
  }

  private isToolResultContent(block: ClaudeContent): boolean {
    return (
      block.type === 'tool_result' && typeof block.tool_use_id === 'string'
    );
  }

  // Content extraction helpers
  private extractToolUses(content: readonly ClaudeContent[]): ClaudeContent[] {
    return content.filter((block) => this.isToolUseContent(block));
  }

  private extractToolResults(
    content: readonly ClaudeContent[]
  ): ClaudeContent[] {
    return content.filter((block) => this.isToolResultContent(block));
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
    processed = processed.replace(
      /```(\w+)?\n([\s\S]*?)```/g,
      (match, language, code) => {
        const lang = language || 'text';
        const escapedCode = this.escapeHtml(code);
        return `<div class="code-block" data-language="${lang}">
        <div class="code-header">
          <span class="code-language">${lang}</span>
          <button class="copy-button">Copy</button>
        </div>
        <pre><code class="language-${lang}">${escapedCode}</code></pre>
      </div>`;
      }
    );

    // Inline code
    processed = processed.replace(
      /`([^`]+)`/g,
      '<code class="inline-code">$1</code>'
    );

    // Bold
    processed = processed.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic
    processed = processed.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    return processed;
  }

  private makeFilePathsClickable(text: string): string {
    const filePaths = this.extractFilePathsFromText(text);
    let processed = text;

    filePaths.forEach((path) => {
      const fileType = this.detectFileType(path);
      const fileIcon = this.getFileTypeIcon(fileType);
      const clickableLink = `<span class="file-path clickable" data-path="${path}">
        ${fileIcon} ${path}
      </span>`;

      // Only replace first occurrence to avoid nested replacements
      processed = processed.replace(path, clickableLink);
    });

    return processed;
  }

  private renderToolUse(toolUse: ClaudeContent): string {
    const toolName = toolUse.name || 'unknown';
    const toolIcon = this.getToolIcon(toolName);
    const inputDisplay = this.formatToolInput(toolUse.input || {});

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

  private renderToolResult(toolResult: ClaudeContent): string {
    const isError = toolResult.is_error || false;
    const statusClass = isError ? 'error' : 'success';
    const statusText = isError ? 'Error' : 'Completed';

    return `
      <div class="tool-result ${statusClass}" data-tool-id="${
      toolResult.tool_use_id
    }">
        <div class="tool-result-header">
          <span class="tool-status ${statusClass}">${statusText}</span>
        </div>
        <div class="tool-output">
          <pre><code>${this.escapeHtml(toolResult.content || '')}</code></pre>
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
            <span class="parameter-value">${this.formatParameterValue(
              value
            )}</span>
          </div>
        `
          )
          .join('')}
      </div>
    `;
  }

  private formatParameterValue(value: unknown): string {
    if (typeof value === 'string') {
      // Check if it's a file path
      if (this.extractFilePathsFromText(value).length > 0) {
        const fileType = this.detectFileType(value);
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
    const fileType = this.detectFileType(path);
    const lastDotIndex = path.lastIndexOf('.');
    const extension =
      lastDotIndex >= 0 ? path.substring(lastDotIndex).toLowerCase() : '';

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

    return matches
      .map((match) => match.replace('```', ''))
      .filter((lang) => lang.length > 0);
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

  /**
   * Escape HTML to prevent XSS
   * Uses safe string manipulation instead of DOM
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Extract file paths from text using regex
   */
  private extractFilePathsFromText(text: string): string[] {
    const filePaths: string[] = [];

    // Match common file path patterns
    // Unix/Linux paths: /path/to/file.ext
    const unixPaths = text.match(/\/[\w\-./]+\.\w+/g) || [];
    filePaths.push(...unixPaths);

    // Windows paths: C:\path\to\file.ext or \\server\path\to\file.ext
    const windowsPaths = text.match(/[A-Z]:\\[\w\-.\\]+\.\w+/g) || [];
    filePaths.push(...windowsPaths);

    // Relative paths: ./file.ext or ../file.ext
    const relativePaths = text.match(/\.\.?\/[\w\-./]+\.\w+/g) || [];
    filePaths.push(...relativePaths);

    // Remove duplicates
    return [...new Set(filePaths)];
  }

  /**
   * Detect file type from extension
   */
  private detectFileType(filePath: string): string {
    const imageExtensions = [
      '.png',
      '.jpg',
      '.jpeg',
      '.gif',
      '.svg',
      '.webp',
      '.bmp',
    ];
    const codeExtensions = [
      '.ts',
      '.js',
      '.tsx',
      '.jsx',
      '.py',
      '.java',
      '.c',
      '.cpp',
      '.cs',
      '.go',
      '.rs',
      '.php',
      '.rb',
      '.swift',
      '.kt',
    ];

    const extension = filePath
      .substring(filePath.lastIndexOf('.'))
      .toLowerCase();

    if (imageExtensions.includes(extension)) return 'image';
    if (codeExtensions.includes(extension)) return 'code';
    if (extension.length > 0) return 'text';
    return 'unknown';
  }

  /**
   * Estimate token count (rough estimation)
   * Claude uses ~4 characters per token on average
   */
  private estimateTokenCount(text: string): number {
    const charCount = text.length;
    return Math.ceil(charCount / 4);
  }
}

/**
 * Type guard functions exported for use in components
 * These allow components to safely narrow ClaudeContent types
 */
export function isTextContent(
  block: ClaudeContent
): block is ClaudeContent & { text: string } {
  return block.type === 'text' && typeof block.text === 'string';
}

export function isToolUseContent(
  block: ClaudeContent
): block is ClaudeContent & {
  name: string;
  id: string;
  input?: Record<string, unknown>;
} {
  return block.type === 'tool_use' && typeof block.name === 'string';
}

export function isToolResultContent(
  block: ClaudeContent
): block is ClaudeContent & {
  tool_use_id: string;
  content?: string;
  is_error?: boolean;
} {
  return block.type === 'tool_result' && typeof block.tool_use_id === 'string';
}

/**
 * Utility functions for file handling
 */
export function extractFilePathsFromText(text: string): string[] {
  const filePaths: string[] = [];

  // Match common file path patterns
  // Unix/Linux paths: /path/to/file.ext
  const unixPaths = text.match(/\/[\w\-./]+\.\w+/g) || [];
  filePaths.push(...unixPaths);

  // Windows paths: C:\path\to\file.ext or \\server\path\to\file.ext
  const windowsPaths = text.match(/[A-Z]:\\[\w\-.\\]+\.\w+/g) || [];
  filePaths.push(...windowsPaths);

  // Relative paths: ./file.ext or ../file.ext
  const relativePaths = text.match(/\.\.?\/[\w\-./]+\.\w+/g) || [];
  filePaths.push(...relativePaths);

  // Remove duplicates
  return [...new Set(filePaths)];
}

export function detectFileType(filePath: string): string {
  const imageExtensions = [
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.svg',
    '.webp',
    '.bmp',
  ];
  const codeExtensions = [
    '.ts',
    '.js',
    '.tsx',
    '.jsx',
    '.py',
    '.java',
    '.c',
    '.cpp',
    '.cs',
    '.go',
    '.rs',
    '.php',
    '.rb',
    '.swift',
    '.kt',
  ];

  const extension = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();

  if (imageExtensions.includes(extension)) return 'image';
  if (codeExtensions.includes(extension)) return 'code';
  if (extension.length > 0) return 'text';
  return 'unknown';
}
