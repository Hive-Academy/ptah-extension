import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
} from '@angular/core';
import { ProvidersSettingsStateService } from '@ptah-extension/core';
import { SubagentCacheTtlSettingComponent } from './subagent-cache-ttl-setting.component';
import { SessionBudgetSettingsComponent } from './session-budget-settings.component';
import { LaneGuardsSettingsComponent } from './lane-guards-settings.component';
import { AdvancedSettingsGroupComponent } from '../advanced/advanced-settings-group.component';

/**
 * Context Management tab (internal tab id `'orchestration'`, kept so the `PendingSettingsTab` and app-state contracts
 * do not change). Opens the shared state itself, because a user can land on this tab first and the subagent cache TTL
 * reads it.
 *
 * Order: the subagent prompt-cache TTL, the session budget, Lane guards, then the advanced groups (context budgets,
 * Codex agents, background query limits; TASK_2026_658) in one viewport-deferred chunk. The CLI matrix and the
 * background model roles moved to the Providers tab (`AgentsRoutingSettingsComponent`), with their deep links.
 *
 * No inline commit panel: the TTL, this tab's only `commit()` writer, reports through the page toast
 * (`SettingsSaveFeedbackService.save`).
 */
@Component({
  selector: 'ptah-orchestration-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SubagentCacheTtlSettingComponent,
    SessionBudgetSettingsComponent,
    LaneGuardsSettingsComponent,
    AdvancedSettingsGroupComponent,
  ],
  template: `
    <!-- Same box and rhythm as the Providers page: the Settings shell sets the width, centring and side padding. -->
    <div class="flex flex-col gap-8 py-3 font-sans text-sm text-base-content">
      <!-- Subagent prompt-cache TTL (TASK_2026_597 N1): its own chunk, loaded when scrolled into view. -->
      @defer (on viewport) {
        <ptah-subagent-cache-ttl-setting />
      } @placeholder {
        <div
          class="min-h-[2.75rem] border-b border-base-content/10"
          aria-busy="true"
          data-testid="subagent-cache-ttl-placeholder"
        ></div>
      }

      <!-- Session budget (TASK_2026_597 N7): its own chunk, loaded when scrolled into view, behind a one-row
           placeholder. -->
      @defer (on viewport) {
        <ptah-session-budget-settings />
      } @placeholder {
        <div
          class="min-h-[2.75rem] border-b border-base-content/10"
          data-testid="session-budget-placeholder"
        ></div>
      }

      <!-- Independent of the tall budget form: guards are small and should always be available. -->
      <ptah-lane-guards-settings />

      <!-- Advanced orchestration values (TASK_2026_658): one chunk, loaded when scrolled into view, below the session
           budget and the always-available Lane guards; the placeholder is one row. -->
      @defer (on viewport) {
        <ptah-advanced-settings-group groupId="context-budgets" />
        <ptah-advanced-settings-group groupId="codex-agents" />
        <ptah-advanced-settings-group groupId="background-queries" />
      } @placeholder {
        <div
          class="min-h-[2.75rem] border-b border-base-content/10"
          data-testid="orchestration-advanced-placeholder"
        ></div>
      }
    </div>
  `,
})
export class OrchestrationSettingsComponent implements OnInit {
  private readonly state = inject(ProvidersSettingsStateService);

  ngOnInit(): void {
    void this.state.open();
  }
}
