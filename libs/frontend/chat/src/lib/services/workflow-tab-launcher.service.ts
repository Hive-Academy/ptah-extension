import { Injectable, inject } from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { isWorkflowKind, type WorkflowKind } from '@ptah-extension/chat-types';
import {
  AppStateManager,
  SurfaceRouterService,
  surfaceNavigationLanded,
} from '@ptah-extension/core';

export interface WorkflowTabOpenRequest {
  workflow: WorkflowKind;
  title: string;
  visiblePrompt?: string;
  firstMessagePreamble?: string;
}

export type WorkflowTabOpenResult =
  { outcome: 'landed'; tabId: string } | { outcome: 'cancelled' | 'failed' };

@Injectable({ providedIn: 'root' })
export class WorkflowTabLauncherService {
  private readonly router = inject(SurfaceRouterService);
  private readonly appState = inject(AppStateManager);
  private readonly tabs = inject(TabManagerService);

  async open(request: WorkflowTabOpenRequest): Promise<WorkflowTabOpenResult> {
    if (!isWorkflowKind(request.workflow) || !request.title?.trim()) {
      throw new Error('Invalid workflow tab request');
    }
    let navigation: 'navigated' | 'already-there' | 'cancelled' | 'failed';
    try {
      navigation = await this.router.navigateToSurface('chat');
    } catch {
      return { outcome: 'failed' };
    }
    if (!surfaceNavigationLanded(navigation)) {
      return { outcome: navigation === 'cancelled' ? 'cancelled' : 'failed' };
    }

    const tabId = this.tabs.createTab(request.title.trim());
    this.tabs.setWorkflow(tabId, request.workflow);
    if (request.firstMessagePreamble) {
      this.tabs.setFirstMessagePreamble(tabId, request.firstMessagePreamble);
    }
    this.appState.requestCanvasTab(
      tabId,
      this.tabs.activeWorkspacePath,
      request.title.trim(),
    );
    if (request.visiblePrompt !== undefined) {
      this.appState.requestComposerPrefill(request.visiblePrompt, tabId);
    }
    return { outcome: 'landed', tabId };
  }
}
