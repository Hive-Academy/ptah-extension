/**
 * Agent Monitor Store
 *
 * Signal-based store for real-time agent process monitoring.
 * Tracks spawned agents, streams output, and manages the sidebar panel state.
 *
 * State shape:
 * Backing store is `signal<readonly MonitoredAgent[]>([])` plus a derived
 * `_byId` computed for O(1) lookups. Previously this was `signal<Map<...>>`
 * which forced every writer to clone the Map â€” and silently broke `computed()`
 * propagation when a writer forgot to clone, since reference equality held.
 * Array + computed byId is the idiomatic Angular pattern: writes are clearly
 * immutable (`[...list, x]` / `list.filter(...)`), reads stay O(1) via byId.
 */

import { Injectable, signal, computed, inject, OnDestroy } from '@angular/core';
import type {
  AgentProcessInfo,
  AgentOutputDelta,
  AgentStatus,
  CliType,
  CliOutputSegment,
  FlatStreamEventUnion,
  AgentPermissionRequest,
  AgentProgressEvent,
  AgentStatusEvent,
  AgentCompletedEvent,
  AgentStartEvent,
  CliSessionReference,
} from '@ptah-extension/shared';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';

/** Maximum stdout/stderr buffer per agent in the frontend (50KB) */
const MAX_FRONTEND_BUFFER = 50 * 1024;

/** Maximum number of simultaneously expanded agent cards */
const MAX_EXPANDED_AGENTS = 3;

/** Maximum completed/failed agents retained in the store.
 * Only agents with status 'completed' or 'failed' are evicted; 'running' and
 * 'interrupted' agents are always preserved. */
const MAX_COMPLETED_AGENTS = 20;

export interface MonitoredAgent {
  readonly agentId: string;
  readonly cli: CliType;
  readonly task: string;
  status: AgentStatus;
  readonly startedAt: number;
  /** Timestamp when agent finished. Used to freeze elapsed time display. */
  completedAt?: number;
  stdout: string;
  stderr: string;
  exitCode?: number;
  expanded: boolean;
  /** Order in which this card was expanded (for auto-collapse of oldest). */
  expandedAt?: number;
  /** Structured output segments from SDK-based adapters (Codex, Copilot). */
  segments: CliOutputSegment[];
  /** Rich streaming events from Ptah CLI adapter. Enables ExecutionNode rendering.
   *  Mutated in place (appended) across deltas — never reassigned — so retention
   *  is unbounded without an O(n) copy per event. `streamRevision` is the change
   *  signal; consumers must depend on it, not on this array's identity. */
  streamEvents: FlatStreamEventUnion[];
  /** Incremented on every streamEvents append. Because streamEvents is mutated
   *  in place its reference is stable, so this counter is what tells the agent
   *  card to recompute its execution tree. */
  streamRevision: number;
  /** Parent Ptah Claude SDK session that spawned this agent.
   * Mutable: initially set to tab ID, resolved to real SDK UUID
   * when SESSION_ID_RESOLVED fires. */
  parentSessionId?: string;
  /**
   * CLI-native session ID (e.g., Codex UUID). Enables resume.
   * Mutable because the session ID is often late-captured: it arrives via the
   * CLI's init event after spawn, or is attached to the exit event when the
   * process completes. Unlike `parentSessionId` (known at spawn time and
   * immutable), this field may be updated during the agent's lifetime.
   */
  cliSessionId?: string;
  /** Queue of pending permission requests from the agent (Copilot SDK) */
  permissionQueue: AgentPermissionRequest[];
  /** Ptah CLI agent registry ID (only set when cli === 'ptah-cli'). Needed for resume. */
  readonly ptahCliId?: string;
  /** Human-readable display name for the CLI agent (e.g., 'Codex', 'Copilot'). */
  readonly displayName?: string;
  /** Model identifier used by the CLI agent (e.g., 'gpt-5-codex', 'gpt-4o'). */
  readonly model?: string;
  readonly supportsContinuation?: boolean;
}

/**
 * Per-subagent record for SDK task_* events.
 *
 * Distinct from `MonitoredAgent` (CLI process). Keyed by `parentToolUseId`
 * (the Task tool_use ID), which is also the `toolCallId` on the
 * corresponding agent ExecutionNode rendered in the chat tree.
 *
 * Driven by `agent_start` (initial), `agent_progress`, `agent_status`,
 * `agent_completed`. State is derived purely from SDK events — UI never
 * mutates optimistically on RPC.
 */
