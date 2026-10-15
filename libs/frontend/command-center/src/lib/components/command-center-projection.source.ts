import { Injectable, inject } from '@angular/core';
import { ChatStore } from '@ptah-extension/chat';
import {
  CommandCenterRecordsService,
  TabManagerService,
} from '@ptah-extension/chat-state';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import { PROVIDER_BRAND_SLUGS } from '@ptah-extension/ui';
import type {
  PhaseDerivationInput,
  VendorLane,
} from '@ptah-extension/tribunal-panel/phase';
import type { CommandWorkState } from '../model/command-center.store';
import type { ProjectionInput } from '../model/work-projection';

function provider(id: string | null | undefined): string | undefined {
  return id && Object.hasOwn(PROVIDER_BRAND_SLUGS, id) ? id : undefined;
}

function state(status: string): CommandWorkState {
  switch (status) {
    case 'streaming':
    case 'resuming':
    case 'running':
    case 'background':
      return 'running';
    case 'pending':
    case 'draft':
      return 'queued';
    case 'fresh':
    case 'switching':
      return 'starting';
    case 'paused':
    case 'awaiting-background':
      return 'awaiting input';
    case 'completed':
      return 'completed';
    case 'failed':
    case 'timeout':
      return 'failed';
    case 'killed':
    case 'stopped':
      return 'cancelled';
    default:
      return 'unknown';
  }
}

// eslint-disable-next-line @angular-eslint/use-injectable-provided-in -- page-scoped provider
@Injectable()
export class CommandCenterProjectionSource {
  private readonly tabs = inject(TabManagerService);
  private readonly chat = inject(ChatStore);
  private readonly monitor = inject(AgentMonitorStore);
  private readonly records = inject(CommandCenterRecordsService);

  public input(root: { tabId: string; sessionId: string }): ProjectionInput {
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
        providerId: provider(tab.liveModelStats?.contextCapacity?.providerId),
        state: state(tab.status),
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
        state: state(agent.status),
        providerId: provider(agent.ptahCliId ?? agent.cli),
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
        state: state(agent.status),
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
                providerId: provider(agent?.ptahCliId ?? agent?.cli),
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
              state:
                runAgents.length === 0
                  ? ('starting' as const)
                  : runAgents.some((agent) => agent.status === 'running')
                    ? ('running' as const)
                    : runAgents.some(
                          (agent) =>
                            agent.status === 'failed' ||
                            agent.status === 'timeout',
                        )
                      ? ('failed' as const)
                      : runAgents.every(
                            (agent) =>
                              agent.status === 'completed' ||
                              agent.status === 'stopped',
                          )
                        ? ('completed' as const)
                        : ('starting' as const),
              updatedAt: manifest.startedAt,
            };
          })
      : [];
    return {
      rootTabId: root.tabId,
      rootSessionId: root.sessionId,
      rootProviderId: provider(
        rootTab?.liveModelStats?.contextCapacity?.providerId,
      ),
      children,
      persistedChildren,
      agents: [...cli, ...sdk],
      runs,
    };
  }
}
