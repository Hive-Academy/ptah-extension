import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type {
  EligibilityHistogramDto,
  SkillSynthesisDrainRun,
  SkillSynthesisEventWire,
  SkillSynthesisQueueItem,
  SkillSynthesisQueueStage,
} from '@ptah-extension/shared';

/** One drain run flattened to the strings the template renders. */
interface DrainRunView {
  readonly id: string;
  readonly tierLabel: string;
  readonly status: SkillSynthesisDrainRun['status'];
  readonly statusLabel: string;
  readonly durationLabel: string;
  readonly startedLabel: string;
  readonly summary: string | null;
  /** daisyUI tone class for the status pill. */
  readonly tone: string;
}

/** One stage's share of the queued work, for the cost strip. */
interface StageCostView {
  readonly stage: SkillSynthesisQueueStage;
  readonly label: string;
  /** Queue rows currently sitting on this stage. */
  readonly rows: number;
  /**
   * Dispatches this stage's rows have already cost. Every dispatch of an
   * LLM-backed stage is one model call, so attempts — not rows — is the
   * figure that tracks spend once retries start.
   */
  readonly attempts: number;
  /** Rows not yet finished (`queued` / `claimed` / `running`). */
  readonly inFlight: number;
  /** Rows that ended in `failed`. */
  readonly failed: number;
  /** Share of total attempts, 0-100, for the bar width. */
  readonly sharePct: number;
}

const STATUS_TONE: Readonly<Record<SkillSynthesisDrainRun['status'], string>> =
  {
    pending: 'bg-base-content/40',
    running: 'bg-info',
    succeeded: 'bg-success',
    failed: 'bg-error',
    skipped: 'bg-warning',
  };

/** Queue statuses that mean the row has not reached a terminal state. */
const IN_FLIGHT_STATUSES: ReadonlySet<SkillSynthesisQueueItem['status']> =
  new Set(['queued', 'claimed', 'running']);

/**
 * SkillPipelineStatusComponent — the Activity view's header.
 *
 * Three bands, in the order a user asks the questions:
 *
 *  1. **Is analysis happening at all?** — last analysis + today's accepted /
 *     ineligible split.
 *  2. **Is the drain running?** — the recent `job_runs` feed. Before this
 *     existed the only signal here was a rate-limit chip on the newest event,
 *     which said nothing when the cron tier simply never fired.
 *  3. **What is it costing?** — the per-stage strip.
 *
 * ### On band 3 and the cost figure it shows
 *
 * `archaeology` cost scales linearly with session count, so the Activity view
 * must make per-stage cost observable BEFORE anyone tunes the tier cadence or
 * the daily budget. `skillSynthesis:queue` carries no token counters today —
 * `SkillSynthesisQueueItem` exposes `stage`, `status` and `attemptCount`, and
 * the daily token ledger (`skill_synthesis_budget`) is not on the wire at all.
 * The strip therefore counts **dispatches per stage**, which is the honest
 * proxy the contract supports: one attempt on an LLM-backed stage is one model
 * call, so a stage whose attempts climb faster than its rows is retrying, and
 * a stage that dominates the attempt share is the one dominating the bill.
 *
 * When the wire grows a per-item token figure, it renders in the cell that
 * already exists here — `StageCostView.attempts` gains a sibling and the
 * aggregation in {@link stageCosts} sums one more field. Nothing else moves.
 */
