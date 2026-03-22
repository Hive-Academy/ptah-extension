import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { DashboardSessionEntry } from '../../services/session-analytics-state.service';
import { formatCost, formatTokenCount } from '../../utils/format.utils';

/**
 * SessionStatsCardComponent
 *
 * Presentational card displaying per-session statistics:
 * session name, model badge, cost, messages, input/output tokens,
 * and optional cache stats.
 *
 * Design matches the card style system from SessionStatsSummaryComponent:
 * - bg-base-200/50 card with border-base-300
 * - 2x2 inner grid with color-coded mini stat cells
 * - DaisyUI badge for model display name
 *
 * TASK_2025_206 v2: Replaces the flat table row in SessionHistoryTableComponent
 */
@Component({
  selector: 'ptah-session-stats-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  template: `
    <div
      role="article"
      [attr.aria-label]="'Session: ' + session().name"
      class="bg-base-200/50 rounded-lg p-3 border border-base-300 space-y-2"
    >
      <!-- Header: Name + Model Badge + Date -->
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <h3 class="text-sm font-semibold truncate" [title]="session().name">
            {{ session().name }}
          </h3>
          <div class="text-[10px] text-base-content/50 mt-0.5">
            {{ formatDate(session().lastActivityAt) }}
          </div>
          @if (session().status === 'error') {
          <div class="text-[10px] text-warning flex items-center gap-1">
            <span aria-hidden="true">&#9888;</span>
            <span>Stats unavailable</span>
          </div>
          }
        </div>
        @if (session().model) {
        <span
          class="badge badge-sm border-purple-600/30 text-purple-400 bg-purple-600/10 whitespace-nowrap"
        >
          {{ session().modelDisplayName }}
        </span>
        }
      </div>

      <!-- Stats Grid: 2x2 mini cards -->
      <div class="grid grid-cols-2 gap-1.5">
        <!-- Cost -->
        <div
          class="bg-base-300/30 rounded px-2 py-1.5 border border-success/20"
        >
          <div
            class="text-[10px] uppercase tracking-wider text-base-content/50 leading-tight"
          >
            Cost
          </div>
          <div
            class="text-sm font-semibold text-success tabular-nums leading-tight mt-0.5"
          >
            {{ formatCost(session().totalCost) }}
          </div>
        </div>

        <!-- Messages -->
        <div class="bg-base-300/30 rounded px-2 py-1.5 border border-info/20">
          <div
            class="text-[10px] uppercase tracking-wider text-base-content/50 leading-tight"
          >
            Messages
          </div>
          <div
            class="text-sm font-semibold text-info tabular-nums leading-tight mt-0.5"
          >
            {{ session().messageCount }}
          </div>
        </div>

        <!-- Input Tokens -->
        <div
          class="bg-base-300/30 rounded px-2 py-1.5 border border-cyan-600/20"
        >
          <div
            class="text-[10px] uppercase tracking-wider text-base-content/50 leading-tight"
          >
            Input
          </div>
          <div
            class="text-sm font-semibold text-cyan-400 tabular-nums leading-tight mt-0.5"
          >
            {{ formatTokenCount(session().tokens.input) }}
          </div>
        </div>

        <!-- Output Tokens -->
        <div
          class="bg-base-300/30 rounded px-2 py-1.5 border border-purple-600/20"
        >
          <div
            class="text-[10px] uppercase tracking-wider text-base-content/50 leading-tight"
          >
            Output
          </div>
          <div
            class="text-sm font-semibold text-purple-400 tabular-nums leading-tight mt-0.5"
          >
            {{ formatTokenCount(session().tokens.output) }}
          </div>
        </div>
      </div>

      <!-- Cache stats row (conditional - only show if cache > 0) -->
      @if ( session().tokens.cacheRead > 0 || session().tokens.cacheCreation > 0
      ) {
      <div class="flex gap-3 text-[10px] text-base-content/50 px-1">
        @if (session().tokens.cacheRead > 0) {
        <span
          >Cache Read:
          <span class="text-base-content/70 tabular-nums">{{
            formatTokenCount(session().tokens.cacheRead)
          }}</span></span
        >
        } @if (session().tokens.cacheCreation > 0) {
        <span
          >Cache Write:
          <span class="text-base-content/70 tabular-nums">{{
            formatTokenCount(session().tokens.cacheCreation)
          }}</span></span
        >
        }
      </div>
      }
    </div>
  `,
})
export class SessionStatsCardComponent {
  readonly session = input.required<DashboardSessionEntry>();

  readonly formatCost = formatCost;
  readonly formatTokenCount = formatTokenCount;

  /**
   * Format a timestamp to a readable date string with time.
   * Returns 'Unknown' for falsy, NaN, or epoch-zero timestamps.
   * Example: "Mar 15, 2026, 2:30 PM"
   */
  formatDate(timestamp: number): string {
    if (!timestamp || isNaN(timestamp)) return 'Unknown';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return 'Unknown';
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
}
