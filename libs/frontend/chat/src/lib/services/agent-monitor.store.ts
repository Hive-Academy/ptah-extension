/**
 * Agent Monitor Store
 *
 * Signal-based store for real-time agent process monitoring.
 * Tracks spawned agents, streams output, and manages the sidebar panel state.
 */

import { Injectable, signal, computed, OnDestroy } from '@angular/core';
import type {
  AgentProcessInfo,
  AgentOutputDelta,
  AgentStatus,
  CliType,
  CliOutputSegment,
} from '@ptah-extension/shared';

/** Maximum stdout/stderr buffer per agent in the frontend (50KB) */
const MAX_FRONTEND_BUFFER = 50 * 1024;

export interface MonitoredAgent {
  readonly agentId: string;
  readonly cli: CliType;
  readonly task: string;
  status: AgentStatus;
  readonly startedAt: number;
  stdout: string;
  stderr: string;
  exitCode?: number;
  expanded: boolean;
  /** Structured output segments from SDK-based adapters (Gemini, Codex). Empty for raw CLI adapters (Copilot). */
  segments: CliOutputSegment[];
  /** Parent Ptah Claude SDK session that spawned this agent */
  readonly parentSessionId?: string;
  /**
   * CLI-native session ID (e.g., Gemini UUID). Enables resume.
   * Mutable because the session ID is often late-captured: it arrives via the
   * CLI's init event after spawn, or is attached to the exit event when the
   * process completes. Unlike `parentSessionId` (known at spawn time and
   * immutable), this field may be updated during the agent's lifetime.
   */
  cliSessionId?: string;
}

@Injectable({ providedIn: 'root' })
export class AgentMonitorStore implements OnDestroy {
  // Private mutable state
  private readonly _agents = signal<Map<string, MonitoredAgent>>(new Map());
  private readonly _panelOpen = signal(false);
  /** Tracks whether the user explicitly closed the panel (prevents auto-reopen) */
  private _userExplicitlyClosed = false;

  /**
   * Shared tick signal incremented every 1s while agents are running.
   * Agent cards derive elapsed time from this instead of per-card setInterval.
   */
  readonly tick = signal(0);
  private _tickInterval: ReturnType<typeof setInterval> | null = null;

  // Public computed signals
  readonly agents = computed(() => {
    const map = this._agents();
    return Array.from(map.values()).sort((a, b) => b.startedAt - a.startedAt);
  });

  readonly hasRunningAgents = computed(() =>
    this.agents().some((a) => a.status === 'running')
  );

  readonly agentCount = computed(() => this._agents().size);

  readonly panelOpen = computed(() => this._panelOpen());

  ngOnDestroy(): void {
    this.stopTick();
  }

  private startTick(): void {
    if (this._tickInterval) return;
    this._tickInterval = setInterval(() => {
      this.tick.update((t) => t + 1);
    }, 1000);
  }

  private stopTick(): void {
    if (this._tickInterval) {
      clearInterval(this._tickInterval);
      this._tickInterval = null;
    }
  }

  /** Start or stop tick based on whether any agents are running */
  private syncTick(): void {
    const hasRunning = Array.from(this._agents().values()).some(
      (a) => a.status === 'running'
    );
    if (hasRunning) {
      this.startTick();
    } else {
      this.stopTick();
    }
  }

  // Panel control
  togglePanel(): void {
    this._panelOpen.update((v) => !v);
  }

  openPanel(): void {
    this._panelOpen.set(true);
  }

  closePanel(): void {
    this._userExplicitlyClosed = true;
    this._panelOpen.set(false);
  }

  // Agent lifecycle
  onAgentSpawned(info: AgentProcessInfo): void {
    // Check before adding — auto-open on 0→1 transition only
    const hadAgents = this._agents().size > 0;

    this._agents.update((map) => {
      const next = new Map(map);
      next.set(info.agentId, {
        agentId: info.agentId,
        cli: info.cli,
        task: info.task,
        status: info.status,
        startedAt: new Date(info.startedAt).getTime(),
        stdout: '',
        stderr: '',
        expanded: true,
        segments: [],
        parentSessionId: info.parentSessionId,
        cliSessionId: info.cliSessionId,
      });
      return next;
    });

    // Auto-open panel on 0→1 agent transition (unless user explicitly closed)
    if (!hadAgents && !this._userExplicitlyClosed) {
      this._panelOpen.set(true);
    }

    this.syncTick();
  }

  onAgentOutput(delta: AgentOutputDelta): void {
    this._agents.update((map) => {
      const agent = map.get(delta.agentId);
      if (!agent) return map;

      const next = new Map(map);
      const updated = { ...agent };

      if (delta.stdoutDelta) {
        updated.stdout = capBuffer(
          updated.stdout + delta.stdoutDelta,
          MAX_FRONTEND_BUFFER
        );
      }
      if (delta.stderrDelta) {
        updated.stderr = capBuffer(
          updated.stderr + delta.stderrDelta,
          MAX_FRONTEND_BUFFER
        );
      }
      if (delta.segments && delta.segments.length > 0) {
        updated.segments = [...updated.segments, ...delta.segments];
      }

      next.set(delta.agentId, updated);
      return next;
    });
  }

  onAgentExited(info: AgentProcessInfo): void {
    this._agents.update((map) => {
      const agent = map.get(info.agentId);
      if (!agent) return map;

      const next = new Map(map);
      next.set(info.agentId, {
        ...agent,
        status: info.status,
        exitCode: info.exitCode,
        cliSessionId: info.cliSessionId || agent.cliSessionId,
      });
      return next;
    });

    this.syncTick();
  }

  toggleAgentExpanded(agentId: string): void {
    this._agents.update((map) => {
      const agent = map.get(agentId);
      if (!agent) return map;

      const next = new Map(map);
      next.set(agentId, { ...agent, expanded: !agent.expanded });
      return next;
    });
  }

  clearCompleted(): void {
    this._agents.update((map) => {
      const next = new Map(map);
      for (const [id, agent] of next) {
        if (agent.status !== 'running') {
          next.delete(id);
        }
      }
      return next;
    });

    // Reset explicit-close flag when all agents cleared — next spawn will auto-open
    if (this._agents().size === 0) {
      this._userExplicitlyClosed = false;
    }

    this.syncTick();
  }
}

function capBuffer(str: string, max: number): string {
  if (str.length <= max) return str;
  // Trim from beginning, align to newline
  const excess = str.length - max;
  const idx = str.indexOf('\n', excess);
  return idx > -1 ? str.substring(idx + 1) : str.substring(excess);
}
