import {
  Component,
  input,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';
import {
  LucideAngularModule,
  ChevronDown,
  CheckCircle,
  XCircle,
  Loader2,
} from 'lucide-angular';
import { ToolIconComponent } from '../atoms/tool-icon.component';
import { FilePathLinkComponent } from '../atoms/file-path-link.component';
import { DurationBadgeComponent } from '../atoms/duration-badge.component';
import type { ExecutionNode } from '@ptah-extension/shared';

/**
 * ToolCallHeaderComponent - Header section for tool call display
 *
 * Complexity Level: 2 (Molecule - composition of atoms)
 * Patterns: Composition pattern, event delegation
 *
 * Features:
 * - Compose ToolIconComponent, FilePathLinkComponent, DurationBadgeComponent
 * - Toggle collapse state on header click
 * - File path clicks do NOT toggle collapse (stopPropagation)
 * - Show status indicator based on node.status (complete/error/streaming)
 * - Display streaming animation with descriptive text
 * - Show duration badge if available
 * - Accessible (aria-expanded attribute)
 */
@Component({
  selector: 'ptah-tool-call-header',
  standalone: true,
  imports: [
    LucideAngularModule,
    ToolIconComponent,
    FilePathLinkComponent,
    DurationBadgeComponent,
  ],
  template: `
    <button
      type="button"
      class="w-full py-1.5 px-2 text-[11px] flex items-center gap-1.5 hover:bg-base-300/30 transition-colors cursor-pointer"
      (click)="toggleClicked.emit()"
      [attr.aria-expanded]="!isCollapsed()"
    >
      <!-- Chevron icon -->
      <lucide-angular
        [img]="ChevronIcon"
        class="w-3 h-3 flex-shrink-0 text-base-content/50 transition-transform"
        [class.rotate-0]="!isCollapsed()"
        [class.-rotate-90]="isCollapsed()"
      />

      <!-- Tool icon -->
      <ptah-tool-icon [toolName]="node().toolName || 'Unknown'" />

      <!-- Tool name badge -->
      <span [class]="'badge badge-xs font-mono px-1.5 ' + getBadgeClass()">
        {{ node().toolName }}
      </span>

      <!-- Description (file path or generic) -->
      @if (hasClickableFilePath()) {
      <ptah-file-path-link
        [fullPath]="getFilePath()"
        (clicked)="onFilePathClick($event)"
      />
      } @else {
      <span
        class="text-base-content/60 truncate flex-1 font-mono text-[10px]"
        [title]="getFullDescription()"
      >
        {{ getToolDescription() }}
      </span>
      }

      <!-- Status indicator -->
      @if (node().status === 'complete' && node().toolOutput) {
      <lucide-angular
        [img]="CheckIcon"
        class="w-3 h-3 text-success flex-shrink-0"
      />
      } @else if (node().status === 'error') {
      <lucide-angular [img]="XIcon" class="w-3 h-3 text-error flex-shrink-0" />
      } @else if (node().status === 'streaming') {
      <div class="flex items-center gap-1 flex-shrink-0">
        <lucide-angular
          [img]="LoaderIcon"
          class="w-3 h-3 text-info animate-spin"
        />
        <span class="text-base-content/50 text-[10px] animate-pulse font-mono">
          {{ getStreamingDescription() }}
        </span>
      </div>
      }

      <!-- Duration -->
      @if (node().duration) {
      <ptah-duration-badge [durationMs]="node().duration!" />
      }
    </button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolCallHeaderComponent {
  readonly node = input.required<ExecutionNode>();
  readonly isCollapsed = input.required<boolean>();
  readonly toggleClicked = output<void>();

  // Icons
  readonly ChevronIcon = ChevronDown;
  readonly CheckIcon = CheckCircle;
  readonly XIcon = XCircle;
  readonly LoaderIcon = Loader2;

  /**
   * Check if tool has clickable file path
   * Extracted from tool-call-item.component.ts:342-349
   */
  protected hasClickableFilePath(): boolean {
    const toolName = this.node().toolName;
    const toolInput = this.node().toolInput;
    return (
      ['Read', 'Write', 'Edit'].includes(toolName || '') &&
      typeof toolInput?.['file_path'] === 'string'
    );
  }

  /**
   * Get file path from tool input
   */
  protected getFilePath(): string {
    return this.node().toolInput?.['file_path'] as string;
  }

  /**
   * Get tool description for display
   * Extracted from tool-call-item.component.ts:360-383
   */
  protected getToolDescription(): string {
    const node = this.node();
    const toolName = node.toolName || '';
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

  /**
   * Get full description for title attribute
   * Extracted from tool-call-item.component.ts:385-403
   */
  protected getFullDescription(): string {
    const node = this.node();
    const toolInput = node.toolInput;
    const toolName = node.toolName || '';

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

  /**
   * Get streaming description
   * Extracted from tool-call-item.component.ts:666-701
   */
  protected getStreamingDescription(): string {
    const toolName = this.node().toolName;
    const input = this.node().toolInput;

    if (!toolName || !input) return 'Working...';

    switch (toolName) {
      case 'Read':
        return `Reading ${this.shortenPath(input['file_path'] as string)}...`;
      case 'Write':
        return `Writing ${this.shortenPath(input['file_path'] as string)}...`;
      case 'Edit':
        return `Editing ${this.shortenPath(input['file_path'] as string)}...`;
      case 'Bash': {
        const desc = input['description'] as string;
        if (desc) return `${desc}...`;
        const cmd = input['command'] as string;
        return `Running ${this.truncate(cmd, 20)}...`;
      }
      case 'Grep':
        return `Searching for "${this.truncate(
          input['pattern'] as string,
          15
        )}"...`;
      case 'Glob':
        return `Finding ${this.truncate(input['pattern'] as string, 15)}...`;
      case 'Task':
        return 'Invoking agent...';
      case 'WebFetch':
        return `Fetching ${this.truncate(input['url'] as string, 20)}...`;
      case 'WebSearch':
        return `Searching "${this.truncate(input['query'] as string, 15)}"...`;
      default:
        return `Executing ${toolName}...`;
    }
  }

  /**
   * Get badge class based on status
   */
  protected getBadgeClass(): string {
    const status = this.node().status;
    if (status === 'complete') return 'badge-success';
    if (status === 'streaming') return 'badge-info';
    if (status === 'error') return 'badge-error';
    return 'badge-ghost';
  }

  /**
   * Handle file path click (prevent collapse toggle)
   */
  protected onFilePathClick(event: Event): void {
    event.stopPropagation(); // Prevent collapse toggle
  }

  /**
   * Shorten file path for display
   */
  private shortenPath(path: string | undefined): string {
    if (!path) return '';
    // Show just the filename or last 2 path segments
    const parts = path.replace(/\\/g, '/').split('/');
    if (parts.length <= 2) return path;
    return '.../' + parts.slice(-2).join('/');
  }

  /**
   * Truncate string to max length
   */
  private truncate(str: string | undefined, maxLen: number): string {
    if (!str) return '';
    return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
  }
}
