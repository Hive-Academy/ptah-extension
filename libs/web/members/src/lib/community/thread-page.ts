import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import {
  AlertTriangle,
  ArrowLeft,
  Lock,
  LucideAngularModule,
  Pin,
  Trash2,
} from 'lucide-angular';

import {
  FIRST_PAGE,
  type MemberPost,
  type MemberTopicDetail,
  type ReactionType,
} from '@ptah-contracts/community';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import { TagChip } from '@ptah-web/panel-ui';

import { MemberCommunityApiService } from '../services/member-community-api.service';
import { AcceptedAnswerBadge } from './components/accepted-answer-badge';
import { ReactionBar } from './components/reaction-bar';
import { ReplyComposer } from './components/reply-composer';

/**
 * One post as this page renders it.
 *
 * ⚠️ `isReply` IS A BOOLEAN AND THAT IS THE WHOLE POINT (R1.3.4, RK-12). It is
 * `post.parentId !== null` and nothing else — not a computed depth, not a
 * recursion counter. A boolean CANNOT EXPRESS a third level, so data produced by
 * a future migration or by a server bug renders at depth 2 or at depth 1 and has
 * no third option available to it. See {@link ThreadPage} for why that matters.
 */
interface ThreadRowModel {
  readonly post: MemberPost;
  readonly isReply: boolean;
}

/**
 * ThreadPage — `/members/community/topics/:slug` (R1.3).
 *
 * ⚠️ THE INDENT IS DRIVEN BY `parentId != null`, BY NOTHING ELSE (R1.3.4,
 * RK-12). The server caps depth at 2 and REPAIRS a depth-3 attempt rather than
 * rejecting it, so the wire should never carry a third level. This renderer does
 * not trust that and does not need to: {@link ThreadRowModel.isReply} is a
 * boolean, the template has exactly two branches, and there is NO RECURSIVE
 * COMPONENT here that could nest further. A depth-3 row cannot be drawn because
 * the renderer has no way to say it — which is a stronger guarantee than a
 * clamp, because a clamp has to be correct and an absent capability does not.
 * `thread-page.spec.ts` asserts it against deliberately malformed depth-3
 * fixture data; that assertion is a §8.2 exit-gate item.
 *
 * ⚠️ POST #1 IS THE TOPIC BODY (AD-9). There is no `bodyMarkdown` on
 * `MemberTopicDetail` and no `Topic.body` column. The opening post arrives in
 * `posts.items` like any other, with `postNumber === 1`, and is rendered above
 * the divider as the body. On page 2+ it is simply absent and the page renders
 * the replies alone — which is correct, not a missing-body bug.
 *
 * ⚠️ THE ACCEPTED ANSWER IS RENDERED TWICE, ON PURPOSE (§3.3, R1.5.1).
 * `acceptedPost` is hoisted directly under the opening post so it is reachable
 * without paging to wherever it landed; the same post also appears in its
 * chronological position carrying `accepted: true`, marked where it happened.
 * Both come from ONE response. Do not fetch it separately and do not filter the
 * duplicate out — dropping the hoist makes the answer unreachable on a long
 * thread, and filtering the in-line copy puts a hole in the chronology and
 * detaches every reply made to it.
 *
 * ⚠️ A DELETED POST IS A TOMBSTONE, NOT A REMOVAL (R1.3.5, AD-5). `deleted:
 * true` arrives with `bodyMarkdown: ''` and `authorName: null`; the row keeps
 * its `postNumber` and its children stay attached beneath it. The page renders
 * the tombstone rather than assuming a body — and never passes `''` to the
 * markdown renderer, because an empty render is a silently blank row.
 *
 * ⚠️ EVERY BODY GOES THROUGH `<ptah-markdown-block>` (AD-1, PRE-4, NFR-S2). The
 * `'member'` preset is resolved from the route-level injector `app.routes.ts`
 * installs for the whole `/members` subtree. No `[innerHTML]`, no
 * `bypassSecurityTrustHtml`, no second renderer. `variant="auto"` because this
 * surface has a light theme.
 *
 * ⚠️ `404` AND `403` RENDER DIFFERENTLY, AND CONFLATING THEM LEAKS. `404` means
 * "this does not exist" and covers BOTH absent and invisible, indistinguishably
 * (R1.1.3) — saying "you are not allowed to see this" would confirm it exists.
 * `403` means visible-but-forbidden and carries a stable machine `reason`
 * (`'topic_locked'`), which is what the UI matches on rather than the sentence.
 */
