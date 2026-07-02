import { Injectable, signal } from '@angular/core';
import { TabState } from '@ptah-extension/chat-types';

/**
 * Internal type for a workspace's tab set stored in the workspace tab map.
 * Contains the full tab array and the active tab ID for that workspace.
 */
export interface WorkspaceTabSet {
  tabs: TabState[];
  activeTabId: string | null;
}

/**
 * Result of a cross-workspace tab lookup.
 * Includes the tab and the workspace it belongs to.
 */
export interface TabLookupResult {
  tab: TabState;
  workspacePath: string;
}

/**
 * TabWorkspacePartitionService - Manages workspace-partitioned tab state
 *
 * Isolates workspace partitioning concerns from core tab CRUD operations.
 *
 * Responsibilities:
 * - Partition tab state by workspace path
 * - Switch workspace context (save current tabs, load target tabs)
 * - Cross-workspace session lookup (O(1) via reverse index)
 * - Per-workspace localStorage persistence
 * - One-time migration from global to workspace-scoped storage
 * - Background workspace tab updates (streaming in non-active workspace)
 * - Session-to-workspace reverse index management
 * - Backend encoded path caching
 *
 * Architecture:
 * - Internal Map<workspacePath, WorkspaceTabSet> for workspace-partitioned state
 * - _sessionToWorkspace reverse index for O(1) cross-workspace session lookup
 * - Per-workspace debounced localStorage saves for background workspaces
 * - One-time migration from global 'ptah.tabs' key to per-workspace keys
 *
 * Integration with TabManagerService:
 * - TabManagerService owns _tabs/_activeTabId signals (UI reactivity)
 * - This service owns the workspace map and handles workspace switching logic
 * - switchWorkspace() accepts current tab state, returns target workspace tabs
 * - updateBackgroundTab() mutates tabs in background workspaces without signals
 */
@Injectable({ providedIn: 'root' })
export class TabWorkspacePartitionService {
  /**
   * Map of workspace path to tab set. Contains ALL workspace tab sets,
   * including background workspaces. The active workspace's tab set is
   * also mirrored in TabManagerService's _tabs signal for UI reactivity.
   *
   * Cross-workspace streaming depends on this map containing all
   * workspaces, not just the active one.
   */
  private readonly _workspaceTabSets = new Map<string, WorkspaceTabSet>();

  /**
   * Currently active workspace path. Null when no workspace is active
   * (e.g., app just started, no workspace opened yet).
   */
  private readonly _activeWorkspacePath = signal<string | null>(null);

  /**
   * Consume-and-clear signal that emits the workspace path just removed
   * via removeWorkspaceState(); paired with clearRemovedWorkspace().
   */
  private readonly _removedWorkspace = signal<string | null>(null);

  readonly activeWorkspacePath$ = this._activeWorkspacePath.asReadonly();
  readonly removedWorkspace$ = this._removedWorkspace.asReadonly();

  /**
   * Reverse index from sessionId to workspacePath for O(1) lookup.
   * Populated when tabs are created/loaded with a claudeSessionId.
   * Used by findTabBySessionIdAcrossWorkspaces() instead of O(W*T) linear scan.
   */
  private readonly _sessionToWorkspace = new Map<string, string>();

  /**
   * Cache of backend-provided encoded workspace paths.
   * When the backend sends an encodedPath in workspace:switch response,
   * we cache it here so localStorage keys match the backend's encoding.
   */
  private readonly _backendEncodedPaths = new Map<string, string>();

  /**
   * Per-workspace debounce timers for background saves.
   * Prevents hammering localStorage when streaming events update background
   * workspace tabs.
   */
  private readonly _backgroundSaveTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly BG_SAVE_DEBOUNCE_MS = 500;

  private _panelId: string | undefined;

  initialize(panelId: string | undefined): void {
    this._panelId = panelId;
  }

  /**
   * Get the currently active workspace path.
   */
  get activeWorkspacePath(): string | null {
    return this._activeWorkspacePath();
  }

  /** Acknowledge the removedWorkspace$ signal after consumption. */
  clearRemovedWorkspace(): void {
    this._removedWorkspace.set(null);
  }

