import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  LucideAngularModule,
  ArrowLeft,
  Scale,
  ChevronRight,
} from 'lucide-angular';
import { AppStateManager } from '@ptah-extension/core';
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
  readonly ScaleIcon = Scale;
  readonly ChevronRightIcon = ChevronRight;

  navigateBack(): void {
    this.appState.setCurrentView('chat');
  }

  conveneTribunal(): void {
    this.appState.setCurrentView('tribunal');
  }
}
