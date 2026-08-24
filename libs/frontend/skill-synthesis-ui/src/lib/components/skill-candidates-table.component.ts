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
import type {
  SkillJudgeCriteriaDto,
  SkillJudgeStatusDto,
  SkillSynthesisCandidateSummary,
} from '@ptah-extension/shared';

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

interface CandidateCriterion {
  readonly key: keyof SkillJudgeCriteriaDto;
  readonly label: string;
  readonly value: string;
}

/**
 * One empirical gate's measurement (P3-1).
 *
 * `measured` is carried alongside `value` rather than being inferred from the
 * text, because that flag is the whole point: a gate that never ran and a gate
 * that ran and scored zero are DIFFERENT facts, and only the first may render
 * without a number. This is the same treatment `CandidateJudge.scoreText`
 * gives an unscored verdict — an unmeasured gate never shows a digit.
 */
interface CandidateGate {
  readonly key: 'replay' | 'trigger';
  readonly label: string;
  readonly measured: boolean;
  /** The number, or {@link NOT_MEASURED} — never `'0'` for an absent gate. */
  readonly value: string;
  readonly title: string;
}

/**
 * The judge's verdict, or `null` when no verdict has ever been recorded.
 *
 * `scoreText` is `null` — not `'0'` — whenever the candidate was not scored.
 * The template renders NO score node in that case. This is the whole point of
 * the type: before `judgeScore` became nullable, a judge call that failed
 * fabricated a zero, and a fabricated zero rendered identically to a genuine
 * bottom score. An unscored candidate must never show a number.
 */
interface CandidateJudge {
  readonly status: SkillJudgeStatusDto;
  readonly badgeClass: string;
  readonly scoreText: string | null;
  readonly reason: string | null;
  readonly criteria: readonly CandidateCriterion[];
}

/** Per-candidate render model, derived once per `candidates()` change. */
interface CandidateRow {
  readonly id: string;
  readonly candidate: SkillSynthesisCandidateSummary;
  /** Never the `name` slug — see {@link buildTitle}. */
  readonly title: string;
  readonly tone: NativeCardTone;
  readonly dotClass: string;
  readonly metrics: readonly CandidateMetric[];
  readonly judge: CandidateJudge | null;
  readonly gates: readonly CandidateGate[];
  /** Where this capture came from — see {@link buildOrigin}. */
  readonly origin: CandidateOrigin;
}

/**
 * The project a capture came from, as the card renders it.
 *
 * `full` is kept beside `label` because `label` is the trailing path segment
 * and two projects can share a folder name; the whole path goes in the
 * tooltip rather than into a card that has to stay one line.
 */
interface CandidateOrigin {
  /** Folder name, or {@link UNKNOWN_ORIGIN}. */
  readonly label: string;
  /** Absolute path for the tooltip, or the same words as `label`. */
  readonly full: string;
  /**
   * Colour for the line. A recorded project reads as data; an unrecorded one
   * reads as an absence, so it is dimmer and italic. Carried as one class
   * string rather than three `[class.x]` bindings because two of the utilities
   * contain a `/`, which Angular's class-binding syntax cannot express.
   */
  readonly toneClass: string;
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

const JUDGE_BADGE_CLASS: Record<SkillJudgeStatusDto, string> = {
  scored: 'bg-success/15 text-success',
  unscored: 'bg-warning/15 text-warning',
  disabled: 'bg-base-content/10 text-base-content-muted',
};

/** Rendered order and human labels for the five judge criteria. */
const CRITERION_LABELS: ReadonlyArray<{
  readonly key: keyof SkillJudgeCriteriaDto;
  readonly label: string;
}> = [
  { key: 'novelty', label: 'Novelty' },
  { key: 'actionability', label: 'Actionability' },
  { key: 'scope', label: 'Scope' },
  { key: 'generalization', label: 'Generalization' },
  { key: 'triggerClarity', label: 'Trigger clarity' },
];

/** What a candidate with no title yet is called. */
const UNTITLED_PREFIX = 'Captured workflow';

/**
 * What a capture with no recorded project says. Words, like
 * {@link NOT_MEASURED}: an empty path or a bare dash would read as a project.
 */
const UNKNOWN_ORIGIN = 'project not recorded';

/**
 * What an unmeasured gate says. Words, deliberately, and never a digit: `0`,
 * `0.0` and `—` all read as a measurement, and the state being described is the
 * absence of one.
 */
const NOT_MEASURED = 'not measured';

const GATE_TITLES = {
  replay:
    'Plan-vs-actual alignment when the skill was replayed against a held-out session.',
  trigger:
    "Retrieval score for the skill's description alone, from precision and recall.",
} as const;

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
            class="flex cursor-pointer items-center gap-2 text-xs text-base-content-muted"
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
          <span class="text-xs tabular-nums text-base-content-muted">
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
                [ariaLabel]="'Open details for ' + row.title"
                (activated)="selectRow.emit(row.id)"
              >
                <div card-header class="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    class="checkbox checkbox-xs mt-1 shrink-0"
                    data-testid="skills-select-row"
                    [attr.aria-label]="'Select ' + row.title"
                    [checked]="selectedIds().has(row.id)"
                    (change)="toggleSelect.emit(row.id)"
                  />

