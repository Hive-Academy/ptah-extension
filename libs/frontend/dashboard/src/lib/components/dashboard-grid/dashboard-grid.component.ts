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
import { BuildersCardComponent } from '../builders-card/builders-card.component';
import { HarnessCardComponent } from '../harness-card/harness-card.component';
import { SkillSelectionCardComponent } from '../skill-selection-card/skill-selection-card.component';

/**
 * DashboardGridComponent
 *
 * Top-level dashboard surface. Page chrome (header, "Back" navigation) lives
 * here; content is the session analytics card (cost, tokens, sessions). The
 * Thoth pillar stat tiles now live on the Thoth page (`ThothShellComponent`).
 *
 * `<ptah-skill-selection-card />` sits directly under it and is likewise silent
 * unless this workspace has never been asked which skills it wants. It is
 * SECOND rather than first deliberately: a shortfall in a harness the user
 * already configured outranks a question about one they have not, and only the
 * card above reports anything wrong.
 *
 * `<ptah-harness-card />` sits FIRST and renders nothing at all unless the
 * harness is actually blocked. It is placed above the analytics card because
 * it is the only card here that reports a problem, and it is the reason this
 * grid is now the boot-visible home for harness health — the disclosure used
 * to exist only inside the Marketplace Plugins popover.
 */
@Component({
  selector: 'ptah-dashboard-grid',
  standalone: true,
  imports: [
    LucideAngularModule,
    HarnessCardComponent,
    SkillSelectionCardComponent,
    AnalyticsCardComponent,
    BuildersCardComponent,
  ],
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
