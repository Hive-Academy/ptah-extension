import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
  viewChildren,
} from '@angular/core';
import { LucideAngularModule, MessageSquare, Trash2 } from 'lucide-angular';

import type { MemberLessonComment } from '@ptah-contracts/community';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import { StatusBadge } from '@ptah-web/panel-ui';

import { LessonCommentComposer } from './lesson-comment-composer';

/**
 * One comment as this component renders it.
 *
 * ⚠️ 🔴 `isReply` IS A BOOLEAN AND THAT IS THE WHOLE POINT (R2.5.2 → R1.3.4,
 * RK-12). It is `comment.parentId !== null` and nothing else — not a computed
 * depth, not a recursion counter. A boolean CANNOT EXPRESS a third level, so
 * data produced by a future migration or a server bug renders at depth 2 or at
 * depth 1 and has no third option available to it.
 */
interface CommentRow {
  readonly comment: MemberLessonComment;
  readonly isReply: boolean;
  /** Never blank — see {@link authorLabel}. */
  readonly author: string;
}

/**
 * What to print as the author's name.
 *
 * ⚠️ 🔴 IT GUARDS AGAINST THE EMPTY STRING, NOT ONLY `null`, AND THAT IS
 * BECAUSE THE SERVER SENDS ONE. Measured live on 2026-08-05:
 * `lesson-comments.service.ts:529` composes the name as
 * `[firstName, lastName].filter(Boolean).join(' ').trim()`, which is `''` for
 * an account with neither — and `nameById.get(id) ?? null` keeps `''` because
 * it is a real map value, not `undefined`. So `authorName: ''` reaches the wire
 * for any member who signed up without a name, and `?? 'Unknown'` does not
 * catch it: the row renders a blank byline.
 *
 * This is a DISPLAY fallback, not a compensation for wrong data — a renderer
 * must never emit an empty byline whatever the wire says. The server-side
 * behaviour is reported separately: `MemberLessonComment.authorName` documents
 * `null` as "deleted, or the account was removed", and `''` is a third state
 * the contract does not describe.
 */
function authorLabel(name: string | null): string {
  return name !== null && name.trim().length > 0 ? name : 'Unknown';
}

/** What the page needs in order to post a reply. */
export interface LessonCommentSubmission {
  readonly bodyMarkdown: string;
  readonly parentId: string | null;
}

/**
 * LessonComments — the lesson's discussion, one level deep, with the "Answered"
 * treatment instead of reactions (R2.5.1–R2.5.5, A-8).
 *
 * ⚠️ 🔴 THE INDENT HAS EXACTLY TWO BRANCHES AND THERE IS NO RECURSIVE
 * COMPONENT. The server caps depth at 2 by REPAIR rather than rejection (a
 * depth-3 attempt is re-pointed to the parent's parent and saved — measured
 * live), so the wire should never carry a third level. This renderer does not
 * trust that and does not need to: a depth-3 row cannot be DRAWN, because the
 * renderer has no way to say it. That is a stronger guarantee than a clamp,
 * because a clamp has to be correct and an absent capability does not.
 *
 * ⚠️ 🔴 A-8 — NO REACTIONS. There is no `ReactionBar` here, no `REACTION_TYPES`
 * import, and no count of anything. "Answered" is a BOOLEAN and not a tally,
 * because it answers "was this resolved" and not "how popular is this". The
 * absence is asserted in the spec, because adding a reaction bar "for
 * consistency with the forum" is the obvious next change and it would make one
 * surface answer to two vocabularies.
 *
 * ⚠️ "ANSWERED" USES `StatusBadge` FROM `@ptah-web/panel-ui` (R9.7), not a new
 * badge — and deliberately NOT `AcceptedAnswerBadge`, which is a FORUM concept
 * (an accepted answer chosen by a topic author). This is a different one (a
 * question marked resolved), and conflating them would make one component
 * answer to two vocabularies.
 *
 * ⚠️ A TOMBSTONE RENDERS ITS PLACEHOLDER AND NEVER REACHES THE MARKDOWN
 * RENDERER. The server sends a stated sentence rather than `''` (verified
 * live: `"This comment was removed."`), and Batch 7's thread page found that
 * handing `''` to the renderer produces a silently blank row that reads as a
 * rendering bug. Its children stay attached beneath it.
 *
 * ⚠️ THE COMMENT COUNT COMES FROM THE SERVER'S LIST AND EXCLUDES NOTHING
 * LOCALLY. R2.5.5's "excludes tombstones" is already applied server-side; a
 * second count in the browser would be a second implementation of the rule.
 * What IS counted here is the length of the rendered list, which is a
 * description of the DOM rather than a re-derivation.
 *
 * ⚠️ NFR-S2: every body goes through `<ptah-markdown-block variant="auto">`.
 * No `[innerHTML]`, no `bypassSecurityTrustHtml`, no second renderer.
 * `markdown-chokepoint.spec.ts` names this file's composer as one of the five
 * permitted importers.
 */
