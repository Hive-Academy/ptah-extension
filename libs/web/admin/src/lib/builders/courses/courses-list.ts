import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { GraduationCap } from 'lucide-angular';

import { EmptyState, StatusBadge } from '@ptah-web/panel-ui';

import {
  AdminLearningApiService,
  type AdminCourse,
} from '../../services/admin-learning-api.service';
import { ConfirmDeleteModal } from './components/confirm-delete-modal/confirm-delete-modal';
import { CourseFormModal } from './components/course-form-modal/course-form-modal';

/**
 * CoursesList — `/admin/builders/courses`, the §3.4 course authoring surface
 * (R2.1, R8.1, R8.5, R8.8).
 *
 * ⚠️ THE FIRST CLIENT THIS API HAS EVER HAD. Every endpoint behind this screen
 * shipped complete and audited, reachable only by hand-built requests; what was
 * missing was the screen. Nothing on the server changes for it.
 *
 * 🔴 PUBLISHING IS A SEPARATE ACT FROM SAVING, AND THE UI KEEPS IT THAT WAY.
 * Create and edit go through `POST`/`PATCH`, which have no `published` field at
 * all; the toggle in the Published column is `PUT :id/published`, its own
 * request with its own audit action. An admin can therefore never make a course
 * member-visible as a side effect of fixing a typo in its description.
 *
 * ⚠️ REORDER SENDS THE WHOLE LIST, NOT THE PAIR THAT MOVED. The server checks
 * the submitted ids against the current live sibling set INSIDE the
 * transaction, and refuses a partial list, a duplicate or a foreign id with a
 * `400` and no writes. "Move up" therefore swaps two entries in a local copy
 * and sends every id in the resulting order.
 *
 * ⚠️ TOMBSTONES ARE INVISIBLE HERE AND THERE IS NO "SHOW DELETED" TOGGLE.
 * `GET /admin/courses` takes no `includeDeleted` — unlike the community queue,
 * which carries AD-5's single declared exemption. A deleted course is
 * restorable for 30 days through `POST :id/restore`, but only from an id held
 * outside this screen. Adding the toggle is a server change, not a client one.
 *
 * ⚠️ NO MARKDOWN IS RENDERED. A course description is plain text in a cell and
 * a lesson body never reaches this screen, so nothing here needs the member
 * panel's sanitizer and nothing here uses `[innerHTML]`.
 */
@Component({
  selector: 'ptah-admin-courses-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    EmptyState,
    StatusBadge,
    CourseFormModal,
    ConfirmDeleteModal,
  ],
  templateUrl: './courses-list.html',
})
export class CoursesList {
  private readonly api = inject(AdminLearningApiService);

  protected readonly GraduationCapIcon = GraduationCap;

  protected readonly courses = signal<readonly AdminCourse[]>([]);
  protected readonly loading = signal<boolean>(false);
  protected readonly error = signal<string | null>(null);

  /** The id of the row with a write in flight, so its controls disable. */
  protected readonly busyId = signal<string | null>(null);

  /** Form modal state — a `null` target means create mode. */
  protected readonly formOpen = signal<boolean>(false);
  protected readonly formTarget = signal<AdminCourse | null>(null);

  /** Delete confirmation state. This screen owns the request, not the dialog. */
  protected readonly deleteOpen = signal<boolean>(false);
  protected readonly deleteTarget = signal<AdminCourse | null>(null);
  protected readonly deleting = signal<boolean>(false);
  protected readonly deleteError = signal<string | null>(null);

  /** True while a reorder round-trip is open — every arrow disables together. */
  protected readonly reordering = signal<boolean>(false);

  protected readonly publishedCount = computed<number>(
    () => this.courses().filter((c) => c.published).length,
  );

  public constructor() {
    this.fetch();
  }

