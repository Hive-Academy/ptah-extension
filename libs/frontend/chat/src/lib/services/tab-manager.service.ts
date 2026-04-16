import { Injectable, signal, computed, inject, Injector } from '@angular/core';
import { TabState, TabViewMode } from './chat.types';
import { ConfirmationDialogService } from './confirmation-dialog.service';
import { StreamingHandlerService } from './chat-store/streaming-handler.service';
import { AgentMonitorStore } from './agent-monitor.store';
import {
  TabWorkspacePartitionService,
  TabLookupResult,
} from './tab-workspace-partition.service';

// Re-export for backward compatibility (type was previously defined here)
export type { TabLookupResult } from './tab-workspace-partition.service';

/**
 * TabManagerService - Manages multi-session tab state with workspace partitioning
 *
 * Responsibilities:
 * - Create, close, switch between tabs
 * - Track active tab and tab signals for UI reactivity
 * - Persist active workspace tab state to localStorage
 * - Visual streaming indicators
 * - Delegate workspace partitioning to TabWorkspacePartitionService
 *
 * Architecture:
 * - Signal-based state management (Angular 20+)
 * - Readonly public signals for reactive consumption
 * - Computed signals for derived state
 * - _tabs signal always reflects the ACTIVE workspace's tabs (for UI binding)
 * - Workspace partitioning delegated to TabWorkspacePartitionService (TASK_2025_208 Batch 6)
 */
@Injectable({ providedIn: 'root' })
export class TabManagerService {
  // ============================================================================
  // DEPENDENCIES
  // ============================================================================

  private readonly confirmationDialog = inject(ConfirmationDialogService);
  private readonly injector = inject(Injector);
  private readonly workspacePartition = inject(TabWorkspacePartitionService);

  // ============================================================================
  // PRIVATE STATE SIGNALS
  // ============================================================================

  private readonly _tabs = signal<TabState[]>([]);
  private readonly _activeTabId = signal<string | null>(null);

  /**
   * Streaming indicator signal - tracks which tabs are currently streaming.
   * This is a VISUAL-ONLY indicator, completely isolated from tab.status state machine.
   * Does not affect session management, message sending, or any backend communication.
   */
  private readonly _streamingTabIds = signal<Set<string>>(new Set());

  /**
   * Signal emitted when a pop-out panel needs to load a specific session.
   * SessionLoaderService listens to this to trigger session loading,
   * breaking the circular dependency (TabManager → SessionLoader → TabManager).
   */
  private readonly _pendingSessionLoad = signal<string | null>(null);
  readonly pendingSessionLoad = this._pendingSessionLoad.asReadonly();

  // Debounce timer for localStorage saves (reduces spam during streaming)
  private _saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly SAVE_DEBOUNCE_MS = 500;

  /**
   * Panel-aware localStorage key prefix for tab state persistence.
   * Sidebar uses empty panelId (workspace-only key).
   * Editor panels use 'ptah.panel.{uuid}' panelId (namespaced key).
   * TASK_2025_117: Prevents localStorage collisions between multiple Angular instances.
   *
   * TASK_2025_208: The full storage key is now computed per-workspace via
   * TabWorkspacePartitionService. This field stores just the panel suffix.
   */
  private readonly _panelId: string | undefined;

  /**
   * Legacy storage key for backward compatibility during migration.
   * Only used for the one-time migration from global key to workspace-scoped key.
   */
  private readonly _legacyStorageKey: string;

  // ============================================================================
  // PUBLIC READONLY SIGNALS
  // ============================================================================

  readonly tabs = this._tabs.asReadonly();
  readonly activeTabId = this._activeTabId.asReadonly();

  /** Read-only signal of tab IDs that are currently streaming (visual indicator only) */
  readonly streamingTabIds = this._streamingTabIds.asReadonly();

  // ============================================================================
  // COMPUTED SIGNALS
  // ============================================================================

  readonly activeTab = computed(
    () => this._tabs().find((t) => t.id === this._activeTabId()) ?? null,
  );
  readonly tabCount = computed(() => this._tabs().length);

