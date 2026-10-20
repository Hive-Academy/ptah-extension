import { Injectable, inject } from '@angular/core';
import { AttentionActionDispatcher, type AttentionActionOutcome, AppStateManager, LoggingService,
  NOTIFICATION_FOCUS_ROUTER, SURFACE_FOCUS_ROUTER, NotificationService, attentionConditionKey } from '@ptah-extension/core';
import { AgentPermissionResponder } from './agent-permission-responder';
import { ChatAttentionSourceService } from './chat-attention-source.service';
import { ChatAttentionHostMessageHandler } from './chat-attention-host-message-handler.service';

/** Shell registration binds this service to ATTENTION_ACTION_DISPATCHER. */
@Injectable({ providedIn: 'root' })
export class ChatAttentionActionDispatcherService implements AttentionActionDispatcher {
  private readonly source = inject(ChatAttentionSourceService);
  private readonly responder = inject(AgentPermissionResponder);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(NOTIFICATION_FOCUS_ROUTER, { optional: true });
  private readonly surfaceRouters = inject(SURFACE_FOCUS_ROUTER, { optional: true }) ?? [];
  private readonly host = inject(ChatAttentionHostMessageHandler, { optional: true });
  private readonly appState = inject(AppStateManager);
  private readonly logger = inject(LoggingService);
  private readonly inFlight = new Set<string>();

  async dispatchOutcome(key: string, generation: number, actionId: string): Promise<AttentionActionOutcome> {
    const live = this.source.getLive(key, generation);
    if (!live && actionId !== 'open') {
      this.unavailable('Already answered');
      return { kind: 'stale' };
    }
    const action = live?.item.actions.find(candidate => candidate.id === actionId);
    if (live && (!action || action.disabledReason)) {
      this.unavailable(action?.disabledReason ?? 'Action unavailable');
      return { kind: 'unavailable', reason: action?.disabledReason ?? 'Action unavailable' };
    }
    return await this.dispatch(key, generation, actionId)
      ? { kind: 'completed' }
      : { kind: 'unavailable', reason: 'Could not complete action' };
  }

  async dispatch(key: string, generation: number, actionId: string): Promise<boolean> {
    const live = this.source.getLive(key, generation);
    if (!live) return actionId === 'open' && this.host
      ? this.host.openProjected(key, generation) : this.unavailable('Already answered');
    const action = live.item.actions.find(candidate => candidate.id === actionId);
    if (!action || action.disabledReason || this.inFlight.has(key)) return this.unavailable(action?.disabledReason ?? 'Action unavailable');
    this.inFlight.add(key);
    try {
      const { item, target } = live;
      if (actionId === 'open' || actionId === 'answer') {
        if (item.ownerSurface === 'surface') {
          const surface = this.surfaceRouters.find(candidate => !!item.sessionId && candidate.canFocus(item.sessionId));
          if (!surface || !item.sessionId) return this.unavailable('Target unavailable');
          const result = await surface.focus(item.sessionId);
          return result.success || this.unavailable('Target unavailable');
        }
        if (!this.router || !item.workspacePath || !item.sessionId) return this.unavailable('Target unavailable');
        const outcome = await this.router.focus({
          workspacePath: item.workspacePath, sessionId: item.sessionId, tabId: item.tabId,
        });
        if (!outcome.success) return this.unavailable('Target unavailable');
        return true;
      }
      if (actionId !== 'allow' && actionId !== 'deny') return this.unavailable('Action unavailable');
      if (target.kind === 'question') return this.unavailable('Action unavailable');
      if (target.kind === 'lane-permission') {
        return this.responder.respondLane(target.agentId, target.request.requestId, actionId);
      }
      if (!target.tabId) return this.unavailable('Session unavailable');
      return this.responder.respondSession(target.request, actionId, target.tabId);
    } catch (error) {
      return this.reportActionFailure(live, error);
    } finally {
      this.inFlight.delete(key);
    }
  }

  private unavailable(message: string): false {
    this.appState.setStatusMessage(message);
    return false;
  }

  private reportActionFailure(live: NonNullable<ReturnType<ChatAttentionSourceService['getLive']>>, error: unknown): false {
      this.logger.warn('ChatAttentionActionDispatcherService', `Attention action failed (${error instanceof Error ? error.name : 'unknown'})`);
      this.notifications.upsert({
        key: attentionConditionKey(live.item.workspacePath, `action-failed:${live.item.key}`),
        generation: Date.now(), kind: 'failure', source: 'chat',
        workspacePath: live.item.workspacePath, workspaceName: live.item.workspaceName,
        sessionId: live.item.sessionId, tabId: live.item.tabId,
        severity: 'error', title: 'Could not complete action',
        actions: [], actionable: false, soundEligible: false,
      });
      return this.unavailable('Could not complete action');
  }
}
