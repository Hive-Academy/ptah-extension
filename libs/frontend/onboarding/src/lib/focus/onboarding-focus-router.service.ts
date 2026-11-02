import { Injectable, inject } from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  SurfaceRouterService,
  WORKSPACE_COORDINATOR,
  onboardingGenerationTarget,
  onboardingHarnessTarget,
  surfaceNavigationLanded,
  type NotificationFocusResult,
  type SurfaceFocusRouter,
} from '@ptah-extension/core';

/** Routes a notification to the onboarding step that owns its session. */
@Injectable({ providedIn: 'root' })
export class OnboardingFocusRouter implements SurfaceFocusRouter {
  readonly kind = 'onboarding' as const;
  private readonly tabs = inject(TabManagerService);
  private readonly router = inject(SurfaceRouterService);
  private readonly workspaceCoordinator = inject(WORKSPACE_COORDINATOR);

  canFocus(sessionId: string): boolean {
    const found = this.tabs.findTabBySessionIdAcrossWorkspaces(sessionId);
    return (
      !!found?.workspacePath &&
      this.targetFor(found.tab.workflow, found.tab.id) !== null
    );
  }

  async focus(sessionId: string): Promise<NotificationFocusResult> {
    const found = this.tabs.findTabBySessionIdAcrossWorkspaces(sessionId);
    if (!found?.workspacePath) return { success: false, outcome: 'missing' };
    const target = this.targetFor(found.tab.workflow, found.tab.id);
    if (!target) return { success: false, outcome: 'missing' };
    if (found.workspacePath !== this.tabs.activeWorkspacePath) {
      await this.workspaceCoordinator.switchWorkspace(found.workspacePath);
    }
    const result = await this.router.navigateToSurface(
      'onboarding',
      target.subPath,
      {
        queryParams: target.queryParams,
      },
    );
    if (!surfaceNavigationLanded(result))
      return { success: false, outcome: 'missing' };
    this.tabs.switchTab(found.tab.id);
    return { success: true, outcome: 'focused' };
  }

  private targetFor(workflow: string | undefined, tabId: string) {
    if (
      workflow === 'setup-agent-generation' ||
      workflow === 'setup-project-prompt'
    ) {
      return onboardingGenerationTarget(workflow, tabId);
    }
    if (
      workflow === 'harness-new-project' ||
      workflow === 'harness-configure'
    ) {
      return onboardingHarnessTarget(
        workflow === 'harness-new-project'
          ? 'new-project'
          : 'configure-harness',
        tabId,
        'workspace',
      );
    }
    return null;
  }
}
