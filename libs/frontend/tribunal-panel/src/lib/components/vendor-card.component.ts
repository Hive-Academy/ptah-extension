import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import {
  LucideAngularModule,
  MessageSquare,
  ShieldAlert,
} from 'lucide-angular';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import type { MonitoredAgent } from '@ptah-extension/chat-streaming';
import {
  ExecutionNodeComponent,
  AgentMonitorTreeBuilderService,
  AgentContinueInputComponent,
} from '@ptah-extension/chat';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import { VSCodeService } from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { AgentPermissionRequest } from '@ptah-extension/shared';
import { TribunalStateService } from '../services/tribunal-state.service';
import type { VendorLane } from '../types/tribunal-ui.types';

type VendorStatus = 'idle' | 'running' | 'completed' | 'failed';

@Component({
  selector: 'ptah-vendor-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LucideAngularModule,
    ExecutionNodeComponent,
    MarkdownBlockComponent,
    AgentContinueInputComponent,
  ],
  template: `
    <div
      class="flex h-full flex-col"
      data-testid="tribunal-vendor-card"
      [attr.aria-label]="'Vendor ' + lane().displayName"
    >
      <div
        class="flex items-center gap-2 border-b border-base-300 px-3 py-1.5 text-[11px]"
      >
        <span
          class="h-2 w-2 shrink-0 rounded-full"
          [class.bg-base-content]="status() === 'idle'"
          [class.opacity-40]="status() === 'idle'"
          [class.bg-info]="status() === 'running'"
          [class.animate-pulse]="status() === 'running'"
          [class.bg-success]="status() === 'completed'"
          [class.bg-error]="status() === 'failed'"
          [attr.aria-hidden]="true"
        ></span>
        <span class="font-medium text-base-content/80">{{
          statusLabel()
        }}</span>
        @if (lane().model) {
          <span class="truncate text-base-content/40">{{ lane().model }}</span>
        }
        <span class="ml-auto flex items-center gap-2 text-base-content/40">
          @if (toolCount() > 0) {
            <span [attr.aria-label]="toolCount() + ' tool calls'"
              >{{ toolCount() }} tools</span
            >
          }
          <span class="tabular-nums">{{ elapsedLabel() }}</span>
        </span>
      </div>

      @if (permissions().length > 0) {
        <div
          class="border-b border-warning/30"
          data-testid="tribunal-vendor-permissions"
        >
          @for (perm of permissions(); track perm.requestId) {
            <div
              class="flex flex-col gap-1 border-b border-warning/10 bg-warning/10 px-3 py-1.5 last:border-b-0"
            >
              <div class="flex items-center gap-2">
                <lucide-angular
                  [img]="PermissionIcon"
                  class="h-3.5 w-3.5 shrink-0 text-warning"
                  aria-hidden="true"
                />
                <span class="badge badge-warning badge-xs">Permission</span>
                <code
                  class="truncate rounded bg-base-200/60 px-1.5 py-0.5 text-[10px] font-mono text-accent"
                >
                  {{ perm.toolName }}
                </code>
              </div>
              @if (perm.description) {
                <span class="truncate text-[10px] text-base-content/50">
                  {{ perm.description }}
                </span>
              }
              <div class="flex gap-2">
                <button
                  type="button"
                  class="btn btn-success btn-xs"
                  (click)="allowPermission(perm)"
                >
                  Allow
                </button>
                <button
                  type="button"
                  class="btn btn-error btn-outline btn-xs"
                  (click)="denyPermission(perm)"
                >
                  Deny
                </button>
              </div>
            </div>
          }
        </div>
      }

      <div class="min-h-0 flex-1 overflow-auto">
        @if (!agent()) {
          <p class="px-3 py-4 text-center text-xs text-base-content/40">
            Awaiting {{ lane().displayName }}…
          </p>
        } @else if (executionNodes().length > 0) {
          <div class="space-y-1 p-2">
            @for (node of executionNodes(); track node.id) {
              <ptah-execution-node
                [node]="node"
                [isStreaming]="status() === 'running'"
              />
            }
          </div>
        } @else if (segmentText()) {
          <div class="p-2">
            <ptah-markdown-block [content]="segmentText()" />
          </div>
        } @else {
          <p class="px-3 py-4 text-center text-xs text-base-content/40">
            No output yet.
          </p>
        }
      </div>

      @if (steerableAgent(); as steerAgent) {
        <ptah-agent-continue-input [agent]="steerAgent" />
      } @else {
        <div
          class="flex items-center gap-2 border-t border-base-300 px-3 py-1.5"
        >
          <button
            type="button"
            class="btn btn-ghost btn-xs gap-1"
            disabled
            [attr.aria-label]="
              'Steer ' + lane().displayName + ' — ' + steerDisabledReason()
            "
            [title]="steerDisabledReason()"
          >
            <lucide-angular
              [img]="SteerIcon"
              class="h-3 w-3"
              aria-hidden="true"
            />
            Steer
          </button>
          <span class="truncate text-[10px] text-base-content/40">
            {{ steerDisabledReason() }}
          </span>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
    `,
  ],
})
export class VendorCardComponent {
  readonly lane = input.required<VendorLane>();
  readonly tribunalSessionId = input.required<string>();

