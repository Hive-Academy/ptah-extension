import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LucideAngularModule, ArrowLeft } from 'lucide-angular';
import { AppStateManager } from '@ptah-extension/core';
import { AnalyticsCardComponent } from '../analytics-card/analytics-card.component';
import { ThothStatusCardComponent } from '../thoth-status-card/thoth-status-card.component';

/**
 * DashboardGridComponent
 *
 * Top-level dashboard surface that renders a responsive grid of cards.
 * Replaces the previous full-screen analytics view component;
 * page chrome (header, padding, "Back" navigation) lives here, while
 * individual cards (analytics, Thoth status) live as standalone components.
 *
 * Currently hosts two cards:
 *
 * - `<ptah-analytics-card />` — session analytics (cost, tokens, sessions)
 * - `<ptah-thoth-status-card />` — Thoth pillar summary with click-through
 *   to the corresponding tab inside the Thoth shell
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
