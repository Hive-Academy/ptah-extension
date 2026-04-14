/**
 * Agent Monitor Panel Component
 *
 * Sidebar that shows real-time agent monitoring.
 * Supports two modes:
 *   1. **Embedded mode** (preferred): Receives agents + open state via inputs.
 *      Used inside ChatViewComponent for per-session scoping.
 *   2. **Global mode** (legacy fallback): Reads from AgentMonitorStore directly.
 *
 * Uses a tile-based navigation bar at the top: each agent is a compact
 * clickable tile showing status + name + permission badge. Clicking a tile
 * selects that agent and renders its full card + inline permissions below.
 *
 * Auto-selects newly spawned agents and agents with permission requests.
 *
 * Responsive widths:
 *   default: 360px, xl (1280px+): 440px, 2xl (1536px+): 540px
 */

import {
  Component,
  inject,
  input,
  output,
  computed,
  signal,
  effect,
  untracked,
  ChangeDetectionStrategy,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { LucideAngularModule, X, Trash2, ShieldAlert } from 'lucide-angular';
import { VSCodeService } from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { AgentPermissionRequest } from '@ptah-extension/shared';
import { AgentMonitorStore } from '../../services/agent-monitor.store';
import type { MonitoredAgent } from '../../services/agent-monitor.store';
import { PanelResizeService } from '../../services/panel-resize.service';
import { AgentCardComponent } from '../molecules/agent-card/agent-card.component';

@Component({
  selector: 'ptah-agent-monitor-panel',
  standalone: true,
  imports: [NgClass, LucideAngularModule, AgentCardComponent],
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
      [class.agent-panel-open]="effectiveOpen()"
      [class.w-0]="!effectiveOpen()"
      [class.transition-all]="!resizeService.dragging()"
      [class.duration-300]="!resizeService.dragging()"
      [style.width.px]="effectiveOpen() ? resizeService.customWidth() : null"
    >
      <!-- Header -->
      <div
        class="flex items-center justify-between px-2.5 py-1.5 border-b border-base-content/10 flex-shrink-0"
        style="min-width: 300px"
      >
        <div class="flex items-center gap-2">
          <span class="text-sm font-semibold">Agents</span>
          @if (effectiveAgents().length > 0) {
            <span class="badge badge-sm badge-neutral">{{
              effectiveAgents().length
            }}</span>
          }
        </div>
        <div class="flex items-center gap-1">
          @if (effectiveAgents().length > 0 && !effectiveHasRunning()) {
            <button
              class="btn btn-ghost btn-xs btn-square"
              title="Clear completed"
              (click)="onClearCompleted()"
            >
              <lucide-angular
                [img]="Trash2Icon"
                class="w-3.5 h-3.5"
                aria-hidden="true"
              />
            </button>
          }
          <button
            class="btn btn-ghost btn-xs btn-square"
            title="Close panel"
            (click)="onClose()"
          >
            <lucide-angular
              [img]="XIcon"
              class="w-3.5 h-3.5"
              aria-hidden="true"
            />
          </button>
        </div>
      </div>

      <!-- Agent Tiles Bar -->
      @if (effectiveAgents().length > 0) {
        <div
          class="flex gap-1.5 px-2 py-1.5 overflow-x-auto border-b border-base-content/5 flex-shrink-0"
          style="min-width: 300px"
        >
          @for (agent of effectiveAgents(); track agent.agentId) {
            <button
              type="button"
              class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all shrink-0 cursor-pointer"
              [ngClass]="
                agent.agentId === effectiveSelectedAgent()?.agentId
                  ? 'border-primary bg-primary/10 shadow-sm'
                  : 'border-base-300 bg-base-100 hover:border-primary/30 hover:bg-primary/5'
              "
              (click)="selectAgent(agent.agentId)"
              [title]="agent.task"
            >
              <!-- Status dot -->
              <span
                class="w-2 h-2 rounded-full shrink-0"
                [class.bg-info]="agent.status === 'running'"
                [class.bg-success]="agent.status === 'completed'"
                [class.bg-error]="
                  agent.status === 'failed' || agent.status === 'timeout'
                "
                [class.bg-warning]="agent.status === 'stopped'"
                [class.animate-pulse]="agent.status === 'running'"
              ></span>

              <!-- Agent name -->
              <span class="text-xs font-medium truncate max-w-[120px]">
                {{ agent.displayName || agent.cli }}
              </span>

              <!-- Permission badge -->
              @if (agent.permissionQueue.length > 0) {
                <span class="badge badge-xs badge-warning animate-pulse">
                  {{ agent.permissionQueue.length }}
                </span>
              }
            </button>
          }
        </div>
      }

      <!-- Selected Agent Detail -->
      <div class="flex-1 overflow-y-auto min-h-0" style="min-width: 300px">
        @if (effectiveSelectedAgent(); as agent) {
          <!-- Permission requests for selected agent -->
          @if (agent.permissionQueue.length > 0) {
            <div class="border-b border-warning/30">
              @for (perm of agent.permissionQueue; track perm.requestId) {
                <div
                  class="bg-warning/10 px-2.5 py-1.5 flex flex-col gap-1 border-b border-warning/10 last:border-b-0"
                >
                  <div class="flex items-center gap-2">
                    <lucide-angular
                      [img]="ShieldAlertIcon"
                      class="w-3.5 h-3.5 text-warning flex-shrink-0"
                      aria-hidden="true"
                    />
                    <span class="badge badge-xs badge-warning">Permission</span>
                  </div>
                  <div class="flex items-center gap-1.5">
                    <code
                      class="text-[10px] font-mono text-accent bg-base-200/60 px-1.5 py-0.5 rounded"
                    >
                      {{ perm.toolName }}
                    </code>
                    @if (perm.toolArgs) {
                      <span
                        class="text-[10px] text-base-content/40 font-mono truncate"
                      >
                        {{ perm.toolArgs }}
                      </span>
                    }
                  </div>
                  <div class="flex gap-2">
                    <button
                      type="button"
                      class="btn btn-xs btn-success"
                      (click)="allowPermission(agent.agentId, perm)"
                    >
                      Allow
                    </button>
                    <button
                      type="button"
                      class="btn btn-xs btn-error btn-outline"
                      (click)="denyPermission(agent.agentId, perm)"
                    >
                      Deny
                    </button>
                  </div>
                </div>
              }
            </div>
          }

          <!-- Agent card (auto-expanded on selection) -->
          <div class="p-1.5">
            <ptah-agent-card
              class="block h-full"
              [agent]="agent"
              (toggleExpanded)="store.toggleAgentExpanded(agent.agentId)"
            />
          </div>
        } @else {
          <div
            class="flex flex-col items-center justify-center h-32 text-center"
          >
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
  protected readonly store = inject(AgentMonitorStore);
  protected readonly resizeService = inject(PanelResizeService);
  private readonly vscode = inject(VSCodeService);

  readonly XIcon = X;
  readonly Trash2Icon = Trash2;
  readonly ShieldAlertIcon = ShieldAlert;

  // ---- Embedded mode inputs ----

  /** Session-scoped agents. When provided, panel uses these instead of global store. */
  readonly embeddedAgents = input<MonitoredAgent[] | undefined>(undefined);

  /** Panel open state. When provided, panel uses this instead of global store. */
  readonly embeddedOpen = input<boolean | undefined>(undefined);

  /** Session ID for scoped clear operations. Required in embedded mode. */
  readonly sessionId = input<string | null>(null);

  /** Emits when close button clicked in embedded mode. */
  readonly closed = output<void>();

  // ---- Selection state ----

  readonly selectedAgentId = signal<string | null>(null);
  private prevAgentIds = new Set<string>();

  // ---- Computed: effective values (embedded inputs or global store fallback) ----

  readonly effectiveAgents = computed(
    () => this.embeddedAgents() ?? this.store.activeTabAgents(),
  );

  readonly effectiveOpen = computed(
    () => this.embeddedOpen() ?? this.store.panelOpen(),
  );

  readonly effectivePermissions = computed(() => {
    const embedded = this.embeddedAgents();
    if (embedded === undefined) return this.store.pendingPermissions();
    const agentIds = new Set(embedded.map((a) => a.agentId));
    return this.store
      .pendingPermissions()
      .filter((a) => agentIds.has(a.agentId));
  });

  readonly effectiveHasRunning = computed(() =>
    this.effectiveAgents().some((a) => a.status === 'running'),
  );

  /** The currently selected agent, falling back to the first agent in the list. */
  readonly effectiveSelectedAgent = computed(() => {
    const agents = this.effectiveAgents();
    const id = this.selectedAgentId();
    if (id) {
      const found = agents.find((a) => a.agentId === id);
      if (found) return found;
    }
    return agents[0] ?? null;
  });

  constructor() {
    // Auto-select newly spawned agents and handle selection invalidation
    effect(() => {
      const agents = this.effectiveAgents();
      const currentIds = new Set(agents.map((a) => a.agentId));
      const selectedId = untracked(() => this.selectedAgentId());

      const newIds = [...currentIds].filter((id) => !this.prevAgentIds.has(id));

      if (newIds.length > 0) {
        // New agent spawned — select it
        this.selectAgent(newIds[0]);
      } else if (selectedId && !currentIds.has(selectedId)) {
        // Selected agent was removed — fall back to first
        if (agents.length > 0) {
          this.selectAgent(agents[0].agentId);
        } else {
          this.selectedAgentId.set(null);
        }
      } else if (!selectedId && agents.length > 0) {
        // Nothing selected yet — select first
        this.selectAgent(agents[0].agentId);
      }

      this.prevAgentIds = currentIds;
    });

    // Auto-switch to agent when a permission request arrives
    effect(() => {
      const perms = this.effectivePermissions();
      if (perms.length > 0) {
        this.selectAgent(perms[0].agentId);
      }
    });
  }

  // ---- Actions ----

  selectAgent(agentId: string): void {
    this.selectedAgentId.set(agentId);
    // Ensure the card is expanded so output is visible
    const agent = this.effectiveAgents().find((a) => a.agentId === agentId);
    if (agent && !agent.expanded) {
      this.store.toggleAgentExpanded(agentId);
    }
  }

  onClose(): void {
    if (this.embeddedOpen() !== undefined) {
      this.closed.emit();
    } else {
      this.store.closePanel();
    }
  }

  onClearCompleted(): void {
    const sid = this.sessionId();
    if (sid) {
      this.store.clearCompletedInSession(sid);
    } else {
      this.store.clearCompleted();
    }
  }

  allowPermission(agentId: string, perm: AgentPermissionRequest): void {
    this.vscode.postMessage({
      type: MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_RESPONSE,
      payload: { requestId: perm.requestId, decision: 'allow' },
    });
    this.store.clearPermission(agentId, perm.requestId);
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
    this.store.clearPermission(agentId, perm.requestId);
  }
}