export interface SubagentRecord {
  /** Parent Task tool_use ID — primary key */
  readonly parentToolUseId: string;
  /** SDK task_id, captured on `agent_start` (when present) or `agent_progress`/`agent_status` */
  taskId?: string;
  /** Latest description from progress/status events */
  description?: string;
  /** AI-generated rolling summary from progress events (most recent) */
  latestSummary?: string;
  /** Most recent tool name reported by progress events */
  lastToolName?: string;
  /** Lifecycle status from SDK */
  status:
    | 'pending'
    | 'running'
    | 'completed'
    | 'failed'
    | 'killed'
    | 'stopped'
    | 'paused';
  /** Cumulative token usage (last reported) */
  totalTokens?: number;
  /** Tool invocation count (last reported) */
  toolUses?: number;
  /** Elapsed/total duration (last reported) */
  durationMs?: number;
  /** Error text if status is 'failed' */
  errorMessage?: string;
  /** Final output file path if completed */
  outputFile?: string;
  /**
   * Owning session id, captured from the pushed SDK event's `sessionId`
   * (`FlatStreamEvent.sessionId`). This is the session that spawned the
   * subagent — NOT necessarily the focused tab. Steer / stop / background
   * RPCs must target THIS session, otherwise they resolve the wrong Query
   * backend-side when multiple canvas tiles are live. Kept optional because a
   * record can, in theory, be materialised before any event carries it.
   */
  parentSessionId?: string;
}

/**
 * Error surfaced from subagent RPC calls. Lives in a dedicated channel so
 * components can show a transient toast / inline message without polluting
 * the per-record state — the SDK is still the source of truth for status.
 */
export interface SubagentRpcError {
  readonly parentToolUseId: string;
  readonly method:
    | 'subagent:send-message'
    | 'subagent:stop'
    | 'subagent:interrupt'
    | 'subagent:background';
  readonly message: string;
  readonly code?: string;
  readonly timestamp: number;
}

@Injectable({ providedIn: 'root' })
export class AgentMonitorStore implements OnDestroy {
  private readonly tabManager = inject(TabManagerService);
  private readonly vscodeService = inject(VSCodeService);
  private readonly rpc = inject(ClaudeRpcService);
  private readonly _agents = signal<readonly MonitoredAgent[]>([]);

  /**
   * Internal O(1) lookup index. Recomputed whenever `_agents` changes.
   * Used by every writer that needs to find an agent by id without scanning.
   */
  private readonly _byId = computed(() => {
    const map = new Map<string, MonitoredAgent>();
    for (const a of this._agents()) {
      map.set(a.agentId, a);
    }
    return map;
  });

  private readonly _panelOpen = signal(false);
  /** Tracks whether the user explicitly closed the panel (prevents auto-reopen) */
  private _userExplicitlyClosed = false;
  /** Monotonic counter for tracking expand order (oldest = lowest value) */
  private _expandOrder = 0;

  /**
   * Buffer for permission requests that arrive before the agent spawn event.
   * Keyed by agentId. Replayed in onAgentSpawned() when the agent card is created.
   * Prevents silent permission loss due to message ordering.
   */
  private _pendingPermissionBuffer = new Map<
    string,
    AgentPermissionRequest[]
  >();

  /**
   * Tracks agent descriptions (tasks) that have been resumed.
   * Used by inline-agent-bubble to upgrade 'interrupted' â†’ 'resumed' visuals.
   * Key: `${parentSessionId}::${task}` for scoped matching (CLI agent case).
   */
  private readonly _resumedAgentKeys = signal<Set<string>>(new Set());

  /**
   * Tracks specific agent node IDs that have been resumed.
   * When a new agent of the same type is spawned while an interrupted agent
   * of that type exists, the SPECIFIC interrupted agent's node ID is stored here.
   * This prevents false positives when multiple agents of the same type exist.
   */
  private readonly _resumedAgentNodeIds = signal<Set<string>>(new Set());

  /**
   * Per-subagent records, keyed by parentToolUseId. Backed by a signal of
   * a readonly Map; writers always produce a new Map for reference identity.
   */
  private readonly _subagents = signal<ReadonlyMap<string, SubagentRecord>>(
    new Map(),
  );

  /** Public readonly view of the subagent record map. */
  readonly subagents = this._subagents.asReadonly();

  /** O(1) lookup helper for templates that prefer a function over getter. */
  getSubagent(parentToolUseId: string): SubagentRecord | undefined {
    return this._subagents().get(parentToolUseId);
  }

  /**
   * Most recent subagent RPC error. Components subscribe to surface a
   * transient toast / inline notice. Cleared on next successful RPC call.
   */
  private readonly _subagentRpcError = signal<SubagentRpcError | null>(null);
  readonly subagentRpcError = this._subagentRpcError.asReadonly();

  /** Whether this webview instance is the sidebar (not an editor panel) */
  get isSidebar(): boolean {
    const panelId = this.vscodeService.config().panelId;
    return !panelId || panelId === '';
  }

  /**
   * Whether the "pop out to editor" button should be highlighted.
   * True when agents are actively running and we're in the narrow sidebar.
   * Reads _agents() directly (not the sorted agents() array) to avoid cascade.
   */
  readonly shouldSuggestEditorPanel = computed(
    () => {
      if (!this.isSidebar) return false;
      for (const a of this._agents()) {
        if (a.status === 'running') return true;
      }
      return false;
    },
    { equal: (a, b) => a === b },
  );

