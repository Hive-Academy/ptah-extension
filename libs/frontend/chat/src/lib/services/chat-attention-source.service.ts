import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, effect, inject, untracked } from '@angular/core';
import { CommandCenterVoiceSessionService, TabManagerService, workspaceLabelFromPath } from '@ptah-extension/chat-state';
import { AgentMonitorStore, PermissionHandlerService } from '@ptah-extension/chat-streaming';
import { AttentionItem, NotificationService, SURFACE_FOCUS_ROUTER, VSCodeService } from '@ptah-extension/core';
import { attentionRequestKey } from '@ptah-extension/shared';
import type { AgentPermissionRequest, AskUserQuestionRequest, PermissionRequest, SessionApprovalDecision } from '@ptah-extension/shared';
import { attentionContext, isUnsafeAttentionContext } from './attention-context.util';

/**
 * Actions for a native (Codex) request, in display order. Accept and decline
 * reuse the `allow`/`deny` ids so the shared action row shows them as the
 * primary pair; the dispatcher resolves every id through this table, never
 * through the Claude decision vocabulary.
 */
export const APPROVAL_DECISION_ACTIONS: readonly {
  readonly decision: SessionApprovalDecision;
  readonly id: string;
  readonly label: string;
}[] = [
  { decision: 'accept', id: 'allow', label: 'Accept' },
  { decision: 'acceptForSession', id: 'always_allow', label: 'Accept for session' },
  { decision: 'decline', id: 'deny', label: 'Decline' },
  { decision: 'cancel', id: 'cancel', label: 'Cancel' },
];

export type ChatAttentionRequest =
  | { kind: 'permission'; request: PermissionRequest; tabId?: string }
  | { kind: 'question'; request: AskUserQuestionRequest; tabId?: string }
  | { kind: 'lane-permission'; request: AgentPermissionRequest; agentId: string; tabId?: string };

interface LiveAttention {
  item: AttentionItem;
  target: ChatAttentionRequest;
}

// Extra name parts must start with `_` or `-`, so `author` or `tokens` are not secret keys.
const SECRET_NAME = '(?:[A-Za-z0-9]+[_-])*(?:password|passwd|secret|token|api[_-]?key|auth)(?:[_-][A-Za-z0-9]+)*';
const ASSIGNED_SECRET = new RegExp(`(\\b${SECRET_NAME}\\s*=\\s*)(?:"[^"]*"|'[^']*'|[^\\s]+)`, 'gi');
const FLAG_SECRET = new RegExp(`(--${SECRET_NAME}\\s+)(?:"[^"]*"|'[^']*'|[^\\s]+)`, 'gi');
const TOKEN_SHAPE = /\b(?:sk-[\w-]{8,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9_]+|xoxb-[A-Za-z0-9-]+|[0-9a-f]{32,}|[A-Za-z0-9+/_-]{40,}={0,2})\b/gi;

function safePreview(text: string, limit: number): string {
  const plain = text.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
  const redacted = plain.replace(ASSIGNED_SECRET, '$1***').replace(FLAG_SECRET, '$1***')
    .replace(TOKEN_SHAPE, '***');
  return redacted.length > limit ? `${redacted.slice(0, limit)}...` : redacted;
}

/** Mirrors the old card's compact input fields, with control characters and sensitive values removed. */
function permissionPreview(request: PermissionRequest): string {
  const input = request.toolInput;
  let value = '';
  if (typeof input['command'] === 'string') value = safePreview(input['command'], 40);
  else if (typeof input['file_path'] === 'string') {
    const parts = input['file_path'].replace(/\\/g, '/').split('/');
    value = safePreview(parts.length > 2 ? `.../${parts.slice(-2).join('/')}` : input['file_path'], 50);
  } else if (typeof input['pattern'] === 'string') value = safePreview(input['pattern'], 30);
  else value = Object.entries(input).slice(0, 3).map(([key, entry]) => {
    if (/secret|token|password|key|credential/i.test(key)) return `${key}: [redacted]`;
    if (typeof entry === 'string') return `${key}: ${safePreview(entry, 30)}`;
    if (typeof entry === 'number' || typeof entry === 'boolean') return `${key}: ${entry}`;
    return `${key}: [structured input]`;
  }).join(', ');
  const description = safePreview(request.description, 50);
  return [value ? `Input: ${value}` : 'Input: {}', description && `Description: ${description}`]
    .filter(Boolean).join(' · ').slice(0, 160);
}

