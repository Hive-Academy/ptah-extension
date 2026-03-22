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
import { SessionId } from '@ptah-extension/shared';
import { VSCodeService } from './vscode.service';
import { ClaudeRpcService } from './claude-rpc.service';
import { WORKSPACE_COORDINATOR } from '../tokens/workspace-coordinator.token';

export interface WorkspaceFolder {
  path: string;
  name: string;
}

const LAYOUT_STATE_KEY = 'electron-layout';
const DEFAULT_SIDEBAR_WIDTH = 220;
const DEFAULT_EDITOR_WIDTH = 500;
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
export class ElectronLayoutService {
  private readonly vscodeService = inject(VSCodeService);
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly coordinator = inject(WORKSPACE_COORDINATOR, {
    optional: true,
  });

  // Layout dimensions
  private readonly _workspaceSidebarWidth = signal(DEFAULT_SIDEBAR_WIDTH);
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
    () => this._workspaceFolders().length > 0
  );

  constructor() {
    // Only restore layout in Electron context (avoids wasteful side effects in VS Code)
    if (this.vscodeService.isElectron) {
      if (!this.coordinator) {
        console.warn(
          '[ElectronLayout] Running in Electron without WORKSPACE_COORDINATOR — workspace coordination disabled'
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
      MAX_SIDEBAR_WIDTH
    );
    this._workspaceSidebarWidth.set(clamped);
  }

  setSidebarDragging(value: boolean): void {
    this._sidebarDragging.set(value);
    if (!value) {
      this.persistLayout();
    }
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

  async addFolder(): Promise<void> {
    try {
      const result = await this.rpcService.call('workspace:addFolder', {});
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
        removedFolder.path
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
                error
              );
            })
          )
        );
      }
    }

    // Remove the folder from the list
    this._workspaceFolders.update((f) => f.filter((_, i) => i !== index));

    // Adjust active index
    const newLength = this._workspaceFolders().length;
    if (newLength === 0) {
      this._activeWorkspaceIndex.set(0);
    } else if (this._activeWorkspaceIndex() >= newLength) {
      this._activeWorkspaceIndex.set(newLength - 1);
    }

    // Notify backend of folder removal
    this.rpcService
      .call('workspace:removeFolder', { path: removedFolder.path })
      .catch((error) => {
        console.error(
          '[ElectronLayout] Failed to remove folder from backend:',
          error
        );
      });

    // TASK_2025_208: Clean up frontend state for the removed workspace
    this.cleanupWorkspaceState(removedFolder.path);

    // If we still have folders, coordinate switch to the new active workspace
    const newActive = this.activeWorkspace();
    if (newActive) {
      this.coordinateWorkspaceSwitch(
        newActive.path,
        this._activeWorkspaceIndex()
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

    // No-op if already on this workspace
    if (this._activeWorkspaceIndex() === index) return;

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
    previousIndex: number
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
            result
          );
          return;
        }

        // Coordinate frontend services for the new workspace
        this.coordinateWorkspaceSwitch(newPath, previousIndex);
      } catch (error) {
        // Only log if this switch is still the latest
        if (this._switchId === currentSwitchId) {
          console.error('[ElectronLayout] Failed to switch workspace:', error);
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
    previousIndex: number
  ): void {
    try {
      if (this.coordinator) {
        this.coordinator.switchWorkspace(newPath);
      }

      // Update VSCodeService config so all consumers see the new workspaceRoot
      this.vscodeService.updateWorkspaceRoot(newPath);
    } catch (error) {
      console.error(
        '[ElectronLayout] Failed to coordinate workspace switch:',
        error
      );

      // Revert the active workspace index to prevent inconsistent UI state
      const targetIndex = this._workspaceFolders().findIndex(
        (f) => f.path === newPath
      );
      if (targetIndex >= 0 && this._activeWorkspaceIndex() === targetIndex) {
        this._activeWorkspaceIndex.set(previousIndex);
        this.persistLayout();
        console.warn(
          `[ElectronLayout] Reverted activeWorkspaceIndex from ${targetIndex} to ${previousIndex} after coordination failure`
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
        this.coordinator.removeWorkspaceState(workspacePath);
      } catch (error) {
        console.error(
          '[ElectronLayout] Failed to clean up workspace state:',
          error
        );
      }
    }
  }

  // ── Persistence ────────────────────────────────────────────────────

  private persistLayout(): void {
    const state = {
      sidebarWidth: this._workspaceSidebarWidth(),
      editorWidth: this._editorPanelWidth(),
      editorVisible: this._editorPanelVisible(),
      workspaceFolders: this._workspaceFolders(),
      activeWorkspaceIndex: this._activeWorkspaceIndex(),
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
      editorWidth?: number;
      editorVisible?: boolean;
      workspaceFolders?: unknown[];
      activeWorkspaceIndex?: number;
    }>(LAYOUT_STATE_KEY);

    if (!state) return;

    // Route through clamping methods to enforce min/max constraints
    if (typeof state.sidebarWidth === 'number') {
      this.setWorkspaceSidebarWidth(state.sidebarWidth);
    }
    if (typeof state.editorWidth === 'number') {
      this.setEditorPanelWidth(state.editorWidth);
    }
    if (typeof state.editorVisible === 'boolean') {
      this._editorPanelVisible.set(state.editorVisible);
    }
    // Validate workspace folders shape before restoring
    if (Array.isArray(state.workspaceFolders)) {
      const validFolders = state.workspaceFolders.filter(
        (f): f is WorkspaceFolder =>
          f != null &&
          typeof f === 'object' &&
          typeof (f as WorkspaceFolder).path === 'string' &&
          typeof (f as WorkspaceFolder).name === 'string'
      );
      this._workspaceFolders.set(validFolders);
    }
    if (typeof state.activeWorkspaceIndex === 'number') {
      const maxIndex = Math.max(0, this._workspaceFolders().length - 1);
      this._activeWorkspaceIndex.set(
        Math.min(Math.max(0, state.activeWorkspaceIndex), maxIndex)
      );
    }

    // TASK_2025_208 (Task 4.4): Send initial workspace:switch RPC for the
    // restored active workspace so the backend activates the correct child container.
    //
    // Fix 2: Await RPC before coordinating frontend services to prevent
    // race condition where frontend switches before backend is ready.
    const restoredFolders = this._workspaceFolders();
    const restoredIndex = this._activeWorkspaceIndex();

    if (restoredFolders.length > 0 && restoredFolders[restoredIndex]) {
      const activePath = restoredFolders[restoredIndex].path;

      // Send workspace:switch RPC and AWAIT before coordinating (no debounce on initial load)
      this.rpcService
        .call('workspace:switch', { path: activePath })
        .then((result) => {
          if (!result.isSuccess()) {
            console.error(
              '[ElectronLayout] Initial workspace:switch RPC failed:',
              result
            );
            return;
          }

          // Only coordinate frontend services AFTER backend confirms the switch
          this.coordinateWorkspaceSwitch(activePath, restoredIndex);
        })
        .catch((error) => {
          console.error(
            '[ElectronLayout] Failed to send initial workspace:switch:',
            error
          );
        });
    }
  }

  private folderName(folderPath: string): string {
    return folderPath.split(/[\\/]/).pop() || folderPath;
  }
}