                  <div class="min-w-0 flex-1">
                    <p
                      class="flex flex-wrap items-center gap-1.5 text-sm font-medium"
                      data-testid="skills-candidate-title"
                    >
                      <span class="truncate">{{ row.title }}</span>
                      @if (row.candidate.pinned) {
                        <span
                          class="text-[11px] font-normal text-base-content-muted"
                          title="Pinned — kept out of automatic pruning."
                          >pinned</span
                        >
                      }
                    </p>
                    <p class="mt-0.5 text-xs text-base-content-muted">
                      {{ row.candidate.description }}
                    </p>
                    @if (showOrigin()) {
                      <p
                        class="mt-1 truncate text-[10px] uppercase tracking-wide"
                        data-testid="skills-candidate-origin"
                        [class]="row.origin.toneClass"
                        [attr.title]="row.origin.full"
                      >
                        {{ row.origin.label }}
                      </p>
                    }
                  </div>

                  <span class="inline-flex shrink-0 items-center gap-1.5">
                    <span
                      class="inline-block size-1.5 rounded-full"
                      [class]="row.dotClass"
                      aria-hidden="true"
                    ></span>
                    <span
                      class="text-xs text-base-content-muted"
                      data-testid="skills-candidate-status"
                      >{{ row.candidate.status }}</span
                    >
                  </span>
                </div>

                @if (row.judge; as judge) {
                  <div class="flex flex-col gap-1.5">
                    <div class="flex flex-wrap items-center gap-2">
                      <span
                        class="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                        [class]="judge.badgeClass"
                        data-testid="skills-candidate-judge-badge"
                        >{{ judge.status }}</span
                      >

                      @if (judge.scoreText; as score) {
                        <span class="flex items-baseline gap-1 text-xs">
                          <span
                            class="tabular-nums font-medium"
                            data-testid="skills-candidate-judge-score"
                            >{{ score }}</span
                          >
                          <span class="text-base-content-muted">/ 10</span>
                        </span>
                      }
                    </div>

                    @if (judge.reason; as reason) {
                      <p
                        class="text-xs text-base-content-muted"
                        data-testid="skills-candidate-judge-reason"
                      >
                        {{ reason }}
                      </p>
                    }

                    @if (judge.criteria.length > 0) {
                      <dl
                        class="flex flex-wrap gap-x-4 gap-y-1 text-xs"
                        data-testid="skills-candidate-scorecard"
                      >
                        @for (c of judge.criteria; track c.key) {
                          <div
                            class="flex items-baseline gap-1.5"
                            data-testid="skills-candidate-criterion"
                            [attr.data-criterion]="c.key"
                          >
                            <dt
                              class="text-[10px] uppercase tracking-wide text-base-content-muted"
                            >
                              {{ c.label }}
                            </dt>
                            <dd class="tabular-nums">{{ c.value }}</dd>
                          </div>
                        }
                      </dl>
                    }
                  </div>
                }