/** Reconciles authoritative prompt queues with the shared attention model. */
@Injectable({ providedIn: 'root' })
export class ChatAttentionSourceService {
  private readonly permissions = inject(PermissionHandlerService);
  private readonly agents = inject(AgentMonitorStore);
  private readonly tabs = inject(TabManagerService);
  private readonly voice = inject(CommandCenterVoiceSessionService);
  private readonly notifications = inject(NotificationService);
  private readonly vscode = inject(VSCodeService);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly surfaceRouters = inject(SURFACE_FOCUS_ROUTER, { optional: true }) ?? [];
  private readonly live = new Map<string, LiveAttention>();
  private readonly sessionWorkspaces = new Map<string, string>();
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
      this.tabs.activeWorkspacePath$();
      this.vscode.config();
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
    if (owner?.workspacePath && sessionId) this.sessionWorkspaces.set(sessionId, owner.workspacePath);
    const workspacePath = owner?.workspacePath ?? (sessionId ? this.sessionWorkspaces.get(sessionId) : undefined) ?? '';
    const labelPath = workspacePath || (owner ? this.tabs.activeWorkspacePath ?? this.vscode.config().workspaceRoot ?? '' : '');
    const key = attentionRequestKey(kind, requestId);
    if (next.has(key)) return;
    const previous = this.live.get(key);
    const sameRequestMoved = [...this.live.values()].some(entry =>
      entry.item.kind === kind && entry.item.key !== key &&
      (entry.target.kind === 'lane-permission'
        ? entry.target.request.requestId : entry.target.request.id) === requestId);
    const generation = previous?.item.generation ?? ++this.generationSequence;
    const resolvedSessionId = sessionId || owner?.tab.claudeSessionId || owner?.tab.id;
    const tab = owner?.tab;
    const sessionTitle = tab?.title?.trim() && tab.titleOrigin !== 'default' &&
      !/^(new chat|new session|untitled|permission required|question needs an answer|lane permission required)$/i.test(tab.title.trim()) ? tab.title.trim() : '';
    const safeTitle = sessionTitle && !isUnsafeAttentionContext(sessionTitle)
      ? sessionTitle.slice(0, 80) : '';
    const provider = tab?.providerId === 'claude-cli' ? 'Claude'
      : tab?.providerId === 'ptah-cli' ? 'Ptah CLI'
      : tab?.providerId === 'vscode-lm' ? 'VS Code' : '';
    const toolName = typeof target.request.toolName === 'string' ? target.request.toolName.trim() : '';
    const safeTool = /^[\w .:-]{1,50}$/.test(toolName) ? toolName : '';
    const question = target.kind === 'question'
      ? target.request.questions[0]?.question.replace(/\s+/g, ' ').trim() ?? '' : '';
    const safeQuestion = question && !isUnsafeAttentionContext(question)
      ? question.length > 80 ? `${question.slice(0, 79)}…` : question : '';
    const context = attentionContext([provider, safeTitle,
      target.kind === 'question' ? safeQuestion : safeTool ? `Tool: ${safeTool}` : '']);
    const surfaceOwner = this.surfaceRouters.find(router =>
      !!resolvedSessionId && router.canFocus(resolvedSessionId));
    const surfaceOwned = !!surfaceOwner && (surfaceMode || !owner);
    const open = !!resolvedSessionId && (surfaceOwned || (!!owner && !surfaceMode));
    const allowed = target.kind === 'permission' ? target.request.allowedDecisions : undefined;
    const actions: AttentionItem['actions'][number][] = allowed
      ? APPROVAL_DECISION_ACTIONS.filter(action => allowed.includes(action.decision)).map(({ id, label }) => ({ id, label }))
      : kind === 'question'
      ? [{ id: 'answer', label: 'Answer', ...(!open && { disabledReason: 'Session unavailable' }) }]
      : [{ id: 'allow', label: 'Allow', ...(kind !== 'permission' && (!tabId || !canAllow) && { disabledReason: !tabId ? 'Session unavailable' : 'Unknown tool' }) },
          ...(kind === 'permission' ? [{ id: 'always_allow', label: 'Always allow' }] : []),
          { id: 'deny', label: 'Deny', ...(kind !== 'permission' && !tabId && { disabledReason: 'Session unavailable' }) }];
    if (kind === 'permission' && !allowed) actions.push({ id: 'deny_with_message', label: 'Deny with message' });
    actions.push({ id: 'open', label: surfaceOwned || surfaceMode ? 'Open' : 'Show in canvas',
      ...(!open && { disabledReason: 'Session unavailable' }) });
    const item: AttentionItem = {
      key, generation, kind, source: 'chat', workspacePath,
      workspaceName: labelPath ? workspaceLabelFromPath(labelPath) : 'Unknown workspace',
      sessionId: resolvedSessionId || undefined, tabId: owner?.tab.id, ownerSurface: surfaceOwned || surfaceMode ? 'surface' : 'chat',
      severity: 'warning', title, context: context || undefined,
      sessionTitle: safeTitle || undefined, provider: provider || undefined,
      detail: target.kind === 'question' ? safeQuestion || undefined : safeTool ? `Tool: ${safeTool}` : undefined,
      permissionPreview: target.kind === 'permission' ? permissionPreview(target.request) : undefined,
      actions, actionable: true,
      soundEligible: !sameRequestMoved && !this.voice.isActive(owner?.tab.id ?? ''),
    };
    next.set(key, { item, target });
  }
}