  // ============================================================================
  // FINE-GRAINED SELECTORS (STREAMING PERFORMANCE OPTIMIZATION)
  // ============================================================================
  //
  // When updateTab() runs during streaming (~16ms interval), it creates a new
  // tabs array + new tab object via spread: { ...existingTab, ...updates }.
  // Properties NOT in `updates` retain their original reference, e.g.,
  // newTab.messages === oldTab.messages when only streamingState changed.
  //
  // These selectors use `{ equal: (a, b) => a === b }` (reference equality)
  // to suppress false notifications. Downstream computed signals that depend
  // on e.g. activeTabMessages won't re-evaluate during streaming when only
  // streamingState is being updated.
  // ============================================================================

  /** Messages array for active tab. Stable during streaming (only changes on finalization). */
  readonly activeTabMessages = computed(
    () =>
      this._tabs().find((t) => t.id === this._activeTabId())?.messages ?? [],
    { equal: (a, b) => a === b },
  );

  /** Tab status string. Only changes on start/stop streaming, not during. */
  readonly activeTabStatus = computed(
    () =>
      this._tabs().find((t) => t.id === this._activeTabId())?.status ?? null,
    { equal: (a, b) => a === b },
  );

  /** Claude session ID. Only changes on session creation. */
  readonly activeTabSessionId = computed(
    () =>
      this._tabs().find((t) => t.id === this._activeTabId())?.claudeSessionId ??
      null,
    { equal: (a, b) => a === b },
  );

  /** Streaming state. Changes every tick during streaming (this is expected and desired). */
  readonly activeTabStreamingState = computed(
    () =>
      this._tabs().find((t) => t.id === this._activeTabId())?.streamingState ??
      null,
  );

  /** Preloaded stats. Only changes on session load. */
  readonly activeTabPreloadedStats = computed(
    () =>
      this._tabs().find((t) => t.id === this._activeTabId())?.preloadedStats ??
      null,
    { equal: (a, b) => a === b },
  );

  /** Live model stats. Changes only at end of turn. */
  readonly activeTabLiveModelStats = computed(
    () =>
      this._tabs().find((t) => t.id === this._activeTabId())?.liveModelStats ??
      null,
    { equal: (a, b) => a === b },
  );

  /** Model usage list. Changes only at end of turn. */
  readonly activeTabModelUsageList = computed(
    () =>
      this._tabs().find((t) => t.id === this._activeTabId())?.modelUsageList ??
      null,
    { equal: (a, b) => a === b },
  );

  /** Whether compaction is in progress for the active tab. */
  readonly activeTabIsCompacting = computed(
    () =>
      this._tabs().find((t) => t.id === this._activeTabId())?.isCompacting ??
      false,
    { equal: (a, b) => a === b },
  );

  /** Compaction count. Rarely changes. */
  readonly activeTabCompactionCount = computed(
    () =>
      this._tabs().find((t) => t.id === this._activeTabId())?.compactionCount ??
      0,
    { equal: (a, b) => a === b },
  );

  /** View mode for active tab. Defaults to 'full'. */
  readonly activeTabViewMode = computed(
    () =>
      this._tabs().find((t) => t.id === this._activeTabId())?.viewMode ??
      'full',
    { equal: (a, b) => a === b },
  );

  /** Queued content. Changes only when user queues/clears. */
  readonly activeTabQueuedContent = computed(
    () =>
      this._tabs().find((t) => t.id === this._activeTabId())?.queuedContent ??
      null,
    { equal: (a, b) => a === b },
  );

  // ============================================================================
  // TAB LOOKUP
  // ============================================================================

  /**
   * Find a tab by its Claude session ID - searches ACTIVE workspace first,
   * then falls back to cross-workspace lookup via partition service.
   *
   * Returns null for tabs without sessions (new tabs).
   *
   * TASK_2025_208: This method searches across ALL workspace tab sets
   * to support background workspace streaming. When a tab is found in the
   * active workspace, it returns directly from the signal. When found in a
   * background workspace, it returns the tab from the partition service.
   */
  findTabBySessionId(sessionId: string): TabState | null {
    // First check active workspace tabs (fast path - from signal)
    const activeTab = this._tabs().find((t) => t.claudeSessionId === sessionId);
    if (activeTab) return activeTab;

    // TASK_2025_208: Delegate cross-workspace search to partition service
    const result = this.workspacePartition.findTabBySessionIdAcrossWorkspaces(
      sessionId,
      this._tabs(),
    );
    return result?.tab ?? null;
  }

