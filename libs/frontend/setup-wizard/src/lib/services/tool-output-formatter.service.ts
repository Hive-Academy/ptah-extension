import { Injectable } from '@angular/core';

/**
 * ToolOutputFormatterService
 *
 * Extracts and centralizes tool output formatting logic used by transcript components.
 * Handles MCP content extraction, system-reminder stripping, line number removal,
 * language detection from file paths, and tool-type-aware result formatting.
 *
 * Extracted from AnalysisTranscriptComponent to enable reuse across transcript
 * displays (analysis, generation, enhance) and to improve testability.
 */
@Injectable({
  providedIn: 'root',
})
export class ToolOutputFormatterService {
  /**
   * Language extension mapping for syntax highlighting detection.
   * Maps file extensions to language identifiers used by Prism/ngx-markdown.
   */
  private readonly languageMap: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'tsx',
    '.js': 'javascript',
    '.jsx': 'jsx',
    '.json': 'json',
    '.html': 'html',
    '.css': 'css',
    '.scss': 'scss',
    '.py': 'python',
    '.java': 'java',
    '.go': 'go',
    '.rs': 'rust',
    '.md': 'markdown',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.xml': 'xml',
    '.sql': 'sql',
    '.sh': 'bash',
    '.bash': 'bash',
    '.zsh': 'bash',
    '.kt': 'kotlin',
    '.swift': 'swift',
    '.rb': 'ruby',
    '.php': 'php',
    '.cs': 'csharp',
    '.cpp': 'cpp',
    '.dart': 'dart',
    '.vue': 'vue',
    '.svelte': 'svelte',
    '.graphql': 'graphql',
    '.prisma': 'prisma',
    '.toml': 'toml',
    '.dockerfile': 'dockerfile',
    '.tf': 'hcl',
  };

  /**
   * Regex to match ptah.namespace.method() API calls in tool input content.
   * Captures the full qualified call like `ptah.workspace.analyze()`.
   */
  private readonly ptahApiCallPattern = /ptah\.\w+\.\w+\([^)]*\)/;

  /**
   * Format tool input content as markdown with language detection.
   * Attempts to parse JSON to detect file paths for syntax highlighting,
   * falling back to generic code block rendering.
   *
   * @param content - The displayable content (possibly truncated)
   * @param rawJson - The full raw JSON content for parsing
   * @returns Markdown-formatted string with code blocks
   */
  public formatToolInput(content: string, rawJson: string): string {
    // Try to parse as JSON to detect file paths for language detection
    try {
      const parsed = JSON.parse(rawJson);
      if (parsed && typeof parsed === 'object') {
        // Check for file_path parameter to detect language
        const filePath = parsed.file_path || parsed.path || '';
        if (filePath) {
          const language = this.getLanguageFromPath(filePath);
          if (language) {
            // If there's a content/command field, wrap it with detected language
            const codeContent =
              parsed.content || parsed.command || parsed.pattern || '';
            if (codeContent) {
              return '```' + language + '\n' + codeContent + '\n```';
            }
          }
        }
        // Default: format entire JSON with syntax highlighting
        return '```json\n' + JSON.stringify(parsed, null, 2) + '\n```';
      }
    } catch {
      // Not JSON, fall through to generic wrapping
    }

    // Fallback: wrap in generic code block
    return '```\n' + content + '\n```';
  }

  /**
   * Format tool result content as markdown.
   * Applies a processing pipeline and routes based on tool type:
   * 1. Extract MCP content blocks
   * 2. Strip system-reminder tags
   * 3. Strip line number prefixes
   * 4. Auto-detect JSON and code
   *
   * For `execute_code` tools, applies MCP extraction and attempts language
   * detection from the tool input to provide syntax-highlighted output.
   *
   * @param content - Raw tool result content
   * @param toolName - Optional tool name for type-aware formatting
   * @param toolInput - Optional tool input content for language detection
   * @returns Markdown-formatted string
   */
  public formatToolResult(
    content: string,
    toolName?: string,
    toolInput?: string
  ): string {
    if (!content) return '_No output_';

    // Route based on tool type
    if (toolName === 'execute_code') {
      return this.formatExecuteCodeResult(content, toolInput);
    }

    // Default processing pipeline
    return this.formatDefaultResult(content);
  }

  /**
   * Extract text content from MCP-style content blocks.
   * Converts [{type: "text", text: "..."}] to "..."
   *
   * @param content - Raw content that may contain MCP JSON blocks
   * @returns Extracted text content, or original content if not MCP format
   */
  public extractMCPContent(content: string): string {
    const trimmed = content.trim();
    if (!trimmed.startsWith('[')) return content;

    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) return content;

      const isMCPContent = parsed.every(
        (item: unknown) =>
          typeof item === 'object' &&
          item !== null &&
          'type' in item &&
          (item as { type: string }).type === 'text' &&
          'text' in item
      );

      if (isMCPContent) {
        return parsed
          .map((item: { type: string; text: string }) => item.text)
          .join('\n');
      }

      return content;
    } catch {
      return content;
    }
  }

  /**
   * Strip <system-reminder>...</system-reminder> tags from content.
   *
   * @param content - Content potentially containing system-reminder tags
   * @returns Content with system-reminder blocks removed
   */
  public stripSystemReminders(content: string): string {
    return content
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
      .trim();
  }

  /**
   * Strip line number prefixes from Read tool output.
   * Converts "     1->import { Module }" to "import { Module }"
   *
   * @param content - Content with potential line number prefixes
   * @returns Content with line numbers stripped
   */
  public stripLineNumbers(content: string): string {
    return content
      .split('\n')
      .map((line) => {
        const match = line.match(/^\s*\d+→(.*)$/);
        return match ? match[1] : line;
      })
      .join('\n');
  }

  /**
   * Unescape JavaScript string literals (convert \\n to actual newlines, \\t to tabs, etc.).
   * This handles cases where content contains literal escape sequences like "\n" instead of actual newlines.
   *
   * @param content - Content potentially containing escaped sequences
   * @returns Content with escape sequences converted to actual characters
   */
  private unescapeStringLiterals(content: string): string {
    return content
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, '\\');
  }

  /**
   * Get language identifier from a file path extension.
   * Normalizes path separators and extracts the extension for lookup.
   *
   * @param filePath - File path (may use forward or backslashes)
   * @returns Language identifier string, or empty string for unknown extensions
   */
  public getLanguageFromPath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    const ext = '.' + normalized.split('.').pop()?.toLowerCase();
    return this.languageMap[ext] || '';
  }

  /**
   * Get a human-readable label for a tool group.
   * Attempts to extract a ptah API call pattern from the tool input content,
   * falling back to the raw tool name.
   *
   * @param toolName - The tool name (e.g., 'execute_code')
   * @param toolInputContent - Optional raw tool input content to parse for API calls
   * @returns Display label (e.g., 'ptah.workspace.analyze()' or 'execute_code')
   */
  public getToolGroupLabel(toolName: string, toolInputContent?: string): string {
    if (toolInputContent) {
      const match = toolInputContent.match(this.ptahApiCallPattern);
      if (match) {
        return match[0];
      }
    }
    return toolName;
  }

  /**
   * Format text content for markdown rendering.
   * Applies minimal processing: unescape string literals and ensure proper markdown formatting.
   *
   * @param content - Raw text content from the stream
   * @returns Markdown-formatted string
   */
  public formatTextContent(content: string): string {
    if (!content) return '';

    const processed = this.unescapeStringLiterals(content);

    // If the content looks like it's already in a code block format, preserve it
    if (processed.trim().startsWith('```')) {
      return processed;
    }

    return processed;
  }

  /**
   * Format execute_code tool result with MCP extraction and language detection.
   * Attempts to determine syntax highlighting language from tool input.
   */
  private formatExecuteCodeResult(content: string, toolInput?: string): string {
    // Apply MCP extraction first
    let processed = this.extractMCPContent(content);
    processed = this.stripSystemReminders(processed);
    processed = this.stripLineNumbers(processed);
    processed = this.unescapeStringLiterals(processed);

    // Try to detect language from tool input (e.g., ptah.files.readFile('path.ts'))
    const language = this.detectLanguageFromToolInput(toolInput);

    // JSON auto-detect
    if (processed.trim().startsWith('{') || processed.trim().startsWith('[')) {
      try {
        JSON.parse(processed);
        return '```json\n' + processed + '\n```';
      } catch {
        // Not valid JSON
      }
    }

    // If we detected a language, wrap with it
    if (language) {
      return '```' + language + '\n' + processed + '\n```';
    }

    // Code detection heuristic
    if (
      processed.includes('\n') &&
      (processed.includes('{') ||
        processed.includes('import ') ||
        processed.includes('const '))
    ) {
      return '```\n' + processed + '\n```';
    }

    // Otherwise render as markdown
    return processed;
  }

  /**
   * Default formatting pipeline for non-execute_code tool results.
   */
  private formatDefaultResult(content: string): string {
    let processed = this.extractMCPContent(content);
    processed = this.stripSystemReminders(processed);
    processed = this.stripLineNumbers(processed);
    processed = this.unescapeStringLiterals(processed);

    // JSON auto-detect
    if (processed.trim().startsWith('{') || processed.trim().startsWith('[')) {
      try {
        JSON.parse(processed);
        return '```json\n' + processed + '\n```';
      } catch {
        // Not valid JSON
      }
    }

    // Code detection heuristic
    if (
      processed.includes('\n') &&
      (processed.includes('{') ||
        processed.includes('import ') ||
        processed.includes('const '))
    ) {
      return '```\n' + processed + '\n```';
    }

    // Otherwise render as markdown
    return processed;
  }

  /**
   * Detect syntax highlighting language from tool input content.
   * Parses ptah.files.readFile('path.ts') patterns to extract file extension.
   *
   * @param toolInput - Raw tool input content
   * @returns Detected language identifier, or empty string
   */
  private detectLanguageFromToolInput(toolInput?: string): string {
    if (!toolInput) return '';

    // Match ptah.files.readFile('some/path.ext') or similar patterns
    const readFileMatch = toolInput.match(
      /ptah\.files\.readFile\s*\(\s*['"]([^'"]+)['"]/
    );
    if (readFileMatch) {
      return this.getLanguageFromPath(readFileMatch[1]);
    }

    // Match generic file path arguments in ptah API calls
    const filePathMatch = toolInput.match(/['"]([^'"]+\.\w{1,10})['"]/);
    if (filePathMatch) {
      return this.getLanguageFromPath(filePathMatch[1]);
    }

    return '';
  }
}
