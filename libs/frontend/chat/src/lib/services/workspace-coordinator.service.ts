import { Injectable, inject, Injector } from '@angular/core';
import {
  type IWorkspaceCoordinator,
  type ConfirmDialogOptions,
} from '@ptah-extension/core';
import { type SessionId } from '@ptah-extension/shared';
import { TabManagerService } from './tab-manager.service';
import { ConfirmationDialogService } from './confirmation-dialog.service';
import { SessionLoaderService } from './chat-store/session-loader.service';

/**
 * Common interface for editor services that support workspace partitioning.
 * Used to avoid static imports of the lazy-loaded editor library.
 */
interface WorkspaceAwareService {
  switchWorkspace(workspacePath: string): void;
  removeWorkspaceState(workspacePath: string): void;
}

/**
 * Orchestrates workspace operations across TabManagerService (chat),
 * EditorService (editor), GitStatusService (git state),
 * TerminalService (terminal state), SessionLoaderService (session cache),
 * and ConfirmationDialogService.
 *
 * Editor services (EditorService, GitStatusService, TerminalService) are
 * resolved dynamically via Injector to avoid static imports of the
 * lazy-loaded editor library.
 *
 * @see IWorkspaceCoordinator for the contract and dependency inversion rationale.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceCoordinatorService implements IWorkspaceCoordinator {
  private readonly tabManager = inject(TabManagerService);
  private readonly confirmDialog = inject(ConfirmationDialogService);
  private readonly sessionLoader = inject(SessionLoaderService);
  private readonly injector = inject(Injector);

  /**
   * Cached references to editor services, resolved on first use.
   * These are providedIn: 'root' services from the editor library,
   * loaded dynamically to respect lazy-load boundaries.
   */
  private editorServices: WorkspaceAwareService[] | null = null;

  /**
   * Lazily resolve editor services via dynamic import + Injector.
   * Returns empty array if editor library hasn't been loaded yet.
   */
  private async resolveEditorServices(): Promise<WorkspaceAwareService[]> {
    if (this.editorServices !== null && this.editorServices.length > 0) {
      return this.editorServices;
    }

    try {
      const editorModule = await import('@ptah-extension/editor/services');
      this.editorServices = [
        this.injector.get(editorModule.EditorService),
        this.injector.get(editorModule.GitStatusService),
        this.injector.get(editorModule.TerminalService),
      ];
      return this.editorServices;
    } catch (error) {
      console.warn(
        '[WorkspaceCoordinator] Editor services not available yet (editor chunk may not be loaded):',
        error instanceof Error ? error.message : String(error),
      );
      return [];
    }
  }

  async switchWorkspace(newPath: string): Promise<void> {
    this.tabManager.switchWorkspace(newPath);
    this.sessionLoader.switchWorkspace(newPath);

    try {
      const services = await this.resolveEditorServices();
      for (const svc of services) {
        svc.switchWorkspace(newPath);
      }
    } catch (error) {
      console.error(
        '[WorkspaceCoordinator] Failed to switch editor services workspace:',
        error,
      );
    }
  }

  async removeWorkspaceState(workspacePath: string): Promise<void> {
    this.tabManager.removeWorkspaceState(workspacePath);
    this.sessionLoader.removeWorkspaceCache(workspacePath);

    try {
      const services = await this.resolveEditorServices();
      for (const svc of services) {
        svc.removeWorkspaceState(workspacePath);
      }
    } catch (error) {
      console.error(
        '[WorkspaceCoordinator] Failed to remove editor services workspace state:',
        error,
      );
    }
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
