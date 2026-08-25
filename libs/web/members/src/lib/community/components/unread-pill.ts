import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

/**
 * UnreadPill — "N new" on a topic row or a category rail entry (R1.6.2).
 *
 * ⚠️ PRIVATE TO `libs/web/members`, DELIBERATELY (§5.3). Unread state is
 * PER-MEMBER (A-6): an admin listing topics is not reading them as a member and
 * `AdminTopicSummary` carries no `unreadCount` at all. Promoting this into
 * `@ptah-web/panel-ui` would put a member-only concept in a lib the admin panel
 * imports, and the promotion rule is "a second panel actually renders it" —
 * nothing else does.
 *
 * ⚠️ IT RENDERS NOTHING AT ZERO. A "0 new" chip on every already-read topic is
 * noise that trains a member to stop looking at the badge, which is the one
 * thing it exists to do. This is the same principle as R1.7.3's "never a bare
 * zero", applied to a chip instead of an empty page.
 *
 * ⚠️ THE NUMBER'S MEANING DEPENDS ON WHO BOUND IT, AND THE TWO ARE NOT
 * INTERCHANGEABLE. `MemberTopicSummary.unreadCount` counts POSTS within one
 * topic; `MemberCategory.unreadCount` counts TOPICS with any unread activity.
 * {@link noun} makes the accessible label say which, so a screen reader is not
 * told "3 unread replies" about a category with three unread threads.
 */
@Component({
  selector: 'ptah-unread-pill',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (count() > 0) {
      <span
        class="badge badge-primary badge-sm shrink-0 font-mono"
        [attr.aria-label]="accessibleLabel()"
      >
        {{ count() }} new
      </span>
    }
  `,
})
export class UnreadPill {
  /** Clamped at 0 server-side; a negative value would still render nothing. */
  public readonly count = input.required<number>();

  /**
   * What the count counts. `'reply'` on a topic row, `'thread'` on a category
   * rail entry. Visible text stays "N new" either way — the distinction only
   * has to reach a screen reader, where "3 new" alone is meaningless.
   */
  public readonly noun = input<'reply' | 'thread'>('reply');

  protected readonly accessibleLabel = computed<string>(() => {
    const count = this.count();
    const noun = this.noun();
    // A `Record` over the union, not `noun + 's'` — "reply" pluralises to
    // "replies", and the naive concatenation shipped "3 unread replys" until a
    // spec caught it.
    return `${count} unread ${count === 1 ? noun : PLURAL[noun]}`;
  });
}

const PLURAL: Record<'reply' | 'thread', string> = {
  reply: 'replies',
  thread: 'threads',
};
