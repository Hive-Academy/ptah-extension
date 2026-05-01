import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  computed,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  AdminApiService,
  MarketingSegmentKey,
  MarketingSegmentsResponse,
} from '../../../../services/admin-api.service';
import { SegmentPicker } from '../../components/segment-picker/segment-picker';
import { TemplatePicker } from '../../components/template-picker/template-picker';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'ptah-marketing-compose',
  standalone: true,
  imports: [CommonModule, FormsModule, SegmentPicker, TemplatePicker],
  templateUrl: './marketing-compose.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarketingCompose {
  private readonly adminApi = inject(AdminApiService);
  protected readonly router = inject(Router);

  protected readonly name = signal('');
  protected readonly templateId = signal<string | null>(null);
  protected readonly subject = signal('');
  protected readonly htmlBody = signal('');
  protected readonly segment = signal<MarketingSegmentKey | null>(null);
  protected readonly useExplicitUserIds = signal(false);
  protected readonly userIdsRaw = signal('');

  protected readonly isLoading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly segments = toSignal<MarketingSegmentsResponse | null>(
    this.adminApi.getMarketingSegments(),
    { initialValue: null },
  );

  protected readonly parsedUserIds = computed(() => {
    return this.userIdsRaw()
      .split(/[,\n\s]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  });

  protected readonly canSubmit = computed(() => {
    const hasName = this.name().trim().length > 0;
    const hasContent =
      this.templateId() !== null ||
      (this.subject().trim().length > 0 && this.htmlBody().trim().length > 0);
    const hasRecipients =
      this.segment() !== null ||
      (this.useExplicitUserIds() && this.parsedUserIds().length > 0);
    return hasName && hasContent && hasRecipients && !this.isLoading();
  });

  protected readonly recipientCountPreview = computed(() => {
    if (this.useExplicitUserIds()) {
      return this.parsedUserIds().length;
    }
    const seg = this.segment();
    const segs = this.segments();
    if (seg && segs) {
      return segs[seg].optedIn;
    }
    return 0;
  });

  protected readonly totalRecipientPreview = computed(() => {
    if (this.useExplicitUserIds()) {
      return this.parsedUserIds().length;
    }
    const seg = this.segment();
    const segs = this.segments();
    if (seg && segs) {
      return segs[seg].total;
    }
    return 0;
  });

  public submit(): void {
    if (!this.canSubmit()) return;

    this.isLoading.set(true);
    this.error.set(null);

    const payload = {
      name: this.name(),
      templateId: this.templateId() ?? undefined,
      subject: this.templateId() ? undefined : this.subject(),
      htmlBody: this.templateId() ? undefined : this.htmlBody(),
      segment: this.useExplicitUserIds()
        ? undefined
        : (this.segment() ?? undefined),
      userIds: this.useExplicitUserIds() ? this.parsedUserIds() : undefined,
    };

    this.adminApi.sendCampaign(payload).subscribe({
      next: () => {
        this.isLoading.set(false);
        this.router.navigate(['/admin/marketing-campaigns']);
      },
      error: (err) => {
        this.isLoading.set(false);
        this.error.set(err.error?.message || 'Failed to send campaign');
      },
    });
  }
}
