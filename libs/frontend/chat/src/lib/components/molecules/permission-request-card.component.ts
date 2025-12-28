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
import { MarkdownModule } from 'ngx-markdown';
import { PermissionRequest, PermissionResponse } from '@ptah-extension/shared';

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
  standalone: true,
  imports: [LucideAngularModule, MarkdownModule],
  template: `
    <div
      class="card bg-base-200 shadow-lg overflow-hidden border border-base-300/50"
      role="alert"
    >
      <!-- Colored left border stripe -->
      <div
        class="absolute left-0 top-0 bottom-0 w-1"
        [style.background-color]="getToolColor()"
      ></div>

      <!-- Header -->
      <div class="px-4 py-3 pl-5">
        <!-- Title row -->
        <div class="flex items-center gap-2 flex-wrap">
          <!-- Shield icon -->
          <lucide-angular
            [img]="ShieldAlertIcon"
            class="w-4 h-4 text-warning flex-shrink-0"
          />

          <!-- Title -->
          <span class="font-semibold text-sm">Permission Required</span>

          <span class="text-base-content/40">|</span>

          <!-- Tool badge with icon -->
          <div class="flex items-center gap-1.5">
            <span class="text-xs text-base-content/60">Tool:</span>
            <span
              class="badge badge-sm font-mono gap-1"
              [style.background-color]="getToolColor()"
              style="color: white; border: none"
            >
              <lucide-angular [img]="getToolIcon()" class="w-3 h-3" />
              {{ request().toolName }}
            </span>
          </div>

          <span class="text-base-content/40">|</span>

          <!-- Expiry badge -->
          <div class="flex items-center gap-1.5">
            <span class="text-xs text-base-content/60">Expires:</span>
            <span
              class="badge badge-sm font-mono gap-1"
              [class.badge-warning]="!isExpiringSoon()"
              [class.badge-error]="isExpiringSoon()"
            >
              <lucide-angular [img]="ClockIcon" class="w-3 h-3" />
              {{ remainingTime() }}
            </span>
          </div>
        </div>

        <!-- Description body with markdown -->
        <div class="mt-3 text-sm">
          <markdown
            [data]="getFormattedDescription()"
            class="prose prose-sm prose-invert max-w-none [&_code]:bg-base-300 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-warning [&_code]:font-mono [&_code]:text-xs"
          />
        </div>
      </div>

      <!-- Action buttons -->
      <div
        class="flex gap-2 px-4 py-3 pl-5 border-t border-base-300/30 bg-base-100/30"
      >
        <button
          class="btn btn-sm flex-1 gap-1"
          [class.btn-success]="true"
          (click)="respond('allow')"
          type="button"
          aria-label="Allow this request once"
        >
          <lucide-angular [img]="CheckIcon" class="w-4 h-4" />
          Allow
        </button>
        <button
          class="btn btn-info btn-sm flex-1 gap-1"
          (click)="respond('always_allow')"
          type="button"
          aria-label="Always allow this type of request"
        >
          <lucide-angular [img]="CheckCircleIcon" class="w-4 h-4" />
          Always Allow
        </button>
        <button
          class="btn btn-error btn-outline btn-sm flex-1 gap-1"
          (click)="respond('deny')"
          type="button"
          aria-label="Deny this request"
        >
          <lucide-angular [img]="XIcon" class="w-4 h-4" />
          Deny
        </button>
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
   */
  protected getToolColor(): string {
    const toolName = this.request().toolName;
    switch (toolName) {
      case 'Read':
        return '#60a5fa'; // blue-400
      case 'Write':
        return '#4ade80'; // green-400
      case 'Bash':
        return '#fbbf24'; // amber-400
      case 'Grep':
        return '#a855f7'; // purple-400
      case 'Edit':
        return '#fb923c'; // orange-400
      case 'Glob':
        return '#06b6d4'; // cyan-400
      default:
        return '#f59e0b'; // amber-500 (warning)
    }
  }

  /**
   * Format the description with markdown code styling
   * Extracts command/path from description and wraps in backticks
   */
  protected getFormattedDescription(): string {
    const description = this.request().description;
    const toolName = this.request().toolName;
    const toolInput = this.request().toolInput;

    // Format based on tool type
    switch (toolName) {
      case 'Bash': {
        const command = toolInput?.['command'] as string | undefined;
        if (command) {
          return `Execute bash command: \`${command}\``;
        }
        break;
      }
      case 'Read': {
        const filePath = toolInput?.['file_path'] as string | undefined;
        if (filePath) {
          return `Read file: \`${filePath}\``;
        }
        break;
      }
      case 'Write': {
        const filePath = toolInput?.['file_path'] as string | undefined;
        if (filePath) {
          return `Write file: \`${filePath}\``;
        }
        break;
      }
      case 'Edit': {
        const filePath = toolInput?.['file_path'] as string | undefined;
        if (filePath) {
          return `Edit file: \`${filePath}\``;
        }
        break;
      }
      case 'Glob': {
        const pattern = toolInput?.['pattern'] as string | undefined;
        if (pattern) {
          return `Search files matching: \`${pattern}\``;
        }
        break;
      }
      case 'Grep': {
        const pattern = toolInput?.['pattern'] as string | undefined;
        if (pattern) {
          return `Search content for: \`${pattern}\``;
        }
        break;
      }
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
   * Handle user response to permission request
   */
  protected respond(
    decision: 'allow' | 'deny' | 'always_allow',
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
}
