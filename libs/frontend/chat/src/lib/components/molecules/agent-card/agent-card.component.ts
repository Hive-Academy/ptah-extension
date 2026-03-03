/**
 * Agent Card Component
 *
 * Thin orchestrator that composes header, permission, and output sub-components.
 * Displays a single monitored agent in the agent monitor sidebar.
 */

import {
  Component,
  input,
  output,
  computed,
  signal,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { SlicePipe } from '@angular/common';
import { VSCodeService, ClaudeRpcService } from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { AgentMonitorStore } from '../../../services/agent-monitor.store';
import type { MonitoredAgent } from '../../../services/agent-monitor.store';
import { AgentCardHeaderComponent } from './agent-card-header.component';
import { AgentCardPermissionComponent } from './agent-card-permission.component';
import { AgentCardOutputComponent } from './agent-card-output.component';
import {
  formatElapsed,
  parseAgentOutput,
  parseStderr,
  mergeConsecutiveTextSegments,
} from './agent-card.utils';
import type { RenderSegment } from './agent-card.types';

@Component({
  selector: 'ptah-agent-card',
  standalone: true,
  imports: [
    SlicePipe,
    AgentCardHeaderComponent,
    AgentCardPermissionComponent,
    AgentCardOutputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="border border-base-content/10 rounded-lg overflow-hidden bg-base-100 flex flex-col h-full"
    >
      <!-- Header -->
      <ptah-agent-card-header
        class="block flex-shrink-0"
        [agent]="agent()"
        [elapsedDisplay]="elapsedDisplay()"
        [isStopping]="isStopping()"
        [isResuming]="isResuming()"
        (toggleExpanded)="toggleExpanded.emit()"
        (stopAgent)="stopAgent($event)"
        (resumeAgent)="resumeAgent($event)"
      />

      @if (agent().expanded) {
      <!-- Task description -->
      <div class="px-3 py-1.5 border-t border-base-content/10 flex-shrink-0">
        @if (agent().parentSessionId) {
        <div class="flex items-center gap-1 mb-1">
          <span
            class="text-[9px] text-base-content/30"
            [title]="'Parent session: ' + agent().parentSessionId!"
            >Parent:
            {{ agent().parentSessionId! | slice : 0 : 8 }}&hellip;</span
          >
        </div>
        }
        <p
          class="text-[11px] leading-relaxed text-base-content/60 line-clamp-2"
        >
          {{ agent().task }}
        </p>
      </div>

      <!-- Permission request (Copilot SDK) -->
      @if (agent().pendingPermission) {
      <ptah-agent-card-permission
        class="block flex-shrink-0"
        [permission]="agent().pendingPermission!"
        (allow)="allowPermission()"
        (deny)="denyPermission()"
      />
      }

      <!-- Output -->
      @if (agent().stdout || agent().stderr || agent().segments.length > 0) {
      <ptah-agent-card-output
        class="block flex-1 min-h-0 overflow-hidden"
        [segments]="parsedOutput()"
        [stderrSegments]="parsedStderr()"
        [scrollTrigger]="scrollTrigger()"
      />
      } }
    </div>
  `,
})
export class AgentCardComponent {
  readonly agent = input.required<MonitoredAgent>();
  readonly toggleExpanded = output<void>();

  private readonly store = inject(AgentMonitorStore);
  private readonly vscode = inject(VSCodeService);
  private readonly rpcService = inject(ClaudeRpcService);

  readonly isStopping = signal(false);
  readonly isResuming = signal(false);

  /**
   * Elapsed time display derived from the store's shared tick signal.
   * No per-card setInterval — the store drives a single 1s timer.
   */
  readonly elapsedDisplay = computed(() => {
    const a = this.agent();
    // Read tick to re-evaluate every second while agents are running
    this.store.tick();
    return formatElapsed(Date.now() - a.startedAt);
  });

  /**
   * Parse agent output into structured segments for formatted rendering.
   * Prefers structured segments from SDK adapters (Gemini, Codex).
   * Falls back to regex parsing for adapters without structured segments.
   */
  readonly parsedOutput = computed((): RenderSegment[] => {
    const agent = this.agent();

    // Prefer structured segments when available (SDK adapters)
    if (agent.segments.length > 0) {
      return mergeConsecutiveTextSegments(agent.segments);
    }

    // Fallback: regex-parse raw stdout (Copilot and other raw CLI adapters)
    const stdout = agent.stdout;
    if (!stdout) return [];
    return parseAgentOutput(stdout);
  });

  /**
   * Parse stderr into informational vs error segments.
   */
  readonly parsedStderr = computed(() => {
    const stderr = this.agent().stderr;
    if (!stderr) return [];
    return parseStderr(stderr);
  });

  /** Trigger for auto-scroll in the output component */
  readonly scrollTrigger = computed(() => {
    const a = this.agent();
    // Use a hash of lengths so the output component scrolls on new content
    return a.stdout.length + a.stderr.length + a.segments.length;
  });

  /** Send "allow" decision for the pending permission request */
  allowPermission(): void {
    const perm = this.agent().pendingPermission;
    if (!perm) return;
    this.vscode.postMessage({
      type: MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_RESPONSE,
      payload: { requestId: perm.requestId, decision: 'allow' },
    });
    this.store.clearPermission(this.agent().agentId);
  }

  /** Send "deny" decision for the pending permission request */
  denyPermission(): void {
    const perm = this.agent().pendingPermission;
    if (!perm) return;
    this.vscode.postMessage({
      type: MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_RESPONSE,
      payload: {
        requestId: perm.requestId,
        decision: 'deny',
        reason: 'User denied',
      },
    });
    this.store.clearPermission(this.agent().agentId);
  }

  /** Stop a running agent via RPC */
  async stopAgent(event: Event): Promise<void> {
    event.stopPropagation();
    const agentId = this.agent().agentId;
    this.isStopping.set(true);
    try {
      await this.rpcService.call('agent:stop', { agentId });
    } finally {
      this.isStopping.set(false);
    }
  }

  /** Resume a completed/failed CLI agent session via RPC */
  async resumeAgent(event: Event): Promise<void> {
    event.stopPropagation();
    const agent = this.agent();
    if (!agent.cliSessionId) return;

    this.isResuming.set(true);
    try {
      const result = await this.rpcService.call('agent:resumeCliSession', {
        cliSessionId: agent.cliSessionId,
        cli: agent.cli,
        task: agent.task,
        parentSessionId: agent.parentSessionId,
      });

      // Remove the old stopped card — the backend's agent:spawned event
      // will create a fresh running card with the new agentId.
      if (result.success) {
        this.store.removeAgent(agent.agentId);
      }
    } finally {
      this.isResuming.set(false);
    }
  }
}
