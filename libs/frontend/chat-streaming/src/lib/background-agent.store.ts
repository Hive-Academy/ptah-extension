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
  BackgroundAgentCompletedEvent,
  BackgroundAgentStoppedEvent,
} from '@ptah-extension/shared';
import {
  BackgroundAgentId,
  type ClaudeSessionId,
} from '@ptah-extension/chat-state';
import { agentVisibleInSession, knownSessionId } from './session-scope';

export interface BackgroundAgentEntry {
  readonly toolCallId: string;
  readonly agentId: BackgroundAgentId;
  /**
   * True only when `agentId` is a genuine SDK-issued id. False when the
   * `background_agent` event omitted it and `resolveKey` substituted the
   * `toolCallId` as the storage key — in that case `agentId` cannot address
   * a real subagent transcript, so transcript reads must be gated off it.
   */
  readonly hasRealAgentId: boolean;
  readonly agentType: string;
  /** Human-legible subagent (teammate) name; preferred over `agentType` for display. */
  readonly teammateName?: string;
  readonly agentDescription?: string;
  /**
   * Owning session. Optional because the `background_agent_*` events can carry
   * `''` while the SDK session is still resolving, and `''` is not a session —
   * it is normalized away at ingestion so this field is either a real id or
   * absent. An entry with no owner is visible from every session
   * (`agentVisibleInSession`) rather than from none.
   */
  readonly sessionId?: ClaudeSessionId;
  status: 'running' | 'completed' | 'error' | 'stopped';
  readonly startedAt: number;
  completedAt?: number;
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

  private readonly _revision = signal(0);

  /**
   * Monotonic counter bumped once by every mutation that actually replaced the
   * agent map — the store's *membership* version.
   *
   * Exists for `ExecutionTreeBuilderService.computeGlobalEpoch`, which has to
   * decide whether a cached execution-tree node may be reused. `isBackground`
   * is read LIVE per node (`isBackgroundAgent(toolCallId)`), so the cache must
   * invalidate on any membership change — but the `background_agent_*` events
   * write no streaming event, so they move no per-message digest and this
   * counter is the ONLY signal the epoch has. Folding
   * `backgroundToolCallIds().size` instead was wrong precisely because a set
   * can swap a member for another without changing cardinality: one agent
   * entering the set while another is evicted or cleared in the same
   * `BatchedUpdateService` frame left every cached node rendering the previous
   * frame's background flags (TASK_2026_333).
   *
   * Read it as a signal — that is also what keeps the tree computed subscribed
   * to this store.
   */
  readonly revision = this._revision.asReadonly();

