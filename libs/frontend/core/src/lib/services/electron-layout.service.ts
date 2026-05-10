/**
 * Electron Layout Service
 *
 * Signal-based state management for the Electron desktop 3-panel layout.
 * Manages workspace sidebar width, editor panel width/visibility,
 * workspace folders, and layout persistence via state storage.
 *
 * TASK_2025_208 Batch 4: Workspace switch coordination, active streams
 * confirmation on close, and initial workspace:switch RPC on renderer load.
 */

import {
  Injectable,
  signal,
  computed,
  inject,
  DestroyRef,
} from '@angular/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { VSCodeService } from './vscode.service';
import { AppStateManager } from './app-state.service';
import { ClaudeRpcService } from './claude-rpc.service';
import { WORKSPACE_COORDINATOR } from '../tokens/workspace-coordinator.token';
import type { MessageHandler } from './message-router.types';

export interface WorkspaceFolder {
  path: string;
  name: string;
}

const LAYOUT_STATE_KEY = 'electron-layout';
const DEFAULT_SIDEBAR_WIDTH = 220;
const DEFAULT_EDITOR_WIDTH = 700;
const MIN_SIDEBAR_WIDTH = 160;
const MAX_SIDEBAR_WIDTH = 400;
const MIN_EDITOR_WIDTH = 300;
/** Dynamic max: capped at 50% of viewport to prevent chat panel collapse below its 400px CSS min-width */
const MAX_EDITOR_WIDTH_RATIO = 0.5;

/**
 * Debounce delay for workspace switch RPC calls (ms).
 * Prevents rapid-fire RPC when user clicks through workspaces quickly.
 */
const SWITCH_DEBOUNCE_MS = 100;

@Injectable({ providedIn: 'root' })
export class ElectronLayoutService implements MessageHandler {
  private readonly vscodeService = inject(VSCodeService);
  private readonly appState = inject(AppStateManager);
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly coordinator = inject(WORKSPACE_COORDINATOR, {
    optional: true,
  });

  // Layout dimensions
  private readonly _workspaceSidebarWidth = signal(DEFAULT_SIDEBAR_WIDTH);
  private readonly _workspaceSidebarVisible = signal(true);
  private readonly _editorPanelWidth = signal(DEFAULT_EDITOR_WIDTH);
  private readonly _editorPanelVisible = signal(false);
  private readonly _sidebarDragging = signal(false);
  private readonly _editorDragging = signal(false);

  // Workspace state
  private readonly _workspaceFolders = signal<WorkspaceFolder[]>([]);
  private readonly _activeWorkspaceIndex = signal(0);

  // TASK_2025_208: Workspace switch coordination state
  private _switchId = 0;
  private _switchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Public readonly signals
  readonly workspaceSidebarWidth = this._workspaceSidebarWidth.asReadonly();
  readonly workspaceSidebarVisible = this._workspaceSidebarVisible.asReadonly();
  readonly editorPanelWidth = this._editorPanelWidth.asReadonly();
  readonly editorPanelVisible = this._editorPanelVisible.asReadonly();
  readonly sidebarDragging = this._sidebarDragging.asReadonly();
  readonly editorDragging = this._editorDragging.asReadonly();
  readonly workspaceFolders = this._workspaceFolders.asReadonly();
  readonly activeWorkspaceIndex = this._activeWorkspaceIndex.asReadonly();

  readonly activeWorkspace = computed(() => {
    const folders = this._workspaceFolders();
    const index = this._activeWorkspaceIndex();
    return folders[index] ?? null;
  });

  readonly hasWorkspaceFolders = computed(
    () => this._workspaceFolders().length > 0,
  );

  // ── MessageHandler implementation ─────────────────────────────────
  // Listens for WORKSPACE_CHANGED so that "Open Folder" from the native
  // menu (or any other main-process trigger that fires onDidChangeWorkspaceFolders)
  // re-syncs the renderer folder list without requiring a full page reload.
  readonly handledMessageTypes = [MESSAGE_TYPES.WORKSPACE_CHANGED];

  handleMessage(message: { type: string; payload?: unknown }): void {
    // Only handle in Electron context
    if (!this.vscodeService.isElectron) return;

    // If restoreLayout's getInfo is still in-flight (_switchId was already
    // bumped by it), this WORKSPACE_CHANGED is a side-effect of the same
    // addFolder that triggered restoreLayout — the restore covers it, so
    // drop the redundant sync.  syncFromBackend owns the bump; calling it
    // here unconditionally would race.  Instead we simply delegate and let
    // syncFromBackend's stale-id guard sort it out.
    void this.syncFromBackend(null);

    // Suppress the unused-variable warning — payload is intentionally ignored
    void message;
  }

