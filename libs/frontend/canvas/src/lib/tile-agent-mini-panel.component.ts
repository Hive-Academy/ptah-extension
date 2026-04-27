/**
 * TileAgentMiniPanelComponent
 *
 * Expandable agent list rendered below the canvas tile header.
 * Shows each agent's status, CLI name, task snippet, and status badge.
 * Permission requests display inline Allow/Deny buttons.
 *
 * Max height 192px (max-h-48), scrollable when content overflows.
 *
 * TASK_2025_272 Batch 3
 */

import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
} from '@angular/core';
import { SlicePipe } from '@angular/common';
import { LucideAngularModule, ShieldAlert } from 'lucide-angular';
import {
  AgentMonitorStore,
  type MonitoredAgent,
} from '@ptah-extension/chat-streaming';
import { VSCodeService } from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { AgentPermissionRequest } from '@ptah-extension/shared';

@Component({
  selector: 'ptah-tile-agent-mini-panel',
  standalone: true,
  imports: [LucideAngularModule, SlicePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="border-t border-base-content/10 bg-base-200/50 max-h-48 overflow-y-auto shrink-0"
    >
      @for (agent of agents(); track agent.agentId) {
        <div class="px-2 py-1.5 border-b border-base-content/5 last:border-b-0">
          <!-- Agent row: status dot + name + task + badge -->
          <div class="flex items-center gap-1.5 text-[10px]">
            <span
              class="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
              [class.bg-info]="agent.status === 'running'"
              [class.bg-success]="agent.status === 'completed'"
              [class.bg-error]="agent.status === 'failed'"
              [class.bg-warning]="
                agent.status === 'timeout' || agent.status === 'stopped'
              "
            ></span>
            <span class="font-medium text-base-content truncate">
              {{ agent.displayName || agent.cli }}
            </span>
            <span class="text-base-content/40 truncate flex-1">
              {{ agent.task | slice: 0 : 40
              }}{{ agent.task.length > 40 ? '...' : '' }}
            </span>
            <span
              class="badge badge-xs flex-shrink-0"
              [class.badge-info]="agent.status === 'running'"
              [class.badge-success]="agent.status === 'completed'"
              [class.badge-error]="agent.status === 'failed'"
              [class.badge-warning]="
                agent.status === 'timeout' || agent.status === 'stopped'
              "
            >
              {{ agent.status }}
            </span>
          </div>

          <!-- Permission request (if any) -->
          @if (agent.permissionQueue.length > 0) {
            <div
              class="mt-1 bg-warning/10 rounded px-1.5 py-1 flex flex-col gap-1"
            >
              <div class="flex items-center gap-1 text-[10px]">
                <lucide-angular
                  [img]="ShieldAlertIcon"
                  class="w-3 h-3 text-warning flex-shrink-0"
                />
                <span class="text-warning font-medium">Permission</span>
                <code
                  class="text-[10px] font-mono text-accent bg-base-200/60 px-1 rounded truncate"
                >
                  {{ agent.permissionQueue[0].toolName }}
                </code>
              </div>
              <div class="flex gap-1.5">
                <button
                  type="button"
                  class="btn btn-xs btn-success h-5 min-h-0 px-2"
                  (click)="
                    allowPermission(agent.agentId, agent.permissionQueue[0])
                  "
                >
                  Allow
                </button>
                <button
                  type="button"
                  class="btn btn-xs btn-error btn-outline h-5 min-h-0 px-2"
                  (click)="
                    denyPermission(agent.agentId, agent.permissionQueue[0])
                  "
                >
                  Deny
                </button>
              </div>
            </div>
          }
        </div>
      } @empty {
        <div
          class="flex items-center justify-center h-12 text-[10px] text-base-content/40"
        >
          No agents
        </div>
      }
    </div>
  `,
})
export class TileAgentMiniPanelComponent {
  // ---- Inputs ----
  readonly agents = input.required<MonitoredAgent[]>();

  // ---- Dependencies ----
  private readonly vscode = inject(VSCodeService);
  private readonly agentStore = inject(AgentMonitorStore);

  // ---- Icons ----
  readonly ShieldAlertIcon = ShieldAlert;

  // ---- Permission handlers (mirrors agent-monitor-panel.component.ts pattern) ----

  allowPermission(agentId: string, perm: AgentPermissionRequest): void {
    this.vscode.postMessage({
      type: MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_RESPONSE,
      payload: { requestId: perm.requestId, decision: 'allow' },
    });
    this.agentStore.clearPermission(agentId);
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
    this.agentStore.clearPermission(agentId);
  }
}
