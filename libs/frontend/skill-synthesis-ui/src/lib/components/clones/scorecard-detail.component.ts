import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import type { ScorecardInvocationRow } from '@ptah-extension/shared';

/**
 * ScorecardDetailComponent — pure presentational atom.
 *
 * Lazily-loaded scorecard detail for an expanded agent card: a table of recent
 * graded runs (task, verdict, tokens, cost, duration). Heuristically-attributed
 * rows (`exactAttribution === false`, i.e. `spec-window:` provenance) are marked
 * distinctly (R7.2). An empty list explains how data accrues rather than showing
 * a bare empty state (R7.3). The findings excerpt is rendered exclusively
 * through `@ptah-extension/markdown` (the DOMPurify chokepoint) — never raw
 * `[innerHTML]`. No service coupling; `input()` signals + OnPush only.
 */
@Component({
  selector: 'ptah-scorecard-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MarkdownBlockComponent],
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
      <table class="table table-xs" data-testid="scorecard-detail-table">
        <thead>
          <tr class="text-base-content/50">
            <th scope="col" class="font-normal">Task</th>
            <th scope="col" class="font-normal">Verdict</th>
            <th scope="col" class="text-right font-normal">Tokens</th>
            <th scope="col" class="text-right font-normal">Cost</th>
            <th scope="col" class="text-right font-normal">Duration</th>
          </tr>
        </thead>
        <tbody>
          @for (row of rows(); track $index) {
            <tr
              data-testid="scorecard-detail-row"
              [class.opacity-70]="!row.exactAttribution"
            >
              <td class="font-mono text-xs">
                {{ row.taskId ?? '—' }}
                @if (!row.exactAttribution) {
                  <span
                    class="badge badge-ghost badge-xs ml-1"
                    data-testid="scorecard-heuristic-marker"
                    title="Attributed heuristically by time window, not an exact task match"
                    >~approx</span
                  >
                }
              </td>
              <td>
                <span class="inline-flex items-center gap-1">
                  <span
                    class="inline-block size-1.5 rounded-full"
                    [class.bg-success]="row.succeeded"
                    [class.bg-error]="!row.succeeded"
                    aria-hidden="true"
                  ></span>
                  <span class="text-xs">{{
                    row.succeeded ? 'COMPLETE' : 'FAILED'
                  }}</span>
                </span>
              </td>
              <td class="text-right tabular-nums text-xs">
                {{ tokensCell(row) }}
              </td>
              <td class="text-right tabular-nums text-xs">
                {{ costCell(row) }}
              </td>
              <td class="text-right tabular-nums text-xs">
                {{ durationCell(row) }}
              </td>
            </tr>
          }
        </tbody>
      </table>

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

  protected tokensCell(row: ScorecardInvocationRow): string {
    const { inputTokens, outputTokens } = row;
    if (inputTokens === null && outputTokens === null) return '—';
    return `${(inputTokens ?? 0) + (outputTokens ?? 0)}`;
  }

  protected costCell(row: ScorecardInvocationRow): string {
    if (row.costUsd === null) return '—';
    return `$${row.costUsd.toFixed(row.costUsd < 0.01 ? 4 : 2)}`;
  }

  protected durationCell(row: ScorecardInvocationRow): string {
    if (row.durationMs === null) return '—';
    const seconds = row.durationMs / 1000;
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  }
}