  /**
   * Shared tick signal incremented every 1s while agents are running.
   * Agent cards derive elapsed time from this instead of per-card setInterval.
   */
  readonly tick = signal(0);
  private _tickInterval: ReturnType<typeof setInterval> | null = null;
  readonly agents = computed(() => {
    return [...this._agents()].sort((a, b) => b.startedAt - a.startedAt);
  });

  /**
   * Public byId index â€” exposed alongside `agents` for callers that need O(1)
   * lookup. Readers prefer this to `agents().find(...)` when scanning is hot.
   */
  readonly agentsById = computed(() => this._byId());

  /**
   * Agents filtered to the active tab's session.
   * Shows only agents whose parentSessionId matches the active tab's claudeSessionId.
   * Agents with no parentSessionId are shown in all tabs (backward compatibility).
   * When no tab is active or the active tab has no session, all agents are shown.
   */
  readonly activeTabAgents = computed(() => {
    const all = this.agents();
    const activeSessionId = this.tabManager.activeTabSessionId();

    if (!activeSessionId) return all;
    return all.filter(
      (a) => !a.parentSessionId || a.parentSessionId === activeSessionId,
    );
  });

  /**
   * Get agents for a specific session (scoped accessor for canvas tiles).
   * Unlike activeTabAgents, this doesn't depend on the global activeTab signal.
   */
  agentsForSession(sessionId: string): MonitoredAgent[] {
    return this.agents().filter((a) => a.parentSessionId === sessionId);
  }

  /** Whether any agent is running. Reads _agents() directly with primitive equality
   * to avoid re-evaluation cascade through the sorted agents() array. */
  readonly hasRunningAgents = computed(
    () => {
      for (const a of this._agents()) {
        if (a.status === 'running') return true;
      }
      return false;
    },
    { equal: (a, b) => a === b },
  );

  readonly agentCount = computed(() => this._agents().length, {
    equal: (a, b) => a === b,
  });

  /** Whether the active tab's session has running agents (session-scoped).
   * Primitive equality suppresses false notifications when the boolean doesn't change. */
  readonly hasActiveTabRunningAgents = computed(
    () => this.activeTabAgents().some((a) => a.status === 'running'),
    { equal: (a, b) => a === b },
  );

  /** Count of agents belonging to the active tab's session.
   * Primitive equality prevents re-renders when the count stays the same. */
  readonly activeTabAgentCount = computed(() => this.activeTabAgents().length, {
    equal: (a, b) => a === b,
  });

  /** Agents that currently have a pending permission request (global â€” all tabs).
   * Permissions are global because the user should always see them regardless of active tab. */
  readonly pendingPermissions = computed(() =>
    this.agents().filter((a) => a.permissionQueue.length > 0),
  );

  /** Pending permissions scoped to the active tab's session */
  readonly activeTabPendingPermissions = computed(() =>
    this.activeTabAgents().filter((a) => a.permissionQueue.length > 0),
  );

  readonly panelOpen = this._panelOpen.asReadonly();

  ngOnDestroy(): void {
    this.stopTick();
    this._pendingPermissionBuffer.clear();
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
    let hasRunning = false;
    for (const a of this._agents()) {
      if (a.status === 'running') {
        hasRunning = true;
        break;
      }
    }
    if (hasRunning) {
      this.startTick();
    } else {
      this.stopTick();
    }
  }
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

  /**
   * Check if a specific interrupted agent has been resumed.
   * Two matching strategies:
   * 1. SDK subagents: matches by specific node ID (nodeId or toolCallId)
   * 2. CLI agents: matches by parentSessionId + task description
   * Used by inline-agent-bubble to show 'Resumed' badge.
   */
  isAgentResumed(
    nodeId: string | undefined,
    toolCallId: string | undefined,
    taskOrDescription: string,
  ): boolean {
    const resumedIds = this._resumedAgentNodeIds();
    if (nodeId && resumedIds.has(nodeId)) return true;
    if (toolCallId && resumedIds.has(toolCallId)) return true;
    const keys = this._resumedAgentKeys();
    for (const key of keys) {
      if (key.endsWith(`::${taskOrDescription}`)) return true;
    }
    return false;
  }

