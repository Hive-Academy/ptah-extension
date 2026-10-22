import { ChangeDetectionStrategy, Component } from '@angular/core';
import { UsageDashboardComponent } from '../usage-dashboard/usage-dashboard.component';

@Component({
  selector: 'ptah-analytics-card',
  standalone: true,
  imports: [UsageDashboardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './analytics-card.component.html',
})
export class AnalyticsCardComponent {}
