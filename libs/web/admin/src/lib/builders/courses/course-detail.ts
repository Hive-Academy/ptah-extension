import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ArrowLeft, GraduationCap } from 'lucide-angular';

import { EmptyState, StatusBadge } from '@ptah-web/panel-ui';

import {
  AdminLearningApiService,
  SCHEDULE_DATE_REGEX,
  SCHEDULE_TIME_REGEX,
  type AdminCourse,
  type AdminCourseModuleWithLessons,
  type AdminModuleSchedule,
  type RefreshMetadataResult,
} from '../../services/admin-learning-api.service';
import { ConfirmDeleteModal } from './components/confirm-delete-modal/confirm-delete-modal';
import {
  ModuleFormModal,
  type ModuleFormTarget,
} from './components/module-form-modal/module-form-modal';
import { ModuleLessons } from './components/module-lessons/module-lessons';

/**
 * The most lessons `POST /admin/lessons/refresh-metadata` accepts in one
 * request, mirroring the `@ArrayMaxSize(100)` on its DTO.
 */
const REFRESH_BATCH_LIMIT = 100;

/**
 * CourseDetail — `/admin/builders/courses/:id`, where a course's modules and
 * lessons are authored (R2.2, R2.4, R8.8, C4).
 *
 * ⚠️ `GET /admin/courses/:id/modules` IS THE ONE READ FOR THE WHOLE SUBTREE. It
 * returns every live module of the course with its live lessons, drafts
 * included and tombstones excluded, in the server's order. `AdminCourse` itself
 * carries only `moduleCount` and `lessonCount`, and `…/course-modules` and
 * `…/lessons` still expose writes only.
 *
 * ⚠️ EVERY WRITE IS FOLLOWED BY A RE-READ, NOT BY A LOCAL PATCH. Sort order,
 * `lessonCount` and `commentCount` are all derived server-side, and a create or
 * a reorder moves values this screen cannot recompute. {@link reload} refetches
 * the course and its outline together, so the header counts and the list under
 * them can never disagree.
 *
 * ⚠️ THE SCHEDULE PREVIEW IS CONFINED TO THE SCHEDULE PANEL. It answers about a
 * PROPOSED schedule that nothing has applied, so it runs only where the admin
 * supplied the inputs it describes — never as a module read.
 *
 * ⚠️ THE SCHEDULE APPLY IS GUARDED BY ITS OWN PREVIEW AND MUST STAY THAT WAY.
 * It is a TOTAL re-schedule that overwrites hand-set dates, and the server
 * refuses it unless the caller echoes back `confirmModuleCount` and
 * `confirmLastReleaseDate`. This screen takes both from the preview response it
 * is showing, never from its own arithmetic, so the numbers an admin confirms
 * are the numbers they read.
 *
 * ⚠️ NO MARKDOWN IS RENDERED AND THERE IS NO `[innerHTML]`. A lesson body is
 * edited as plain text in a textarea; rendering it would put a second consumer
 * on the member panel's sanitizer.
 *
 * 🔴 EVERY READ IS KEYED TO THE ROUTE ID IT WAS STARTED FOR, AND A RESPONSE FOR
 * ANY OTHER ID IS DROPPED. The router reuses this one instance across
 * `builders/courses/:id`, so browser back and forward leave two `getCourse`
 * calls in flight at once. Without the check the slower one wins, and the
 * screen then shows course A under URL B while {@link reload} and
 * {@link applyOrder} — both of which read `this.course()?.id` — send every
 * later write to A. See {@link staleFor}.
 */
@Component({
  selector: 'ptah-admin-course-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    EmptyState,
    StatusBadge,
    ModuleFormModal,
    ModuleLessons,
    ConfirmDeleteModal,
  ],
  templateUrl: './course-detail.html',
})
export class CourseDetail {
  private readonly api = inject(AdminLearningApiService);
  private readonly route = inject(ActivatedRoute);

  protected readonly ArrowLeftIcon = ArrowLeft;
  protected readonly GraduationCapIcon = GraduationCap;

  private readonly idParam = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  protected readonly courseId = computed<string | null>(
    () => this.idParam()?.get('id') ?? null,
  );

  protected readonly course = signal<AdminCourse | null>(null);
  protected readonly loading = signal<boolean>(false);
  protected readonly loadError = signal<string | null>(null);

  protected readonly modules = signal<readonly AdminCourseModuleWithLessons[]>(
    [],
  );
  protected readonly modulesLoading = signal<boolean>(false);
  protected readonly modulesError = signal<string | null>(null);
  protected readonly reordering = signal<boolean>(false);

  protected readonly formOpen = signal<boolean>(false);
  protected readonly formTarget = signal<ModuleFormTarget | null>(null);

