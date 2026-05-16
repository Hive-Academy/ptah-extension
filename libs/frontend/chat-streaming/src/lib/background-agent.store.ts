/**
 * BackgroundAgentStore - Signal-based store for background agent monitoring
 *
 * Tracks background agents spawned via `run_in_background: true` on the Task tool.
 * These agents continue executing independently of the main agent's turn.
 *
 * Events flow: SDK → StreamingHandlerService → BackgroundAgentStore → UI
 *
 * Keyed by `BackgroundAgentId`.
 *
 * Why: the legacy implementation keyed `_agents` by `toolCallId` (`toolu_…`),
 * which is overloaded — the same value flows through `tool_start` /
 * `tool_result` for non-background tool calls and could theoretically collide
 * with a background agent's parent tool. Keying by the SDK-issued
 * `agentId` (e.g. `"adcecb2"` from the SubagentStart hook) gives the store
 * its own identity space. The toolCallId is preserved on the entry so the
 * tree builder's `isBackgroundAgent(toolCallId)` lookup still works (now an
 * O(n) scan over the bounded agent set instead of O(1) Map.has).
 *
 * The brand `BackgroundAgentId` is *type-only* protection at this boundary:
 * SDK agent ids are short hex strings, not UUID-v4, so we cast at ingestion
 * rather than calling `BackgroundAgentId.from()` (which throws on non-UUID
 * input). Same pattern that `event.sessionId` (`SessionId`) already uses
 * across the streaming layer.
 */

import { Injectable, signal, computed, OnDestroy } from '@angular/core';
import type {
  BackgroundAgentStartedEvent,
  BackgroundAgentProgressEvent,
  BackgroundAgentCompletedEvent,
  BackgroundAgentStoppedEvent,
} from '@ptah-extension/shared';
import {
  BackgroundAgentId,
  type ClaudeSessionId,
} from '@ptah-extension/chat-state';

export interface BackgroundAgentEntry {
  readonly toolCallId: string;
  readonly agentId: BackgroundAgentId;
  readonly agentType: string;
  readonly agentDescription?: string;
  readonly sessionId: ClaudeSessionId;
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
  private readonly _agents = signal<
    Map<BackgroundAgentId, BackgroundAgentEntry>
  >(new Map());

  /**
   * One-time-per-id warn dedup for the SDK-omits-agentId fallback path.
   * Bounded by MAX_COMPLETED_AGENTS + running set, so no leak risk.
   */
  private readonly warnedFallbackIds = new Set<string>();

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

  /**
   * Resolve the storage key for an event. Prefers the SDK-issued `agentId`;
   * falls back to `toolCallId` if absent (and warns once per offending id).
   *
   * The cast bypasses `BackgroundAgentId.from()` validation: the brand is a
   * UUID-v4 smart constructor, but actual SDK agent ids are short hex strings
   * (e.g. `"adcecb2"`). Type-level branding still prevents accidental mixing
   * with `TabId` / `ConversationId` / `ClaudeSessionId` at every other call.
   */
  private resolveKey(
    agentId: string | undefined,
    toolCallId: string,
  ): BackgroundAgentId {
    if (agentId && agentId.length > 0) {
      return agentId as BackgroundAgentId;
    }
    if (!this.warnedFallbackIds.has(toolCallId)) {
      this.warnedFallbackIds.add(toolCallId);
      console.warn(
        '[BackgroundAgentStore] background_agent event missing agentId; ' +
          'falling back to toolCallId as storage key:',
        toolCallId,
      );
    }
    return toolCallId as BackgroundAgentId;
  }

  /**
   * Check if a toolCallId belongs to a background agent.
   *
   * Public signature kept stable: callers (tree builder) pass `toolu_*` strings
   * pulled from event payloads. The storage key is `agentId`, so this lookup
   * is an O(n) scan over `_agents().values()` instead of O(1) `Map.has`.
   * Acceptable: the store is
   * bounded at MAX_COMPLETED_AGENTS=50 plus the running set, and the call
   * happens during tree rebuilds (already O(events)) — not on hot ingestion paths.
   */
  isBackgroundAgent(toolCallId: string): boolean {
    for (const a of this._agents().values()) {
      if (a.toolCallId === toolCallId) return true;
    }
    return false;
  }

  /**
   * Find an entry by its branded `BackgroundAgentId` (the storage key).
   * O(1) lookup. Returns null when no agent matches.
   */
  findByAgentId(agentId: BackgroundAgentId): BackgroundAgentEntry | null {
    return this._agents().get(agentId) ?? null;
  }

  /**
   * Resolve the parent `ClaudeSessionId` that spawned a background agent.
   *
   * Explicit parent-session lookup. Replaces the pattern of
   * reading `entry.sessionId` after a `findByAgentId` call when
   * the intent is "find the parent session for this agent" (vs. "read the
   * field"). Returns null when the agent is unknown.
   */
  sessionForAgent(agentId: BackgroundAgentId): ClaudeSessionId | null {
    return this._agents().get(agentId)?.sessionId ?? null;
  }

  /** Get agents filtered by sessionId */
  agentsForSession(sessionId: string): BackgroundAgentEntry[] {
    return this.agents().filter((a) => a.sessionId === sessionId);
  }

  onStarted(event: BackgroundAgentStartedEvent): void {
    const key = this.resolveKey(event.agentId, event.toolCallId);
    this._agents.update((map) => {
      const existing = map.get(key);
      if (existing && existing.status === 'running') {
        return map;
      }

      const next = new Map(map);
      next.set(key, {
        toolCallId: event.toolCallId,
        agentId: key,
        agentType: event.agentType,
        agentDescription: event.agentDescription,
        sessionId: event.sessionId as ClaudeSessionId,
        status: 'running',
        startedAt: event.timestamp,
        summary: '',
      });
      return next;
    });
    this.syncTick();
  }

  onProgress(event: BackgroundAgentProgressEvent): void {
    const key = this.resolveKey(event.agentId, event.toolCallId);
    this._agents.update((map) => {
      const agent = map.get(key);
      if (!agent) return map;

      const next = new Map(map);
      next.set(key, {
        ...agent,
        summary: agent.summary + (event.summaryDelta || ''),
        status: event.status === 'error' ? 'error' : agent.status,
      });
      return next;
    });
  }

  onCompleted(event: BackgroundAgentCompletedEvent): void {
    const key = this.resolveKey(event.agentId, event.toolCallId);
    this._agents.update((map) => {
      const agent = map.get(key);

      const next = new Map(map);
      if (agent) {
        next.set(key, {
          ...agent,
          status: 'completed',
          completedAt: event.timestamp,
          result: event.result,
          cost: event.cost,
          duration: event.duration,
        });
      } else {
        next.set(key, {
          toolCallId: event.toolCallId,
          agentId: key,
          agentType: event.agentType || 'unknown',
          sessionId: event.sessionId as ClaudeSessionId,
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
    const key = this.resolveKey(event.agentId, event.toolCallId);
    this._agents.update((map) => {
      const agent = map.get(key);

      const next = new Map(map);
      if (agent) {
        next.set(key, {
          ...agent,
          status: 'stopped',
          completedAt: event.timestamp,
        });
      } else {
        next.set(key, {
          toolCallId: event.toolCallId,
          agentId: key,
          agentType: event.agentType || 'unknown',
          sessionId: event.sessionId as ClaudeSessionId,
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
    map: Map<BackgroundAgentId, BackgroundAgentEntry>,
  ): Map<BackgroundAgentId, BackgroundAgentEntry> {
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
    const evictIds = new Set(finished.slice(0, toEvict).map((a) => a.agentId));

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
