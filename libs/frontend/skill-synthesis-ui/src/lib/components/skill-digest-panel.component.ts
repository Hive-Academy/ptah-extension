import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type {
  SkillDigestItem,
  SkillDigestItemKind,
} from '@ptah-extension/shared';

/**
 * The words a `null` win rate renders as.
 *
 * WORDS, never a digit. `null` on {@link SkillDigestEvidence.winRate} means
 * nobody has measured this skill; a measured `0` means it was measured and lost
 * every measured session. Rendering the absent case as `0%` would state a
 * measurement that was never taken, and rendering the measured case as these
 * words would erase a real result.
 */
const NOT_MEASURED = 'not measured';

/** How many evidence sessions are listed before the rest fold into a counter. */
const MAX_VISIBLE_SESSIONS = 6;

/** Human-facing name for each sweep that can file an item. */
const KIND_LABELS: Readonly<Record<SkillDigestItemKind, string>> = {
  'missed-trigger': 'missed trigger',
  'friction-opportunity': 'friction',
  'win-rate': 'win rate',
  'memory-signal': 'memory signal',
};

/** daisyUI tone for each kind's badge, so the four sweeps are distinguishable. */
const KIND_TONES: Readonly<Record<SkillDigestItemKind, string>> = {
  'missed-trigger': 'badge-warning',
  'friction-opportunity': 'badge-info',
  'win-rate': 'badge-accent',
  'memory-signal': 'badge-ghost',
};

/** One `evidence.counts` entry flattened to the strings the template renders. */
interface CountView {
  readonly key: string;
  readonly label: string;
  readonly value: number;
}

/** One digest item flattened to the strings the template renders. */
interface DigestItemView {
  readonly key: string;
  readonly kind: SkillDigestItemKind;
  readonly kindLabel: string;
  readonly kindTone: string;
  readonly title: string;
  readonly rationale: string;
  /** `score` fixed to two places, so a score of `0` renders as `0.00`. */
  readonly scoreLabel: string;
  /** Either a percentage or {@link NOT_MEASURED} — never a bare number. */
  readonly winRateLabel: string;
  /** `false` only when `winRate === null`, so the badge tone can differ. */
  readonly winRateMeasured: boolean;
  readonly sessionIds: readonly string[];
  /** Sessions beyond {@link MAX_VISIBLE_SESSIONS}; `0` hides the counter. */
  readonly hiddenSessionCount: number;
  readonly sessionCount: number;
  readonly counts: readonly CountView[];
}

/**
 * SkillDigestPanelComponent — "This week" on the Activity sub-view.
 *
 * A ranked list of nudges from `skillSynthesis:digest`, each shown WITH its
 * receipts: the sessions that justify it, the per-kind tallies behind it, and
 * the win rate of the skill involved. An item is never an action — the user
 * still accepts or dismisses elsewhere — so this panel reads and renders and
 * does nothing else.
 *
 * ### The order is the contract, and this component does not own it
 *
 * The digest arrives sorted by `score` DESCENDING, and the curator's tie-break
 * (kind order, then title) is what makes two identical sweeps produce identical
 * digests. This component renders {@link items} in the order it is given and
 * NEVER re-sorts. A defensive second sort here would drop the tie-break and
 * make the panel's order untestable against the backend's.
 *
 * ### `null` is never `0`
 *
 * `evidence.winRate` is `number | null`, and the two are different statements:
 *
 *  - `null` — nobody measured this skill. Renders as the words
 *    {@link NOT_MEASURED}.
 *  - `0` — it was measured and lost every measured session. Renders as `0%`,
 *    because that is a real result and the whole reason the item was filed.
 *
 * `0` is falsy, so `winRate || …` anywhere on this path silently retitles a
 * measured failure as an absent measurement — and because the output is still a
 * string and still renders, nothing downstream could tell. {@link toWinRate}
 * therefore branches on `=== null` explicitly, and the spec asserts `null`, `0`
 * and a middling value as three separate cases for exactly that reason.
 */