  private readonly agentMonitor = inject(AgentMonitorStore);
  private readonly tribunalState = inject(TribunalStateService);
  private readonly treeBuilder = inject(AgentMonitorTreeBuilderService);
  private readonly vscode = inject(VSCodeService);

  protected readonly SteerIcon = MessageSquare;
  protected readonly PermissionIcon = ShieldAlert;

  protected readonly agent = computed<MonitoredAgent | null>(() => {
    this.agentMonitor.tick();
    if (!this.tribunalSessionId()) return null;
    return this.tribunalState.laneBindings().get(this.lane().laneId) ?? null;
  });

  protected readonly status = computed<VendorStatus>(() => {
    const agent = this.agent();
    if (!agent) return 'idle';
    switch (agent.status) {
      case 'running':
        return 'running';
      case 'completed':
        return 'completed';
      case 'failed':
      case 'timeout':
      case 'stopped':
        return 'failed';
      default:
        return 'idle';
    }
  });

  protected readonly statusLabel = computed(() => {
    switch (this.status()) {
      case 'running':
        return 'Running';
      case 'completed':
        return 'Done';
      case 'failed':
        return 'Failed';
      default:
        return 'Idle';
    }
  });

  protected readonly elapsedLabel = computed(() => {
    this.agentMonitor.tick();
    const agent = this.agent();
    if (!agent) return '';
    const end = agent.completedAt ?? Date.now();
    return this.formatElapsed(Math.max(0, end - agent.startedAt));
  });

  protected readonly executionNodes = computed(() => {
    this.agentMonitor.tick();
    const agent = this.agent();
    if (!agent || agent.cli !== 'ptah-cli') return [];
    if (agent.streamEvents.length === 0) return [];
    const tree = this.treeBuilder.buildTree(agent.agentId, agent.streamEvents);
    if (agent.status !== 'running') {
      return this.treeBuilder.finalizeOrphanedTools(tree);
    }
    return tree;
  });

  protected readonly segmentText = computed<string>(() => {
    this.agentMonitor.tick();
    const agent = this.agent();
    if (!agent) return '';
    return agent.segments
      .filter((s) => s.type === 'text' || s.type === 'info')
      .map((s) => s.content)
      .join('\n\n')
      .trim();
  });

  protected readonly toolCount = computed<number>(() => {
    this.agentMonitor.tick();
    const agent = this.agent();
    if (!agent) return 0;
    return agent.segments.filter((s) => s.type === 'tool-call').length;
  });

  protected readonly permissions = computed<readonly AgentPermissionRequest[]>(
    () => {
      this.agentMonitor.tick();
      return this.agent()?.permissionQueue ?? [];
    },
  );

  protected readonly steerableAgent = computed<MonitoredAgent | null>(() => {
    const agent = this.agent();
    if (!agent) return null;
    if (agent.cli !== 'ptah-cli') return null;
    if (agent.supportsContinuation !== true) return null;
    return agent;
  });

  protected readonly steerDisabledReason = computed<string>(() => {
    const agent = this.agent();
    if (!agent) return 'No agent bound to this lane yet';
    if (agent.cli !== 'ptah-cli') {
      return `Steering is not supported for ${agent.displayName ?? agent.cli}`;
    }
    if (agent.supportsContinuation !== true) {
      return 'This agent cannot be steered';
    }
    return 'Steering is available';
  });

  protected allowPermission(perm: AgentPermissionRequest): void {
    this.vscode.postMessage({
      type: MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_RESPONSE,
      payload: { requestId: perm.requestId, decision: 'allow' },
    });
    const agent = this.agent();
    if (agent) {
      this.agentMonitor.clearPermission(agent.agentId, perm.requestId);
    }
  }

  protected denyPermission(perm: AgentPermissionRequest): void {
    this.vscode.postMessage({
      type: MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_RESPONSE,
      payload: {
        requestId: perm.requestId,
        decision: 'deny',
        reason: 'User denied',
      },
    });
    const agent = this.agent();
    if (agent) {
      this.agentMonitor.clearPermission(agent.agentId, perm.requestId);
    }
  }

  private formatElapsed(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) {
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      return `${m}m ${s}s`;
    }
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  }
}
