import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type { AgentScorecard } from '@ptah-extension/shared';

/**
 * ScorecardBadgeComponent — pure presentational atom.
 *
 * Compact per-agent scorecard summary shown inline on an agent clone card:
 * reconciled success-rate badge, invocation count, avg tokens, avg cost, and
 * a last-5 verdict-dot strip (COMPLETE/FAILED). An ungraded agent renders
 * "No grade" — the same label `formatSuccessRate` gives a null rate — never a
 * fabricated 0% or NaN (R6.3). Absent usage metrics still render "no data
 * yet"; tokens and cost are treated independently so a usage-bearing but
 * price-less provider still shows tokens (D8). No service coupling; `input()`
 * signals + OnPush only.
 */
@Component({
  selector: 'ptah-scorecard-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <div
      class="flex flex-wrap items-center gap-2 text-xs"
      data-testid="scorecard-badge"
    >
      <span
        class="badge badge-sm"
        [class.badge-success]="successTone() === 'good'"
        [class.badge-error]="successTone() === 'bad'"
        [class.badge-ghost]="successTone() === 'none'"
        [title]="successTitle()"
        data-testid="scorecard-success"
      >
        {{ successLabel() }}
      </span>

      <span
        class="tabular-nums text-base-content-muted"
        data-testid="scorecard-invocations"
      >
        {{ invocationsLabel() }}
      </span>

      <span
        class="tabular-nums text-base-content-muted"
        data-testid="scorecard-tokens"
      >
        {{ tokensLabel() }}
      </span>

      <span
        class="tabular-nums text-base-content-muted"
        data-testid="scorecard-cost"
      >
        {{ costLabel() }}
      </span>

      @if (verdicts().length > 0) {
        <span
          class="inline-flex items-center gap-0.5"
          aria-label="Recent verdicts (most recent last)"
          data-testid="scorecard-verdict-dots"
        >
          @for (v of verdicts(); track $index) {
            <span
              class="inline-block size-1.5 rounded-full"
              [class.bg-success]="v.succeeded"
              [class.bg-error]="!v.succeeded"
              [title]="v.succeeded ? 'COMPLETE' : 'FAILED'"
            ></span>
          }
        </span>
      }
    </div>
  `,
})
export class ScorecardBadgeComponent {
  public readonly scorecard = input<AgentScorecard | null | undefined>(null);

  private readonly noData = 'no data yet';

  /** Batch-7 label for an absent grade — identical to `formatSuccessRate`. */
  private readonly noGrade = 'No grade';

  /** Most-recent-last, capped to the last five verdicts. */
  protected readonly verdicts = computed(
    () => this.scorecard()?.recentVerdicts?.slice(-5) ?? [],
  );

  protected readonly successTone = computed<'good' | 'bad' | 'none'>(() => {
    const rate = this.gradedRate();
    if (rate === null) return 'none';
    return rate >= 0.5 ? 'good' : 'bad';
  });

  protected successLabel(): string {
    const rate = this.gradedRate();
    return rate === null ? this.noGrade : `${Math.round(rate * 100)}% ok`;
  }

  /**
   * The graded success rate, or null when the agent is ungraded. The
   * `typeof` guard is the narrowing test, as in `formatSuccessRate`:
   * `Number.isFinite` accepts `unknown` and narrows nothing, so it can only
   * run after the union is narrowed to `number`. A null, absent or
   * non-finite rate is the same fact — no grade — and must never become
   * `0% ok` or `NaN% ok`.
   */
  private gradedRate(): number | null {
    const rate = this.scorecard()?.gradedSuccessRate;
    if (typeof rate !== 'number' || !Number.isFinite(rate)) return null;
    return rate;
  }

  protected successTitle(): string {
    const sc = this.scorecard();
    if (!sc || sc.gradedCount <= 0) return 'No graded runs yet';
    return `${sc.gradedCount} graded run(s)`;
  }

  protected invocationsLabel(): string {
    return `${this.scorecard()?.totalInvocations ?? 0} inv`;
  }

  protected tokensLabel(): string {
    const sc = this.scorecard();
    const inTok = sc?.avgInputTokens ?? null;
    const outTok = sc?.avgOutputTokens ?? null;
    if (inTok === null && outTok === null) return `tokens: ${this.noData}`;
    const avg = Math.round((inTok ?? 0) + (outTok ?? 0));
    return `~${this.formatCompact(avg)} tok`;
  }

  protected costLabel(): string {
    const cost = this.scorecard()?.avgCostUsd ?? null;
    if (cost === null) return `cost: ${this.noData}`;
    return `~$${cost.toFixed(cost < 0.01 ? 4 : 2)}`;
  }

  private formatCompact(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
  }
}