  /**
   * Switch the active workspace, swapping tab state in and out.
   *
   * Flow:
   * 1. Save current workspace's tab state from provided signals into _workspaceTabSets map
   * 2. Perform one-time migration from global localStorage key if needed
   * 3. Load target workspace's tab state from map (or from localStorage, or create empty)
   * 4. Return the target workspace's tabs and activeTabId for TabManagerService to apply
   *
   * This is the core workspace partitioning mechanism.
   * Called by TabManagerService.switchWorkspace() which delegates here.
   *
   * @param workspacePath - The workspace folder path to switch to
   * @param currentTabs - Current tab state from TabManagerService's _tabs signal
   * @param currentActiveTabId - Current active tab ID from TabManagerService's _activeTabId signal
   * @returns The target workspace's tabs and activeTabId, or null if already active
   */
  switchWorkspace(
    workspacePath: string,
    currentTabs: TabState[],
    currentActiveTabId: string | null,
  ): { tabs: TabState[]; activeTabId: string | null } | null {
    const current = this._activeWorkspacePath();
    if (current === workspacePath) return null;
    if (current) {
      this._workspaceTabSets.set(current, {
        tabs: currentTabs,
        activeTabId: currentActiveTabId,
      });
    }
    this._activeWorkspacePath.set(workspacePath);
    const targetTabSet = this._workspaceTabSets.get(workspacePath);

    if (targetTabSet) {
      this._populateSessionIndex(workspacePath, targetTabSet.tabs);
      return { tabs: targetTabSet.tabs, activeTabId: targetTabSet.activeTabId };
    }
    const loaded = this._loadWorkspaceTabsFromStorage(workspacePath);
    if (loaded) {
      this._workspaceTabSets.set(workspacePath, {
        tabs: loaded.tabs,
        activeTabId: loaded.activeTabId,
      });
      this._populateSessionIndex(workspacePath, loaded.tabs);
      return { tabs: loaded.tabs, activeTabId: loaded.activeTabId };
    }
    this._workspaceTabSets.set(workspacePath, {
      tabs: [],
      activeTabId: null,
    });
    return { tabs: [], activeTabId: null };
  }

  /**
   * Get the tabs for a specific workspace (for inspection, e.g., checking streaming tabs).
   * Returns the tab array for the given workspace, or empty array if not found.
   *
   * Note: For the active workspace, callers should prefer the TabManagerService._tabs signal
   * for reactivity. This method returns the map copy which may lag behind the signal.
   *
   * @param workspacePath - Workspace path to query
   * @param activeTabs - Current active workspace tabs (from signal) for active workspace fast path
   */
  getWorkspaceTabs(workspacePath: string, activeTabs?: TabState[]): TabState[] {
    if (workspacePath === this._activeWorkspacePath() && activeTabs) {
      return activeTabs;
    }
    return this._workspaceTabSets.get(workspacePath)?.tabs ?? [];
  }

  /**
   * Find a tab by session ID with workspace context.
   * Returns both the tab and the workspace it belongs to.
   * Essential for cross-workspace streaming routing.
   *
   * Uses _sessionToWorkspace reverse index for O(1) lookup instead of O(W*T)
   * linear scan across all workspace tab sets.
   *
   * When streaming events arrive for a background workspace's session,
   * this method identifies which workspace the tab belongs to so the
   * update can be applied to the correct workspace's tab set in the map.
   *
   * @param sessionId - Claude session ID to look up
   * @param activeTabs - Current active workspace tabs (from signal) for fast path
   */
  findTabBySessionIdAcrossWorkspaces(
    sessionId: string,
    activeTabs?: TabState[],
  ): TabLookupResult | null {
    const activePath = this._activeWorkspacePath();
    const indexedWsPath = this._sessionToWorkspace.get(sessionId);
    if (indexedWsPath) {
      if (indexedWsPath === activePath && activeTabs) {
        const tab = activeTabs.find((t) => t.claudeSessionId === sessionId);
        if (tab) {
          return { tab, workspacePath: indexedWsPath };
        }
      } else {
        const tabSet = this._workspaceTabSets.get(indexedWsPath);
        if (tabSet) {
          const tab = tabSet.tabs.find((t) => t.claudeSessionId === sessionId);
          if (tab) {
            return { tab, workspacePath: indexedWsPath };
          }
        }
      }
      this._sessionToWorkspace.delete(sessionId);
    }
    if (activePath) {
      const tabs =
        activeTabs ?? this._workspaceTabSets.get(activePath)?.tabs ?? [];
      const activeTab = tabs.find((t) => t.claudeSessionId === sessionId);
      if (activeTab) {
        this._sessionToWorkspace.set(sessionId, activePath);
        return { tab: activeTab, workspacePath: activePath };
      }
    }

    for (const [wsPath, tabSet] of this._workspaceTabSets) {
      if (wsPath === activePath) continue;
      const found = tabSet.tabs.find((t) => t.claudeSessionId === sessionId);
      if (found) {
        this._sessionToWorkspace.set(sessionId, wsPath);
        return { tab: found, workspacePath: wsPath };
      }
    }

    return null;
  }

