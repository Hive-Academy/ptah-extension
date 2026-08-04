import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import { NativeCardComponent, type NativeCardTone } from '@ptah-extension/ui';
import type { ScorecardInvocationRow } from '@ptah-extension/shared';

interface ScorecardMetric {
  readonly label: string;
  readonly value: string;
  readonly testId: string;
}

/** Render model for one graded run. */
interface ScorecardRow {
  readonly source: ScorecardInvocationRow;
  readonly taskLabel: string;
  readonly verdict: string;
  readonly tone: NativeCardTone;
  readonly metrics: readonly ScorecardMetric[];
}

/**
 * ScorecardDetailComponent — pure presentational atom.
 *
 * Lazily-loaded scorecard detail for an expanded agent card: the recent graded
 * runs for that agent (task, verdict, tokens, cost, duration). Each run is a
 * compact {@link NativeCardComponent} whose tone and spine carry the verdict,
 * with the verdict pill in the card header.
 *
 * Two rules the old table broke:
 *
 * - HEURISTIC ATTRIBUTION IS MARKED. Rows with `exactAttribution === false`
 *   (i.e. `spec-window:` provenance) are dimmed and badged (R7.2).
 * - MISSING IS NOT ZERO. A run whose usage was never recorded rendered four
 *   `—` cells, which reads like measured nothing. Only the metrics that exist
 *   are rendered; when none do, one sentence says so — never `0` or `$0.00`.
 *
 * An empty list explains how data accrues rather than showing a bare empty
 * state (R7.3). The findings excerpt is rendered exclusively through
 * `@ptah-extension/markdown` (the DOMPurify chokepoint) — never raw
 * `[innerHTML]`. No service coupling; `input()` signals + OnPush only.
 */
@Component({
  selector: 'ptah-scorecard-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MarkdownBlockComponent, NativeCardComponent],
  template: `
    @if (loading()) {
      <p
        class="text-xs text-base-content/60"
        data-testid="scorecard-detail-loading"
      >
        Loading graded runs…
      </p>
    } @else if (rows().length === 0) {
      <div
        class="space-y-1 text-xs text-base-content/60"
        data-testid="scorecard-detail-empty"
      >
        <p class="font-medium">No graded runs yet.</p>
        <p>
          Graded runs accrue when this agent is invoked inside orchestrated
          tasks that carry a spec verdict. Run tasks under
          <code class="rounded bg-base-300/40 px-1">.ptah/specs</code> and their
          verdicts will appear here.
        </p>
      </div>
    } @else {
      <ul
        class="flex list-none flex-col gap-1.5 p-0"
        role="list"
        data-testid="scorecard-detail-table"
      >
        @for (row of gradedRows(); track $index) {
          <li data-testid="scorecard-detail-row">
            <ptah-native-card
              [tone]="row.tone"
              [spine]="true"
              density="compact"
              [class.opacity-70]="!row.source.exactAttribution"
            >
              <div card-header class="flex items-start justify-between gap-3">
                <span class="min-w-0 truncate font-mono text-xs">
                  {{ row.taskLabel }}
                </span>
                <span class="inline-flex shrink-0 items-center gap-1.5">
                  @if (!row.source.exactAttribution) {
                    <span
                      class="badge badge-ghost badge-xs"
                      data-testid="scorecard-heuristic-marker"
                      title="Attributed heuristically by time window, not an exact task match"
                      >~approx</span
                    >
                  }
                  <span
                    class="badge badge-xs"
                    [class.badge-success]="row.source.succeeded"
                    [class.badge-error]="!row.source.succeeded"
                    data-testid="scorecard-row-verdict"
                    >{{ row.verdict }}</span
                  >
                </span>
              </div>

              @if (row.metrics.length === 0) {
                <p
                  class="text-[11px] text-base-content/55"
                  data-testid="scorecard-row-no-metrics"
                >
                  No metrics recorded for this run.
                </p>
              } @else {
                <dl
                  class="flex flex-wrap gap-x-5 gap-y-1 text-xs"
                  data-testid="scorecard-row-metrics"
                >
                  @for (m of row.metrics; track m.testId) {
                    <div class="flex items-baseline gap-1.5">
                      <dt
                        class="text-[10px] uppercase tracking-wide text-base-content/40"
                      >
                        {{ m.label }}
                      </dt>
                      <dd class="tabular-nums" [attr.data-testid]="m.testId">
                        {{ m.value }}
                      </dd>
                    </div>
                  }
                </dl>
              }
            </ptah-native-card>
          </li>
        }
      </ul>

      @if (findingsExcerpt(); as findings) {
        <div class="mt-3" data-testid="scorecard-findings">
          <p class="mb-1 text-xs font-medium text-base-content/60">
            Recent review findings
          </p>
          <ptah-markdown-block [content]="findings" />
        </div>
      }
    }
  `,
})
export class ScorecardDetailComponent {
  public readonly rows = input<ScorecardInvocationRow[]>([]);
  public readonly findingsExcerpt = input<string | null>(null);
  public readonly loading = input<boolean>(false);

  protected readonly gradedRows = computed<readonly ScorecardRow[]>(() =>
    this.rows().map((source) => ({
      source,
      taskLabel: source.taskId ?? 'Unattributed run',
      verdict: source.succeeded ? 'COMPLETE' : 'FAILED',
      tone: source.succeeded ? ('success' as const) : ('error' as const),
      metrics: buildScorecardMetrics(source),
    })),
  );
}

/**
 * Only the metrics the row actually carries. Every `null` field is OMITTED —
 * never coerced to `0` or `$0.00`.
 */
function buildScorecardMetrics(
  row: ScorecardInvocationRow,
): readonly ScorecardMetric[] {
  const out: ScorecardMetric[] = [];

  const tokens = totalTokens(row);
  if (tokens !== null) {
    out.push({
      label: 'Tokens',
      value: String(tokens),
      testId: 'scorecard-metric-tokens',
    });
  }

  if (row.costUsd !== null) {
    out.push({
      label: 'Cost',
      value: `$${row.costUsd.toFixed(row.costUsd < 0.01 ? 4 : 2)}`,
      testId: 'scorecard-metric-cost',
    });
  }

  if (row.durationMs !== null) {
    out.push({
      label: 'Duration',
      value: formatDuration(row.durationMs),
      testId: 'scorecard-metric-duration',
    });
  }

  return out;
}

/** `null` when neither token counter was recorded — not `0`. */
function totalTokens(row: ScorecardInvocationRow): number | null {
  const { inputTokens, outputTokens } = row;
  if (inputTokens === null && outputTokens === null) return null;
  return (inputTokens ?? 0) + (outputTokens ?? 0);
}

function formatDuration(durationMs: number): string {
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}
