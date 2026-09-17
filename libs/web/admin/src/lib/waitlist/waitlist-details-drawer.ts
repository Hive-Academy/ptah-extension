import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, RefreshCw } from 'lucide-angular';
import { Subscription } from 'rxjs';

import type { BadgeVariant } from '@ptah-web/panel-ui';
import { DetailDrawer, StatusBadge } from '@ptah-web/panel-ui';
import { AdminApiService } from '../services/admin-api.service';
import { WaitlistDetailsResponse } from './waitlist-query-state';

@Component({
  selector: 'ptah-admin-waitlist-details-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    RouterLink,
    LucideAngularModule,
    DetailDrawer,
    StatusBadge,
  ],
  templateUrl: './waitlist-details-drawer.html',
})
export class WaitlistDetailsDrawer {
  private readonly api = inject(AdminApiService);
  private readonly destroyRef = inject(DestroyRef);
  private fetchSub?: Subscription;

  public readonly open = input<boolean>(false);
  public readonly entryId = input<string | null>(null);

  public readonly closed = output<void>();
  public readonly approve = output<string>();

  protected readonly RefreshIcon = RefreshCw;

  protected readonly loading = signal<boolean>(false);
  protected readonly error = signal<'not_found' | 'unavailable' | null>(null);
  protected readonly data = signal<WaitlistDetailsResponse | null>(null);

  protected readonly title = computed<string>(() => {
    const entry = this.data()?.entry;
    return entry ? `Waitlist: ${entry.email}` : 'Waitlist Details';
  });

  protected readonly stageVariant = computed<BadgeVariant>(() => {
    switch (this.data()?.entry.stage) {
      case 'converted':
        return 'success';
      case 'approved':
        return 'info';
      case 'invited':
        return 'neutral';
      case 'new':
      default:
        return 'ghost';
    }
  });

  public constructor() {
    effect(() => {
      const isOpen = this.open();
      const id = this.entryId();

      if (isOpen && id) {
        this.fetchDetails(id);
      } else if (!isOpen) {
        this.fetchSub?.unsubscribe();
        this.data.set(null);
        this.error.set(null);
        this.loading.set(false);
      }
    });

    this.destroyRef.onDestroy(() => {
      this.fetchSub?.unsubscribe();
    });
  }

  public retry(): void {
    const id = this.entryId();
    if (id) {
      this.fetchDetails(id);
    }
  }

  protected onClose(): void {
    this.closed.emit();
  }

  protected onApprove(): void {
    const entry = this.data()?.entry;
    if (entry && entry.approvalEligible) {
      this.approve.emit(entry.id);
    }
  }

  private fetchDetails(id: string): void {
    this.fetchSub?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);

    this.fetchSub = this.api.getWaitlistDetails(id).subscribe({
      next: (res) => {
        if (id !== this.entryId() || !this.open()) {
          return;
        }
        this.data.set(res);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        if (id !== this.entryId() || !this.open()) {
          return;
        }
        this.loading.set(false);
        if (this.isNotFoundError(err)) {
          this.error.set('not_found');
        } else {
          this.error.set('unavailable');
        }
      },
    });
  }

  private isNotFoundError(err: unknown): boolean {
    if (err && typeof err === 'object' && 'status' in err) {
      return (err as { status: number }).status === 404;
    }
    return false;
  }
}
