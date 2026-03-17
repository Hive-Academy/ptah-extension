/**
 * Electron Layout Service
 *
 * Signal-based state management for the Electron desktop 3-panel layout.
 * Manages workspace sidebar width, editor panel width/visibility,
 * workspace folders, and layout persistence via state storage.
 */

import {
  Injectable,
  signal,
  computed,
  inject,
  DestroyRef,
} from '@angular/core';
import { VSCodeService } from './vscode.service';
import { ClaudeRpcService } from './claude-rpc.service';

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

@Injectable({ providedIn: 'root' })
export class ElectronLayoutService {
  private readonly vscodeService = inject(VSCodeService);
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly destroyRef = inject(DestroyRef);

  // Layout dimensions
  private readonly _workspaceSidebarWidth = signal(DEFAULT_SIDEBAR_WIDTH);
  private readonly _editorPanelWidth = signal(DEFAULT_EDITOR_WIDTH);
  private readonly _editorPanelVisible = signal(false);
  private readonly _sidebarDragging = signal(false);
  private readonly _editorDragging = signal(false);

  // Workspace state
  private readonly _workspaceFolders = signal<WorkspaceFolder[]>([]);
  private readonly _activeWorkspaceIndex = signal(0);

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
      this._activeWorkspaceIndex.set(newIndex);
      this.persistLayout();
    } catch (error) {
      console.error('[ElectronLayout] Failed to add folder:', error);
    }
  }

  removeFolder(index: number): void {
    const folders = this._workspaceFolders();
    if (index < 0 || index >= folders.length) return;

    const removedFolder = folders[index];

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

    // If we still have folders, notify backend of the new active workspace
    const newActive = this.activeWorkspace();
    if (newActive) {
      this.rpcService
        .call('workspace:switch', { path: newActive.path })
        .catch((error) => {
          console.error(
            '[ElectronLayout] Failed to switch workspace after removal:',
            error
          );
        });
    }

    this.persistLayout();
  }

  switchWorkspace(index: number): void {
    const folders = this._workspaceFolders();
    if (index < 0 || index >= folders.length) return;

    this._activeWorkspaceIndex.set(index);
    this.persistLayout();

    // Notify backend of workspace switch
    const folder = folders[index];
    this.rpcService
      .call('workspace:switch', { path: folder.path })
      .catch((error) => {
        console.error('[ElectronLayout] Failed to switch workspace:', error);
      });
  }

  setWorkspaceFolders(folders: WorkspaceFolder[]): void {
    this._workspaceFolders.set(folders);
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
  }

  private folderName(folderPath: string): string {
    return folderPath.split(/[\\/]/).pop() || folderPath;
  }
}
