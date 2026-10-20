import { Injectable, inject } from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { SurfaceRouterService, WORKSPACE_COORDINATOR, surfaceNavigationLanded, type SurfaceFocusRouter, type NotificationFocusResult } from '@ptah-extension/core';

@Injectable({ providedIn: 'root' })
export class HarnessBuilderFocusRouter implements SurfaceFocusRouter {
  readonly kind = 'harness-builder' as const;
  private readonly tabs = inject(TabManagerService);
  private readonly router = inject(SurfaceRouterService);
  private readonly workspaceCoordinator = inject(WORKSPACE_COORDINATOR);

  canFocus(sessionId: string): boolean {
    const found = this.tabs.findTabBySessionIdAcrossWorkspaces(sessionId);
    return !!found && !!found.workspacePath &&
      (found.tab.workflow === 'harness-configure' || found.tab.workflow === 'harness-new-project');
  }

  async focus(sessionId: string): Promise<NotificationFocusResult> {
    if (!this.canFocus(sessionId)) return { success: false, outcome: 'missing' };
    const found = this.tabs.findTabBySessionIdAcrossWorkspaces(sessionId);
    if (!found?.workspacePath) return { success: false, outcome: 'missing' };
    if (found.workspacePath !== this.tabs.activeWorkspacePath) {
      await this.workspaceCoordinator.switchWorkspace(found.workspacePath);
    }
    const mode = found.tab.workflow === 'harness-new-project' ? 'new-project' : 'configure-harness';
    const result = await this.router.navigateToSurface('harness-builder', [mode, found.tab.id]);
    if (!surfaceNavigationLanded(result)) return { success: false, outcome: 'missing' };
    this.tabs.switchTab(found.tab.id);
    return { success: true, outcome: 'focused' };
  }
}
