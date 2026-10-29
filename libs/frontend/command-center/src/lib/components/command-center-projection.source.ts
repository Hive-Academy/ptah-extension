import { Injectable, inject } from '@angular/core';
import { ChatStore } from '@ptah-extension/chat';
import { CLI_PROVIDER_MARK_IDS } from '@ptah-extension/chat-ui';
import { TabManagerService } from '@ptah-extension/chat-state';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import type { TabState } from '@ptah-extension/chat-types';
import { PROVIDER_BRAND_SLUGS, PROVIDER_MARKS } from '@ptah-extension/ui';
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
  const liveProvider = provider(
    tab?.liveModelStats?.contextCapacity?.providerId,
  );
  if (liveProvider) return liveProvider;
  const model =
    tab?.liveModelStats?.model || tab?.sessionModel || tab?.overrideModel;
  const usage = tab?.sessionStats?.modelUsageList?.find(
    (row) => row.model === model,
  );
  return (
    provider(usage?.contextCapacity?.providerId) ?? provider(tab?.providerId)
  );
}

// eslint-disable-next-line @angular-eslint/use-injectable-provided-in -- page-scoped provider
@Injectable()
export class CommandCenterProjectionSource {
  private readonly tabs = inject(TabManagerService);
  private readonly chat = inject(ChatStore);
  private readonly monitor = inject(AgentMonitorStore);

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
        startedAt: agent.startedAt,
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
        displayName: agent.teammateName ?? agent.agentType,
        task: agent.taskDescription ?? agent.description,
        startedAt: agent.startedAt,
        updatedAt: agent.lastEventAt ?? agent.completedAt ?? agent.startedAt,
      }));
    return {
      rootTabId: root.tabId,
      rootSessionId: root.sessionId,
      now,
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
    };
  }
}
