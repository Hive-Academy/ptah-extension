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
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { combineLatest, map } from 'rxjs';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Circle,
  LucideAngularModule,
} from 'lucide-angular';

import type {
  LockReason,
  MemberLessonComment,
  MemberLessonDetail,
} from '@ptah-contracts/community';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import { MemberSessionStore } from '@ptah-web/core';

import { MemberLearningApiService } from '../services/member-learning-api.service';
import {
  LessonComments,
  type LessonCommentSubmission,
} from './components/lesson-comments';
import { LockedModuleNotice } from './components/locked-module-notice';
import { formatRuntime } from './components/module-outline';
import { CoursePlayerStore } from './course-player.store';
import { describeLoadFailure } from './courses-page';
import { YouTubePlayer } from './youtube-player';

/** What the page is currently showing. */
type LessonView =
  | { readonly kind: 'loading' }
  | { readonly kind: 'lesson'; readonly lesson: MemberLessonDetail }
  | {
      readonly kind: 'locked';
      readonly reason: LockReason;
      readonly unlocksAt: string | null;
    }
  | {
      readonly kind: 'error';
      readonly heading: string;
      readonly message: string;
      readonly retryable: boolean;
    };

/**
 * LessonPage — `/members/courses/:slug/lessons/:lessonSlug` (R2.1.5, R2.2.7,
 * R2.3.x, R2.4.x, R2.5).
 *
 * ── 🔴 THE F-4 DECISION, MADE EXPLICITLY ────────────────────────────────────
 *
 * `withComponentInputBinding()` is STILL NOT INSTALLED on `provideRouter` in
 * `apps/ptah-landing-page/src/app/app.config.ts` (B7 F-4, re-confirmed B7.1
 * F-13). **Batch 10 did not install it either, and that is a decision rather
 * than an inheritance.** This page takes TWO route parameters and is the THIRD
 * consumer that would benefit (`ThreadPage`, `CoursePage`, this). The reasons,
 * in order:
 *
 *   · It is a ONE-WORD CHANGE WITH APP-WIDE REACH. It alters how every routed
 *     component in the landing app receives its parameters — the marketing
 *     pages, `/admin`, `/profile`, checkout — and this batch's file set
 *     deliberately excludes `app.config.ts`. Batch 7 named that file as "the
 *     one place I wanted `app.config.ts` and did not take it"; the second
 *     dispatch in a row taking it silently would be worse than a third data
 *     point.
 *   · THE SIGNAL IS LOAD-BEARING REGARDLESS. Navigating lesson → lesson reuses
 *     this component instance, so a snapshot read would leave the first lesson
 *     on screen forever — and `withComponentInputBinding()` would not change
 *     that, it would only change where the signal comes from. `combineLatest`
 *     over the two params is three lines.
 *   · Three consumers is now a case worth making, and it is RECORDED HERE so
 *     the count is visible to whoever eventually makes it. That is the whole
 *     value of not doing it quietly.
 *
 * ── The rest ─────────────────────────────────────────────────────────────────
 *
 * ⚠️ 🔴 THE NO-VIDEO LAYOUT IS THE DEFAULT CASE HERE, NOT AN EDGE CASE. §7.3
 * sets `youtubeVideoId: null` on all eight seeded lessons, and with
 * `YOUTUBE_API_KEY` unset (ASSUMPTION-6) even a lesson WITH an id has no
 * thumbnail. So the page is designed body-first: notes, comments, prev/next and
 * a manual completion control are a complete lesson on their own, and the
 * player is an addition rather than the thing the layout is built around. When
 * `youtubeVideoId` is `null` there is NO player element at all — not a
 * player-shaped hole.
 *
 * ⚠️ 🔴 `404` AND `403` RENDER DIFFERENTLY AND THEIR COPY DIFFERS.
 *   · `404` — "This lesson is not available", with NONE of "not allowed" /
 *     "forbidden" / "permission". It covers invisible as well as absent
 *     (R1.1.3) and leaking the difference in copy undoes the where-clause.
 *   · `403` — the LOCKED NOTICE, which DOES say why, because the module's
 *     existence was already disclosed in the outline. It is a page STATE, never
 *     a CSS treatment (R2.4.5), and its wording comes from the machine `reason`
 *     via a `Record`, never from the server's sentence.
 *
 * ⚠️ THE COMPLETION CONTROL SAYS WHICH KIND IT IS. "Completed — watched to the
 * end" reads differently from "Completed — you marked this done", because a
 * member who cannot tell WHY a lesson is complete cannot tell whether
 * un-completing it is safe (R2.3.3). The verdict is always the server's:
 * `CoursePlayerStore` never computes a threshold.
 *
 * ⚠️ `previous` / `next` COME FROM THE SERVER AND CROSS MODULE BOUNDARIES
 * (R2.1.5). They are rendered as links and are NOT computed from neighbours. A
 * LOCKED next lesson still renders as a link — the member may see what is
 * coming (R2.4.4) — and clicking it lands on this page's `403` state, which is
 * the only place the lock can be enforced honestly.
 *
 * ⚠️ NFR-S2 — the body reaches `<ptah-markdown-block variant="auto">` and
 * nothing else. `variant="auto"` is load-bearing: the component default is
 * `'invert'` for the dark-only webview and would put near-white text on the
 * near-white `base-200` of `operator-member-light`.
 *
 * ⚠️ A COMMENT WRITE RE-READS THE LESSON RATHER THAN SPLICING THE RESPONSE.
 * Two independent reasons: the server REPAIRS a depth-3 `parentId` to depth 2,
 * so the created comment can come back attached to a different parent than the
 * one requested; and the write responses currently return `authorName: null`
 * for a live comment (a server defect, reported by Batch 10 and NOT worked
 * around — see `member-learning-api.service.ts`). Re-reading is correct for the
 * first reason alone.
 */
