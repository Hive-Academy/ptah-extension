import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LucideAngularModule, ArrowLeft } from 'lucide-angular';
import { AppStateManager } from '@ptah-extension/core';
import { AnalyticsCardComponent } from '../analytics-card/analytics-card.component';

/**
 * DashboardGridComponent
 *
 * Top-level dashboard surface. Page chrome (header, "Back" navigation) lives
 * here; content is the session analytics card (cost, tokens, sessions). The
 * Thoth pillar stat tiles now live on the Thoth page (`ThothShellComponent`).
 */
@Component({
  selector: 'ptah-dashboard-grid',
  standalone: true,
  imports: [LucideAngularModule, AnalyticsCardComponent],
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