@Component({
  selector: 'ptah-lesson-comments',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    LucideAngularModule,
    MarkdownBlockComponent,
    StatusBadge,
    LessonCommentComposer,
  ],
  template: `
    <section class="flex flex-col gap-4" aria-labelledby="lesson-discussion">
      <h2
        id="lesson-discussion"
        class="flex items-center gap-2 text-lg font-semibold text-base-content"
      >
        <lucide-angular
          [img]="MessageIcon"
          class="h-5 w-5 text-base-content/60"
          aria-hidden="true"
        />
        {{ heading() }}
      </h2>

      @for (row of rows(); track row.comment.id) {
        <!--
          EXACTLY TWO BRANCHES. isReply is a boolean; there is no third indent
          to reach and no recursive component to reach it with.
        -->
        <article
          class="rounded-xl border border-hairline bg-base-200 p-4"
          [class.ml-0]="!row.isReply"
          [class.ml-6]="row.isReply"
          [class.sm:ml-10]="row.isReply"
          [attr.data-reply]="row.isReply"
          [attr.data-comment-id]="row.comment.id"
        >
          <div
            class="mb-2 flex flex-wrap items-center gap-2 font-mono text-xs text-base-content/60"
          >
            <span>{{ row.author }}</span>
            <span aria-hidden="true">·</span>
            <time [attr.datetime]="row.comment.createdAt">
              {{ row.comment.createdAt | date: 'MMM d, HH:mm' }}
            </time>
            @if (row.comment.editedAt) {
              <span aria-hidden="true">·</span>
              <span>edited</span>
            }
            @if (row.comment.answered) {
              <ptah-status-badge variant="success" label="Answered" size="xs" />
            }
          </div>

          @if (row.comment.deleted) {
            <p
              class="flex items-center gap-2 text-sm italic text-base-content/60"
            >
              <lucide-angular
                [img]="Trash2Icon"
                class="h-4 w-4"
                aria-hidden="true"
              />
              {{ row.comment.bodyMarkdown }}
            </p>
          } @else {
            <ptah-markdown-block
              [content]="row.comment.bodyMarkdown"
              variant="auto"
            />

            <div class="mt-3 flex flex-wrap items-center gap-2">
              @if (!row.isReply) {
                <button
                  type="button"
                  class="btn btn-ghost btn-xs normal-case"
                  [attr.aria-label]="'Reply to ' + row.author"
                  (click)="openReplyTo(row.comment)"
                >
                  Reply
                </button>
                @if (canSetAnswered()) {
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs normal-case"
                    [attr.aria-label]="answeredLabel(row.comment)"
                    [attr.aria-pressed]="row.comment.answered"
                    [disabled]="busyOn() === row.comment.id"
                    (click)="answeredToggled.emit(row.comment)"
                  >
                    {{
                      row.comment.answered ? 'Unmark answered' : 'Mark answered'
                    }}
                  </button>
                }
              }
            </div>
          }

          @if (replyingToId() === row.comment.id) {
            <div class="mt-3">
              <ptah-lesson-comment-composer
                [nested]="true"
                [replyingTo]="row.author"
                [submitting]="submitting()"
                [errorMessage]="errorMessage()"
                (submitted)="emitReply($event, row.comment.id)"
                (cancelled)="closeReply()"
              />
            </div>
          }
        </article>
      } @empty {
        <p class="text-sm text-base-content/60">
          No questions on this lesson yet — ask the first one.
        </p>
      }

      @if (replyingToId() === null) {
        <ptah-lesson-comment-composer
          [cancellable]="false"
          [submitting]="submitting()"
          [errorMessage]="errorMessage()"
          (submitted)="emitReply($event, null)"
        />
      }
    </section>
  `,
})
export class LessonComments {
  /**
   * The thread, FLAT and in `createdAt` order, exactly as the wire carries it.
   *
   * ⚠️ NOT RE-SORTED AND NOT NESTED INTO A TREE. Two levels is a fixed, small
   * depth; grouping is a boolean per row.
   */
  public readonly comments = input.required<readonly MemberLessonComment[]>();

