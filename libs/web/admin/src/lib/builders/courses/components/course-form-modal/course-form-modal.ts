import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import { VISIBILITIES } from '@ptah-contracts/community';

import {
  AdminApiService,
  type MemberGroup,
} from '../../../../services/admin-api.service';
import {
  AdminLearningApiService,
  COHORT_KEY_REGEX,
  type AdminCourse,
} from '../../../../services/admin-learning-api.service';

/**
 * CourseFormModal — daisyUI dialog for creating or editing a course.
 *
 * Dual mode driven by the `course` input: `null` → create
 * (`POST /api/v1/admin/courses`), non-null → edit (`PATCH .../courses/:id`).
 *
 * 🔴 THERE IS NO PUBLISH CONTROL ON THIS FORM AND THERE MUST NOT BE. A course
 * is created as a draft whatever the client sends, `CreateCourseDto` has no
 * `published` field, and `forbidNonWhitelisted` turns an attempt to set one
 * into a `400`. Publishing is `PUT :id/published` — a separate request with its
 * own audit action, offered from the list. Folding it in here would let an
 * admin make something member-visible in the same keystroke that creates it,
 * removing the step where they check their work.
 *
 * ⚠️ AND NO SLUG FIELD, IN EITHER MODE. The server derives the slug from the
 * title and resolves collisions with a `-2` suffix; on edit the slug is the
 * course's public URL and there is no redirect table, so `UpdateCourseDto` has
 * no `slug` key at all. The form shows the allocated slug read-only on edit so
 * an admin can see what a link will look like.
 *
 * ⚠️ `cohortKeys` IS MEANINGFUL ONLY WHEN `visibility` IS `'cohort'`. The form
 * clears the selection when the visibility moves away from it rather than
 * leaving a stale array on the record — a non-empty list on a `'member'` course
 * gates nothing and later reads as an access rule that was never in force.
 *
 * Cross-service by necessity, exactly as `PackFormModal` is: the cohort options
 * come from `AdminApiService.listGroups()` while the course is written through
 * `AdminLearningApiService`. The group list is fetched on first open and cached
 * for the modal's lifetime.
 */
@Component({
  selector: 'ptah-admin-course-form-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './course-form-modal.html',
})
export class CourseFormModal {
  private readonly adminApi = inject(AdminApiService);
  private readonly learningApi = inject(AdminLearningApiService);

  /** Show/hide the modal. Parent owns the signal. */
  public readonly open = input<boolean>(false);

  /** `null` = create mode. Non-null = edit mode, pre-fills the form. */
  public readonly course = input<AdminCourse | null>(null);

  /** The user asked to close without saving. */
  public readonly closeModal = output<void>();

  /** A create or update succeeded; carries the server's projection. */
  public readonly saved = output<AdminCourse>();

  protected readonly visibilities = VISIBILITIES;
  protected readonly cohortKeyRegex = COHORT_KEY_REGEX;

  protected readonly title = signal<string>('');
  protected readonly description = signal<string>('');
  protected readonly coverImageUrl = signal<string>('');
  protected readonly visibility =
    signal<(typeof VISIBILITIES)[number]>('member');
  protected readonly cohortKeys = signal<readonly string[]>([]);
  protected readonly sequential = signal<boolean>(false);