@Component({
  selector: 'ptah-lesson-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [CoursePlayerStore],
  imports: [
    RouterLink,
    LucideAngularModule,
    MarkdownBlockComponent,
    YouTubePlayer,
    LessonComments,
    LockedModuleNotice,
  ],
  template: `
    <div class="flex flex-col gap-6">
      <a
        class="inline-flex w-fit items-center gap-1 text-sm text-base-content-muted transition-colors hover:text-base-content"
        [routerLink]="['/members/courses', courseSlug()]"
      >
        <lucide-angular
          [img]="ArrowLeftIcon"
          class="h-4 w-4"
          aria-hidden="true"
        />
        Back to the course
      </a>

      @switch (view().kind) {
        @case ('lesson') {
          @if (lesson(); as detail) {
            <article class="flex flex-col gap-6">
              @if (detail.youtubeVideoId; as videoId) {
                <ptah-youtube-player
                  [videoId]="videoId"
                  [title]="detail.title"
                  [thumbnailUrl]="detail.videoThumbnailUrl"
                  (clockReady)="store.attachClock($event)"
                  (playbackPaused)="store.flush()"
                  (playbackEnded)="store.flush()"
                />
              }

              <header class="flex flex-wrap items-start justify-between gap-3">
                <div class="flex flex-col gap-1">
                  <h1
                    class="text-2xl font-bold tracking-tight text-base-content sm:text-3xl"
                  >
                    {{ detail.title }}
                  </h1>
                  <p
                    class="flex flex-wrap items-center gap-2 font-mono text-xs text-base-content-muted"
                  >
                    @if (runtimeLabel(); as runtime) {
                      <span>{{ runtime }}</span>
                    }
                    @if (store.completed()) {
                      <span aria-hidden="true">·</span>
                      <span data-testid="completion-reason">
                        {{ completionReason() }}
                      </span>
                    }
                  </p>
                </div>

                <!--
                  Always available, always reversible (R2.3.3). It is the ONLY
                  completion affordance when there is no persisted duration.
                -->
                <button
                  type="button"
                  class="btn btn-sm gap-1 normal-case"
                  [class.btn-primary]="!store.completed()"
                  [class.btn-ghost]="store.completed()"
                  [disabled]="store.savingCompletion()"
                  [attr.aria-pressed]="store.completed()"
                  [attr.aria-label]="completionActionLabel()"
                  data-testid="completion-toggle"
                  (click)="toggleCompletion()"
                >
                  <lucide-angular
                    [img]="store.completed() ? CheckIcon : CircleIcon"
                    class="h-4 w-4"
                    aria-hidden="true"
                  />
                  {{ completionButtonText() }}
                </button>
              </header>

              <!--
                NFR-S2 / PRE-4 — the ONE renderer. variant="auto" is required
                for operator-member-light.
              -->
              <ptah-markdown-block
                [content]="detail.bodyMarkdown"
                variant="auto"
              />

              <nav
                class="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4"
                aria-label="Lesson navigation"
              >
                @if (detail.previous; as previous) {
                  <a
                    class="btn btn-ghost btn-sm gap-1 normal-case"
                    [routerLink]="[
                      '/members/courses',
                      courseSlug(),
                      'lessons',
                      previous.slug,
                    ]"
                    [attr.aria-label]="
                      'Previous lesson: ' +
                      previous.moduleTitle +
                      ' — ' +
                      previous.title
                    "
                    data-testid="previous-lesson"
                  >
                    <lucide-angular
                      [img]="ArrowLeftIcon"
                      class="h-4 w-4"
                      aria-hidden="true"
                    />
                    {{ previous.title }}
                  </a>
                } @else {
                  <span></span>
                }

                @if (detail.next; as next) {
                  <a
                    class="btn btn-ghost btn-sm gap-1 normal-case"
                    [routerLink]="[
                      '/members/courses',
                      courseSlug(),
                      'lessons',
                      next.slug,
                    ]"
                    [attr.aria-label]="
                      'Next lesson: ' + next.moduleTitle + ' — ' + next.title
                    "
                    data-testid="next-lesson"
                  >
                    {{ next.title }}
                    <lucide-angular
                      [img]="ArrowRightIcon"
                      class="h-4 w-4"
                      aria-hidden="true"
                    />
                  </a>
                }
              </nav>

              <ptah-lesson-comments
                [comments]="detail.comments"
                [submitting]="postingComment()"
                [errorMessage]="commentError()"
                [busyOn]="answeringOn()"
                [canSetAnswered]="canSetAnswered()"
                (submitted)="postComment($event)"
                (answeredToggled)="toggleAnswered($event)"
              />
            </article>
          }
        }
        @case ('locked') {
          <!--
            R2.4.5 — a page STATE derived from the API's 403, never a CSS
            treatment applied to content this client received anyway.
          -->
          <div class="mx-auto flex w-full max-w-lg flex-col gap-4">
            <ptah-locked-module-notice
              [reason]="lockedReason()"
              [unlocksAt]="lockedUnlocksAt()"
            />
            <a
              class="btn btn-primary btn-sm self-center normal-case"
              [routerLink]="['/members/courses', courseSlug()]"
            >
              Back to the course
            </a>
          </div>
        }
        @case ('error') {
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
            <p class="mt-1 text-sm text-base-content-muted">
              {{ errorMessage() }}
            </p>
            @if (errorRetryable()) {
              <button
                type="button"
                class="btn btn-primary btn-sm mt-4 normal-case"
                (click)="reload()"
              >
                Try again
              </button>
            } @else {
              <a
                class="btn btn-primary btn-sm mt-4 normal-case"
                [routerLink]="['/members/courses', courseSlug()]"
              >
                Back to the course
              </a>
            }
          </div>
        }
        @default {
          <div class="flex flex-col gap-4" aria-busy="true" aria-live="polite">
            <span class="sr-only">Loading this lesson</span>
            <div
              class="aspect-video w-full animate-pulse rounded-xl bg-base-200"
            ></div>
            <div class="h-9 w-2/3 animate-pulse rounded-lg bg-base-200"></div>
            <div class="h-40 animate-pulse rounded-xl bg-base-200"></div>
          </div>
        }
      }
    </div>
  `,
})
export class LessonPage {
  private readonly api = inject(MemberLearningApiService);
  private readonly destroyRef = inject(DestroyRef);