  /**
   * Mark specific agent node IDs as resumed.
   * Called by the streaming handler when a new agent_start arrives and
   * a specific interrupted agent of the same type is found.
   */
  markAgentNodesResumed(nodeIds: string[]): void {
    if (nodeIds.length === 0) return;
    this._resumedAgentNodeIds.update((set) => {
      const next = new Set(set);
      for (const id of nodeIds) {
        next.add(id);
      }
      return next;
    });
  }
  onAgentSpawned(info: AgentProcessInfo): void {
    const hadAgents = this._agents().length > 0;

    this._agents.update((list) => {
      const existingIndex = list.findIndex((a) => a.agentId === info.agentId);
      if (existingIndex !== -1) {
        const existing = list[existingIndex];
        const reopened: MonitoredAgent = {
          ...existing,
          status: info.status,
          completedAt: undefined,
          exitCode: undefined,
          cliSessionId: info.cliSessionId || existing.cliSessionId,
          supportsContinuation:
            info.supportsContinuation ?? existing.supportsContinuation,
        };
        const next = [...list];
        next[existingIndex] = reopened;
        return next;
      }

      const oldCard = this.findReplacementCard(list, info);

      if (oldCard) {
        if (oldCard.parentSessionId && oldCard.task) {
          this._resumedAgentKeys.update((set) => {
            const next = new Set(set);
            next.add(`${oldCard.parentSessionId}::${oldCard.task}`);
            return next;
          });
        }
        const replacement: MonitoredAgent = {
          agentId: info.agentId,
          cli: info.cli,
          task: info.task,
          status: info.status,
          startedAt: new Date(info.startedAt).getTime(),
          stdout: '',
          stderr: '',
          expanded: oldCard.expanded,
          expandedAt: oldCard.expandedAt,
          segments: [],
          streamEvents: [],
          streamRevision: 0,
          parentSessionId: info.parentSessionId,
          cliSessionId: info.cliSessionId,
          ptahCliId: info.ptahCliId,
          permissionQueue: [],
          displayName: info.displayName || info.ptahCliName,
          model: info.model,
          supportsContinuation: info.supportsContinuation,
        };
        return [
          ...list.filter((a) => a.agentId !== oldCard.agentId),
          replacement,
        ];
      }

      const order = this._expandOrder++;
      const fresh: MonitoredAgent = {
        agentId: info.agentId,
        cli: info.cli,
        task: info.task,
        status: info.status,
        startedAt: new Date(info.startedAt).getTime(),
        stdout: '',
        stderr: '',
        expanded: true,
        expandedAt: order,
        segments: [],
        streamEvents: [],
        streamRevision: 0,
        parentSessionId: info.parentSessionId,
        cliSessionId: info.cliSessionId,
        ptahCliId: info.ptahCliId,
        permissionQueue: [],
        displayName: info.displayName || info.ptahCliName,
        model: info.model,
        supportsContinuation: info.supportsContinuation,
      };
      return this.enforceMaxExpanded([...list, fresh]);
    });
    const buffered = this._pendingPermissionBuffer.get(info.agentId);
    if (buffered && buffered.length > 0) {
      this._pendingPermissionBuffer.delete(info.agentId);
      console.log(
        '[AgentMonitorStore] Replaying buffered permissions:',
        info.agentId,
        buffered.length,
      );
      for (const req of buffered) {
        this.onPermissionRequest(req);
      }
    }
    if (!hadAgents && !this._userExplicitlyClosed) {
      this._panelOpen.set(true);
    }

    this.syncTick();
  }

  onAgentOutput(delta: AgentOutputDelta): void {
    this._agents.update((list) => {
      let foundIndex = -1;
      for (let i = 0; i < list.length; i++) {
        if (list[i].agentId === delta.agentId) {
          foundIndex = i;
          break;
        }
      }
      if (foundIndex === -1) return list;

      const agent = list[foundIndex];
      const updated: MonitoredAgent = { ...agent };

      if (delta.stdoutDelta) {
        updated.stdout = capBuffer(
          updated.stdout + delta.stdoutDelta,
          MAX_FRONTEND_BUFFER,
        );
      }
      if (delta.stderrDelta) {
        updated.stderr = capBuffer(
          updated.stderr + delta.stderrDelta,
          MAX_FRONTEND_BUFFER,
        );
      }
      if (delta.segments && delta.segments.length > 0) {
        const existing = updated.segments;
        const incoming = delta.segments;
        const lastIdx = existing.length - 1;
        const lastType = lastIdx >= 0 ? existing[lastIdx].type : null;
        const firstIncomingType = incoming[0].type;
        if (
          lastIdx >= 0 &&
          (lastType === 'text' || lastType === 'thinking') &&
          lastType === firstIncomingType
        ) {
          const merged = [
            ...existing.slice(0, lastIdx),
            {
              ...existing[lastIdx],
              content: existing[lastIdx].content + incoming[0].content,
            },
            ...incoming.slice(1),
          ];
          updated.segments = merged;
        } else {
          updated.segments = [...existing, ...incoming];
        }
      }
      if (delta.streamEvents && delta.streamEvents.length > 0) {
        // Append in place — streamEvents shares its reference across deltas, so
        // this is O(new events) with no whole-array copy. The bumped
        // streamRevision is what drives the agent card to recompute.
        for (const ev of delta.streamEvents) {
          updated.streamEvents.push(ev);
        }
        updated.streamRevision = agent.streamRevision + 1;
      }

      const next = [...list];
      next[foundIndex] = updated;
      return next;
    });
  }

  onAgentExited(info: AgentProcessInfo): void {
    this._agents.update((list) => {
      let foundIndex = -1;
      for (let i = 0; i < list.length; i++) {
        if (list[i].agentId === info.agentId) {
          foundIndex = i;
          break;
        }
      }
      if (foundIndex === -1) return list;

      const agent = list[foundIndex];
      const completedAt = info.completedAt
        ? new Date(info.completedAt).getTime()
        : Date.now();

      const next = [...list];
      next[foundIndex] = {
        ...agent,
        status: info.status,
        exitCode: info.exitCode,
        cliSessionId: info.cliSessionId || agent.cliSessionId,
        completedAt,
        permissionQueue: [],
        supportsContinuation:
          info.supportsContinuation ?? agent.supportsContinuation,
      };
      return this.evictOldCompletedAgents(next);
    });

    this.syncTick();
  }

