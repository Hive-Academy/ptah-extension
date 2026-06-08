import { Injectable, inject } from '@angular/core';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import {
  TabManagerService,
  SessionLivenessRegistry,
} from '@ptah-extension/chat-state';

@Injectable({ providedIn: 'root' })
export class SessionLivenessReconcilerService {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly vscodeService = inject(VSCodeService);
  private readonly tabManager = inject(TabManagerService);
  private readonly liveness = inject(SessionLivenessRegistry);

  async reconcileRestoredTabs(): Promise<void> {
    const workspacePath =
      this.vscodeService.config().workspaceRoot ?? undefined;
    const targets = this.tabManager
      .tabs()
      .filter((tab) => tab.claudeSessionId != null)
      .map((tab) => ({
        tabId: tab.id,
        sessionId: tab.claudeSessionId as string,
      }));

    await Promise.allSettled(
      targets.map((t) => this.probe(t.tabId, t.sessionId, workspacePath)),
    );
  }

  private async probe(
    tabId: string,
    sessionId: string,
    workspacePath: string | undefined,
  ): Promise<void> {
    try {
      const result = await this.rpc.call('session:status', { sessionId });
      if (!result.success || !result.data) return;

      const { isActive, isStreaming } = result.data;
      if (isStreaming) {
        this.liveness.markStreaming(sessionId, workspacePath);
        this.tabManager.markStreaming(tabId);
        this.tabManager.markTabStreaming(tabId);
      } else if (isActive) {
        this.liveness.markIdle(sessionId, workspacePath);
      }
    } catch (error: unknown) {
      console.warn(
        '[SessionLivenessReconciler] probe failed; leaving tab as restored',
        { sessionId, error },
      );
    }
  }
}