  /** Per-lesson, provided by this component and destroyed with it. */
  protected readonly store = inject(CoursePlayerStore);

  /** The comment thread, so a SUCCESSFUL write can clear its composer. */
  private readonly commentsView = viewChild(LessonComments);

  /**
   * R2.5.3 — only an admin (or the course author) may set the "Answered" mark.
   *
   * ⚠️ READ FROM `MemberSessionStore`, WHICH THE ENTITLEMENT PROBE ALREADY
   * SEEDED. It costs no request: `MemberGuard` resolved it before this route
   * loaded. See {@link LessonComments.canSetAnswered} for why `isAdmin` is the
   * closest predicate a client can evaluate and what it does not cover.
   */
  protected readonly canSetAnswered = inject(MemberSessionStore).isAdmin;

  /**
   * BOTH route parameters, as ONE signal.
   *
   * ⚠️ A SIGNAL OVER THE PARAM MAP, NOT A SNAPSHOT — navigating lesson → lesson
   * reuses this component instance. See the class docblock for why
   * `withComponentInputBinding()` was NOT installed to make these `input()`s.
   */
  protected readonly params = toSignal(
    combineLatest([inject(ActivatedRoute).paramMap]).pipe(
      map(([map_]) => ({
        courseSlug: map_.get('slug') ?? '',
        lessonSlug: map_.get('lessonSlug') ?? '',
      })),
    ),
    { initialValue: { courseSlug: '', lessonSlug: '' } },
  );

