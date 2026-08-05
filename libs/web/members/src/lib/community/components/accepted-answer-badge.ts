import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { StatusBadge } from '@ptah-web/panel-ui';

/**
 * AcceptedAnswerBadge — marks the post the topic author (or an admin) accepted
 * as the answer (R1.5.1, R1.5.3).
 *
 * ⚠️ IT WRAPS `StatusBadge` RATHER THAN DECLARING A SECOND BADGE (R9.7). The
 * shared primitive already renders a semantic chip with the right colour and
 * glyph for `'success'`; a bespoke green pill here would be a second thing to
 * restyle when the panel theme moves, and the two would diverge the first time
 * one of them was missed.
 *
 * ⚠️ PRIVATE TO `libs/web/members` (§5.3). It is one call site's worth of
 * configuration over a primitive that IS shared — promoting a two-line wrapper
 * would put the member's vocabulary ("Accepted answer") in a lib the admin panel
 * imports, where the same post is a row in a moderation table and is not
 * described that way.
 *
 * ⚠️ THE SAME POST CARRIES THIS BADGE TWICE ON A THREAD PAGE, AND THAT IS THE
 * DESIGN (§3.3, R1.5.1). `MemberTopicDetail` sends the accepted answer hoisted
 * into `acceptedPost` AND again in its chronological position with
 * `accepted: true`. {@link hoisted} is what lets the two copies read differently
 * — the hoist announces itself, the in-line copy just marks the spot — without
 * either being a different component.
 */
@Component({
  selector: 'ptah-accepted-answer-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StatusBadge],
  template: `
    <ptah-status-badge
      variant="success"
      [label]="hoisted() ? 'Accepted answer' : 'Accepted'"
      size="sm"
    />
  `,
})
export class AcceptedAnswerBadge {
  /**
   * `true` on the copy hoisted above the thread, `false` on the copy sitting in
   * chronological order. See the duplication note in the class docblock.
   */
  public readonly hoisted = input<boolean>(false);
}
