import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import {
  resolveModelDisplayName,
  type SessionStatsEntry,
} from '@ptah-extension/shared';
import { ModelStateService } from '@ptah-extension/core';

/** One per-model row of the backend snapshot. */
type ModelUsageRow = NonNullable<SessionStatsEntry['modelUsageList']>[number];

/** Per-model usage table shown when a session includes multiple models. */
@Component({
  selector: 'ptah-session-model-breakdown',
  standalone: true,
  template: `
    @if (snapshot(); as stats) {
      <div
        class="mt-1.5 bg-base-200/50 rounded border border-purple-600/20 overflow-hidden"
        role="table"
        aria-label="Per-model usage"
        data-testid="model-usage-table"
      >
        <div
          class="model-usage-row px-2 py-1 border-b border-base-content/10"
          role="row"
          data-testid="model-usage-header"
        >
          <div
            class="text-[10px] leading-tight uppercase tracking-wider text-base-content-muted"
            role="columnheader"
          >
            Model
          </div>
          <div
            class="text-[10px] leading-tight uppercase tracking-wider text-base-content-muted text-right"
            role="columnheader"
            title="Uncached input tokens"
          >
            In
          </div>
          <div
            class="text-[10px] leading-tight uppercase tracking-wider text-base-content-muted text-right"
            role="columnheader"
            title="Output tokens"
          >
            Out
          </div>
          <div
            class="text-[10px] leading-tight uppercase tracking-wider text-base-content-muted text-right"
            role="columnheader"
            title="Cache read tokens"
          >
            Cache Read
          </div>
          <div
            class="text-[10px] leading-tight uppercase tracking-wider text-base-content-muted text-right"
            role="columnheader"
            title="Cache creation tokens"
          >
            Cache Creation
          </div>
          <div
            class="text-[10px] leading-tight uppercase tracking-wider text-base-content-muted text-right"
            role="columnheader"
          >
            Cost
          </div>
        </div>
        @for (usage of modelRows(); track usage.model) {
          <div
            class="model-usage-row px-2 py-1.5 border-b border-base-content/5 last:border-b-0"
            role="row"
            data-testid="model-usage-row"
          >
            <div
              class="text-xs font-semibold text-base-content truncate"
              role="cell"
              [title]="usage.model"
            >
              {{ formatModelName(usage.model) }}
            </div>
            <div
              class="text-xs text-right tabular-nums text-base-content-muted"
              role="cell"
            >
              {{ formatTokens(usage.inputTokens) }}
            </div>
            <div
              class="text-xs text-right tabular-nums text-base-content-muted"
              role="cell"
            >
              {{ formatTokens(usage.outputTokens) }}
            </div>
            <div
              class="text-xs text-right tabular-nums text-base-content-muted"
              role="cell"
            >
              {{ formatOptionalTokens(usage.cacheRead) }}
            </div>
            <div
              class="text-xs text-right tabular-nums text-base-content-muted"
              role="cell"
            >
              {{ formatOptionalTokens(usage.cacheCreation) }}
            </div>
            <div
              class="text-xs text-right tabular-nums text-success"
              role="cell"
            >
              {{ formatCost(usage.costUSD) }}
            </div>
          </div>
        }
        <!-- Totals row: the snapshot's own totals, never a sum of rows -->
        <div
          class="model-usage-row px-2 py-1.5 border-t border-base-content/10 bg-base-300/30"
          role="row"
          data-testid="model-usage-total"
        >
          <div class="text-xs font-semibold" role="cell">Total</div>
          <div
            class="text-xs text-right tabular-nums font-semibold"
            role="cell"
          >
            {{ formatTokens(stats.tokens.input) }}
          </div>
          <div
            class="text-xs text-right tabular-nums font-semibold"
            role="cell"
          >
            {{ formatTokens(stats.tokens.output) }}
          </div>
          <div
            class="text-xs text-right tabular-nums font-semibold"
            role="cell"
          >
            {{ formatTokens(stats.tokens.cacheRead) }}
          </div>
          <div
            class="text-xs text-right tabular-nums font-semibold"
            role="cell"
          >
            {{ formatTokens(stats.tokens.cacheCreation) }}
          </div>
          <div
            class="text-xs text-right tabular-nums font-semibold text-success"
            role="cell"
          >
            {{ formatCost(stats.totalCost) }}
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .model-usage-row {
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) repeat(5, minmax(0, 1fr));
      gap: 0.25rem;
      align-items: end;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionModelBreakdownComponent {
  private readonly modelState = inject(ModelStateService);

  readonly snapshot = input<SessionStatsEntry | null>(null);
  readonly modelRows = computed<readonly ModelUsageRow[]>(
    () => this.snapshot()?.modelUsageList ?? [],
  );

  protected formatCost(cost: number | null): string {
    if (cost === null) return '\u2014';
    return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
  }

  protected formatTokens(count: number): string {
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
    return count.toString();
  }

  protected formatOptionalTokens(count: number | undefined): string {
    return typeof count === 'number' ? this.formatTokens(count) : '\u2014';
  }

  protected formatModelName(modelId: string): string {
    return resolveModelDisplayName(modelId, this.modelState.availableModels());
  }
}
