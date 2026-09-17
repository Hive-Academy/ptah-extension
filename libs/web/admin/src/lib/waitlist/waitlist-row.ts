import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ArrowRight, KeyRound, LucideAngularModule } from 'lucide-angular';

import type { BadgeVariant } from '@ptah-web/panel-ui';
import { StatusBadge } from '@ptah-web/panel-ui';
import { WaitlistListRow } from './waitlist-query-state';

@Component({
  selector: 'ptah-admin-waitlist-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink, LucideAngularModule, StatusBadge],
  templateUrl: './waitlist-row.html',
})
export class WaitlistRowComponent {
  public readonly row = input.required<WaitlistListRow>();
  public readonly selected = input<boolean>(false);

  public readonly toggleSelect = output<WaitlistListRow>();
  public readonly approve = output<WaitlistListRow>();
  public readonly viewDetails = output<{
    row: WaitlistListRow;
    triggerEl: HTMLElement;
  }>();

  protected readonly KeyRoundIcon = KeyRound;
  protected readonly ArrowRightIcon = ArrowRight;

  protected readonly stageLabel = computed<string>(() => {
    switch (this.row().stage) {
      case 'converted':
        return 'Converted';
      case 'approved':
        return 'Approved';
      case 'invited':
        return 'Invited';
      case 'new':
      default:
        return 'New';
    }
  });

  protected readonly stageVariant = computed<BadgeVariant>(() => {
    switch (this.row().stage) {
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

  protected readonly timestampPrefix = computed<string>(() => {
    switch (this.row().stage) {
      case 'converted':
        return 'Converted';
      case 'approved':
        return 'Approved';
      case 'invited':
        return 'Invited';
      case 'new':
      default:
        return 'Joined';
    }
  });

  protected readonly sourceLabel = computed<string>(
    () => this.row().source || 'Unknown',
  );

  protected onToggleSelect(): void {
    this.toggleSelect.emit(this.row());
  }

  protected onApprove(): void {
    this.approve.emit(this.row());
  }

  protected onViewDetails(triggerEl: HTMLElement): void {
    this.viewDetails.emit({ row: this.row(), triggerEl });
  }
}
