/**
 * Agent Monitor Store
 *
 * Signal-based store for real-time agent process monitoring.
 * Tracks spawned agents, streams output, and manages the sidebar panel state.
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
  CliSessionReference,
} from '@ptah-extension/shared';
import { TabManagerService } from './tab-manager.service';
import { VSCodeService } from '@ptah-extension/core';

/** Maximum stdout/stderr buffer per agent in the frontend (50KB) */
const MAX_FRONTEND_BUFFER = 50 * 1024;

/** Maximum number of simultaneously expanded agent cards */
const MAX_EXPANDED_AGENTS = 2;

/** Maximum streamEvents buffer per agent (prevents unbounded memory growth) */
const MAX_STREAM_EVENTS = 2000;

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
  /** Structured output segments from SDK-based adapters (Gemini, Codex, Copilot). */
  segments: CliOutputSegment[];
  /** Rich streaming events from Ptah CLI adapter. Enables ExecutionNode rendering. */
  streamEvents: FlatStreamEventUnion[];
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
  /** Queue of pending permission requests from the agent (Copilot SDK) */
  permissionQueue: AgentPermissionRequest[];
  /** Ptah CLI agent registry ID (only set when cli === 'ptah-cli'). Needed for resume. */
  readonly ptahCliId?: string;
  /** Human-readable display name for the CLI agent (e.g., 'Gemini CLI', 'Codex'). */
  readonly displayName?: string;
  /** Model identifier used by the CLI agent (e.g., 'gemini-2.5-pro', 'gpt-4o'). */
  readonly model?: string;
}

@Injectable({ providedIn: 'root' })
export class AgentMonitorStore implements OnDestroy {
  private readonly tabManager = inject(TabManagerService);
  private readonly vscodeService = inject(VSCodeService);

  // Private mutable state
  private readonly _agents = signal<Map<string, MonitoredAgent>>(new Map());
  private readonly _panelOpen = signal(false);
  /** Tracks whether the user explicitly closed the panel (prevents auto-reopen) */
  private _userExplicitlyClosed = false;
  /** Monotonic counter for tracking expand order (oldest = lowest value) */
  private _expandOrder = 0;

  /**
   * TASK_2025_211: Tracks agent descriptions (tasks) that have been resumed.
   * Used by inline-agent-bubble to upgrade 'interrupted' → 'resumed' visuals.
   * Key: `${parentSessionId}::${task}` for scoped matching (CLI agent case).
   */
  private readonly _resumedAgentKeys = signal<Set<string>>(new Set());

  /**
   * TASK_2025_211: Tracks specific agent node IDs that have been resumed.
   * When a new agent of the same type is spawned while an interrupted agent
   * of that type exists, the SPECIFIC interrupted agent's node ID is stored here.
   * This prevents false positives when multiple agents of the same type exist.
   */
  private readonly _resumedAgentNodeIds = signal<Set<string>>(new Set());

  /** Whether this webview instance is the sidebar (not an editor panel) */
  get isSidebar(): boolean {
    const panelId = this.vscodeService.config().panelId;
    return !panelId || panelId === '';
  }

  /**
   * Whether the "pop out to editor" button should be highlighted.
   * True when agents are actively running and we're in the narrow sidebar.
   */
  readonly shouldSuggestEditorPanel = computed(
    () =>
      this.isSidebar &&
      Array.from(this._agents().values()).some((a) => a.status === 'running'),
  );

  /**
   * Shared tick signal incremented every 1s while agents are running.
   * Agent cards derive elapsed time from this instead of per-card setInterval.
   */
  readonly tick = signal(0);
  private _tickInterval: ReturnType<typeof setInterval> | null = null;

  // Public computed signals — ALL agents (used for global indicators like header badges)
  readonly agents = computed(() => {
    const map = this._agents();
    return Array.from(map.values()).sort((a, b) => b.startedAt - a.startedAt);
  });

  /**
   * Agents filtered to the active tab's session.
   * Shows only agents whose parentSessionId matches the active tab's claudeSessionId.
   * Agents with no parentSessionId are shown in all tabs (backward compatibility).
   * When no tab is active or the active tab has no session, all agents are shown.
   */
  readonly activeTabAgents = computed(() => {
    const all = this.agents();
    const activeSessionId = this.tabManager.activeTab()?.claudeSessionId;

    if (!activeSessionId) return all;
    return all.filter(
      (a) => !a.parentSessionId || a.parentSessionId === activeSessionId,
    );
  });

  readonly hasRunningAgents = computed(() =>
    this.agents().some((a) => a.status === 'running'),
  );

  readonly agentCount = computed(() => this._agents().size);

  /** Agents that currently have a pending permission request (global — all tabs) */
  readonly pendingPermissions = computed(() =>
    this.agents().filter((a) => a.permissionQueue.length > 0),
  );

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
      (a) => a.status === 'running',
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

