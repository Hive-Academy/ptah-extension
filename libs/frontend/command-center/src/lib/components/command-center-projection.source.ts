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
    const rootTab = tabs.find((tab) => tab.id === root.tabId);
    const children = tabs
      .filter((tab) => tab.agentOrigin?.parentTabId === root.tabId)
      .map((tab) => ({
        tabId: tab.id,
        sessionId: tab.claudeSessionId ?? undefined,
        parentSessionId: root.sessionId,
        name: tab.name,
        providerId: provider(tab.liveModelStats?.contextCapacity?.providerId),
        state: state(tab.status),
        updatedAt: tab.lastActivityAt,
      }));
    const persistedChildren = this.chat
      .sessions()
      .filter(
        (session) => session.organization?.parentSessionId === root.sessionId,
      )
      .map((session) => ({
        sessionId: session.id,
        parentSessionId: root.sessionId,
        updatedAt: session.lastActivityAt,
      }));
    const owned = new Set([
      root.sessionId,
      ...children.flatMap((child) =>
        child.sessionId ? [child.sessionId] : [],
      ),
      ...persistedChildren.map((child) => child.sessionId),
    ]);
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
            const lanes: VendorLane[] = manifest.lanes.map((lane) => {
              const agent = runAgents.find(
                (candidate) => candidate.agentId === lane.laneId,
              );
              return {
                laneId: lane.laneId,
                role: lane.role as VendorLane['role'],
                family: agent?.cli ?? 'unknown',
                displayName: agent?.cli ?? lane.laneId,
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
                bound: new Map(
                  lanes.map((lane) => [
                    lane.laneId,
                    runAgents.find((agent) => agent.agentId === lane.agentId) ??
                      null,
                  ]),
                ),
              },
              agents: runAgents,
              artifacts: null,
            };
            return {
              runId: manifest.runId,
              rootSessionId: root.sessionId,
              phase,
              state: runAgents.some((agent) => agent.status === 'running')
                ? ('running' as const)
                : ('unknown' as const),
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