  protected readonly deleteOpen = signal<boolean>(false);
  protected readonly deleteTarget = signal<AdminCourseModuleWithLessons | null>(
    null,
  );
  protected readonly deleting = signal<boolean>(false);
  protected readonly deleteError = signal<string | null>(null);

  /* -------------------------------- Schedule panel -------------------- */

  protected readonly scheduleStartDate = signal<string>('');
  protected readonly scheduleTimeOfDay = signal<string>('09:00');
  protected readonly scheduleTimeZone = signal<string>(this.localTimeZone());
  protected readonly schedulePreview = signal<AdminModuleSchedule | null>(null);
  protected readonly scheduleBusy = signal<boolean>(false);
  protected readonly scheduleError = signal<string | null>(null);
  protected readonly scheduleNotice = signal<string | null>(null);

  /* -------------------------------- Lessons --------------------------- */

  protected readonly bulkBusy = signal<boolean>(false);
  protected readonly bulkNotice = signal<string | null>(null);
  protected readonly bulkError = signal<string | null>(null);

  /** Every live lesson of the course, in outline order. */
  private readonly lessonIds = computed<readonly string[]>(() =>
    this.modules().flatMap((m) => m.lessons.map((l) => l.id)),
  );

  protected readonly lessonCount = computed<number>(
    () => this.lessonIds().length,
  );

  /**
   * True when the course holds more lessons than one refresh request can carry.
   * The screen says so rather than reporting a partial run as a whole one.
   */
  protected readonly refreshTruncated = computed<boolean>(
    () => this.lessonCount() > REFRESH_BATCH_LIMIT,
  );

  protected readonly refreshLimit = REFRESH_BATCH_LIMIT;

  protected readonly scheduleInputsValid = computed<boolean>(
    () =>
      SCHEDULE_DATE_REGEX.test(this.scheduleStartDate()) &&
      SCHEDULE_TIME_REGEX.test(this.scheduleTimeOfDay()) &&
      this.scheduleTimeZone().trim().length > 0,
  );

  public constructor() {
    // Refetch when the route id changes — the same component instance is
    // reused when an admin navigates between two courses.
    //
    // The previous course's rows are dropped BEFORE the new read starts. They
    // describe a course the URL has left, and every write on this screen reads
    // its target from `course()?.id`, so leaving them on screen would let a
    // click during the load write to the course the admin navigated away from.
    effect(() => {
      const id = this.courseId();
      if (id === null) return;
      untracked(() => this.clearCourse());
      this.fetchCourse(id);
    });
  }

  /** Drops everything that described the previous course. */
  private clearCourse(): void {
    this.course.set(null);
    this.modules.set([]);
    this.loadError.set(null);
    this.modulesError.set(null);
    this.schedulePreview.set(null);
    this.scheduleError.set(null);
    this.scheduleNotice.set(null);
    this.bulkError.set(null);
    this.bulkNotice.set(null);
  }

  /* -------------------------------- Course ---------------------------- */

  /**
   * True when a response started for `id` no longer describes the route the
   * screen is on.
   *
   * 🔴 THE ONLY CORRECT ANSWER TO A STALE RESPONSE IS TO DROP IT WHOLE — no
   * signal write, no `loading` flip, no follow-up read. The request that
   * superseded it owns those flags, and clearing them here would report the
   * live read as finished while it is still running.
   *
   * A `null` route id means the screen is leaving; nothing is stale against it,
   * so the in-flight read is allowed to settle rather than being dropped twice.
   */
  private staleFor(id: string): boolean {
    const current = this.courseId();
    return current !== null && current !== id;
  }

  protected fetchCourse(id: string = this.courseId() ?? ''): void {
    if (id.length === 0) return;
    this.loading.set(true);
    this.loadError.set(null);
    this.api.getCourse(id).subscribe({
      next: (course) => {
        if (this.staleFor(course.id)) return;
        this.course.set(course);
        this.loading.set(false);
        this.loadModules(course.id);
      },
      error: (err: unknown) => {
        if (this.staleFor(id)) return;
        this.loading.set(false);
        this.loadError.set(
          this.extractErrorMessage(err, 'Could not load this course.'),
        );
      },
    });
  }

  /**
   * Reads the modules and their lessons from the authoring outline.
   *
   * It is called for every course, including one with no modules: the route
   * answers `{ modules: [] }` rather than an error, so there is no count to
   * check first.
   *
   * It carries the same {@link staleFor} guard as the course read: the outline
   * envelope holds no course id of its own, so the id the request was started
   * for is the only thing that can identify it on arrival.
   */
  private loadModules(courseId: string): void {
    this.modulesLoading.set(true);
    this.modulesError.set(null);
    this.api.getCourseOutline(courseId).subscribe({
      next: (outline) => {
        if (this.staleFor(courseId)) return;
        this.modules.set(outline.modules);
        this.modulesLoading.set(false);
      },
      error: (err: unknown) => {
        if (this.staleFor(courseId)) return;
        this.modulesLoading.set(false);
        this.modulesError.set(
          this.extractErrorMessage(err, 'Could not load the modules.'),
        );
      },
    });
  }

