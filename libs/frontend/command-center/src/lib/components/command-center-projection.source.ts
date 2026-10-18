import { Injectable, inject } from '@angular/core';
import { ChatStore } from '@ptah-extension/chat';
import { CLI_PROVIDER_MARK_IDS } from '@ptah-extension/chat-ui';
import {
  CommandCenterRecordsService,
  TabManagerService,
} from '@ptah-extension/chat-state';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import type { TabState } from '@ptah-extension/chat-types';
import { PROVIDER_BRAND_SLUGS, PROVIDER_MARKS } from '@ptah-extension/ui';
import type {
  PhaseDerivationInput,
  VendorLane,
} from '@ptah-extension/tribunal-panel/phase';
import type { CommandWorkState } from '../model/command-center.store';
import { workStateForStatus } from '../model/work-state';
import type { ProjectionInput } from '../model/work-projection';

function provider(id: string | null | undefined): string | undefined {
  return id &&
    (Object.hasOwn(PROVIDER_BRAND_SLUGS, id) ||
      Object.hasOwn(PROVIDER_MARKS, id))
    ? id
    : undefined;
}

function cliProvider(
  cli: string,
  ptahCliId?: string | null,
): string | undefined {
  const id = cli === 'ptah-cli' ? ptahCliId : cli;
  return (
    provider(id) ??
    provider(
      Object.hasOwn(CLI_PROVIDER_MARK_IDS, cli)
        ? CLI_PROVIDER_MARK_IDS[cli as keyof typeof CLI_PROVIDER_MARK_IDS]
        : undefined,
    )
  );
}

function tabProvider(tab: TabState | undefined): string | undefined {
  const liveProvider = provider(tab?.liveModelStats?.contextCapacity?.providerId);
  if (liveProvider) return liveProvider;
  const model =
    tab?.liveModelStats?.model || tab?.sessionModel || tab?.overrideModel;
  const usage = tab?.sessionStats?.modelUsageList?.find(
    (row) => row.model === model,
  );
  return provider(usage?.contextCapacity?.providerId) ?? provider(tab?.providerId);
}

const RUN_LAUNCH_WINDOW_MS = 2 * 60 * 1000;

export function runState(
  agents: readonly { readonly status: string }[],
  startedAt: number,
  now: number,
): CommandWorkState {
  if (agents.length === 0)
    return startedAt - now <= RUN_LAUNCH_WINDOW_MS &&
      Math.max(0, now - startedAt) < RUN_LAUNCH_WINDOW_MS
      ? 'starting'
      : 'unknown';
  const states = agents.map((agent) => workStateForStatus(agent.status));
  if (states.includes('running')) return 'running';
  if (states.includes('failed')) return 'failed';
  if (states.includes('awaiting input')) return 'awaiting input';
  if (states.includes('starting')) return 'starting';
  if (states.includes('queued')) return 'queued';
  if (states.includes('unknown')) return 'unknown';
  if (states.includes('cancelled')) return 'cancelled';
  return 'completed';
}

// eslint-disable-next-line @angular-eslint/use-injectable-provided-in -- page-scoped provider
@Injectable()
export class CommandCenterProjectionSource {
  private readonly tabs = inject(TabManagerService);
  private readonly chat = inject(ChatStore);
  private readonly monitor = inject(AgentMonitorStore);
  private readonly records = inject(CommandCenterRecordsService);

