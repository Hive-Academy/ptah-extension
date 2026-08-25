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
  AdminApiService,
  MemberGroup,
} from '../../../../services/admin-api.service';
import {
  AdminBuildersApiService,
  PACK_REPO_URL_REGEX,
  PACK_SLUG_REGEX,
  Pack,
} from '../../../../services/admin-builders-api.service';

/**
 * PackFormModal — daisyUI dialog for creating or editing a pack registry row.
 *
 * Dual mode driven by the `pack` input: `null` → create (POST
 * /api/v1/admin/packs), non-null → edit (PATCH .../packs/:id). `slug` is only
 * editable in create mode — it is the stable identifier, mirroring
 * `MemberGroup.key`.
 *
 * ⚠️ THE COHORT SELECT IS A LABEL, NOT A PERMISSION. Choosing a cohort here
 * shares nothing and choosing "Not tied to a cohort" hides nothing — Ptah has
 * no member-facing pack surface at all (TASK_2026_169 Decision 3). Repository
 * access is administered on GitHub. The null option is therefore worded "Not
 * tied to a cohort" rather than anything like "All Builders", which would imply
 * a visibility scope this field does not have (risk L12).
 *
 * Cross-service by necessity: the cohort options come from
 * `AdminApiService.listGroups()` (`GET /api/v1/admin/groups`) while the pack
 * itself is written through `AdminBuildersApiService`. The group list is
 * fetched lazily on first open and cached for the modal's lifetime.
 */
@Component({
  selector: 'ptah-admin-pack-form-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pack-form-modal.html',
})
export class PackFormModal {
  private readonly adminApi = inject(AdminApiService);
  private readonly buildersApi = inject(AdminBuildersApiService);

  /** Show/hide the modal. Parent owns the signal. */
  public readonly open = input<boolean>(false);

  /** `null` = create mode. Non-null = edit mode, pre-fills the form. */
  public readonly pack = input<Pack | null>(null);

  /** Emitted when the user requests the modal to close without saving. */
  public readonly closeModal = output<void>();

  /** Emitted after a successful create/update with the resulting pack. */
  public readonly saved = output<Pack>();

  protected readonly slugRegex = PACK_SLUG_REGEX;
  protected readonly repoUrlRegex = PACK_REPO_URL_REGEX;

  protected readonly slug = signal<string>('');
  protected readonly title = signal<string>('');
  protected readonly description = signal<string>('');
  protected readonly repoUrl = signal<string>('');
  protected readonly notes = signal<string>('');
  /** Raw comma-separated text; parsed into `string[]` on submit. */
  protected readonly tagsText = signal<string>('');
  /** `''` = not tied to a cohort (sent as `null`). */
  protected readonly cohortKey = signal<string>('');

  protected readonly saving = signal<boolean>(false);
  protected readonly errorMessage = signal<string | null>(null);

  /** Cohort options, fetched once on first open. */
  protected readonly groups = signal<MemberGroup[]>([]);
  protected readonly groupsLoading = signal<boolean>(false);
  protected readonly groupsError = signal<string | null>(null);
  private groupsRequested = false;

  protected readonly isEdit = computed<boolean>(() => this.pack() !== null);

  protected readonly slugValid = computed<boolean>(
    () => this.isEdit() || this.slugRegex.test(this.slug().trim()),
  );

  protected readonly repoUrlValid = computed<boolean>(() =>
    this.repoUrlRegex.test(this.repoUrl().trim()),
  );

  /** Parsed, de-duplicated, non-empty tags. */
  protected readonly parsedTags = computed<string[]>(() => [
    ...new Set(
      this.tagsText()
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0),
    ),
  ]);

  protected readonly canSubmit = computed<boolean>(() => {
    if (this.saving()) return false;
    if (this.title().trim().length === 0) return false;
    if (this.description().trim().length === 0) return false;
    return this.slugValid() && this.repoUrlValid();
  });

  public constructor() {
    effect(() => {
      if (!this.open()) return;
      const p = this.pack();
      this.slug.set(p?.slug ?? '');
      this.title.set(p?.title ?? '');
      this.description.set(p?.description ?? '');
      this.repoUrl.set(p?.repoUrl ?? '');
      this.notes.set(p?.notes ?? '');
      this.tagsText.set(p?.tags.join(', ') ?? '');
      this.cohortKey.set(p?.cohortKey ?? '');
      this.saving.set(false);
      this.errorMessage.set(null);
      this.loadGroupsOnce();
    });
  }

  /**
   * Fetches the cohort list the first time the modal opens and caches it. The
   * list is small and changes rarely; refetching per open (or per keystroke)
   * would be pure noise on `/admin/groups`.
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
        // Non-fatal: a pack can be saved without a cohort label, so the form
        // stays usable. Allow a retry on the next open.
        this.groupsRequested = false;
        this.groupsError.set(
          'Could not load cohorts. You can still save without a cohort label.',
        );
      },
    });
  }

  protected onSlugInput(event: Event): void {
    this.slug.set((event.target as HTMLInputElement | null)?.value ?? '');
  }

  protected onTitleInput(event: Event): void {
    this.title.set((event.target as HTMLInputElement | null)?.value ?? '');
  }

  protected onDescriptionInput(event: Event): void {
    this.description.set(
      (event.target as HTMLTextAreaElement | null)?.value ?? '',
    );
  }

  protected onRepoUrlInput(event: Event): void {
    this.repoUrl.set((event.target as HTMLInputElement | null)?.value ?? '');
  }

  protected onNotesInput(event: Event): void {
    this.notes.set((event.target as HTMLTextAreaElement | null)?.value ?? '');
  }

  protected onTagsInput(event: Event): void {
    this.tagsText.set((event.target as HTMLInputElement | null)?.value ?? '');
  }

  protected onCohortChange(event: Event): void {
    this.cohortKey.set((event.target as HTMLSelectElement | null)?.value ?? '');
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

    const notes = this.notes().trim();
    const cohortKey = this.cohortKey().trim();
    const existing = this.pack();

    const request$ = existing
      ? this.buildersApi.updatePack(existing.id, {
          title: this.title().trim(),
          description: this.description().trim(),
          repoUrl: this.repoUrl().trim(),
          notes: notes.length > 0 ? notes : null,
          tags: this.parsedTags(),
          cohortKey: cohortKey.length > 0 ? cohortKey : null,
        })
      : this.buildersApi.createPack({
          slug: this.slug().trim(),
          title: this.title().trim(),
          description: this.description().trim(),
          repoUrl: this.repoUrl().trim(),
          notes: notes.length > 0 ? notes : undefined,
          tags: this.parsedTags(),
          cohortKey: cohortKey.length > 0 ? cohortKey : null,
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

  private extractErrorMessage(err: unknown): string {
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      const anyErr = err as {
        error?: { message?: string | string[] };
        message?: string;
      };
      const msg = anyErr.error?.message ?? anyErr.message;
      if (Array.isArray(msg)) return msg.join(', ');
      if (typeof msg === 'string') return msg;
    }
    return 'Failed to save the pack. Please try again.';
  }
}
