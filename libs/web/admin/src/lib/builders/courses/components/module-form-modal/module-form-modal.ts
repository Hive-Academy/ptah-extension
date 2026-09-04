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

import {
  AdminLearningApiService,
  type AdminCourseModule,
} from '../../../../services/admin-learning-api.service';

/**
 * The module being edited.
 *
 * Every field is read back from `GET /admin/courses/:id/modules`, so
 * `description: null` means the module genuinely has none.
 */
export interface ModuleFormTarget {
  id: string;
  title: string;
  /** `null` for a module with no description. */
  description: string | null;
  /** ISO 8601, or `null` for a module with no scheduled release. */
  releaseAt: string | null;
}

/**
 * ModuleFormModal — create or edit one module of a course.
 *
 * Dual mode driven by the `module` input: `null` → create
 * (`POST /api/v1/admin/course-modules`, with the `courseId` supplied by the
 * parent), non-null → edit (`PATCH .../course-modules/:id`).
 *
 * ⚠️ THE DESCRIPTION KEY IS SENT ONLY WHEN THE BOX CHANGED. An emptied box
 * sends `null`, which clears the text; an untouched box sends nothing, so a
 * `PATCH` of the title alone cannot rewrite a column the admin did not edit.
 * The same baseline rule protects the video fields on `LessonFormModal`.
 *
 * 🔴 `releaseAt` IS A THREE-STATE FIELD AND THE FORM PRESERVES ALL THREE.
 * Sending `null` clears the date and OPENS the module immediately; sending a
 * date locks it until then (R2.4.1 — its lessons answer `403 not_released`);
 * omitting the key leaves whatever is there alone. An EDIT omits it whenever
 * the control still reads what it was opened with — see
 * {@link ModuleFormModal.releaseAtPatch}.
 *
 * ⚠️ THE INPUT IS `datetime-local`, WHICH IS ZONE-LESS. The browser hands back
 * `YYYY-MM-DDTHH:mm` with no offset, so it is read in the OPERATOR'S zone and
 * converted to an ISO instant before it is sent — the column stores an instant
 * and the server validates ISO 8601. Passing the raw value through would be a
 * `400` on some browsers and a silent zone shift on others. For a whole
 * cohort's dates use the schedule panel, which takes an explicit IANA zone.
 *
 * ⚠️ NO SLUG FIELD. The server derives it from the title, course-wide, and it
 * is not patchable.
 */
@Component({
  selector: 'ptah-admin-module-form-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './module-form-modal.html',
})
export class ModuleFormModal {
  private readonly api = inject(AdminLearningApiService);

  public readonly open = input<boolean>(false);

  /** The course a created module belongs to. Ignored in edit mode. */
  public readonly courseId = input.required<string>();

  /** `null` = create mode. Non-null = edit mode. */
  public readonly module = input<ModuleFormTarget | null>(null);

  public readonly closeModal = output<void>();
  public readonly saved = output<AdminCourseModule>();

  protected readonly title = signal<string>('');
  protected readonly description = signal<string>('');
  /** Raw `datetime-local` text in the operator's own zone, or `''` for none. */
  protected readonly releaseAtLocal = signal<string>('');

  protected readonly saving = signal<boolean>(false);
  protected readonly errorMessage = signal<string | null>(null);

  /** What the description box held on open. */
  private descriptionBaseline = '';

  /**
   * The module's stored `releaseAt` at open, as the server sent it.
   *
   * 🔴 THE ISO STRING IS KEPT, NOT THE CONTROL'S TEXT. `datetime-local` is
   * MINUTE precision, so the round trip through it drops the seconds and the
   * milliseconds. Comparing the two ISO strings would call every reopened form
   * "changed"; comparing the two CONTROL strings compares like with like.
   */
  private releaseAtBaseline: string | null = null;

  protected readonly isEdit = computed<boolean>(() => this.module() !== null);

