import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject } from '@angular/core';
import {
  AppStateManager, ClaudeRpcService, LoggingService, NotificationService,
  type AttentionItem, type MessageHandler,
  NOTIFICATION_FOCUS_ROUTER, SURFACE_FOCUS_ROUTER, VSCodeService,
} from '@ptah-extension/core';
import { TabManagerService, workspaceLabelFromPath } from '@ptah-extension/chat-state';
import {
  AttentionChangedPayloadSchema, AttentionNoticeSchema,
  AttentionOpenTargetPayloadSchema, MESSAGE_TYPES,
  type AttentionNotice, type AttentionTarget, workspaceIdFromPath,
} from '@ptah-extension/shared';
import { z } from 'zod';
import { attentionContext, isUnsafeAttentionContext } from './attention-context.util';

const SnapshotSchema = z.object({ notices: z.array(AttentionNoticeSchema) }).strict();
const LOG_CONTEXT = 'ChatAttentionHostMessageHandler';

/** Reconciles the host's safe attention projection and handles native notification clicks. */
@Injectable({ providedIn: 'root' })
export class ChatAttentionHostMessageHandler implements MessageHandler {
  readonly handledMessageTypes = [
    MESSAGE_TYPES.ATTENTION_CHANGED,
    MESSAGE_TYPES.ATTENTION_OPEN_TARGET,
  ] as const;

  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly rpc = inject(ClaudeRpcService);
  private readonly notifications = inject(NotificationService);
  private readonly tabs = inject(TabManagerService);
  private readonly vscode = inject(VSCodeService);
  private readonly appState = inject(AppStateManager);
  private readonly focusRouter = inject(NOTIFICATION_FOCUS_ROUTER, { optional: true });
  private readonly surfaceRouters = inject(SURFACE_FOCUS_ROUTER, { optional: true }) ?? [];
  private readonly logger = inject(LoggingService);
  private readonly projected = new Map<string, number>();
  private readonly targets = new Map<string, AttentionTarget>();
  private readonly generationFloor = new Map<string, number>();
  private revision = 0;
  private reconciling = false;
  private reconcileAgain = false;
  private retryTimeout: ReturnType<typeof setTimeout> | undefined;
  private snapshotFailures = 0;

  constructor() {
    const view = this.document.defaultView;
    const reveal = () => {
      if (!this.document.hidden) {
        this.snapshotFailures = 0;
        if (this.retryTimeout) clearTimeout(this.retryTimeout);
        this.retryTimeout = undefined;
        void this.reconcile();
      }
    };
    this.document.addEventListener('visibilitychange', reveal);
    view?.addEventListener('focus', reveal);
    this.destroyRef.onDestroy(() => {
      this.document.removeEventListener('visibilitychange', reveal);
      view?.removeEventListener('focus', reveal);
      if (this.retryTimeout) clearTimeout(this.retryTimeout);
    });
    queueMicrotask(() => void this.reconcile());
  }

  /** Focus a projected host row through the same snapshot guard as native Open. */
  async openProjected(key: string, generation: number): Promise<boolean> {
    const target = this.targets.get(key);
    if (!target || this.projected.get(key) !== generation) {
      this.appState.setStatusMessage('Target unavailable');
      return false;
    }
    return this.openIfPending(key, generation, target);
  }

  handleMessage(message: { type: string; payload?: unknown }): void {
    if (message.type === MESSAGE_TYPES.ATTENTION_CHANGED) {
      const parsed = AttentionChangedPayloadSchema.safeParse(message.payload);
      if (!parsed.success) {
        this.logger.warn(LOG_CONTEXT, 'Invalid attention change dropped');
        return;
      }
      this.revision++;
      if (parsed.data.change === 'resolve') {
        const { key, generation } = parsed.data;
        if (generation < (this.generationFloor.get(key) ?? -1)) return;
        this.generationFloor.set(key, generation);
        if (this.generationFloor.size > 256) this.generationFloor.delete(this.generationFloor.keys().next().value!);
        this.resolveProjection(key, generation);
      } else {
        this.upsertProjection(parsed.data.notice);
      }
      return;
    }
    if (message.type === MESSAGE_TYPES.ATTENTION_OPEN_TARGET) {
      const parsed = AttentionOpenTargetPayloadSchema.safeParse(message.payload);
      if (!parsed.success) {
        this.logger.warn(LOG_CONTEXT, 'Invalid attention target dropped');
        return;
      }
      void this.openIfPending(parsed.data.key, parsed.data.generation, parsed.data.target);
    }
  }

