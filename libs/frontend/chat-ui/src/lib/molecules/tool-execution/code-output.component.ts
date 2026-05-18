import {
  Component,
  input,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { MarkdownModule } from 'ngx-markdown';
import {
  type ExecutionNode,
  isReadToolInput,
  isWriteToolInput,
  isEditToolInput,
} from '@ptah-extension/shared';

/**
 * CodeOutputComponent - Syntax-highlighted code output with content processing
 *
 * Complexity Level: 2 (Molecule with content processing pipeline)
 * Patterns: Content processing + markdown rendering
 *
 * Features:
 * - Process tool output (strip system reminders, line numbers, MCP format)
 * - Detect syntax highlighting language from file extension or tool type
 * - Wrap content in markdown code blocks
 * - Render with ngx-markdown
 *
 * Processing Pipeline:
 * 1. Extract MCP content: [{type: "text", text: "..."}] → "..."
 * 2. Strip <system-reminder> tags
 * 3. Strip Claude CLI line number prefixes (   N→content)
 * 4. Detect language from file extension or tool type
 * 5. Wrap in markdown code blocks for syntax highlighting
 */
@Component({
  selector: 'ptah-code-output',
  standalone: true,
  imports: [MarkdownModule],
  template: `
    <div
      class="bg-base-300/50 rounded max-h-48 overflow-y-auto overflow-x-auto"
    >
      <markdown
        [data]="formattedOutput()"
        class="tool-output-markdown prose prose-xs prose-invert max-w-none [&_pre]:my-0 [&_pre]:rounded-none [&_code]:text-[10px] [&_pre]:bg-transparent [&_p]:my-1 [&_p]:text-[10px]"
      />
    </div>
  `,
  styles: [
    `
      :host ::ng-deep .tool-output-markdown {
        pre {
          margin: 0;
          padding: 0.5rem;
          background: transparent !important;
        }
        code {
          font-size: 10px;
          line-height: 1.4;
        }
        p {
          margin: 0.25rem 0;
          font-size: 10px;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeOutputComponent {
  readonly node = input.required<ExecutionNode>();
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
  };

  /**
   * Computed formatted output
   */
  readonly formattedOutput = computed(() => {
    const node = this.node();
    if (!node) return '';

    const output = node.toolOutput;
    if (!output) return '';

    let str =
      typeof output === 'string' ? output : JSON.stringify(output, null, 2);
    str = this.extractMCPContent(str);
    str = this.stripSystemReminders(str);
    str = this.stripAnsiCodes(str);
    str = this.stripLineNumbers(str);

    const language = this.detectLanguage();
    if (language === 'markdown') return str;
    return '```' + language + '\n' + str + '\n```';
  });

  /**
   * Detect language from file extension or tool type
   */
  private detectLanguage(): string {
    const node = this.node();
    if (!node) return 'text';

    const toolName = node.toolName;
    const toolInput = node.toolInput;
    const output = node.toolOutput;
    let language = 'text';
    if (toolName?.startsWith('mcp__')) {
      return 'markdown';
    }
    if (
      isReadToolInput(toolInput) ||
      isWriteToolInput(toolInput) ||
      isEditToolInput(toolInput)
    ) {
      language = this.getLanguageFromPath(toolInput.file_path);
    } else if (toolName === 'Bash') {
      language = 'bash';
    } else if (toolName === 'Grep' || toolName === 'Glob') {
      language = 'text';
    }
    const str = typeof output === 'string' ? output : '';
    const trimmed = str.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'object') {
        language = 'json';
      }
    }

    return language;
  }

  /**
   * Strip ANSI escape codes (color/style sequences) from CLI output
   * CLI tools like nx output colored text with sequences like \x1b[32m
   * These render as garbled text in the webview if not stripped
   */
  private stripAnsiCodes(content: string): string {
    // eslint-disable-next-line no-control-regex
    return content.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  }

  /**
   * Strip <system-reminder> tags from content
   * Claude CLI adds these tags to tool results but they should not be displayed
   */
  private stripSystemReminders(content: string): string {
    return content
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
      .trim();
  }

  /**
   * Strip Claude CLI line number prefixes from Read tool output
   * Claude CLI formats Read output as "     N→content" where N is the line number
   * We strip these for cleaner display in the UI
   */
  private stripLineNumbers(content: string): string {
    return content
      .split('\n')
      .map((line) => {
        const match = line.match(/^\s*\d+→(.*)$/);
        return match ? match[1] : line;
      })
      .join('\n');
  }

  /**
   * Extract text content from MCP-style content blocks
   * MCP responses often come as: [{type: "text", text: "..."}]
   * This extracts just the text for cleaner display
   */
  private extractMCPContent(content: string): string {
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
          'text' in item,
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
   * Get language from file extension
   */
  private getLanguageFromPath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    const ext = '.' + normalized.split('.').pop()?.toLowerCase();
    return this.languageMap[ext] || 'text';
  }
}
