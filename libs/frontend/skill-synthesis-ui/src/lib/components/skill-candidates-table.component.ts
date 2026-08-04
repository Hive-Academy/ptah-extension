/**
 * SkillCandidatesTableComponent — the Sessions candidate log as a card list.
 *
 * The name is historical: this used to be a `<table>`. It is now a list of
 * {@link NativeCardComponent} entries, for the same two reasons the Library
 * surface moved off its table:
 *
 * 1. EMPTINESS READS AS EMPTY. A candidate that has never run rendered as
 *    `0 / 0`, which reads like a measured failure rate. Successes and failures
 *    are now rendered ONLY when they are non-zero; when neither is, one
 *    sentence says why there is nothing to show.
 *
 * 2. SELECTION IS HONEST. The card's `selectable` / `selected` pair is wired to
 *    the OPEN candidate (`selectedCandidateId`), not to the bulk-action set, so
 *    `aria-pressed` describes what a screen reader user actually toggled by
 *    activating the card. Bulk selection stays an explicit nested checkbox —
 *    `NativeCardComponent` excludes nested `input` elements from activation, so
 *    ticking it never opens the detail modal.
 *
 * DOM CONTRACT (bound by `apps/ptah-electron-e2e`): exactly one
 * `[data-testid="skills-candidate-row"]` per candidate — it sits on the `<li>`
 * wrapper, not on the card root — and `[data-testid="skills-candidate-status"]`
 * renders the raw backend status word (`candidate` / `promoted` / `rejected`)
 * with nothing else inside it. A click on the centre of a row activates the
 * card, so action buttons live in the footer.
 *
 * Pure presentational: `input()` signals in, `output()` events out. OnPush.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { NativeCardComponent, type NativeCardTone } from '@ptah-extension/ui';
import type { SkillSynthesisCandidateSummary } from '@ptah-extension/shared';

export interface SkillCandidateAction {
  readonly candidate: SkillSynthesisCandidateSummary;
  readonly event: Event;
}

type CandidateStatus = SkillSynthesisCandidateSummary['status'];

interface CandidateMetric {
  readonly label: string;
  readonly value: string;
  readonly testId: string;
}

/** Per-candidate render model, derived once per `candidates()` change. */
interface CandidateRow {
  readonly id: string;
  readonly candidate: SkillSynthesisCandidateSummary;
  readonly tone: NativeCardTone;
  readonly dotClass: string;
  readonly metrics: readonly CandidateMetric[];
}

const STATUS_TONE: Record<CandidateStatus, NativeCardTone> = {
  candidate: 'neutral',
  promoted: 'success',
  rejected: 'error',
};

const STATUS_DOT: Record<CandidateStatus, string> = {
  candidate: 'bg-base-content/40',
  promoted: 'bg-success',
  rejected: 'bg-error',
};