@Component({
  selector: 'ptah-thread-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    RouterLink,
    LucideAngularModule,
    MarkdownBlockComponent,
    TagChip,
    AcceptedAnswerBadge,
    ReactionBar,
    ReplyComposer,
  ],
  template: `
    <div class="flex flex-col gap-6">
      <a
        class="inline-flex w-fit items-center gap-1 text-sm text-base-content-muted transition-colors hover:text-base-content"
        routerLink="/members/community"
      >
        <lucide-angular
          [img]="ArrowLeftIcon"
          class="h-4 w-4"
          aria-hidden="true"
        />
        Back to community
      </a>

      @if (topic(); as thread) {
        <article class="flex flex-col gap-6">
          <header class="flex flex-col gap-2">
            <div class="flex flex-wrap items-center gap-2">
              @if (thread.pinned) {
                <lucide-angular
                  [img]="PinIcon"
                  class="h-4 w-4 text-primary"
                  aria-label="Pinned"
                />
              }
              @if (thread.locked) {
                <lucide-angular
                  [img]="LockIcon"
                  class="h-4 w-4 text-base-content-muted"
                  aria-label="Locked"
                />
              }
              <ptah-tag-chip [label]="thread.categoryName" size="sm" />
            </div>
            <h1
              class="text-2xl font-bold tracking-tight text-base-content sm:text-3xl"
            >
              {{ thread.title }}
            </h1>
            <p
              class="flex flex-wrap items-center gap-2 font-mono text-xs text-base-content-muted"
            >
              <span>{{ thread.authorName ?? 'Unknown' }}</span>
              <span aria-hidden="true">·</span>
              <time [attr.datetime]="thread.createdAt">
                {{ thread.createdAt | date: 'MMM d, y, HH:mm' }}
              </time>
              @if (thread.editedAt) {
                <span aria-hidden="true">·</span>
                <span>edited</span>
              }
            </p>
          </header>

          <!--
            Post #1 IS the body (AD-9). Present only on page 1; on later pages
            the thread renders its replies alone, which is correct.
          -->
          @if (openingPost(); as opening) {
            <section
              class="rounded-xl border border-hairline bg-base-200 p-5"
              aria-label="Opening post"
            >
              @if (opening.deleted) {
                <p
                  class="flex items-center gap-2 text-sm italic text-base-content-muted"
                >
                  <lucide-angular
                    [img]="Trash2Icon"
                    class="h-4 w-4"
                    aria-hidden="true"
                  />
                  This post was deleted.
                </p>
              } @else {
                <ptah-markdown-block
                  [content]="opening.bodyMarkdown"
                  variant="auto"
                />
                <div class="mt-4">
                  <ptah-reaction-bar
                    [counts]="opening.reactions"
                    [mine]="opening.myReactions"
                    [disabled]="reactingOn() === opening.id"
                    (toggled)="toggleReaction(opening, $event)"
                  />
                </div>
              }
            </section>
          }

          <!--
            The HOISTED accepted answer. The same post also appears below, in
            its chronological position — that duplication is the design.
          -->
          @if (thread.acceptedPost; as accepted) {
            <section
              class="rounded-xl border border-hairline bg-surface-high p-5"
              aria-label="Accepted answer"
            >
              <div class="mb-3 flex flex-wrap items-center gap-2">
                <ptah-accepted-answer-badge [hoisted]="true" />
                <span class="font-mono text-xs text-base-content-muted">
                  {{ accepted.authorName ?? 'Unknown' }}
                </span>
              </div>
              <ptah-markdown-block
                [content]="accepted.bodyMarkdown"
                variant="auto"
              />
            </section>
          }

          <section aria-label="Replies" class="flex flex-col gap-3">
            <h2
              class="text-sm font-semibold uppercase tracking-wide text-base-content-muted"
            >
              {{ replyHeading() }}
            </h2>

            @for (row of replyRows(); track row.post.id) {
              <!--
                ⚠️ EXACTLY TWO BRANCHES. isReply is a boolean; there is no third
                indent to reach and no recursive component to reach it with.
              -->
              <div
                class="rounded-xl border border-hairline bg-base-200 p-4"
                [class.ml-0]="!row.isReply"
                [class.ml-6]="row.isReply"
                [class.sm:ml-10]="row.isReply"
                [attr.data-reply]="row.isReply"
                [attr.data-post-number]="row.post.postNumber"
              >
                <div
                  class="mb-2 flex flex-wrap items-center gap-2 font-mono text-xs text-base-content-muted"
                >
                  <span>{{ row.post.authorName ?? 'Unknown' }}</span>
                  <span aria-hidden="true">·</span>
                  <time [attr.datetime]="row.post.createdAt">
                    {{ row.post.createdAt | date: 'MMM d, HH:mm' }}
                  </time>
                  @if (row.post.editedAt) {
                    <span aria-hidden="true">·</span>
                    <span>edited</span>
                  }
                  @if (row.post.accepted) {
                    <ptah-accepted-answer-badge />
                  }
                </div>

                @if (row.post.deleted) {
                  <p
                    class="flex items-center gap-2 text-sm italic text-base-content-muted"
                  >
                    <lucide-angular
                      [img]="Trash2Icon"
                      class="h-4 w-4"
                      aria-hidden="true"
                    />
                    This post was deleted.
                  </p>
                } @else {
                  <ptah-markdown-block
                    [content]="row.post.bodyMarkdown"
                    variant="auto"
                  />
                  <div class="mt-3 flex flex-wrap items-center gap-3">
                    <ptah-reaction-bar
                      [counts]="row.post.reactions"
                      [mine]="row.post.myReactions"
                      [disabled]="reactingOn() === row.post.id"
                      (toggled)="toggleReaction(row.post, $event)"
                    />
                    @if (!thread.locked && !row.isReply) {
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs normal-case"
                        (click)="openReplyTo(row.post)"
                      >
                        Reply
                      </button>
                    }
                  </div>
                }

                @if (replyingToId() === row.post.id) {
                  <div class="mt-3">
                    <ptah-reply-composer
                      [nested]="true"
                      [replyingTo]="row.post.authorName"
                      [submitting]="posting()"
                      [errorMessage]="postError()"
                      (submitted)="postReply($event, row.post.id)"
                      (cancelled)="closeReply()"
                    />
                  </div>
                }
              </div>
            } @empty {
              <p class="text-sm text-base-content-muted">
                No replies yet — be the first.
              </p>
            }
          </section>

          @if (showPager()) {
            <nav
              class="flex items-center justify-between gap-3"
              aria-label="Pagination"
            >
              <button
                type="button"
                class="btn btn-ghost btn-sm normal-case"
                [disabled]="thread.posts.page <= firstPage"
                (click)="goToPage(thread.posts.page - 1)"
              >
                Previous
              </button>
              <p class="font-mono text-xs text-base-content-muted">
                Page {{ thread.posts.page }}
              </p>
              <button
                type="button"
                class="btn btn-ghost btn-sm normal-case"
                [disabled]="!thread.posts.hasMore"
                (click)="goToPage(thread.posts.page + 1)"
              >
                Next
              </button>
            </nav>
          }

          @if (thread.locked) {
            <p
              class="rounded-xl border border-hairline bg-base-200 p-4 text-sm text-base-content-muted"
              role="status"
            >
              This thread is locked. Existing replies stay readable, but no new
              ones can be added.
            </p>
          } @else if (replyingToId() === null) {
            <ptah-reply-composer
              [submitting]="posting()"
              [errorMessage]="postError()"
              (submitted)="postReply($event, null)"
              (cancelled)="clearPostError()"
            />
          }
        </article>
      } @else if (errorMessage(); as message) {
        <div
          class="mx-auto max-w-lg rounded-xl border border-hairline bg-base-200 p-6 text-center"
          role="alert"
        >
          <lucide-angular
            [img]="AlertTriangleIcon"
            class="mx-auto h-8 w-8 text-warning"
            aria-hidden="true"
          />
          <h1 class="mt-3 text-lg font-semibold text-base-content">
            {{ errorHeading() }}
          </h1>
          <p class="mt-1 text-sm text-base-content-muted">{{ message }}</p>
          <a
            class="btn btn-primary btn-sm mt-4 normal-case"
            routerLink="/members/community"
          >
            Back to community
          </a>
        </div>
      } @else {
        <div class="flex flex-col gap-4" aria-busy="true" aria-live="polite">
          <span class="sr-only">Loading this thread</span>
          <div class="h-9 w-2/3 animate-pulse rounded-lg bg-base-200"></div>
          <div class="h-40 animate-pulse rounded-xl bg-base-200"></div>
          <div class="h-24 animate-pulse rounded-xl bg-base-200"></div>
        </div>
      }
    </div>
  `,
})
export class ThreadPage {
  private readonly api = inject(MemberCommunityApiService);
  private readonly destroyRef = inject(DestroyRef);

