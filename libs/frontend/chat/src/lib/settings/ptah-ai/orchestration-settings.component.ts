import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
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
 * The commit-feedback panel stays: the TTL writes through the shared state's `commit()`.
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
    <div class="flex flex-col gap-4 font-sans text-sm text-base-content">
      <!-- Subagent prompt-cache TTL (TASK_2026_597 N1): its own chunk, loaded when scrolled into view. -->
      @defer (on viewport) {
        <ptah-subagent-cache-ttl-setting />
      } @placeholder {
        <div
          class="min-h-[2.75rem] rounded-xl border border-base-300 bg-base-200/40"
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
          class="min-h-[2.75rem] rounded-xl border border-base-300 bg-base-200/40"
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
          class="min-h-[2.75rem] rounded-xl border border-base-300 bg-base-200/40"
          data-testid="orchestration-advanced-placeholder"
        ></div>
      }

      @if (state.commit().status !== 'idle') {
        <div
          role="status"
          class="rounded-md bg-base-100 p-3 space-y-1 break-words"
          data-testid="providers-commit-feedback"
        >
          @if (saving()) {
            <p>Saving…</p>
          }
          @if (state.commit().saved.length) {
            <p>Saved: {{ state.commit().saved.join(', ') }}.</p>
          }
          @if (state.commit().unsaved.length) {
            <p>Not saved: {{ state.commit().unsaved.join(', ') }}.</p>
          }
          @if (state.commit().unconfirmed.length) {
            <p>
              Save not confirmed: {{ state.commit().unconfirmed.join(', ') }}.
              Check effective values before retrying.
            </p>
          }
          <p>{{ state.commit().message }}</p>
        </div>
      }
    </div>
  `,
})
export class OrchestrationSettingsComponent implements OnInit {
  protected readonly state = inject(ProvidersSettingsStateService);
  protected readonly saving = computed(
    () => this.state.commit().status === 'saving',
  );

  ngOnInit(): void {
    void this.state.open();
  }
}
