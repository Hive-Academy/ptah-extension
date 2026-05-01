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
import { CommonModule } from '@angular/common';

import {
  AdminApiService,
  AdminBulkEmailResponse,
  MarketingSegmentKey,
} from '../../../../services/admin-api.service';
import { SegmentPicker } from '../segment-picker/segment-picker';
import { TemplatePicker } from '../template-picker/template-picker';

/**
 * BulkEmailModal — DaisyUI dialog for sending a marketing email to selected
 * users or a targeted segment.
 */
@Component({
  selector: 'ptah-admin-bulk-email-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, SegmentPicker, TemplatePicker],
  templateUrl: './bulk-email-modal.html',
})
export class BulkEmailModal {
  private readonly api = inject(AdminApiService);

  /** Show/hide the modal. Parent owns the signal. */
  public readonly open = input<boolean>(false);

  /** Explicit recipients. Required for explicit mode. */
  public readonly userIds = input.required<readonly string[]>();

  /** Emitted when the user requests the modal to close (backdrop/Close). */
  public readonly closeModal = output<void>();

  /** Emitted after a successful bulk-email call with the server response. */
  public readonly submitted = output<AdminBulkEmailResponse>();

  // --- Form state ----------------------------------------------------------

  protected readonly mode = signal<'explicit-users' | 'segment'>(
    'explicit-users',
  );
  protected readonly segment = signal<MarketingSegmentKey | null>(null);
  protected readonly templateId = signal<string | null>(null);
  protected readonly subject = signal<string>('');
  protected readonly html = signal<string>('');

  protected readonly sending = signal<boolean>(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly success = signal<boolean>(false);

  protected readonly recipientCount = computed<number>(() => {
    if (this.mode() === 'explicit-users') return this.userIds().length;
    return 0; // Segment count shown in picker
  });

  protected readonly canSubmit = computed<boolean>(() => {
    if (this.sending() || this.success()) return false;

    const hasRecipients =
      this.mode() === 'segment'
        ? this.segment() !== null
        : this.userIds().length > 0;

    if (!hasRecipients) return false;

    // If template selected, we don't need subject/html
    if (this.templateId()) return true;

    const subject = this.subject().trim();
    const html = this.html().trim();
    return (
      subject.length > 0 &&
      html.length > 0 &&
      subject.length <= 200 &&
      html.length <= 50000
    );
  });

  public constructor() {
    effect(() => {
      if (this.open()) {
        this.mode.set('explicit-users');
        this.segment.set(null);
        this.templateId.set(null);
        this.subject.set('');
        this.html.set('');
        this.errorMessage.set(null);
        this.success.set(false);
        this.sending.set(false);
      }
    });
  }

  // --- Event handlers ------------------------------------------------------

  protected onSubjectInput(event: Event): void {
    const t = event.target as HTMLInputElement | null;
    this.subject.set(t?.value ?? '');
  }

  protected onHtmlInput(event: Event): void {
    const t = event.target as HTMLTextAreaElement | null;
    this.html.set(t?.value ?? '');
  }

  protected onCloseClick(): void {
    if (this.sending()) return;
    this.closeModal.emit();
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    if (!this.canSubmit()) return;

    this.sending.set(true);
    this.errorMessage.set(null);

    const payload = {
      name: `Bulk Email: ${this.subject().substring(0, 80) || 'Untitled'}`,
      templateId: this.templateId() ?? undefined,
      subject: this.templateId() ? undefined : this.subject().trim(),
      htmlBody: this.templateId() ? undefined : this.html().trim(),
      segment:
        this.mode() === 'segment' ? (this.segment() ?? undefined) : undefined,
      userIds:
        this.mode() === 'explicit-users'
          ? Array.from(this.userIds())
          : undefined,
    };

    this.api.sendCampaign(payload).subscribe({
      next: (res) => {
        this.sending.set(false);
        this.success.set(true);
        // Map to legacy response shape for the toast in AdminList
        this.submitted.emit({
          sent: res.recipientCount,
          failed: [],
        });
      },
      error: (err: unknown) => {
        this.sending.set(false);
        this.errorMessage.set(this.extractErrorMessage(err));
      },
    });
  }

  private extractErrorMessage(err: unknown): string {
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      const anyErr = err as { error?: { message?: string }; message?: string };
      return (
        anyErr.error?.message ??
        anyErr.message ??
        'Failed to send bulk email. Please try again.'
      );
    }
    return 'Failed to send bulk email. Please try again.';
  }
}
