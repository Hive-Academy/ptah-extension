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
  LibraryBig,
  LucideAngularModule,
  PlayCircle,
} from 'lucide-angular';

import type { MemberCourseDetail } from '@ptah-contracts/community';
import { EmptyState } from '@ptah-web/panel-ui';

import { MemberLearningApiService } from '../services/member-learning-api.service';
import { ModuleOutline } from './components/module-outline';
import { ProgressMeter } from './components/progress-meter';
import { describeLoadFailure } from './courses-page';

/**
 * CoursePage — `/members/courses/:slug` (R2.1.3, R2.1.4, R2.3.5, R2.3.6, R6.3).
 *
 * ⚠️ 🔴 THE RESUME TARGET COMES FROM THE SERVER (`resumeLesson`, R2.3.6). It is
 * NOT re-derived by scanning the outline in the browser. The hub's "continue
 * learning" card is the same number computed by the same code path — Batch 6C
 * refused a second injection for exactly this reason — and a second derivation
 * here is how a card and a page start disagreeing about where a member left
 * off.
 *
 * ⚠️ 🔴 A DRAFT OR INVISIBLE COURSE IS A `404`, AND ITS COPY CONTAINS NONE OF
 * "not allowed" / "forbidden" / "permission" (R1.1.3, R2.1.2). `404` covers
 * ABSENT and INVISIBLE indistinguishably; saying "you are not allowed to see
 * this" would confirm it exists and undo the where-clause's work. A spec
 * asserts that absence by name, exactly as `thread-page.spec.ts` does.
 *
 * ⚠️ A LOCKED MODULE IS A DIFFERENT ANSWER AND IS NOT AN ERROR HERE AT ALL.
 * `MemberModuleSummary.locked` arrives inside a perfectly successful `200`, so
 * the outline renders the padlock and the unlock condition WITHOUT a request
 * that is going to fail. The `403` happens when a member opens the lesson.
 *
 * ⚠️ A FAILED LOAD RENDERS A RETRYABLE ERROR, NEVER AN EMPTY STATE (R6.4) — and
 * a course with no modules renders an `EmptyState` INSIDE the detail rather
 * than a blank page (R1.7.3, R6.3). The two are different signals and must not
 * collapse.
 *
 * ⚠️ THE `:slug` PARAMETER IS READ AS A SIGNAL, NOT A SNAPSHOT. See
 * {@link CoursePage.slug} — this component instance is reused across
 * navigations.
 *
 * ⚠️ NO MARKDOWN RENDERER (NFR-S2). `description` is a plain-text column.
 * NFR-U6: an 8-module course is ~8 rows; the outline needs no pagination and
 * that is stated rather than left open.
 */
@Component({
  selector: 'ptah-course-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    LucideAngularModule,
    EmptyState,
    ModuleOutline,
    ProgressMeter,
  ],
  template: `
    <div class="flex flex-col gap-6">
      <a
        class="inline-flex w-fit items-center gap-1 text-sm text-base-content-muted transition-colors hover:text-base-content"
        routerLink="/members/courses"
      >
        <lucide-angular
          [img]="ArrowLeftIcon"
          class="h-4 w-4"
          aria-hidden="true"
        />
        All courses
      </a>

      @if (course(); as detail) {
        <header class="flex flex-col gap-4">
          <div class="flex flex-col gap-1">
            <h1
              class="text-2xl font-bold tracking-tight text-base-content sm:text-3xl"
            >
              {{ detail.title }}
            </h1>
            <p class="text-sm text-base-content-muted">
              {{ detail.description }}
            </p>
          </div>

          <div
            class="flex flex-col gap-4 rounded-xl border border-hairline bg-base-200 p-4 sm:flex-row sm:items-end sm:justify-between"
          >
            <div class="flex-1">
              <!-- COUNTS in, one derivation (RISK-O). -->
              <ptah-progress-meter
                [completed]="detail.completedLessons"
                [total]="detail.totalLessons"
                [label]="detail.title"
              />
            </div>

            @if (detail.resumeLesson; as resume) {
              <!--
                The SERVER's first-incomplete lesson. Never re-derived here.
              -->
              <a
                class="btn btn-primary btn-sm gap-1 normal-case"
                [routerLink]="[
                  '/members/courses',
                  detail.slug,
                  'lessons',
                  resume.slug,
                ]"
                [attr.aria-label]="resumeLabel()"
                data-testid="resume-link"
              >
                <lucide-angular
                  [img]="PlayIcon"
                  class="h-4 w-4"
                  aria-hidden="true"
                />
                {{ resumeButtonText() }}
              </a>
            } @else if (detail.totalLessons > 0) {
              <p
                class="text-sm font-semibold text-primary"
                data-testid="course-complete"
              >
                You have completed this course.
              </p>
            }
          </div>
        </header>

        @if (detail.modules.length === 0) {
          <div class="rounded-xl border border-hairline bg-base-200">
            <ptah-empty-state
              [icon]="LibraryIcon"
              message="This course has no lessons yet."
              hint="The modules are being written. Nothing is missing from your account."
            />
          </div>
        } @else {
          <ptah-module-outline
            [courseSlug]="detail.slug"
            [modules]="detail.modules"
          />
        }
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
          @if (retryable()) {
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
              routerLink="/members/courses"
            >
              Back to courses
            </a>
          }
        </div>
      } @else {
        <div class="flex flex-col gap-4" aria-busy="true" aria-live="polite">
          <span class="sr-only">Loading this course</span>
          <div class="h-9 w-2/3 animate-pulse rounded-lg bg-base-200"></div>
          <div class="h-24 animate-pulse rounded-xl bg-base-200"></div>
          <div class="h-40 animate-pulse rounded-xl bg-base-200"></div>
        </div>
      }
    </div>
  `,
})
export class CoursePage {
  private readonly api = inject(MemberLearningApiService);
  private readonly destroyRef = inject(DestroyRef);

