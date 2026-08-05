import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  AlertTriangle,
  GraduationCap,
  LucideAngularModule,
} from 'lucide-angular';

import type { MemberCourseSummary } from '@ptah-contracts/community';
import { EmptyState } from '@ptah-web/panel-ui';

import { MemberLearningApiService } from '../services/member-learning-api.service';
import { ProgressMeter } from './components/progress-meter';

/**
 * CoursesPage — `/members/courses` (R2.1.1, R2.1.4, R2.3.5, R6.3, R9.7).
 *
 * ⚠️ 🔴 THE ORDER IS THE SERVER'S AND NOTHING IS RE-SORTED. R2.1.4's tie-break
 * is `(sortOrder, createdAt, id)`, computed in SQL by Task 9.8's
 * `DETERMINISTIC_ORDER_BY`. Batch 7's rule applies unchanged: a client-side sort
 * reorders only the rows this page happens to hold, which looks like working
 * software right up to the moment there is a second page.
 *
 * ⚠️ 🔴 A FAILURE RENDERS A RETRYABLE ERROR, NEVER AN EMPTY STATE (R6.4).
 * Batch 7's rule, and it is the one most worth repeating: *"'No threads yet'
 * after a 500 tells a member the community is empty. It is not; we failed."*
 * Here it would tell a paying member the curriculum does not exist. The
 * previous rows are CLEARED on failure too, so a retry that fails cannot leave
 * stale content sitting under an error banner (B7.1's My Threads rule).
 *
 * ⚠️ 🔴 `ProgressMeter` RECEIVES THE TWO COUNTS, NOT `percent` (RISK-O). The
 * wire carries `percent` — derived SERVER-SIDE from lesson counts so every
 * meter in the product rounds identically — and the meter recomputes the same
 * figure from the same two integers rather than accepting a number that could
 * have been derived from seconds somewhere else.
 *
 * ⚠️ NFR-U6 — PAGINATION WAS CONSIDERED AND IS NOT NEEDED, AND THAT IS STATED
 * RATHER THAN LEFT OPEN. `GET /v1/members/courses` is UNPAGED server-side:
 * `MemberCoursesController` declares no `@Query()` at all, because a cohort
 * curriculum is tens of courses and never thousands. There is no page state
 * here to get wrong, and adding one would be inventing a parameter the endpoint
 * would reject with a `400`.
 *
 * ⚠️ NO MARKDOWN RENDERER LIVES ON THIS PAGE (NFR-S2, PRE-4).
 * `MemberCourseSummary.description` is a plain-text column rendered as an
 * escaped text node; there is nothing here to render through the chokepoint and
 * nothing here may acquire a renderer.
 *
 * NFR-U2: `base-100`/`base-200` surfaces, `border-hairline` boundaries,
 * `bg-surface-high` hover, `base-content/60` muted text. No `border-base-300` —
 * `base-300` is a FILL. The Task 4.7 lint rule polices `libs/web/members/**`.
 */
@Component({
  selector: 'ptah-courses-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, LucideAngularModule, EmptyState, ProgressMeter],
  template: `
    <div class="flex flex-col gap-6">
      <header class="flex flex-col gap-1">
        <h1
          class="text-2xl font-bold tracking-tight text-base-content sm:text-3xl"
        >
          Courses
        </h1>
        <p class="text-sm text-base-content/60">
          The cohort curriculum, in the order it is meant to be taken.
        </p>
      </header>

      <section aria-label="Courses">
        @if (errorMessage(); as message) {
          <!--
            R6.4 — a failure is NOT an empty state. Telling a paying member the
            curriculum has not been published yet, after a 500, says the product
            does not exist.
          -->
          <div
            class="rounded-xl border border-hairline bg-base-200 p-6 text-center"
            role="alert"
          >
            <lucide-angular
              [img]="AlertTriangleIcon"
              class="mx-auto h-8 w-8 text-warning"
              aria-hidden="true"
            />
            <p class="mt-3 text-sm text-base-content">{{ message }}</p>
            <button
              type="button"
              class="btn btn-primary btn-sm mt-4 normal-case"
              (click)="reload()"
            >
              Try again
            </button>
          </div>
        } @else if (loading()) {
          <div class="flex flex-col gap-3" aria-busy="true" aria-live="polite">
            <span class="sr-only">Loading your courses</span>
            @for (row of skeletonRows; track row) {
              <div class="h-28 animate-pulse rounded-xl bg-base-200"></div>
            }
          </div>
        } @else if (courses().length === 0) {
          <div class="rounded-xl border border-hairline bg-base-200">
            <ptah-empty-state
              [icon]="GraduationCapIcon"
              message="The cohort curriculum has not been published yet."
              hint="Courses appear here as soon as they are released. Nothing is missing from your account."
            />
          </div>
        } @else {
          <ul class="grid gap-4 sm:grid-cols-2">
            @for (course of courses(); track course.id) {
              <li>
                <a
                  class="flex h-full flex-col gap-3 rounded-xl border border-hairline bg-base-200 p-4 transition-colors hover:bg-surface-high"
                  [routerLink]="['/members/courses', course.slug]"
                  [attr.data-course-slug]="course.slug"
                >
                  @if (course.coverImageUrl; as cover) {
                    <img
                      class="aspect-video w-full rounded-lg object-cover"
                      [src]="cover"
                      alt=""
                      loading="lazy"
                    />
                  }
                  <h2 class="text-base font-semibold text-base-content">
                    {{ course.title }}
                  </h2>
                  <p class="flex-1 text-sm text-base-content/60">
                    {{ course.description }}
                  </p>
                  <!--
                    COUNTS in, percentage computed once. See RISK-O.
                  -->
                  <ptah-progress-meter
                    [completed]="course.completedLessons"
                    [total]="course.totalLessons"
                    [label]="course.title"
                  />
                </a>
              </li>
            }
          </ul>
        }
      </section>
    </div>
  `,
})
export class CoursesPage {
  private readonly api = inject(MemberLearningApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly GraduationCapIcon = GraduationCap;
  protected readonly skeletonRows = [0, 1];

  private readonly _courses = signal<readonly MemberCourseSummary[] | null>(
    null,
  );

  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);

  /** In the ORDER THE SERVER RETURNED THEM. No `sort`, no `slice`. */
  protected readonly courses = computed<readonly MemberCourseSummary[]>(
    () => this._courses() ?? [],
  );

  public constructor() {
    this.load();
  }

  protected reload(): void {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.api
      .listCourses()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (courses) => {
          this._courses.set(courses);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          // ⚠️ CLEARED, so a failed retry cannot leave stale rows under the
          // error banner.
          this._courses.set(null);
          this.errorMessage.set(
            describeLoadFailure(error, 'We could not load your courses.'),
          );
        },
      });
  }
}

/**
 * A member-facing sentence for a failure this page cannot act on.
 *
 * ⚠️ `HttpErrorResponse` IS NOT AN `Error` — it `implements` the interface but
 * does not extend the class — so an HTTP failure takes the fallback and its raw
 * "Http failure response for /api/…: 500" never reaches a member. A
 * boundary-parse failure from `validate()` DOES pass the check, and its message
 * names the endpoint and the offending field, which is the one case where the
 * detail is worth showing. The same asymmetry `FeedPage`, `HubPage` and
 * `MyThreadsPage` rely on.
 */
export function describeLoadFailure(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
