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
 * TASK_2025_213: Displays each interrupted subagent individually with its own
 * resume button. Shows agent type badge, truncated agentId, time since
 * interruption, and a per-agent "Resume" action.
 *
 * Complexity Level: 1 (Simple component with signal-based state)
 * Patterns Applied:
 * - Signal-based inputs/outputs (Angular 20+)
 * - ChangeDetectionStrategy.OnPush for performance
 * - DaisyUI alert-warning styling (interrupted = warning state)
 *
 * SOLID Principles:
 * - Single Responsibility: Display resumable agent notification and handle per-agent resume actions
 */
@Component({
  selector: 'ptah-resume-notification-banner',
  imports: [LucideAngularModule],
  template: `
    @if (resumableSubagents().length > 0 && !dismissed()) {
    <div
      class="alert alert-warning shadow-lg mb-4 py-2 px-3"
      role="alert"
      aria-label="Interrupted agents that can be resumed"
    >
      <div class="flex flex-col gap-1 flex-1 min-w-0">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <lucide-angular
              [img]="PlayCircleIcon"
              class="w-5 h-5 flex-shrink-0"
              aria-hidden="true"
            />
            <h3 class="font-bold text-sm">Interrupted Agents</h3>
          </div>
          <button
            type="button"
            class="btn btn-sm btn-ghost btn-square"
            (click)="onDismiss()"
            title="Dismiss notification"
            aria-label="Dismiss interrupted agents notification"
          >
            <lucide-angular [img]="XIcon" class="w-4 h-4" />
          </button>
        </div>
        @for (agent of resumableSubagents(); track agent.toolCallId) {
        <div class="flex items-center justify-between gap-2 py-1">
          <div class="flex items-center gap-2 min-w-0">
            <span class="badge badge-sm badge-outline">{{
              agent.agentType
            }}</span>
            <span
              class="text-xs opacity-70 font-mono truncate max-w-[8ch]"
              [title]="agent.agentId"
              >{{ agent.agentId }}</span
            >
            <span class="text-xs opacity-50">{{
              getTimeSince(agent.interruptedAt)
            }}</span>
          </div>
          <button
            type="button"
            class="btn btn-xs btn-primary gap-1"
            (click)="onResume(agent)"
            [attr.aria-label]="
              'Resume ' + agent.agentType + ' agent ' + agent.agentId
            "
          >
            <lucide-angular
              [img]="PlayCircleIcon"
              class="w-3 h-3"
              aria-hidden="true"
            />
            Resume
          </button>
        </div>
        }
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
   * Emits when user clicks a specific agent's "Resume" button.
   * The parent handler should build a resume prompt and send it via ChatStore.
   */
  readonly resumeRequested = output<SubagentRecord>();

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
   * Handle individual agent "Resume" button click
   */
  protected onResume(agent: SubagentRecord): void {
    this.resumeRequested.emit(agent);
  }

  /**
   * Handle dismiss button click
   */
  protected onDismiss(): void {
    this.dismissed.set(true);
  }

  /**
   * Compute a human-readable relative time string from a timestamp.
   * Returns "just now", "X min ago", or "X hr ago" depending on elapsed time.
   */
  protected getTimeSince(timestamp: number | undefined): string {
    if (timestamp == null) {
      return '';
    }

    const now = Date.now();
    const elapsedMs = now - timestamp;

    if (elapsedMs < 0) {
      return '';
    }

    const seconds = Math.floor(elapsedMs / 1000);

    if (seconds < 60) {
      return 'just now';
    }

    const minutes = Math.floor(seconds / 60);

    if (minutes < 60) {
      return `${minutes} min ago`;
    }

    const hours = Math.floor(minutes / 60);
    return `${hours} hr ago`;
  }
}