  protected fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.listCourses().subscribe({
      next: (courses) => {
        this.courses.set(courses);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set(
          this.extractErrorMessage(err, 'Could not load courses.'),
        );
      },
    });
  }

  /* --------------------------------- Create / edit -------------------- */

  protected openCreate(): void {
    this.formTarget.set(null);
    this.formOpen.set(true);
  }

  protected openEdit(course: AdminCourse): void {
    this.formTarget.set(course);
    this.formOpen.set(true);
  }

  protected onFormClose(): void {
    this.formOpen.set(false);
  }

  protected onFormSaved(): void {
    this.formOpen.set(false);
    // Refetch rather than splice the emitted row in: a create allocates a slug
    // and a sortOrder the client did not choose, and both affect this table's
    // order.
    this.fetch();
  }

  /* --------------------------------- Publish -------------------------- */

  /**
   * Flips `published` through its own endpoint.
   *
   * The response is the full admin projection, so the row is replaced from it
   * rather than refetching the list — publication changes nothing about the
   * order or about any other row.
   */
  protected togglePublished(course: AdminCourse): void {
    if (this.busyId() !== null) return;
    this.busyId.set(course.id);
    this.error.set(null);
    this.api.setCoursePublished(course.id, !course.published).subscribe({
      next: (updated) => {
        this.courses.set(
          this.courses().map((c) => (c.id === updated.id ? updated : c)),
        );
        this.busyId.set(null);
      },
      error: (err: unknown) => {
        this.busyId.set(null);
        this.error.set(
          this.extractErrorMessage(
            err,
            `Could not change publication for "${course.title}".`,
          ),
        );
      },
    });
  }

  /* --------------------------------- Reorder -------------------------- */

  protected canMoveUp(index: number): boolean {
    return index > 0 && !this.reordering() && this.busyId() === null;
  }

  protected canMoveDown(index: number): boolean {
    return (
      index < this.courses().length - 1 &&
      !this.reordering() &&
      this.busyId() === null
    );
  }

  protected moveUp(index: number): void {
    if (!this.canMoveUp(index)) return;
    this.applyOrder(this.swapped(index, index - 1));
  }

  protected moveDown(index: number): void {
    if (!this.canMoveDown(index)) return;
    this.applyOrder(this.swapped(index, index + 1));
  }

  private swapped(a: number, b: number): AdminCourse[] {
    const next = [...this.courses()];
    const held = next[a];
    next[a] = next[b];
    next[b] = held;
    return next;
  }

  /**
   * Optimistically shows the new order, then sends EVERY id in it.
   *
   * On failure the previous order is restored from the copy taken before the
   * write — the server made no partial change (the sibling-set check and the
   * renumbering share one transaction), so a local rollback is accurate rather
   * than a guess.
   */
  private applyOrder(next: readonly AdminCourse[]): void {
    const previous = this.courses();
    this.courses.set(next);
    this.reordering.set(true);
    this.error.set(null);
    this.api.reorderCourses(next.map((c) => c.id)).subscribe({
      next: () => {
        this.reordering.set(false);
        // The rows now carry stale `sortOrder` values. They are not rendered,
        // and the next `fetch()` corrects them; re-reading the list to refresh
        // a field nothing displays would be a round-trip for nothing.
      },
      error: (err: unknown) => {
        this.courses.set(previous);
        this.reordering.set(false);
        this.error.set(
          this.extractErrorMessage(err, 'Could not save the new order.'),
        );
      },
    });
  }

  /* --------------------------------- Delete --------------------------- */

  protected openDelete(course: AdminCourse): void {
    this.deleteTarget.set(course);
    this.deleteError.set(null);
    this.deleting.set(false);
    this.deleteOpen.set(true);
  }

  protected onDeleteClose(): void {
    if (this.deleting()) return;
    this.deleteOpen.set(false);
  }

  protected onDeleteConfirmed(): void {
    const target = this.deleteTarget();
    if (!target) return;
    this.deleting.set(true);
    this.deleteError.set(null);
    this.api.deleteCourse(target.id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.deleteOpen.set(false);
        this.fetch();
      },
      error: (err: unknown) => {
        this.deleting.set(false);
        this.deleteError.set(
          this.extractErrorMessage(err, 'Could not delete the course.'),
        );
      },
    });
  }

  protected deleteConsequence(course: AdminCourse): string {
    return (
      `This hides the course and its ${course.moduleCount} module(s) and ` +
      `${course.lessonCount} lesson(s) from every member immediately. ` +
      'It is a soft delete and stays restorable for 30 days, but this screen ' +
      'cannot list a deleted course.'
    );
  }

  /**
   * Turns a failed request into one sentence.
   *
   * ⚠️ AN `HttpErrorResponse` NEVER REACHES THE USER. Its own `message` is a
   * transport string ("Http failure response for /api/…: 500 Internal Server
   * Error") that names the URL and describes nothing an admin can act on. Only
   * the server's deliberate `error.message` is shown, and a `string[]` from the
   * validation pipe is joined instead of rendering as `[object Object]`.
   */
  private extractErrorMessage(err: unknown, fallback: string): string {
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      const body = (err as { error?: { message?: string | string[] } }).error;
      const msg = body?.message;
      if (Array.isArray(msg)) return msg.join(', ');
      if (typeof msg === 'string' && msg.length > 0) return msg;
    }
    return fallback;
  }
}