  /** Shared tick signal incremented every 1s while agents are running. */
  readonly tick = signal(0);
  private _tickInterval: ReturnType<typeof setInterval> | null = null;
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
   * Single write path: apply `reducer`, bump {@link revision} when it produced
   * a genuinely new map, then resync the tick.
   *
   * The identity check is what keeps the counter honest — a reducer that
   * declines the write (a duplicate `background_agent_started` for an agent
   * already running, a `clearSession` that matched nothing) returns the SAME
   * map, so it neither notifies `_agents` subscribers nor forces a full
   * execution-tree rebuild.
   */
  private applyMutation(
    reducer: (
      map: Map<BackgroundAgentId, BackgroundAgentEntry>,
    ) => Map<BackgroundAgentId, BackgroundAgentEntry>,
  ): void {
    const before = this._agents();
    this._agents.update(reducer);
    if (this._agents() !== before) {
      this._revision.update((r) => r + 1);
    }
    this.syncTick();
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
   * Find an entry by the Task `toolCallId` it was spawned from. O(n) over the
   * bounded agent set, same cost and same reason as {@link isBackgroundAgent}.
   *
   * This is the SECOND identity space. An entry always carries its
   * `toolCallId`, whether or not it is also keyed by one.
   */
  findByToolCallId(toolCallId: string): BackgroundAgentEntry | null {
    for (const a of this._agents().values()) {
      if (a.toolCallId === toolCallId) return a;
    }
    return null;
  }

  /**
   * Move an entry that had to be filed under its `toolCallId` onto its real
   * SDK `agentId`, and return it.
   *
   * WHY THIS EXISTS. `background_agent_started` reads `agentId` from the
   * subagent registry, whose record only exists once the `SubagentStart` hook
   * has fired — which can be after the placeholder tool_result. When the id is
   * missing, `resolveKey` files the entry under `toolCallId` with
   * `hasRealAgentId: false`. The only terminal signal a background agent has is
   * `TurnEndHandlerService.handleSubagentEnded`, which looks the entry up by
   * the REAL agent id, so a `toolCallId`-keyed entry could never be matched and
   * stayed `running` forever. `SubagentStop` carries both ids, so this is where
   * the two spaces are reconciled.
   *
   * The entry keeps its `toolCallId` field, so `isBackgroundAgent(toolCallId)`
   * still answers true for the original id and the tree builder is unaffected.
   * Only the map key, `agentId` and `hasRealAgentId` change.
   *
   * Declines the write — leaving the map identity and {@link revision} alone —
   * when there is nothing to reconcile or reconciling would lose information:
   * no entry for the toolCallId, an entry already keyed by this exact agentId,
   * an entry that already carries a DIFFERENT real agent id (two agents cannot
   * share one Task tool call), or a destination key already occupied.
   *
   * @returns The entry now stored under `agentId`, or null when the write was
   *   declined.
   */
  adoptRealAgentId(
    toolCallId: string,
    agentId: string,
  ): BackgroundAgentEntry | null {
    if (!agentId) {
      return null;
    }
    const key = agentId as BackgroundAgentId;
    const current = this.findByToolCallId(toolCallId);
    if (!current) {
      return null;
    }
    if (current.agentId === key) {
      return current.hasRealAgentId ? current : null;
    }
    if (current.hasRealAgentId) {
      return null;
    }
    if (this._agents().has(key)) {
      return null;
    }

    this.applyMutation((map) => {
      const next = new Map(map);
      next.delete(current.agentId);
      next.set(key, { ...current, agentId: key, hasRealAgentId: true });
      return next;
    });

    return this._agents().get(key) ?? null;
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

  /**
   * Get agents visible from a session — the same rule the monitor store's
   * views use: a known owner must match, an entry with no resolved owner is
   * visible everywhere so it can never become unreachable.
   */
  agentsForSession(sessionId: string): BackgroundAgentEntry[] {
    return this.agents().filter((a) =>
      agentVisibleInSession(a.sessionId, sessionId),
    );
  }

  onStarted(event: BackgroundAgentStartedEvent): void {
    const key = this.resolveKey(event.agentId, event.toolCallId);
    this.applyMutation((map) => {
      const existing = map.get(key);
      if (existing && existing.status === 'running') {
        return map;
      }

      const next = new Map(map);
      next.set(key, {
        toolCallId: event.toolCallId,
        agentId: key,
        hasRealAgentId: !!(event.agentId && event.agentId.length > 0),
        agentType: event.agentType,
        teammateName: event.teammateName,
        agentDescription: event.agentDescription,
        sessionId: knownSessionId(event.sessionId) as
          | ClaudeSessionId
          | undefined,
        status: 'running',
        startedAt: event.timestamp,
      });
      return next;
    });
  }

  onCompleted(event: BackgroundAgentCompletedEvent): void {
    const key = this.resolveKey(event.agentId, event.toolCallId);
    this.applyMutation((map) => {
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
          hasRealAgentId: !!(event.agentId && event.agentId.length > 0),
          agentType: event.agentType || 'unknown',
          sessionId: knownSessionId(event.sessionId) as
            | ClaudeSessionId
            | undefined,
          status: 'completed',
          startedAt: event.timestamp,
          completedAt: event.timestamp,
          result: event.result,
          cost: event.cost,
          duration: event.duration,
        });
      }

      return this.evictOldCompleted(next);
    });
  }

  onStopped(event: BackgroundAgentStoppedEvent): void {
    const key = this.resolveKey(event.agentId, event.toolCallId);
    this.applyMutation((map) => {
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
          hasRealAgentId: !!(event.agentId && event.agentId.length > 0),
          agentType: event.agentType || 'unknown',
          sessionId: knownSessionId(event.sessionId) as
            | ClaudeSessionId
            | undefined,
          status: 'stopped',
          startedAt: event.timestamp,
          completedAt: event.timestamp,
        });
      }

      return this.evictOldCompleted(next);
    });
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
    this.applyMutation((map) => {
      let removed = 0;
      const next = new Map(map);
      for (const [id, agent] of next) {
        if (agent.status !== 'running') {
          next.delete(id);
          removed++;
        }
      }
      // Same "decline the write" shape `clearSession` already uses: with
      // nothing to clear the caller must not see a new map, or every no-op
      // clear would notify subscribers and bump `revision`.
      return removed > 0 ? next : map;
    });
  }

  clearSession(sessionId: string): void {
    this.applyMutation((map) => {
      let removed = 0;
      const next = new Map(map);
      for (const [id, agent] of next) {
        if ((agent.sessionId as unknown as string) === sessionId) {
          next.delete(id);
          removed++;
        }
      }
      return removed > 0 ? next : map;
    });
  }
}