  /**
   * TASK_2025_211: Check if a specific interrupted agent has been resumed.
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

    // Strategy 1: SDK subagent resume (matched by specific node ID or toolCallId)
    if (nodeId && resumedIds.has(nodeId)) return true;
    if (toolCallId && resumedIds.has(toolCallId)) return true;

    // Strategy 2: CLI agent resume (matched by parentSessionId::task)
    const keys = this._resumedAgentKeys();
    for (const key of keys) {
      if (key.endsWith(`::${taskOrDescription}`)) return true;
    }
    return false;
  }

  /**
   * TASK_2025_211: Mark specific agent node IDs as resumed.
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

  // Agent lifecycle
  onAgentSpawned(info: AgentProcessInfo): void {
    // Check before adding — auto-open on 0→1 transition only
    const hadAgents = this._agents().size > 0;

    this._agents.update((map) => {
      const next = new Map(map);

      // If this is a resumed agent, replace the old card in-place
      // instead of creating a new one (avoids flicker and duplicate cards)
      if (info.resumedFromAgentId && next.has(info.resumedFromAgentId)) {
        const oldCard = next.get(info.resumedFromAgentId)!;

        // TASK_2025_211: Track this agent as resumed so inline bubbles can
        // show 'Resumed' badge instead of 'Interrupted'.
        if (oldCard.parentSessionId && oldCard.task) {
          this._resumedAgentKeys.update((set) => {
            const next = new Set(set);
            next.add(`${oldCard.parentSessionId}::${oldCard.task}`);
            return next;
          });
        }
        next.delete(info.resumedFromAgentId);
        next.set(info.agentId, {
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
          parentSessionId: info.parentSessionId,
          cliSessionId: info.cliSessionId,
          ptahCliId: info.ptahCliId,
          permissionQueue: [],
          displayName: info.displayName || info.ptahCliName,
          model: info.model,
        });
      } else {
        const order = this._expandOrder++;
        next.set(info.agentId, {
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
          parentSessionId: info.parentSessionId,
          cliSessionId: info.cliSessionId,
          ptahCliId: info.ptahCliId,
          permissionQueue: [],
          displayName: info.displayName || info.ptahCliName,
          model: info.model,
        });
        this.enforceMaxExpanded(next);
      }

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
        // Merge last existing segment with first incoming segment of the same
        // streamable type (text or thinking) to prevent fragmentation across flush boundaries
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

      // Accumulate FlatStreamEventUnion events (Ptah CLI only)
      if (delta.streamEvents && delta.streamEvents.length > 0) {
        const combined = [...agent.streamEvents, ...delta.streamEvents];
        if (combined.length > MAX_STREAM_EVENTS) {
          updated.streamEvents = capStreamEvents(combined, MAX_STREAM_EVENTS);
        } else {
          updated.streamEvents = combined;
        }
      }

      next.set(delta.agentId, updated);
      return next;
    });
  }

  onAgentExited(info: AgentProcessInfo): void {
    this._agents.update((map) => {
      const agent = map.get(info.agentId);
      if (!agent) return map;

      const completedAt = info.completedAt
        ? new Date(info.completedAt).getTime()
        : Date.now();

      const next = new Map(map);
      next.set(info.agentId, {
        ...agent,
        status: info.status,
        exitCode: info.exitCode,
        cliSessionId: info.cliSessionId || agent.cliSessionId,
        completedAt,
        permissionQueue: [],
      });
      return next;
    });

    this.syncTick();
  }

  /** Handle incoming permission request from Copilot SDK agent */
  onPermissionRequest(request: AgentPermissionRequest): void {
    this._agents.update((map) => {
      const agent = map.get(request.agentId);
      if (!agent) return map;
      const next = new Map(map);

      // Auto-expand the card so the user can see and respond to the permission
      const needsExpand = !agent.expanded;
      const order = needsExpand ? this._expandOrder++ : agent.expandedAt;

      next.set(request.agentId, {
        ...agent,
        permissionQueue: [...agent.permissionQueue, request],
        expanded: true,
        expandedAt: order,
      });

      if (needsExpand) {
        this.enforceMaxExpanded(next);
      }

      return next;
    });

    // Also ensure the panel is open so the user sees the permission
    this._panelOpen.set(true);
  }

  /** Shift the first permission off the queue (after user responds). Next one auto-shows. */
  clearPermission(agentId: string): void {
    this._agents.update((map) => {
      const agent = map.get(agentId);
      if (!agent) return map;
      const next = new Map(map);
      next.set(agentId, {
        ...agent,
        permissionQueue: agent.permissionQueue.slice(1),
      });
      return next;
    });
  }

  toggleAgentExpanded(agentId: string): void {
    this._agents.update((map) => {
      const agent = map.get(agentId);
      if (!agent) return map;

      const next = new Map(map);

      if (agent.expanded) {
        // Collapsing — just toggle off
        next.set(agentId, { ...agent, expanded: false, expandedAt: undefined });
      } else {
        // Expanding — assign order and enforce max-2 rule
        const order = this._expandOrder++;
        next.set(agentId, { ...agent, expanded: true, expandedAt: order });
        this.enforceMaxExpanded(next);
      }

      return next;
    });
  }