  /**
   * Update a tab in a background workspace (streaming in non-active workspace).
   * Mutates the tab directly in _workspaceTabSets without touching signals.
   *
   * @param tabId - Tab ID to update
   * @param updates - Partial tab state updates
   * @returns true if tab was found and updated, false otherwise
   */
  updateBackgroundTab(tabId: string, updates: Partial<TabState>): boolean {
    const activePath = this._activeWorkspacePath();
    for (const [wsPath, tabSet] of this._workspaceTabSets) {
      if (wsPath === activePath) continue;

      const bgTabIndex = tabSet.tabs.findIndex((t) => t.id === tabId);
      if (bgTabIndex !== -1) {
        const existingTab = tabSet.tabs[bgTabIndex];
        if (
          updates.streamingState !== undefined &&
          updates.streamingState === existingTab.streamingState &&
          Object.keys(updates).length === 1
        ) {
          return true; // No-op but tab was found
        }
        const updatedTab = {
          ...existingTab,
          ...updates,
          lastActivityAt: Date.now(),
        };
        if (updates.claudeSessionId) {
          this._sessionToWorkspace.set(updates.claudeSessionId, wsPath);
        }

        const newTabs = [...tabSet.tabs];
        newTabs[bgTabIndex] = updatedTab;
        tabSet.tabs = newTabs;
        this._debouncedBackgroundSave(wsPath, tabSet);
        return true;
      }
    }

    return false;
  }

  /**
   * Remove all tab state for a workspace.
   * Called when a workspace folder is removed from the layout.
   * Cleans up in-memory state and localStorage.
   *
   * @param workspacePath - The workspace folder path to clean up
   * @returns true if the removed workspace was the active one
   */
  removeWorkspaceState(workspacePath: string): boolean {
    const tabSet = this._workspaceTabSets.get(workspacePath);
    if (tabSet) {
      for (const tab of tabSet.tabs) {
        if (tab.claudeSessionId) {
          this._sessionToWorkspace.delete(tab.claudeSessionId);
        }
      }
    }

    this._workspaceTabSets.delete(workspacePath);
    const pendingTimer = this._backgroundSaveTimers.get(workspacePath);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      this._backgroundSaveTimers.delete(workspacePath);
    }
    this._backendEncodedPaths.delete(workspacePath);
    const storageKey = this._getWorkspaceStorageKey(workspacePath);

    localStorage.removeItem(storageKey);
    const wasActive = this._activeWorkspacePath() === workspacePath;
    if (wasActive) {
      this._activeWorkspacePath.set(null);
    }
    this._removedWorkspace.set(workspacePath);