  private async fetchSnapshot(): Promise<readonly AttentionNotice[] | null> {
    try {
      const result = await this.rpc.call('attention:getSnapshot', {}, { timeout: 5000 });
      if (!result.isSuccess()) {
        this.logger.warn(LOG_CONTEXT, 'Attention snapshot unavailable');
        return null;
      }
      const parsed = SnapshotSchema.safeParse(result.data);
      if (!parsed.success) {
        this.logger.warn(LOG_CONTEXT, 'Invalid attention snapshot dropped');
        return null;
      }
      return parsed.data.notices;
    } catch (error) {
      return this.snapshotFailure(error);
    }
  }

  private snapshotFailure(error: unknown): null {
    this.logger.warn(LOG_CONTEXT, `Attention snapshot failed (${error instanceof Error ? error.name : 'unknown'})`);
    return null;
  }

  private async reconcile(): Promise<void> {
    if (this.reconciling) {
      this.reconcileAgain = true;
      return;
    }
    this.reconciling = true;
    const startedAtRevision = this.revision;
    try {
      const notices = await this.fetchSnapshot();
      if (!notices) {
        this.snapshotFailures++;
        if (this.snapshotFailures >= 5) {
          if (this.snapshotFailures === 5) this.logger.warn(LOG_CONTEXT, 'Attention snapshot retries exhausted');
        } else if (!this.retryTimeout) {
          const delay = Math.min(2000 * 2 ** (this.snapshotFailures - 1), 30000);
          this.retryTimeout = setTimeout(() => {
            this.retryTimeout = undefined;
            void this.reconcile();
          }, delay);
        }
        return;
      }
      this.snapshotFailures = 0;
      if (this.retryTimeout) clearTimeout(this.retryTimeout);
      this.retryTimeout = undefined;
      if (startedAtRevision !== this.revision) {
        this.reconcileAgain = true;
        return;
      }
      const current = new Set(notices.map(notice => notice.key));
      for (const [key, generation] of this.projected) {
        if (!current.has(key)) this.resolveProjection(key, generation);
      }
      for (const notice of notices) this.upsertProjection(notice);
    } finally {
      this.reconciling = false;
      if (this.reconcileAgain && this.snapshotFailures < 5 && !this.retryTimeout) {
        this.reconcileAgain = false;
        void this.reconcile();
      } else {
        this.reconcileAgain = false;
      }
    }
  }

  private upsertProjection(notice: AttentionNotice): void {
    const floor = this.generationFloor.get(notice.key) ?? -1;
    if (notice.generation <= floor) return;
    const prior = this.projected.get(notice.key);
    if (prior !== undefined && notice.generation < prior) return;
    const workspacePath = notice.target ? this.localWorkspace(notice.target) : null;
    const owner = notice.target?.tabId ? this.tabs.findTabByIdAcrossWorkspaces(notice.target.tabId) :
      notice.target ? this.tabs.findTabBySessionIdAcrossWorkspaces(notice.target.sessionId) : null;
    const validOwner = owner && (owner.tab.claudeSessionId === notice.target?.sessionId ||
      owner.tab.id === notice.target?.sessionId) ? owner : null;
    const labelPath = workspacePath ?? '';
    const provider = workspacePath && validOwner?.tab.providerId === 'claude-cli' ? 'Claude'
      : workspacePath && validOwner?.tab.providerId === 'ptah-cli' ? 'Ptah CLI'
      : workspacePath && validOwner?.tab.providerId === 'vscode-lm' ? 'VS Code' : '';
    const kindTitle = notice.kind === 'permission' ? 'Permission required'
      : notice.kind === 'question' ? 'Question needs an answer'
      : notice.kind === 'lane-permission' ? 'Lane permission required' : undefined;
    const sessionTitle = notice.title.trim();
    const safeTitle = !/^(new chat|new session|untitled|permission required|question needs an answer|lane permission required)$/i.test(sessionTitle) &&
      !isUnsafeAttentionContext(sessionTitle)
      ? sessionTitle.slice(0, 80) : '';
    const context = kindTitle ? attentionContext([provider, safeTitle]) : '';
    // An opaque ID keeps the request counted while its local owner is unavailable.
    const presentationWorkspace = workspacePath && validOwner?.workspacePath === null ? ''
      : workspacePath ?? `attention:${notice.target?.workspaceId ?? 'unknown'}`;
    const surfaceRouter = this.surfaceRouters.find(router =>
      !!notice.target && (!notice.target.surfaceKind || router.kind === notice.target.surfaceKind) &&
      router.canFocus(notice.target.sessionId));
    const surfaceOwned = !!notice.target && !!surfaceRouter &&
      (notice.target.surfaceMode || !notice.target.tabId);
    const routable = surfaceOwned || (!!notice.target && !notice.target.surfaceMode &&
      !!workspacePath && !!this.focusRouter);
    const item: AttentionItem = {
      key: notice.key, generation: notice.generation, kind: notice.kind,
      source: 'host', workspacePath: presentationWorkspace,
      workspaceName: labelPath ? workspaceLabelFromPath(labelPath) : 'Unknown workspace',
      sessionId: notice.target?.sessionId, tabId: notice.target?.tabId,
      ownerSurface: surfaceOwned || notice.target?.surfaceMode ? 'surface' : 'chat',
      severity: 'warning', title: kindTitle ?? notice.title, context: context || undefined, actionable: true,
      actions: [{ id: 'open', label: surfaceOwned || notice.target?.surfaceMode ? 'Open' : 'Show in canvas', ...(!routable && {
        disabledReason: notice.target?.surfaceMode ? 'Answer in owning surface' : 'Target unavailable',
      }) }],
      soundEligible: false,
    };
    this.projected.set(notice.key, notice.generation);
    if (notice.target) this.targets.set(notice.key, notice.target);
    this.notifications.upsert(item);
  }

