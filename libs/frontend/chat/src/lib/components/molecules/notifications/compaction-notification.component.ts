import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import { LucideAngularModule, RefreshCw } from 'lucide-angular';

/**
 * CompactionNotificationComponent - Banner for context compaction in progress
 *
 * TASK_2025_098: SDK Session Compaction
 *
 * Displays a notification banner when the SDK is performing automatic context
 * compaction (summarizing conversation history to stay within context limits).
 * The banner shows a spinning icon and user-friendly message explaining what's
 * happening.
 *
 * Complexity Level: 1 (Simple component with signal-based input)
 * Patterns Applied:
 * - Signal-based input (Angular 20+)
 * - ChangeDetectionStrategy.OnPush for performance
 * - DaisyUI alert styling with animate-pulse
 *
 * SOLID Principles:
 * - Single Responsibility: Display compaction notification only
 */
@Component({
  selector: 'ptah-compaction-notification',
  imports: [LucideAngularModule],
  template: `
    @if (isCompacting()) {
    <div class="alert alert-warning shadow-lg mb-4 py-2 px-3 animate-pulse">
      <div class="flex items-center gap-2 flex-1">
        <lucide-angular
          [img]="RefreshCwIcon"
          class="w-5 h-5 flex-shrink-0 animate-spin"
        />
        <div class="flex-1 min-w-0">
          <h3 class="font-bold text-sm">Optimizing Context</h3>
          <p class="text-xs opacity-80">
            Summarizing conversation history to continue...
          </p>
        </div>
      </div>
    </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompactionNotificationComponent {
  /**
   * Whether compaction is currently in progress
   */
  readonly isCompacting = input.required<boolean>();

  /**
   * RefreshCw icon for spinning animation
   */
  protected readonly RefreshCwIcon = RefreshCw;
}
