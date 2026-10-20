import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, effect, inject, untracked } from '@angular/core';
import { CommandCenterVoiceSessionService, TabManagerService, workspaceLabelFromPath } from '@ptah-extension/chat-state';
import { AgentMonitorStore, PermissionHandlerService } from '@ptah-extension/chat-streaming';
import { AttentionItem, NotificationService, SURFACE_FOCUS_ROUTER } from '@ptah-extension/core';
import { attentionRequestKey } from '@ptah-extension/shared';
import type { AgentPermissionRequest, AskUserQuestionRequest, PermissionRequest } from '@ptah-extension/shared';

export type ChatAttentionRequest =
  | { kind: 'permission'; request: PermissionRequest; tabId?: string }
  | { kind: 'question'; request: AskUserQuestionRequest; tabId?: string }
  | { kind: 'lane-permission'; request: AgentPermissionRequest; agentId: string; tabId?: string };

interface LiveAttention {
  item: AttentionItem;
  target: ChatAttentionRequest;
}

/** Reconciles authoritative prompt queues with the shared attention model. */
@Injectable({ providedIn: 'root' })
export class ChatAttentionSourceService {
  private readonly permissions = inject(PermissionHandlerService);
  private readonly agents = inject(AgentMonitorStore);
  private readonly tabs = inject(TabManagerService);
  private readonly voice = inject(CommandCenterVoiceSessionService);
  private readonly notifications = inject(NotificationService);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly surfaceRouters = inject(SURFACE_FOCUS_ROUTER, { optional: true }) ?? [];
  private readonly live = new Map<string, LiveAttention>();
  private generationSequence = 0;

  constructor() {
    const refresh = () => untracked(() => this.refreshSuppression());
    this.document.addEventListener('visibilitychange', refresh);
    this.document.defaultView?.addEventListener('focus', refresh);
    this.document.defaultView?.addEventListener('blur', refresh);
    this.destroyRef.onDestroy(() => {
      this.document.removeEventListener('visibilitychange', refresh);
      this.document.defaultView?.removeEventListener('focus', refresh);
      this.document.defaultView?.removeEventListener('blur', refresh);
    });
    effect(() => {
      this.permissions.permissionRequests();
      this.permissions.questionRequests();
      this.permissions.routingTargetRevision();
      this.agents.pendingPermissions();
      this.tabs.tabs();
      this.tabs.activeTabId();
      this.tabs.visibleTabIds();
      untracked(() => this.reconcile());
    });
  }

  getLive(key: string, generation: number): LiveAttention | undefined {
    const entry = this.live.get(key);
    return entry?.item.generation === generation ? entry : undefined;
  }

  private reconcile(): void {
    const next = new Map<string, LiveAttention>();
    for (const request of this.permissions.permissionRequests()) {
      const tabId = this.findTabId(request.tabId, request.sessionId, this.permissions.targetTabsFor(request.id));
      this.add(next, 'permission', request.id, request.sessionId, tabId,
        { kind: 'permission', request, tabId }, !!request.toolName,
        request.toolName ? `Permission: ${request.toolName}` : 'Permission required', request.surfaceMode);
    }
    for (const request of this.permissions.questionRequests()) {
      const tabId = this.findTabId(request.tabId, request.sessionId, this.permissions.questionTargetTabsFor(request.id));
      this.add(next, 'question', request.id, request.sessionId, tabId,
        { kind: 'question', request, tabId }, false, 'Question needs an answer', request.surfaceMode);
    }
    for (const agent of this.agents.pendingPermissions()) {
      const tabId = this.findTabId(undefined, agent.parentSessionId, []);
      for (const request of agent.permissionQueue) {
        this.add(next, 'lane-permission', request.requestId, agent.parentSessionId, tabId,
          { kind: 'lane-permission', request, agentId: agent.agentId, tabId }, !!request.toolName,
          request.toolName ? `Lane permission: ${request.toolName}` : 'Lane permission required');
      }
    }
    const previousLive = new Map(this.live);
    for (const [key, previous] of previousLive) {
      if (!next.has(key)) {
        this.notifications.setSnackbarSuppressed(key, false, 'inline');
        this.notifications.resolve(key, previous.item.generation, 'chat');
      }
    }
    this.live.clear();
    for (const [key, entry] of next) {
      const previous = previousLive.get(key);
      this.live.set(key, entry);
      if (!previous || JSON.stringify(previous.item) !== JSON.stringify(entry.item)) this.notifications.upsert(entry.item);
    }
    this.refreshSuppression();
  }