  /** A write is in flight. Disables the composers. */
  public readonly submitting = input<boolean>(false);

  /** A server-side failure to show inside the composer. */
  public readonly errorMessage = input<string | null>(null);

  /** The comment whose "Answered" toggle is in flight. */
  public readonly busyOn = input<string | null>(null);

  /**
   * Whether THIS member may set the "Answered" mark (R2.5.3).
   *
   * ⚠️ 🔴 THE CONTROL IS HIDDEN WHEN THEY MAY NOT, AND THAT IS NOT COSMETIC —
   * the e2e proved the alternative is an affordance that always fails.
   * `PUT …/answered` is admin-or-course-author only
   * (`lesson-comments.service.ts:294-312`), so an ordinary member pressing it
   * gets a `403` with nothing they can do about it.
   *
   * ⚠️ IT IS AN APPROXIMATION, AND THE GAP IS STATED RATHER THAN HIDDEN. The
   * server's predicate is `ctx.isAdmin || course.createdBy === ctx.userId`, and
   * `createdBy` is NOT on any member contract — correctly, since
   * `MemberCourseSummary` exposes no authorship (NFR-S4) and
   * `MemberSessionStore` carries no user id. `isAdmin` is the closest thing the
   * client can know, and it covers every REACHABLE case: a course can only be
   * created through `POST /v1/admin/courses`, which requires `ADMIN_EMAILS`, so
   * `createdBy` is always an admin at creation time. The residual gap is an
   * author who was later removed from the allowlist — they keep the
   * server-side permission and lose the button. That is reported, not papered
   * over: the server is still the authority and still enforces it.
   */
  public readonly canSetAnswered = input<boolean>(false);

  public readonly submitted = output<LessonCommentSubmission>();
  public readonly answeredToggled = output<MemberLessonComment>();

  protected readonly MessageIcon = MessageSquare;
  protected readonly Trash2Icon = Trash2;

  protected readonly replyingToId = signal<string | null>(null);

  /**
   * Every composer currently mounted — at most two (the page-level one, or one
   * inline reply).
   */
  private readonly composers = viewChildren(LessonCommentComposer);

  /**
   * Rows in wire order, each carrying the ONE boolean that decides indent.
   *
   * ⚠️ THE LIST IS NOT REGROUPED. The server sends children immediately after
   * their parent in `createdAt` order; re-ordering here would be a second
   * ordering rule to keep in step with the server's.
   */
  protected readonly rows = computed<readonly CommentRow[]>(() =>
    this.comments().map((comment) => ({
      comment,
      // ⚠️ THE ONE PLACE INDENT IS DECIDED. A boolean, from one field.
      isReply: comment.parentId !== null,
      author: authorLabel(comment.authorName),
    })),
  );

  /**
   * "3 questions" — a description of what is rendered.
   *
   * Tombstones are already excluded server-side (R2.5.5); this counts the rows
   * it drew rather than re-applying the rule.
   */
  protected readonly heading = computed<string>(() => {
    const count = this.comments().length;
    if (count === 0) return 'Discuss this lesson';
    return count === 1 ? '1 question' : `${count} questions`;
  });

  protected openReplyTo(comment: MemberLessonComment): void {
    this.replyingToId.set(comment.id);
  }

  protected closeReply(): void {
    this.replyingToId.set(null);
  }

  protected emitReply(bodyMarkdown: string, parentId: string | null): void {
    this.replyingToId.set(null);
    this.submitted.emit({ bodyMarkdown, parentId });
  }

  /**
   * Clears every composer — called by the page only AFTER the server accepted
   * the write.
   *
   * ⚠️ NOT ON SUBMIT. Clearing optimistically loses a member's writing when the
   * post is refused — a locked module, a validation rejection, a dropped
   * connection — and the composer is the only place that text exists. The e2e
   * caught the opposite defect first: the field kept its text after a
   * SUCCESSFUL post, so a member who asked a question saw it apparently
   * unsent.
   */
  public resetComposers(): void {
    for (const composer of this.composers()) composer.reset();
  }

  /**
   * "Mark this question answered" — the ACTION, not the state.
   *
   * Batch 7's rule: "'Insightful 2' tells a screen-reader user neither what
   * pressing it does nor whether they already reacted."
   */
  protected answeredLabel(comment: MemberLessonComment): string {
    return comment.answered
      ? 'Remove the answered mark from this question'
      : 'Mark this question answered';
  }
}
