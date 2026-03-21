import { Injectable, inject } from '@angular/core';
import { type IWorkspaceCoordinator } from '@ptah-extension/core';
import { TabManagerService } from './tab-manager.service';
import { EditorService } from '@ptah-extension/editor';
import {
  ConfirmationDialogService,
  type ConfirmationDialogOptions,
} from './confirmation-dialog.service';

/**
 * WorkspaceCoordinatorService - Orchestrates workspace operations across feature libraries.
 *
 * Implements the IWorkspaceCoordinator contract defined in core. This service
 * coordinates TabManagerService (chat), EditorService (editor), and
 * ConfirmationDialogService during workspace switch/remove operations.
 *
 * This breaks the circular dependency: core defines the interface (IWorkspaceCoordinator),
 * chat provides the implementation, and the app wires them together via DI.
 *
 * Dependency flow:
 *   core (defines token) ← chat (provides implementation) → editor
 *   No circular dependency: chat depends on core and editor, not vice versa.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceCoordinatorService implements IWorkspaceCoordinator {
  private readonly tabManager = inject(TabManagerService);
  private readonly editorService = inject(EditorService);
  private readonly confirmDialog = inject(ConfirmationDialogService);

  switchWorkspace(newPath: string): void {
    this.tabManager.switchWorkspace(newPath);
    this.editorService.switchWorkspace(newPath);
  }

  removeWorkspaceState(workspacePath: string): void {
    this.tabManager.removeWorkspaceState(workspacePath);
    this.editorService.removeWorkspaceState(workspacePath);
  }

  getStreamingSessionIds(workspacePath: string): string[] {
    const tabs = this.tabManager.getWorkspaceTabs(workspacePath);
    return tabs
      .filter(
        (tab: { status: string; claudeSessionId: string | null }) =>
          tab.status === 'streaming' && tab.claudeSessionId
      )
      .map((tab: { claudeSessionId: string | null }) => tab.claudeSessionId!);
  }

  confirm(options: ConfirmationDialogOptions): Promise<boolean> {
    return this.confirmDialog.confirm(options);
  }
}
