import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';

import {
  AdminLearningApiService,
  type AdminLesson,
  type RefreshMetadataResult,
} from '../../../../services/admin-learning-api.service';
import { ConfirmDeleteModal } from '../confirm-delete-modal/confirm-delete-modal';
import { LessonFormModal } from '../lesson-form-modal/lesson-form-modal';

/**
 * ModuleLessons — the lesson authoring panel for ONE module.
 *
 * ⚠️ THIS PANEL OWNS NO LESSON STATE. `CourseDetail` reads the whole course
 * from `GET /admin/courses/:id/modules` and passes this module's slice down.
 * Every write here emits {@link ModuleLessons.lessonsChanged}, the parent
 * re-reads the outline, and the new list arrives back as an input — so the
 * order and the counts on screen are always the server's. Patching a local copy
 * instead would drift the moment two admins author the same course, and
 * `PATCH /admin/lessons/reorder` renumbers `sortOrder` inside its own
 * transaction rather than storing the indexes it was sent.
 *
 * ⚠️ REORDER IS SHOWN OPTIMISTICALLY AND THEN RE-READ. {@link order} is a
 * `linkedSignal` over the input so the arrows respond at once; it resets from
 * the input on every parent re-read. `PATCH /admin/lessons/reorder` checks the
 * submitted ids against the live sibling set inside its transaction and answers
 * `400` with no writes if they differ, so restoring the previous order on a
 * refusal is accurate rather than optimistic.
 */
@Component({
  selector: 'ptah-admin-module-lessons',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LessonFormModal, ConfirmDeleteModal],
  templateUrl: './module-lessons.html',
})
export class ModuleLessons {
  private readonly api = inject(AdminLearningApiService);

  public readonly moduleId = input.required<string>();
  public readonly moduleTitle = input.required<string>();

  /** This module's live lessons, in the server's order. */
  public readonly lessons = input.required<readonly AdminLesson[]>();

  /** Disables every control while the parent is busy with the module itself. */
  public readonly disabled = input<boolean>(false);

  /** A lesson write landed. The parent re-reads the course outline. */
  public readonly lessonsChanged = output<void>();

  /**
   * The order on screen. Seeded from the input and reset by it, and written
   * only to show a reorder before the server has confirmed it.
   */
  protected readonly order = linkedSignal<readonly AdminLesson[]>(() =>
    this.lessons(),
  );

  protected readonly formOpen = signal<boolean>(false);
  protected readonly formTarget = signal<AdminLesson | null>(null);

  protected readonly deleteOpen = signal<boolean>(false);
  protected readonly deleteTarget = signal<AdminLesson | null>(null);
  protected readonly deleting = signal<boolean>(false);
  protected readonly deleteError = signal<string | null>(null);

  /** Id of the lesson with a refresh or reorder in flight. */
  protected readonly busyId = signal<string | null>(null);
  protected readonly reordering = signal<boolean>(false);
  protected readonly error = signal<string | null>(null);
  /** The outcome of the last metadata refresh, shown until the next action. */
  protected readonly refreshNotice = signal<string | null>(null);

  protected readonly hasLessons = computed<boolean>(
    () => this.order().length > 0,
  );

  protected readonly locked = computed<boolean>(
    () => this.disabled() || this.reordering() || this.busyId() !== null,
  );

  /* --------------------------------- Create / edit -------------------- */

  protected openCreate(): void {
    this.formTarget.set(null);
    this.formOpen.set(true);
  }

  protected openEdit(lesson: AdminLesson): void {
    this.formTarget.set(lesson);
    this.formOpen.set(true);
  }

  protected onFormClose(): void {
    this.formOpen.set(false);
  }

  protected onFormSaved(): void {
    this.formOpen.set(false);
    this.refreshNotice.set(null);
    this.lessonsChanged.emit();
  }

  /* --------------------------------- Reorder -------------------------- */

  protected canMoveUp(index: number): boolean {
    return index > 0 && !this.locked();
  }

  protected canMoveDown(index: number): boolean {
    return index < this.order().length - 1 && !this.locked();
  }

  protected moveUp(index: number): void {
    if (!this.canMoveUp(index)) return;
    this.applyOrder(this.swapped(index, index - 1));
  }

  protected moveDown(index: number): void {
    if (!this.canMoveDown(index)) return;
    this.applyOrder(this.swapped(index, index + 1));
  }

  private swapped(a: number, b: number): AdminLesson[] {
    const next = [...this.order()];
    const held = next[a];
    next[a] = next[b];
    next[b] = held;
    return next;
  }

  private applyOrder(next: readonly AdminLesson[]): void {
    const previous = this.order();
    this.order.set(next);
    this.reordering.set(true);
    this.error.set(null);
    this.refreshNotice.set(null);
    this.api
      .reorderLessons(
        this.moduleId(),
        next.map((l) => l.id),
      )
      .subscribe({
        next: () => {
          this.reordering.set(false);
          this.lessonsChanged.emit();
        },
        error: (err: unknown) => {
          // The server writes nothing when the sibling set does not match, so
          // restoring the previous order is accurate rather than optimistic.
          this.order.set(previous);
          this.reordering.set(false);
          this.error.set(
            this.extractErrorMessage(
              err,
              'Could not save the lesson order. Every live lesson of this module has to be in the list.',
            ),
          );
        },
      });
  }

  /* --------------------------------- Refresh -------------------------- */

  protected refreshMetadata(lesson: AdminLesson): void {
    if (this.locked()) return;
    this.busyId.set(lesson.id);
    this.error.set(null);
    this.refreshNotice.set(null);
    this.api.refreshLessonMetadataOne(lesson.id).subscribe({
      next: (result) => {
        this.busyId.set(null);
        this.refreshNotice.set(this.describeRefresh(result));
        // The refresh rewrote this lesson's video columns.
        this.lessonsChanged.emit();
      },
      error: (err: unknown) => {
        this.busyId.set(null);
        this.error.set(
          this.extractErrorMessage(err, 'Could not refresh the metadata.'),
        );
      },
    });
  }

  /**
   * Turns a refresh outcome into one sentence.
   *
   * ⚠️ `reason: 'youtube_disabled'` IS A SUCCESS, NOT A FAILURE. With the
   * integration off the server writes nothing at all and reports it — which is
   * the whole safety of that endpoint, because the natural implementation would
   * have rewritten every lesson in the batch to `'manual'` with a null title
   * and duration. Rendering it as an error would send an admin hunting for a
   * broken lesson that does not exist.
   */
  private describeRefresh(result: RefreshMetadataResult): string {
    if (result.reason === 'youtube_disabled') {
      return 'The YouTube integration is off, so nothing was fetched and nothing was changed.';
    }
    const parts = [`${result.refreshed} refreshed`];
    if (result.skipped > 0) parts.push(`${result.skipped} without a video`);
    if (result.failed.length > 0) {
      parts.push(
        `${result.failed.length} failed (${result.failed
          .map((f) => f.reason)
          .join(', ')})`,
      );
    }
    return parts.join(', ') + '.';
  }

  /* --------------------------------- Delete --------------------------- */

  protected openDelete(lesson: AdminLesson): void {
    this.deleteTarget.set(lesson);
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
    this.api.deleteLesson(target.id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.deleteOpen.set(false);
        this.lessonsChanged.emit();
      },
      error: (err: unknown) => {
        this.deleting.set(false);
        this.deleteError.set(
          this.extractErrorMessage(err, 'Could not delete the lesson.'),
        );
      },
    });
  }

  /** Never surfaces a raw `HttpErrorResponse` — see `CoursesList` for why. */
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
