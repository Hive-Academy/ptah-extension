import {
  Component,
  input,
  output,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import {
  LucideAngularModule,
  ChevronDown,
  CheckCircle,
  XCircle,
  Loader2,
  AlertTriangle,
} from 'lucide-angular';
import { ToolIconComponent } from '../atoms/tool-icon.component';
import { FilePathLinkComponent } from '../atoms/file-path-link.component';
import { DurationBadgeComponent } from '../atoms/duration-badge.component';
import type { ExecutionNode } from '@ptah-extension/shared';
import {
  isReadToolInput,
  isWriteToolInput,
  isEditToolInput,
  isBashToolInput,
  isGrepToolInput,
  isGlobToolInput,
  isWebFetchToolInput,
  isWebSearchToolInput,
} from '@ptah-extension/shared';

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

      <!-- Description (file path or generic) - HIDDEN during streaming to avoid redundancy (TASK_2025_102) -->
      @if (node().status !== 'streaming') { @if (hasClickableFilePath()) {
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
      } }

      <!-- Parse Error Warning (TASK_2025_088 Batch 2 Task 2.3) -->
      @if (hasParseError()) {
      <div
        class="flex items-center gap-1 flex-shrink-0 px-1.5 py-0.5 bg-warning/20 rounded text-warning"
        [title]="'Parse Error: ' + parseError()"
      >
        <lucide-angular [img]="AlertIcon" class="w-3 h-3" />
        <span class="text-[10px] font-mono">Parse Error</span>
      </div>
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
      <div class="flex items-center gap-1 flex-1 min-w-0">
        <lucide-angular
          [img]="LoaderIcon"
          class="w-3 h-3 text-info animate-spin flex-shrink-0"
        />
        <span
          class="text-base-content/50 text-[10px] animate-pulse font-mono truncate"
        >
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
  readonly AlertIcon = AlertTriangle;

  /**
   * Check if tool input has parse error
   * TASK_2025_088 Batch 2 Task 2.3: Detect parse errors from safe parser
   */
  readonly hasParseError = computed(() => {
    const input = this.node().toolInput;
    return (
      input &&
      typeof input === 'object' &&
      '__parseError' in input &&
      typeof input['__parseError'] === 'string'
    );
  });

  /**
   * Get parse error message
   * TASK_2025_088 Batch 2 Task 2.3: Extract error message for display
   */
  readonly parseError = computed(() => {
    const input = this.node().toolInput;
    if (
      input &&
      typeof input === 'object' &&
      '__parseError' in input &&
      typeof input['__parseError'] === 'string'
    ) {
      return input['__parseError'];
    }
    return '';
  });

  /**
   * Check if tool has clickable file path
   * Extracted from tool-call-item.component.ts:342-349
   * TASK_2025_088 Batch 5 Task 5.2: Use type guards instead of bracket notation
   */
  protected hasClickableFilePath(): boolean {
    const toolInput = this.node().toolInput;
    return (
      isReadToolInput(toolInput) ||
      isWriteToolInput(toolInput) ||
      isEditToolInput(toolInput)
    );
  }

  /**
   * Get file path from tool input
   * TASK_2025_088 Batch 5 Task 5.2: Type-safe access after type guard
   */
  protected getFilePath(): string {
    const toolInput = this.node().toolInput;
    if (isReadToolInput(toolInput)) {
      return toolInput.file_path;
    }
    if (isWriteToolInput(toolInput)) {
      return toolInput.file_path;
    }
    if (isEditToolInput(toolInput)) {
      return toolInput.file_path;
    }
    return '';
  }

  /**
   * Get tool description for display
   * Extracted from tool-call-item.component.ts:360-383
   * TASK_2025_088 Batch 5 Task 5.2: Use type guards for type-safe access
   */
  protected getToolDescription(): string {
    const node = this.node();
    const toolName = node.toolName || '';
    const toolInput = node.toolInput;

    if (isReadToolInput(toolInput)) {
      return this.shortenPath(toolInput.file_path) || '...';
    }
    if (isWriteToolInput(toolInput)) {
      return this.shortenPath(toolInput.file_path) || '...';
    }
    if (isEditToolInput(toolInput)) {
      return this.shortenPath(toolInput.file_path) || '...';
    }
    if (isBashToolInput(toolInput)) {
      const desc = toolInput.description;
      if (desc) return desc;
      const cmd = toolInput.command;
      return cmd ? this.truncate(cmd, 40) : '...';
    }
    if (isGrepToolInput(toolInput)) {
      return this.truncate(toolInput.pattern, 30) || '...';
    }
    if (isGlobToolInput(toolInput)) {
      return this.truncate(toolInput.pattern, 30) || '...';
    }
    return toolName;
  }

  /**
   * Get full description for title attribute
   * Extracted from tool-call-item.component.ts:385-403
   * TASK_2025_088 Batch 5 Task 5.2: Use type guards for type-safe access
   */
  protected getFullDescription(): string {
    const toolInput = this.node().toolInput;

    if (isReadToolInput(toolInput)) {
      return toolInput.file_path;
    }
    if (isWriteToolInput(toolInput)) {
      return toolInput.file_path;
    }
    if (isEditToolInput(toolInput)) {
      return toolInput.file_path;
    }
    if (isBashToolInput(toolInput)) {
      return toolInput.command;
    }
    if (isGrepToolInput(toolInput)) {
      return toolInput.pattern;
    }
    if (isGlobToolInput(toolInput)) {
      return toolInput.pattern;
    }
    return '';
  }

  /**
   * Get streaming description
   * Extracted from tool-call-item.component.ts:666-701
   * TASK_2025_088 Batch 5 Task 5.2: Use type guards for type-safe access
   */
  protected getStreamingDescription(): string {
    const toolName = this.node().toolName;
    const input = this.node().toolInput;

    if (!toolName || !input) return 'Working...';

    if (isReadToolInput(input)) {
      return `Reading ${this.shortenPath(input.file_path)}...`;
    }
    if (isWriteToolInput(input)) {
      return `Writing ${this.shortenPath(input.file_path)}...`;
    }
    if (isEditToolInput(input)) {
      return `Editing ${this.shortenPath(input.file_path)}...`;
    }
    if (isBashToolInput(input)) {
      const desc = input.description;
      if (desc) return `${desc}...`;
      const cmd = input.command;
      return `Running ${this.truncate(cmd, 20)}...`;
    }
    if (isGrepToolInput(input)) {
      return `Searching for "${this.truncate(input.pattern, 15)}"...`;
    }
    if (isGlobToolInput(input)) {
      return `Finding ${this.truncate(input.pattern, 15)}...`;
    }
    if (isWebFetchToolInput(input)) {
      return `Fetching ${this.truncate(input.url, 20)}...`;
    }
    if (isWebSearchToolInput(input)) {
      return `Searching "${this.truncate(input.query, 15)}"...`;
    }
    if (toolName === 'Task') {
      return 'Invoking agent...';
    }
    return `Executing ${toolName}...`;
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
