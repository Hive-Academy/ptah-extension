import { Injectable, inject } from '@angular/core';
import {
  TabManagerService,
  isActiveWorkspaceTabSet,
} from '@ptah-extension/chat-state';
import {
  SurfaceRouterService,
  VSCodeService,
  surfaceNavigationLanded,
} from '@ptah-extension/core';
import type { SetupGenerationWorkflow } from '@ptah-extension/shared';

export interface GenerationWorkflowOpenRequest {
  workspacePath: string;
  workflow: SetupGenerationWorkflow;
  origin: string;
  focus?: boolean;
  afterTabId?: string;
}

export type GenerationWorkflowOpenResult =
  { outcome: 'landed'; tabId: string } | { outcome: 'cancelled' | 'failed' };

@Injectable({ providedIn: 'root' })
export class GenerationWorkflowLauncherService {
  private readonly tabs = inject(TabManagerService);
  private readonly router = inject(SurfaceRouterService);
  private readonly vscode = inject(VSCodeService);
  private readonly launchIntents = new Map<
    string,
    'analysis-result-continue' | 'independent-start'
  >();

  consumeOrigin(
    tabId: string,
  ): 'analysis-result-continue' | 'independent-start' | null {
    const origin = this.launchIntents.get(tabId) ?? null;
    this.launchIntents.delete(tabId);
    return origin;
  }

  async open(
    request: GenerationWorkflowOpenRequest,
  ): Promise<GenerationWorkflowOpenResult> {
    const { workspacePath, workflow, focus = true } = request;
    if (
      !workspacePath.trim() ||
      (workflow !== 'setup-agent-generation' &&
        workflow !== 'setup-project-prompt')
    ) {
      return { outcome: 'failed' };
    }
    if (focus && !this.isActiveWorkspace(workspacePath)) {
      return { outcome: 'failed' };
    }
    const existing = this.tabs.findWorkflowTab(workspacePath, workflow);
    const anchor =
      request.afterTabId ??
      this.tabs.getWorkspaceTabs(workspacePath).at(-1)?.id;
    const tabId =
      existing?.id ??
      this.tabs.createWorkflowTabForWorkspace(
        workspacePath,
        workflow,
        workflow === 'setup-agent-generation'
          ? 'Generate agents'
          : 'Project guidance',
        anchor,
      );
    if (!tabId) return { outcome: 'failed' };
    if (!focus) return { outcome: 'landed', tabId };
    this.launchIntents.set(
      tabId,
      request.origin === 'analysis-result-continue'
        ? 'analysis-result-continue'
        : 'independent-start',
    );
    const outcome = await this.router.navigateToSurface('setup-wizard', [
      'generation',
      workflow,
      tabId,
    ]);
    if (outcome === 'cancelled') {
      this.launchIntents.delete(tabId);
      return { outcome: 'cancelled' };
    }
    if (
      !surfaceNavigationLanded(outcome) ||
      !this.isActiveWorkspace(workspacePath)
    ) {
      this.launchIntents.delete(tabId);
      return { outcome: 'failed' };
    }
    this.tabs.switchTab(tabId);
    return { outcome: 'landed', tabId };
  }

  private isActiveWorkspace(workspacePath: string): boolean {
    return isActiveWorkspaceTabSet(
      workspacePath,
      this.tabs.activeWorkspacePath,
      this.vscode.config().workspaceRoot,
      this.vscode.config().isVSCode,
    );
  }
}
