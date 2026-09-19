import { inject, Injectable } from '@angular/core';
import {
  AppStateManager,
  type NotificationFocusResult,
  type NotificationFocusRouter,
  type NotificationFocusTarget,
} from '@ptah-extension/core';
import {
  TabManagerService,
  type TabLookupResult,
} from '@ptah-extension/chat-state';
import { SessionId } from '@ptah-extension/shared';
import { WorkspaceCoordinatorService } from './workspace-coordinator.service';
import { ChatStore } from './chat.store';

@Injectable({ providedIn: 'root' })
export class NotificationFocusCoordinator implements NotificationFocusRouter {
  private readonly appState = inject(AppStateManager);
  private readonly tabManager = inject(TabManagerService);
  private readonly workspaceCoordinator = inject(WorkspaceCoordinatorService);
  private readonly chatStore = inject(ChatStore);
  private transactionTail: Promise<void> = Promise.resolve();

  focus(target: NotificationFocusTarget): Promise<NotificationFocusResult> {
    const transaction = this.transactionTail.then(() => this.run(target));
    this.transactionTail = transaction.then(
      () => undefined,
      () => undefined,
    );
    return transaction;
  }

  private async run(
    target: NotificationFocusTarget,
  ): Promise<NotificationFocusResult> {
    const initial = this.resolve(target);
    if (!initial) return { success: false, outcome: 'missing' };

    this.appState.setCurrentView('chat');
    this.appState.setLayoutMode('grid');
    await this.workspaceCoordinator.switchWorkspace(target.workspacePath);
    const canvasResult = await this.appState.requestCanvasFocus({
      ...target,
      tabId: initial.tab.id,
      sessionId: initial.tab.claudeSessionId ?? target.sessionId,
    });
    if (canvasResult.success || canvasResult.outcome !== 'cap-reached') {
      return canvasResult;
    }

    this.appState.setLayoutMode('single');
    const active = this.resolve(target);
    if (active) {
      this.tabManager.switchTab(active.tab.id);
      return { success: true, outcome: 'cap-reached' };
    }
    const sessionId = SessionId.safeParse(target.sessionId);
    if (!sessionId) return { success: false, outcome: 'cap-reached' };
    try {
      const tabId = this.tabManager.openSessionTab(sessionId);
      await this.chatStore.switchSession(sessionId);
      this.tabManager.switchTab(tabId);
      return { success: true, outcome: 'cap-reached' };
    } catch (error: unknown) {
      console.error(
        '[NotificationFocusCoordinator] Full-view fallback failed',
        error instanceof Error ? error.message : error,
      );
      return { success: false, outcome: 'cap-reached' };
    }
  }

  private resolve(target: NotificationFocusTarget): TabLookupResult | null {
    const byTab = target.tabId
      ? this.tabManager.findTabByIdAcrossWorkspaces(target.tabId)
      : null;
    if (byTab?.workspacePath === target.workspacePath) return byTab;
    const bySession = this.tabManager.findTabBySessionIdAcrossWorkspaces(
      target.sessionId,
    );
    return bySession?.workspacePath === target.workspacePath ? bySession : null;
  }
}
