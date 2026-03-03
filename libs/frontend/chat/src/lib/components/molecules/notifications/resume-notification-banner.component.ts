import {
  Component,
  input,
  output,
  signal,
  effect,
  untracked,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, PlayCircle, X } from 'lucide-angular';
import type { SubagentRecord } from '@ptah-extension/shared';

/**
 * ResumeNotificationBannerComponent - Banner for resumable interrupted agents
 *
 * TASK_2025_103: Displays a notification banner when there are interrupted
 * subagents that can be resumed. The banner shows the count of resumable
 * agents and provides options to resume all or dismiss.
 *
 * Complexity Level: 1 (Simple component with signal-based state)
 * Patterns Applied:
 * - Signal-based inputs/outputs (Angular 20+)
 * - ChangeDetectionStrategy.OnPush for performance
 * - DaisyUI alert styling
 *
 * SOLID Principles:
 * - Single Responsibility: Display resumable agent notification and handle actions
 */
@Component({
  selector: 'ptah-resume-notification-banner',
  imports: [LucideAngularModule],
  template: `
    @if (resumableSubagents().length > 0 && !dismissed()) {
    <div class="alert alert-info shadow-lg mb-4 py-2 px-3">
      <div class="flex items-center gap-2 flex-1">
        <lucide-angular [img]="PlayCircleIcon" class="w-5 h-5 flex-shrink-0" />
        <div class="flex-1 min-w-0">
          <h3 class="font-bold text-sm">Interrupted Agents</h3>
          <p class="text-xs opacity-80">
            {{ resumableSubagents().length }} agent{{
              resumableSubagents().length === 1 ? '' : 's'
            }}
            can be resumed
          </p>
        </div>
      </div>
      <div class="flex gap-2 flex-shrink-0">
        <button
          type="button"
          class="btn btn-sm btn-primary gap-1"
          (click)="onResumeAll()"
        >
          <lucide-angular [img]="PlayCircleIcon" class="w-4 h-4" />
          Resume All
        </button>
        <button
          type="button"
          class="btn btn-sm btn-ghost btn-square"
          (click)="onDismiss()"
          title="Dismiss notification"
        >
          <lucide-angular [img]="XIcon" class="w-4 h-4" />
        </button>
      </div>
    </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResumeNotificationBannerComponent {
  /**
   * Array of resumable subagent records from ChatStore
   */
  readonly resumableSubagents = input.required<SubagentRecord[]>();

  /**
   * Track the previous count of subagents to detect new arrivals
   */
  private previousCount = 0;

  constructor() {
    /**
     * TASK_2025_103 FIX: Auto-reset dismissed state when new subagents arrive.
     * Uses effect to watch resumableSubagents input and reset dismissed state
     * when the count increases (indicating new interrupted agents).
     * This removes the coupling where parent must manually call resetDismissed().
     */
    effect(() => {
      const subagents = this.resumableSubagents();
      const currentCount = subagents.length;

      // Reset dismissed if we have NEW subagents (count increased)
      if (currentCount > this.previousCount && currentCount > 0) {
        untracked(() => this.dismissed.set(false));
      }

      // Update previous count for next comparison
      this.previousCount = currentCount;
    });
  }

  /**
   * Emits when user clicks "Resume All" button
   */
  readonly resumeAllRequested = output<void>();

  /**
   * Icons
   */
  protected readonly PlayCircleIcon = PlayCircle;
  protected readonly XIcon = X;

  /**
   * Internal state for dismissing the banner
   * Resets when resumableSubagents changes to a new non-empty array
   */
  readonly dismissed = signal(false);

  /**
   * Handle "Resume All" button click
   */
  protected onResumeAll(): void {
    this.resumeAllRequested.emit();
  }

  /**
   * Handle dismiss button click
   */
  protected onDismiss(): void {
    this.dismissed.set(true);
  }

  /**
   * Reset dismissed state manually
   * @deprecated No longer needed - the component auto-resets via effect when new subagents arrive.
   * Kept for backward compatibility.
   */
  public resetDismissed(): void {
    this.dismissed.set(false);
  }
}