  /**
   * Refetches the course and its outline after a write.
   *
   * Both, not one: the header's `moduleCount` and `lessonCount` come from the
   * course row and the list under them comes from the outline, so reading only
   * one of the two would leave the screen contradicting itself.
   */
  private reload(): void {
    const id = this.course()?.id;
    if (id === undefined) return;
    this.fetchCourse(id);
  }

  /* -------------------------------- Module CRUD ----------------------- */

  protected openCreateModule(): void {
    this.formTarget.set(null);
    this.formOpen.set(true);
  }

  protected openEditModule(row: AdminCourseModuleWithLessons): void {
    this.formTarget.set({
      id: row.id,
      title: row.title,
      description: row.description,
      releaseAt: row.releaseAt,
    });
    this.formOpen.set(true);
  }

  protected onModuleFormClose(): void {
    this.formOpen.set(false);
  }

  protected onModuleSaved(): void {
    this.formOpen.set(false);
    // The proposed dates on screen were computed against the old module set.
    this.schedulePreview.set(null);
    this.reload();
  }

  protected canMoveUp(index: number): boolean {
    return index > 0 && !this.reordering();
  }

  protected canMoveDown(index: number): boolean {
    return index < this.modules().length - 1 && !this.reordering();
  }

  protected moveUp(index: number): void {
    if (!this.canMoveUp(index)) return;
    this.applyOrder(this.swapped(index, index - 1));
  }

  protected moveDown(index: number): void {
    if (!this.canMoveDown(index)) return;
    this.applyOrder(this.swapped(index, index + 1));
  }

  private swapped(a: number, b: number): AdminCourseModuleWithLessons[] {
    const next = [...this.modules()];
    const held = next[a];
    next[a] = next[b];
    next[b] = held;
    return next;
  }

  /**
   * Sends the whole module list in its new order, with the `courseId` explicit.
   *
   * The new order is shown at once so the arrows respond, and the server's own
   * order is then read back — the accepted `sortOrder` values are renumbered
   * inside the transaction and are not the indexes sent. On a refusal the
   * server writes nothing, so restoring the previous list is accurate rather
   * than a guess.
   */
  private applyOrder(next: readonly AdminCourseModuleWithLessons[]): void {
    const id = this.course()?.id;
    if (id === undefined) return;
    const previous = this.modules();
    this.modules.set(next);
    this.reordering.set(true);
    this.modulesError.set(null);
    this.api
      .reorderModules(
        id,
        next.map((m) => m.id),
      )
      .subscribe({
        next: () => {
          this.reordering.set(false);
          // Day order changed, so any schedule on screen no longer describes it.
          this.schedulePreview.set(null);
          this.reload();
        },
        error: (err: unknown) => {
          this.modules.set(previous);
          this.reordering.set(false);
          this.modulesError.set(
            this.extractErrorMessage(err, 'Could not save the module order.'),
          );
        },
      });
  }