  private refreshSuppression(): void {
    for (const [key, entry] of this.live) {
      const visible = !!entry.item.tabId &&
        (this.tabs.activeTabId() === entry.item.tabId || this.tabs.visibleTabIds().has(entry.item.tabId)) &&
        this.document.visibilityState === 'visible' && this.document.hasFocus();
      this.notifications.setSnackbarSuppressed(key, visible, 'inline');
    }
  }

  private findTabId(direct: string | undefined, sessionId: string | undefined, targets: readonly string[]): string | undefined {
    if (direct && this.tabs.findTabByIdAcrossWorkspaces(direct)) return direct;
    const target = targets.find(id => this.tabs.findTabByIdAcrossWorkspaces(id));
    return target ?? (sessionId ? this.tabs.findTabBySessionIdAcrossWorkspaces(sessionId)?.tab.id : undefined);
  }

  private add(
    next: Map<string, LiveAttention>, kind: 'permission' | 'question' | 'lane-permission',
    requestId: string, sessionId: string | undefined, tabId: string | undefined,
    target: ChatAttentionRequest, canAllow: boolean, title: string, surfaceMode = false,
  ): void {
    const owner = tabId ? this.tabs.findTabByIdAcrossWorkspaces(tabId) :
      sessionId ? this.tabs.findTabBySessionIdAcrossWorkspaces(sessionId) : null;
    const workspacePath = owner?.workspacePath ?? '';
    const key = attentionRequestKey(kind, requestId);
    if (next.has(key)) return;
    const previous = this.live.get(key);
    const sameRequestMoved = [...this.live.values()].some(entry =>
      entry.item.kind === kind && entry.item.key !== key &&
      (entry.target.kind === 'lane-permission'
        ? entry.target.request.requestId : entry.target.request.id) === requestId);
    const generation = previous?.item.generation ?? ++this.generationSequence;
    const resolvedSessionId = sessionId || owner?.tab.claudeSessionId || owner?.tab.id;
    const surfaceRoutable = !surfaceMode || this.surfaceRouters.some(router =>
      !!resolvedSessionId && router.canFocus(resolvedSessionId));
    const open = !!owner && !!resolvedSessionId && surfaceRoutable;
    const actions = kind === 'question'
      ? [{ id: 'answer', label: 'Answer', ...(!open && { disabledReason: 'Session unavailable' }) }]
      : [{ id: 'allow', label: 'Allow', ...((!tabId || !canAllow) && { disabledReason: !tabId ? 'Session unavailable' : 'Unknown tool' }) },
          { id: 'deny', label: 'Deny', ...(!tabId && { disabledReason: 'Session unavailable' }) }];
    actions.push({ id: 'open', label: 'Open', ...(!open && { disabledReason: 'Session unavailable' }) });
    const item: AttentionItem = {
      key, generation, kind, source: 'chat', workspacePath,
      workspaceName: workspacePath ? workspaceLabelFromPath(workspacePath) : 'Unknown workspace',
      sessionId: resolvedSessionId || undefined, tabId: owner?.tab.id, ownerSurface: surfaceMode ? 'surface' : 'chat',
      severity: 'warning', title, actions, actionable: true,
      soundEligible: !sameRequestMoved && !this.voice.isActive(owner?.tab.id ?? ''),
    };
    next.set(key, { item, target });
  }
}
