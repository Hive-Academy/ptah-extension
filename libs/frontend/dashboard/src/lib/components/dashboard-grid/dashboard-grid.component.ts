import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LucideAngularModule, ArrowLeft } from 'lucide-angular';
import { AppStateManager } from '@ptah-extension/core';
import { AnalyticsCardComponent } from '../analytics-card/analytics-card.component';
import { BuildersCardComponent } from '../builders-card/builders-card.component';
import { ProviderAccountCardComponent } from '../provider-account-card/provider-account-card.component';
import { SkillSelectionCardComponent } from '../skill-selection-card/skill-selection-card.component';

/**
 * DashboardGridComponent
 *
 * Top-level dashboard surface. Page chrome (header, "Back" navigation) lives
 * here; content is the session analytics card (cost, tokens, sessions). The
 * Thoth pillar stat tiles now live on the Thoth page (`ThothShellComponent`).
 *
 * Provider limits, skill selection, analytics and builders follow the header.
 */
@Component({
  selector: 'ptah-dashboard-grid',
  standalone: true,
  imports: [
    LucideAngularModule,
    ProviderAccountCardComponent,
    SkillSelectionCardComponent,
    AnalyticsCardComponent,
    BuildersCardComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard-grid.component.html',
  // This surface owns its own scrolling. Its root is `min-h-full`, so its
  // content is designed to exceed the viewport and something must scroll it.
  // The host is that something: `min-h-full` grows rather than scrolling, so
  // the scroll container has to be a height-bounded ancestor, not the root div.
  //
  // It lives here and not on the shared router-outlet wrapper in
  // `app-shell.component.html` on purpose. Before TASK_2026_524 batch 1 each
  // surface carried its own box and only this one added `overflow-y-auto`;
  // batch 1 collapsed the nine boxes into one and handed that scroll container
  // to all nine. Keeping it here means a surface gets a scrollbar only if it
  // asks for one.
  host: { class: 'block h-full overflow-y-auto' },
})
export class DashboardGridComponent {
  private readonly appState = inject(AppStateManager);
  readonly ArrowLeftIcon = ArrowLeft;

  navigateBack(): void {
    this.appState.setCurrentView('chat');
  }
}
