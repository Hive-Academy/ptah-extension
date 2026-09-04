import { Injectable, inject, Injector } from '@angular/core';
import {
  AgentDiscoveryFacade,
  AppStateManager,
  AuthStateService,
  CommandDiscoveryFacade,
  EffortStateService,
  ModelStateService,
  WorkspaceScopeService,
  type IWorkspaceCoordinator,
  type ConfirmDialogOptions,
} from '@ptah-extension/core';
import { type SessionId } from '@ptah-extension/shared';
import {
  ConfirmationDialogService,
  TabManagerService,
} from '@ptah-extension/chat-state';
import { SessionLoaderService } from './chat-store/session-loader.service';
import { SessionLivenessReconcilerService } from './chat-store/session-liveness-reconciler.service';
import { FilePickerService } from './file-picker.service';

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
 * SessionLoaderService (session cache), FilePickerService (`@` picker file
 * cache), AgentDiscoveryFacade / CommandDiscoveryFacade (`/` picker agent and
 * command caches), EditorService (editor), GitStatusService /
 * GitBranchesService (git state), TerminalService (terminal state),
 * AppStateManager (which view/layout surface is on screen) and
 * ConfirmationDialogService.
 *
 * Editor services (EditorService, GitStatusService, GitBranchesService,
 * TerminalService) are resolved dynamically via Injector to avoid static
 * imports of the lazy-loaded editor library. Everything else —
 * TabManagerService, SessionLoaderService, FilePickerService and the two
 * discovery facades — is injected directly and reset synchronously.
 *
 * @see IWorkspaceCoordinator for the contract and dependency inversion rationale.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceCoordinatorService implements IWorkspaceCoordinator {
  private readonly tabManager = inject(TabManagerService);
  private readonly confirmDialog = inject(ConfirmationDialogService);
  private readonly sessionLoader = inject(SessionLoaderService);
  private readonly livenessReconciler = inject(
    SessionLivenessReconcilerService,
  );
  private readonly filePicker = inject(FilePickerService);
  private readonly agentDiscovery = inject(AgentDiscoveryFacade);
  private readonly commandDiscovery = inject(CommandDiscoveryFacade);
  private readonly injector = inject(Injector);
  private readonly authState = inject(AuthStateService);
  private readonly modelState = inject(ModelStateService);
  private readonly effortState = inject(EffortStateService);
  private readonly appState = inject(AppStateManager);
  /**
   * The invalidation key every workspace-scoped cache in `core` reads.
   *
   * Deliberately NOT merged with {@link switchGeneration} below. They answer
   * different questions: `switchGeneration` bumps on EVERY call so this service
   * can drop a superseded continuation of its own, while the scope bumps only
   * on an actual change of workspace — a redundant switch to the workspace
   * already active must not throw away caches that are still correct.
   */
  private readonly workspaceScope = inject(WorkspaceScopeService);

  /**
   * Cached references to editor services, resolved on first use.
   * These are providedIn: 'root' services from the editor library,
   * loaded dynamically to respect lazy-load boundaries.
   */
  private editorServices: WorkspaceAwareService[] | null = null;

  /**
   * Monotonic switch counter. Incremented on every {@link switchWorkspace}
   * call and re-checked after each `await` in that call — the editor-service
   * resolution and the detached provider-state refresh — so a slower, older
   * switch cannot apply its editor workspace or its auth/model/effort
   * round-trips over a newer switch that has since superseded it (rapid
   * A→B→A). Mirrors the stale-response guards already used in
   * `GitStatusService.fetchGitInfo` (`workspaceAtFetchTime`) and
   * `EditorWorkspaceHelper.loadFileTree` (request-id).
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
    // Synchronous fan-out. Every call below runs in the same synchronous block
    // as the `switchGeneration` bump above — there is no `await` between them —
    // so a superseded switch cannot interleave its reset between a newer
    // switch's bump and its resets. Rapid A→B→A therefore ends with A's state,
    // in order.
    //
    // The three picker caches MUST be reset here, before the awaited
    // editor-service resolution below: any window in which they still hold the
    // old root's data is a window in which a picker lies (TASK_2026_200,
    // criterion 11). All three own their invalidation rather than having their
    // signals cleared from here, because each must also discard the RPC
    // responses already in flight for the previous workspace — a clear alone
    // would be undone by the next response to land.
    //
    // `@` picker: file list, 5-minute TTL.
    // `/` picker: agents + commands. `clearCache()` is these facades' full
    // invalidation entry point (it bumps their generation and resets
    // `_isLoading`), so there is no separate switch method to call.
    //
    // `appState` swaps the whole view slice (`currentView` / `openViews`, plus
    // the in-surface pointers `thothActiveTab` / `marketplaceActiveProvider`)
    // onto the new workspace's slice and goes LAST, so the surface only flips
    // once the tab, session and picker state behind it is already the new
    // workspace's. Without it the shell keeps rendering the previous
    // workspace's view — tribunal, say — now backed by the new workspace's
    // (empty) slice, which is the symptom TASK_2026_195 was filed for.
    // FIRST in the fan-out (TASK_2026_345, judge round 1). Every cache keyed by
    // `WorkspaceScopeService.scopeKey` — the plugin catalog and the model list —
    // is invalidated the instant this returns, and `refreshWorkspaceProviderState`
    // below is dispatched under the NEW scope. Anything that read a scoped cache
    // between the generation bump and this call would still be answered for the
    // workspace being left, so it goes ahead of the resets rather than beside
    // them.
    this.workspaceScope.switchTo(newPath);
    this.tabManager.switchWorkspace(newPath);
    this.sessionLoader.switchWorkspace(newPath);
    this.filePicker.switchWorkspace(newPath);
    this.agentDiscovery.clearCache();
    this.commandDiscovery.clearCache();
    this.appState.switchWorkspace(newPath);
    // The new workspace's tabs were restored with every in-flight status
    // coerced to `loaded`; ask the backend for each session's real turn state
    // so a turn that ran on while the workspace was backgrounded shows as
    // streaming / sleeping again, and an idle one shows no stop button
    // (TASK_2026_360). Detached, like the bootstrap call.
    this.livenessReconciler.reconcileRestoredTabs().catch((err) => {
      console.warn(
        '[WorkspaceCoordinator] Failed to reconcile session liveness after switch:',
        err,
      );
    });

    try {
      const services = await this.resolveEditorServices();
      // The editor chunk resolution above is the one `await` in this method, so
      // it is the one place a superseded switch can regain control after a
      // newer one has already applied. Dropping the stale continuation here
      // also skips its `refreshWorkspaceProviderState` below, which is correct:
      // the newer switch dispatched its own refresh under a newer generation.
      if (generation !== this.switchGeneration) return;
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
   * Coordinate the transition to NO workspace (TASK_2026_345, judge round 2).
   *
   * Reached from the two places `ElectronLayoutService` ends up with zero
   * folders: closing the last one, and a host sync that reports none with
   * nothing cached to restore. Both used to call `updateWorkspaceRoot('')`
   * inline and tell nobody, so the scope kept naming a folder that was no
   * longer open — and reopening that same folder was then a switch to the
   * "already active" workspace, which correctly early-returns and left every
   * scope-keyed cache serving its pre-closure snapshot. The folder's plugin
   * config can change while it is closed (harness-sync, another window,
   * `ptah tui`), so that snapshot is exactly the thing not to trust.
   *
   * Two lines, and deliberately no more. The per-folder teardown — tabs,
   * sessions, editor state — is already done by `removeWorkspaceState`, which
   * `ElectronLayoutService` calls for the folder being removed BEFORE it gets
   * here. What was missing is only the transition itself.
   */
  clearWorkspace(): void {
    // Supersede any switch still in flight. Without this, a `switchWorkspace`
    // whose editor-chunk `await` resolves after the last folder closed would
    // carry on and re-resolve auth/model/effort for a workspace that is gone.
    this.switchGeneration += 1;
    this.workspaceScope.switchTo(null);
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
    this.appState.removeWorkspaceState(workspacePath);

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
