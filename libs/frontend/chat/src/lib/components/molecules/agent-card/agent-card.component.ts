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
import { ClaudeRpcService } from '@ptah-extension/core';
import { AgentMonitorStore } from '../../../services/agent-monitor.store';
import type { MonitoredAgent } from '../../../services/agent-monitor.store';
import { AgentCardHeaderComponent } from './agent-card-header.component';
import { AgentCardOutputComponent } from './agent-card-output.component';
import { PtahCliOutputComponent } from './ptah-cli-output.component';
import { CopilotOutputComponent } from './copilot-output.component';
import { GeminiOutputComponent } from './gemini-output.component';
import { CodexOutputComponent } from './codex-output.component';
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
    AgentCardOutputComponent,
    PtahCliOutputComponent,
    CopilotOutputComponent,
    GeminiOutputComponent,
    CodexOutputComponent,
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
      <!-- Task description (collapsible, default collapsed) -->
      <details class="border-t border-base-content/10 flex-shrink-0">
        <summary
          class="px-2 py-0.5 cursor-pointer select-none hover:bg-base-200/30 transition-colors flex items-center gap-1.5"
        >
          <span class="text-[10px] font-medium text-base-content/40">Task</span>
          @if (agent().parentSessionId) {
          <span
            class="text-[9px] text-base-content/30 ml-auto"
            [title]="'Parent session: ' + agent().parentSessionId!"
            >Parent:
            {{ agent().parentSessionId! | slice : 0 : 8 }}&hellip;</span
          >
          }
        </summary>
        <div class="px-2 pb-1">
          <p class="text-[11px] leading-snug text-base-content/60 line-clamp-3">
            {{ agent().task }}
          </p>
        </div>
      </details>

      <!-- Output: per-CLI rendering pipeline -->
      @if (agent().stdout || agent().stderr || agent().segments.length > 0 ||
      agent().streamEvents.length > 0) { @switch (agent().cli) { @case
      ('ptah-cli') { @if (agent().streamEvents.length > 0) {
      <ptah-ptah-cli-output
        class="block flex-1 min-h-0 overflow-hidden"
        [agentId]="agent().agentId"
        [streamEvents]="agent().streamEvents"
        [isStreaming]="agent().status === 'running'"
        [scrollTrigger]="scrollTrigger()"
      />
      } @else {
      <ptah-agent-card-output
        class="block flex-1 min-h-0 overflow-hidden"
        [segments]="parsedOutput()"
        [stderrSegments]="parsedStderr()"
        [scrollTrigger]="scrollTrigger()"
      />
      } } @case ('copilot') {
      <ptah-copilot-output
        class="block flex-1 min-h-0 overflow-hidden"
        [agentId]="agent().agentId"
        [segments]="agent().segments"
        [isStreaming]="agent().status === 'running'"
        [scrollTrigger]="scrollTrigger()"
      />
      } @case ('gemini') {
      <ptah-gemini-output
        class="block flex-1 min-h-0 overflow-hidden"
        [agentId]="agent().agentId"
        [segments]="agent().segments"
        [isStreaming]="agent().status === 'running'"
        [scrollTrigger]="scrollTrigger()"
      />
      } @case ('codex') {
      <ptah-codex-output
        class="block flex-1 min-h-0 overflow-hidden"
        [agentId]="agent().agentId"
        [segments]="agent().segments"
        [isStreaming]="agent().status === 'running'"
        [scrollTrigger]="scrollTrigger()"
      />
      } @default {
      <ptah-agent-card-output
        class="block flex-1 min-h-0 overflow-hidden"
        [segments]="parsedOutput()"
        [stderrSegments]="parsedStderr()"
        [scrollTrigger]="scrollTrigger()"
      />
      } } } }
    </div>
  `,
})
export class AgentCardComponent {
  readonly agent = input.required<MonitoredAgent>();
  readonly toggleExpanded = output<void>();

  private readonly store = inject(AgentMonitorStore);
  private readonly rpcService = inject(ClaudeRpcService);

  readonly isStopping = signal(false);
  readonly isResuming = signal(false);

  /**
   * Elapsed time display derived from the store's shared tick signal.
   * No per-card setInterval — the store drives a single 1s timer.
   * Freezes at completedAt when the agent finishes (no more ticking).
   */
  readonly elapsedDisplay = computed(() => {
    const a = this.agent();
    if (a.completedAt) {
      // Agent finished — show frozen elapsed time
      return formatElapsed(a.completedAt - a.startedAt);
    }
    // Read tick to re-evaluate every second while agents are running
    this.store.tick();
    return formatElapsed(Date.now() - a.startedAt);
  });

  /**
   * Parse agent output into structured segments for formatted rendering.
   * Used by the default fallback path (all CLI-specific components use ExecutionNodeComponent directly).
   * Prefers structured segments when available, falls back to regex parsing of raw stdout.
   */
  readonly parsedOutput = computed((): RenderSegment[] => {
    const agent = this.agent();

    // Prefer structured segments when available (SDK adapters)
    if (agent.segments.length > 0) {
      return mergeConsecutiveTextSegments(agent.segments);
    }

    // Fallback: regex-parse raw stdout (legacy sessions or unexpected adapter failures)
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
    return (
      a.stdout.length +
      a.stderr.length +
      a.segments.length +
      a.streamEvents.length
    );
  });

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
      await this.rpcService.call('agent:resumeCliSession', {
        cliSessionId: agent.cliSessionId,
        cli: agent.cli,
        task: agent.task,
        parentSessionId: agent.parentSessionId,
        ptahCliId: agent.ptahCliId,
        previousAgentId: agent.agentId,
      });

      // Don't remove the old card here — the backend's agent:spawned event
      // will carry resumedFromAgentId, and onAgentSpawned() will replace
      // the old card in-place (preserving position and avoiding flicker).
    } finally {
      this.isResuming.set(false);
    }
  }
}