  /**
   * The `:slug` route parameter, as a signal.
   *
   * ⚠️ READ FROM `ActivatedRoute`, NOT DECLARED AS AN `input()`. A route input
   * would be the nicer shape, but it needs `withComponentInputBinding()` on
   * `provideRouter`, and `apps/ptah-landing-page/src/app/app.config.ts` does not
   * install it. Adding it there is an app-wide router change that would alter
   * how EVERY existing routed component receives its parameters — out of scope
   * for this lib, and not something to slip in for one page's ergonomics.
   * Recorded so a later batch that does enable it knows this is the first
   * consumer waiting.
   *
   * ⚠️ It is a SIGNAL over the param map, not a one-shot read. Navigating from
   * one thread to another reuses this component instance, and a snapshot read
   * would leave the first thread on screen forever.
   */
  protected readonly slug = toSignal(
    inject(ActivatedRoute).paramMap.pipe(
      map((params) => params.get('slug') ?? ''),
    ),
    { initialValue: '' },
  );

  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly ArrowLeftIcon = ArrowLeft;
  protected readonly LockIcon = Lock;
  protected readonly PinIcon = Pin;
  protected readonly Trash2Icon = Trash2;
  protected readonly firstPage = FIRST_PAGE;

  private readonly _topic = signal<MemberTopicDetail | null>(null);
  protected readonly topic = this._topic.asReadonly();
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly errorHeading = signal('We could not load this thread');
  protected readonly posting = signal(false);
  protected readonly postError = signal<string | null>(null);
  protected readonly replyingToId = signal<string | null>(null);
  protected readonly reactingOn = signal<string | null>(null);

