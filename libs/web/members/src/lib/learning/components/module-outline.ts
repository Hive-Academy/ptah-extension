import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  CheckCircle2,
  Circle,
  Lock,
  LucideAngularModule,
  PlayCircle,
} from 'lucide-angular';

import type {
  MemberLessonSummary,
  MemberModuleSummary,
} from '@ptah-contracts/community';

import { LockedModuleNotice } from './locked-module-notice';

/**
 * ModuleOutline — the course's modules and lessons, in server order (R2.1.4,
 * R2.4.4, R9.7).
 *
 * ⚠️ PRIVATE TO `libs/web/members` (§5.3). A module outline is a member concept;
 * there is no admin equivalent in this task's scope and none is specified
 * (RK-1). Do not promote it.
 *
 * ⚠️ 🔴 NOTHING IS RE-SORTED HERE. The server computes R2.1.4's
 * `(sortOrder, createdAt, id)` tie-break in SQL and this component renders the
 * arrays as they arrived. A client-side sort looks like working software and
 * reorders only the rows this component happens to hold.
 *
 * ⚠️ 🔴 A LOCKED MODULE RENDERS ITS TITLE AND ITS LESSON TITLES AND NOTHING
 * ELSE — AND IT CANNOT DO OTHERWISE. R2.4.4 deliberately discloses what is
 * coming, and the redaction is STRUCTURAL: `MemberLessonSummary` carries no
 * `bodyMarkdown`, no `youtubeVideoId` and no comment count, so there is no
 * field here that could leak one (Task 9.7's argument — a mapper that must
 * REMEMBER to delete three fields will one day forget one). The spec asserts the
 * rendered DOM of a locked module contains no `<ptah-markdown-block>` and no
 * play affordance.
 *
 * ⚠️ A LOCKED MODULE'S LESSONS ARE NOT LINKS. They are still listed — that is
 * the point of R2.4.4 — but linking them would invite a click that lands on a
 * `403`. The lesson page's `next` link is the one place a locked neighbour IS
 * rendered as a link (R2.4.4 again, from the other side): there the member has
 * asked what comes next, and the `403` screen is the honest answer.
 *
 * ⚠️ THE LOCK IS A SERVER FACT (`MemberModuleSummary.locked`), never a clock
 * comparison in the browser — see {@link LockedModuleNotice}.
 *
 * ⚠️ NOT COLOUR-ALONE. Completion is a filled check ICON plus a `<span
 * class="sr-only">`; a locked module is a padlock plus the notice's sentence.
 *
 * NFR-U3: every muted string is `text-base-content-muted` — the per-theme
 * token, never an alpha tier.
 */