@Component({
  selector: 'ptah-skill-pipeline-status',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="overflow-hidden rounded-xl border border-base-300 bg-base-200/40"
      data-testid="skills-pipeline-status"
      aria-label="Skill synthesis pipeline status"
    >
      <div class="border-b border-base-300 px-4 py-3">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span class="text-base-content-muted">Last analysis:</span>
          <span class="font-medium">{{ lastAnalysisLabel() }}</span>
          @if (reasonChip(); as chip) {
            <span
              class="inline-flex items-center gap-1.5 text-xs text-base-content-muted"
              data-testid="skills-pipeline-reason"
            >
              <span
                class="inline-block size-1.5 rounded-full bg-warning"
                aria-hidden="true"
              ></span>
              {{ chip.label }}
            </span>
          }
        </div>
        <p class="mt-1 text-xs text-base-content-muted">
          Today:
          <span class="tabular-nums text-base-content-muted">{{
            acceptedToday()
          }}</span>
          accepted,
          <span class="tabular-nums text-base-content-muted">{{
            ineligibleToday()
          }}</span>
          ineligible
        </p>
      </div>

      <div class="border-b border-base-300 px-4 py-3">
        <div class="flex flex-wrap items-baseline justify-between gap-x-2">
          <h4 class="text-xs font-semibold uppercase tracking-wide">
            Drain runs
          </h4>
          <span class="text-xs text-base-content-muted tabular-nums">
            {{ drainRunViews().length }} recent
          </span>
        </div>

        @if (drainRunViews().length === 0) {
          <p
            class="mt-2 text-xs text-base-content-muted"
            data-testid="skills-drain-runs-empty"
          >
            The drain has not run yet.
          </p>
        } @else {
          <ul class="mt-2 flex flex-col gap-1" role="list">
            @for (run of drainRunViews(); track run.id) {
              <li
                class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs"
                data-testid="skills-drain-run"
                role="listitem"
              >
                <span
                  class="inline-block size-1.5 shrink-0 rounded-full"
                  [class]="run.tone"
                  aria-hidden="true"
                ></span>
                <span class="font-medium">{{ run.tierLabel }}</span>
                <span
                  class="text-base-content-muted"
                  data-testid="skills-drain-run-status"
                  >{{ run.statusLabel }}</span
                >
                <span
                  class="tabular-nums text-base-content-muted"
                  data-testid="skills-drain-run-duration"
                  >{{ run.durationLabel }}</span
                >
                <span class="text-base-content-muted">{{
                  run.startedLabel
                }}</span>
                @if (run.summary; as summary) {
                  <span class="basis-full truncate text-base-content-muted">{{
                    summary
                  }}</span>
                }
              </li>
            }
          </ul>
        }
      </div>

      <div class="px-4 py-3">
        <div class="flex flex-wrap items-baseline justify-between gap-x-2">
          <h4 class="text-xs font-semibold uppercase tracking-wide">
            Stage cost
          </h4>
          <span class="text-xs text-base-content-muted tabular-nums">
            {{ totalAttempts() }} dispatches / {{ totalRows() }} queued
          </span>
        </div>

        @if (stageCosts().length === 0) {
          <p
            class="mt-2 text-xs text-base-content-muted"
            data-testid="skills-stage-cost-empty"
          >
            Nothing queued.
          </p>
        } @else {
          <ul class="mt-2 flex flex-col gap-1.5" role="list">
            @for (stage of stageCosts(); track stage.stage) {
              <li
                class="flex flex-col gap-0.5 text-xs"
                data-testid="skills-stage-cost"
                role="listitem"
              >
                <div class="flex items-baseline justify-between gap-2">
                  <span class="font-medium">{{ stage.label }}</span>
                  <span class="tabular-nums text-base-content-muted">
                    {{ stage.attempts }} dispatches · {{ stage.rows }} queued
                    @if (stage.inFlight > 0) {
                      · {{ stage.inFlight }} in flight
                    }
                    @if (stage.failed > 0) {
                      · {{ stage.failed }} failed
                    }
                  </span>
                </div>
                <div
                  class="h-1 w-full overflow-hidden rounded-full bg-base-300"
                  role="presentation"
                >
                  <div
                    class="h-full rounded-full bg-primary"
                    [style.width.%]="stage.sharePct"
                  ></div>
                </div>
              </li>
            }
          </ul>
        }
      </div>
    </section>
  `,
})
export class SkillPipelineStatusComponent {
  public readonly lastAnalyzeRunAt = input.required<number | null>();
  public readonly histogram = input.required<EligibilityHistogramDto>();
  public readonly recentEvents =
    input.required<readonly SkillSynthesisEventWire[]>();

  /** Recent drain `job_runs`, most-recently-scheduled first. */
  public readonly drainRuns = input<readonly SkillSynthesisDrainRun[]>([]);

  /** Current queue rows — the source of the per-stage cost strip. */
  public readonly queueItems = input<readonly SkillSynthesisQueueItem[]>([]);

  /**
   * Clock override. `null` — the default every host uses — reads the wall
   * clock; a spec passes a fixed epoch so the relative labels are assertable.
   */
  public readonly now = input<number | null>(null);

  protected readonly lastAnalysisLabel = computed<string>(() => {
    const ts = this.lastAnalyzeRunAt();
    if (ts === null) return 'never';
    return this.formatRelative(this.nowMs() - ts);
  });

  protected readonly acceptedToday = computed<number>(
    () => this.histogram().accepted,
  );

  protected readonly ineligibleToday = computed<number>(() => {
    const h = this.histogram();
    return h.prefilterTooThin + h.prefilterRejected;
  });

  protected readonly reasonChip = computed<{
    readonly label: string;
  } | null>(() => {
    const events = this.recentEvents();
    if (events.length === 0) return null;
    const latest = events[0];
    if (latest.kind === 'ineligible') {
      return { label: 'ineligible' };
    }
    if (latest.kind === 'rate-limited') {
      return { label: 'rate-limited' };
    }
    return null;
  });

  protected readonly drainRunViews = computed<readonly DrainRunView[]>(() =>
    this.drainRuns().map((run) => ({
      id: run.id,
      tierLabel: run.tier,
      status: run.status,
      statusLabel: run.status,
      durationLabel: this.durationLabel(run),
      startedLabel: this.startedLabel(run),
      summary: run.summary,
      tone: STATUS_TONE[run.status] ?? 'bg-base-content/40',
    })),
  );

  protected readonly stageCosts = computed<readonly StageCostView[]>(() => {
    const byStage = new Map<SkillSynthesisQueueStage, StageAccumulator>();
    for (const item of this.queueItems()) {
      const acc = byStage.get(item.stage) ?? {
        rows: 0,
        attempts: 0,
        inFlight: 0,
        failed: 0,
      };
      acc.rows += 1;
      acc.attempts += item.attemptCount;
      if (IN_FLIGHT_STATUSES.has(item.status)) acc.inFlight += 1;
      if (item.status === 'failed') acc.failed += 1;
      byStage.set(item.stage, acc);
    }

    const maxAttempts = Math.max(
      0,
      ...Array.from(byStage.values(), (acc) => acc.attempts),
    );

    return Array.from(byStage.entries())
      .map(([stage, acc]) => ({
        stage,
        label: this.stageLabel(stage),
        rows: acc.rows,
        attempts: acc.attempts,
        inFlight: acc.inFlight,
        failed: acc.failed,
        // Relative to the heaviest stage, not to the total: the point of the
        // bar is "which stage dominates", and a share-of-total bar flattens
        // to invisibility as soon as more than a handful of stages are live.
        sharePct:
          maxAttempts > 0 ? Math.round((acc.attempts / maxAttempts) * 100) : 0,
      }))
      .sort(
        (a, b) =>
          b.attempts - a.attempts ||
          b.rows - a.rows ||
          a.stage.localeCompare(b.stage),
      );
  });

  protected readonly totalAttempts = computed<number>(() =>
    this.stageCosts().reduce((sum, stage) => sum + stage.attempts, 0),
  );

  protected readonly totalRows = computed<number>(
    () => this.queueItems().length,
  );

  private nowMs(): number {
    return this.now() ?? Date.now();
  }

  private stageLabel(stage: SkillSynthesisQueueStage): string {
    return stage.replace(/-/g, ' ');
  }

  /**
   * `durationMs` is `null` for any run that has not finished. That is a
   * different statement from "took no time", so it renders as the reason it
   * is absent rather than as `0ms`.
   */
  private durationLabel(run: SkillSynthesisDrainRun): string {
    if (run.durationMs === null) {
      return run.status === 'running' ? 'in progress' : 'no duration';
    }
    return this.formatDuration(run.durationMs);
  }

  /**
   * A run that has not started yet is described by the slot it is waiting for,
   * not by a start time it does not have — `scheduledFor` can be in the future,
   * which `formatRelative` would otherwise collapse to `never`.
   */
  private startedLabel(run: SkillSynthesisDrainRun): string {
    const at = run.startedAt ?? run.scheduledFor;
    if (!Number.isFinite(at) || at <= 0) return '';
    const diff = this.nowMs() - at;
    return diff < 0 ? 'scheduled' : this.formatRelative(diff);
  }

  private formatDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) return 'no duration';
    if (ms < 1000) return Math.round(ms) + 'ms';
    const sec = ms / 1000;
    if (sec < 60) return sec.toFixed(1) + 's';
    const min = Math.floor(sec / 60);
    const rem = Math.round(sec - min * 60);
    return min + 'm ' + rem + 's';
  }

  private formatRelative(diffMs: number): string {
    if (!Number.isFinite(diffMs) || diffMs < 0) return 'never';
    const sec = Math.floor(diffMs / 1000);
    if (sec < 60) return sec + 's ago';
    const min = Math.floor(sec / 60);
    if (min < 60) return min + 'm ago';
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h ago';
    const days = Math.floor(hr / 24);
    return days + 'd ago';
  }
}

/** Mutable per-stage tally used only while folding the queue rows. */
interface StageAccumulator {
  rows: number;
  attempts: number;
  inFlight: number;
  failed: number;
}
