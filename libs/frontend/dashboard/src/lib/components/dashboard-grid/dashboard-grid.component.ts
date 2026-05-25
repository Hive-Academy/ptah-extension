import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LucideAngularModule, ArrowLeft } from 'lucide-angular';
import { AppStateManager } from '@ptah-extension/core';
import { AnalyticsCardComponent } from '../analytics-card/analytics-card.component';
import { ThothStatusCardComponent } from '../thoth-status-card/thoth-status-card.component';

/**
 * DashboardGridComponent
 *
 * Top-level dashboard surface. Page chrome (header, "Back" navigation) lives
 * here; content is stacked as two rows:
 *
 * - `<ptah-thoth-status-card />` — Thoth pillar stat tiles (memory, skills,
 *   cron, gateway) with click-through to the matching Thoth tab.
 * - `<ptah-analytics-card />` — session analytics (cost, tokens, sessions).
 */
@Component({
  selector: 'ptah-dashboard-grid',
  standalone: true,
  imports: [
    LucideAngularModule,
    AnalyticsCardComponent,
    ThothStatusCardComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard-grid.component.html',
})
export class DashboardGridComponent {
  private readonly appState = inject(AppStateManager);

  readonly ArrowLeftIcon = ArrowLeft;

  navigateBack(): void {
    this.appState.setCurrentView('chat');
  }
}