  protected openDeleteModule(row: AdminCourseModuleWithLessons): void {
    this.deleteTarget.set(row);
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
    this.api.deleteModule(target.id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.deleteOpen.set(false);
        this.schedulePreview.set(null);
        this.reload();
      },
      error: (err: unknown) => {
        this.deleting.set(false);
        this.deleteError.set(
          this.extractErrorMessage(err, 'Could not delete the module.'),
        );
      },
    });
  }

  /* -------------------------------- Schedule -------------------------- */

  protected onStartDateInput(event: Event): void {
    this.scheduleStartDate.set(
      (event.target as HTMLInputElement | null)?.value ?? '',
    );
    this.schedulePreview.set(null);
  }

  protected onTimeOfDayInput(event: Event): void {
    this.scheduleTimeOfDay.set(
      (event.target as HTMLInputElement | null)?.value ?? '',
    );
    this.schedulePreview.set(null);
  }

  protected onTimeZoneInput(event: Event): void {
    this.scheduleTimeZone.set(
      (event.target as HTMLInputElement | null)?.value ?? '',
    );
    this.schedulePreview.set(null);
  }

  protected previewSchedule(): void {
    const id = this.course()?.id;
    if (id === undefined || !this.scheduleInputsValid()) return;
    this.scheduleBusy.set(true);
    this.scheduleError.set(null);
    this.scheduleNotice.set(null);
    this.api
      .previewModuleSchedule({
        courseId: id,
        startDate: this.scheduleStartDate(),
        timeOfDay: this.scheduleTimeOfDay(),
        timeZone: this.scheduleTimeZone().trim(),
      })
      .subscribe({
        next: (schedule) => {
          this.schedulePreview.set(schedule);
          this.scheduleBusy.set(false);
        },
        error: (err: unknown) => {
          this.scheduleBusy.set(false);
          this.scheduleError.set(
            this.extractErrorMessage(err, 'Could not compute the schedule.'),
          );
        },
      });
  }

  /**
   * Applies the schedule currently on screen.
   *
   * 🔴 `confirmModuleCount` AND `confirmLastReleaseDate` COME FROM THE PREVIEW
   * RESPONSE, NEVER FROM A LOCAL CALCULATION. The server compares them against
   * what it recomputes inside the transaction, so a module added by another
   * admin since the preview turns this into a `400` instead of a silent
   * re-schedule of a set the admin never saw. Deriving them here would defeat
   * the entire guard.
   */
  protected applySchedule(): void {
    const preview = this.schedulePreview();
    const id = this.course()?.id;
    if (!preview || id === undefined) return;
    this.scheduleBusy.set(true);
    this.scheduleError.set(null);
    this.scheduleNotice.set(null);
    this.api
      .applyModuleSchedule({
        courseId: id,
        startDate: preview.startDate,
        timeOfDay: preview.timeOfDay,
        timeZone: preview.timeZone,
        confirmModuleCount: preview.moduleCount,
        confirmLastReleaseDate: preview.lastReleaseDate,
      })
      .subscribe({
        next: (applied) => {
          this.scheduleBusy.set(false);
          this.schedulePreview.set(applied);
          this.scheduleNotice.set(
            `${applied.changedCount} of ${applied.moduleCount} module(s) moved. ` +
              `The last one opens on ${applied.lastReleaseDate}.`,
          );
          // The apply wrote release dates, so the list is re-read rather than
          // patched from the response.
          this.reload();
        },
        error: (err: unknown) => {
          this.scheduleBusy.set(false);
          this.scheduleError.set(
            this.extractErrorMessage(err, 'Could not apply the schedule.'),
          );
        },
      });
  }

  /* -------------------------------- Lessons --------------------------- */

  /** A lesson write landed in one of the panels — re-read the whole outline. */
  protected onLessonsChanged(): void {
    this.reload();
  }

  /**
   * Refreshes YouTube metadata for the course's lessons.
   *
   * ⚠️ THE REQUEST TAKES 1–100 EXPLICIT IDS, NOT A COURSE, so a course with
   * more lessons than that is refreshed as far as the first
   * {@link REFRESH_BATCH_LIMIT} of them in outline order. The panel says so
   * whenever it applies — reporting a partial run as a whole one would leave an
   * admin believing stale videos were fixed.
   */
  protected refreshAllLessons(): void {
    const ids = this.lessonIds();
    if (ids.length === 0 || this.bulkBusy()) return;
    this.bulkBusy.set(true);
    this.bulkError.set(null);
    this.bulkNotice.set(null);
    this.api
      .refreshLessonMetadata(ids.slice(0, REFRESH_BATCH_LIMIT))
      .subscribe({
        next: (result) => {
          this.bulkBusy.set(false);
          this.bulkNotice.set(this.describeRefresh(result));
          // The refresh rewrote video columns on the lessons it touched.
          this.reload();
        },
        error: (err: unknown) => {
          this.bulkBusy.set(false);
          this.bulkError.set(
            this.extractErrorMessage(err, 'Could not refresh the metadata.'),
          );
        },
      });
  }

  /** `reason: 'youtube_disabled'` is a success shape — see `ModuleLessons`. */
  private describeRefresh(result: RefreshMetadataResult): string {
    if (result.reason === 'youtube_disabled') {
      return 'The YouTube integration is off, so nothing was fetched and nothing was changed.';
    }
    const parts = [`${result.refreshed} refreshed`];
    if (result.skipped > 0) parts.push(`${result.skipped} without a video`);
    if (result.failed.length > 0) {
      parts.push(`${result.failed.length} failed`);
    }
    return parts.join(', ') + '.';
  }

  /* -------------------------------- Helpers --------------------------- */

  protected moduleReleaseLabel(row: AdminCourseModuleWithLessons): string {
    if (row.releaseAt === null) return 'Open now';
    const at = new Date(row.releaseAt);
    if (Number.isNaN(at.getTime())) return row.releaseAt;
    const locked = at.getTime() > Date.now();
    return `${locked ? 'Locks until' : 'Opened'} ${at.toLocaleString()}`;
  }

  protected moduleLocked(row: AdminCourseModuleWithLessons): boolean {
    return row.releaseAt !== null && Date.parse(row.releaseAt) > Date.now();
  }

  /** The operator's IANA zone, falling back to `UTC` where it is unavailable. */
  private localTimeZone(): string {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return resolved && resolved.length > 0 ? resolved : 'UTC';
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
