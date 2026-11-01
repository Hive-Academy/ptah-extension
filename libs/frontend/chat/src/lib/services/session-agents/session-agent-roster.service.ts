import { Injectable, inject } from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  AgentMonitorStore,
  BackgroundAgentStore,
  PermissionHandlerService,
} from '@ptah-extension/chat-streaming';
import type {
  AskUserQuestionRequest,
  PermissionRequest,
} from '@ptah-extension/shared';
import {
  buildSessionAgentRoster,
  orchestratorAgent,
  type SessionAgent,
} from './session-agent-roster';

/** The open requests of one tab, split by kind. */
export interface TabRequests {
  readonly permissions: readonly PermissionRequest[];
  readonly questions: readonly AskUserQuestionRequest[];
}

const NO_REQUESTS: TabRequests = { permissions: [], questions: [] };

/**
 * The one source of a session's agents for the dock and the inspector.
 * Both methods only read signals: callers wrap them in their own `computed`,
 * so there is no per-tab cache and nothing to release.
 */
@Injectable({ providedIn: 'root' })
export class SessionAgentRosterService {
  private readonly monitor = inject(AgentMonitorStore);
  private readonly background = inject(BackgroundAgentStore);
  private readonly permissionHandler = inject(PermissionHandlerService);
  private readonly tabManager = inject(TabManagerService);

  /**
   * Open permission and question requests targeted at `tabId`: the routed
   * target tabs first, else the tab that owns `request.sessionId` (the rule
   * of the compact session card). A request whose tab cannot be resolved is
   * not counted.
   */
  requestsForTab(tabId: string | null): TabRequests {
    this.permissionHandler.routingTargetRevision();
    if (!tabId) return NO_REQUESTS;
    return {
      permissions: this.permissionHandler
        .permissionRequests()
        .filter((request) =>
          this.targetsTab(
            request,
            this.permissionHandler.targetTabsFor(request.id),
            tabId,
          ),
        ),
      questions: this.permissionHandler
        .questionRequests()
        .filter((request) =>
          this.targetsTab(
            request,
            this.permissionHandler.questionTargetTabsFor(request.id),
            tabId,
          ),
        ),
    };
  }

  /**
   * The agents of the session in `tabId`, in dock order. An unknown tab
   * yields the Orchestrator alone with no status.
   */
  roster(tabId: string | null): readonly SessionAgent[] {
    const tab = tabId
      ? (this.tabManager.findTabByIdAcrossWorkspaces(tabId)?.tab ?? null)
      : null;
    if (!tab) return [orchestratorAgent(null, [])];
    const { permissions, questions } = this.requestsForTab(tab.id);
    const roster = buildSessionAgentRoster({
      sessionId: tab.claudeSessionId ?? null,
      tabStatus: tab.status,
      subagents: [...this.monitor.subagents().values()],
      cliAgents: this.monitor.agents(),
      backgroundAgents: this.background.agents(),
      permissions,
      questions,
    });
    // Pre-stream failures have no turn_state broadcast. Their sender stamps
    // the terminal reason while settling the tab, whose status is still loaded.
    if (tab.status !== 'loaded') return roster;
    if (tab.lastTerminalReason === 'api_error') {
      return [
        orchestratorAgent('failed', roster[0].openRequestIds),
        ...roster.slice(1),
      ];
    }
    if (!tab.claudeSessionId) {
      return [orchestratorAgent(null, roster[0].openRequestIds), ...roster.slice(1)];
    }
    return roster;
  }

  private targetsTab(
    request: AskUserQuestionRequest | PermissionRequest,
    targetIds: readonly string[],
    tabId: string,
  ): boolean {
    if (targetIds.length > 0) {
      return targetIds.some(
        (targetId) =>
          this.tabManager.findTabByIdAcrossWorkspaces(targetId)?.tab.id ===
          tabId,
      );
    }
    if (!request.sessionId) return false;
    return (
      this.tabManager.findTabBySessionIdAcrossWorkspaces(request.sessionId)
        ?.tab.id === tabId
    );
  }
}