  protected readonly courseSlug = computed(() => this.params().courseSlug);

  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly ArrowLeftIcon = ArrowLeft;
  protected readonly ArrowRightIcon = ArrowRight;
  protected readonly CheckIcon = CheckCircle2;
  protected readonly CircleIcon = Circle;

  private readonly _view = signal<LessonView>({ kind: 'loading' });
  protected readonly view = this._view.asReadonly();

  protected readonly postingComment = signal(false);
  protected readonly commentError = signal<string | null>(null);
  protected readonly answeringOn = signal<string | null>(null);

  protected readonly lesson = computed<MemberLessonDetail | null>(() => {
    const view = this._view();
    return view.kind === 'lesson' ? view.lesson : null;
  });

  protected readonly lockedReason = computed<LockReason>(() => {
    const view = this._view();
    return view.kind === 'locked' ? view.reason : 'not_released';
  });

  protected readonly lockedUnlocksAt = computed<string | null>(() => {
    const view = this._view();
    return view.kind === 'locked' ? view.unlocksAt : null;
  });

  protected readonly errorHeading = computed(() => {
    const view = this._view();
    return view.kind === 'error' ? view.heading : '';
  });

  protected readonly errorMessage = computed(() => {
    const view = this._view();
    return view.kind === 'error' ? view.message : '';
  });

  protected readonly errorRetryable = computed(() => {
    const view = this._view();
    return view.kind === 'error' ? view.retryable : false;
  });

  /**
   * `"3:32"` — a DURATION, and `null` when the server has none (ASSUMPTION-8).
   *
   * ⚠️ IT IS NEVER THE MEMBER'S POSITION. That number lives on
   * `store.progress().furthestPositionSeconds` and is not rendered as a
   * runtime.
   */
  protected readonly runtimeLabel = computed<string | null>(() => {
    const duration = this.lesson()?.videoDurationSeconds;
    return duration == null ? null : formatRuntime(duration);
  });

  protected readonly completionButtonText = computed<string>(() =>
    this.store.completed() ? 'Completed' : 'Mark complete',
  );

  /**
   * Which KIND of completion this is — the member has to be able to tell.
   *
   * `'auto'` means the server saw them watch far enough; `'manual'` means they
   * ticked it. Un-ticking an auto-completion is a different act from un-ticking
   * your own claim, and the label is what makes that visible.
   */
  protected readonly completionReason = computed<string>(() => {
    const source = this.store.completionSource();
    if (source === 'auto') return 'Completed — watched to the end';
    if (source === 'manual') return 'Completed — you marked this done';
    return '';
  });

  protected readonly completionActionLabel = computed<string>(() =>
    this.store.completed()
      ? 'Mark this lesson not complete'
      : 'Mark this lesson complete',
  );