  protected readonly canSubmit = computed<boolean>(
    () => !this.saving() && this.title().trim().length >= 3,
  );

  /** True when the typed date is in the future — the module will be locked. */
  protected readonly willBeLocked = computed<boolean>(() => {
    const iso = this.toIso(this.releaseAtLocal());
    return iso !== null && Date.parse(iso) > Date.now();
  });

  public constructor() {
    effect(() => {
      if (!this.open()) return;
      const m = this.module();
      this.title.set(m?.title ?? '');
      this.description.set(m?.description ?? '');
      this.descriptionBaseline = m?.description ?? '';
      this.releaseAtBaseline = m?.releaseAt ?? null;
      this.releaseAtLocal.set(this.toLocalInput(this.releaseAtBaseline));
      this.saving.set(false);
      this.errorMessage.set(null);
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

  protected onReleaseAtInput(event: Event): void {
    this.releaseAtLocal.set(
      (event.target as HTMLInputElement | null)?.value ?? '',
    );
  }

  protected clearReleaseAt(): void {
    this.releaseAtLocal.set('');
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

    const description = this.description().trim();
    const existing = this.module();

    const request$ = existing
      ? this.api.updateModule(existing.id, {
          title: this.title().trim(),
          ...this.descriptionPatch(description),
          ...this.releaseAtPatch(),
        })
      : this.api.createModule({
          courseId: this.courseId(),
          title: this.title().trim(),
          // `CreateModuleDto` rejects an explicit null — omit instead.
          description: description.length > 0 ? description : undefined,
          releaseAt: this.toIso(this.releaseAtLocal()) ?? undefined,
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

  /** The description half of a `PATCH` body — EMPTY when nothing changed. */
  private descriptionPatch(typed: string): { description?: string | null } {
    if (typed === this.descriptionBaseline.trim()) return {};
    return { description: typed.length > 0 ? typed : null };
  }

  /**
   * The `releaseAt` half of a `PATCH` body — EMPTY when the control was not
   * touched.
   *
   * 🔴 A TITLE-ONLY EDIT MUST NOT MOVE THE RELEASE INSTANT. The stored value
   * can carry seconds (`…T09:00:45.000Z`) that the minute-precision control
   * cannot show, so sending the control's value back would shift the instant by
   * up to 59 seconds and write an audit row for a change the admin never made.
   * The comparison is made in CONTROL space — the baseline is pushed through
   * {@link toLocalInput}, the same function that filled the box — so only a
   * date the admin actually retyped, or cleared, is sent.
   */
  private releaseAtPatch(): { releaseAt?: string | null } {
    if (this.releaseAtLocal() === this.toLocalInput(this.releaseAtBaseline)) {
      return {};
    }
    return { releaseAt: this.toIso(this.releaseAtLocal()) };
  }

  /** `datetime-local` text → an ISO instant, or `null` for an empty box. */
  private toIso(local: string): string | null {
    if (local.trim().length === 0) return null;
    const parsed = new Date(local);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
  }

  /**
   * An ISO instant → `datetime-local` text in the operator's zone.
   *
   * Built by subtracting the local offset before slicing the ISO string:
   * `toISOString()` is always UTC, and slicing it directly would show a date
   * the operator never chose.
   */
  private toLocalInput(iso: string | null): string {
    if (iso === null) return '';
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return '';
    const offsetMs = parsed.getTimezoneOffset() * 60_000;
    return new Date(parsed.getTime() - offsetMs).toISOString().slice(0, 16);
  }

  /** Never surfaces a raw `HttpErrorResponse` — see `CoursesList` for why. */
  private extractErrorMessage(err: unknown): string {
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      const body = (err as { error?: { message?: string | string[] } }).error;
      const msg = body?.message;
      if (Array.isArray(msg)) return msg.join(', ');
      if (typeof msg === 'string' && msg.length > 0) return msg;
    }
    return 'Could not save the module. Please try again.';
  }
}