  constructor() {
    // Only restore layout in Electron context (avoids wasteful side effects in VS Code)
    if (this.vscodeService.isElectron) {
      if (!this.coordinator) {
        console.warn(
          '[ElectronLayout] Running in Electron without WORKSPACE_COORDINATOR — workspace coordination disabled',
        );
      }
      this.restoreLayout();
      this.setupWindowResizeHandler();
    }
  }

  /**
   * Re-clamp editor panel width when the window is resized smaller.
   * Prevents the editor from exceeding 50% of viewport after a window shrink.
   */
  private setupWindowResizeHandler(): void {
    const handler = () => {
      const currentEditor = this._editorPanelWidth();
      const maxEditor = window.innerWidth * MAX_EDITOR_WIDTH_RATIO;
      if (currentEditor > maxEditor) {
        this._editorPanelWidth.set(Math.max(MIN_EDITOR_WIDTH, maxEditor));
      }
    };
    window.addEventListener('resize', handler);
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('resize', handler);
    });
  }

  // ── Sidebar width ──────────────────────────────────────────────────

  setWorkspaceSidebarWidth(width: number): void {
    const clamped = Math.min(
      Math.max(width, MIN_SIDEBAR_WIDTH),
      MAX_SIDEBAR_WIDTH,
    );
    this._workspaceSidebarWidth.set(clamped);
  }

  setSidebarDragging(value: boolean): void {
    this._sidebarDragging.set(value);
    if (!value) {
      this.persistLayout();
    }
  }

  toggleWorkspaceSidebar(): void {
    this._workspaceSidebarVisible.update((v) => !v);
    this.persistLayout();
  }

  // ── Editor panel ───────────────────────────────────────────────────

  setEditorPanelWidth(width: number): void {
    const maxWidth = window.innerWidth * MAX_EDITOR_WIDTH_RATIO;
    const clamped = Math.min(Math.max(width, MIN_EDITOR_WIDTH), maxWidth);
    this._editorPanelWidth.set(clamped);
  }

  setEditorDragging(value: boolean): void {
    this._editorDragging.set(value);
    if (!value) {
      this.persistLayout();
    }
  }

  toggleEditorPanel(): void {
    this._editorPanelVisible.update((v) => !v);
    this.persistLayout();
  }

  setEditorPanelVisible(visible: boolean): void {
    this._editorPanelVisible.set(visible);
    this.persistLayout();
  }

  // ── Workspace folders ──────────────────────────────────────────────

  /**
   * Programmatically add a workspace folder by its absolute path.
   * Used by WorktreeService to auto-register newly created worktrees.
   * Deduplicates against existing folders and auto-switches to the new folder.
   *
   * Unlike addFolder(), this does not open a file dialog -- it directly
   * registers the given path as a workspace folder.
   */
  async addFolderByPath(folderPath: string): Promise<void> {
    // Deduplicate: don't add if the path already exists
    const existing = this._workspaceFolders();
    if (existing.some((f) => f.path === folderPath)) {
      const existingIndex = existing.findIndex((f) => f.path === folderPath);
      if (existingIndex >= 0) {
        this.switchWorkspace(existingIndex);
      }
      return;
    }

    // Register with backend first so the folder persists across restarts
    try {
      const result = await this.rpcService.call('workspace:registerFolder', {
        path: folderPath,
      });
      if (!result.isSuccess() || !result.data?.success) {
        console.error(
          '[ElectronLayout] Failed to register folder with backend:',
          result.isSuccess() ? result.data?.error : 'RPC failed',
        );
        return;
      }
    } catch (error) {
      console.error(
        '[ElectronLayout] workspace:registerFolder RPC failed:',
        error,
      );
      return;
    }

    this._workspaceFolders.update((folders) => [
      ...folders,
      {
        path: folderPath,
        name: this.folderName(folderPath),
      },
    ]);

    const newIndex = this._workspaceFolders().length - 1;
    this.switchWorkspace(newIndex);
  }

  async addFolder(): Promise<void> {
    try {
      // 5-minute timeout: the native file-picker dialog waits for user input
      // and can easily exceed the default 30-second RPC timeout.
      const result = await this.rpcService.call(
        'workspace:addFolder',
        {},
        {
          timeout: 300_000,
        },
      );
      if (!result.isSuccess() || !result.data) return;

      const data = result.data;
      if (!data.path) {
        // User cancelled the dialog or backend returned an error
        if (data.error) {
          console.error('[ElectronLayout] addFolder error:', data.error);
        }
        return;
      }

      // Deduplicate: don't add if the path already exists
      const existing = this._workspaceFolders();
      if (existing.some((f) => f.path === data.path)) {
        // Already open — just switch to it
        const existingIndex = existing.findIndex((f) => f.path === data.path);
        if (existingIndex >= 0) {
          this.switchWorkspace(existingIndex);
        }
        return;
      }

      this._workspaceFolders.update((folders) => [
        ...folders,
        {
          path: data.path!,
          name: data.name || this.folderName(data.path!),
        },
      ]);
      // Auto-switch to the new folder
      const newIndex = this._workspaceFolders().length - 1;
      this.switchWorkspace(newIndex);
    } catch (error) {
      console.error('[ElectronLayout] Failed to add folder:', error);
    }
  }

  /**
   * Remove a workspace folder by index.
   *
   * TASK_2025_208: Before removal, checks for streaming tabs in the workspace.
   * If streaming tabs exist, shows a confirmation dialog. On confirm, sends
   * chat:abort RPC for each streaming session before proceeding with removal.
   * After removal, cleans up TabManagerService and EditorService state.
   *
   * Handles edge case: removing the only workspace resets to "no workspace" state.
   */
  async removeFolder(index: number): Promise<void> {
    const folders = this._workspaceFolders();
    if (index < 0 || index >= folders.length) return;

    const removedFolder = folders[index];

    // TASK_2025_208: Check for streaming tabs before removal
    if (this.coordinator) {
      const streamingSessionIds = this.coordinator.getStreamingSessionIds(
        removedFolder.path,
      );

      if (streamingSessionIds.length > 0) {
        const confirmed = await this.coordinator.confirm({
          title: 'Close Workspace?',
          message: `This workspace has ${
            streamingSessionIds.length
          } active streaming session${
            streamingSessionIds.length > 1 ? 's' : ''
          }. Closing it will abort ${
            streamingSessionIds.length > 1 ? 'them' : 'it'
          }. Continue?`,
          confirmLabel: 'Close Workspace',
          cancelLabel: 'Cancel',
          confirmStyle: 'error',
        });

        if (!confirmed) {
          return;
        }

        // Abort all streaming sessions before removal
        await Promise.allSettled(
          streamingSessionIds.map((sessionId) =>
            this.rpcService.call('chat:abort', { sessionId }).catch((error) => {
              console.error(
                `[ElectronLayout] Failed to abort session ${sessionId}:`,
                error,
              );
            }),
          ),
        );
      }
    }

    // Remove from backend first — if this fails, don't mutate frontend state.
    // Prevents zombie folders that reappear on restart.
    try {
      const result = await this.rpcService.call('workspace:removeFolder', {
        path: removedFolder.path,
      });
      if (!result.isSuccess()) {
        console.error(
          '[ElectronLayout] Backend rejected folder removal:',
          result,
        );
        return;
      }
    } catch (error) {
      console.error(
        '[ElectronLayout] Failed to remove folder from backend:',
        error,
      );
      return;
    }

    // Backend confirmed — now safe to mutate frontend state
    this._workspaceFolders.update((f) => f.filter((_, i) => i !== index));

    const newLength = this._workspaceFolders().length;
    if (newLength === 0) {
      this._activeWorkspaceIndex.set(0);
    } else if (this._activeWorkspaceIndex() >= newLength) {
      this._activeWorkspaceIndex.set(newLength - 1);
    }

    // TASK_2025_208: Clean up frontend state for the removed workspace
    this.cleanupWorkspaceState(removedFolder.path);

    // If we still have folders, coordinate switch to the new active workspace
    const newActive = this.activeWorkspace();
    if (newActive) {
      this.coordinateWorkspaceSwitch(
        newActive.path,
        this._activeWorkspaceIndex(),
      );
    } else {
      // No workspaces left -- update VSCodeService to empty state
      this.vscodeService.updateWorkspaceRoot('');
    }

    this.persistLayout();
  }

  /**
   * Switch to a workspace by index.
   *
   * TASK_2025_208: Implements debounced workspace switching with stale-response
   * protection. The UI updates immediately (signal set before RPC) for instant
   * perceived switch. The backend RPC is debounced by 100ms to handle rapid
   * clicking. A switchId counter ensures stale RPC responses are discarded.
   *
   * After RPC success: coordinates TabManagerService, EditorService, and
   * VSCodeService updates for the new workspace.
   */
  switchWorkspace(index: number): void {
    const folders = this._workspaceFolders();
    if (index < 0 || index >= folders.length) return;

    // No-op only if already on this workspace AND VSCodeService already reflects it.
    // When adding the first workspace folder, _activeWorkspaceIndex is already 0
    // (the default), but workspaceRoot is empty — we must coordinate, not no-op.
    if (
      this._activeWorkspaceIndex() === index &&
      this.vscodeService.config().workspaceRoot === folders[index].path
    ) {
      return;
    }

    // Capture previous index BEFORE updating signal so rollback can revert correctly
    const previousIndex = this._activeWorkspaceIndex();

    // Update UI immediately for instant perceived switch
    this._activeWorkspaceIndex.set(index);
    this.persistLayout();

    // Debounced backend coordination
    const folder = folders[index];
    this.debouncedWorkspaceSwitch(folder.path, previousIndex);
  }

  setWorkspaceFolders(folders: WorkspaceFolder[]): void {
    this._workspaceFolders.set(folders);
  }

  // ── Workspace switch coordination (TASK_2025_208) ─────────────────

  /**
   * Debounce workspace switch RPC calls. If called again within SWITCH_DEBOUNCE_MS,
   * the previous pending switch is cancelled and replaced with the new one.
   * Uses a switchId counter to discard stale RPC responses.
   */
  private debouncedWorkspaceSwitch(
    newPath: string,
    previousIndex: number,
  ): void {
    // Cancel any pending debounced switch
    if (this._switchDebounceTimer !== null) {
      clearTimeout(this._switchDebounceTimer);
      this._switchDebounceTimer = null;
    }

    // Increment switch ID -- stale responses will have a lower ID and be discarded
    const currentSwitchId = ++this._switchId;

    this._switchDebounceTimer = setTimeout(async () => {
      this._switchDebounceTimer = null;

      try {
        // Send workspace:switch RPC
        const result = await this.rpcService.call('workspace:switch', {
          path: newPath,
        });

        // Discard stale response: a newer switch has been initiated since this RPC started
        if (this._switchId !== currentSwitchId) {
          return;
        }

        if (!result.isSuccess()) {
          console.error(
            '[ElectronLayout] workspace:switch RPC failed:',
            result,
          );
          // Rollback optimistic UI update so the sidebar doesn't show a
          // workspace as active when the backend is still on the old one.
          this._activeWorkspaceIndex.set(previousIndex);
          this.persistLayout();
          return;
        }

        // Coordinate frontend services for the new workspace
        this.coordinateWorkspaceSwitch(newPath, previousIndex);
      } catch (error) {
        // Only rollback/log if this switch is still the latest
        if (this._switchId === currentSwitchId) {
          console.error('[ElectronLayout] Failed to switch workspace:', error);
          this._activeWorkspaceIndex.set(previousIndex);
          this.persistLayout();
        }
      }
    }, SWITCH_DEBOUNCE_MS);
  }

  /**
   * Coordinate all frontend services after a workspace switch.
   * Called after workspace:switch RPC succeeds or during removeFolder when
   * switching to a new active workspace.
   *
   * Uses WORKSPACE_COORDINATOR DI token (provided by chat library) to avoid
   * circular dependencies between core and chat/editor.
   *
   * TASK_2025_208 Fix 5: Improved error handling. If coordination fails,
   * reverts _activeWorkspaceIndex to the previous value to prevent leaving
   * the UI in an inconsistent state (sidebar showing workspace A, but chat
   * showing workspace B's tabs).
   */
  private coordinateWorkspaceSwitch(
    newPath: string,
    previousIndex: number,
  ): void {
    try {
      if (this.coordinator) {
        const result = this.coordinator.switchWorkspace(newPath);
        // Handle async coordinator (returns Promise<void> after TASK_2025_259)
        if (result instanceof Promise) {
          result.catch((error) => {
            console.error(
              '[ElectronLayout] Async workspace coordination failed:',
              error,
            );
          });
        }
      }

      // Update VSCodeService config so all consumers see the new workspaceRoot
      this.vscodeService.updateWorkspaceRoot(newPath);

      // Update AppStateManager so dashboard and other consumers using
      // appState.workspaceInfo() see the new workspace path
      const workspaceName = this.folderName(newPath);
      this.appState.setWorkspaceInfo({
        name: workspaceName,
        path: newPath,
        type: 'workspace',
      });
    } catch (error) {
      console.error(
        '[ElectronLayout] Failed to coordinate workspace switch:',
        error,
      );

      // Revert the active workspace index to prevent inconsistent UI state
      const targetIndex = this._workspaceFolders().findIndex(
        (f) => f.path === newPath,
      );
      if (targetIndex >= 0 && this._activeWorkspaceIndex() === targetIndex) {
        this._activeWorkspaceIndex.set(previousIndex);
        this.persistLayout();
        console.warn(
          `[ElectronLayout] Reverted activeWorkspaceIndex from ${targetIndex} to ${previousIndex} after coordination failure`,
        );
      }
    }
  }

  /**
   * Clean up workspace state via the coordinator.
   */
  private cleanupWorkspaceState(workspacePath: string): void {
    if (this.coordinator) {
      try {
        const result = this.coordinator.removeWorkspaceState(workspacePath);
        // Handle async coordinator (returns Promise<void> after TASK_2025_259)
        if (result instanceof Promise) {
          result.catch((error) => {
            console.error(
              '[ElectronLayout] Async workspace cleanup failed:',
              error,
            );
          });
        }
      } catch (error) {
        console.error(
          '[ElectronLayout] Failed to clean up workspace state:',
          error,
        );
      }
    }
  }

  // ── Persistence ────────────────────────────────────────────────────

  private persistLayout(): void {
    const state = {
      sidebarWidth: this._workspaceSidebarWidth(),
      sidebarVisible: this._workspaceSidebarVisible(),
      editorWidth: this._editorPanelWidth(),
      editorVisible: this._editorPanelVisible(),
    };
    this.vscodeService.setState(LAYOUT_STATE_KEY, state);
  }

  /**
   * Restore layout from persisted webview state.
   *
   * TASK_2025_208 (Task 4.4): After restoring workspace folders and active index,
   * sends an initial workspace:switch RPC for the active workspace to ensure the
   * backend activates the correct child container on renderer load. Also
   * coordinates TabManagerService and EditorService for the restored workspace.
   */
  private restoreLayout(): void {
    const state = this.vscodeService.getState<{
      sidebarWidth?: number;
      sidebarVisible?: boolean;
      editorWidth?: number;
      editorVisible?: boolean;
      workspaceFolders?: unknown[];
      activeWorkspaceIndex?: number;
    }>(LAYOUT_STATE_KEY);

    // Restore layout dimensions only when persisted state exists, but ALWAYS
    // run the backend workspace-fetch path regardless.  On first launch state
    // is null; skipping workspace:getInfo + coordinateWorkspaceSwitch would
    // leave the renderer with no folders and no active workspace.
    if (state) {
      // Route through clamping methods to enforce min/max constraints
      if (typeof state.sidebarWidth === 'number') {
        this.setWorkspaceSidebarWidth(state.sidebarWidth);
      }
      if (typeof state.sidebarVisible === 'boolean') {
        this._workspaceSidebarVisible.set(state.sidebarVisible);
      }
      if (typeof state.editorWidth === 'number') {
        this.setEditorPanelWidth(state.editorWidth);
      }
      if (typeof state.editorVisible === 'boolean') {
        this._editorPanelVisible.set(state.editorVisible);
      }
    }

    // Fetch workspace list from backend (source of truth: global-state.json).
    // Runs unconditionally — including on first launch when state is null/undefined.
    void this.syncFromBackend(state ?? null);
  }

  /**
   * Single authoritative method that owns ++_switchId and the full
   *   workspace:getInfo → workspace:switch → coordinateWorkspaceSwitch
   * sequence.
   *
   * Both restoreLayout() and handleMessage() delegate here so the two
   * call sites cannot race each other: whichever bumps _switchId last
   * wins; earlier in-flight calls bail at the stale-id guard.
   *
   * @param cachedState - Persisted webview state available as a fallback
   *   when the backend has no workspaces. Pass null when there is no
   *   cached state (first launch, or handleMessage path).
   */
  private async syncFromBackend(
    cachedState: {
      workspaceFolders?: unknown[];
      activeWorkspaceIndex?: number;
    } | null,
  ): Promise<void> {
    const syncId = ++this._switchId;

    try {
      const result = await this.rpcService.call('workspace:getInfo', {});

      if (this._switchId !== syncId) return;

      if (result.isSuccess() && result.data) {
        const info = result.data;

        if (info.folders && info.folders.length > 0) {
          const backendFolders: WorkspaceFolder[] = info.folders.map(
            (p: string) => ({
              path: p,
              name: this.folderName(p),
            }),
          );
          this._workspaceFolders.set(backendFolders);

          const activeIndex = info.activeFolder
            ? Math.max(0, info.folders.indexOf(info.activeFolder))
            : 0;
          this._activeWorkspaceIndex.set(activeIndex);

          const activePath = backendFolders[activeIndex]?.path;
          if (activePath) {
            // workspace:switch must be called before coordinateWorkspaceSwitch
            // so the backend session context is set for the correct workspace
            // before TabManager loads sessions.
            const switchResult = await this.rpcService.call(
              'workspace:switch',
              {
                path: activePath,
              },
            );

            if (this._switchId !== syncId) return;

            if (switchResult.isSuccess()) {
              this.coordinateWorkspaceSwitch(activePath, activeIndex);
            } else {
              console.error(
                '[ElectronLayout] workspace:switch RPC failed during sync:',
                switchResult,
              );
            }
          }

          // Only persist when we actually loaded something meaningful so that
          // a truly empty first-launch (no cached state, no backend folders)
          // does not dirty the storage with default dim values.
          this.persistLayout();
        } else {
          // Backend has no workspaces
          if (cachedState) {
            // Fall back to cached webview state (only when available)
            this.restoreWorkspaceFoldersFromCache(cachedState);
            this.persistLayout();
          } else {
            // Genuinely empty first launch — clear to known-good state
            // without persisting so first-launch detection stays clean.
            this._workspaceFolders.set([]);
            this._activeWorkspaceIndex.set(0);
            this.appState.setWorkspaceInfo(null);
            this.vscodeService.updateWorkspaceRoot('');
          }
        }
      } else if (cachedState) {
        // getInfo itself failed (non-success result) — fall back to cache
        this.restoreWorkspaceFoldersFromCache(cachedState);
        this.persistLayout();
      }
    } catch {
      if (this._switchId !== syncId) return;
      // RPC threw — fall back to cached webview state if available
      if (cachedState) {
        this.restoreWorkspaceFoldersFromCache(cachedState);
        this.persistLayout();
      }
    }
  }

  private restoreWorkspaceFoldersFromCache(state: {
    workspaceFolders?: unknown[];
    activeWorkspaceIndex?: number;
  }): void {
    if (Array.isArray(state.workspaceFolders)) {
      const validFolders = state.workspaceFolders.filter(
        (f): f is WorkspaceFolder =>
          f != null &&
          typeof f === 'object' &&
          typeof (f as WorkspaceFolder).path === 'string' &&
          typeof (f as WorkspaceFolder).name === 'string',
      );
      this._workspaceFolders.set(validFolders);
    }
    if (typeof state.activeWorkspaceIndex === 'number') {
      const maxIndex = Math.max(0, this._workspaceFolders().length - 1);
      this._activeWorkspaceIndex.set(
        Math.min(Math.max(0, state.activeWorkspaceIndex), maxIndex),
      );
    }

    const restoredFolders = this._workspaceFolders();
    const restoredIndex = this._activeWorkspaceIndex();
    if (restoredFolders.length > 0 && restoredFolders[restoredIndex]) {
      const activePath = restoredFolders[restoredIndex].path;
      const restoreSwitchId = ++this._switchId;

      this.rpcService
        .call('workspace:switch', { path: activePath })
        .then((result) => {
          if (this._switchId !== restoreSwitchId) return;
          if (result.isSuccess()) {
            this.coordinateWorkspaceSwitch(activePath, restoredIndex);
          }
        })
        .catch((error) => {
          console.error(
            '[ElectronLayout] Fallback workspace:switch failed:',
            error,
          );
        });
    }
  }

  private folderName(folderPath: string): string {
    return folderPath.split(/[\\/]/).pop() || folderPath;
  }
}
