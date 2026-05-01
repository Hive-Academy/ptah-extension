import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
  signal,
  OnInit,
} from '@angular/core';
import {
  AdminApiService,
  MarketingSegmentsResponse,
  MarketingSegmentKey,
} from '../../../../services/admin-api.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'ptah-segment-picker',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './segment-picker.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SegmentPicker implements OnInit {
  private readonly adminApi = inject(AdminApiService);

  public readonly value = input<MarketingSegmentKey | null>(null);
  public readonly valueChange = output<MarketingSegmentKey>();

  protected readonly segments = signal<MarketingSegmentsResponse | null>(null);
  protected readonly isLoading = signal(false);
  protected readonly error = signal<string | null>(null);

  public ngOnInit(): void {
    this.fetch();
  }

  protected fetch(): void {
    this.isLoading.set(true);
    this.error.set(null);
    this.adminApi.getMarketingSegments().subscribe({
      next: (res) => {
        this.segments.set(res);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message || 'Failed to load segments');
        this.isLoading.set(false);
      },
    });
  }

  protected select(key: string): void {
    this.valueChange.emit(key as MarketingSegmentKey);
  }

  protected getSegmentLabel(key: string): string {
    switch (key) {
      case 'all':
        return 'All Users';
      case 'proActive':
        return 'Pro Active';
      case 'communityActive':
        return 'Community Active';
      case 'trialing':
        return 'Trialing';
      case 'subscriptionPastDue':
        return 'Past Due';
      default:
        return key;
    }
  }
}