  public constructor() {
    // An `effect` rather than a constructor call: this instance is reused
    // across lesson → lesson navigation, so the load follows the parameters.
    effect(() => {
      const { courseSlug, lessonSlug } = this.params();
      if (courseSlug.length === 0 || lessonSlug.length === 0) return;
      untracked(() => this.load(courseSlug, lessonSlug));
    });
  }

  protected reload(): void {
    const { courseSlug, lessonSlug } = this.params();
    if (courseSlug && lessonSlug) this.load(courseSlug, lessonSlug);
  }

  protected toggleCompletion(): void {
    this.store.setCompletion(!this.store.completed());
  }

  /**
   * Posts a comment, then RE-READS the lesson.
   *
   * ⚠️ THE RESPONSE IS NOT SPLICED IN. See the class docblock: the server may
   * have re-pointed `parentId`, and the write response's `authorName` is
   * currently `null` even for a live comment.
   */
  protected postComment(submission: LessonCommentSubmission): void {
    const detail = this.lesson();
    if (!detail) return;

    this.postingComment.set(true);
    this.commentError.set(null);

    this.api
      .createComment({
        lessonId: detail.id,
        bodyMarkdown: submission.bodyMarkdown,
        parentId: submission.parentId,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.postingComment.set(false);
          // ⚠️ CLEARED ONLY HERE, after the server accepted it. On failure the
          // text stays in the composer, which is the only place it exists.
          this.commentsView()?.resetComposers();
          const { courseSlug, lessonSlug } = this.params();
          this.load(courseSlug, lessonSlug, { keepPlayer: true });
        },
        error: (error: unknown) => {
          this.postingComment.set(false);
          this.commentError.set(commentWriteError(error));
        },
      });
  }

  protected toggleAnswered(comment: MemberLessonComment): void {
    this.answeringOn.set(comment.id);

    this.api
      .setCommentAnswered(comment.id, !comment.answered)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.answeringOn.set(null);
          const { courseSlug, lessonSlug } = this.params();
          this.load(courseSlug, lessonSlug, { keepPlayer: true });
        },
        error: () => this.answeringOn.set(null),
      });
  }

  /**
   * @param options.keepPlayer a re-read triggered by a comment write must not
   *   reset the store, or a member who asks a question mid-video loses the
   *   position they were at.
   */
  private load(
    courseSlug: string,
    lessonSlug: string,
    options: { keepPlayer?: boolean } = {},
  ): void {
    if (options.keepPlayer !== true) {
      this._view.set({ kind: 'loading' });
    }
    this.commentError.set(null);

    this.api
      .getLesson(courseSlug, lessonSlug)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          if (result.locked) {
            this._view.set({
              kind: 'locked',
              reason: result.reason,
              unlocksAt: result.unlocksAt,
            });
            return;
          }

          this._view.set({ kind: 'lesson', lesson: result.lesson });
          if (options.keepPlayer !== true) {
            this.store.bind(courseSlug, lessonSlug, result.lesson.progress);
          }
        },
        error: (error: unknown) => {
          const status =
            error instanceof HttpErrorResponse ? error.status : null;

          if (status === 404) {
            // ⚠️ NONE OF "not allowed" / "forbidden" / "permission" (R1.1.3).
            this._view.set({
              kind: 'error',
              heading: 'This lesson is not available',
              message:
                'It may have been withdrawn, or it is part of a course your membership does not include.',
              retryable: false,
            });
            return;
          }

          this._view.set({
            kind: 'error',
            heading: 'We could not load this lesson',
            message: describeLoadFailure(
              error,
              'Something went wrong loading this lesson.',
            ),
            retryable: true,
          });
        },
      });
  }
}

/**
 * The composer's error line.
 *
 * ⚠️ IT MATCHES ON THE MACHINE `reason`, NOT ON THE SENTENCE. `403
 * { reason: 'not_released' }` is a stable wire value; the server's message text
 * is not, and matching it would break the first time someone improved the copy.
 */
function commentWriteError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as { reason?: unknown } | null | undefined;
    if (error.status === 403 && typeof body?.reason === 'string') {
      return 'This module closed while you were writing. Your question was not posted.';
    }
    if (error.status === 404) {
      return 'This lesson is no longer available.';
    }
  }
  return 'We could not post your question. Try again in a moment.';
}