@Component({
  selector: 'ptah-module-outline',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, LucideAngularModule, LockedModuleNotice],
  template: `
    <ol class="flex flex-col gap-4" aria-label="Course outline">
      @for (module of rows(); track module.summary.id; let index = $index) {
        <li
          class="rounded-xl border border-hairline bg-base-200 p-4"
          [attr.data-module-slug]="module.summary.slug"
          [attr.data-locked]="module.summary.locked"
        >
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h3
              class="flex items-center gap-2 text-base font-semibold text-base-content"
            >
              @if (module.summary.locked) {
                <lucide-angular
                  [img]="LockIcon"
                  class="h-4 w-4 shrink-0 text-base-content-muted"
                  aria-hidden="true"
                />
                <span class="sr-only">Locked module.</span>
              }
              <span class="font-mono text-xs uppercase text-base-content-muted">
                Module {{ index + 1 }}
              </span>
              {{ module.summary.title }}
            </h3>
            <p class="font-mono text-xs text-base-content-muted">
              {{ module.completedLabel }}
            </p>
          </div>

          @if (module.summary.description; as description) {
            <p class="mt-1 text-sm text-base-content-muted">
              {{ description }}
            </p>
          }

          @if (module.summary.locked && module.summary.lockReason; as reason) {
            <div class="mt-3">
              <ptah-locked-module-notice
                [reason]="reason"
                [unlocksAt]="module.summary.unlocksAt"
                [blockingModuleTitle]="module.blockingModuleTitle"
              />
            </div>
          }

          <ul class="mt-3 flex flex-col gap-1">
            @for (lesson of module.summary.lessons; track lesson.id) {
              <li
                [attr.data-lesson-slug]="lesson.slug"
                [attr.data-completed]="lesson.completed"
              >
                @if (module.summary.locked) {
                  <!--
                    R2.4.4 — the TITLE is visible on purpose, and it is not a
                    link: clicking it could only land on the 403 the outline
                    has already explained.
                  -->
                  <span
                    class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-base-content-muted"
                  >
                    <lucide-angular
                      [img]="LockIcon"
                      class="h-4 w-4 shrink-0"
                      aria-hidden="true"
                    />
                    {{ lesson.title }}
                  </span>
                } @else {
                  <a
                    class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-base-content transition-colors hover:bg-surface-high"
                    [routerLink]="[
                      '/members/courses',
                      courseSlug(),
                      'lessons',
                      lesson.slug,
                    ]"
                    [attr.aria-current]="
                      lesson.slug === currentLessonSlug() ? 'page' : null
                    "
                  >
                    @if (lesson.completed) {
                      <lucide-angular
                        [img]="CheckIcon"
                        class="h-4 w-4 shrink-0 text-primary"
                        aria-hidden="true"
                      />
                      <span class="sr-only">Completed.</span>
                    } @else {
                      <lucide-angular
                        [img]="CircleIcon"
                        class="h-4 w-4 shrink-0 text-base-content-muted"
                        aria-hidden="true"
                      />
                    }
                    <span class="flex-1">{{ lesson.title }}</span>
                    @if (lesson.durationSeconds !== null) {
                      <!--
                        A DURATION, shown only when the server persisted one. A
                        missing duration means manual-completion-only
                        (ASSUMPTION-8) and a 0:00 chip there would be a lie.
                        (No backticks in an inline-template comment — B7 F-8.)
                      -->
                      <span class="font-mono text-xs text-base-content-muted">
                        {{ runtime(lesson) }}
                      </span>
                    }
                    @if (lesson.slug === currentLessonSlug()) {
                      <lucide-angular
                        [img]="PlayIcon"
                        class="h-4 w-4 shrink-0 text-primary"
                        aria-hidden="true"
                      />
                      <span class="sr-only">Now playing.</span>
                    }
                  </a>
                }
              </li>
            }
          </ul>
        </li>
      } @empty {
        <li class="text-sm text-base-content-muted">
          This course has no modules yet.
        </li>
      }
    </ol>
  `,
})
export class ModuleOutline {
  /** The owning course's slug — the first segment of every lesson link. */
  public readonly courseSlug = input.required<string>();

  /** Modules IN SERVER ORDER. Rendered as given. */
  public readonly modules = input.required<readonly MemberModuleSummary[]>();

  /** Highlights the lesson currently open, when this outline sits beside one. */
  public readonly currentLessonSlug = input<string | null>(null);

  protected readonly CheckIcon = CheckCircle2;
  protected readonly CircleIcon = Circle;
  protected readonly LockIcon = Lock;
  protected readonly PlayIcon = PlayCircle;

  /**
   * One row per module, with the two derived strings a template cannot express
   * cheaply.
   *
   * ⚠️ `blockingModuleTitle` IS THE PRECEDING MODULE IN THE RENDERED ARRAY, and
   * that is a PRESENTATION detail rather than a re-derivation of the lock. The
   * server already decided `lockReason === 'previous_module_incomplete'`; this
   * only supplies the name to put in the sentence. It is `null` for the first
   * module, in which case the notice falls back to the generic wording.
   */
  protected readonly rows = computed(() => {
    const modules = this.modules();
    return modules.map((summary, index) => ({
      summary,
      blockingModuleTitle: index > 0 ? modules[index - 1].title : null,
      completedLabel: completedLabel(summary),
    }));
  });

  /** `"3:32"` from a DURATION in seconds. Never called with a position. */
  protected runtime(lesson: MemberLessonSummary): string {
    return formatRuntime(lesson.durationSeconds ?? 0);
  }
}

/** `"2 of 3"` — a count of lessons, never a percentage. */
function completedLabel(module: MemberModuleSummary): string {
  const done = module.lessons.filter((lesson) => lesson.completed).length;
  return `${done} of ${module.lessons.length}`;
}

/**
 * Formats a DURATION in seconds as `m:ss` (or `h:mm:ss`).
 *
 * ⚠️ IT TAKES A DURATION AND IS NEVER HANDED A POSITION (RISK-O). The only
 * caller reads `MemberLessonSummary.durationSeconds`; the member's watch
 * position lives on `MemberLessonProgress` and never reaches the outline.
 */
export function formatRuntime(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}