@Component({
  selector: 'ptah-skill-candidates-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NativeCardComponent],
  template: `
    <section class="flex flex-col gap-2" aria-label="Skill candidates">
      @if (rows().length > 0) {
        <div class="flex items-center justify-between gap-3 px-1">
          <label
            class="flex cursor-pointer items-center gap-2 text-xs text-base-content/60"
          >
            <input
              type="checkbox"
              class="checkbox checkbox-xs"
              data-testid="skills-select-all"
              aria-label="Select all candidates"
              [checked]="allSelected()"
              (change)="toggleSelectAll.emit()"
            />
            <span>Select all</span>
          </label>
          <span class="text-xs tabular-nums text-base-content/40">
            {{ rows().length }} shown
          </span>
        </div>

        <ul class="flex list-none flex-col gap-2 p-0" role="list">
          @for (row of rows(); track row.id) {
            <li data-testid="skills-candidate-row">
              <ptah-native-card
                [tone]="row.tone"
                [spine]="true"
                [selectable]="true"
                [selected]="selectedCandidateId() === row.id"
                density="compact"
                [ariaLabel]="'Open details for ' + row.candidate.name"
                (activated)="selectRow.emit(row.id)"
              >
                <div card-header class="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    class="checkbox checkbox-xs mt-1 shrink-0"
                    data-testid="skills-select-row"
                    [attr.aria-label]="'Select ' + row.candidate.name"
                    [checked]="selectedIds().has(row.id)"
                    (change)="toggleSelect.emit(row.id)"
                  />

                  <div class="min-w-0 flex-1">
                    <p
                      class="flex flex-wrap items-center gap-1.5 text-sm font-medium"
                    >
                      <span class="truncate">{{ row.candidate.name }}</span>
                      @if (row.candidate.pinned) {
                        <span
                          class="text-[11px] font-normal text-base-content/50"
                          title="Pinned — kept out of automatic pruning."
                          >pinned</span
                        >
                      }
                    </p>
                    <p class="mt-0.5 text-xs text-base-content/60">
                      {{ row.candidate.description }}
                    </p>
                  </div>

                  <span class="inline-flex shrink-0 items-center gap-1.5">
                    <span
                      class="inline-block size-1.5 rounded-full"
                      [class]="row.dotClass"
                      aria-hidden="true"
                    ></span>
                    <span
                      class="text-xs text-base-content/70"
                      data-testid="skills-candidate-status"
                      >{{ row.candidate.status }}</span
                    >
                  </span>
                </div>

                @if (row.metrics.length === 0) {
                  <p
                    class="text-xs text-base-content/55"
                    data-testid="skills-candidate-no-runs"
                  >
                    Never invoked yet — successes and failures appear after this
                    candidate's first recorded run.
                  </p>
                } @else {
                  <dl
                    class="flex flex-wrap gap-x-5 gap-y-1 text-xs"
                    data-testid="skills-candidate-metrics"
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

                <div
                  card-footer
                  class="flex flex-wrap items-center justify-end gap-1.5 pt-0.5"
                >
                  <button
                    type="button"
                    data-testid="skills-promote-btn"
                    class="btn btn-ghost btn-xs transition-colors duration-150"
                    [disabled]="
                      row.candidate.status === 'promoted' || loading()
                    "
                    (click)="
                      promote.emit({ candidate: row.candidate, event: $event })
                    "
                  >
                    Promote
                  </button>
                  <button
                    type="button"
                    data-testid="skills-reject-btn"
                    class="btn btn-ghost btn-xs transition-colors duration-150"
                    [disabled]="
                      row.candidate.status === 'rejected' || loading()
                    "
                    (click)="
                      reject.emit({ candidate: row.candidate, event: $event })
                    "
                  >
                    Reject
                  </button>
                  @if (row.candidate.status === 'promoted') {
                    <button
                      type="button"
                      data-testid="skills-pin-btn"
                      class="btn btn-ghost btn-xs transition-colors duration-150"
                      [disabled]="loading()"
                      (click)="
                        togglePin.emit({
                          candidate: row.candidate,
                          event: $event,
                        })
                      "
                    >
                      {{ row.candidate.pinned ? 'Unpin' : 'Pin' }}
                    </button>
                  }
                </div>
              </ptah-native-card>
            </li>
          }
        </ul>
      } @else if (loading()) {
        <div
          class="flex flex-col gap-2 px-2 py-4"
          role="status"
          aria-label="Loading candidates"
        >
          <div class="h-3 w-1/3 rounded bg-base-300/50"></div>
          <div class="h-3 w-1/2 rounded bg-base-300/40"></div>
          <div class="h-3 w-2/5 rounded bg-base-300/30"></div>
        </div>
      } @else {
        <div
          class="flex flex-col items-center gap-1.5 px-4 py-12 text-center"
          data-testid="skills-empty-state"
        >
          <span class="text-sm font-medium text-base-content">
            No candidates for this filter.
          </span>
          <span class="max-w-md text-xs text-base-content/60">
            Sessions become candidates when a workflow of at least 5 turns ends
            with a success marker (turn complete, subagent stop, idle, or boot
            scan triggers). Candidates are promoted to active skills only after
            repeated successful runs.
          </span>
        </div>
      }
    </section>
  `,
})
export class SkillCandidatesTableComponent {
  public readonly candidates =
    input.required<readonly SkillSynthesisCandidateSummary[]>();
  public readonly selectedCandidateId = input<string | null>(null);
  public readonly loading = input<boolean>(false);
  public readonly selectedIds = input<ReadonlySet<string>>(new Set());

  public readonly selectRow = output<string>();
  public readonly promote = output<SkillCandidateAction>();
  public readonly reject = output<SkillCandidateAction>();
  public readonly togglePin = output<SkillCandidateAction>();
  public readonly toggleSelect = output<string>();
  public readonly toggleSelectAll = output<void>();

  /**
   * Render model for the list. Deliberately keyed ONLY on `candidates()` so
   * selection changes (which are read directly in the template) never force the
   * whole list to be rebuilt.
   */
  protected readonly rows = computed<readonly CandidateRow[]>(() =>
    this.candidates().map((candidate) => ({
      id: candidate.id,
      candidate,
      tone: STATUS_TONE[candidate.status],
      dotClass: STATUS_DOT[candidate.status],
      metrics: buildMetrics(candidate),
    })),
  );

  /**
   * True when every visible candidate is selected and there is at least one
   * candidate — drives the header "select all" checkbox checked state.
   */
  protected readonly allSelected = computed<boolean>(() => {
    const rows = this.candidates();
    if (rows.length === 0) return false;
    const selected = this.selectedIds();
    return rows.every((c) => selected.has(c.id));
  });
}

/**
 * Only the counters that actually carry data. A candidate that has never run
 * yields an EMPTY list, which the template renders as one explanatory sentence
 * instead of `0 / 0`.
 */
function buildMetrics(
  candidate: SkillSynthesisCandidateSummary,
): readonly CandidateMetric[] {
  const out: CandidateMetric[] = [];

  if (candidate.successCount > 0) {
    out.push({
      label: 'Successes',
      value: String(candidate.successCount),
      testId: 'skills-candidate-successes',
    });
  }

  if (candidate.failureCount > 0) {
    out.push({
      label: 'Failures',
      value: String(candidate.failureCount),
      testId: 'skills-candidate-failures',
    });
  }

  return out;
}
