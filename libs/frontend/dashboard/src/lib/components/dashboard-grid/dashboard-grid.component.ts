import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LucideAngularModule, ArrowLeft } from 'lucide-angular';
import { AppStateManager } from '@ptah-extension/core';
import { AnalyticsCardComponent } from '../analytics-card/analytics-card.component';
import { HermesStatusCardComponent } from '../hermes-status-card/hermes-status-card.component';

/**
 * DashboardGridComponent
 *
 * Top-level dashboard surface that renders a responsive grid of cards.
 * Replaces the previous full-screen analytics view component;
 * page chrome (header, padding, "Back" navigation) lives here, while
 * individual cards (analytics, Hermes status) live as standalone components.
 *
 * Currently hosts two cards:
 *
 * - `<ptah-analytics-card />` — session analytics (cost, tokens, sessions)
 * - `<ptah-hermes-status-card />` — Hermes pillar summary with click-through
 *   to the corresponding tab inside the Hermes shell
 */
@Component({
  selector: 'ptah-dashboard-grid',
  standalone: true,
  imports: [
    LucideAngularModule,
    AnalyticsCardComponent,
    HermesStatusCardComponent,
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