  /**
   * Evict the oldest completed/failed agents when count exceeds
   * MAX_COMPLETED_AGENTS. Preserves 'running' and 'interrupted' agents.
   * Returns a new array (does not mutate the input).
   */
  private evictOldCompletedAgents(
    list: readonly MonitoredAgent[],
  ): MonitoredAgent[] {
    const completedAgents = list.filter(
      (a) => a.status === 'completed' || a.status === 'failed',
    );

    if (completedAgents.length <= MAX_COMPLETED_AGENTS) return [...list];
    const sortedCompleted = [...completedAgents].sort(
      (a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0),
    );
    const toEvictCount = sortedCompleted.length - MAX_COMPLETED_AGENTS;
    const evictedIds = new Set<string>();
    for (let i = 0; i < toEvictCount; i++) {
      evictedIds.add(sortedCompleted[i].agentId);
    }

    return list.filter((a) => !evictedIds.has(a.agentId));
  }

  /** Handle incoming permission request from CLI agent (Copilot SDK or Ptah CLI) */
  onPermissionRequest(request: AgentPermissionRequest): void {
    this._agents.update((list) => {
      let foundIndex = -1;
      for (let i = 0; i < list.length; i++) {
        if (list[i].agentId === request.agentId) {
          foundIndex = i;
          break;
        }
      }
      if (foundIndex === -1) {
        console.warn(
          '[AgentMonitorStore] Permission buffered â€” agent not yet spawned:',
          request.agentId,
        );
        const buf = this._pendingPermissionBuffer.get(request.agentId) ?? [];
        buf.push(request);
        this._pendingPermissionBuffer.set(request.agentId, buf);
        return list;
      }

      const agent = list[foundIndex];
      const needsExpand = !agent.expanded;
      const order = needsExpand ? this._expandOrder++ : agent.expandedAt;

      const next = [...list];
      next[foundIndex] = {
        ...agent,
        permissionQueue: [...agent.permissionQueue, request],
        expanded: true,
        expandedAt: order,
      };

      const result = needsExpand ? this.enforceMaxExpanded(next) : next;
      return result;
    });
    this._panelOpen.set(true);
  }

  /** Remove a specific permission from the queue by requestId (after user responds). */
  clearPermission(agentId: string, requestId?: string): void {
    this._agents.update((list) => {
      let foundIndex = -1;
      for (let i = 0; i < list.length; i++) {
        if (list[i].agentId === agentId) {
          foundIndex = i;
          break;
        }
      }
      if (foundIndex === -1) return list;

      const agent = list[foundIndex];
      const next = [...list];
      next[foundIndex] = {
        ...agent,
        permissionQueue: requestId
          ? agent.permissionQueue.filter((p) => p.requestId !== requestId)
          : agent.permissionQueue.slice(1),
      };
      return next;
    });
  }

  toggleAgentExpanded(agentId: string): void {
    this._agents.update((list) => {
      let foundIndex = -1;
      for (let i = 0; i < list.length; i++) {
        if (list[i].agentId === agentId) {
          foundIndex = i;
          break;
        }
      }
      if (foundIndex === -1) return list;

      const agent = list[foundIndex];
      const next = [...list];

      if (agent.expanded) {
        next[foundIndex] = { ...agent, expanded: false, expandedAt: undefined };
        return next;
      }
      const order = this._expandOrder++;
      next[foundIndex] = { ...agent, expanded: true, expandedAt: order };
      return this.enforceMaxExpanded(next);
    });
  }

  /**
   * Find an existing agent card that the new agent should replace.
   *
   * Strategy 1: Match by resumedFromAgentId (explicit resume from sidebar button).
   * Strategy 2: Match by cliSessionId (MCP-triggered respawn during session resume â€”
   *   the MCP spawn path doesn't know the old card's agentId, but the same CLI session
   *   ID is reused). Only matches non-running agents in the same parent session.
   */
  private findReplacementCard(
    list: readonly MonitoredAgent[],
    info: AgentProcessInfo,
  ): MonitoredAgent | null {
    if (info.resumedFromAgentId) {
      for (const a of list) {
        if (a.agentId === info.resumedFromAgentId) return a;
      }
    }
    if (info.cliSessionId) {
      for (const a of list) {
        if (
          a.cliSessionId === info.cliSessionId &&
          a.parentSessionId === info.parentSessionId &&
          a.status !== 'running'
        ) {
          return a;
        }
      }
    }

    return null;
  }