  /**
   * Find a tab by session ID with workspace context.
   * Returns both the tab and the workspace it belongs to.
   * Essential for cross-workspace streaming routing (TASK_2025_208 Component 9).
   *
   * Delegates to TabWorkspacePartitionService for O(1) lookup via reverse index.
   */
  findTabBySessionIdAcrossWorkspaces(
    sessionId: string,
  ): TabLookupResult | null {
    return this.workspacePartition.findTabBySessionIdAcrossWorkspaces(
      sessionId,
      this._tabs(),
    );
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  constructor() {
    // TASK_2025_117: Compute panel-aware localStorage key before loading state.
    // window.ptahConfig is injected by the extension host before Angular bootstraps.
    // Sidebar gets empty panelId (uses backward-compatible 'ptah.tabs' key).
    // Editor panels get unique panelId like 'ptah.panel.{uuid}' (namespaced key).
    const ptahConfig = (
      window as unknown as {
        ptahConfig?: {
          panelId?: string;
          initialSessionId?: string | null;
          initialSessionName?: string | null;
        };
      }
    ).ptahConfig;
    this._panelId = ptahConfig?.panelId;
    this._legacyStorageKey = this._panelId
      ? `ptah.tabs.${this._panelId}`
      : 'ptah.tabs';

    // Initialize workspace partition service with panel configuration
    this.workspacePartition.initialize(this._panelId, this._legacyStorageKey);

    // Load saved tab state on service initialization.
    // At this point we don't know the workspace path yet, so we load from the
    // legacy global key. When switchWorkspace() is called, we'll migrate.
    this.loadTabState();

    // If panel was opened with a specific session (pop-out), load that session tab
    const initialSessionId = ptahConfig?.initialSessionId;
    if (initialSessionId && this._panelId) {
      // Clear any default tabs and open the requested session
      this._tabs.set([]);
      this.openSessionTab(
        initialSessionId,
        ptahConfig?.initialSessionName || undefined,
      );

      // Signal that a session needs loading. SessionLoaderService listens to this
      // signal via effect() — no circular dependency needed.
      this._pendingSessionLoad.set(initialSessionId);
    }
    // No default tab creation -- the empty state is shown when there are no tabs.
    // A tab is created on-demand when the user sends their first message
    // (ConversationService.startNewConversation auto-creates a tab if none exists).
  }

  /** Clear the pending session load signal after it has been consumed. */
  clearPendingSessionLoad(): void {
    this._pendingSessionLoad.set(null);
  }

  // ============================================================================
  // WORKSPACE OPERATIONS (delegated to TabWorkspacePartitionService)
  // ============================================================================

  /**
   * Switch the active workspace, swapping tab state in and out.
   *
   * Delegates to TabWorkspacePartitionService for workspace map management,
   * then updates _tabs and _activeTabId signals so the UI reflects the new workspace's tabs.
   *
   * @param workspacePath - The workspace folder path to switch to
   */
  switchWorkspace(workspacePath: string): void {
    const result = this.workspacePartition.switchWorkspace(
      workspacePath,
      this._tabs(),
      this._activeTabId(),
    );

    // null means already on this workspace (no-op)
    if (!result) return;

    // Update signals with target workspace's tab state
    this._tabs.set(result.tabs);
    this._activeTabId.set(result.activeTabId);
  }

  /**
   * Remove all tab state for a workspace.
   * Called when a workspace folder is removed from the layout.
   * Cleans up in-memory state and localStorage.
   *
   * @param workspacePath - The workspace folder path to clean up
   */
  removeWorkspaceState(workspacePath: string): void {
    const wasActive =
      this.workspacePartition.removeWorkspaceState(workspacePath);

    // If the removed workspace was active, clear signals
    if (wasActive) {
      this._tabs.set([]);
      this._activeTabId.set(null);
    }
  }

  /**
   * Get the tabs for a specific workspace (for inspection, e.g., checking streaming tabs).
   * Returns the tab array for the given workspace, or empty array if not found.
   */
  getWorkspaceTabs(workspacePath: string): TabState[] {
    return this.workspacePartition.getWorkspaceTabs(
      workspacePath,
      this._tabs(),
    );
  }

  /**
   * Get the currently active workspace path.
   */
  get activeWorkspacePath(): string | null {
    return this.workspacePartition.activeWorkspacePath;
  }

  /**
   * Cache a backend-provided encoded path for a workspace.
   * Called when workspace:switch RPC response includes encodedPath.
   */
  setBackendEncodedPath(workspacePath: string, encodedPath: string): void {
    this.workspacePartition.setBackendEncodedPath(workspacePath, encodedPath);
  }

  // ============================================================================
  // TAB OPERATIONS
  // ============================================================================

  /**
   * Open a tab for a session - reuses existing tab if session already open
   * This prevents duplicate tabs for the same Claude session.
   * @param claudeSessionId - The Claude CLI session UUID
   * @param title - Optional tab title (defaults to session ID prefix)
   * @returns Tab ID (existing or newly created)
   */
  openSessionTab(claudeSessionId: string, title?: string): string {
    // Check if tab already exists for this session (active workspace only)
    const existingTab = this._tabs().find(
      (t) => t.claudeSessionId === claudeSessionId,
    );

    if (existingTab) {
      // Switch to existing tab instead of creating duplicate
      this.switchTab(existingTab.id);
      return existingTab.id;
    }

    // Create new tab with session ID
    const id = this.generateTabId();
    const newTab: TabState = {
      id,
      claudeSessionId,
      placeholderSessionId: null, // No placeholder for existing session
      name: title || claudeSessionId.substring(0, 50),
      title: title || claudeSessionId.substring(0, 50),
      order: this._tabs().length,
      status: 'loaded',
      isDirty: false,
      lastActivityAt: Date.now(),
      messages: [],
      streamingState: null,
    };

    this._tabs.update((tabs) => [...tabs, newTab]);
    this._activeTabId.set(id);

    // TASK_2025_208 Fix 4: Populate reverse index for O(1) session lookup
    if (this.workspacePartition.activeWorkspacePath) {
      this.workspacePartition.registerSessionForWorkspace(
        claudeSessionId,
        this.workspacePartition.activeWorkspacePath,
      );
    }

    this.saveTabState();

    return id;
  }

  /**
   * Create a new tab
   * @param name - Optional session name
   * @returns Tab ID
   */
  createTab(name?: string): string {
    const id = this.generateTabId();
    const sessionName = name || 'New Chat';

    const newTab: TabState = {
      id,
      claudeSessionId: null, // Set by StreamingHandler on first streaming event
      placeholderSessionId: null, // No longer used
      name: sessionName,
      title: sessionName,
      order: this._tabs().length,
      status: 'fresh',
      isDirty: false,
      lastActivityAt: Date.now(),
      messages: [],
      streamingState: null,
    };

    this._tabs.update((tabs) => [...tabs, newTab]);
    this._activeTabId.set(id);
    this.saveTabState();

    return id;
  }

  /**
   * Force-close a tab without confirmation dialog.
   * Used by pop-out flow where the session is being transferred, not abandoned.
   * @param tabId - Tab ID to close
   */
  forceCloseTab(tabId: string): void {
    const tabs = this._tabs();
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const tabIndex = tabs.findIndex((t) => t.id === tabId);

    // Skip agent cleanup -- agents will be restored in the target panel
    // Only clean up deduplication state
    if (tab.claudeSessionId) {
      const streamingHandler = this.injector.get(StreamingHandlerService);
      streamingHandler.cleanupSessionDeduplication(tab.claudeSessionId);

      // TASK_2025_208 Fix 4: Clean up reverse index
      this.workspacePartition.unregisterSession(tab.claudeSessionId);
    }

    this._tabs.update((tabs) => tabs.filter((t) => t.id !== tabId));

    if (this._activeTabId() === tabId) {
      const remaining = this._tabs();
      if (remaining.length > 0) {
        const newActiveIndex = Math.min(tabIndex, remaining.length - 1);
        this._activeTabId.set(remaining[newActiveIndex].id);
      } else {
        this._activeTabId.set(null);
      }
    }

    this.saveTabState();
  }

  /**
   * Close a tab (with optional confirmation for streaming/dirty tabs)
   * Uses custom confirmation dialog since window.confirm doesn't work in VS Code webviews.
   * @param tabId - Tab ID to close
   */
  async closeTab(tabId: string): Promise<void> {
    const tabs = this._tabs();
    const tab = tabs.find((t) => t.id === tabId);

    if (!tab) return;

    // Check if tab needs confirmation
    const needsConfirmation =
      tab.isDirty || tab.status === 'streaming' || tab.status === 'resuming';

    if (needsConfirmation) {
      const confirmed = await this.confirmationDialog.confirm({
        title: 'Close Tab?',
        message:
          'This session has unsaved changes or is actively streaming. Are you sure you want to close it?',
        confirmLabel: 'Close',
        cancelLabel: 'Keep Open',
        confirmStyle: 'error',
      });

      if (!confirmed) {
        return;
      }
    }

    // TASK_2025_090: Clean up deduplication state to prevent memory leaks
    // Use lazy injection to avoid circular dependency (StreamingHandler depends on TabManager)
    if (tab.claudeSessionId) {
      const streamingHandler = this.injector.get(StreamingHandlerService);
      streamingHandler.cleanupSessionDeduplication(tab.claudeSessionId);

      // Clean up agent monitor cards for this session
      const agentMonitorStore = this.injector.get(AgentMonitorStore);
      agentMonitorStore.clearSessionAgents(tab.claudeSessionId);

      // TASK_2025_208 Fix 4: Clean up reverse index
      this.workspacePartition.unregisterSession(tab.claudeSessionId);
    }

    const tabIndex = tabs.findIndex((t) => t.id === tabId);

    // Remove tab
    this._tabs.update((tabs) => tabs.filter((t) => t.id !== tabId));

    // Switch to adjacent tab if closing active
    if (this._activeTabId() === tabId) {
      const remaining = this._tabs();
      if (remaining.length > 0) {
        // Switch to tab at same index, or last tab if we closed the last one
        const newActiveIndex = Math.min(tabIndex, remaining.length - 1);
        this._activeTabId.set(remaining[newActiveIndex].id);
      } else {
        this._activeTabId.set(null);
      }
    }

    this.saveTabState();
  }

  /**
   * Switch to a different tab
   * @param tabId - Tab ID to switch to
   */
  switchTab(tabId: string): void {
    const tab = this._tabs().find((t) => t.id === tabId);
    if (!tab) {
      console.warn(`[TabManager] Tab not found: ${tabId}`);
      return;
    }

    this._activeTabId.set(tabId);
    this.saveTabState();
  }

  /**
   * Update tab properties.
   *
   * TASK_2025_208: This method is workspace-aware. If the tab belongs to the
   * active workspace, it updates the _tabs signal (triggering UI reactivity).
   * If the tab belongs to a background workspace (identified via cross-workspace
   * lookup), it delegates to TabWorkspacePartitionService.updateBackgroundTab().
   *
   * PERFORMANCE OPTIMIZATION: Uses shallow equality check to avoid
   * unnecessary signal updates when streamingState hasn't actually changed.
   * This is critical during high-frequency streaming events.
   *
   * @param tabId - Tab ID to update
   * @param updates - Partial tab state updates
   */
  updateTab(tabId: string, updates: Partial<TabState>): void {
    // Fast path: check active workspace's tabs first
    const activeTabs = this._tabs();
    const activeTabIndex = activeTabs.findIndex((t) => t.id === tabId);

    if (activeTabIndex !== -1) {
      // Tab is in the active workspace -- update via signal for UI reactivity
      this._tabs.update((tabs) => {
        const tabIndex = tabs.findIndex((t) => t.id === tabId);
        if (tabIndex === -1) return tabs;

        const existingTab = tabs[tabIndex];

        // PERFORMANCE: Skip update if streamingState reference is identical
        if (
          updates.streamingState !== undefined &&
          updates.streamingState === existingTab.streamingState &&
          Object.keys(updates).length === 1
        ) {
          return tabs;
        }

        const updatedTab = {
          ...existingTab,
          ...updates,
          lastActivityAt: Date.now(),
        };

        // TASK_2025_208 Fix 4: Populate reverse index when claudeSessionId is assigned
        if (
          updates.claudeSessionId &&
          this.workspacePartition.activeWorkspacePath
        ) {
          this.workspacePartition.registerSessionForWorkspace(
            updates.claudeSessionId,
            this.workspacePartition.activeWorkspacePath,
          );
        }

        const newTabs = [...tabs];
        newTabs[tabIndex] = updatedTab;
        return newTabs;
      });
      this.saveTabState();
      return;
    }

    // TASK_2025_208: Tab not in active workspace -- delegate to partition service
    this.workspacePartition.updateBackgroundTab(tabId, updates);
  }

  /**
   * Reorder tabs via drag-and-drop
   * @param fromIndex - Source index
   * @param toIndex - Target index
   */
  reorderTabs(fromIndex: number, toIndex: number): void {
    this._tabs.update((tabs) => {
      const result = [...tabs];
      const [removed] = result.splice(fromIndex, 1);
      result.splice(toIndex, 0, removed);

      // Update order property
      return result.map((tab, index) => ({ ...tab, order: index }));
    });
    this.saveTabState();
  }

  // ============================================================================
  // ADVANCED TAB OPERATIONS (for context menu)
  // ============================================================================

  /**
   * Rename a tab
   * Note: Uses signal-based approach since window.prompt doesn't work in VS Code webviews.
   * The UI should handle this via inline editing or a custom dialog.
   * @param tabId - Tab ID to rename
   * @param newTitle - New title for the tab
   */
  renameTab(tabId: string, newTitle?: string): void {
    const tab = this._tabs().find((t) => t.id === tabId);
    if (!tab) return;

    // If no title provided, this is a no-op (UI should handle input)
    if (!newTitle || newTitle.trim() === '') {
      return;
    }

    // Truncate to 100 chars max
    const sanitizedTitle = newTitle.trim().substring(0, 100);

    this.updateTab(tabId, { title: sanitizedTitle });
  }

  /**
   * Duplicate a tab
   * @param tabId - Tab ID to duplicate
   */
  duplicateTab(tabId: string): void {
    const tab = this._tabs().find((t) => t.id === tabId);
    if (!tab) return;

    const newTabId = this.generateTabId();
    const duplicatedTab: TabState = {
      ...tab,
      id: newTabId,
      name: `${tab.name} (Copy)`,
      title: `${tab.title} (Copy)`,
      order: this._tabs().length,
      status: 'loaded', // Duplicated tab is loaded (not streaming)
      isDirty: false,
      lastActivityAt: Date.now(),
    };

    this._tabs.update((tabs) => [...tabs, duplicatedTab]);
    this._activeTabId.set(newTabId);
    this.saveTabState();
  }

  /**
   * Close all tabs except the specified one
   * Uses custom confirmation dialog since window.confirm doesn't work in VS Code webviews.
   * @param tabId - Tab ID to keep
   */
  async closeOtherTabs(tabId: string): Promise<void> {
    const tab = this._tabs().find((t) => t.id === tabId);
    if (!tab) return;

    const otherTabsCount = this._tabs().length - 1;
    if (otherTabsCount === 0) return;

    const confirmed = await this.confirmationDialog.confirm({
      title: 'Close Other Tabs?',
      message: `This will close ${otherTabsCount} other tab${
        otherTabsCount > 1 ? 's' : ''
      }.`,
      confirmLabel: 'Close Others',
      cancelLabel: 'Cancel',
      confirmStyle: 'warning',
    });

    if (!confirmed) return;

    this._tabs.set([tab]);
    this._activeTabId.set(tabId);
    this.saveTabState();
  }

  /**
   * Close all tabs to the right of the specified tab
   * Uses custom confirmation dialog since window.confirm doesn't work in VS Code webviews.
   * @param tabId - Tab ID (tabs to the right will be closed)
   */
  async closeTabsToRight(tabId: string): Promise<void> {
    const tabs = this._tabs();
    const tabIndex = tabs.findIndex((t) => t.id === tabId);

    if (tabIndex === -1 || tabIndex === tabs.length - 1) return;

    const tabsToCloseCount = tabs.length - tabIndex - 1;

    const confirmed = await this.confirmationDialog.confirm({
      title: 'Close Tabs to Right?',
      message: `This will close ${tabsToCloseCount} tab${
        tabsToCloseCount > 1 ? 's' : ''
      } to the right.`,
      confirmLabel: 'Close',
      cancelLabel: 'Cancel',
      confirmStyle: 'warning',
    });

    if (!confirmed) return;

    const remaining = tabs.slice(0, tabIndex + 1);
    this._tabs.set(remaining);

    // If active tab was closed, switch to the kept tab
    if (!remaining.find((t) => t.id === this._activeTabId())) {
      this._activeTabId.set(tabId);
    }

    this.saveTabState();
  }

  // ============================================================================
  // PERSISTENCE (per-workspace localStorage)
  // ============================================================================

  /**
   * Save tab state to browser localStorage for the active workspace.
   * Uses debouncing to reduce write frequency during streaming.
   */
  saveTabState(): void {
    // Cancel any pending save
    if (this._saveTimeout) {
      clearTimeout(this._saveTimeout);
    }

    // Schedule debounced save (reduces 220+ writes to just a few during streaming)
    this._saveTimeout = setTimeout(() => {
      this._saveTimeout = null;
      this._doSaveTabState();
    }, this.SAVE_DEBOUNCE_MS);
  }

  /**
   * Actually perform the localStorage save (called after debounce).
   * Saves to workspace-scoped key if a workspace is active, otherwise to legacy key.
   */
  private _doSaveTabState(): void {
    try {
      const state = {
        tabs: this._tabs(),
        activeTabId: this._activeTabId(),
        version: 1,
      };

      const activeWsPath = this.workspacePartition.activeWorkspacePath;
      const key = activeWsPath
        ? this.workspacePartition.getStorageKeyForWorkspace(activeWsPath)
        : this._legacyStorageKey;

      localStorage.setItem(key, JSON.stringify(state));

      // Also keep the partition service's in-memory map in sync with the signal
      this.workspacePartition.syncActiveWorkspaceState(
        this._tabs(),
        this._activeTabId(),
      );
    } catch (error) {
      console.warn('[TabManager] Failed to save tab state:', error);
    }
  }

  /**
   * Load tab state from browser localStorage.
   * On initial load (no workspace yet), loads from legacy global key.
   */
  loadTabState(): void {
    try {
      const stored = localStorage.getItem(this._legacyStorageKey);
      if (!stored) {
        return;
      }

      const state = JSON.parse(stored);

      if (state.version !== 1) {
        console.warn('[TabManager] Incompatible tab state version');
        return;
      }

      if (state.tabs && Array.isArray(state.tabs)) {
        // TASK_2025_087: Clear streamingState when loading from localStorage
        // Maps (events, eventsByMessage, etc.) don't serialize to JSON properly
        // and become plain objects, causing "get is not a function" errors
        const sanitizedTabs = state.tabs.map((tab: TabState) => ({
          ...tab,
          streamingState: null, // Clear transient streaming state
          // TASK_2025_COMPACT_FIX: Also sanitize 'resuming' and 'switching' — these
          // are transient states that should never persist across reloads.
          status:
            tab.status === 'streaming' ||
            tab.status === 'resuming' ||
            tab.status === 'switching'
              ? 'loaded'
              : tab.status,
          // Clear stale queued content that may have been persisted during streaming
          queuedContent: null,
          queuedOptions: null,
        }));
        this._tabs.set(sanitizedTabs);
        this._activeTabId.set(state.activeTabId);
      }
    } catch (error) {
      console.warn('[TabManager] Failed to load tab state:', error);
    }
  }

  // ============================================================================
  // STREAMING INDICATOR (Visual Only - No Side Effects)
  // ============================================================================

  /**
   * Mark a tab as streaming (shows spinner in tab bar).
   * This is VISUAL ONLY - does not affect tab.status or any state machine.
   */
  markTabStreaming(tabId: string): void {
    this._streamingTabIds.update((set) => new Set([...set, tabId]));
  }

  /**
   * Mark a tab as idle (hides spinner in tab bar).
   * This is VISUAL ONLY - does not block any actions or affect state.
   */
  markTabIdle(tabId: string): void {
    this._streamingTabIds.update((set) => {
      const newSet = new Set(set);
      newSet.delete(tabId);
      return newSet;
    });
  }

  /**
   * Check if a tab is currently streaming (for visual indicator).
   */
  isTabStreaming(tabId: string): boolean {
    return this._streamingTabIds().has(tabId);
  }

  /**
   * Toggle a tab's view mode between 'full' and 'compact'.
   * Each tab independently controls its view mode.
   */
  toggleTabViewMode(tabId: string): void {
    const tab = this._tabs().find((t) => t.id === tabId);
    if (!tab) return;
    const newMode: TabViewMode =
      (tab.viewMode ?? 'full') === 'full' ? 'compact' : 'full';
    this.updateTab(tabId, { viewMode: newMode });
  }

  /**
   * Get a specific tab's view mode.
   */
  getTabViewMode(tabId: string): TabViewMode {
    return this._tabs().find((t) => t.id === tabId)?.viewMode ?? 'full';
  }

  // ============================================================================
  // UTILITIES
  // ============================================================================

  /**
   * Generate unique tab ID
   */
  private generateTabId(): string {
    return `tab_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
