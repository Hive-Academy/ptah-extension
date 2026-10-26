import { Injectable, inject } from '@angular/core';
import { AttentionActionDispatcher, type AttentionActionOutcome, AppStateManager, LoggingService,
  ATTENTION_LANE_OPENER, NOTIFICATION_FOCUS_ROUTER, SURFACE_FOCUS_ROUTER, NOTICE_ACTION_HANDLER, NotificationService, attentionConditionKey } from '@ptah-extension/core';
import { AgentPermissionResponder } from './agent-permission-responder';
import { PermissionHandlerService } from '@ptah-extension/chat-streaming';
import { APPROVAL_DECISION_ACTIONS, ChatAttentionSourceService } from './chat-attention-source.service';
import { ChatAttentionHostMessageHandler } from './chat-attention-host-message-handler.service';
import type { PermissionResponse } from '@ptah-extension/shared';

function isPermissionDecision(value: string): value is PermissionResponse['decision'] {
  return value === 'allow' || value === 'always_allow' || value === 'deny' || value === 'deny_with_message';
}

/** Shell registration binds this service to ATTENTION_ACTION_DISPATCHER. */
@Injectable({ providedIn: 'root' })
export class ChatAttentionActionDispatcherService implements AttentionActionDispatcher {
  private readonly source = inject(ChatAttentionSourceService);
  private readonly responder = inject(AgentPermissionResponder);
  private readonly permissions = inject(PermissionHandlerService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(NOTIFICATION_FOCUS_ROUTER, { optional: true });
  private readonly laneOpener = inject(ATTENTION_LANE_OPENER, { optional: true });
  private readonly surfaceRouters = inject(SURFACE_FOCUS_ROUTER, { optional: true }) ?? [];
  private readonly noticeHandlers = inject(NOTICE_ACTION_HANDLER, { optional: true }) ?? [];
  private readonly host = inject(ChatAttentionHostMessageHandler, { optional: true });
  private readonly appState = inject(AppStateManager);
  private readonly logger = inject(LoggingService);
  private readonly inFlight = new Set<string>();

  async dispatchOutcome(key: string, generation: number, actionId: string, reason?: string): Promise<AttentionActionOutcome> {
    const live = this.source.getLive(key, generation);
    if (!live && actionId !== 'open') {
      return this.dispatchNoticeOutcome(key, generation, actionId);
    }
    const action = live?.item.actions.find(candidate => candidate.id === actionId);
    if (live && (!action || action.disabledReason)) {
      this.unavailable(action?.disabledReason ?? 'Action unavailable');
      return { kind: 'unavailable', reason: action?.disabledReason ?? 'Action unavailable' };
    }
    if (live?.target.kind === 'permission' && ['allow', 'always_allow', 'deny', 'deny_with_message', 'cancel'].includes(actionId) &&
      !this.responder.isSessionPending(live.target.request.id)) {
      this.unavailable('Already answered');
      return { kind: 'stale' };
    }
    return await this.dispatch(key, generation, actionId, reason)
      ? { kind: 'completed' }
      : { kind: 'unavailable', reason: 'Could not complete action' };
  }

  async dispatch(key: string, generation: number, actionId: string, reason?: string): Promise<boolean> {
    const live = this.source.getLive(key, generation);
    if (!live) {
      if (actionId !== 'open') return (await this.dispatchNoticeOutcome(key, generation, actionId)).kind === 'completed';
      return this.host ? this.host.openProjected(key, generation) : this.unavailable('Already answered');
    }
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
        if (!this.router || (!item.workspacePath && !item.tabId) || !item.sessionId) return this.unavailable('Target unavailable');
        const outcome = await this.router.focus({
          workspacePath: item.workspacePath, sessionId: item.sessionId, tabId: item.tabId,
        });
        if (!outcome.success) return this.unavailable('Target unavailable');
        if (actionId === 'open' && target.kind === 'lane-permission' && item.tabId) {
          // The lane may have ended while the session was being focused.
          // Session focus remains the usable fallback in that case.
          if (!this.laneOpener?.open(item.tabId, target.agentId)) {
            this.logger.warn('ChatAttentionActionDispatcherService', 'Lane detail unavailable; session focused');
          }
        }
        return true;
      }
      if (target.kind === 'permission' && target.request.allowedDecisions) {
        // Native requests answer only with their own decisions; no message or edited input.
        const native = APPROVAL_DECISION_ACTIONS.find(candidate => candidate.id === actionId);
        if (!native) return this.unavailable('Action unavailable');
        return this.permissions.handleApprovalDecision(target.request.id, native.decision, target.tabId)
          || this.unavailable('Action unavailable');
      }
      if (!isPermissionDecision(actionId)) return this.unavailable('Action unavailable');
      if (target.kind === 'question') return this.unavailable('Action unavailable');
      if (target.kind === 'lane-permission') {
        if (actionId !== 'allow' && actionId !== 'deny') return this.unavailable('Action unavailable');
        return this.responder.respondLane(target.agentId, target.request.requestId, actionId);
      }
      if (actionId === 'deny_with_message' && !reason?.trim()) return this.unavailable('Enter a reason');
      return reason === undefined
        ? this.responder.respondSession(target.request, actionId, target.tabId)
        : this.responder.respondSession(target.request, actionId, target.tabId, reason);
    } catch (error) {
      return this.reportActionFailure(live, error);
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async dispatchNoticeOutcome(key: string, generation: number, actionId: string): Promise<AttentionActionOutcome> {
    const handler = this.noticeHandlers.find(candidate => candidate.canHandle(key, actionId));
    if (!handler) {
      this.unavailable('Already answered');
      return { kind: 'stale' };
    }
    if (this.inFlight.has(key)) {
      this.unavailable('Action unavailable');
      return { kind: 'unavailable', reason: 'Action unavailable' };
    }
    this.inFlight.add(key);
    try {
      return await handler.run(key, generation, actionId);
    } catch (error) {
      this.logger.warn('ChatAttentionActionDispatcherService', `Notice action failed (${error instanceof Error ? error.name : 'unknown'})`);
      this.unavailable('Could not complete action');
      return { kind: 'unavailable', reason: 'Could not complete action' };
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
