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

@Injectable({ providedIn: 'root' })
export class NotificationFocusCoordinator implements NotificationFocusRouter {
  private readonly appState = inject(AppStateManager);
  private readonly tabManager = inject(TabManagerService);
  private readonly workspaceCoordinator = inject(WorkspaceCoordinatorService);
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
    if (!initial && !SessionId.safeParse(target.sessionId)) {
      return { success: false, outcome: 'missing' };
    }

    if (initial?.workspacePath !== null) {
      await this.workspaceCoordinator.switchWorkspace(target.workspacePath);
    }
    this.appState.setCurrentView('chat');
    // The canvas uses its implicit partition for tabs whose owner path is null.
    // Its focus request compares workspace paths literally, so adopt this tab
    // through the tab request bridge, which normalizes null to that partition.
    if (initial?.workspacePath === null) {
      const focused = await this.appState.requestCanvasTab(initial.tab.id, null, undefined, true, { timeoutMs: 5000 });
      return { success: focused, outcome: focused ? 'focused' : 'missing' };
    }
    // At the canvas tile cap the result is `cap-reached` and no tab is
    // switched; the notification panel stays open on a non-success result.
    return this.appState.requestCanvasFocus({
      ...target,
      tabId: initial?.tab.id,
      sessionId: initial?.tab.claudeSessionId ?? target.sessionId,
    });
  }

  private resolve(target: NotificationFocusTarget): TabLookupResult | null {
    const byTab = target.tabId
      ? this.tabManager.findTabByIdAcrossWorkspaces(target.tabId)
      : null;
    if (byTab && (byTab.workspacePath ?? '') === target.workspacePath) return byTab;
    const bySession = this.tabManager.findTabBySessionIdAcrossWorkspaces(
      target.sessionId,
    );
    return bySession && (bySession.workspacePath ?? '') === target.workspacePath ? bySession : null;
  }
}
