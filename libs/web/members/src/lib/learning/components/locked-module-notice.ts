import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { Lock, LucideAngularModule } from 'lucide-angular';

import type { LockReason } from '@ptah-contracts/community';

/**
 * LockedModuleNotice — why a module is not open yet, in PLAIN LANGUAGE
 * (R2.4.1, R2.4.2, R2.4.5).
 *
 * ⚠️ PRIVATE TO `libs/web/members` (§5.3). A lock notice is member-facing by
 * definition — an operator sees `releaseAt` as a datetime field on an admin
 * form, not as "unlocks on Tuesday" — so no second panel will ever render this
 * and it must not be promoted.
 *
 * ⚠️ 🔴 IT MATCHES ON THE MACHINE `reason`, NEVER ON THE SERVER'S SENTENCE. The
 * `403` body carries `{ reason, unlocksAt, message }`; `message` is copy and may
 * be edited without a deploy note, so matching it would break the first time
 * someone improved the wording. {@link COPY} is a `Record` over `LockReason`,
 * which means a THIRD reason added to the contract becomes a COMPILE ERROR here
 * rather than a blank notice — the same device `ReactionBar` uses for
 * `REACTION_TYPES`, and for the same stated reason.
 *
 * ⚠️ 🔴 THE LOCK IS A SERVER FACT AND THIS COMPONENT NEVER EVALUATES IT. It
 * renders `reason` and `unlocksAt` off the wire; it does not compare
 * `releaseAt` against the browser's clock. A client-side comparison would drift
 * from the server's, would make the outline and the lesson endpoint disagree,
 * and is precisely the "hidden only by CSS" defect R2.4.5 names. The `403` is
 * the enforcement; this is the explanation.
 *
 * ⚠️ `unlocksAt` IS `null` FOR `'previous_module_incomplete'` AND THAT IS THE
 * CONTRACT. It unlocks on an ACTION, not on a clock. The copy for that branch
 * therefore names the blocking module rather than inventing a date.
 *
 * ⚠️ RENDERED IN THE MEMBER'S LOCALE, INSIDE A REAL `<time datetime>`. The
 * machine value stays in the attribute so a screen reader and a scraper both
 * get something usable; a flattened string loses the `<time>` semantics
 * entirely. `ThreadRow` made the same call for `lastPostedAt`.
 *
 * ⚠️ NOT COLOUR-ALONE (WCAG 1.4.1). A padlock ICON plus text, never a grey row
 * — Batch 15's axe pass would find a colour-only state and it would be right
 * to.
 */
@Component({
  selector: 'ptah-locked-module-notice',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, LucideAngularModule],
  template: `
    <div
      class="flex items-start gap-3 rounded-xl border border-hairline bg-base-200 p-4"
      role="note"
      [attr.aria-label]="accessibleLabel()"
      data-testid="locked-module-notice"
    >
      <!--
        The icon is decorative for a screen reader — the sentence beside it
        already says "locked" — but it is what makes the state legible without
        relying on colour.
      -->
      <lucide-angular
        [img]="LockIcon"
        class="mt-0.5 h-5 w-5 shrink-0 text-base-content-muted"
        aria-hidden="true"
      />
      <div class="flex flex-col gap-1">
        <p class="text-sm font-semibold text-base-content">
          {{ heading() }}
        </p>
        <p class="text-sm text-base-content-muted">
          @if (reason() === 'not_released' && unlocksAt(); as iso) {
            Unlocks on
            <time [attr.datetime]="iso" class="font-medium text-base-content">
              {{ iso | date: 'MMMM d, y' }}
            </time>
          } @else {
            {{ body() }}
          }
        </p>
      </div>
    </div>
  `,
})
export class LockedModuleNotice {
  /** The machine value off the wire. Never the server's sentence. */
  public readonly reason = input.required<LockReason>();

  /**
   * ISO 8601, or `null`.
   *
   * ⚠️ TYPED AS THE WIRE TYPE (`string | null`), not as `Date | null`. Task
   * 10.8's sketch said `Date`; `MemberModuleSummary.unlocksAt` and the `403`
   * body are both `string`, and converting at every call site would put a
   * `new Date(...)` in three components instead of a `datetime` attribute in
   * one template.
   */
  public readonly unlocksAt = input<string | null>(null);

  /**
   * The title of the module that must be finished first. Used only by the
   * `'previous_module_incomplete'` branch; `null` renders the generic form.
   */
  public readonly blockingModuleTitle = input<string | null>(null);

  protected readonly LockIcon = Lock;

  protected readonly heading = computed<string>(
    () => COPY[this.reason()].heading,
  );

  /**
   * The explanatory sentence for the non-date branch.
   *
   * The date branch renders in the template instead, because it needs a real
   * `<time datetime>` element and a locale-formatted body — neither of which
   * survives being flattened into a string here.
   */
  protected readonly body = computed<string>(() => {
    const reason = this.reason();
    if (reason === 'previous_module_incomplete') {
      const blocking = this.blockingModuleTitle();
      return blocking
        ? `Complete every lesson in ${blocking} to unlock this module.`
        : 'Complete every lesson in the previous module to unlock this module.';
    }
    // `'not_released'` with a null date: the server said "not released" and
    // gave no timestamp. Saying "soon" is honest; inventing a date is not.
    return 'This module opens later in the programme.';
  });

  /**
   * What a screen reader is told about the whole notice.
   *
   * The visible copy is two elements and a `<time>`; this is the one-sentence
   * form, so the state is announced as a state rather than as loose text.
   */
  protected readonly accessibleLabel = computed<string>(() => {
    if (this.reason() === 'not_released' && this.unlocksAt()) {
      return `Locked. Unlocks on ${formatIsoDay(this.unlocksAt() as string)}.`;
    }
    return `Locked. ${this.body()}`;
  });
}

/**
 * 🔴 A `Record` OVER THE UNION, NOT A `switch` WITH A `default`.
 *
 * `LOCK_REASONS` has exactly two members today and R2.4.3 fixes that a
 * non-sequential course simply does not apply the second rule — it is the
 * ABSENCE of a reason, not a third one. If a third is ever added to the
 * contract, this object stops compiling and someone has to write the copy.
 * A `default:` branch would ship a blank notice instead.
 */
const COPY: Record<LockReason, { heading: string }> = {
  not_released: { heading: 'This module is not open yet' },
  previous_module_incomplete: { heading: 'Finish the previous module first' },
};

/** The accessible label's date, in the member's locale. */
function formatIsoDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