  /**
   * The `:slug` route parameter, AS A SIGNAL.
   *
   * ⚠️ READ FROM `ActivatedRoute`, NOT DECLARED AS AN `input()`. A route input
   * needs `withComponentInputBinding()` on `provideRouter`, and
   * `apps/ptah-landing-page/src/app/app.config.ts` does not install it (B7 F-4,
   * re-confirmed B7.1 F-13, and deliberately not installed by Batch 10 either —
   * see `lesson-page.ts` for the decision and the consumer count).
   *
   * ⚠️ A SIGNAL, NOT A SNAPSHOT. Navigating course → course reuses this
   * component instance and a snapshot read in the constructor would leave the
   * first course on screen forever.
   */
  protected readonly slug = toSignal(
    inject(ActivatedRoute).paramMap.pipe(
      map((params) => params.get('slug') ?? ''),
    ),
    { initialValue: '' },
  );

  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly ArrowLeftIcon = ArrowLeft;
  protected readonly LibraryIcon = LibraryBig;
  protected readonly PlayIcon = PlayCircle;

  private readonly _course = signal<MemberCourseDetail | null>(null);
  protected readonly course = this._course.asReadonly();

  protected readonly errorMessage = signal<string | null>(null);
  protected readonly errorHeading = signal('We could not load this course');

  /**
   * A `404` is not retryable — the course is absent or invisible and pressing
   * "Try again" would only repeat the same answer.
   */
  protected readonly retryable = signal(true);

  /** "Start" on an untouched course, "Resume" once something is complete. */
  protected readonly resumeButtonText = computed<string>(() =>
    (this._course()?.completedLessons ?? 0) > 0 ? 'Resume' : 'Start course',
  );

  protected readonly resumeLabel = computed<string>(() => {
    const resume = this._course()?.resumeLesson;
    if (!resume) return 'Resume';
    return `${this.resumeButtonText()}: ${resume.moduleTitle} — ${resume.title}`;
  });

  public constructor() {
    // An `effect` rather than a one-shot constructor call: navigating from one
    // course to another REUSES this instance, so the load follows the parameter
    // rather than the lifecycle. `untracked` keeps the effect from taking a
    // dependency on its own writes.
    effect(() => {
      const slug = this.slug();
      if (slug.length === 0) return;
      untracked(() => this.load(slug));
    });
  }

  protected reload(): void {
    this.load(this.slug());
  }

  private load(slug: string): void {
    this.errorMessage.set(null);

    this.api
      .getCourse(slug)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => this._course.set(detail),
        error: (error: unknown) => {
          this._course.set(null);
          const status =
            error instanceof HttpErrorResponse ? error.status : null;

          if (status === 404) {
            // ⚠️ ABSENT AND INVISIBLE ARE THE SAME ANSWER (R1.1.3, R2.1.2).
            // None of "not allowed", "forbidden" or "permission" appears here.
            this.retryable.set(false);
            this.errorHeading.set('This course is not available');
            this.errorMessage.set(
              'It may have been withdrawn, or it is part of a programme your membership does not include.',
            );
            return;
          }

          this.retryable.set(true);
          this.errorHeading.set('We could not load this course');
          this.errorMessage.set(
            describeLoadFailure(
              error,
              'Something went wrong loading this course.',
            ),
          );
        },
      });
  }
}
