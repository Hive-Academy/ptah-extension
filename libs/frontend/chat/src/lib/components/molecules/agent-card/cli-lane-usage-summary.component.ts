import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { MonitoredAgent } from '@ptah-extension/chat-streaming';
import { hasReportedCliCacheTokens } from '@ptah-extension/shared';
import { formatEstimatedCost, formatOptionalTokens, usageTotalsFromSegments } from './stats-bar.utils';

/** Compact lane-usage card using the same value formatting as chat's subagent summary. */
@Component({
  selector: 'ptah-cli-lane-usage-summary',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1 mb-1.5 rounded bg-base-200/50 border border-base-content/5 text-[10px] font-mono"
      [class.!px-0]="presentation() === 'flat'"
      [class.!border-0]="presentation() === 'flat'"
      [class.!rounded-none]="presentation() === 'flat'"
      [class.!bg-transparent]="presentation() === 'flat'"
      role="group"
      aria-label="Lane usage"
      [attr.title]="partial() ? 'From retained output, may be partial' : null"
    >
      <span class="text-base-content-muted" title="Reported request context">
        ctx {{ tokens(structured()?.contextTokens) }}
      </span>
      @if (usage()?.inputTokens !== undefined) {
        <span class="text-info/70" title="Input tokens">
          in {{ tokens(usage()?.inputTokens, partial()) }}
        </span>
      }
      @if (usage()?.outputTokens !== undefined) {
        <span class="text-accent/70" title="Output tokens">
          out {{ tokens(usage()?.outputTokens, partial()) }}
        </span>
      }
      @if (cacheReported()) {
        @if (structured()?.cacheReadTokens !== undefined) {
          <span class="text-info/70" title="Prompt-cache tokens read">
            cache read {{ tokens(structured()?.cacheReadTokens) }}
          </span>
        }
        @if (structured()?.cacheWriteTokens !== undefined) {
          <span class="text-info/70" title="Prompt-cache tokens written">
            cache write {{ tokens(structured()?.cacheWriteTokens) }}
          </span>
        }
      }
      <span class="text-warning/70 ml-auto" title="Reported or estimated cost">
        {{ costLabel() }}
      </span>
      @if (presentation() === 'card') {
        <span class="text-base-content-muted" title="Elapsed duration">
          {{ duration() }}
        </span>
      }
    </div>
  `,
})
export class CliLaneUsageSummaryComponent {
  readonly agent = input.required<MonitoredAgent>();
  readonly presentation = input<'card' | 'flat'>('card');
  readonly duration = input.required<string>();

  protected readonly structured = computed(() => this.agent().usageTotals ?? null);
  private readonly fallbackUsage = computed(() =>
    this.agent().usageTotals == null ? usageTotalsFromSegments(this.agent().segments) : null,
  );
  protected readonly usage = computed(() => {
    const agent = this.agent();
    return agent.usageTotals ?? this.fallbackUsage();
  });
  protected readonly partial = computed(() => this.fallbackUsage()?.partial === true);
  protected readonly cacheReported = computed(() =>
    hasReportedCliCacheTokens(this.structured()),
  );
  protected readonly costLabel = computed(() =>
    this.partial() && this.usage()?.costUsd != null
      ? `≥ ${formatEstimatedCost(this.usage()?.costUsd)}`
      : formatEstimatedCost(this.usage()?.costUsd),
  );

  protected tokens(value: number | undefined, partial = false): string {
    return partial && value !== undefined ? `≥ ${formatOptionalTokens(value)}` : formatOptionalTokens(value);
  }
}
