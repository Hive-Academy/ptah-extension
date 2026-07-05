import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  LucideAngularModule,
  ArrowLeft,
  Scale,
  ChevronRight,
} from 'lucide-angular';
import {
  AppStateManager,
  WebviewNavigationService,
} from '@ptah-extension/core';
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
  private readonly navigation = inject(WebviewNavigationService);

  readonly ArrowLeftIcon = ArrowLeft;
  readonly ScaleIcon = Scale;
  readonly ChevronRightIcon = ChevronRight;

  navigateBack(): void {
    this.appState.setCurrentView('chat');
  }

  conveneTribunal(): void {
    void this.navigation.navigateToView('tribunal');
  }
}