                <dl
                  class="flex flex-wrap gap-x-5 gap-y-1 text-xs"
                  data-testid="skills-candidate-gates"
                >
                  @for (gate of row.gates; track gate.key) {
                    <div
                      class="flex items-baseline gap-1.5"
                      data-testid="skills-candidate-gate"
                      [attr.data-gate]="gate.key"
                    >
                      <dt
                        class="text-[10px] uppercase tracking-wide text-base-content-muted"
                        [title]="gate.title"
                      >
                        {{ gate.label }}
                      </dt>
                      @if (gate.measured) {
                        <dd
                          class="tabular-nums"
                          data-testid="skills-candidate-gate-value"
                        >
                          {{ gate.value }}
                        </dd>
                      } @else {
                        <dd
                          class="text-base-content-muted"
                          data-testid="skills-candidate-gate-unmeasured"
                        >
                          {{ gate.value }}
                        </dd>
                      }
                    </div>
                  }
                </dl>

                @if (row.metrics.length === 0) {
                  <p
                    class="text-xs text-base-content-muted"
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
                          class="text-[10px] uppercase tracking-wide text-base-content-muted"
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
          <span class="max-w-md text-xs text-base-content-muted">
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
  /**
   * Render each card's originating project. Off by default: when the list is
   * already scoped to one workspace the line would repeat the same path on
   * every card and say nothing.
   */
  public readonly showOrigin = input<boolean>(false);

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
      title: buildTitle(candidate),
      tone: STATUS_TONE[candidate.status],
      dotClass: STATUS_DOT[candidate.status],
      metrics: buildMetrics(candidate),
      judge: buildJudge(candidate),
      gates: buildGates(candidate),
      origin: buildOrigin(candidate),
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
 * What to call a candidate on screen.
 *
 * NEVER the `name` field. That is a SLUG — an internal id and the `SKILL.md`
 * folder name, historically derived from the opening words of the user's own
 * prompt. Rendering it echoed a fragment of the prompt back as if it were a
 * title, which read as though the system had understood something it had not
 * (P1-10). `displayName` is the title the namer produced; when there is none
 * yet, the honest answer is that this is an untitled capture, dated.
 *
 * The date is formatted from LOCAL calendar parts as `YYYY-MM-DD` — locale-free
 * so it is unambiguous to every reader and stable to assert on, but still the
 * user's own day rather than a UTC one.
 */
function buildTitle(candidate: SkillSynthesisCandidateSummary): string {
  const displayName = candidate.displayName?.trim();
  if (displayName) return displayName;
  return `${UNTITLED_PREFIX} · ${formatCaptureDate(candidate.createdAt)}`;
}

/**
 * Which project a capture came from.
 *
 * `workspaceRoot: null` means the origin was never recorded — every candidate
 * captured before the column existed whose synthesis-queue row could not be
 * traced. It is rendered with words ({@link UNKNOWN_ORIGIN}) and never as an
 * empty path or as "all projects": those are claims, and the state being
 * described is the absence of one. Same rule {@link NOT_MEASURED} follows for
 * an unmeasured gate.
 *
 * The label is the trailing path segment because the card is one line and a
 * full Windows path pushes everything else off it; the whole path stays
 * reachable in the tooltip. Both separators are split on — the paths are
 * written by whichever host captured the session, so a POSIX root can appear in
 * a database opened on Windows and the reverse.
 */
function buildOrigin(
  candidate: SkillSynthesisCandidateSummary,
): CandidateOrigin {
  const root = candidate.workspaceRoot?.trim();
  if (!root) {
    return {
      label: UNKNOWN_ORIGIN,
      full: UNKNOWN_ORIGIN,
      toneClass: 'italic text-base-content/40',
    };
  }
  const segments = root.split(/[\\/]/).filter((s) => s.length > 0);
  return {
    label: segments[segments.length - 1] ?? root,
    full: root,
    toneClass: 'text-base-content-muted',
  };
}

function formatCaptureDate(epochMs: number): string {
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) return 'unknown date';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * The judge verdict panel, or `null` when no verdict was ever recorded.
 *
 * `judgeScore` is passed through as-is. It is NOT coalesced, defaulted, or
 * compared against zero anywhere on this path: a `null` score yields a `null`
 * `scoreText`, and the template renders no score node at all. An `unscored`
 * candidate therefore says "unscored" and shows no number, which is the
 * difference between "we could not grade this" and "we graded it zero".
 */
function buildJudge(
  candidate: SkillSynthesisCandidateSummary,
): CandidateJudge | null {
  // `== null` rather than `=== null`: a host that predates these fields sends
  // them absent, and an absent verdict is the same thing as no verdict. This
  // is the ONE tolerance — it can only ever suppress a badge, never invent a
  // score.
  const status = candidate.judgeStatus;
  if (status == null) return null;

  return {
    status,
    badgeClass: JUDGE_BADGE_CLASS[status],
    scoreText:
      candidate.judgeScore == null ? null : String(candidate.judgeScore),
    reason: candidate.judgeReason ?? null,
    criteria: buildCriteria(candidate.judgeCriteria),
  };
}

/**
 * The five-criterion scorecard. An absent breakdown yields an EMPTY list (no
 * scorecard rendered); a present breakdown always yields all five entries, with
 * an em dash for any individual criterion the judge left null.
 */
function buildCriteria(
  criteria: SkillJudgeCriteriaDto | null | undefined,
): readonly CandidateCriterion[] {
  if (criteria == null) return [];
  return CRITERION_LABELS.map(({ key, label }) => {
    const value = criteria[key];
    return { key, label, value: value == null ? '—' : String(value) };
  });
}

/**
 * The two empirical gates (P3-1), always both, in a fixed order.
 *
 * Rendered even when unmeasured — unlike the run counters, which vanish when
 * they are zero. The cases are not the same: a missing counter is read as "this
 * has not run", which is what the sentence beside it already says, whereas a
 * missing gate row would be read as "this candidate has no such gate". Saying
 * `not measured` states the fact instead of leaving the reader to infer it.
 */
function buildGates(
  candidate: SkillSynthesisCandidateSummary,
): readonly CandidateGate[] {
  return [
    gate('replay', 'Replay', candidate.replayConfidence),
    gate('trigger', 'Trigger', candidate.triggerScore),
  ];
}

/**
 * One gate row.
 *
 * `value == null` yields {@link NOT_MEASURED} and `measured: false`; every
 * other number — INCLUDING `0` — yields the number itself. Nothing on this path
 * defaults, coalesces, or falsy-checks the score, because `0` is falsy and a
 * `||` here would silently retitle a measured failure as an absent
 * measurement. That is the defect this phase exists to keep out of the UI.
 *
 * A non-finite number (`NaN` from a corrupted host) is not a measurement
 * either, and is treated as absent rather than printed.
 */
function gate(
  key: CandidateGate['key'],
  label: string,
  value: number | null | undefined,
): CandidateGate {
  const title = GATE_TITLES[key];
  if (value == null || !Number.isFinite(value)) {
    return { key, label, measured: false, value: NOT_MEASURED, title };
  }
  return { key, label, measured: true, value: formatGateValue(value), title };
}

/**
 * Two decimal places at most, and no trailing zeros: a measured `0` prints as
 * `0` and never as `0.00`, which would imply a precision the gate did not
 * claim. The scale is left alone — no percentage, no ` / 1` — because the
 * trigger score's range is the trigger-eval stage's to define.
 */
function formatGateValue(value: number): string {
  return String(Math.round(value * 100) / 100);
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
