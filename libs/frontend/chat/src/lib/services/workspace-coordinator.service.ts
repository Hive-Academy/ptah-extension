import { Injectable, inject } from '@angular/core';
import {
  type IWorkspaceCoordinator,
  type ConfirmDialogOptions,
} from '@ptah-extension/core';
import { type SessionId } from '@ptah-extension/shared';
import { TabManagerService } from './tab-manager.service';
import {
  EditorService,
  GitStatusService,
  TerminalService,
} from '@ptah-extension/editor';
import { ConfirmationDialogService } from './confirmation-dialog.service';
import { SessionLoaderService } from './chat-store/session-loader.service';

/**
 * Orchestrates workspace operations across TabManagerService (chat),
 * EditorService (editor), GitStatusService (git state),
 * TerminalService (terminal state), SessionLoaderService (session cache),
 * and ConfirmationDialogService.
 *
 * @see IWorkspaceCoordinator for the contract and dependency inversion rationale.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceCoordinatorService implements IWorkspaceCoordinator {
  private readonly tabManager = inject(TabManagerService);
  private readonly editorService = inject(EditorService);
  private readonly gitStatus = inject(GitStatusService);
  private readonly terminalService = inject(TerminalService);
  private readonly confirmDialog = inject(ConfirmationDialogService);
  private readonly sessionLoader = inject(SessionLoaderService);

  switchWorkspace(newPath: string): void {
    this.tabManager.switchWorkspace(newPath);
    this.editorService.switchWorkspace(newPath);
    this.gitStatus.switchWorkspace(newPath);
    this.terminalService.switchWorkspace(newPath);
    this.sessionLoader.switchWorkspace(newPath);
  }

  removeWorkspaceState(workspacePath: string): void {
    this.tabManager.removeWorkspaceState(workspacePath);
    this.editorService.removeWorkspaceState(workspacePath);
    this.gitStatus.removeWorkspaceState(workspacePath);
    this.terminalService.removeWorkspaceState(workspacePath);
    this.sessionLoader.removeWorkspaceCache(workspacePath);
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
