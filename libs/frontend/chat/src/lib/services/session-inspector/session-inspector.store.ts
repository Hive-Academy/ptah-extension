import {
  DestroyRef,
  Injectable,
  computed,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import type { SessionStatus, TabState } from '@ptah-extension/chat-types';
import type { ExecutionChatMessage } from '@ptah-extension/shared';
import { parseLaneKey } from '../../components/molecules/compact-session/compact-lane-rows';
import type { SessionAgent } from '../session-agents/session-agent-roster';
import { SessionAgentRosterService } from '../session-agents/session-agent-roster.service';
import {
  ORCHESTRATOR_OWNER_KEY,
  mergeInspectorRequests,
  type LaneRequestEntry,
} from './session-inspector-requests';
import type {
  InspectorAgentRow,
  InspectorRequest,
  OrchestratorCardModel,
  OrchestratorState,
  SessionInspectorModel,
} from './session-inspector.types';

const NO_MESSAGES: readonly ExecutionChatMessage[] = [];
const BUSY_STATUSES: ReadonlySet<SessionStatus> = new Set([
  'streaming',
  'resuming',
]);

/** Row order bucket: needs attention, then live, then finished. */
function rowBucket(agent: SessionAgent): 0 | 1 | 2 {
  if (agent.openRequestIds.length > 0 || agent.status === 'waiting') return 0;
  if (agent.status === 'running' || agent.status === 'queued') return 1;
  return 2;
}

/** Descending by `value`, `null` last. */
function newestFirst(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

/**
 * AGENTS rows: open requests or `waiting` first, then running / queued by
 * newest start, then done / failed / stopped by most recent end. Stable, so
 * equal rows keep roster order.
 */
function orderAgentRows(rows: readonly InspectorAgentRow[]): InspectorAgentRow[] {
  return [...rows].sort((a, b) => {
    const bucket = rowBucket(a.agent) - rowBucket(b.agent);
    if (bucket !== 0) return bucket;
    if (rowBucket(a.agent) === 1)
      return newestFirst(a.agent.startedAt, b.agent.startedAt);
    if (rowBucket(a.agent) === 2)
      return newestFirst(a.agent.endedAt, b.agent.endedAt);
    return 0;
  });
}

function isFinished(agent: SessionAgent): boolean {
  return (
    agent.status === 'done' ||
    agent.status === 'failed' ||
    agent.status === 'stopped'
  );
}

/** Turns as the transcript groups them: a run of user messages opens one. */
function countTurns(messages: readonly ExecutionChatMessage[]): number | null {
  let turns = 0;
  let previous: ExecutionChatMessage['role'] | null = null;
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'user' && previous !== 'user') turns++;
    previous = message.role;
  }
  return turns > 0 ? turns : null;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function orchestratorState(
  status: SessionStatus | null,
  orchestratorRequests: number,
  liveAgents: number,
): OrchestratorState {
  if (orchestratorRequests > 0) return { kind: 'needs-you' };
  const busy = status !== null && BUSY_STATUSES.has(status);
  if (busy && liveAgents > 0) return { kind: 'waiting', agents: liveAgents };
  if (busy) return { kind: 'working' };
  return { kind: 'idle' };
}

function orchestratorCard(
  tab: TabState | null,
  state: OrchestratorState,
  turns: number | null,
  requests: readonly InspectorRequest[],
): OrchestratorCardModel {
  const live = tab?.liveModelStats ?? null;
  const stats = tab?.sessionStats ?? null;
  const contextKnown = live !== null && live.contextKnown !== false;
  const tokens =
    stats === null
      ? null
      : (stats.tokenCount ??
        stats.tokens.input +
          stats.tokens.output +
          stats.tokens.cacheRead +
          stats.tokens.cacheCreation);
  return {
    model: live?.model || stats?.model || null,
    state,
    contextPercent: contextKnown ? finiteOrNull(live.contextPercent) : null,
    contextWindow: contextKnown ? finiteOrNull(live.contextWindow) : null,
    tokens: finiteOrNull(tokens),
    cost: finiteOrNull(stats?.totalCost),
    turns,
    requests,
  };
}

/**
 * The one session-scoped aggregate of the inspector: agent rows, open
 * requests, needs-you count and Orchestrator state. One cached `computed`
 * per tab; the entry is dropped when the tab closes, so nothing outlives its
 * tab and no timer runs.
 */
@Injectable({ providedIn: 'root' })
export class SessionInspectorStore {
  private readonly tabManager = inject(TabManagerService);
  private readonly roster = inject(SessionAgentRosterService);
  private readonly monitor = inject(AgentMonitorStore);
  private readonly models = new Map<string, Signal<SessionInspectorModel>>();
  /**
   * Request ids whose question card the host could not find (B §5 answer
   * routing). Transient: cleared on Retry or when a later attempt succeeds.
   */
  private readonly answerMisses = signal<ReadonlySet<string>>(new Set());

  constructor() {
    const unsubscribe = this.tabManager.onTabClosed(({ tabId }) =>
      this.forget(tabId),
    );
    inject(DestroyRef).onDestroy(() => {
      unsubscribe();
      this.models.clear();
    });
  }

  /** The inspector model of `tabId`; callers guard a null tab id. */
  modelFor(tabId: string): Signal<SessionInspectorModel> {
    let model = this.models.get(tabId);
    if (!model) {
      model = this.createModel(tabId);
      this.models.set(tabId, model);
    }
    return model;
  }

  /** Release the cached model of a closed tab. */
  forget(tabId: string): void {
    this.models.delete(tabId);
  }

  /** The host found no question card for `requestId`: its row shows the error. */
  reportAnswerMiss(requestId: string): void {
    const misses = this.answerMisses();
    if (misses.has(requestId)) return;
    this.answerMisses.set(new Set(misses).add(requestId));
  }

  /** Clear the miss of `requestId` (Retry, or the card was found). */
  clearAnswerMiss(requestId: string): void {
    const misses = this.answerMisses();
    if (!misses.has(requestId)) return;
    const next = new Set(misses);
    next.delete(requestId);
    this.answerMisses.set(next);
  }

  /** Whether the last answer attempt for `requestId` found no card (reactive). */
  answerMissed(requestId: string): boolean {
    return this.answerMisses().has(requestId);
  }

  private createModel(tabId: string): Signal<SessionInspectorModel> {
    const tab = computed(
      () => this.tabManager.findTabByIdAcrossWorkspaces(tabId)?.tab ?? null,
    );
    // Default equality: turns recount only when the message array changes,
    // not on every status or stats update of the tab.
    const messages = computed(() => tab()?.messages ?? NO_MESSAGES);
    const turns = computed(() => countTurns(messages()));

    return computed((): SessionInspectorModel => {
      const current = tab();
      const roster = this.roster.roster(tabId);
      const { permissions, questions } = this.roster.requestsForTab(
        current ? tabId : null,
      );
      const requests = mergeInspectorRequests({
        permissions,
        questions,
        lanes: current ? this.laneRequests(roster) : [],
        roster,
      });

      const byOwner = new Map<string, InspectorRequest[]>();
      for (const request of requests) {
        const list = byOwner.get(request.ownerKey);
        if (list) list.push(request);
        else byOwner.set(request.ownerKey, [request]);
      }

      const agentRows = orderAgentRows(
        roster
          .filter((agent) => agent.key !== ORCHESTRATOR_OWNER_KEY)
          .map((agent) => ({
            agent,
            requests: byOwner.get(agent.key) ?? [],
          })),
      );
      const finished = agentRows.filter((row) => isFinished(row.agent)).length;
      const liveAgents = agentRows.filter(
        (row) =>
          row.agent.status === 'running' ||
          row.agent.status === 'waiting' ||
          row.agent.status === 'queued',
      ).length;
      const silentWaiting = agentRows.filter(
        (row) =>
          row.agent.status === 'waiting' &&
          row.agent.openRequestIds.length === 0,
      ).length;

      const orchestratorRequests = byOwner.get(ORCHESTRATOR_OWNER_KEY) ?? [];
      return {
        tabId,
        sessionId: current?.claudeSessionId ?? null,
        orchestrator: orchestratorCard(
          current,
          orchestratorState(
            current?.status ?? null,
            orchestratorRequests.length,
            liveAgents,
          ),
          current ? turns() : null,
          orchestratorRequests,
        ),
        agents: current
          ? {
              status: 'ready',
              data: {
                rows: agentRows,
                active: agentRows.filter((row) => rowBucket(row.agent) < 2)
                  .length,
                finished,
              },
            }
          : { status: 'unknown', data: null },
        requests,
        needsYouCount: requests.length + silentWaiting,
      };
    });
  }

  /** Queued permissions of the roster's CLI lanes, with their owner row. */
  private laneRequests(
    roster: readonly SessionAgent[],
  ): readonly LaneRequestEntry[] {
    const byId = this.monitor.agentsById();
    const entries: LaneRequestEntry[] = [];
    for (const agent of roster) {
      if (agent.kind !== 'cli') continue;
      const id = parseLaneKey(agent.key)?.id;
      const lane = id ? byId.get(id) : undefined;
      if (!lane) continue;
      for (const request of lane.permissionQueue) {
        entries.push({
          ownerKey: agent.key,
          ownerName: agent.name,
          agentId: lane.agentId,
          request,
        });
      }
    }
    return entries;
  }
}
