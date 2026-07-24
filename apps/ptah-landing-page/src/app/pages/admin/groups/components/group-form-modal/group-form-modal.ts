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
  MEMBER_GROUP_KEY_REGEX,
  MemberGroup,
} from '../../../../../services/admin-api.service';

/**
 * GroupFormModal — DaisyUI dialog for creating or editing a member cohort
 * (`MemberGroup`).
 *
 * Dual mode driven by the `group` input: `null` → create (POST
 * /api/v1/admin/groups), non-null → edit (PATCH .../groups/:id). `key` is
 * only editable in create mode — the backend does not accept it on PATCH.
 */
@Component({
  selector: 'ptah-admin-group-form-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './group-form-modal.html',
})
export class GroupFormModal {
  private readonly api = inject(AdminApiService);

  /** Show/hide the modal. Parent owns the signal. */
  public readonly open = input<boolean>(false);

  /** `null` = create mode. Non-null = edit mode, pre-fills the form. */
  public readonly group = input<MemberGroup | null>(null);

  /** Emitted when the user requests the modal to close without saving. */
  public readonly closeModal = output<void>();

  /** Emitted after a successful create/update with the resulting group. */
  public readonly saved = output<MemberGroup>();

  protected readonly keyRegex = MEMBER_GROUP_KEY_REGEX;

  protected readonly key = signal<string>('');
  protected readonly name = signal<string>('');
  protected readonly description = signal<string>('');
  protected readonly discourseGroup = signal<string>('');
  protected readonly isDefault = signal<boolean>(false);

  protected readonly saving = signal<boolean>(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly isEdit = computed<boolean>(() => this.group() !== null);

  protected readonly keyValid = computed<boolean>(
    () => this.isEdit() || this.keyRegex.test(this.key().trim()),
  );

  protected readonly canSubmit = computed<boolean>(() => {
    if (this.saving()) return false;
    if (this.name().trim().length === 0) return false;
    return this.keyValid();
  });

  public constructor() {
    effect(() => {
      if (!this.open()) return;
      const g = this.group();
      this.key.set(g?.key ?? '');
      this.name.set(g?.name ?? '');
      this.description.set(g?.description ?? '');
      this.discourseGroup.set(g?.discourseGroup ?? '');
      this.isDefault.set(g?.isDefault ?? false);
      this.saving.set(false);
      this.errorMessage.set(null);
    });
  }

  protected onKeyInput(event: Event): void {
    this.key.set((event.target as HTMLInputElement | null)?.value ?? '');
  }

  protected onNameInput(event: Event): void {
    this.name.set((event.target as HTMLInputElement | null)?.value ?? '');
  }

  protected onDescriptionInput(event: Event): void {
    this.description.set(
      (event.target as HTMLTextAreaElement | null)?.value ?? '',
    );
  }

  protected onDiscourseGroupInput(event: Event): void {
    this.discourseGroup.set(
      (event.target as HTMLInputElement | null)?.value ?? '',
    );
  }

  protected onIsDefaultChange(event: Event): void {
    this.isDefault.set(
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

    const description = this.description().trim();
    const discourseGroup = this.discourseGroup().trim();

    const existing = this.group();
    const request$ = existing
      ? this.api.updateGroup(existing.id, {
          name: this.name().trim(),
          description: description.length > 0 ? description : null,
          discourseGroup: discourseGroup.length > 0 ? discourseGroup : null,
          isDefault: this.isDefault(),
        })
      : this.api.createGroup({
          key: this.key().trim(),
          name: this.name().trim(),
          description: description.length > 0 ? description : undefined,
          discourseGroup:
            discourseGroup.length > 0 ? discourseGroup : undefined,
          isDefault: this.isDefault(),
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
      const anyErr = err as { error?: { message?: string }; message?: string };
      const msg = anyErr.error?.message ?? anyErr.message;
      if (Array.isArray(msg)) return msg.join(', ');
      if (typeof msg === 'string') return msg;
    }
    return 'Failed to save the group. Please try again.';
  }
}