  /**
   * Enforce that at most MAX_EXPANDED_AGENTS are expanded at once.
   * Collapses the oldest expanded card(s) when the limit is exceeded.
   * Mutates the provided map in place (caller creates the new Map).
   */
  private enforceMaxExpanded(map: Map<string, MonitoredAgent>): void {
    const expanded = Array.from(map.values()).filter((a) => a.expanded);
    if (expanded.length <= MAX_EXPANDED_AGENTS) return;

    // Sort by expandedAt ascending — oldest first
    expanded.sort((a, b) => (a.expandedAt ?? 0) - (b.expandedAt ?? 0));

    // Collapse the oldest until we're at the limit
    const toCollapse = expanded.length - MAX_EXPANDED_AGENTS;
    for (let i = 0; i < toCollapse; i++) {
      const agent = expanded[i];
      map.set(agent.agentId, {
        ...agent,
        expanded: false,
        expandedAt: undefined,
      });
    }
  }

  /**
   * Load CLI sessions from a saved session's metadata (TASK_2025_168).
   * Converts CliSessionReference[] to MonitoredAgent[] and adds them to the store.
   * Called when loading/resuming a session that had CLI agents spawned.
   * Agents from other sessions are preserved — activeTabAgents handles display filtering.
   * Auto-opens the panel if sessions are loaded.
   */
  loadCliSessions(
    cliSessions: CliSessionReference[],
    parentSessionId?: string,
  ): void {
    if (cliSessions.length === 0) return;

    this._agents.update((map) => {
      // Preserve all existing agents — tab-scoped filtering handles display.
      // Only clear stale non-running agents for THIS session to allow fresh reload.
      const next = new Map(map);
      if (parentSessionId) {
        for (const [id, agent] of next) {
          if (
            agent.parentSessionId === parentSessionId &&
            agent.status !== 'running'
          ) {
            next.delete(id);
          }
        }
      }

      for (const ref of cliSessions) {
        // Skip if a live agent with same ID is already running
        if (!next.has(ref.agentId)) {
          const ts = new Date(ref.startedAt).getTime();
          next.set(ref.agentId, {
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
            cliSessionId: ref.cliSessionId,
            parentSessionId,
            ptahCliId: ref.ptahCliId,
            permissionQueue: [],
          });
        }
      }
      return next;
    });

    // Auto-open panel to show loaded sessions
    if (!this._userExplicitlyClosed) {
      this._panelOpen.set(true);
    }
  }

  /**
   * Remove a single agent card from the store.
   * Used when resuming a stopped agent — the old card is removed and a new
   * one is created by the incoming agent:spawned event.
   */
  /**
   * Remove all non-running agents belonging to a specific session.
   * Called when a tab is closed to clean up its associated agent cards.
   * Running agents are preserved (they'll complete in the background).
   */
  clearSessionAgents(sessionId: string): void {
    this._agents.update((map) => {
      let changed = false;
      const next = new Map(map);
      for (const [id, agent] of next) {
        if (agent.parentSessionId === sessionId && agent.status !== 'running') {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : map;
    });
  }

  removeAgent(agentId: string): void {
    this._agents.update((map) => {
      if (!map.has(agentId)) return map;
      const next = new Map(map);
      next.delete(agentId);
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

/** Landmark event types that establish tree structure and must be preserved */
const LANDMARK_EVENT_TYPES = new Set([
  'message_start',
  'tool_start',
  'agent_start',
  'thinking_start',
  'message_complete',
]);

/**
 * Cap stream events buffer by dropping oldest delta events while preserving
 * landmark events that establish the tree structure.
 * When the buffer exceeds `max`, landmarks are always kept. The remaining
 * budget is filled with the most recent non-landmark (delta) events.
 * Events are returned in their original order.
 */
function capStreamEvents(
  events: FlatStreamEventUnion[],
  max: number,
): FlatStreamEventUnion[] {
  if (events.length <= max) return events;

  // Partition into landmarks and deltas, tracking original indices
  const landmarks: Array<{ event: FlatStreamEventUnion; index: number }> = [];
  const deltas: Array<{ event: FlatStreamEventUnion; index: number }> = [];
  for (let i = 0; i < events.length; i++) {
    if (LANDMARK_EVENT_TYPES.has(events[i].eventType)) {
      landmarks.push({ event: events[i], index: i });
    } else {
      deltas.push({ event: events[i], index: i });
    }
  }

  // Keep all landmarks + most recent deltas to fill remaining budget
  const deltasBudget = max - landmarks.length;
  if (deltasBudget <= 0) {
    // Extreme case: more landmarks than budget -- keep most recent landmarks
    return landmarks.slice(-max).map((l) => l.event);
  }

  const keptDeltas = deltas.slice(-deltasBudget);

  // Merge back in original order
  const merged = [...landmarks, ...keptDeltas].sort(
    (a, b) => a.index - b.index,
  );
  return merged.map((m) => m.event);
}
