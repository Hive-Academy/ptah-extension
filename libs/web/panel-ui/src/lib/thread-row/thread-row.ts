import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import {
  CheckCircle2,
  Lock,
  LucideAngularModule,
  MessageSquare,
  Pin,
} from 'lucide-angular';

/**
 * ThreadRow — one discussion topic as a list row, shared by the member feed and
 * the admin moderation table (plan §5.3, R9.7).
 *
 * ⚠️ IT EARNED ITS PLACE IN THIS LIB BY HAVING TWO CONSUMERS, NOT BY LOOKING
 * REUSABLE. §5.3's rule for `@ptah-web/panel-ui` is that a primitive is promoted
 * when a SECOND panel actually renders it. `community-activity-card.ts` in
 * `@ptah-web/members` deliberately kept its rows inline for exactly this reason
 * and said so in its docblock. Batch 7 promotes the row because
 * `libs/web/admin/.../community/community-moderation` renders it in the same
 * batch. If that admin surface is ever deleted, this component goes back to
 * being private to the member lib rather than staying here as a speculative
 * extraction.
 *
 * ⚠️ PRESENTATIONAL ONLY. It emits nothing and fetches nothing — no `output()`,
 * no injected service, no `routerLink`. Navigation is the CONSUMER's decision
 * and the two consumers navigate to different places (a member goes to
 * `/members/community/topics/:slug`, an operator opens a moderation drawer), so
 * the row wraps in whatever the caller needs:
 *
 *   <a [routerLink]="['/members/community/topics', topic.slug]">
 *     <ptah-thread-row [title]="topic.title" … />
 *   </a>
 *
 * Baking a link in would have forced one of the two consumers to fight it.
 *
 * ⚠️ THE SECOND METADATA LINE IS `<ng-content>`, NOT AN INPUT. The member feed
 * puts a category chip and a `<time>` element there; the admin table puts the
 * author's email and the deletion timestamp. Flattening those into a `meta:
 * string` input would lose the `<time datetime>` semantics on one side and the
 * per-token styling on the other, and would grow one input per consumer as
 * phases 3-5 add surfaces.
 *
 * NFR-U2 — every colour here is a theme token: `base-content` for the title,
 * `base-content/60` for the muted line (NFR-U3's floor for load-bearing muted
 * text — `/40` measures 3.18:1 and fails WCAG AA), `primary` for the pin dot and
 * the unread badge, `success` for the accepted marker. There is no `base-300`
 * border anywhere: `base-300` is a FILL. Note that this file sits OUTSIDE the
 * `libs/web/members/**` scope of the Task 4.7 lint rule, so that rule does not
 * police it — the discipline here is manual and `panel-theme-spec.md` is still
 * the authority.
 */
@Component({
  selector: 'ptah-thread-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  templateUrl: './thread-row.html',
})
export class ThreadRow {
  /** The topic title. The one input with no sensible default. */
  public readonly title = input.required<string>();

  /**
   * Display name of the topic author. `null` for migrated/system content and
   * for a deleted account — rendered as "Unknown" rather than omitted, so the
   * metadata line does not silently change shape.
   */
  public readonly author = input<string | null>(null);

  /** Replies only — post #1 IS the body (AD-9) and is never counted here. */
  public readonly replyCount = input<number>(0);

  /**
   * Posts added since this member last read the topic (R1.6.2). `0` renders no
   * badge at all.
   *
   * ⚠️ POSTS, NOT TOPICS. `MemberCategory.unreadCount` counts TOPICS with
   * unread activity and is a different number for a different row; the two are
   * trivially confusable at a call site, so they are never bound to the same
   * input.
   */
  public readonly unreadCount = input<number>(0);

  /** Sorts above unpinned topics in the feed (R1.2.5). */
  public readonly pinned = input<boolean>(false);

  /** No new replies accepted; existing ones stay readable (R1.3.4). */
  public readonly locked = input<boolean>(false);

  /** The topic has an accepted answer (R1.5.1). */
  public readonly accepted = input<boolean>(false);

  protected readonly PinIcon = Pin;
  protected readonly LockIcon = Lock;
  protected readonly CheckIcon = CheckCircle2;
  protected readonly MessageSquareIcon = MessageSquare;

  /** "1 reply" / "0 replies" — a template cannot pluralise without this. */
  protected readonly replyLabel = computed<string>(() =>
    this.replyCount() === 1 ? '1 reply' : `${this.replyCount()} replies`,
  );

  /** `null` collapses to a stated unknown, never to a blank gap. */
  protected readonly authorLabel = computed<string>(
    () => this.author() ?? 'Unknown',
  );

  /**
   * "3 unread replies" for a screen reader. The visible chip reads "3 new",
   * which is meaningless out of context.
   *
   * ⚠️ ALWAYS "replies" — a ROW's unread count is posts within one topic. The
   * member panel also has a `UnreadPill` whose noun is configurable, because the
   * CATEGORY rail counts topics with unread activity instead. The two chips look
   * identical and count different things; this label is where a row commits to
   * which one it is.
   */
  protected readonly unreadLabel = computed<string>(() => {
    const count = this.unreadCount();
    return `${count} unread ${count === 1 ? 'reply' : 'replies'}`;
  });
}
