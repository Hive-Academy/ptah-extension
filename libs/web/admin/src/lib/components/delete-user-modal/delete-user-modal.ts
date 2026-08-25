import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
  computed,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AdminApiService,
  DeletionPreviewResponse,
} from '../../services/admin-api.service';

@Component({
  selector: 'app-delete-user-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './delete-user-modal.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeleteUserModalComponent {
  public readonly userId = input.required<string>();
  public readonly userEmail = input.required<string>();
  public deleted = output<void>();

  private adminApi = inject(AdminApiService);

  public readonly preview = signal<DeletionPreviewResponse | null>(null);
  public readonly typedEmail = signal('');
  public readonly acknowledgePaid = signal(false);
  public readonly isLoading = signal(false);
  public readonly error = signal<string | null>(null);
  public readonly isOpen = signal(false);

  /** Which stepper page is showing: 1 = Review Impact, 2 = Confirm. */
  public readonly step = signal<1 | 2>(1);

  public readonly canSubmit = computed(
    () =>
      this.typedEmail() === this.userEmail() &&
      (!this.preview()?.hasActivePaidSubscription || this.acknowledgePaid()) &&
      !this.preview()?.isAdminSelf &&
      !this.isLoading(),
  );

  /**
   * Gate for advancing to step 2. The preview must have loaded, the user must
   * not be an admin-self (blocked), and any paid-subscription acknowledgment
   * must be given on step 1 before the confirm step is reachable.
   */
  public readonly canProceed = computed(
    () =>
      this.preview() !== null &&
      !this.preview()?.isAdminSelf &&
      (!this.preview()?.hasActivePaidSubscription || this.acknowledgePaid()),
  );

  open() {
    this.isOpen.set(true);
    this.step.set(1);
    this.error.set(null);
    this.typedEmail.set('');
    this.acknowledgePaid.set(false);
    this.preview.set(null);
    this.adminApi.getUserDeletionPreview(this.userId()).subscribe({
      next: (p) => this.preview.set(p),
      error: () => this.error.set('Failed to load deletion preview'),
    });
  }

  close() {
    this.isOpen.set(false);
  }

  public goToStep2() {
    if (this.canProceed()) this.step.set(2);
  }

  public backToStep1() {
    this.step.set(1);
  }

  confirm() {
    if (!this.canSubmit()) return;
    this.isLoading.set(true);
    this.error.set(null);
    this.adminApi
      .deleteUser(this.userId(), {
        confirmEmail: this.typedEmail(),
        acknowledgePaidSubscription: this.acknowledgePaid(),
      })
      .subscribe({
        next: () => {
          this.isOpen.set(false);
          this.deleted.emit();
        },
        error: (err: any) => {
          const code = err?.error?.code;
          this.error.set(
            code === 'ACTIVE_PAID_SUBSCRIPTION'
              ? 'This user has an active paid subscription. Check the box to confirm override.'
              : 'Deletion failed. Please try again.',
          );
          this.isLoading.set(false);
        },
      });
  }
}
