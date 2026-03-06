import { Injectable, signal, computed, inject, Injector } from '@angular/core';
import { TabState } from './chat.types';
import { ConfirmationDialogService } from './confirmation-dialog.service';
import { StreamingHandlerService } from './chat-store/streaming-handler.service';

/**
 * TabManagerService - Manages multi-session tab state
 *
 * Responsibilities:
 * - Create, close, switch between tabs
 * - Track active tab
 * - Persist tab state to browser localStorage (temporary solution)
 * - Resolve Claude session IDs when responses arrive
 *
 * Architecture:
 * - Signal-based state management (Angular 20+)
 * - Readonly public signals for reactive consumption
 * - Computed signals for derived state
 * - localStorage for temporary persistence (TODO: VS Code workspace state)
 */
@Injectable({ providedIn: 'root' })
export class TabManagerService {
  // ============================================================================
  // DEPENDENCIES
  // ============================================================================

  private readonly confirmationDialog = inject(ConfirmationDialogService);
  private readonly injector = inject(Injector);

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

  // Debounce timer for localStorage saves (reduces spam during streaming)
  private _saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly SAVE_DEBOUNCE_MS = 500;

  /**
   * Panel-aware localStorage key for tab state persistence.
   * Sidebar uses 'ptah.tabs' (backward compatible).
   * Editor panels use 'ptah.tabs.ptah.panel.{uuid}' (namespaced by panelId).
   * TASK_2025_117: Prevents localStorage collisions between multiple Angular instances.
   */
  private readonly storageKey: string;

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
    () => this._tabs().find((t) => t.id === this._activeTabId()) ?? null
  );
  readonly tabCount = computed(() => this._tabs().length);

  // ============================================================================
  // TAB LOOKUP
  // ============================================================================

  /**
   * Find a tab by its Claude session ID
   * Returns null for tabs without sessions (new tabs)
   */
  findTabBySessionId(sessionId: string): TabState | null {
    return this._tabs().find((t) => t.claudeSessionId === sessionId) ?? null;
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  constructor() {
    // TASK_2025_117: Compute panel-aware localStorage key before loading state.
    // window.ptahConfig is injected by the extension host before Angular bootstraps.
    // Sidebar gets empty panelId (uses backward-compatible 'ptah.tabs' key).
    // Editor panels get unique panelId like 'ptah.panel.{uuid}' (namespaced key).
    const panelId = (window as unknown as { ptahConfig?: { panelId?: string } })
      .ptahConfig?.panelId;
    this.storageKey = panelId ? `ptah.tabs.${panelId}` : 'ptah.tabs';

    // Load saved tab state on service initialization
    this.loadTabState();

    // If no tabs loaded, create initial tab
    if (this._tabs().length === 0) {
      this.createTab('New Chat');
    }
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
    // Check if tab already exists for this session
    const existingTab = this.findTabBySessionId(claudeSessionId);

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
   * Update tab properties
   *
   * PERFORMANCE OPTIMIZATION: Uses shallow equality check to avoid
   * unnecessary signal updates when streamingState hasn't actually changed.
   * This is critical during high-frequency streaming events.
   *
   * @param tabId - Tab ID to update
   * @param updates - Partial tab state updates
   */
  updateTab(tabId: string, updates: Partial<TabState>): void {
    this._tabs.update((tabs) => {
      const tabIndex = tabs.findIndex((t) => t.id === tabId);
      if (tabIndex === -1) return tabs; // Tab not found, no change

      const existingTab = tabs[tabIndex];

      // PERFORMANCE: Skip update if streamingState reference is identical
      // During batched streaming updates, the state object reference is reused
      // until flush, so we can skip redundant updates
      if (
        updates.streamingState !== undefined &&
        updates.streamingState === existingTab.streamingState &&
        Object.keys(updates).length === 1
      ) {
        // Only streamingState is being updated and it's the same reference
        return tabs;
      }

      // Create new tab with updates
      const updatedTab = {
        ...existingTab,
        ...updates,
        lastActivityAt: Date.now(),
      };

      // PERFORMANCE: Create new array only if tab actually changed
      // Use reference equality for the tab object
      const newTabs = [...tabs];
      newTabs[tabIndex] = updatedTab;
      return newTabs;
    });
    this.saveTabState();
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
  // PERSISTENCE (localStorage for now, TODO: VS Code workspace state)
  // ============================================================================

  /**
   * Save tab state to browser localStorage (temporary)
   * Uses debouncing to reduce write frequency during streaming.
   * TODO: Integrate with VS Code workspace state API
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
   * Actually perform the localStorage save (called after debounce)
   */
  private _doSaveTabState(): void {
    try {
      const state = {
        tabs: this._tabs(),
        activeTabId: this._activeTabId(),
        version: 1, // For future migration
      };

      localStorage.setItem(this.storageKey, JSON.stringify(state));
    } catch (error) {
      console.warn('[TabManager] Failed to save tab state:', error);
    }
  }

  /**
   * Load tab state from browser localStorage (temporary)
   * TODO: Integrate with VS Code workspace state API
   */
  loadTabState(): void {
    try {
      const stored = localStorage.getItem(this.storageKey);
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
          status: tab.status === 'streaming' ? 'loaded' : tab.status, // Reset stuck streaming status
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