  /**
   * Enforce that at most MAX_EXPANDED_AGENTS are expanded at once.
   * Collapses the oldest expanded card(s) when the limit is exceeded.
   * Returns a new array (does not mutate the input).
   */
  private enforceMaxExpanded(
    list: readonly MonitoredAgent[],
  ): MonitoredAgent[] {
    const expanded = list.filter((a) => a.expanded);
    if (expanded.length <= MAX_EXPANDED_AGENTS) return [...list];
    const sortedExpanded = [...expanded].sort(
      (a, b) => (a.expandedAt ?? 0) - (b.expandedAt ?? 0),
    );
    const toCollapse = sortedExpanded.length - MAX_EXPANDED_AGENTS;
    const collapseIds = new Set<string>();
    for (let i = 0; i < toCollapse; i++) {
      collapseIds.add(sortedExpanded[i].agentId);
    }

    return list.map((a) =>
      collapseIds.has(a.agentId)
        ? { ...a, expanded: false, expandedAt: undefined }
        : a,
    );
  }

  /**
   * Load CLI sessions from a saved session's metadata.
   * Converts CliSessionReference[] to MonitoredAgent[] and adds them to the store.
   * Called when loading/resuming a session that had CLI agents spawned.
   * Agents from other sessions are preserved â€” activeTabAgents handles display filtering.
   * Auto-opens the panel if sessions are loaded.
   */
  loadCliSessions(
    cliSessions: CliSessionReference[],
    parentSessionId?: string,
  ): void {
    if (cliSessions.length === 0) return;

    this._agents.update((list) => {
      let next: MonitoredAgent[] = list.filter((a) => {
        if (parentSessionId === undefined) return true;
        if (a.parentSessionId !== parentSessionId) return true;
        return a.status === 'running';
      });

      const existingIds = new Set(next.map((a) => a.agentId));

      for (const ref of cliSessions) {
        if (existingIds.has(ref.agentId)) continue;

        const ts = new Date(ref.startedAt).getTime();
        next = [
          ...next,
          {
            agentId: ref.agentId,
            cli: ref.cli,
            task: ref.task,
            status: ref.status,
            startedAt: Number.isNaN(ts) ? Date.now() : ts,
            stdout: ref.stdout ?? '',
            stderr: '',
            expanded: false,
            segments: ref.segments ? [...ref.segments] : [],
            streamEvents: ref.streamEvents ? [...ref.streamEvents] : [],
            streamRevision: 0,
            cliSessionId: ref.cliSessionId,
            parentSessionId,
            ptahCliId: ref.ptahCliId,
            permissionQueue: [],
          },
        ];
        existingIds.add(ref.agentId);
      }
      return next;
    });
    if (!this._userExplicitlyClosed) {
      this._panelOpen.set(true);
    }
  }

  /**
   * Remove all non-running agents belonging to a specific session.
   * Called when a tab is closed to clean up its associated agent cards.
   * Running agents are preserved (they'll complete in the background).
   */
  clearSessionAgents(sessionId: string): void {
    this._agents.update((list) => {
      const next = list.filter(
        (a) => !(a.parentSessionId === sessionId && a.status !== 'running'),
      );
      return next.length === list.length ? list : next;
    });
  }

  forceClearSessionAgents(sessionId: string): void {
    this._agents.update((list) => {
      const next = list.filter((a) => a.parentSessionId !== sessionId);
      return next.length === list.length ? list : next;
    });
    this.syncTick();
  }

  removeAgent(agentId: string): void {
    this._agents.update((list) => {
      const next = list.filter((a) => a.agentId !== agentId);
      return next.length === list.length ? list : next;
    });
  }

  /**
   * Update parentSessionId for all agents that were spawned with a tab ID
   * before the real SDK session UUID was resolved.
   * Called when SESSION_ID_RESOLVED fires, mirroring the backend's
   * AgentProcessManager.resolveParentSessionId().
   */
  resolveParentSessionId(tabId: string, realSessionId: string): void {
    this._agents.update((list) => {
      let changed = false;
      const next = list.map((a) => {
        if (a.parentSessionId === tabId) {
          changed = true;
          return { ...a, parentSessionId: realSessionId };
        }
        return a;
      });
      return changed ? next : list;
    });
  }

  clearCompleted(): void {
    this._agents.update((list) => list.filter((a) => a.status === 'running'));
    if (this._agents().length === 0) {
      this._userExplicitlyClosed = false;
    }

    this.syncTick();
  }

  /**
   * Clear completed/failed agents belonging to a specific session.
   * Used by embedded agent panels to scope clear operations per session.
   * Reference-equality optimisation avoids unnecessary signal notifications.
   */
  clearCompletedInSession(sessionId: string): void {
    this._agents.update((list) => {
      const next = list.filter(
        (a) => !(a.parentSessionId === sessionId && a.status !== 'running'),
      );
      return next.length === list.length ? list : next;
    });

    if (this._agents().length === 0) {
      this._userExplicitlyClosed = false;
    }

    this.syncTick();
  }

