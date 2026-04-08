/**
 * BackgroundAgentStore - Signal-based store for background agent monitoring
 *
 * Tracks background agents spawned via `run_in_background: true` on the Task tool.
 * These agents continue executing independently of the main agent's turn.
 *
 * Events flow: SDK → StreamingHandlerService → BackgroundAgentStore → UI
 */

import { Injectable, signal, computed, OnDestroy } from '@angular/core';
import type {
  BackgroundAgentStartedEvent,
  BackgroundAgentProgressEvent,
  BackgroundAgentCompletedEvent,
  BackgroundAgentStoppedEvent,
} from '@ptah-extension/shared';

export interface BackgroundAgentEntry {
  readonly toolCallId: string;
  readonly agentId: string;
  readonly agentType: string;
  readonly agentDescription?: string;
  readonly sessionId: string;
  status: 'running' | 'completed' | 'error' | 'stopped';
  readonly startedAt: number;
  completedAt?: number;
  summary: string;
  result?: string;
  cost?: number;
  duration?: number;
}

const MAX_COMPLETED_AGENTS = 50;

@Injectable({ providedIn: 'root' })
export class BackgroundAgentStore implements OnDestroy {
  private readonly _agents = signal<Map<string, BackgroundAgentEntry>>(
    new Map(),
  );

  /** Shared tick signal incremented every 1s while agents are running. */
  readonly tick = signal(0);
  private _tickInterval: ReturnType<typeof setInterval> | null = null;

  // Public computed signals
  readonly agents = computed(() => {
    const map = this._agents();
    return Array.from(map.values()).sort((a, b) => b.startedAt - a.startedAt);
  });

  readonly runningAgents = computed(() =>
    this.agents().filter((a) => a.status === 'running'),
  );

  readonly completedAgents = computed(() =>
    this.agents().filter((a) => a.status !== 'running'),
  );

  /** Running count derived directly from _agents Map with primitive equality.
   * Avoids cascading through agents() -> runningAgents() intermediate arrays. */
  readonly runningCount = computed(
    () => {
      let count = 0;
      for (const a of this._agents().values()) {
        if (a.status === 'running') count++;
      }
      return count;
    },
    { equal: (a, b) => a === b },
  );

  readonly totalCount = computed(() => this._agents().size, {
    equal: (a, b) => a === b,
  });

  /** Derived from runningCount with primitive equality to prevent cascade. */
  readonly hasRunningAgents = computed(() => this.runningCount() > 0, {
    equal: (a, b) => a === b,
  });

  /** Set of toolCallIds for background agents — used by tree builder to mark nodes.
   * Custom equality suppresses notifications when the same IDs are present. */
  readonly backgroundToolCallIds = computed(
    () => {
      const ids = new Set<string>();
      for (const agent of this._agents().values()) {
        ids.add(agent.toolCallId);
      }
      return ids;
    },
    {
      equal: (a, b) => a.size === b.size && [...a].every((id) => b.has(id)),
    },
  );

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

  private syncTick(): void {
    if (this.hasRunningAgents()) {
      this.startTick();
    } else {
      this.stopTick();
    }
  }

  /** Check if a toolCallId belongs to a background agent */
  isBackgroundAgent(toolCallId: string): boolean {
    return this._agents().has(toolCallId);
  }

  /** Get agents filtered by sessionId */
  agentsForSession(sessionId: string): BackgroundAgentEntry[] {
    return this.agents().filter((a) => a.sessionId === sessionId);
  }

  onStarted(event: BackgroundAgentStartedEvent): void {
    this._agents.update((map) => {
      const existing = map.get(event.toolCallId);
      if (existing && existing.status === 'running') {
        return map;
      }

      const next = new Map(map);
      next.set(event.toolCallId, {
        toolCallId: event.toolCallId,
        agentId: event.agentId || event.toolCallId,
        agentType: event.agentType,
        agentDescription: event.agentDescription,
        sessionId: event.sessionId,
        status: 'running',
        startedAt: event.timestamp,
        summary: '',
      });
      return next;
    });
    this.syncTick();
  }

  onProgress(event: BackgroundAgentProgressEvent): void {
    this._agents.update((map) => {
      const agent = map.get(event.toolCallId);
      if (!agent) return map;

      const next = new Map(map);
      next.set(event.toolCallId, {
        ...agent,
        summary: agent.summary + (event.summaryDelta || ''),
        status: event.status === 'error' ? 'error' : agent.status,
      });
      return next;
    });
  }

  onCompleted(event: BackgroundAgentCompletedEvent): void {
    this._agents.update((map) => {
      const agent = map.get(event.toolCallId);

      const next = new Map(map);
      if (agent) {
        next.set(event.toolCallId, {
          ...agent,
          status: 'completed',
          completedAt: event.timestamp,
          result: event.result,
          cost: event.cost,
          duration: event.duration,
        });
      } else {
        next.set(event.toolCallId, {
          toolCallId: event.toolCallId,
          agentId: event.agentId,
          agentType: event.agentType || 'unknown',
          sessionId: event.sessionId,
          status: 'completed',
          startedAt: event.timestamp,
          completedAt: event.timestamp,
          summary: '',
          result: event.result,
          cost: event.cost,
          duration: event.duration,
        });
      }

      return this.evictOldCompleted(next);
    });
    this.syncTick();
  }

  onStopped(event: BackgroundAgentStoppedEvent): void {
    this._agents.update((map) => {
      const agent = map.get(event.toolCallId);

      const next = new Map(map);
      if (agent) {
        next.set(event.toolCallId, {
          ...agent,
          status: 'stopped',
          completedAt: event.timestamp,
        });
      } else {
        next.set(event.toolCallId, {
          toolCallId: event.toolCallId,
          agentId: event.agentId,
          agentType: event.agentType || 'unknown',
          sessionId: event.sessionId,
          status: 'stopped',
          startedAt: event.timestamp,
          completedAt: event.timestamp,
          summary: '',
        });
      }

      return this.evictOldCompleted(next);
    });
    this.syncTick();
  }

  private evictOldCompleted(
    map: Map<string, BackgroundAgentEntry>,
  ): Map<string, BackgroundAgentEntry> {
    const finished = Array.from(map.values()).filter(
      (a) =>
        a.status === 'completed' ||
        a.status === 'stopped' ||
        a.status === 'error',
    );

    if (finished.length <= MAX_COMPLETED_AGENTS) {
      return map;
    }

    finished.sort(
      (a, b) => (a.completedAt ?? a.startedAt) - (b.completedAt ?? b.startedAt),
    );

    const toEvict = finished.length - MAX_COMPLETED_AGENTS;
    const evictIds = new Set(
      finished.slice(0, toEvict).map((a) => a.toolCallId),
    );

    for (const id of evictIds) {
      map.delete(id);
    }

    return map;
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
    this.syncTick();
  }
}
