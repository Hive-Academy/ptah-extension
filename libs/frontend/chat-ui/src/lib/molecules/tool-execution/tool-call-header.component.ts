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
import { ToolIconComponent } from '../../atoms/tool-icon.component';
import { FilePathLinkComponent } from '../../atoms/file-path-link.component';
import { DurationBadgeComponent } from '../../atoms/duration-badge.component';
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
  isAgentDispatchTool,
} from '@ptah-extension/shared';
import {
  describeToolTarget,
  displayToolName,
  isPtahMcpToolName,
  shortenToolPath,
  toolStatusBadgeClass,
  truncateToolText,
} from '../../utils/tool-target.utils';

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
        class="w-3 h-3 flex-shrink-0 text-base-content-muted transition-transform"
        [class.rotate-0]="!isCollapsed()"
        [class.-rotate-90]="isCollapsed()"
      />

      <!-- Tool icon -->
      <ptah-tool-icon [toolName]="node().toolName || 'Unknown'" />

      <!-- Tool name badge -->
      @if (isPtahMcpTool()) {
        <span class="badge badge-xs font-mono px-1.5 ptah-superpower-badge">
          Ptah Superpower
        </span>
        <span class="badge badge-xs font-mono px-1.5 ptah-tool-name-badge">
          {{ getPtahToolName() }}
        </span>
      } @else {
        <span [class]="'badge badge-xs font-mono px-1.5 ' + getBadgeClass()">
          {{ node().toolName }}
        </span>
      }

      <!-- Description (file path or generic) - HIDDEN during streaming to avoid redundancy -->
      @if (node().status !== 'streaming' && hasClickableFilePath()) {
        <ptah-file-path-link
          [fullPath]="getFilePath()"
          (clicked)="onFilePathClick($event)"
        />
      } @else if (node().status !== 'streaming') {
        <span
          class="text-base-content-muted truncate flex-1 min-w-0 font-mono text-[10px]"
          [title]="getFullDescription()"
        >
          {{ getToolDescription() }}
        </span>
      }

      <!-- Parse Error Warning -->
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
        <lucide-angular
          [img]="XIcon"
          class="w-3 h-3 text-error flex-shrink-0"
        />
      } @else if (node().status === 'streaming') {
        <div class="flex items-center gap-1 flex-1 min-w-0">
          <lucide-angular
            [img]="LoaderIcon"
            class="w-3 h-3 text-info animate-spin flex-shrink-0"
          />
          <span
            class="text-base-content-muted text-[10px] animate-pulse font-mono truncate"
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
  // `.ptah-superpower-badge` / `.ptah-tool-name-badge` are defined once
  // globally in apps/ptah-extension-webview/src/styles.css, keyed off the
  // theme-aware `--ptah-gold*` tokens. Do not re-add a local copy.
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolCallHeaderComponent {
  readonly node = input.required<ExecutionNode>();
  readonly isCollapsed = input.required<boolean>();
  readonly toggleClicked = output<void>();
  readonly ChevronIcon = ChevronDown;
  readonly CheckIcon = CheckCircle;
  readonly XIcon = XCircle;
  readonly LoaderIcon = Loader2;
  readonly AlertIcon = AlertTriangle;

  /**
   * Check if tool input has parse error
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
   */
  protected hasClickableFilePath(): boolean {
    const toolInput = this.node().toolInput;
    if (
      isReadToolInput(toolInput) ||
      isWriteToolInput(toolInput) ||
      isEditToolInput(toolInput)
    ) {
      return true;
    }
    return this.hasFilePathField();
  }

  /**
   * Get file path from tool input
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
    if (
      toolInput &&
      typeof toolInput === 'object' &&
      'file_path' in toolInput &&
      typeof toolInput['file_path'] === 'string'
    ) {
      return toolInput['file_path'];
    }
    return '';
  }

  /**
   * Check if tool input has a file_path field and tool name suggests a file operation.
   */
  private hasFilePathField(): boolean {
    const toolInput = this.node().toolInput;
    const toolName = (this.node().toolName || '').toLowerCase();
    if (
      toolInput &&
      typeof toolInput === 'object' &&
      'file_path' in toolInput &&
      typeof toolInput['file_path'] === 'string' &&
      /read|write|edit|replace|create_file|patch_file/.test(toolName)
    ) {
      return true;
    }
    return false;
  }

  /**
   * Get tool description for display
   */
  protected getToolDescription(): string {
    return this.toolTarget().short;
  }

  /**
   * Get full description for title attribute
   */
  protected getFullDescription(): string {
    return this.toolTarget().full;
  }

  private readonly toolTarget = computed(() =>
    describeToolTarget(this.node().toolName || '', this.node().toolInput),
  );

  /**
   * Get streaming description
   */
  protected getStreamingDescription(): string {
    const toolName = this.node().toolName;
    const input = this.node().toolInput;

    if (!toolName || !input) return 'Working...';

    if (isReadToolInput(input)) {
      return `Reading ${shortenToolPath(input.file_path)}...`;
    }
    if (isWriteToolInput(input)) {
      return `Writing ${shortenToolPath(input.file_path)}...`;
    }
    if (isEditToolInput(input)) {
      return `Editing ${shortenToolPath(input.file_path)}...`;
    }
    if (isBashToolInput(input)) {
      const desc = input.description;
      if (desc) return `${desc}...`;
      const cmd = input.command;
      return `Running ${truncateToolText(cmd, 20)}...`;
    }
    if (isGrepToolInput(input)) {
      return `Searching for "${truncateToolText(input.pattern, 15)}"...`;
    }
    if (isGlobToolInput(input)) {
      return `Finding ${truncateToolText(input.pattern, 15)}...`;
    }
    if (isWebFetchToolInput(input)) {
      return `Fetching ${truncateToolText(input.url, 20)}...`;
    }
    if (isWebSearchToolInput(input)) {
      return `Searching "${truncateToolText(input.query, 15)}"...`;
    }
    if (isAgentDispatchTool(toolName)) {
      return 'Invoking agent...';
    }
    return `Executing ${toolName}...`;
  }

  /**
   * Check if this is any MCP tool call
   */
  isMcpTool(): boolean {
    const toolName = this.node().toolName || '';
    return toolName.startsWith('mcp__');
  }

  /**
   * Check if this is a Ptah MCP server tool call
   * Matches both ptah-cli format (mcp__ptah__*) and Copilot format (ptah-ptah_*)
   */
  isPtahMcpTool(): boolean {
    return isPtahMcpToolName(this.node().toolName || '');
  }

  /**
   * Clean Ptah MCP tool name (`mcp__ptah__workspace_analyze` ->
   * "workspace analyze", `ptah-ptah_search_files` -> "search files").
   */
  protected getPtahToolName(): string {
    return displayToolName(this.node().toolName || '');
  }

  /**
   * Get badge class based on status
   */
  protected getBadgeClass(): string {
    return toolStatusBadgeClass(this.node().status);
  }

  /**
   * Handle file path click (prevent collapse toggle)
   */
  protected onFilePathClick(event: Event): void {
    event.stopPropagation(); // Prevent collapse toggle
  }
}