    return wasActive;
  }

  /**
   * Cache a backend-provided encoded path for a workspace.
   * Called when workspace:switch RPC response includes encodedPath.
   */
  setBackendEncodedPath(workspacePath: string, encodedPath: string): void {
    this._backendEncodedPaths.set(workspacePath, encodedPath);
  }

  /**
   * Register a session ID to a workspace in the reverse index.
   * Called when a tab gets its claudeSessionId assigned (e.g., session:id-resolved).
   */
  registerSessionForWorkspace(sessionId: string, workspacePath: string): void {
    this._sessionToWorkspace.set(sessionId, workspacePath);
  }

  /**
   * Remove a session from the reverse index.
   * Called when a tab is closed or a session is cleaned up.
   */
  unregisterSession(sessionId: string): void {
    this._sessionToWorkspace.delete(sessionId);
  }

  /**
   * Get the localStorage key for a specific workspace (public accessor).
   * Used by TabManagerService._doSaveTabState() for active workspace persistence.
   *
   * @param workspacePath - Workspace path to compute key for
   * @returns localStorage key string
   */
  getStorageKeyForWorkspace(workspacePath: string): string {
    return this._getWorkspaceStorageKey(workspacePath);
  }

  /**
   * Sync the in-memory workspace map with the current active tab state.
   * Called by TabManagerService after saving active workspace tabs to localStorage,
   * to keep the map consistent with the signals.
   *
   * @param tabs - Current tab state from _tabs signal
   * @param activeTabId - Current active tab ID from _activeTabId signal
   */
  syncActiveWorkspaceState(tabs: TabState[], activeTabId: string | null): void {
    const activePath = this._activeWorkspacePath();
    if (activePath) {
      this._workspaceTabSets.set(activePath, {
        tabs,
        activeTabId,
      });
    }
  }

  /**
   * Encode a workspace path for use in localStorage keys.
   *
   * Uses `encodeURIComponent` (which handles all Unicode correctly in
   * browsers) rather than `btoa`, so non-Latin1 characters (e.g.,
   * international usernames like "用户" or "José") are encoded safely.
   *
   * If the backend has provided an encoded path via workspace:switch response,
   * that is used instead to ensure frontend/backend key consistency.
   */
  private _encodeWorkspacePath(workspacePath: string): string {
    const backendEncoded = this._backendEncodedPaths.get(workspacePath);
    if (backendEncoded) {
      return backendEncoded;
    }
    return encodeURIComponent(workspacePath).replace(/%/g, '_');
  }

  /**
   * Get the localStorage key for a specific workspace.
   * Format: ptah.tabs.ws.{encodedPath} or ptah.tabs.ws.{encodedPath}.{panelId}
   */
  private _getWorkspaceStorageKey(workspacePath: string): string {
    const encodedPath = this._encodeWorkspacePath(workspacePath);
    return this._panelId
      ? `ptah.tabs.ws.${encodedPath}.${this._panelId}`
      : `ptah.tabs.ws.${encodedPath}`;
  }

  /**
   * Load a workspace's tab state from localStorage.
   * Returns null if no persisted state exists.
   */
  private _loadWorkspaceTabsFromStorage(
    workspacePath: string,
  ): WorkspaceTabSet | null {
    try {
      const key = this._getWorkspaceStorageKey(workspacePath);
      const stored = localStorage.getItem(key);
      if (!stored) return null;

      const state = JSON.parse(stored);
      if (state.version !== 2 || !state.tabs || !Array.isArray(state.tabs)) {
        return null;
      }

      const sanitizedTabs = state.tabs.map((tab: TabState) => ({
        ...tab,
        streamingState: null,
        status:
          tab.status === 'streaming' || tab.status === 'awaiting-background'
            ? 'loaded'
            : tab.status,
        // Messaging attachment is a live, push-driven flag — a restored tab is
        // never attached. Clear so a stale flag can't leave it read-only.
        attachedBinding: null,
      }));

      return {
        tabs: sanitizedTabs,
        activeTabId: state.activeTabId ?? null,
      };
    } catch {
      return null;
    }
  }

  /**
   * Save a specific workspace's tab set to localStorage.
   * Used for background workspace updates (streaming in background).
   */
  private _saveWorkspaceTabsToStorage(
    workspacePath: string,
    tabSet: WorkspaceTabSet,
  ): void {
    try {
      const key = this._getWorkspaceStorageKey(workspacePath);
      const state = {
        tabs: tabSet.tabs,
        activeTabId: tabSet.activeTabId,
        version: 2,
      };
      localStorage.setItem(key, JSON.stringify(state));
    } catch (error) {
      console.warn(
        `[TabWorkspacePartition] Failed to save background workspace tab state:`,
        error,
      );
    }
  }

  /**
   * Debounced background workspace save.
   * When streaming events rapidly update tabs in background workspaces,
   * this prevents hammering localStorage by coalescing saves per workspace.
   */
  private _debouncedBackgroundSave(
    workspacePath: string,
    tabSet: WorkspaceTabSet,
  ): void {
    const existingTimer = this._backgroundSaveTimers.get(workspacePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    const timer = setTimeout(() => {
      this._backgroundSaveTimers.delete(workspacePath);
      this._saveWorkspaceTabsToStorage(workspacePath, tabSet);
    }, this.BG_SAVE_DEBOUNCE_MS);

    this._backgroundSaveTimers.set(workspacePath, timer);
  }

  /**
   * Populate the session-to-workspace reverse index for all tabs in a
   * workspace that have a claudeSessionId.
   * Called during switchWorkspace() when loading tab state.
   */
  private _populateSessionIndex(workspacePath: string, tabs: TabState[]): void {
    for (const tab of tabs) {
      if (tab.claudeSessionId) {
        this._sessionToWorkspace.set(tab.claudeSessionId, workspacePath);
      }
    }
  }
}
