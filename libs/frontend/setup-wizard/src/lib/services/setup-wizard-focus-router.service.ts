import { Injectable, inject } from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { SurfaceRouterService, surfaceNavigationLanded, type SurfaceFocusRouter, type NotificationFocusResult } from '@ptah-extension/core';

@Injectable({ providedIn: 'root' })
export class SetupWizardFocusRouter implements SurfaceFocusRouter {
  readonly kind = 'setup-wizard' as const;
  private readonly tabs = inject(TabManagerService);
  private readonly router = inject(SurfaceRouterService);

  canFocus(sessionId: string): boolean {
    const found = this.tabs.findTabBySessionIdAcrossWorkspaces(sessionId);
    return !!found && !!found.workspacePath &&
      found.workspacePath === this.tabs.activeWorkspacePath &&
      (found.tab.workflow === 'setup-agent-generation' || found.tab.workflow === 'setup-project-prompt');
  }

  async focus(sessionId: string): Promise<NotificationFocusResult> {
    if (!this.canFocus(sessionId)) return { success: false, outcome: 'missing' };
    const found = this.tabs.findTabBySessionIdAcrossWorkspaces(sessionId);
    if (!found) return { success: false, outcome: 'missing' };
    const result = await this.router.navigateToSurface('setup-wizard', [
      'generation', found.tab.workflow, found.tab.id,
    ]);
    if (!surfaceNavigationLanded(result)) return { success: false, outcome: 'missing' };
    this.tabs.switchTab(found.tab.id);
    return { success: true, outcome: 'focused' };
  }
}