  /**
   * The read marker is posted ONCE per thread open (R1.6.1), not once per
   * render and not once per page step. `markRead` is monotonic server-side, so a
   * repeat is harmless — but a page that emits one on every change detection
   * would spend a member's 60/min progress-write budget on scrolling.
   */
  private markedReadFor: string | null = null;

  /** Post #1, present only on page 1. `null` elsewhere — see the docblock. */
  protected readonly openingPost = computed<MemberPost | null>(() => {
    const thread = this._topic();
    if (!thread) return null;
    const first = thread.posts.items[0];
    return first && first.postNumber === 1 ? first : null;
  });

  /**
   * Everything below the opening post, in the order the server sent it
   * (`postNumber` ascending — chronological).
   *
   * ⚠️ THE ACCEPTED POST IS NOT REMOVED HERE even though it is also rendered
   * hoisted above. See the class docblock: filtering it would put a hole in the
   * chronology and detach its replies.
   */
  protected readonly replyRows = computed<readonly ThreadRowModel[]>(() => {
    const thread = this._topic();
    if (!thread) return [];
    const opening = this.openingPost();

    return thread.posts.items
      .filter((post) => post !== opening)
      .map((post) => ({
        post,
        // ⚠️ THE ONE PLACE INDENT IS DECIDED. A boolean, from one field.
        isReply: post.parentId !== null,
      }));
  });

