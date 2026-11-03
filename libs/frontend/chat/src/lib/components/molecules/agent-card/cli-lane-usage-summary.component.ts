import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { MonitoredAgent } from '@ptah-extension/chat-streaming';
import {
  hasReportedCliCacheTokens,
  isValidTokenCount,
} from '@ptah-extension/shared';
import { resolveCliLaneUsage } from '../../../utils/lane-stats.adapters';
import {
  formatEstimatedCost,
  formatOptionalTokens,
} from './stats-bar.utils';

/** Compact lane-usage card using the same value formatting as chat's subagent summary. */
@Component({
  selector: 'ptah-cli-lane-usage-summary',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1 mb-1.5 rounded bg-base-200/50 border border-base-content/5 text-[10px] font-mono"
      role="group"
      aria-label="Lane usage"
      [attr.title]="partial() ? 'From retained output, may be partial' : null"
    >
      <span class="text-base-content-muted" title="Reported request context">
        ctx {{ tokens(structured()?.contextTokens) }}
      </span>
      @if (usage()?.inputTokens !== undefined) {
        <span class="text-base-content-muted" title="Input tokens">
          in {{ tokens(usage()?.inputTokens, partial()) }}
        </span>
      }
      @if (usage()?.outputTokens !== undefined) {
        <span class="text-base-content-muted" title="Output tokens">
          out {{ tokens(usage()?.outputTokens, partial()) }}
        </span>
      }
      @if (cacheReported()) {
        @if (structured()?.cacheReadTokens !== undefined) {
          <span
            class="text-base-content-muted"
            title="Prompt-cache tokens read"
          >
            cache read {{ tokens(structured()?.cacheReadTokens) }}
          </span>
        }
        @if (structured()?.cacheWriteTokens !== undefined) {
          <span
            class="text-base-content-muted"
            title="Prompt-cache tokens written"
          >
            cache write {{ tokens(structured()?.cacheWriteTokens) }}
          </span>
        }
      }
      <span
        class="ml-auto text-base-content-muted"
        title="Reported or estimated cost"
      >
        {{ costLabel() }}
      </span>
    </div>
  `,
})
export class CliLaneUsageSummaryComponent {
  readonly agent = input.required<MonitoredAgent>();

  protected readonly lane = computed(() => resolveCliLaneUsage(this.agent()));
  protected readonly structured = computed(() => this.lane().structured);
  protected readonly usage = computed(() => this.lane().usage);
  protected readonly partial = computed(() => this.lane().partial);
  protected readonly cacheReported = computed(() =>
    hasReportedCliCacheTokens(this.structured()),
  );
  protected readonly costLabel = computed(() =>
    this.partial() && this.usage()?.costUsd != null
      ? `≥ ${formatEstimatedCost(this.usage()?.costUsd)}`
      : formatEstimatedCost(this.usage()?.costUsd),
  );

  protected tokens(value: number | undefined, partial = false): string {
    return partial && isValidTokenCount(value)
      ? `≥ ${formatOptionalTokens(value)}`
      : formatOptionalTokens(value);
  }
}
