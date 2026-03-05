/**
 * Agent Monitor Panel Component
 *
 * Right sidebar that shows real-time agent monitoring.
 * Auto-opens when agents spawn, streams output live.
 * Accordion layout: max 2 expanded cards at a time (55vh min-height each),
 * collapsed cards show only the header row. Container scrolls when needed.
 *
 * Responsive widths:
 *   default: 460px, xl (1280px+): 540px, 2xl (1536px+): 640px
 */

import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { SlicePipe } from '@angular/common';
import { LucideAngularModule, X, Trash2, ShieldAlert } from 'lucide-angular';
import { VSCodeService } from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { AgentPermissionRequest } from '@ptah-extension/shared';
import { AgentMonitorStore } from '../../services/agent-monitor.store';
import { PanelResizeService } from '../../services/panel-resize.service';
import { AgentCardComponent } from '../molecules/agent-card/agent-card.component';

@Component({
  selector: 'ptah-agent-monitor-panel',
  standalone: true,
  imports: [LucideAngularModule, AgentCardComponent, SlicePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .agent-panel-open {
      width: 360px;
    }
    @media (min-width: 1280px) {
      .agent-panel-open {
        width: 440px;
      }
    }
    @media (min-width: 1536px) {
      .agent-panel-open {
        width: 540px;
      }
    }
  `,
  template: `
    <aside
      class="flex flex-col bg-base-200 border-l border-base-content/5 overflow-hidden h-full"
      [class.agent-panel-open]="store.panelOpen()"
      [class.w-0]="!store.panelOpen()"
      [class.transition-all]="!resizeService.dragging()"
      [class.duration-300]="!resizeService.dragging()"
      [style.width.px]="store.panelOpen() ? resizeService.customWidth() : null"
    >
      <!-- Header -->
      <div
        class="flex items-center justify-between px-3 py-2 border-b border-base-content/10 flex-shrink-0"
        style="min-width: 300px"
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

      <!-- Sticky permission banner — always visible at top when any agent has a pending permission -->
      @if (store.pendingPermissions().length > 0) {
      <div
        class="flex-shrink-0 border-b border-warning/30"
        style="min-width: 300px"
      >
        @for (agent of store.pendingPermissions(); track agent.agentId) {
        <div
          class="bg-warning/10 px-3 py-2 flex flex-col gap-1.5 border-b border-warning/10 last:border-b-0"
        >
          <div class="flex items-center gap-2">
            <lucide-angular
              [img]="ShieldAlertIcon"
              class="w-3.5 h-3.5 text-warning flex-shrink-0"
            />
            <span class="badge badge-xs badge-warning">Permission</span>
            <span class="text-[10px] text-base-content/50 truncate">
              {{ agent.cli }} &middot; {{ agent.task | slice : 0 : 30 }}
            </span>
          </div>
          <div class="flex items-center gap-1.5">
            <code
              class="text-[10px] font-mono text-accent bg-base-200/60 px-1.5 py-0.5 rounded"
            >
              {{ agent.permissionQueue[0].toolName }}
            </code>
            @if (agent.permissionQueue[0].toolArgs) {
            <span class="text-[10px] text-base-content/40 font-mono truncate">
              {{ agent.permissionQueue[0].toolArgs }}
            </span>
            }
          </div>
          <div class="flex gap-2">
            <button
              type="button"
              class="btn btn-xs btn-success"
              (click)="allowPermission(agent.agentId, agent.permissionQueue[0])"
            >
              Allow
            </button>
            <button
              type="button"
              class="btn btn-xs btn-error btn-outline"
              (click)="denyPermission(agent.agentId, agent.permissionQueue[0])"
            >
              Deny
            </button>
          </div>
        </div>
        }
      </div>
      }

      <!-- Agent list: accordion layout — expanded cards get definite 55vh height, collapsed cards auto-size to header -->
      <div
        class="flex-1 overflow-y-auto p-2 flex flex-col gap-2 min-h-0"
        style="min-width: 300px"
      >
        @for (agent of store.agents(); track agent.agentId) {
        <div
          class="flex-shrink-0"
          [style.height]="agent.expanded ? '55vh' : null"
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
  readonly resizeService = inject(PanelResizeService);
  private readonly vscode = inject(VSCodeService);

  readonly XIcon = X;
  readonly Trash2Icon = Trash2;
  readonly ShieldAlertIcon = ShieldAlert;

  allowPermission(agentId: string, perm: AgentPermissionRequest): void {
    this.vscode.postMessage({
      type: MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_RESPONSE,
      payload: { requestId: perm.requestId, decision: 'allow' },
    });
    this.store.clearPermission(agentId);
  }

  denyPermission(agentId: string, perm: AgentPermissionRequest): void {
    this.vscode.postMessage({
      type: MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_RESPONSE,
      payload: {
        requestId: perm.requestId,
        decision: 'deny',
        reason: 'User denied',
      },
    });
    this.store.clearPermission(agentId);
  }
}
