import {
  Component,
  input,
  signal,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { MarkdownModule } from 'ngx-markdown';
import {
  LucideAngularModule,
  File,
  Terminal,
  Search,
  FileEdit,
  FolderSearch,
  CheckCircle,
  XCircle,
  Loader2,
  ExternalLink,
  ChevronDown,
  ShieldAlert,
  Check,
  CheckCheck,
  X,
  ChevronRight,
} from 'lucide-angular';
import { DurationBadgeComponent } from '../atoms/duration-badge.component';
import { ClaudeRpcService } from '@ptah-extension/core';
import type { ExecutionNode } from '@ptah-extension/shared';
import { NgClass } from '@angular/common';

/**
 * ToolCallItemComponent - Compact tool execution display
 *
 * Complexity Level: 2 (Molecule with internal state)
 * Patterns: Tool-specific formatting, Smart syntax highlighting
 *
 * Features:
 * - Icon + Tool name badge with status coloring
 * - Clickable file paths to open in VS Code editor
 * - Smart syntax-highlighted output (code, markdown, bash)
 * - Collapsible details with ngx-markdown rendering
 */
@Component({
  selector: 'ptah-tool-call-item',
  standalone: true,
  imports: [
    MarkdownModule,
    LucideAngularModule,
    DurationBadgeComponent,
    NgClass,
  ],
  template: `
    <div class="bg-base-200/30 rounded my-0.5 border border-base-300/50">
      <!-- Header (clickable to toggle) -->
      <button
        type="button"
        class="w-full py-1.5 px-2 text-[11px] flex items-center gap-1.5 hover:bg-base-300/30 transition-colors cursor-pointer"
        (click)="toggleCollapse()"
        [attr.aria-expanded]="!isCollapsed()"
        [attr.aria-controls]="'tool-' + node().id"
      >
        <!-- Expand/Collapse icon -->
        <lucide-angular
          [img]="ChevronIcon"
          class="w-3 h-3 flex-shrink-0 text-base-content/50 transition-transform"
          [class.rotate-0]="!isCollapsed()"
          [class.-rotate-90]="isCollapsed()"
        />

        <!-- Tool icon -->
        <lucide-angular
          [img]="getToolIcon()"
          [ngClass]="['w-3.5 h-3.5 flex-shrink-0', getToolIconClass()]"
        />

        <!-- Tool name badge -->
        <span
          class="badge badge-xs font-mono px-1.5"
          [class.badge-success]="node().status === 'complete'"
          [class.badge-info]="node().status === 'streaming'"
          [class.badge-error]="node().status === 'error'"
          [class.badge-ghost]="node().status === 'pending'"
        >
          {{ node().toolName }}
        </span>

        <!-- Smart description (clickable file path) -->
        @if (hasClickableFilePath()) {
        <span
          class="text-info/80 truncate flex-1 font-mono text-[10px] hover:text-info hover:underline cursor-pointer flex items-center gap-1"
          [title]="getFullDescription()"
          (click)="openFile($event)"
        >
          {{ getToolDescription() }}
          <lucide-angular
            [img]="ExternalLinkIcon"
            class="w-2.5 h-2.5 opacity-60"
          />
        </span>
        } @else {
        <span
          class="text-base-content/60 truncate flex-1 font-mono text-[10px]"
          [title]="getFullDescription()"
        >
          {{ getToolDescription() }}
        </span>
        }

        <!-- Status indicator -->
        @if (node().isPermissionRequest) {
        <lucide-angular
          [img]="ShieldAlertIcon"
          class="w-3 h-3 text-warning flex-shrink-0"
        />
        } @else if (node().status === 'complete' && node().toolOutput) {
        <lucide-angular
          [img]="CheckIcon"
          class="w-3 h-3 text-success flex-shrink-0"
        />
        } @else if (node().status === 'error') {
        <lucide-angular
          [img]="XIcon"
          class="w-3 h-3 text-error flex-shrink-0"
        />
        } @else if (node().status === 'streaming') {
        <lucide-angular
          [img]="LoaderIcon"
          class="w-3 h-3 text-info animate-spin flex-shrink-0"
        />
        }

        <!-- Duration -->
        @if (node().duration) {
        <ptah-duration-badge [durationMs]="node().duration!" />
        }
      </button>

      <!-- Collapsible content -->
      @if (!isCollapsed()) {
      <div
        class="px-2 pb-2 pt-0 border-t border-base-300/30"
        [attr.id]="'tool-' + node().id"
      >
        <!-- Compact input display -->
        @if (hasNonTrivialInput()) {
        <div class="mb-1.5 mt-1.5">
          <div class="text-[10px] font-semibold text-base-content/50 mb-0.5">
            Input
          </div>
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
                  <button
                    type="button"
                    class="btn btn-xs btn-ghost gap-1 h-4 min-h-4 px-1"
                    (click)="toggleContentExpanded($event)"
                  >
                    <lucide-angular
                      [img]="ChevronRightIcon"
                      class="w-3 h-3 transition-transform"
                      [class.rotate-90]="isContentExpanded()"
                    />
                    {{ isContentExpanded() ? 'Hide' : 'Show' }} content ({{
                      getContentSize(param.fullValue)
                    }})
                  </button>
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
        </div>
        }

        <!-- Smart output display with syntax highlighting -->
        @if (node().toolOutput) {
        <div class="mt-1.5">
          <div class="text-[10px] font-semibold text-base-content/50 mb-0.5">
            Output
          </div>
          <div
            class="bg-base-300/50 rounded max-h-48 overflow-y-auto overflow-x-auto"
          >
            <markdown
              [data]="getFormattedOutput()"
              class="tool-output-markdown prose prose-xs prose-invert max-w-none [&_pre]:my-0 [&_pre]:rounded-none [&_code]:text-[10px] [&_pre]:bg-transparent [&_p]:my-1 [&_p]:text-[10px]"
            />
          </div>
        </div>
        }

        <!-- Permission Request -->
        @if (node().isPermissionRequest) {
        <div class="alert alert-warning text-[10px] py-2 px-3 mt-1.5">
          <div class="flex items-start gap-2 mb-2">
            <lucide-angular
              [img]="ShieldAlertIcon"
              class="w-4 h-4 flex-shrink-0 text-warning mt-0.5"
            />
            <div class="flex-1">
              <div class="font-semibold mb-1">Permission Required</div>
              <div class="text-base-content/80">
                {{ getPermissionQuestion() }}
              </div>
            </div>
          </div>
          <div class="flex gap-2 mt-2">
            <button
              type="button"
              class="btn btn-xs btn-success gap-1"
              (click)="handlePermission('allow')"
              title="Grant permission for this operation"
            >
              <lucide-angular [img]="CheckIconSmall" class="w-3 h-3" />
              Allow
            </button>
            <button
              type="button"
              class="btn btn-xs btn-info gap-1"
              (click)="handlePermission('always')"
              title="Grant permission for entire session"
            >
              <lucide-angular [img]="CheckCheckIcon" class="w-3 h-3" />
              Allow Always
            </button>
            <button
              type="button"
              class="btn btn-xs btn-error gap-1"
              (click)="handlePermission('deny')"
              title="Deny this permission request"
            >
              <lucide-angular [img]="XIconSmall" class="w-3 h-3" />
              Deny
            </button>
          </div>
        </div>
        }

        <!-- Error (non-permission) -->
        @if (node().error && !node().isPermissionRequest) {
        <div class="alert alert-error text-[10px] py-1 px-2 mt-1">
          <span>{{ node().error }}</span>
        </div>
        }

        <!-- Nested children (rendered by parent ExecutionNode) -->
        <ng-content />
      </div>
      }
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
export class ToolCallItemComponent {
  private readonly rpcService = inject(ClaudeRpcService);

  readonly node = input.required<ExecutionNode>();
  readonly isCollapsed = signal(true); // Collapsed by default
  readonly isContentExpanded = signal(false); // For large Write content

  // Icons
  readonly FileIcon = File;
  readonly TerminalIcon = Terminal;
  readonly SearchIcon = Search;
  readonly FileEditIcon = FileEdit;
  readonly FolderSearchIcon = FolderSearch;
  readonly CheckIcon = CheckCircle;
  readonly XIcon = XCircle;
  readonly LoaderIcon = Loader2;
  readonly ExternalLinkIcon = ExternalLink;
  readonly ChevronIcon = ChevronDown;
  readonly ShieldAlertIcon = ShieldAlert;
  readonly CheckIconSmall = Check;
  readonly CheckCheckIcon = CheckCheck;
  readonly XIconSmall = X;
  readonly ChevronRightIcon = ChevronRight;

  // Language extension mapping for syntax highlighting
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

  protected toggleCollapse(): void {
    this.isCollapsed.update((val) => !val);
  }

  protected getToolIcon(): typeof File {
    const toolName = this.node().toolName;
    switch (toolName) {
      case 'Read':
      case 'Write':
        return this.FileIcon;
      case 'Bash':
        return this.TerminalIcon;
      case 'Grep':
        return this.SearchIcon;
      case 'Edit':
        return this.FileEditIcon;
      case 'Glob':
        return this.FolderSearchIcon;
      default:
        return this.TerminalIcon;
    }
  }

  protected getToolIconClass(): string {
    const toolName = this.node().toolName;
    switch (toolName) {
      case 'Read':
        return 'text-blue-400';
      case 'Write':
        return 'text-green-400';
      case 'Bash':
        return 'text-yellow-400';
      case 'Grep':
        return 'text-purple-400';
      case 'Edit':
        return 'text-orange-400';
      case 'Glob':
        return 'text-cyan-400';
      default:
        return 'text-base-content/60';
    }
  }

  protected hasClickableFilePath(): boolean {
    const toolName = this.node().toolName;
    const toolInput = this.node().toolInput;
    return (
      ['Read', 'Write', 'Edit'].includes(toolName || '') &&
      typeof toolInput?.['file_path'] === 'string'
    );
  }

  protected openFile(event: Event): void {
    event.stopPropagation(); // Prevent collapse toggle
    const filePath = this.node().toolInput?.['file_path'] as string;
    if (filePath) {
      // Use RPC to open file in VS Code
      this.rpcService.call('file:open', { path: filePath });
    }
  }

  protected getToolDescription(): string {
    const node = this.node();
    const toolName = node.toolName!;
    const toolInput = node.toolInput;

    switch (toolName) {
      case 'Read':
      case 'Write':
      case 'Edit':
        return this.shortenPath(toolInput?.['file_path'] as string) || '...';
      case 'Bash': {
        const cmd = toolInput?.['command'] as string;
        const desc = toolInput?.['description'] as string;
        if (desc) return desc;
        return cmd ? this.truncate(cmd, 40) : '...';
      }
      case 'Grep':
        return this.truncate(toolInput?.['pattern'] as string, 30) || '...';
      case 'Glob':
        return this.truncate(toolInput?.['pattern'] as string, 30) || '...';
      default:
        return toolName;
    }
  }

  protected getFullDescription(): string {
    const node = this.node();
    const toolInput = node.toolInput;
    const toolName = node.toolName!;

    switch (toolName) {
      case 'Read':
      case 'Write':
      case 'Edit':
        return (toolInput?.['file_path'] as string) || '';
      case 'Bash':
        return (toolInput?.['command'] as string) || '';
      case 'Grep':
      case 'Glob':
        return (toolInput?.['pattern'] as string) || '';
      default:
        return '';
    }
  }

  protected hasNonTrivialInput(): boolean {
    const toolInput = this.node().toolInput;
    if (!toolInput) return false;
    // Hide input for simple tools where description shows the key info
    const toolName = this.node().toolName;
    if (['Read'].includes(toolName || '')) {
      // Only show if there are extra params besides file_path
      const keys = Object.keys(toolInput).filter((k) => k !== 'file_path');
      return keys.length > 0;
    }
    return Object.keys(toolInput).length > 0;
  }

  protected getInputParams(): Array<{
    key: string;
    value: string;
    fullValue: unknown;
  }> {
    const toolInput = this.node().toolInput;
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
   */
  protected shouldExpandParam(param: {
    key: string;
    value: string;
    fullValue: unknown;
  }): boolean {
    const toolName = this.node().toolName;
    const isWriteTool = toolName === 'Write';
    const isContentParam = param.key === 'content';
    const isLargeContent =
      typeof param.fullValue === 'string' && param.fullValue.length > 200;

    return isWriteTool && isContentParam && isLargeContent;
  }

  /**
   * Toggle content expanded state
   */
  protected toggleContentExpanded(event: Event): void {
    event.stopPropagation(); // Prevent collapse toggle
    this.isContentExpanded.update((val) => !val);
  }

  /**
   * Get human-readable content size
   */
  protected getContentSize(value: unknown): string {
    if (typeof value !== 'string') return '';
    const lines = value.split('\n').length;
    const chars = value.length;
    return `${lines} lines, ${chars} chars`;
  }

  /**
   * Format parameter content for markdown rendering
   * Detects language from file_path if available (for Write tool)
   */
  protected getFormattedParamContent(param: {
    key: string;
    fullValue: unknown;
  }): string {
    let content =
      typeof param.fullValue === 'string'
        ? param.fullValue
        : JSON.stringify(param.fullValue, null, 2);

    // Strip system-reminder tags
    content = this.stripSystemReminders(content);

    // For Write tool, detect language from file_path
    if (this.node().toolName === 'Write' && param.key === 'content') {
      const filePath = this.node().toolInput?.['file_path'] as string;
      if (filePath) {
        const language = this.getLanguageFromPath(filePath);
        // For markdown files, render as markdown (no code block)
        if (language === 'markdown') {
          return content;
        }
        // Wrap in code block with detected language
        return '```' + language + '\n' + content + '\n```';
      }
    }

    // Default: wrap in generic code block
    return '```\n' + content + '\n```';
  }

  /**
   * Extract permission question from error message
   */
  protected getPermissionQuestion(): string {
    const error = this.node().error;
    if (!error) return 'This tool requires permission to proceed.';

    // Try to extract the actual question from the error message
    // Permission errors typically contain descriptive text about what's being requested
    const lines = error.split('\n');
    const questionLine = lines.find(
      (line) =>
        line.includes('?') ||
        line.toLowerCase().includes('permission') ||
        line.toLowerCase().includes('allow')
    );

    return (
      questionLine ||
      error.split('\n')[0] ||
      'This tool requires permission to proceed.'
    );
  }

  /**
   * Handle permission response (allow/always/deny)
   */
  protected handlePermission(response: 'allow' | 'always' | 'deny'): void {
    const toolCallId = this.node().toolCallId;
    if (!toolCallId) {
      console.error(
        '[ToolCallItem] Cannot handle permission: missing toolCallId'
      );
      return;
    }

    console.log(`[ToolCallItem] Permission ${response} for tool ${toolCallId}`);

    // Call RPC service (stub for now - backend will implement)
    this.rpcService
      .call('permission:respond', {
        toolUseId: toolCallId,
        response,
      })
      .then((result) => {
        if (result.isError()) {
          console.error(
            '[ToolCallItem] Permission response failed:',
            result.error
          );
        }
      });
  }

  /**
   * Strip system-reminder tags from content
   * Claude CLI adds these tags to tool results but they should not be displayed
   */
  private stripSystemReminders(content: string): string {
    // Remove <system-reminder>...</system-reminder> tags and their content
    return content
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
      .trim();
  }

  /**
   * Get formatted output with syntax highlighting
   * Wraps output in appropriate markdown code block based on:
   * - File extension for Read/Edit/Write tools
   * - Shell for Bash tool
   * - Auto-detect for other outputs
   */
  protected getFormattedOutput(): string {
    const output = this.node().toolOutput;
    if (!output) return '';

    let str =
      typeof output === 'string' ? output : JSON.stringify(output, null, 2);

    // Strip system-reminder tags from tool output
    str = this.stripSystemReminders(str);

    const toolName = this.node().toolName;
    const toolInput = this.node().toolInput;

    // Detect language based on tool type
    let language = 'text';

    if (['Read', 'Write', 'Edit'].includes(toolName || '')) {
      const filePath = toolInput?.['file_path'] as string;
      if (filePath) {
        language = this.getLanguageFromPath(filePath);
        // For markdown files, render as markdown (no code block)
        if (language === 'markdown') {
          return str;
        }
      }
    } else if (toolName === 'Bash') {
      language = 'bash';
    } else if (toolName === 'Grep' || toolName === 'Glob') {
      // Grep/Glob outputs are typically file lists or search results
      language = 'text';
    }

    // Check if output is JSON
    if (str.trim().startsWith('{') || str.trim().startsWith('[')) {
      try {
        JSON.parse(str);
        language = 'json';
      } catch {
        // Not valid JSON, keep detected language
      }
    }

    // Wrap in code block with language
    return '```' + language + '\n' + str + '\n```';
  }

  private getLanguageFromPath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    const ext = '.' + normalized.split('.').pop()?.toLowerCase();
    return this.languageMap[ext] || 'text';
  }

  private formatValue(value: unknown): string {
    if (typeof value === 'string') {
      return this.truncate(value, 60);
    }
    if (typeof value === 'boolean' || typeof value === 'number') {
      return String(value);
    }
    return JSON.stringify(value);
  }

  private truncate(str: string | undefined, maxLen: number): string {
    if (!str) return '';
    return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
  }

  private shortenPath(path: string | undefined): string {
    if (!path) return '';
    // Show just the filename or last 2 path segments
    const parts = path.replace(/\\/g, '/').split('/');
    if (parts.length <= 2) return path;
    return '.../' + parts.slice(-2).join('/');
  }
}
