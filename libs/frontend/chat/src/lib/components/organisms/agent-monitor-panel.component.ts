/**
 * Agent Monitor Panel Component
 *
 * Right sidebar that shows real-time agent monitoring.
 * Auto-opens when agents spawn, streams output live.
 * Cards share available height equally.
 */

import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { LucideAngularModule, X, Trash2 } from 'lucide-angular';
import { AgentMonitorStore } from '../../services/agent-monitor.store';
import { AgentCardComponent } from '../molecules/agent-card.component';

@Component({
  selector: 'ptah-agent-monitor-panel',
  standalone: true,
  imports: [LucideAngularModule, AgentCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside
      class="flex flex-col bg-base-200 border-l border-base-content/5 transition-all duration-300 overflow-hidden h-full"
      [class.w-80]="store.panelOpen()"
      [class.w-0]="!store.panelOpen()"
    >
      <!-- Header -->
      <div
        class="flex items-center justify-between px-3 py-2 border-b border-base-content/10 min-w-[320px] flex-shrink-0"
      >
        <div class="flex items-center gap-2">
          <span class="text-sm font-semibold">Agents</span>
          @if (store.agentCount() > 0) {
          <span class="badge badge-sm badge-neutral">{{
            store.agentCount()
          }}</span>
          }
        </div>
        <div class="flex items-center gap-1">
          @if (store.agents().length > 0 && !store.hasRunningAgents()) {
          <button
            class="btn btn-ghost btn-xs btn-square"
            title="Clear completed"
            (click)="store.clearCompleted()"
          >
            <lucide-angular [img]="Trash2Icon" class="w-3.5 h-3.5" />
          </button>
          }
          <button
            class="btn btn-ghost btn-xs btn-square"
            title="Close panel"
            (click)="store.closePanel()"
          >
            <lucide-angular [img]="XIcon" class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <!-- Agent list: flex layout distributes height equally among cards -->
      <div
        class="flex-1 overflow-y-auto p-2 flex flex-col gap-2 min-w-[320px] min-h-0"
      >
        @for (agent of store.agents(); track agent.agentId) {
        <div
          class="flex-1 min-h-[120px]"
          [style.max-height.%]="100 / store.agentCount()"
        >
          <ptah-agent-card
            class="block h-full"
            [agent]="agent"
            (toggleExpanded)="store.toggleAgentExpanded(agent.agentId)"
          />
        </div>
        } @empty {
        <div class="flex flex-col items-center justify-center h-32 text-center">
          <span class="text-sm text-base-content/40">No agents</span>
          <span class="text-xs text-base-content/25 mt-1"
            >Agents will appear here when spawned</span
          >
        </div>
        }
      </div>
    </aside>
  `,
})
export class AgentMonitorPanelComponent {
  readonly store = inject(AgentMonitorStore);

  readonly XIcon = X;
  readonly Trash2Icon = Trash2;
}
