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
  IssueComplimentaryLicenseResponse,
} from '../../../../services/admin-api.service';

@Component({
  selector: 'app-issue-comp-license-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './issue-comp-license-modal.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IssueCompLicenseModalComponent {
  public readonly userId = input.required<string>();
  public readonly userEmail = input.required<string>();
  public issued = output<IssueComplimentaryLicenseResponse>();

  private adminApi = inject(AdminApiService);

  public readonly isOpen = signal(false);
  public readonly isLoading = signal(false);
  public readonly error = signal<string | null>(null);
  public readonly result = signal<IssueComplimentaryLicenseResponse | null>(
    null,
  );

  public readonly durationPreset = signal<
    '30d' | '1y' | '5y' | 'custom' | 'never'
  >('30d');
  public readonly customExpiresAt = signal('');
  public readonly reason = signal('');
  public readonly sendEmail = signal(true);
  public readonly stackOnTopOfPaid = signal(false);

  public readonly canSubmit = computed(
    () =>
      this.reason().length >= 1 &&
      this.reason().length <= 500 &&
      (this.durationPreset() !== 'custom' || !!this.customExpiresAt()) &&
      !this.isLoading(),
  );

  public open() {
    this.isOpen.set(true);
    this.error.set(null);
    this.result.set(null);
    this.durationPreset.set('30d');
    this.customExpiresAt.set('');
    this.reason.set('');
    this.sendEmail.set(true);
    this.stackOnTopOfPaid.set(false);
    this.isLoading.set(false);
  }

  public close() {
    this.isOpen.set(false);
  }

  public confirm() {
    if (!this.canSubmit()) return;
    this.isLoading.set(true);
    this.error.set(null);

    const body = {
      userId: this.userId(),
      durationPreset: this.durationPreset(),
      customExpiresAt:
        this.durationPreset() === 'custom'
          ? this.toApiValue(this.customExpiresAt())
          : undefined,
      plan: 'pro' as const,
      reason: this.reason(),
      sendEmail: this.sendEmail(),
      stackOnTopOfPaid: this.stackOnTopOfPaid(),
    };

    this.adminApi.issueComplimentaryLicense(body).subscribe({
      next: (res) => {
        this.isLoading.set(false);
        this.result.set(res);
      },
      error: (err: unknown) => {
        this.isLoading.set(false);
        const errorBody = (err as any)?.error;
        const code = errorBody?.code;
        const existing = errorBody?.existing;

        if (code === 'EXISTING_ACTIVE_LICENSE' && existing) {
          this.error.set(
            `User already has an active ${existing.plan} license (${
              existing.source
            }) expiring ${
              existing.expiresAt || 'never'
            }. Tick "Stack on top of paid" to proceed.`,
          );
        } else if (code === 'INVALID_CUSTOM_DATE') {
          this.error.set('The custom expiration date must be in the future.');
        } else if (code === 'REASON_REQUIRED') {
          this.error.set('A reason is required.');
        } else {
          this.error.set(
            errorBody?.message || 'Failed to issue license. Please try again.',
          );
        }
      },
    });
  }

  public done() {
    const res = this.result();
    if (res) {
      this.issued.emit(res);
    }
    this.close();
  }

  public copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
  }

  private toApiValue(value: string): string {
    if (!value.trim()) return '';
    const d = new Date(value);
    return isNaN(d.getTime()) ? value : d.toISOString();
  }
}
