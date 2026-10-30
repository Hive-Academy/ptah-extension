import { Injectable, Injector, inject } from '@angular/core';
import { ElectronLayoutService } from '@ptah-extension/core';

/**
 * Opens the git dock on one session's changes (TASK_2026_855 D10): the board
 * card's git cell. The dock is scoped to that session — pinned to it, or
 * following it when it is already the active tab — so the user sees its
 * worktree without the chat switching away from what they are watching.
 *
 * git-ui is reached by dynamic import of its services-only entry, as
 * `WorkspaceCoordinatorService` does, so chat keeps no static edge to it.
 */
@Injectable({ providedIn: 'root' })
export class SessionGitDockOpener {
  private readonly injector = inject(Injector);
  private readonly layout = inject(ElectronLayoutService);

  async open(tabId: string): Promise<void> {
    try {
      const git = await import('@ptah-extension/git-ui/services');
      this.injector.get(git.GitDockScopeStore).showSession(tabId);
      this.injector.get(git.ReviewNavigationService).selectTab('changes');
      this.layout.setEditorPanelVisible(true);
    } catch (error: unknown) {
      // degradation-audit: reported - logged; the dock stays as it was and
      // the user can still open it from the shell.
      console.error('[SessionGitDockOpener] Could not open the git dock', error);
    }
  }
}
