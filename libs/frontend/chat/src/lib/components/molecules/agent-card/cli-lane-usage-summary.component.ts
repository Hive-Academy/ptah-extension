import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { MonitoredAgent } from '@ptah-extension/chat-streaming';
import { formatEstimatedCost, formatOptionalTokens } from './stats-bar.utils';

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
    >
      <span class="text-base-content-muted" title="Reported request context">
        ctx {{ tokens(usage()?.contextTokens) }}
      </span>
      <span class="text-info/70" title="Input tokens">
        in {{ tokens(usage()?.inputTokens) }}
      </span>
      <span class="text-accent/70" title="Output tokens">
        out {{ tokens(usage()?.outputTokens) }}
      </span>
      @if (cacheReported()) {
        <span class="text-info/70" title="Prompt-cache tokens read">
          cache read {{ tokens(usage()?.cacheReadTokens) }}
        </span>
        <span class="text-info/70" title="Prompt-cache tokens written">
          cache write {{ tokens(usage()?.cacheWriteTokens) }}
        </span>
      } @else {
        <span
          class="text-base-content-muted"
          title="This provider did not report prompt-cache tokens"
        >
          cache not reported
        </span>
      }
      <span class="text-warning/70 ml-auto" title="Reported or estimated cost">
        {{ costLabel() }}
      </span>
      <span class="text-base-content-muted" title="Elapsed duration">
        {{ duration() }}
      </span>
    </div>
  `,
})
export class CliLaneUsageSummaryComponent {
  readonly agent = input.required<MonitoredAgent>();
  readonly duration = input.required<string>();

  protected readonly usage = computed(() => this.agent().usageTotals ?? null);
  protected readonly cacheReported = computed(
    () =>
      this.usage()?.cacheReadTokens !== undefined ||
      this.usage()?.cacheWriteTokens !== undefined,
  );
  protected readonly costLabel = computed(() =>
    formatEstimatedCost(this.usage()?.costUsd),
  );

  protected tokens(value: number | undefined): string {
    return formatOptionalTokens(value);
  }
}
