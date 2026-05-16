import { Injectable } from '@angular/core';
import { TabState } from '@ptah-extension/chat-types';
import { TabId } from './identity/ids';

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
 * Extracted from TabManagerService (TASK_2025_208 Batch 6) to isolate
 * workspace partitioning concerns from core tab CRUD operations.
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
  // ============================================================================
  // WORKSPACE STATE
  // ============================================================================

  /**
   * Map of workspace path to tab set. Contains ALL workspace tab sets,
   * including background workspaces. The active workspace's tab set is
   * also mirrored in TabManagerService's _tabs signal for UI reactivity.
   *
   * TASK_2025_208: Cross-workspace streaming depends on this map containing
   * all workspaces, not just the active one.
   */
  private readonly _workspaceTabSets = new Map<string, WorkspaceTabSet>();

  /**
   * Currently active workspace path. Null when no workspace is active
   * (e.g., app just started, no workspace opened yet).
   */
  private _activeWorkspacePath: string | null = null;

  /**
   * Whether the one-time migration from global 'ptah.tabs' has been performed.
   * Prevents re-migration on subsequent switchWorkspace() calls.
   */
  private _migrationDone = false;

  /**
   * TASK_2025_208 Fix 4: Reverse index from sessionId to workspacePath for O(1) lookup.
   * Populated when tabs are created/loaded with a claudeSessionId.
   * Used by findTabBySessionIdAcrossWorkspaces() instead of O(W*T) linear scan.
   */
  private readonly _sessionToWorkspace = new Map<string, string>();

  /**
   * TASK_2025_208 Fix 1: Cache of backend-provided encoded workspace paths.
   * When the backend sends an encodedPath in workspace:switch response,
   * we cache it here so localStorage keys match the backend's encoding.
   */
  private readonly _backendEncodedPaths = new Map<string, string>();

  /**
   * TASK_2025_208 Fix 3: Per-workspace debounce timers for background saves.
   * Prevents hammering localStorage when streaming events update background workspace tabs.
   */
  private readonly _backgroundSaveTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly BG_SAVE_DEBOUNCE_MS = 500;

  /**
   * Panel-aware localStorage key components for tab state persistence.
   * Set once during initialize() from TabManagerService.
   */
  private _panelId: string | undefined;
  private _legacyStorageKey = 'ptah.tabs';

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Initialize workspace partition service with panel configuration.
   * Must be called by TabManagerService during its constructor.
   *
   * @param panelId - Panel ID for localStorage namespacing (undefined for sidebar)
   * @param legacyStorageKey - Legacy storage key for migration
   */
  initialize(panelId: string | undefined, legacyStorageKey: string): void {
    this._panelId = panelId;
    this._legacyStorageKey = legacyStorageKey;
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Get the currently active workspace path.
   */
  get activeWorkspacePath(): string | null {
    return this._activeWorkspacePath;
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
   * TASK_2025_208: This is the core workspace partitioning mechanism.
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
    // No-op if switching to already-active workspace
    if (this._activeWorkspacePath === workspacePath) return null;

    // Step 1: Save current workspace's tab state to the map
    if (this._activeWorkspacePath) {
      this._workspaceTabSets.set(this._activeWorkspacePath, {
        tabs: currentTabs,
        activeTabId: currentActiveTabId,
      });
    }

    // Step 2: One-time migration from global localStorage key
    if (!this._migrationDone) {
      this._migrateGlobalTabState(workspacePath);
      this._migrationDone = true;
    }

    // Step 3: Load target workspace's tab state
    this._activeWorkspacePath = workspacePath;
    const targetTabSet = this._workspaceTabSets.get(workspacePath);

    if (targetTabSet) {
      // Workspace has in-memory state -- return it
      // TASK_2025_208 Fix 4: Populate reverse index for loaded tabs
      this._populateSessionIndex(workspacePath, targetTabSet.tabs);
      return { tabs: targetTabSet.tabs, activeTabId: targetTabSet.activeTabId };
    }

    // No in-memory state -- try loading from localStorage
    const loaded = this._loadWorkspaceTabsFromStorage(workspacePath);
    if (loaded) {
      // Store in map for future fast access
      this._workspaceTabSets.set(workspacePath, {
        tabs: loaded.tabs,
        activeTabId: loaded.activeTabId,
      });
      // TASK_2025_208 Fix 4: Populate reverse index for loaded tabs
      this._populateSessionIndex(workspacePath, loaded.tabs);
      return { tabs: loaded.tabs, activeTabId: loaded.activeTabId };
    }

    // Brand new workspace -- empty tab set
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
    if (workspacePath === this._activeWorkspacePath && activeTabs) {
      return activeTabs;
    }
    return this._workspaceTabSets.get(workspacePath)?.tabs ?? [];
  }

  /**
   * Find a tab by session ID with workspace context.
   * Returns both the tab and the workspace it belongs to.
   * Essential for cross-workspace streaming routing (TASK_2025_208 Component 9).
   *
   * TASK_2025_208 Fix 4: Uses _sessionToWorkspace reverse index for O(1) lookup
   * instead of O(W*T) linear scan across all workspace tab sets.
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
    // O(1) fast path: check reverse index first
    const indexedWsPath = this._sessionToWorkspace.get(sessionId);
    if (indexedWsPath) {
      // Verify the tab still exists in the indexed workspace
      if (indexedWsPath === this._activeWorkspacePath && activeTabs) {
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
      // Index was stale, remove it
      this._sessionToWorkspace.delete(sessionId);
    }

    // Fallback: linear scan (handles cases where index wasn't populated)
    if (this._activeWorkspacePath) {
      const tabs =
        activeTabs ??
        this._workspaceTabSets.get(this._activeWorkspacePath)?.tabs ??
        [];
      const activeTab = tabs.find((t) => t.claudeSessionId === sessionId);
      if (activeTab) {
        // Populate index for future lookups
        this._sessionToWorkspace.set(sessionId, this._activeWorkspacePath);
        return { tab: activeTab, workspacePath: this._activeWorkspacePath };
      }
    }

    for (const [wsPath, tabSet] of this._workspaceTabSets) {
      if (wsPath === this._activeWorkspacePath) continue;
      const found = tabSet.tabs.find((t) => t.claudeSessionId === sessionId);
      if (found) {
        // Populate index for future lookups
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
    for (const [wsPath, tabSet] of this._workspaceTabSets) {
      if (wsPath === this._activeWorkspacePath) continue;

      const bgTabIndex = tabSet.tabs.findIndex((t) => t.id === tabId);
      if (bgTabIndex !== -1) {
        const existingTab = tabSet.tabs[bgTabIndex];

        // PERFORMANCE: Skip update if streamingState reference is identical
        if (
          updates.streamingState !== undefined &&
          updates.streamingState === existingTab.streamingState &&
          Object.keys(updates).length === 1
        ) {
          return true; // No-op but tab was found
        }

        // Update the tab in the background workspace's tab set (no signal update)
        const updatedTab = {
          ...existingTab,
          ...updates,
          lastActivityAt: Date.now(),
        };

        // TASK_2025_208 Fix 4: Populate reverse index when claudeSessionId is assigned
        if (updates.claudeSessionId) {
          this._sessionToWorkspace.set(updates.claudeSessionId, wsPath);
        }

        const newTabs = [...tabSet.tabs];
        newTabs[bgTabIndex] = updatedTab;
        tabSet.tabs = newTabs;

        // TASK_2025_208 Fix 3: Debounce background workspace saves
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
    // TASK_2025_208 Fix 4: Clean up session reverse index entries for this workspace
    const tabSet = this._workspaceTabSets.get(workspacePath);
    if (tabSet) {
      for (const tab of tabSet.tabs) {
        if (tab.claudeSessionId) {
          this._sessionToWorkspace.delete(tab.claudeSessionId);
        }
      }
    }

    this._workspaceTabSets.delete(workspacePath);

    // TASK_2025_208 Fix 3: Clean up any pending background save timer
    const pendingTimer = this._backgroundSaveTimers.get(workspacePath);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      this._backgroundSaveTimers.delete(workspacePath);
    }

    // Clean up backend encoded path cache
    this._backendEncodedPaths.delete(workspacePath);

    // Clean up localStorage
    const storageKey = this._getWorkspaceStorageKey(workspacePath);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // Ignore localStorage errors during cleanup
    }

    // Check if the removed workspace was active
    const wasActive = this._activeWorkspacePath === workspacePath;
    if (wasActive) {
      this._activeWorkspacePath = null;
    }

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
    if (this._activeWorkspacePath) {
      this._workspaceTabSets.set(this._activeWorkspacePath, {
        tabs,
        activeTabId,
      });
    }
  }

  // ============================================================================
  // WORKSPACE PERSISTENCE HELPERS (TASK_2025_208)
  // ============================================================================

  /**
   * Encode a workspace path for use in localStorage keys.
   *
   * TASK_2025_208 Fix 1: Replaced btoa() which fails on non-Latin1 characters
   * (e.g., international usernames like "用户" or "José") with encodeURIComponent
   * which handles all Unicode correctly in browsers.
   *
   * If the backend has provided an encoded path via workspace:switch response,
   * that is used instead to ensure frontend/backend key consistency.
   */
  private _encodeWorkspacePath(workspacePath: string): string {
    // Prefer backend-provided encoding for consistency
    const backendEncoded = this._backendEncodedPaths.get(workspacePath);
    if (backendEncoded) {
      return backendEncoded;
    }

    // Browser-safe encoding: encodeURIComponent handles all Unicode,
    // then replace % with _ for filesystem/localStorage-safe keys
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
      if (state.version !== 1 || !state.tabs || !Array.isArray(state.tabs)) {
        return null;
      }

      // Sanitize loaded tabs (clear transient streaming state) and
      // re-mint legacy `tab_<timestamp>_<random>` ids that pre-date the
      // UUID v4 tab-id format. The backend permission path now calls
      // `SessionId.from(tabId)` / `TabId.from(tabId)` which throw on
      // anything else (v0.2.32 regression).
      const idRemap = new Map<string, string>();
      const sanitizedTabs = state.tabs.map((tab: TabState) => {
        const migratedId = TabId.validate(tab.id) ? tab.id : TabId.create();
        if (migratedId !== tab.id) {
          idRemap.set(tab.id, migratedId);
        }
        return {
          ...tab,
          id: migratedId,
          streamingState: null,
          status: tab.status === 'streaming' ? 'loaded' : tab.status,
        };
      });

      const remappedActiveId =
        typeof state.activeTabId === 'string' && idRemap.has(state.activeTabId)
          ? (idRemap.get(state.activeTabId) ?? null)
          : (state.activeTabId ?? null);

      return {
        tabs: sanitizedTabs,
        activeTabId: remappedActiveId,
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
        version: 1,
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
   * TASK_2025_208 Fix 3: Debounced background workspace save.
   * When streaming events rapidly update tabs in background workspaces,
   * this prevents hammering localStorage by coalescing saves per workspace.
   */
  private _debouncedBackgroundSave(
    workspacePath: string,
    tabSet: WorkspaceTabSet,
  ): void {
    // Cancel any pending save for this workspace
    const existingTimer = this._backgroundSaveTimers.get(workspacePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Schedule debounced save
    const timer = setTimeout(() => {
      this._backgroundSaveTimers.delete(workspacePath);
      this._saveWorkspaceTabsToStorage(workspacePath, tabSet);
    }, this.BG_SAVE_DEBOUNCE_MS);

    this._backgroundSaveTimers.set(workspacePath, timer);
  }

  /**
   * One-time migration from global 'ptah.tabs' localStorage key to workspace-scoped key.
   *
   * TASK_2025_208: When the first switchWorkspace() call happens:
   * 1. Check if global 'ptah.tabs' (or 'ptah.tabs.{panelId}') exists in localStorage
   * 2. Check if workspace-scoped key already exists (migration already done)
   * 3. If global exists but workspace-scoped doesn't, assign global tabs to this workspace
   * 4. Delete the global key to prevent re-migration
   *
   * This ensures existing users don't lose their tabs when upgrading to workspace-aware version.
   */
  private _migrateGlobalTabState(firstWorkspacePath: string): void {
    try {
      const wsKey = this._getWorkspaceStorageKey(firstWorkspacePath);

      // If workspace-scoped key already exists, migration was already done
      if (localStorage.getItem(wsKey)) return;

      // Check if legacy global key has data
      const globalData = localStorage.getItem(this._legacyStorageKey);
      if (!globalData) return;

      // Migrate: copy global data to workspace-scoped key
      localStorage.setItem(wsKey, globalData);

      // Also load into the in-memory map if not already there
      if (!this._workspaceTabSets.has(firstWorkspacePath)) {
        const state = JSON.parse(globalData);
        if (state.version === 1 && state.tabs && Array.isArray(state.tabs)) {
          const sanitizedTabs = state.tabs.map((tab: TabState) => ({
            ...tab,
            streamingState: null,
            status: tab.status === 'streaming' ? 'loaded' : tab.status,
          }));
          this._workspaceTabSets.set(firstWorkspacePath, {
            tabs: sanitizedTabs,
            activeTabId: state.activeTabId,
          });
        }
      }

      // Delete global key to prevent re-migration and avoid stale data
      localStorage.removeItem(this._legacyStorageKey);

      console.log(
        `[TabWorkspacePartition] Migrated global tab state to workspace: ${firstWorkspacePath}`,
      );
    } catch (error) {
      console.warn(
        '[TabWorkspacePartition] Failed to migrate global tab state:',
        error,
      );
    }
  }

  /**
   * TASK_2025_208 Fix 4: Populate the session-to-workspace reverse index
   * for all tabs in a workspace that have a claudeSessionId.
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
