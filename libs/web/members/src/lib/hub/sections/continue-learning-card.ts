import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { GraduationCap, Lock, LucideAngularModule } from 'lucide-angular';

import type { ContinueLearning, HubSection } from '@ptah-contracts/community';

import { HubSectionCard } from './hub-section-card';

/**
 * ContinueLearningCard — "where you left off" (R6.1).
 *
 * ONE course, not a list: a member working the cohort curriculum has exactly
 * one current course, and the hub answers "what do I resume". The full list is
 * `/members/courses`.
 *
 * Three distinct finished-ness states, because collapsing them misinforms:
 *   - `nextLesson` present, `locked: false` — resume, with a live link.
 *   - `nextLesson` present, `locked: true`  — the next module has not opened
 *     yet (`releaseAt`, or sequential gating). Show the reason, not a link that
 *     bounces.
 *   - `nextLesson === null`                 — every visible lesson is done.
 *     A completion state, NOT a dead "Resume" button.
 */
@Component({
  selector: 'ptah-continue-learning-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HubSectionCard, RouterLink, LucideAngularModule],
  template: `
    <ptah-hub-section-card
      title="Continue learning"
      [status]="section().status"
      [emptyIcon]="GraduationCapIcon"
      emptyMessage="No course in progress."
      emptyHint="The cohort curriculum is published in phase 3 — it will show up here the moment it is."
      unavailableMessage="Your course progress could not be loaded."
    >
      @if (course(); as learning) {
        <h3 class="text-lg font-semibold text-base-content">
          {{ learning.courseTitle }}
        </h3>

        @if (learning.nextLesson; as lesson) {
          <p class="mt-1 text-sm text-base-content/60">
            {{ lesson.moduleTitle }} · {{ lesson.title }}
          </p>
        } @else {
          <p class="mt-1 text-sm text-base-content/60">
            You have completed every lesson in this course.
          </p>
        }

        <!--
          Progress meter. A "border-hairline" track + "primary" fill, per
          panel-theme-spec.md §2 — the track is a stroke, so it must not use
          base-300 (a fill token) or it disappears against the card.
          "percent" is sent by the server so every meter in the product rounds
          identically, rather than each client re-deriving it.

          NOTE: no backticks in this comment. It sits inside the component's
          template literal, so a backtick here terminates the template and the
          file stops parsing.
        -->
        <div class="mt-4">
          <div
            class="h-2 w-full overflow-hidden rounded-full border border-hairline bg-base-100"
            role="progressbar"
            [attr.aria-valuenow]="learning.percent"
            aria-valuemin="0"
            aria-valuemax="100"
            [attr.aria-label]="'Course progress for ' + learning.courseTitle"
          >
            <div
              class="h-full rounded-full bg-primary transition-[width]"
              [style.width.%]="learning.percent"
            ></div>
          </div>

          <p
            class="mt-2 flex items-center justify-between font-mono text-xs text-base-content/60"
          >
            <span>{{ learning.percent }}% complete</span>
            <span>
              {{ learning.completedLessons }} / {{ learning.totalLessons }}
              lessons
            </span>
          </p>
        </div>

        @if (learning.locked) {
          <p
            class="mt-4 flex items-start gap-2 rounded-lg border border-hairline bg-base-100 p-3 text-sm text-base-content/60"
          >
            <lucide-angular
              [img]="LockIcon"
              class="mt-0.5 h-4 w-4 shrink-0"
              aria-hidden="true"
            />
            The next module has not opened yet.
          </p>
        } @else if (learning.nextLesson; as lesson) {
          <a
            [routerLink]="[
              '/members/courses',
              learning.courseSlug,
              'lessons',
              lesson.slug,
            ]"
            class="btn btn-primary btn-sm mt-4"
          >
            Resume lesson
          </a>
        }
      }
    </ptah-hub-section-card>
  `,
})
export class ContinueLearningCard {
  public readonly section =
    input.required<HubSection<ContinueLearning | null>>();

  protected readonly GraduationCapIcon = GraduationCap;
  protected readonly LockIcon = Lock;

  protected readonly course = computed<ContinueLearning | null>(() => {
    const section = this.section();
    return section.status === 'ok' ? section.data : null;
  });
}