  /**
   * Capture / upgrade a subagent record from an `agent_start` event.
   * Sets status to 'running' (default) and records the description and
   * task_id when present. Idempotent: subsequent agent_start events for
   * the same parentToolUseId merge into the existing record without
   * downgrading lifecycle state.
   */
  onAgentStart(event: AgentStartEvent): void {
    const key = event.toolCallId;
    if (!key) return;
    this._subagents.update((map) => {
      const existing = map.get(key);
      const next = new Map(map);
      const merged: SubagentRecord = {
        parentToolUseId: key,
        taskId: event.taskId ?? existing?.taskId,
        description: event.agentDescription ?? existing?.description,
        latestSummary: existing?.latestSummary,
        lastToolName: existing?.lastToolName,
        status:
          existing?.status &&
          existing.status !== 'pending' &&
          existing.status !== 'running'
            ? existing.status
            : 'running',
        totalTokens: existing?.totalTokens,
        toolUses: existing?.toolUses,
        durationMs: existing?.durationMs,
        errorMessage: existing?.errorMessage,
        outputFile: existing?.outputFile,
        parentSessionId: event.sessionId ?? existing?.parentSessionId,
      };
      next.set(key, merged);
      return next;
    });
  }

  /** Reducer for SDK `agent_progress` events. */
  onAgentProgress(event: AgentProgressEvent): void {
    const key = event.parentToolUseId;
    if (!key) return;
    this._subagents.update((map) => {
      const existing = map.get(key);
      const next = new Map(map);
      const merged: SubagentRecord = {
        parentToolUseId: key,
        taskId: event.taskId ?? existing?.taskId,
        description: event.description ?? existing?.description,
        latestSummary: event.summary ?? existing?.latestSummary,
        lastToolName: event.lastToolName ?? existing?.lastToolName,
        status: existing?.status ?? 'running',
        totalTokens: event.totalTokens,
        toolUses: event.toolUses,
        durationMs: event.durationMs,
        errorMessage: existing?.errorMessage,
        outputFile: existing?.outputFile,
        parentSessionId: event.sessionId ?? existing?.parentSessionId,
      };
      next.set(key, merged);
      return next;
    });
  }

  /** Reducer for SDK `agent_status` events. */
  onAgentStatus(event: AgentStatusEvent): void {
    const key = event.parentToolUseId;
    if (!key) return;
    this._subagents.update((map) => {
      const existing = map.get(key);
      const next = new Map(map);
      const merged: SubagentRecord = {
        parentToolUseId: key,
        taskId: event.taskId ?? existing?.taskId,
        description: event.description ?? existing?.description,
        latestSummary: existing?.latestSummary,
        lastToolName: existing?.lastToolName,
        status: event.status,
        totalTokens: existing?.totalTokens,
        toolUses: existing?.toolUses,
        durationMs: existing?.durationMs,
        errorMessage: event.errorMessage ?? existing?.errorMessage,
        outputFile: existing?.outputFile,
        parentSessionId: event.sessionId ?? existing?.parentSessionId,
      };
      next.set(key, merged);
      return next;
    });
  }

  /** Reducer for SDK `agent_completed` events. */
  onAgentCompleted(event: AgentCompletedEvent): void {
    const key = event.parentToolUseId;
    if (!key) return;
    this._subagents.update((map) => {
      const existing = map.get(key);
      const next = new Map(map);
      const merged: SubagentRecord = {
        parentToolUseId: key,
        taskId: event.taskId ?? existing?.taskId,
        description: existing?.description,
        latestSummary: event.summary ?? existing?.latestSummary,
        lastToolName: existing?.lastToolName,
        status: event.status,
        totalTokens: event.totalTokens ?? existing?.totalTokens,
        toolUses: event.toolUses ?? existing?.toolUses,
        durationMs: event.durationMs ?? existing?.durationMs,
        errorMessage: existing?.errorMessage,
        outputFile: event.outputFile ?? existing?.outputFile,
        parentSessionId: event.sessionId ?? existing?.parentSessionId,
      };
      next.set(key, merged);
      return next;
    });
  }

  /**
   * Send a follow-up message to a running subagent. Requires the parent
   * SDK session ID — callers usually source this from `tabManager.activeTab`.
   */
  /**
   * Send a follow-up message to a running subagent. Returns `true` when the
   * RPC call succeeded, `false` when an error was recorded. Callers use the
   * return value to conditionally show success / keep-draft UX.
   */
  async continueAgent(
    agentId: string,
    message: string,
  ): Promise<{ ok: boolean; code?: string }> {
    const result = await this.rpc.call('agent:continue', {
      agentId,
      message,
    });
    return { ok: result.isSuccess(), code: result.data?.code };
  }

