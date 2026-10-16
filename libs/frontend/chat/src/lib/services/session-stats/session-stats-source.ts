import { LOCALE_ID, computed, inject, type Signal } from '@angular/core';
import {
  buildStatsLimitViewModel,
  sessionContextCue,
  sessionLimitSummary,
  type SessionStatsInputs,
  type StatsLimitLaneRun,
  type StatsLimitViewModel,
} from '@ptah-extension/chat-ui';
import {
  AgentMonitorStore,
  type MonitoredAgent,
} from '@ptah-extension/chat-streaming';
import type { TabState } from '@ptah-extension/chat-types';
import { PlanLimitsStore } from '@ptah-extension/core';
import type {
  CliType,
  LocalTimeOptions,
  SessionBudgetState,
} from '@ptah-extension/shared';
import { ChatStore } from '../chat.store';

/** What a stats host resolves; every getter is read reactively. */
export interface SessionStatsHost {
  /** Tab of a scoped view (SESSION_CONTEXT tile, Rail board); `null` in the main panel. */
  readonly tab: () => TabState | null;
  /** The host's resolved session id (main panel: ChatStore.currentSessionId()). */
  readonly sessionId: () => string | null;
  /** The host's budget (chat-view: resolvedSessionBudget; Rail: focusedTab()?.sessionBudget ?? null). */
  readonly budget: () => SessionBudgetState | null;
  /** When false, `inputs` is null (chat-view: the old strip mount rule, the view has messages). */
  readonly available: () => boolean;
}

export interface SessionStatsSource {
  /** The one set of session stats inputs; `null` only when `available()` is false. */
  readonly inputs: Signal<SessionStatsInputs | null>;
  /** Owner keys recorded at the session's lane runs, for the host's plan-limits scope. */
  readonly runOwnerKeys: Signal<readonly string[]>;
}

/** Product names of the lane CLIs, for runs that carry no display name. */
const CLI_LABELS: Readonly<Record<CliType, string>> = {
  codex: 'Codex',
  copilot: 'Copilot',
  cursor: 'Cursor',
  antigravity: 'Antigravity',
  opencode: 'OpenCode',
  pi: 'Pi',
  grok: 'Grok',
  'ptah-cli': 'Ptah CLI',
};

/**
 * Map one lane run to the stats limit view-model input (TASK_2026_596,
 * Component 15). Every field comes from the run record; nothing is guessed.
 * - `restored` is the flag `loadCliSessions` sets, never inferred from status.
 * - `cliLabel` is the agent card's own display name; a run without one (a
 *   restored run) gets the CLI's product name, never the raw id.
 * - `modelScope` is the backend-resolved value; the UI never derives one from
 *   a model id string.
 * - `quotaOwner` and `usageTotals` pass through; absent or `null` reads
 *   unknown, never the current owner and never 0.
 */
export function toStatsLimitLaneRun(agent: MonitoredAgent): StatsLimitLaneRun {
  return {
    runId: agent.agentId,
    cli: agent.cli,
    cliLabel: agent.displayName || CLI_LABELS[agent.cli],
    role: agent.role ?? null,
    model: agent.usageTotals?.model ?? agent.model ?? null,
    modelScope: agent.modelScope ?? null,
    status: agent.status,
    restored: agent.restored === true,
    startedAt: agent.startedAt,
    failureKind: agent.failureKind,
    quotaOwner: agent.quotaOwner,
    usageTotals: agent.usageTotals,
  };
}

/** Sorted, de-duplicated recorded owner keys; a run with no owner adds none. */
function recordedOwnerKeys(agents: readonly MonitoredAgent[]): string[] {
  const keys = new Set<string>();
  for (const agent of agents) {
    const key = agent.quotaOwner?.key;
    if (key) keys.add(key);
  }
  return [...keys].sort((a, b) => a.localeCompare(b));
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/**
 * The one source of a session view's stats (SESSION, PLAN LIMITS, LANES).
 * A scoped view reads its tab's values; the main panel (no tab) reads the
 * ChatStore, so it shows the active session's figures. Registers no
 * plan-limits scope and starts no timer: the host keeps its own scope and
 * feeds it `runOwnerKeys`, and the clock is the store's shared tick.
 *
 * Call in an injection context.
 */
export function injectSessionStatsSource(
  host: SessionStatsHost,
): SessionStatsSource {
  const chatStore = inject(ChatStore);
  const planLimits = inject(PlanLimitsStore);
  const agentMonitorStore = inject(AgentMonitorStore);

  /** Explicit zone and zone-name locale for reset times; never a fixed UTC. */
  const limitTime: LocalTimeOptions = {
    timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
    zoneNameLocale: inject(LOCALE_ID),
  };

  /** The backend session snapshot every stats figure comes from. */
  const snapshot = computed(() => {
    const tab = host.tab();
    return tab !== null
      ? (tab.sessionStats ?? null)
      : chatStore.sessionStats();
  });

  const liveModelStats = computed(() => {
    const tab = host.tab();
    return tab !== null
      ? (tab.liveModelStats ?? null)
      : chatStore.liveModelStats();
  });

  const compactionCount = computed(() => {
    const tab = host.tab();
    return tab !== null
      ? (tab.compactionCount ?? 0)
      : chatStore.compactionCount();
  });

  /**
   * Lane runs belong only to this view's own session (F58). A view with no
   * session gets none; a lane whose parent session is not resolved yet is in
   * no session's quota or lane tiles (exact parent match only).
   */
  const laneRuns = computed<readonly MonitoredAgent[]>(() => {
    const sessionId = host.sessionId();
    return sessionId ? agentMonitorStore.agentsOwnedBySession(sessionId) : [];
  });

  /**
   * Owner keys recorded at this session's runs, so the host also returns the
   * snapshots of past owners. Structural equality keeps streaming deltas from
   * re-triggering a load; only a changed key set does.
   */
  const runOwnerKeys = computed<readonly string[]>(
    () => recordedOwnerKeys(laneRuns()),
    { equal: sameStrings },
  );

  /**
   * Plan-limit tiles and lane tiles; `null` without a session or before the
   * first snapshot.
   */
  const limits = computed<StatsLimitViewModel | null>(() => {
    const sessionId = host.sessionId();
    const limitsSnapshot = planLimits.snapshot();
    if (!sessionId || !limitsSnapshot) return null;
    const sessionOwner = planLimits.sessionOwner(sessionId);
    return buildStatsLimitViewModel({
      sessionId,
      sessionOwnerKey: sessionOwner?.ownerKey ?? null,
      // Backend-resolved scope only; the UI never parses the model id.
      sessionModelScope: sessionOwner?.modelScope ?? null,
      owners: limitsSnapshot.owners,
      laneRuns: laneRuns().map(toStatsLimitLaneRun),
      now: planLimits.now(),
      time: limitTime,
      refreshFailed: planLimits.loadError(),
    });
  });

  const inputs = computed<SessionStatsInputs | null>(() => {
    if (!host.available()) return null;
    const live = liveModelStats();
    const limitView = limits();
    return {
      sessionId: host.sessionId(),
      snapshot: snapshot(),
      liveModelStats: live,
      compactionCount: compactionCount(),
      limits: limitView,
      budget: host.budget(),
      context: sessionContextCue(live),
      limitSummary: sessionLimitSummary(limitView),
    };
  });

  return { inputs, runOwnerKeys };
}
