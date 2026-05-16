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
 * Displays each interrupted subagent individually with its own resume button.
 * Shows agent type badge, truncated agentId, time since interruption, and a
 * per-agent "Resume" action.
 *
 * Complexity Level: 1 (Simple component with signal-based state)
 * Patterns Applied:
 * - Signal-based inputs/outputs (Angular 20+)
 * - ChangeDetectionStrategy.OnPush for performance
 * - Permission-card styling (bg-base-300/30, border-l-2 border-warning)
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
        class="relative bg-base-300/30 rounded border border-warning/40"
        role="alert"
        aria-label="Interrupted agents that can be resumed"
      >
        <!-- Header row - compact, matching permission card style -->
        <div class="py-1.5 px-2 flex items-center gap-1.5 text-[11px]">
          <lucide-angular
            [img]="PlayCircleIcon"
            class="w-3 h-3 text-warning flex-shrink-0"
            aria-hidden="true"
          />
          <span class="font-semibold text-base-content/80">Interrupted</span>
          <span class="badge badge-xs badge-warning font-mono px-1.5">
            {{ resumableSubagents().length }}
          </span>
          <span class="flex-1"></span>
          @if (resumableSubagents().length > 1) {
            <button
              type="button"
              class="btn btn-xs btn-primary gap-0.5 px-2"
              (click)="onResumeAll()"
              aria-label="Resume all interrupted agents"
            >
              <lucide-angular
                [img]="PlayCircleIcon"
                class="w-3 h-3"
                aria-hidden="true"
              />
              Resume All
            </button>
          }
          <button
            type="button"
            class="btn btn-ghost btn-xs btn-square h-5 w-5 min-h-0"
            (click)="onDismiss()"
            title="Dismiss"
            aria-label="Dismiss interrupted agents notification"
          >
            <lucide-angular [img]="XIcon" class="w-3 h-3 opacity-50" />
          </button>
        </div>

        <!-- Agent list - separated by subtle divider -->
        @for (agent of resumableSubagents(); track agent.toolCallId) {
          <div
            class="flex items-center gap-1.5 px-2 py-1.5 border-t border-base-300/30 bg-base-100/20"
          >
            <span
              class="badge badge-xs font-mono px-1.5 badge-warning badge-outline"
            >
              {{ agent.agentType }}
            </span>
            <span
              class="text-[10px] text-base-content/50 font-mono truncate max-w-[8ch]"
              [title]="agent.agentId"
            >
              {{ agent.agentId }}
            </span>
            <span class="text-[10px] text-base-content/40">
              {{ getTimeSince(agent.interruptedAt) }}
            </span>
            <span class="flex-1"></span>
            <button
              type="button"
              class="btn btn-xs btn-primary gap-0.5 px-2"
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
     * Auto-reset dismissed state when new subagents arrive.
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
   * Emits all agents when user clicks "Resume All".
   * The parent handler should build a single combined prompt for all agents.
   */
  readonly resumeAllRequested = output<SubagentRecord[]>();

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
   * Handle "Resume All" button click — emits all agents at once
   */
  protected onResumeAll(): void {
    this.resumeAllRequested.emit([...this.resumableSubagents()]);
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
