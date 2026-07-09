import { Injectable, inject, Injector } from '@angular/core';
import {
  AuthStateService,
  EffortStateService,
  ModelStateService,
  type IWorkspaceCoordinator,
  type ConfirmDialogOptions,
} from '@ptah-extension/core';
import { type SessionId } from '@ptah-extension/shared';
import {
  ConfirmationDialogService,
  TabManagerService,
} from '@ptah-extension/chat-state';
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
  private readonly authState = inject(AuthStateService);
  private readonly modelState = inject(ModelStateService);
  private readonly effortState = inject(EffortStateService);

  /**
   * Cached references to editor services, resolved on first use.
   * These are providedIn: 'root' services from the editor library,
   * loaded dynamically to respect lazy-load boundaries.
   */
  private editorServices: WorkspaceAwareService[] | null = null;

  /**
   * Monotonic switch counter. Incremented on every {@link switchWorkspace}
   * call and captured by the detached provider-state refresh so a slower,
   * older switch's auth/model/effort round-trips cannot clobber the state of a
   * newer switch that has since superseded it (rapid A→B→A). Mirrors the
   * stale-response guards already used in `GitStatusService.fetchGitInfo`
   * (`workspaceAtFetchTime`) and `EditorWorkspaceHelper.loadFileTree`
   * (request-id).
   */
  private switchGeneration = 0;

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
        this.injector.get(editorModule.GitBranchesService),
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
    const generation = ++this.switchGeneration;
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

    // Kick off per-workspace auth/model/effort re-resolution WITHOUT blocking
    // the switch. TASK_2026_144 makes this trio load-bearing — each workspace
    // can pin its own provider/model/effort, and the re-resolve is how the UI
    // picks up those overrides — so it MUST still run on every switch. But the
    // resolution involves network round-trips (config:models-list etc.); making
    // the switch coordination await them is what made switching feel slow. The
    // ordering (auth resolved before the model list is fetched) is preserved
    // inside the helper, so resolved values are identical; only the UI no longer
    // waits on the round-trips. Provider-state signals update reactively when
    // the calls settle.
    void this.refreshWorkspaceProviderState(generation);
  }

  /**
   * Re-resolve the per-workspace authentication provider, model list, and
   * effort selection. Auth is awaited before models/effort because the
   * resolved provider determines which model list the backend returns
   * (TASK_2026_144). Runs detached from {@link switchWorkspace} so the switch
   * UI is not blocked on the network round-trips.
   *
   * `generation` is the {@link switchGeneration} value captured when the
   * owning switch was dispatched. Because these signals feed
   * `MessageSenderService.sendMessage`'s default model/effort, applying a
   * superseded switch's results would silently dispatch a message with the
   * wrong workspace's provider. So between the awaited stages we bail out if a
   * newer switch has started — dropping the stale continuation instead of
   * clobbering the current workspace's state.
   *
   * Residual window: a response for an older generation could still land
   * mid-`Promise.all` (auth already re-checked, models/effort in flight). The
   * backend resolves "current workspace" at RPC-processing time and these RPCs
   * carry no workspace parameter, so fully closing that window would require
   * threading the workspace path through `auth:getAuthStatus`/`config:models-list`
   * — a larger change out of this task's scope. This guard narrows the window
   * to that single interleaving and matches the pattern used elsewhere here.
   */
  private async refreshWorkspaceProviderState(
    generation: number,
  ): Promise<void> {
    try {
      await this.authState.refreshAuthStatus();
      // A newer switch superseded this one while auth was resolving — drop the
      // stale continuation rather than re-resolve models/effort for a
      // workspace the user has already switched away from.
      if (generation !== this.switchGeneration) return;
      await Promise.all([
        this.modelState.refreshModels(),
        this.effortState.refreshEffort(),
      ]);
    } catch (error) {
      console.warn(
        '[WorkspaceCoordinator] Failed to re-resolve auth/model/effort after workspace switch:',
        error,
      );
    }
  }

  /** Removes workspace state; canvas listens via tabManager.removedWorkspace$. */
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
      .filter(
        (tab) => tab.status === 'streaming' && tab.claudeSessionId != null,
      )
      .map((tab) => tab.claudeSessionId as SessionId);
  }

  confirm(options: ConfirmDialogOptions): Promise<boolean> {
    return this.confirmDialog.confirm(options);
  }
}
