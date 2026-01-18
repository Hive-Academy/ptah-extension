import {
  Component,
  input,
  output,
  signal,
  computed,
  effect,
  ChangeDetectionStrategy,
} from '@angular/core';
import {
  LucideAngularModule,
  ShieldAlert,
  File,
  Terminal,
  Search,
  FileEdit,
  FolderSearch,
  Check,
  X,
  CheckCircle,
  Clock,
} from 'lucide-angular';
import { PermissionRequest, PermissionResponse } from '@ptah-extension/shared';
import { DenyMessagePopoverComponent } from './deny-message-popover.component';
import {
  isReadToolInput,
  isWriteToolInput,
  isEditToolInput,
  isBashToolInput,
  isGrepToolInput,
  isGlobToolInput,
} from '@ptah-extension/shared';

/**
 * PermissionRequestCardComponent - Polished card for permission requests
 *
 * Complexity Level: 2 (Signal-based with computed countdown timer)
 * Patterns: Signal-based inputs/outputs, Computed timer, Card styling with tool colors
 *
 * Features:
 * - Real-time countdown timer badge showing remaining time until timeout
 * - Tool-specific icons and border colors (matching tool-call-item)
 * - Markdown-formatted command display
 * - Three semantic action buttons: Allow, Always Allow, Deny
 * - Accessible button semantics
 *
 * SOLID Principles:
 * - Single Responsibility: Display permission request and handle user response
 * - Composition: Uses lucide-angular for icons, ngx-markdown for formatting
 */
