import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

/**
 * ProgressMeter — "3 of 8 lessons complete" with a bar (R2.3.5, R9.7).
 *
 * ⚠️ 🔴 PRIVATE TO `libs/web/members`, AND THAT IS THE ANSWER TO TASK 10.1's
 * EXPLICIT FORK, NOT AN OVERSIGHT. §5.3's promotion bar is "a primitive earns a
 * place in `@ptah-web/panel-ui` when a SECOND PANEL ACTUALLY RENDERS IT".
 * `ThreadRow` and `TagChip` cleared that bar in Batch 7 only because Task 7.10
 * shipped a real admin consumer in the SAME batch, and
 * `community-moderation.spec.ts` carries an assertion naming that dependency so
 * the promotion dies with the consumer.
 *
 * This component has TWO consumers and they are both the member panel:
 * `learning/courses-page.ts` and `learning/course-page.ts`. There is no admin
 * course-authoring screen in TASK_2026_177's Phase-3 scope (RK-1 — §3.4's admin
 * ENDPOINTS exist, but no `libs/web/admin` surface is specified), so a
 * promotion today would be the speculative extraction §5.3 exists to prevent.
 * It stays here, exactly as `ReactionBar`, `UnreadPill`, `AcceptedAnswerBadge`
 * and the two composers stayed here. Moving it later costs one file move and a
 * barrel line; un-promoting it costs a review of every panel that imported it.
 *
 * ⚠️ 🔴 IT TAKES TWO COUNTS AND COMPUTES THE PERCENTAGE ITSELF — IT DOES NOT
 * TAKE A `percent` INPUT (RISK-O, the frontend shape). `MemberCourseSummary`
 * carries `percent` on the wire, derived server-side FROM LESSON COUNTS so every
 * meter in the product rounds identically; a `percent` input here would let a
 * SECOND caller pass a number derived some other way — from seconds watched,
 * say — and nothing would catch it. Taking the counts makes the wrong number
 * unrepresentable at this boundary. The wire `percent` is still the one the
 * SERVER shows in text elsewhere; this bar's width and this bar's label come
 * from the same two integers.
 *
 * ⚠️ `total === 0` RENDERS `0%` AND NEVER DIVIDES. An admin creates a course
 * shell before any module exists, so zero total is a real, reachable state —
 * not a defensive nicety — and `0/0` would render `NaN%` on a live surface.
 *
 * ⚠️ NFR-U3 — the label and the percentage are LOAD-BEARING TEXT and use
 * `text-base-content/60` or stronger. `/40` measures 3.18:1 and fails WCAG AA
 * for body text.
 *
 * ⚠️ NFR-U2 — `base-300` is the track FILL and `border-hairline` is the only
 * boundary vocabulary. There is no `border-base-300` here; at 1.036:1 against a
 * `base-200` card it is invisible, and the Task 4.7 lint rule fails the build on
 * it anyway.
 *
 * a11y: `role="progressbar"` with `aria-valuenow` / `aria-valuemin` /
 * `aria-valuemax`, and an `aria-label` that says WHAT is progressing rather
 * than just a number. The noun comes from a `Record` over a union, never from
 * `noun + 's'` — Batch 7's `UnreadPill` shipped "3 unread replys" until a spec
 * caught exactly that concatenation.
 */
@Component({
  selector: 'ptah-progress-meter',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './progress-meter.html',
})
export class ProgressMeter {
  /** Lessons THIS member has completed. A COUNT, never a percentage. */
  public readonly completed = input.required<number>();

  /** Lessons visible to this member in the course. A COUNT. May be `0`. */
  public readonly total = input.required<number>();

  /** What is being counted. Drives the accessible label's noun. */
  public readonly unit = input<'lesson' | 'module'>('lesson');

  /** Optional heading rendered above the bar, e.g. the course title. */
  public readonly label = input<string | null>(null);

  /**
   * `0`–`100`, integer, computed from the two counts.
   *
   * ⚠️ `Math.round`, matching the server's own rounding of the same two
   * integers, so the bar and any server-rendered `percent` agree.
   */
  protected readonly percent = computed<number>(() => {
    const total = this.total();
    if (total <= 0) return 0;
    const raw = (this.completed() / total) * 100;
    return Math.max(0, Math.min(100, Math.round(raw)));
  });

  /** `"33%"` — the visible figure. */
  protected readonly percentLabel = computed<string>(
    () => `${this.percent()}%`,
  );

  /** `"3 of 8 lessons"` — the visible count. */
  protected readonly countLabel = computed<string>(() => {
    const total = this.total();
    const noun = total === 1 ? this.unit() : PLURAL[this.unit()];
    return `${this.completed()} of ${total} ${noun}`;
  });

  /**
   * `"3 of 8 lessons complete"` — what a screen reader is told.
   *
   * A bare "33" tells a screen-reader user neither what is progressing nor
   * whether the number is a count or a percentage.
   */
  protected readonly accessibleLabel = computed<string>(() => {
    const prefix = this.label();
    const body = `${this.countLabel()} complete`;
    return prefix ? `${prefix}: ${body}` : body;
  });

  /** Inline width for the filled track. The only style computed in code. */
  protected readonly barWidth = computed<string>(() => `${this.percent()}%`);
}

/**
 * Plurals as a `Record` over the union, not `noun + 's'`.
 *
 * Both happen to take a plain `s`, which is exactly why the device matters: a
 * third unit added later ("quizzes") becomes a COMPILE ERROR here rather than a
 * silently wrong label.
 */
const PLURAL: Record<'lesson' | 'module', string> = {
  lesson: 'lessons',
  module: 'modules',
};