@Component({
  selector: 'ptah-skill-digest-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="overflow-hidden rounded-xl border border-base-300 bg-base-200/40"
      data-testid="skills-digest-panel"
      aria-label="Skill synthesis weekly digest"
    >
      <div
        class="flex flex-wrap items-baseline justify-between gap-x-2 border-b border-base-300 px-4 py-3"
      >
        <h4 class="text-xs font-semibold uppercase tracking-wide">This week</h4>
        <span
          class="text-xs tabular-nums text-base-content-muted"
          data-testid="skills-digest-count"
        >
          {{ itemViews().length }} ranked
        </span>
      </div>

      @if (loading() && itemViews().length === 0) {
        <p
          class="px-4 py-3 text-xs text-base-content-muted"
          data-testid="skills-digest-loading"
        >
          Sweeping this week's sessions…
        </p>
      } @else if (itemViews().length === 0) {
        <p
          class="px-4 py-3 text-xs text-base-content-muted"
          data-testid="skills-digest-empty"
        >
          Nothing to look at this week.
        </p>
      } @else {
        <ul class="flex flex-col divide-y divide-base-300" role="list">
          @for (item of itemViews(); track item.key) {
            <li
              class="flex flex-col gap-1.5 px-4 py-3"
              data-testid="skills-digest-item"
              role="listitem"
            >
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span
                  class="badge badge-sm"
                  [class]="item.kindTone"
                  data-testid="skills-digest-kind"
                  >{{ item.kindLabel }}</span
                >
                <span
                  class="text-sm font-medium"
                  data-testid="skills-digest-title"
                  >{{ item.title }}</span
                >
                <span
                  class="ml-auto text-xs tabular-nums text-base-content-muted"
                  data-testid="skills-digest-score"
                  >score {{ item.scoreLabel }}</span
                >
              </div>

              <p
                class="text-xs text-base-content-muted"
                data-testid="skills-digest-rationale"
              >
                {{ item.rationale }}
              </p>

              <div
                class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
                data-testid="skills-digest-evidence"
              >
                <span
                  class="tabular-nums"
                  [class.text-base-content-muted]="!item.winRateMeasured"
                  data-testid="skills-digest-win-rate"
                  >win rate {{ item.winRateLabel }}</span
                >

                @for (count of item.counts; track count.key) {
                  <span
                    class="tabular-nums text-base-content-muted"
                    data-testid="skills-digest-evidence-count"
                    >{{ count.label }} {{ count.value }}</span
                  >
                }

                <span
                  class="tabular-nums text-base-content-muted"
                  data-testid="skills-digest-session-count"
                  >{{ item.sessionCount }} sessions</span
                >
              </div>

              <ul
                class="flex flex-wrap items-center gap-1"
                role="list"
                aria-label="Evidence sessions"
              >
                @for (sessionId of item.sessionIds; track sessionId) {
                  <li
                    class="badge badge-ghost badge-sm max-w-[12rem] truncate font-mono"
                    data-testid="skills-digest-session"
                    role="listitem"
                    [title]="sessionId"
                  >
                    {{ sessionId }}
                  </li>
                }
                @if (item.hiddenSessionCount > 0) {
                  <li
                    class="text-xs tabular-nums text-base-content-muted"
                    data-testid="skills-digest-session-overflow"
                    role="listitem"
                  >
                    +{{ item.hiddenSessionCount }} more
                  </li>
                }
              </ul>
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class SkillDigestPanelComponent {
  /**
   * The digest, ALREADY ranked by `score` descending. Rendered in the order
   * given — see the class note on why this component never re-sorts.
   */
  public readonly items = input.required<readonly SkillDigestItem[]>();

  /**
   * Whether a sweep is in flight. Only changes the empty state: an empty digest
   * mid-sweep is "not swept yet", which is a different statement from "swept
   * and found nothing".
   */
  public readonly loading = input<boolean>(false);

  protected readonly itemViews = computed<readonly DigestItemView[]>(() =>
    this.items().map((item, index) => {
      const sessionIds = item.evidence.sessionIds;
      return {
        // `kind` + `title` is the curator's own tie-break key, and the index
        // keeps the track expression unique even if a sweep ever files two
        // items with both the same.
        key: index + ':' + item.kind + ':' + item.title,
        kind: item.kind,
        kindLabel: KIND_LABELS[item.kind] ?? item.kind,
        kindTone: KIND_TONES[item.kind] ?? 'badge-ghost',
        title: item.title,
        rationale: item.rationale,
        scoreLabel: this.toScore(item.score),
        winRateLabel: this.toWinRate(item.evidence.winRate),
        winRateMeasured: item.evidence.winRate !== null,
        sessionIds: sessionIds.slice(0, MAX_VISIBLE_SESSIONS),
        hiddenSessionCount: Math.max(
          0,
          sessionIds.length - MAX_VISIBLE_SESSIONS,
        ),
        sessionCount: sessionIds.length,
        counts: this.toCounts(item.evidence.counts),
      };
    }),
  );

  /**
   * `null` → the words; every number → a percentage.
   *
   * The `=== null` is load-bearing. `if (!winRate)` — which is what
   * `winRate || NOT_MEASURED` compiles to in spirit — would send a measured
   * `0` down the absent branch and report a skill that lost every session as
   * one nobody ever measured.
   */
  private toWinRate(winRate: number | null): string {
    if (winRate === null) return NOT_MEASURED;
    if (!Number.isFinite(winRate)) return NOT_MEASURED;
    return Math.round(winRate * 100) + '%';
  }

  /**
   * Two fixed places, so a score of `0` renders as `0.00` rather than
   * disappearing. A zero-scored item still earned a place in the ranking.
   */
  private toScore(score: number): string {
    if (!Number.isFinite(score)) return '0.00';
    return score.toFixed(2);
  }

  /**
   * `evidence.counts` in the order the curator built it. Entries with a value
   * of `0` are KEPT: "measured, and it was zero" is a fact the item may have
   * been filed on, and dropping it would make the receipts disagree with the
   * rationale above them.
   */
  private toCounts(counts: Record<string, number>): readonly CountView[] {
    return Object.entries(counts).map(([key, value]) => ({
      key,
      label: this.toCountLabel(key),
      value,
    }));
  }

  /** `missedSessions` → `missed sessions`; `retry` → `retry`. */
  private toCountLabel(key: string): string {
    return key
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[-_]+/g, ' ')
      .toLowerCase();
  }
}
