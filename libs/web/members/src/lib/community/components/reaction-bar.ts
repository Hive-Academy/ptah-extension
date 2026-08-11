import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import {
  Heart,
  Lightbulb,
  LucideAngularModule,
  type LucideIconData,
  PartyPopper,
  ThumbsUp,
} from 'lucide-angular';

import {
  REACTION_TYPES,
  type ReactionCounts,
  type ReactionType,
} from '@ptah-contracts/community';

/**
 * ReactionBar — the four reactions on one post (R1.4.1, R1.4.2, R1.4.3).
 *
 * ⚠️ PRIVATE TO `libs/web/members` (§5.3, A-8). Reactions apply to FORUM POSTS
 * ONLY and are member semantics: an admin moderating a thread does not react to
 * it, and `AdminPost` carries `reactions` for review but no `myReactions`
 * because there is no "my" on that surface. Nothing else renders this, so
 * nothing licenses promoting it.
 *
 * ⚠️ THE FOUR BUTTONS ARE ITERATED FROM `REACTION_TYPES`, NOT WRITTEN OUT.
 * R1.4.3 forbids free-form emoji, so the tuple in `@ptah-contracts/community`
 * IS the vocabulary — the API rejects anything outside it with a `400` from
 * `ParseEnumPipe`. Hard-coding four buttons here would let this bar and the
 * server's accepted set drift apart silently; iterating makes a fifth type a
 * compile error in {@link REACTION_LABEL} instead.
 *
 * ⚠️ IT IS PRESENTATIONAL: ONE EVENT PER CLICK, NO STATE OF ITS OWN. It renders
 * exactly what `counts` and `mine` say and emits {@link toggled}. Optimism and
 * reconciliation belong to the thread page, because the authoritative counts
 * come back in the `PUT` response and only the page can hold them. A bar that
 * also kept its own optimistic copy would give one post two sources of truth,
 * and they would disagree the moment a request failed.
 *
 * NFR-U3: the count sits on `text-base-content-muted`, not on an alpha tier —
 * `/40` measures 3.18:1 and `/60` measures 4.42:1 on `operator-member-light`,
 * and this number is load-bearing.
 */
@Component({
  selector: 'ptah-reaction-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  template: `
    <div
      class="flex flex-wrap items-center gap-1"
      role="group"
      aria-label="Reactions"
    >
      @for (reaction of reactions(); track reaction.type) {
        <button
          type="button"
          class="btn btn-ghost btn-xs gap-1 normal-case"
          [class.btn-active]="reaction.mine"
          [disabled]="disabled()"
          [attr.aria-pressed]="reaction.mine"
          [attr.aria-label]="reaction.accessibleLabel"
          (click)="toggled.emit(reaction.type)"
        >
          <lucide-angular
            [img]="reaction.icon"
            class="h-3.5 w-3.5"
            aria-hidden="true"
          />
          <span>{{ reaction.label }}</span>
          @if (reaction.count > 0) {
            <span class="font-mono text-base-content-muted">
              {{ reaction.count }}
            </span>
          }
        </button>
      }
    </div>
  `,
})
export class ReactionBar {
  /**
   * Per-type counts. TOTAL, never sparse — every type is present, zero-valued
   * when unreacted, which is what lets the view model below read
   * `counts[type]` without a `?? 0` that would hide a malformed response.
   */
  public readonly counts = input.required<ReactionCounts>();

  /** The requesting member's own reactions on this post. `[]` is normal. */
  public readonly mine = input<readonly ReactionType[]>([]);

  /**
   * Disables every button — used while a toggle is in flight and on a locked
   * topic. It is an AFFORDANCE, not a permission: the server decides.
   */
  public readonly disabled = input<boolean>(false);

  /** Emitted once per click, with the type the member pressed. */
  public readonly toggled = output<ReactionType>();

  protected readonly reactions = computed(() => {
    const counts = this.counts();
    const mine = new Set(this.mine());

    return REACTION_TYPES.map((type) => {
      const count = counts[type];
      const isMine = mine.has(type);
      const label = REACTION_LABEL[type];
      return {
        type,
        label,
        icon: REACTION_ICON[type],
        count,
        mine: isMine,
        // "Remove your Insightful reaction (2)" reads correctly to a screen
        // reader; the visible label alone does not say what pressing it does.
        accessibleLabel: `${isMine ? 'Remove your' : 'Add a'} ${label} reaction${
          count > 0 ? ` (${count})` : ''
        }`,
      };
    });
  });
}

/**
 * Display text per wire value. A reaction type is a WIRE VALUE, not a display
 * string — adding a member to `REACTION_TYPES` is a contract change, and this
 * `Record` over the union is what makes the frontend half of that change a
 * compile error rather than an unlabelled button.
 */
const REACTION_LABEL: Record<ReactionType, string> = {
  like: 'Like',
  insightful: 'Insightful',
  celebrate: 'Celebrate',
  thanks: 'Thanks',
};

const REACTION_ICON: Record<ReactionType, LucideIconData> = {
  like: ThumbsUp,
  insightful: Lightbulb,
  celebrate: PartyPopper,
  thanks: Heart,
};