  private resolveProjection(key: string, generation: number): void {
    if ((this.projected.get(key) ?? -1) > generation) return;
    this.projected.delete(key);
    this.targets.delete(key);
    this.notifications.resolve(key, generation, 'host');
  }

  private localWorkspace(target: AttentionTarget): string | null {
    const byTab = target.tabId ? this.tabs.findTabByIdAcrossWorkspaces(target.tabId) : null;
    const validTab = byTab && (byTab.tab.claudeSessionId === target.sessionId ||
      byTab.tab.id === target.sessionId) ? byTab : null;
    if (validTab?.workspacePath &&
        workspaceIdFromPath(validTab.workspacePath) === target.workspaceId) {
      return validTab.workspacePath;
    }
    const bySession = this.tabs.findTabBySessionIdAcrossWorkspaces(target.sessionId);
    if (bySession?.workspacePath && workspaceIdFromPath(bySession.workspacePath) === target.workspaceId) return bySession.workspacePath;
    if (validTab?.workspacePath === null || bySession?.workspacePath === null) {
      const roots = [this.tabs.activeWorkspacePath, this.vscode.config().workspaceRoot];
      return roots.find(root => !!root && workspaceIdFromPath(root) === target.workspaceId) ?? null;
    }
    return null;
  }

  private async openIfPending(key: string, generation: number, target: AttentionTarget): Promise<boolean> {
    const notices = await this.fetchSnapshot();
    if (!notices) { this.appState.setStatusMessage('Target unavailable'); return false; }
    const pending = notices.find(notice => notice.key === key && notice.generation === generation);
    if (!pending) {
      this.appState.setStatusMessage('Already answered');
      void this.reconcile();
      return false;
    }
    if (!pending.target || pending.target.workspaceId !== target.workspaceId ||
        pending.target.sessionId !== target.sessionId ||
        pending.target.tabId !== target.tabId ||
        pending.target.surfaceMode !== target.surfaceMode ||
        pending.target.surfaceKind !== target.surfaceKind) {
      this.logger.warn(LOG_CONTEXT, 'Attention target mismatch dropped');
      this.appState.setStatusMessage('Target unavailable');
      return false;
    }
    if (target.surfaceMode || !target.tabId) {
      const router = this.surfaceRouters.find(candidate =>
        (!target.surfaceKind || candidate.kind === target.surfaceKind) && candidate.canFocus(target.sessionId));
      if (router) {
        try {
          const result = await router.focus(target.sessionId);
          if (!result.success) this.appState.setStatusMessage('Target unavailable');
          return result.success;
        } catch (error) {
          return this.focusFailure(error);
        }
      }
      if (target.surfaceMode) { this.appState.setStatusMessage('Target unavailable'); return false; }
    }
    const workspacePath = this.localWorkspace(target);
    if (!workspacePath || !this.focusRouter || target.surfaceMode) {
      this.appState.setStatusMessage(target.surfaceMode ? 'Answer in owning surface' : 'Target unavailable');
      return false;
    }
    try {
      const owner = target.tabId ? this.tabs.findTabByIdAcrossWorkspaces(target.tabId) :
        this.tabs.findTabBySessionIdAcrossWorkspaces(target.sessionId);
      const unpartitionedOwner = owner?.workspacePath === null &&
        (owner.tab.claudeSessionId === target.sessionId || owner.tab.id === target.sessionId);
      const outcome = await this.focusRouter.focus({
        workspacePath: unpartitionedOwner ? '' : workspacePath, sessionId: target.sessionId, tabId: target.tabId,
      });
      if (!outcome.success) this.appState.setStatusMessage('Target unavailable');
      return outcome.success;
    } catch (error) {
      return this.focusFailure(error);
    }
  }

  private focusFailure(error: unknown): false {
    this.logger.warn(LOG_CONTEXT, `Attention focus failed (${error instanceof Error ? error.name : 'unknown'})`);
    this.appState.setStatusMessage('Target unavailable');
    return false;
  }
}