  public input(
    root: { tabId: string; sessionId: string },
    now: number,
  ): ProjectionInput {
    const tabs = this.tabs.tabs();
    const sessions = this.chat.sessions();
    const rootTab = tabs.find((tab) => tab.id === root.tabId);
    const sessionByTab = new Map<string, string>(
      tabs.flatMap((tab) =>
        tab.claudeSessionId ? [[tab.id, tab.claudeSessionId] as const] : [],
      ),
    );
    const ownedTabs = new Set([root.tabId]);
    const owned = new Set([root.sessionId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const tab of tabs) {
        if (tab.id === root.tabId || ownedTabs.has(tab.id)) continue;
        const parentTabId = tab.agentOrigin?.parentTabId;
        if (!parentTabId || !ownedTabs.has(parentTabId)) continue;
        ownedTabs.add(tab.id);
        if (tab.claudeSessionId) owned.add(tab.claudeSessionId);
        changed = true;
      }
      for (const session of sessions) {
        const parentSessionId = session.organization?.parentSessionId;
        if (
          session.id === root.sessionId ||
          owned.has(session.id) ||
          !parentSessionId ||
          !owned.has(parentSessionId)
        )
          continue;
        owned.add(session.id);
        changed = true;
      }
    }
    const children = tabs
      .filter((tab) => tab.id !== root.tabId && ownedTabs.has(tab.id))
      .map((tab) => ({
        tabId: tab.id,
        sessionId: tab.claudeSessionId ?? undefined,
        parentSessionId:
          sessionByTab.get(tab.agentOrigin?.parentTabId ?? '') ??
          (tab.agentOrigin?.parentTabId === root.tabId
            ? root.sessionId
            : (tab.agentOrigin?.parentTabId ?? root.sessionId)),
        name: tab.name,
        providerId: tabProvider(tab),
        state: workStateForStatus(tab.status),
        updatedAt: tab.lastActivityAt,
      }));
    const persistedChildren = sessions
      .filter(
        (session) => session.id !== root.sessionId && owned.has(session.id),
      )
      .map((session) => ({
        sessionId: session.id,
        parentSessionId:
          session.organization?.parentSessionId ?? root.sessionId,
        updatedAt: session.lastActivityAt,
      }));
    const cli = this.monitor
      .agents()
      .filter(
        (agent) => agent.parentSessionId && owned.has(agent.parentSessionId),
      )
      .map((agent) => ({
        agentId: agent.agentId,
        kind: 'cli' as const,
        parentSessionId: agent.parentSessionId ?? root.sessionId,
        state: workStateForStatus(agent.status),
        providerId: cliProvider(agent.cli, agent.ptahCliId),
        displayName: agent.displayName,
        task: agent.task,
        runId: agent.workflowRunId,
        updatedAt: agent.completedAt ?? agent.startedAt,
      }));
    const sdk = [...this.monitor.subagents().values()]
      .filter(
        (agent) => agent.parentSessionId && owned.has(agent.parentSessionId),
      )
      .map((agent) => ({
        agentId: agent.agentId ?? agent.parentToolUseId,
        kind: 'sdk' as const,
        parentSessionId: agent.parentSessionId ?? root.sessionId,
        state: workStateForStatus(agent.status),
        providerId: 'anthropic',
        runId: agent.workflowRunId,
        updatedAt: agent.lastEventAt,
      }));
    const workspace =
      rootTab?.commandCenterOrigin?.workspaceId ??
      this.tabs.activeWorkspacePath;
    const runs = workspace
      ? this.records
          .readRunManifests(workspace, root.tabId)
          .filter((manifest) => manifest.rootSdkId === root.sessionId)
          .map((manifest) => {
            const runAgents = this.monitor
              .agents()
              .filter((agent) => agent.workflowRunId === manifest.runId);
            const claimed = new Set<string>();
            const bound = new Map<string, (typeof runAgents)[number] | null>();
            const lanes: VendorLane[] = manifest.lanes.map((lane) => {
              const family = lane.laneId.replace(/#\d+$/, '');
              const agent = runAgents.find(
                (candidate) =>
                  !claimed.has(candidate.agentId) &&
                  (candidate.cli === family ||
                    candidate.ptahCliId === family) &&
                  (!lane.role || candidate.role === lane.role),
              );
              if (agent) claimed.add(agent.agentId);
              bound.set(lane.laneId, agent ?? null);
              return {
                laneId: lane.laneId,
                role: lane.role as VendorLane['role'],
                family,
                displayName: agent?.displayName ?? lane.laneId,
                cli: agent?.cli ?? 'ptah-cli',
                agentId: agent?.agentId,
                providerId: agent
                  ? cliProvider(agent.cli, agent.ptahCliId)
                  : cliProvider(family),
              };
            });
            const phase: PhaseDerivationInput = {
              move: manifest.move,
              specTaskId: manifest.specTaskId,
              laneBindings: {
                lanes,
                bound,
              },
              agents: runAgents,
              artifacts: null,
            };
            return {
              runId: manifest.runId,
              rootSessionId: root.sessionId,
              phase,
              state: runState(runAgents, manifest.startedAt, now),
              updatedAt: manifest.startedAt,
            };
          })
      : [];
    return {
      rootTabId: root.tabId,
      rootSessionId: root.sessionId,
      rootTabStatus: rootTab?.status,
      rootQuestionPending: this.chat
        .questionRequests()
        .some(
          (request) =>
            request.tabId === root.tabId ||
            request.sessionId === root.sessionId,
        ),
      rootProviderId: tabProvider(rootTab),
      children,
      persistedChildren,
      agents: [...cli, ...sdk],
      runs,
    };
  }
}