  /**
   * Send a follow-up ("steer") message into a running subagent.
   *
   * `sessionId` is the session that OWNS the subagent. Callers that know it
   * (e.g. the background-agent tray, which reads `SubagentRecord.parentSessionId`)
   * must pass it so the RPC targets the right Query when multiple canvas tiles
   * are live. It falls back to the active tab's session to preserve callers
   * that render inside the focused session (e.g. inline-agent-bubble).
   */
  async sendMessageToAgent(
    parentToolUseId: string,
    text: string,
    sessionId?: string,
  ): Promise<boolean> {
    const sid = sessionId ?? this.tabManager.activeTabSessionId();
    if (!sid) {
      this.recordSubagentRpcError({
        parentToolUseId,
        method: 'subagent:send-message',
        message: 'No active session — cannot send message to subagent',
        timestamp: Date.now(),
      });
      return false;
    }
    const result = await this.rpc.call('subagent:send-message', {
      sessionId: sid,
      parentToolUseId,
      text,
    });
    if (!result.isSuccess()) {
      this.recordSubagentRpcError({
        parentToolUseId,
        method: 'subagent:send-message',
        message: result.error ?? 'Unknown error',
        timestamp: Date.now(),
      });
      return false;
    }
    this._subagentRpcError.set(null);
    return true;
  }

  /**
   * Stop a running subagent identified by SDK task_id. The matching
   * `parentToolUseId` is looked up so error reporting stays scoped.
   *
   * `sessionId` is the OWNING session; callers that know it (background-agent
   * tray) pass it so the stop resolves the right Query when several tiles are
   * live. Falls back to the active tab's session for focused-surface callers.
   */
  async stopAgent(taskId: string, sessionId?: string): Promise<void> {
    const sid = sessionId ?? this.tabManager.activeTabSessionId();
    const parentToolUseId = this.findParentToolUseIdByTaskId(taskId);
    if (!sid) {
      this.recordSubagentRpcError({
        parentToolUseId: parentToolUseId ?? taskId,
        method: 'subagent:stop',
        message: 'No active session — cannot stop subagent',
        timestamp: Date.now(),
      });
      return;
    }
    const result = await this.rpc.call('subagent:stop', {
      sessionId: sid,
      taskId,
    });
    if (!result.isSuccess()) {
      this.recordSubagentRpcError({
        parentToolUseId: parentToolUseId ?? taskId,
        method: 'subagent:stop',
        message: result.error ?? 'Unknown error',
        timestamp: Date.now(),
      });
    } else {
      this._subagentRpcError.set(null);
    }
  }

  /**
   * Interrupt the entire active session (all running subagents in scope).
   */
  async interruptSession(): Promise<void> {
    const sessionId = this.tabManager.activeTabSessionId();
    if (!sessionId) {
      this.recordSubagentRpcError({
        parentToolUseId: '',
        method: 'subagent:interrupt',
        message: 'No active session — cannot interrupt',
        timestamp: Date.now(),
      });
      return;
    }
    const result = await this.rpc.call('subagent:interrupt', {
      sessionId,
    });
    if (!result.isSuccess()) {
      this.recordSubagentRpcError({
        parentToolUseId: '',
        method: 'subagent:interrupt',
        message: result.error ?? 'Unknown error',
        timestamp: Date.now(),
      });
    } else {
      this._subagentRpcError.set(null);
    }
  }

  /**
   * Move a running foreground subagent to the background. Follows the exact
   * shape of {@link interruptSession}: fire-and-report the RPC, record any
   * error on the shared channel, and never mutate state optimistically — the
   * `background_agent_started` push event is the sole source of truth for the
   * resulting background record.
   *
   * `sessionId` is the OWNING session; callers that know it (background-agent
   * tray, inline bubble via `SubagentRecord.parentSessionId`) pass it, and it
   * falls back to the active tab's session like the sibling commands. Returns
   * `true` when the backend acknowledges the switch.
   *
   * Contract: RPC `subagent:background` with params `{ sessionId, toolUseId? }`
   * → result `{ backgrounded: boolean }`.
   */
  async backgroundAgent(
    sessionId: string | undefined,
    toolUseId?: string,
  ): Promise<boolean> {
    sessionId ??= this.tabManager.activeTabSessionId() ?? undefined;
    if (!sessionId) {
      this.recordSubagentRpcError({
        parentToolUseId: toolUseId ?? '',
        method: 'subagent:background',
        message: 'No session — cannot background agent',
        timestamp: Date.now(),
      });
      return false;
    }
    const result = await this.rpc.call('subagent:background', {
      sessionId,
      toolUseId,
    });
    if (!result.isSuccess()) {
      this.recordSubagentRpcError({
        parentToolUseId: toolUseId ?? '',
        method: 'subagent:background',
        message: result.error ?? 'Unknown error',
        timestamp: Date.now(),
      });
      return false;
    }
    this._subagentRpcError.set(null);
    return result.data?.backgrounded ?? true;
  }

  private findParentToolUseIdByTaskId(taskId: string): string | undefined {
    for (const [key, rec] of this._subagents()) {
      if (rec.taskId === taskId) return key;
    }
    return undefined;
  }

  private recordSubagentRpcError(err: SubagentRpcError): void {
    console.warn(
      '[AgentMonitorStore] Subagent RPC error:',
      err.method,
      err.message,
    );
    this._subagentRpcError.set(err);
  }
}

function capBuffer(str: string, max: number): string {
  if (str.length <= max) return str;
  const excess = str.length - max;
  const idx = str.indexOf('\n', excess);
  return idx > -1 ? str.substring(idx + 1) : str.substring(excess);
}
