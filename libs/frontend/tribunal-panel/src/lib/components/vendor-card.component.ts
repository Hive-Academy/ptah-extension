import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import type { MonitoredAgent } from '@ptah-extension/chat-streaming';
import { AgentMonitorPanelComponent } from '@ptah-extension/chat';
import { TribunalStateService } from '../services/tribunal-state.service';
import type { VendorLane } from '../types/tribunal-ui.types';

@Component({
  selector: 'ptah-vendor-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AgentMonitorPanelComponent],
  template: `
    <div
      class="flex h-full flex-col"
      data-testid="tribunal-vendor-card"
      [attr.aria-label]="'Vendor ' + lane().displayName"
    >
      @if (boundAgent(); as agent) {
        <ptah-agent-monitor-panel
          class="flex h-full min-h-0 flex-1"
          [embeddedAgents]="[agent]"
          [embeddedOpen]="true"
          [sessionId]="tribunalSessionId()"
        />
      } @else {
        <p class="px-3 py-4 text-center text-xs text-base-content-muted">
          Awaiting {{ lane().displayName }}…
        </p>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }

      ptah-agent-monitor-panel ::ng-deep aside {
        width: 100% !important;
      }
    `,
  ],
})
export class VendorCardComponent {
  readonly lane = input.required<VendorLane>();
  /**
   * The tribunal's resolved session id, or `null` while it is still unresolved.
   *
   * Absence is modelled, not fabricated. This was `input.required<string>()`,
   * which forced `tribunal-page.component.ts` to bind `tribunalSessionId() ?? ''`
   * — inventing an id for a session that did not have one yet (TASK_2026_296).
   * `null` matches `TribunalStateService.tribunalSessionId` on the parent side
   * and `AgentMonitorPanelComponent.sessionId` on the child side, so the value
   * now travels this chain unconverted.
   */
  readonly tribunalSessionId = input<string | null>(null);

  private readonly tribunalState = inject(TribunalStateService);

  protected readonly boundAgent = computed<MonitoredAgent | null>(() => {
    if (!this.tribunalSessionId()) return null;
    return this.tribunalState.laneBindings().get(this.lane().laneId) ?? null;
  });
}