  protected readonly replyHeading = computed<string>(() => {
    const count = this.replyRows().length;
    return count === 1 ? '1 reply' : `${count} replies`;
  });

  protected readonly showPager = computed<boolean>(() => {
    const posts = this._topic()?.posts;
    if (!posts) return false;
    return posts.hasMore || posts.page > FIRST_PAGE;
  });

  public constructor() {
    // An `effect` rather than a one-shot constructor call: navigating from one
    // thread to another REUSES this component instance, so the load has to
    // follow the parameter rather than the lifecycle.
    //
    // `untracked` around the body is load-bearing. `load()` writes
    // `errorMessage` and `_topic`, and reads signals on the way; without it this
    // effect would take a dependency on its own writes and re-enter.
    effect(() => {
      const slug = this.slug();
      if (slug.length === 0) return;
      untracked(() => {
        this.markedReadFor = null;
        this.replyingToId.set(null);
        this.load(slug, FIRST_PAGE);
      });
    });
  }

  protected goToPage(page: number): void {
    if (page < FIRST_PAGE) return;
    this.load(this.slug(), page);
  }

  protected openReplyTo(post: MemberPost): void {
    this.postError.set(null);
    this.replyingToId.set(post.id);
  }

  protected closeReply(): void {
    this.postError.set(null);
    this.replyingToId.set(null);
  }

  protected clearPostError(): void {
    this.postError.set(null);
  }

