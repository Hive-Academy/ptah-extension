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
  AdminBuildersApiService,
  Pack,
} from '../../../../../../services/admin-builders-api.service';

/**
 * DeletePackModal — typed-slug confirmation before removing a pack registry
 * row, mirroring the typed-email pattern of `delete-user-modal`.
 *
 * Worth being explicit about what this destroys and what it does not: deleting
 * the row forgets Ptah's record of which repo went to which cohort. The GitHub
 * repository, and every collaborator's access to it, is completely unaffected —
 * Ptah controls neither. The confirmation exists because the record itself is
 * the only trace of a manual distribution step, not because access is at stake.
 */
@Component({
  selector: 'ptah-admin-delete-pack-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './delete-pack-modal.html',
})
export class DeletePackModal {
  private readonly api = inject(AdminBuildersApiService);

  /** Show/hide the modal. Parent owns the signal. */
  public readonly open = input<boolean>(false);

  /** The pack being deleted. `null` renders nothing. */
  public readonly pack = input<Pack | null>(null);

  /** Emitted when the user dismisses without deleting. */
  public readonly closeModal = output<void>();

  /** Emitted after a successful delete. */
  public readonly deleted = output<void>();

  protected readonly typedSlug = signal<string>('');
  protected readonly deleting = signal<boolean>(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly canSubmit = computed<boolean>(() => {
    if (this.deleting()) return false;
    const target = this.pack();
    if (!target) return false;
    return this.typedSlug().trim() === target.slug;
  });

  public constructor() {
    effect(() => {
      if (!this.open()) return;
      // Re-read `pack` so reopening on a different row resets cleanly.
      this.pack();
      this.typedSlug.set('');
      this.deleting.set(false);
      this.errorMessage.set(null);
    });
  }

  protected onSlugInput(event: Event): void {
    this.typedSlug.set((event.target as HTMLInputElement | null)?.value ?? '');
  }

  protected onCloseClick(): void {
    if (this.deleting()) return;
    this.closeModal.emit();
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    const target = this.pack();
    if (!this.canSubmit() || !target) return;

    this.deleting.set(true);
    this.errorMessage.set(null);

    this.api.deletePack(target.id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.deleted.emit();
      },
      error: (err: unknown) => {
        this.deleting.set(false);
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
    return 'Failed to delete the pack. Please try again.';
  }
}