@Component({
  selector: 'ptah-permission-request-card',
  imports: [LucideAngularModule, DenyMessagePopoverComponent],
  template: `
    <div
      class="relative bg-base-300/30 rounded border-l-2"
      [class.animate-glow]="!isExpiringSoon()"
      [class.animate-glow-urgent]="isExpiringSoon()"
      [style.border-left-color]="getToolColor()"
      role="alert"
    >
      <!-- Header row - compact VS Code style -->
      <div class="py-1.5 px-2 flex items-center gap-1.5 flex-wrap text-[11px]">
        <!-- Shield icon -->
        <lucide-angular
          [img]="ShieldAlertIcon"
          class="w-3 h-3 text-warning flex-shrink-0"
        />

        <!-- Title -->
        <span class="font-semibold text-base-content/80">Permission</span>

        <!-- Tool badge with icon - TASK_2025_100 QA Fix: Use DaisyUI badge classes for theme consistency -->
        <span
          [class]="
            'badge badge-xs font-mono px-1.5 gap-0.5 ' + getToolBadgeClass()
          "
        >
          <lucide-angular [img]="getToolIcon()" class="w-2.5 h-2.5" />
          {{ request().toolName }}
        </span>

        <!-- Description inline - compact -->
        <span
          class="text-base-content/60 truncate flex-1 font-mono text-[10px]"
          [title]="getFormattedDescriptionPlain()"
        >
          {{ getFormattedDescriptionPlain() }}
        </span>

        <!-- Expiry badge -->
        <span
          class="badge badge-xs font-mono px-1.5 gap-0.5 flex-shrink-0"
          [class.badge-warning]="!isExpiringSoon()"
          [class.badge-error]="isExpiringSoon()"
        >
          <lucide-angular [img]="ClockIcon" class="w-2.5 h-2.5" />
          {{ remainingTime() }}
        </span>
      </div>

      <!-- Action buttons - compact row -->
      <div
        class="flex gap-1.5 px-2 py-1.5 border-t border-base-300/30 bg-base-100/20"
      >
        <button
          class="btn btn-xs btn-success gap-0.5 px-2"
          (click)="respond('allow')"
          type="button"
          aria-label="Allow this request once"
          [disabled]="isDenyPopoverOpen()"
        >
          <lucide-angular [img]="CheckIcon" class="w-3 h-3" />
          Allow
        </button>
        <button
          class="btn btn-xs btn-info gap-0.5 px-2"
          (click)="respond('always_allow')"
          type="button"
          aria-label="Always allow this type of request"
          [disabled]="isDenyPopoverOpen()"
        >
          <lucide-angular [img]="CheckCircleIcon" class="w-3 h-3" />
          Always
        </button>
        <button
          class="btn btn-xs btn-error btn-outline gap-0.5 px-2"
          (click)="respond('deny')"
          type="button"
          aria-label="Deny this request and stop execution"
          [disabled]="isDenyPopoverOpen()"
        >
          <lucide-angular [img]="XIcon" class="w-3 h-3" />
          Deny
        </button>
        <!-- TASK_2025_102: Deny with Message popover - allows user to provide feedback -->
        <ptah-deny-message-popover
          [disabled]="isDenyPopoverOpen()"
          (opened)="openDenyPopover()"
          (messageSent)="handleDenyWithMessage($event)"
          (closed)="closeDenyPopover()"
        />
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PermissionRequestCardComponent {
  // Inputs
  readonly request = input.required<PermissionRequest>();

  // Outputs
  readonly responded = output<PermissionResponse>();

  // Icons
  protected readonly ShieldAlertIcon = ShieldAlert;
  protected readonly FileIcon = File;
  protected readonly TerminalIcon = Terminal;
  protected readonly SearchIcon = Search;
  protected readonly FileEditIcon = FileEdit;
  protected readonly FolderSearchIcon = FolderSearch;
  protected readonly CheckIcon = Check;
  protected readonly XIcon = X;
  protected readonly CheckCircleIcon = CheckCircle;
  protected readonly ClockIcon = Clock;

  // Timer state
  private readonly _currentTime = signal(Date.now());

  // TASK_2025_102: Deny with message popover state
  private readonly _isDenyPopoverOpen = signal(false);
  readonly isDenyPopoverOpen = this._isDenyPopoverOpen.asReadonly();

  /**
   * Computed signal for countdown timer
   * Calculates remaining time from request timeout
   */
  readonly remainingTime = computed(() => {
    const current = this._currentTime();
    const timeout = this.request().timeoutAt;
    const remaining = timeout - current;

    if (remaining <= 0) {
      return 'expired';
    }

    // Convert to human-readable format
    const seconds = Math.floor(remaining / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  });

  /**
   * Check if time is running low (less than 1 minute)
   */
  protected isExpiringSoon(): boolean {
    const timeout = this.request().timeoutAt;
    const remaining = timeout - this._currentTime();
    return remaining <= 60000; // Less than 1 minute
  }

  private timerInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Start countdown timer on component initialization
    effect((onCleanup) => {
      // Update current time every second
      this.timerInterval = setInterval(() => {
        this._currentTime.set(Date.now());

        // Auto-deny if expired
        const timeout = this.request().timeoutAt;
        if (Date.now() >= timeout) {
          this.respond('deny', 'Request timeout');
        }
      }, 1000);

      // Cleanup interval on component destruction
      onCleanup(() => {
        if (this.timerInterval) {
          clearInterval(this.timerInterval);
          this.timerInterval = null;
        }
      });
    });
  }

  /**
   * Get tool-specific icon
   */
  protected getToolIcon(): typeof File {
    const toolName = this.request().toolName;
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

  /**
   * Get tool-specific color for border and badge
   * Uses oklch CSS variables for theme-aware styling
   * TASK_2025_100 Batch 4: Migrated from hardcoded hex to oklch(var(--xxx)) format
   */
  protected getToolColor(): string {
    const toolName = this.request().toolName;
    switch (toolName) {
      case 'Read':
        return 'oklch(var(--in))'; // info (blue) - file reading
      case 'Write':
        return 'oklch(var(--su))'; // success (green) - file creation
      case 'Bash':
        return 'oklch(var(--wa))'; // warning (amber) - shell commands
      case 'Grep':
        return 'oklch(var(--s))'; // secondary - search operations
      case 'Edit':
        return 'oklch(var(--a))'; // accent - file modifications
      case 'Glob':
        return 'oklch(var(--in))'; // info - file pattern matching
      default:
        return 'oklch(var(--wa))'; // warning (amber) - default
    }
  }

  /**
   * Get tool-specific DaisyUI badge class for consistent styling
   * TASK_2025_100 QA Fix: Aligns with tool-icon.component.ts pattern
   * Uses DaisyUI badge classes for theme-aware styling instead of inline oklch
   */
  protected getToolBadgeClass(): string {
    const toolName = this.request().toolName;
    switch (toolName) {
      case 'Read':
        return 'badge-info'; // info (blue) - file reading
      case 'Write':
        return 'badge-success'; // success (green) - file creation
      case 'Bash':
        return 'badge-warning'; // warning (amber) - shell commands
      case 'Grep':
        return 'badge-secondary'; // secondary - search operations
      case 'Edit':
        return 'badge-accent'; // accent - file modifications
      case 'Glob':
        return 'badge-info'; // info - file pattern matching
      default:
        return 'badge-warning'; // warning (amber) - default
    }
  }

  /**
   * Format the description with markdown code styling
   * Extracts command/path from description and wraps in backticks
   * TASK_2025_088 Batch 5 Task 5.2: Use type guards for type-safe access
   */
  protected getFormattedDescription(): string {
    const description = this.request().description;
    const toolInput = this.request().toolInput;

    // Format based on tool type using type guards
    if (isBashToolInput(toolInput)) {
      const command = toolInput.command;
      return `Execute bash command: \`${command}\``;
    }
    if (isReadToolInput(toolInput)) {
      const filePath = toolInput.file_path;
      return `Read file: \`${filePath}\``;
    }
    if (isWriteToolInput(toolInput)) {
      const filePath = toolInput.file_path;
      return `Write file: \`${filePath}\``;
    }
    if (isEditToolInput(toolInput)) {
      const filePath = toolInput.file_path;
      return `Edit file: \`${filePath}\``;
    }
    if (isGlobToolInput(toolInput)) {
      const pattern = toolInput.pattern;
      return `Search files matching: \`${pattern}\``;
    }
    if (isGrepToolInput(toolInput)) {
      const pattern = toolInput.pattern;
      return `Search content for: \`${pattern}\``;
    }

    // Fallback to original description
    // Try to extract and format any quoted content
    const colonIndex = description.indexOf(':');
    if (colonIndex > 0) {
      const prefix = description.substring(0, colonIndex + 1);
      const value = description.substring(colonIndex + 1).trim();
      return `${prefix} \`${value}\``;
    }

    return description;
  }

  /**
   * Get plain text description for compact inline display (no markdown)
   * Used in VS Code-style compact header
   */
  protected getFormattedDescriptionPlain(): string {
    const toolInput = this.request().toolInput;

    // Format based on tool type using type guards - return short plain text
    if (isBashToolInput(toolInput)) {
      const cmd = toolInput.command;
      return cmd.length > 40 ? cmd.substring(0, 40) + '...' : cmd;
    }
    if (isReadToolInput(toolInput)) {
      return this.shortenPath(toolInput.file_path);
    }
    if (isWriteToolInput(toolInput)) {
      return this.shortenPath(toolInput.file_path);
    }
    if (isEditToolInput(toolInput)) {
      return this.shortenPath(toolInput.file_path);
    }
    if (isGlobToolInput(toolInput)) {
      const pattern = toolInput.pattern;
      return pattern.length > 30 ? pattern.substring(0, 30) + '...' : pattern;
    }
    if (isGrepToolInput(toolInput)) {
      const pattern = toolInput.pattern;
      return pattern.length > 30 ? pattern.substring(0, 30) + '...' : pattern;
    }

    // Fallback to original description
    const description = this.request().description;
    return description.length > 50
      ? description.substring(0, 50) + '...'
      : description;
  }

  /**
   * Shorten file path for compact display
   */
  private shortenPath(path: string): string {
    if (!path) return '';
    const parts = path.replace(/\\/g, '/').split('/');
    if (parts.length <= 2) return path;
    return '.../' + parts.slice(-2).join('/');
  }

  /**
   * Handle user response to permission request
   * TASK_2025_102: Updated type to include 'deny_with_message'
   */
  protected respond(
    decision: 'allow' | 'deny' | 'always_allow' | 'deny_with_message',
    reason?: string
  ): void {
    // Clear timer before responding
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }

    // Emit response
    this.responded.emit({
      id: this.request().id,
      decision,
      reason,
    });
  }

  // ============================================================================
  // TASK_2025_102: Deny with Message Popover Methods
  // ============================================================================

  /**
   * Open the deny message popover
   */
  openDenyPopover(): void {
    this._isDenyPopoverOpen.set(true);
  }

  /**
   * Close the deny message popover
   */
  closeDenyPopover(): void {
    this._isDenyPopoverOpen.set(false);
  }

  /**
   * Handle deny with message - called when user submits message from popover
   * TASK_2025_102 Batch 3 Task 3.5
   *
   * This allows Claude to continue execution with the user's feedback,
   * unlike hard deny which stops execution.
   *
   * @param message - The message to send to Claude explaining the denial
   */
  handleDenyWithMessage(message: string): void {
    // Clear timer before responding
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }

    // Close popover
    this._isDenyPopoverOpen.set(false);

    // Emit response with deny_with_message decision
    this.responded.emit({
      id: this.request().id,
      decision: 'deny_with_message',
      reason: message,
    });
  }
}