  /**
   * Posts a reply.
   *
   * ⚠️ THE RESPONSE IS AUTHORITATIVE ABOUT WHERE IT LANDED. A `parentId` two
   * levels deep is REPAIRED server-side to depth 2 (R1.3.3, RK-12), so the
   * created post can come back attached to a different parent than the one
   * requested. Re-reading the thread rather than splicing the request's own
   * `parentId` into the list is what keeps the drawn tree honest.
   */
  protected postReply(bodyMarkdown: string, parentId: string | null): void {
    const thread = this._topic();
    if (!thread) return;

    this.posting.set(true);
    this.postError.set(null);

    this.api
      .createPost(thread.id, { bodyMarkdown, parentId })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.posting.set(false);
          this.replyingToId.set(null);
          // Re-read the page the member is on. The new reply changes
          // `postCount`, `lastPostedAt` and possibly the page boundary.
          this.load(this.slug(), thread.posts.page, { markRead: false });
        },
        error: (error: unknown) => {
          this.posting.set(false);
          this.postError.set(replyError(error));
        },
      });
  }

  /**
   * Toggles one reaction OPTIMISTICALLY, then reconciles from the response.
   *
   * The optimistic step is what makes the button feel instant; the reconcile is
   * what makes it correct. `PUT` converges on retry, so the response is the
   * authoritative state for that post and is applied wholesale rather than
   * merged — a merge would keep a locally-guessed count alive if the two
   * disagreed. On failure the pre-click snapshot is restored, so a rejected
   * toggle does not leave a lie on screen.
   */
  protected toggleReaction(post: MemberPost, type: ReactionType): void {
    const applied = post.myReactions.includes(type);
    this.reactingOn.set(post.id);

    this.patchPost(post.id, (current) => ({
      ...current,
      reactions: {
        ...current.reactions,
        [type]: Math.max(0, current.reactions[type] + (applied ? -1 : 1)),
      },
      myReactions: applied
        ? current.myReactions.filter((t) => t !== type)
        : [...current.myReactions, type],
    }));

    this.api
      .toggleReaction(post.id, type)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.reactingOn.set(null);
          this.patchPost(post.id, (current) => ({
            ...current,
            reactions: result.counts,
            myReactions: result.mine,
          }));
        },
        error: () => {
          this.reactingOn.set(null);
          // Restore the pre-click truth rather than re-toggling: re-toggling
          // assumes the optimistic write is the only thing that moved.
          this.patchPost(post.id, () => post);
        },
      });
  }

  /**
   * Replaces one post wherever it appears — in `posts.items` AND in the hoisted
   * `acceptedPost`, which is the SAME post sent twice. Updating only one copy
   * would make the hoisted answer and its in-line twin show different reaction
   * counts on the same screen, which is the concrete cost of that duplication if
   * it is handled carelessly.
   */
  private patchPost(
    id: string,
    update: (post: MemberPost) => MemberPost,
  ): void {
    this._topic.update((thread) => {
      if (!thread) return thread;
      return {
        ...thread,
        acceptedPost:
          thread.acceptedPost?.id === id
            ? update(thread.acceptedPost)
            : thread.acceptedPost,
        posts: {
          ...thread.posts,
          items: thread.posts.items.map((post) =>
            post.id === id ? update(post) : post,
          ),
        },
      };
    });
  }

  private load(
    slug: string,
    page: number,
    options: { markRead?: boolean } = {},
  ): void {
    this.errorMessage.set(null);

    this.api
      .getTopic(slug, page)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (thread) => {
          this._topic.set(thread);
          if (options.markRead !== false) this.markRead(thread);
        },
        error: (error: unknown) => {
          this._topic.set(null);
          const status =
            error instanceof HttpErrorResponse ? error.status : null;
          if (status === 404) {
            // ⚠️ ABSENT AND INVISIBLE ARE THE SAME ANSWER (R1.1.3). Saying
            // "you are not allowed to see this" would confirm it exists.
            this.errorHeading.set('This thread is not available');
            this.errorMessage.set(
              'It may have been deleted, or it is in a category you do not have access to.',
            );
          } else {
            this.errorHeading.set('We could not load this thread');
            this.errorMessage.set(
              error instanceof Error && error.message
                ? error.message
                : 'Something went wrong loading this thread.',
            );
          }
        },
      });
  }

  /**
   * Advances the read marker to the highest `postNumber` on this page, once per
   * open. Failure is swallowed on purpose: a member who read a thread does not
   * need to be told that recording that fact failed, and the marker is monotonic
   * so the next open re-attempts it.
   */
  private markRead(thread: MemberTopicDetail): void {
    if (this.markedReadFor === thread.id) return;
    this.markedReadFor = thread.id;

    const highest = thread.posts.items.reduce(
      (max, post) => Math.max(max, post.postNumber),
      0,
    );
    if (highest === 0) return;

    this.api
      .markRead(thread.id, highest)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => undefined });
  }
}

/**
 * The reply composer's error line.
 *
 * ⚠️ IT MATCHES ON THE MACHINE `reason`, NOT ON THE SENTENCE. `403
 * { reason: 'topic_locked' }` is a stable wire value; the server's message text
 * is not, and matching it would break the first time someone improved the
 * copy.
 */
function replyError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as { reason?: unknown } | null | undefined;
    if (error.status === 403 && body?.reason === 'topic_locked') {
      return 'This thread was locked while you were writing. Your reply was not posted.';
    }
    if (error.status === 404) {
      return 'This thread is no longer available.';
    }
  }
  return 'We could not post your reply. Try again in a moment.';
}
