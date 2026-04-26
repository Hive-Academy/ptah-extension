import {
  Component,
  input,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { MarkdownModule } from 'ngx-markdown';
import { ExpandableContentComponent } from '../../atoms/expandable-content.component';
import { type ExecutionNode, isWriteToolInput } from '@ptah-extension/shared';

/**
 * ToolInputDisplayComponent - Display tool input parameters
 *
 * Complexity Level: 2 (Molecule with conditional expansion)
 * Patterns: Parameter list display with expand/collapse for large content
 *
 * Features:
 * - Hide input section for trivial inputs (e.g., Read tool with only file_path)
 * - Display all parameters as key-value pairs
 * - Large content (> 200 chars) gets expand/collapse functionality
 * - Expanded content shows syntax-highlighted markdown
 * - For Write tool, detect language from file_path parameter
 */

interface InputParam {
  key: string;
  value: string;
  fullValue: unknown;
}

@Component({
  selector: 'ptah-tool-input-display',
  standalone: true,
  imports: [MarkdownModule, ExpandableContentComponent],
  template: `
    @if (hasNonTrivialInput()) {
      <div class="mb-1.5 mt-1.5">
        <!-- Collapsible Input header -->
        <button
          type="button"
          class="flex items-center gap-1 text-[10px] font-semibold text-base-content/50 mb-0.5 hover:text-base-content/70 transition-colors"
          (click)="toggleInputCollapsed()"
        >
          <span
            class="inline-block transition-transform duration-200"
            [class.rotate-90]="!isInputCollapsed()"
            >&#9654;</span
          >
          Input
        </button>

        @if (!isInputCollapsed()) {
          <div
            class="bg-base-300/50 rounded text-[10px] font-mono overflow-x-auto"
          >
            @for (param of getInputParams(); track param.key) {
              <div>
                @if (shouldExpandParam(param)) {
                  <!-- Large content with expand/collapse -->
                  <div class="px-2 py-1">
                    <div class="flex gap-2 items-center mb-1">
                      <span class="text-primary/70">{{ param.key }}:</span>
                      <ptah-expandable-content
                        [content]="getParamValueAsString(param)"
                        [isExpanded]="isContentExpanded()"
                        (toggleClicked)="toggleContentExpanded($event)"
                      />
                    </div>
                    @if (isContentExpanded()) {
                      <div
                        class="bg-base-300/50 rounded max-h-96 overflow-y-auto overflow-x-auto"
                      >
                        <markdown
                          [data]="getFormattedParamContent(param)"
                          class="tool-output-markdown prose prose-xs prose-invert max-w-none [&_pre]:my-0 [&_pre]:rounded-none [&_code]:text-[10px] [&_pre]:bg-transparent [&_p]:my-1 [&_p]:text-[10px]"
                        />
                      </div>
                    } @else {
                      <div class="text-base-content/60 italic">
                        {{ param.value }}
                      </div>
                    }
                  </div>
                } @else {
                  <!-- Normal param display -->
                  <div class="flex gap-2 px-2 py-1">
                    <span class="text-primary/70">{{ param.key }}:</span>
                    <span class="text-base-content/80 break-all">{{
                      param.value
                    }}</span>
                  </div>
                }
              </div>
            }
          </div>
        }
      </div>
    }
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
export class ToolInputDisplayComponent {
  readonly node = input.required<ExecutionNode>();
  readonly isInputCollapsed = signal(true);
  readonly isContentExpanded = signal(false);

  /**
   * Toggle Input section collapsed state
   */
  protected toggleInputCollapsed(): void {
    this.isInputCollapsed.update((val) => !val);
  }

  /**
   * Get parameter value as string for expandable content
   */
  protected getParamValueAsString(param: InputParam): string {
    return typeof param.fullValue === 'string'
      ? param.fullValue
      : String(param.fullValue);
  }

  // Language extension mapping for Write tool content
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
   * Check if tool has non-trivial input to display
   * Extracted from tool-call-item.component.ts:405-416
   */
  protected hasNonTrivialInput(): boolean {
    const node = this.node();
    if (!node) return false;

    const toolInput = node.toolInput;
    if (!toolInput) return false;

    const toolName = node.toolName;

    // Hide input for TodoWrite - it has specialized display in ToolOutputDisplayComponent
    if (toolName === 'TodoWrite') {
      return false;
    }

    // Hide input for Edit tool - DiffDisplayComponent already shows old/new visually
    // Showing raw old_string/new_string in input section is redundant
    if (toolName === 'Edit') {
      return false;
    }

    // Hide input for simple tools where description shows the key info
    if (['Read'].includes(toolName || '')) {
      // Only show if there are extra params besides file_path
      const keys = Object.keys(toolInput).filter((k) => k !== 'file_path');
      return keys.length > 0;
    }
    return Object.keys(toolInput).length > 0;
  }

  /**
   * Get all input parameters as key-value pairs
   * Extracted from tool-call-item.component.ts:418-431
   */
  protected getInputParams(): InputParam[] {
    const node = this.node();
    if (!node) return [];

    const toolInput = node.toolInput;
    if (!toolInput) return [];

    return Object.entries(toolInput).map(([key, value]) => ({
      key,
      value: this.formatValue(value),
      fullValue: value,
    }));
  }

  /**
   * Check if a parameter should have expand/collapse functionality
   * Currently applies to Write tool's content parameter
   * Extracted from tool-call-item.component.ts:437-449
   */
  protected shouldExpandParam(param: InputParam): boolean {
    const node = this.node();
    if (!node) return false;

    const toolName = node.toolName;
    const isWriteTool = toolName === 'Write';
    const isContentParam = param.key === 'content';
    const isLargeContent =
      typeof param.fullValue === 'string' && param.fullValue.length > 200;

    return isWriteTool && isContentParam && isLargeContent;
  }

  /**
   * Format parameter content for markdown rendering
   * Detects language from file_path if available (for Write tool)
   * Extracted from tool-call-item.component.ts:473-501
   */
  protected getFormattedParamContent(param: InputParam): string {
    let content =
      typeof param.fullValue === 'string'
        ? param.fullValue
        : JSON.stringify(param.fullValue, null, 2);

    // Strip system-reminder tags
    content = this.stripSystemReminders(content);

    // For Write tool, detect language from file_path using type guard
    const node = this.node();
    if (param.key === 'content' && isWriteToolInput(node?.toolInput)) {
      const language = this.getLanguageFromPath(node.toolInput.file_path);
      // For markdown files, render as markdown (no code block)
      if (language === 'markdown') {
        return content;
      }
      // Wrap in code block with detected language
      return '```' + language + '\n' + content + '\n```';
    }

    // Default: wrap in generic code block
    return '```\n' + content + '\n```';
  }

  /**
   * Toggle content expanded state
   */
  protected toggleContentExpanded(event: Event): void {
    event.stopPropagation(); // Prevent collapse toggle
    this.isContentExpanded.update((val) => !val);
  }

  /**
   * Strip system-reminder tags from content
   */
  private stripSystemReminders(content: string): string {
    return content
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
      .trim();
  }

  /**
   * Get language from file extension
   */
  private getLanguageFromPath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    const ext = '.' + normalized.split('.').pop()?.toLowerCase();
    return this.languageMap[ext] || 'text';
  }

  /**
   * Format parameter value for display
   */
  private formatValue(value: unknown): string {
    if (typeof value === 'string') {
      return this.truncate(value, 60);
    }
    if (typeof value === 'boolean' || typeof value === 'number') {
      return String(value);
    }
    return JSON.stringify(value);
  }

  /**
   * Truncate string to max length
   */
  private truncate(str: string | undefined, maxLen: number): string {
    if (!str) return '';
    return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
  }
}