  protected readonly saving = signal<boolean>(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly groups = signal<readonly MemberGroup[]>([]);
  protected readonly groupsLoading = signal<boolean>(false);
  protected readonly groupsError = signal<string | null>(null);
  private groupsRequested = false;

  protected readonly isEdit = computed<boolean>(() => this.course() !== null);

  /** Cohort keys only matter for a `'cohort'` course — the picker hides otherwise. */
  protected readonly cohortScoped = computed<boolean>(
    () => this.visibility() === 'cohort',
  );

  protected readonly canSubmit = computed<boolean>(() => {
    if (this.saving()) return false;
    if (this.title().trim().length < 3) return false;
    if (this.description().trim().length === 0) return false;
    // A cohort course with no cohort is visible to nobody. The server accepts
    // it; the form does not, because it is never what an admin meant.
    if (this.cohortScoped() && this.cohortKeys().length === 0) return false;
    return true;
  });

  public constructor() {
    effect(() => {
      if (!this.open()) return;
      const c = this.course();
      this.title.set(c?.title ?? '');
      this.description.set(c?.description ?? '');
      this.coverImageUrl.set(c?.coverImageUrl ?? '');
      this.visibility.set(c?.visibility ?? 'member');
      this.cohortKeys.set(c?.cohortKeys ?? []);
      this.sequential.set(c?.sequential ?? false);
      this.saving.set(false);
      this.errorMessage.set(null);
      this.loadGroupsOnce();
    });
  }

  /**
   * Fetches the cohort list on first open and caches it. Failure is non-fatal:
   * a `'member'` course needs no cohort at all, so the form stays usable and a
   * retry is allowed on the next open.
   */
  private loadGroupsOnce(): void {
    if (this.groupsRequested) return;
    this.groupsRequested = true;
    this.groupsLoading.set(true);
    this.groupsError.set(null);
    this.adminApi.listGroups().subscribe({
      next: (groups) => {
        this.groups.set(groups);
        this.groupsLoading.set(false);
      },
      error: () => {
        this.groupsLoading.set(false);
        this.groupsRequested = false;
        this.groupsError.set(
          'Could not load cohorts. Choose Member or Staff visibility, or try again.',
        );
      },
    });
  }

  protected onTitleInput(event: Event): void {
    this.title.set((event.target as HTMLInputElement | null)?.value ?? '');
  }

  protected onDescriptionInput(event: Event): void {
    this.description.set(
      (event.target as HTMLTextAreaElement | null)?.value ?? '',
    );
  }

  protected onCoverImageUrlInput(event: Event): void {
    this.coverImageUrl.set(
      (event.target as HTMLInputElement | null)?.value ?? '',
    );
  }

  protected onVisibilityChange(event: Event): void {
    const next = (event.target as HTMLSelectElement | null)?.value ?? 'member';
    const parsed = VISIBILITIES.find((v) => v === next) ?? 'member';
    this.visibility.set(parsed);
    // Drop the selection rather than carry a list that now gates nothing.
    if (parsed !== 'cohort') this.cohortKeys.set([]);
  }

  protected isCohortSelected(key: string): boolean {
    return this.cohortKeys().includes(key);
  }

  protected onCohortToggle(key: string, event: Event): void {
    const checked = (event.target as HTMLInputElement | null)?.checked ?? false;
    const current = this.cohortKeys();
    this.cohortKeys.set(
      checked
        ? [...current.filter((k) => k !== key), key]
        : current.filter((k) => k !== key),
    );
  }

  protected onSequentialChange(event: Event): void {
    this.sequential.set(
      (event.target as HTMLInputElement | null)?.checked ?? false,
    );
  }

  protected onCloseClick(): void {
    if (this.saving()) return;
    this.closeModal.emit();
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    if (!this.canSubmit()) return;

    this.saving.set(true);
    this.errorMessage.set(null);

    const cover = this.coverImageUrl().trim();
    const existing = this.course();

    const request$ = existing
      ? this.learningApi.updateCourse(existing.id, {
          title: this.title().trim(),
          description: this.description().trim(),
          // `null` genuinely clears the column here; `undefined` would leave a
          // stale cover in place after the admin emptied the field.
          coverImageUrl: cover.length > 0 ? cover : null,
          visibility: this.visibility(),
          cohortKeys: [...this.cohortKeys()],
          sequential: this.sequential(),
        })
      : this.learningApi.createCourse({
          title: this.title().trim(),
          description: this.description().trim(),
          // `CreateCourseDto` rejects an explicit null — omit instead.
          coverImageUrl: cover.length > 0 ? cover : undefined,
          visibility: this.visibility(),
          cohortKeys: [...this.cohortKeys()],
          sequential: this.sequential(),
        });

    request$.subscribe({
      next: (result) => {
        this.saving.set(false);
        this.saved.emit(result);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.errorMessage.set(this.extractErrorMessage(err));
      },
    });
  }

  /**
   * Turns a failed request into one sentence.
   *
   * ⚠️ IT NEVER SURFACES AN `HttpErrorResponse` VERBATIM. That object's own
   * `message` is a transport string ("Http failure response for …: 400 Bad
   * Request") that tells an admin nothing about the course, and on a `0` status
   * it leaks the URL. Only the server's own `error.message` — which the API
   * writes deliberately — reaches the user, and a `string[]` from the
   * validation pipe is joined rather than rendered as `[object Object]`.
   */
  private extractErrorMessage(err: unknown): string {
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      const body = (err as { error?: { message?: string | string[] } }).error;
      const msg = body?.message;
      if (Array.isArray(msg)) return msg.join(', ');
      if (typeof msg === 'string' && msg.length > 0) return msg;
    }
    return 'Could not save the course. Please try again.';
  }
}
