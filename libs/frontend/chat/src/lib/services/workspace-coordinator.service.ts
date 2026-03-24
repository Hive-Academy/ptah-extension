import { Injectable, inject } from '@angular/core';
import {
  type IWorkspaceCoordinator,
  type ConfirmDialogOptions,
} from '@ptah-extension/core';
import { type SessionId } from '@ptah-extension/shared';
import { TabManagerService } from './tab-manager.service';
import { EditorService } from '@ptah-extension/editor';
import { ConfirmationDialogService } from './confirmation-dialog.service';

/**
 * Orchestrates workspace operations across TabManagerService (chat),
 * EditorService (editor), and ConfirmationDialogService.
 *
 * @see IWorkspaceCoordinator for the contract and dependency inversion rationale.
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

  getStreamingSessionIds(workspacePath: string): SessionId[] {
    const tabs = this.tabManager.getWorkspaceTabs(workspacePath);
    return tabs
      .filter((tab) => tab.status === 'streaming' && tab.claudeSessionId)
      .map((tab) => tab.claudeSessionId as SessionId);
  }

  confirm(options: ConfirmDialogOptions): Promise<boolean> {
    return this.confirmDialog.confirm(options);
  }
}
