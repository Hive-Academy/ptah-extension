import { Injectable, signal, computed } from '@angular/core';
import { TabState } from './chat.types';

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
  // PRIVATE STATE SIGNALS
  // ============================================================================

  private readonly _tabs = signal<TabState[]>([]);
  private readonly _activeTabId = signal<string | null>(null);

  // ============================================================================
  // PUBLIC READONLY SIGNALS
  // ============================================================================

  readonly tabs = this._tabs.asReadonly();
  readonly activeTabId = this._activeTabId.asReadonly();

  // ============================================================================
  // COMPUTED SIGNALS
  // ============================================================================

  readonly activeTab = computed(
    () => this._tabs().find((t) => t.id === this._activeTabId()) ?? null
  );
  readonly tabCount = computed(() => this._tabs().length);

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  constructor() {
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
   * Create a new tab
   * @param title - Optional tab title (defaults to "New Chat")
   * @returns Tab ID
   */
  createTab(title?: string): string {
    const id = this.generateTabId();
    const newTab: TabState = {
      id,
      claudeSessionId: null,
      title: title || 'New Chat',
      order: this._tabs().length,
      status: 'fresh',
      isDirty: false,
      lastActivityAt: Date.now(),
      messages: [],
      executionTree: null,
    };

    this._tabs.update((tabs) => [...tabs, newTab]);
    this._activeTabId.set(id);
    this.saveTabState();

    console.log('[TabManager] Tab created:', id, title);
    return id;
  }

  /**
   * Close a tab (with confirmation for dirty/streaming tabs)
   * @param tabId - Tab ID to close
   */
  closeTab(tabId: string): void {
    const tabs = this._tabs();
    const tab = tabs.find((t) => t.id === tabId);

    if (!tab) return;

    // Check if tab needs confirmation
    const needsConfirmation =
      tab.isDirty || tab.status === 'streaming' || tab.status === 'resuming';

    if (needsConfirmation) {
      const confirmed = window.confirm(
        'Close tab?\n\nThis session has unsaved changes or is actively streaming. Are you sure you want to close it?'
      );

      if (!confirmed) {
        console.log('[TabManager] Tab close cancelled by user');
        return;
      }
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
    console.log('[TabManager] Tab closed:', tabId);
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
    console.log('[TabManager] Switched to tab:', tabId);
  }

  /**
   * Update tab properties
   * @param tabId - Tab ID to update
   * @param updates - Partial tab state updates
   */
  updateTab(tabId: string, updates: Partial<TabState>): void {
    this._tabs.update((tabs) =>
      tabs.map((tab) =>
        tab.id === tabId
          ? { ...tab, ...updates, lastActivityAt: Date.now() }
          : tab
      )
    );
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
    console.log('[TabManager] Tabs reordered:', fromIndex, '->', toIndex);
  }

  /**
   * Resolve real Claude session ID for a tab
   * Called when backend responds with real UUID
   * @param tabId - Tab ID
   * @param claudeSessionId - Real Claude CLI session UUID
   */
  resolveSessionId(tabId: string, claudeSessionId: string): void {
    this.updateTab(tabId, {
      claudeSessionId,
      status: 'streaming',
    });
    console.log(
      '[TabManager] Session ID resolved for tab:',
      tabId,
      claudeSessionId
    );
  }

  // ============================================================================
  // ADVANCED TAB OPERATIONS (for context menu)
  // ============================================================================

  /**
   * Rename a tab
   * @param tabId - Tab ID to rename
   */
  renameTab(tabId: string): void {
    const tab = this._tabs().find((t) => t.id === tabId);
    if (!tab) return;

    const newTitle = window.prompt('Enter new tab name:', tab.title);

    if (!newTitle || newTitle.trim() === '') {
      console.log('[TabManager] Rename cancelled or empty');
      return;
    }

    if (newTitle.length > 100) {
      window.alert('Tab name is too long (max 100 characters)');
      return;
    }

    this.updateTab(tabId, { title: newTitle.trim() });
    console.log('[TabManager] Tab renamed:', tabId, '->', newTitle);
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
      title: `${tab.title} (Copy)`,
      order: this._tabs().length,
      status: 'loaded', // Duplicated tab is loaded (not streaming)
      isDirty: false,
      lastActivityAt: Date.now(),
    };

    this._tabs.update((tabs) => [...tabs, duplicatedTab]);
    this._activeTabId.set(newTabId);
    this.saveTabState();

    console.log('[TabManager] Tab duplicated:', tabId, '->', newTabId);
  }

  /**
   * Close all tabs except the specified one
   * @param tabId - Tab ID to keep
   */
  closeOtherTabs(tabId: string): void {
    const tab = this._tabs().find((t) => t.id === tabId);
    if (!tab) return;

    const confirmed = window.confirm(
      'Close all other tabs?\n\nThis will close all tabs except the current one.'
    );

    if (!confirmed) return;

    this._tabs.set([tab]);
    this._activeTabId.set(tabId);
    this.saveTabState();

    console.log('[TabManager] Closed all other tabs, kept:', tabId);
  }

  /**
   * Close all tabs to the right of the specified tab
   * @param tabId - Tab ID (tabs to the right will be closed)
   */
  closeTabsToRight(tabId: string): void {
    const tabs = this._tabs();
    const tabIndex = tabs.findIndex((t) => t.id === tabId);

    if (tabIndex === -1 || tabIndex === tabs.length - 1) return;

    const confirmed = window.confirm(
      'Close tabs to the right?\n\nThis will close all tabs after the current one.'
    );

    if (!confirmed) return;

    const remaining = tabs.slice(0, tabIndex + 1);
    this._tabs.set(remaining);

    // If active tab was closed, switch to the kept tab
    if (!remaining.find((t) => t.id === this._activeTabId())) {
      this._activeTabId.set(tabId);
    }

    this.saveTabState();
    console.log('[TabManager] Closed tabs to right of:', tabId);
  }

  // ============================================================================
  // PERSISTENCE (localStorage for now, TODO: VS Code workspace state)
  // ============================================================================

  /**
   * Save tab state to browser localStorage (temporary)
   * TODO: Integrate with VS Code workspace state API
   */
  saveTabState(): void {
    try {
      const state = {
        tabs: this._tabs(),
        activeTabId: this._activeTabId(),
        version: 1, // For future migration
      };

      localStorage.setItem('ptah.tabs', JSON.stringify(state));
      console.log('[TabManager] Tab state saved to localStorage');
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
      const stored = localStorage.getItem('ptah.tabs');
      if (!stored) {
        console.log('[TabManager] No saved tab state found');
        return;
      }

      const state = JSON.parse(stored);

      if (state.version !== 1) {
        console.warn('[TabManager] Incompatible tab state version');
        return;
      }

      if (state.tabs && Array.isArray(state.tabs)) {
        this._tabs.set(state.tabs);
        this._activeTabId.set(state.activeTabId);
        console.log(
          '[TabManager] Loaded tab state from localStorage:',
          state.tabs.length,
          'tabs'
        );
      }
    } catch (error) {
      console.warn('[TabManager] Failed to load tab state:', error);
    }
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
