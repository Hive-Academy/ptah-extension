import { Injectable, signal, computed, inject } from '@angular/core';
import {
  TabState,
  SessionStatus,
  TabViewMode,
  StreamingState,
  SendMessageOptions,
} from '@ptah-extension/chat-types';
import { ExecutionChatMessage, EffortLevel } from '@ptah-extension/shared';
import { ConfirmationDialogService } from './confirmation-dialog.service';
import { MODEL_REFRESH_CONTROL } from './model-refresh-control';
import {
  TabWorkspacePartitionService,
  TabLookupResult,
} from './tab-workspace-partition.service';
import {
  LiveModelStatsPayload,
  PreloadedStatsPayload,
} from './tab-state.types';
import { TabSessionBinding } from './tab-session-binding.service';
import { ConversationRegistry } from './conversation-registry.service';
import { ClaudeSessionId, TabId } from './identity/ids';

export type { LiveModelStatsPayload, PreloadedStatsPayload };

/**
 * Payload emitted on the `closedTab` signal whenever a tab is closed.
 *
 * TASK_2026_106 Phase 3: replaces the STREAMING_CONTROL inversion. Instead of
 * TabManager calling into a streaming-control interface (which formed the DI
 * cycle), TabManager now emits a structured close event and the StreamRouter
 * (in `@ptah-extension/chat-routing`) reacts to it via `effect()`. The router
 * owns the cleanup decision tree (cleanupSessionDeduplication, clearSessionAgents,
 * binding/registry teardown) so TabManager has zero knowledge of streaming.
 */
export interface ClosedTabEvent {
  readonly tabId: string;
  /**
   * The Claude SDK session id bound to the tab at the moment it closed.
   * Null when the tab never had a session (e.g. fresh tab closed before sending).
   */
  readonly sessionId: string | null;
  /**
   * `close` — full teardown (router clears dedup state AND agent monitor cards).
   * `forceClose` — pop-out transfer; router clears dedup state only, leaves agents
   * alive so the target panel can re-attach. Mirrors the legacy split between
   * `closeTab` and `forceCloseTab`.
   */
  readonly kind: 'close' | 'forceClose';
}

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
 *
 * TASK_2026_106 Phase 3: STREAMING_CONTROL removed. TabManager no longer
 * imports any streaming/agent contract. Instead, on close we emit a structured
 * `ClosedTabEvent` via the `closedTab` signal; the StreamRouter subscribes
 * via `effect()` and performs the per-session cleanup that used to live here.
 * Direction of dependency now flows TabManager → (nothing streaming-aware);
 * the router is the only service that knows both sides of the routing relation.
 */
@Injectable({ providedIn: 'root' })
export class TabManagerService {
  // ============================================================================
  // DEPENDENCIES
  // ============================================================================

  private readonly confirmationDialog = inject(ConfirmationDialogService);
  private readonly workspacePartition = inject(TabWorkspacePartitionService);
  /**
   * TASK_2026_106 Phase 4a — multi-tab fan-out.
   *
   * `findTabsBySessionId` (the plural API below) reads `ConversationRegistry`
   * + `TabSessionBinding` to resolve every tab bound to the conversation
   * containing the session. Both services live in `chat-state` so this is
   * an in-layer dependency — no boundary violation. The router
   * (`@ptah-extension/chat-routing`) is the only writer; TabManager only
   * reads here.
   */
  private readonly conversationRegistry = inject(ConversationRegistry);
  private readonly tabSessionBinding = inject(TabSessionBinding);
  /**
   * MODEL_REFRESH_CONTROL — inverted-dependency contract for refreshing the
   * available-models list after a new tab is created.
   * TASK_2026_105 Wave G2 Phase 2: replaces a direct
   * `inject(ModelStateService)` from `@ptah-extension/core` so that
   * `chat-state` (tagged `type:data-access`) does not violate the Nx
   * module-boundary rule that forbids `type:data-access → type:core`.
   */
  private readonly modelRefresh = inject(MODEL_REFRESH_CONTROL);

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

  /**
   * TASK_2026_106 Phase 3 — closedTab event signal.
   *
   * Emits a `ClosedTabEvent` whenever a tab is closed (via `closeTab` or
   * `forceCloseTab`). Replaces the legacy `STREAMING_CONTROL` push from
   * TabManager → streaming/agent code. The StreamRouter (in
   * `@ptah-extension/chat-routing`) subscribes via `effect()` and performs
   * the per-session cleanup that used to be inlined here, breaking the
   * `TabManager → STREAMING_CONTROL → StreamingHandler/AgentMonitor → TabManager`
   * NG0200 cycle.
   *
   * Held as `null` between events. Each new emission overwrites the previous
   * one — consumers must read it inside an `effect()` or computed reactor;
   * polling is not supported.
   */
  private readonly _closedTab = signal<ClosedTabEvent | null>(null);
  readonly closedTab = this._closedTab.asReadonly();

  // Debounce timer for localStorage saves (reduces spam during streaming)
  private _saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly SAVE_DEBOUNCE_MS = 500;

  /**
   * Per-tab AbortControllers for in-flight streaming RPCs.
   * TASK_2026_103 Wave E2: keyed by tabId so closing a tab while its stream
   * is still being generated can fire `abort()` and trigger backend stop
   * via the `chat:abort` RPC (registered as an `abort` listener by the
   * service that started the stream — typically `MessageSenderService`).
   *
   * Lifecycle:
   * - created on streaming entry point via `createAbortController(tabId)`
   * - cleared (without aborting) on `markTabIdle(tabId)` (clean stream end)
   * - aborted+cleared on `closeTab(tabId)` while a stream is in-flight
   */
  private readonly abortControllers = new Map<string, AbortController>();

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
   * TASK_2026_106 Phase 4a — multi-tab fan-out (plural).
   *
   * Returns EVERY tab bound to the conversation that contains `sessionId`.
   * This is the canvas-grid scenario: two (or more) side-by-side tiles
   * showing the same SDK session both need each stream event written. The
   * legacy singular `findTabBySessionId` returns one match arbitrarily —
   * the others freeze.
   *
   * Resolution order:
   *   1. Look up the conversation containing `sessionId` via
   *      `ConversationRegistry.findContainingSession`.
   *      - If unknown (e.g. tab not yet bound by `StreamRouter`), fall back
   *        to wrapping the legacy singular result in a one-element array
   *        so callers behave identically for not-yet-migrated tabs.
   *   2. Otherwise resolve `TabSessionBinding.tabsFor(convId)` to TabIds and
   *      map each to the matching `TabState` from `_tabs()`.
   *
   * Returns a fresh readonly array (callers may iterate freely). The legacy
   * `findTabBySessionId` is preserved unchanged for the many call sites that
   * only need one tab (presence checks, single-tab UI actions).
   */
  findTabsBySessionId(sessionId: string): readonly TabState[] {
    const convRecord = this.conversationRegistry.findContainingSession(
      sessionId as ClaudeSessionId,
    );
    if (!convRecord) {
      // Legacy fallback — tab existed before StreamRouter hydrated bindings,
      // or was created in a path that doesn't touch the router yet.
      const legacy = this.findTabBySessionId(sessionId);
      return legacy ? [legacy] : [];
    }

    const tabIds = this.tabSessionBinding.tabsFor(convRecord.id);
    if (tabIds.length === 0) return [];

    const boundTabIds = new Set<TabId>(tabIds);
    return this._tabs().filter((t) => boundTabIds.has(t.id as TabId));
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
      // TASK_2026_106 Phase 6b — `placeholderSessionId` field removed.
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
      // TASK_2026_106 Phase 6b — `placeholderSessionId` field removed.
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

    this.modelRefresh.refreshModels().catch((err) => {
      console.warn(
        '[TabManagerService] refreshModels after createTab failed:',
        err,
      );
    });

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

    // TASK_2026_103 Wave E2: forceCloseTab is used by the pop-out flow which
    // TRANSFERS the session to another panel — do NOT abort the stream here,
    // it must keep running so the target panel can re-attach. Just drop the
    // controller so the source panel stops tracking it.
    this.clearAbortController(tabId);

    const tabIndex = tabs.findIndex((t) => t.id === tabId);

    // Skip agent cleanup -- agents will be restored in the target panel.
    // TASK_2026_103 Wave B1 → TASK_2026_106 Phase 3: was a direct
    // STREAMING_CONTROL push; now we emit a `forceClose` event and the
    // StreamRouter performs `cleanupSessionDeduplication` only (no agent
    // clear) because pop-out transfers the session to another panel.
    // workspacePartition cleanup stays here — it's TabManager's own concern.
    if (tab.claudeSessionId) {
      this.workspacePartition.unregisterSession(tab.claudeSessionId);
    }

    this._closedTab.set({
      tabId,
      sessionId: tab.claudeSessionId ?? null,
      kind: 'forceClose',
    });

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

    // TASK_2026_103 Wave E2: abort any in-flight streaming RPC BEFORE tab
    // state cleanup so the registered abort listener (in MessageSender) can
    // still read tab.claudeSessionId and dispatch chat:abort to the backend.
    // Otherwise the backend keeps generating tokens after the user closes
    // the tab — burning LLM cost.
    this.abortStreamingForTab(tabId);

    // TASK_2025_090: Clean up deduplication state to prevent memory leaks.
    // TASK_2026_106 Phase 3: STREAMING_CONTROL inversion removed. We emit
    // a `close` event and the StreamRouter (which owns the routing graph)
    // performs the per-session cleanup: cleanupSessionDeduplication +
    // clearSessionAgents. workspacePartition cleanup stays here — it's
    // TabManager's own concern, not streaming.
    if (tab.claudeSessionId) {
      this.workspacePartition.unregisterSession(tab.claudeSessionId);
    }

    this._closedTab.set({
      tabId,
      sessionId: tab.claudeSessionId ?? null,
      kind: 'close',
    });

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
   * Internal mutator. PRIVATE — external callers must use the intent-named
   * methods below (TASK_2026_105 Wave G2 Phase 1). Direct partial-state writes
   * from outside this service prevented safe extraction of chat-state into
   * its own lib because the public surface was an unconstrained escape hatch.
   *
   * TASK_2025_208: workspace-aware. If the tab belongs to the active
   * workspace, this updates the _tabs signal (triggering UI reactivity).
   * If the tab belongs to a background workspace, delegates to
   * TabWorkspacePartitionService.updateBackgroundTab().
   *
   * PERFORMANCE: shallow equality check skips signal updates when only
   * streamingState reference is set to itself (single-key fast path) —
   * critical during 100+/sec streaming events.
   *
   * @param tabId - Tab ID to update
   * @param updates - Partial tab state updates
   */
  private updateTabInternal(tabId: string, updates: Partial<TabState>): void {
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

  // ============================================================================
  // INTENT-NAMED MUTATORS (TASK_2026_105 Wave G2 Phase 1)
  // ============================================================================
  //
  // These replace the previous `updateTab(tabId, partial)` escape hatch. The
  // generic API permitted unconstrained writes from any service and prevented
  // safe extraction of chat-state into its own lib in Wave G2 Phase 2. Each
  // method below maps 1:1 to a partial-keys mutation pattern observed in the
  // chat-store services as of TASK_2026_105 inventory. New mutation patterns
  // must add a new intent method here rather than reaching for a partial.
  //
  // All methods are thin wrappers over `updateTabInternal` and preserve every
  // existing invariant (signal updates, shallow-equality fast path, workspace
  // partition delegation, claudeSessionId reverse-index registration).
  // ============================================================================

  // ----- Status transitions -----

  /** Transition the tab into the `streaming` status. */
  markStreaming(tabId: string): void {
    this.updateTabInternal(tabId, { status: 'streaming' });
  }

  /** Transition the tab into the `loaded` status. */
  markLoaded(tabId: string): void {
    this.updateTabInternal(tabId, { status: 'loaded' });
  }

  /** Transition the tab into the `resuming` status. */
  markResuming(tabId: string): void {
    this.updateTabInternal(tabId, { status: 'resuming' });
  }

  /**
   * Initialize a tab for a brand-new conversation: apply the auto-derived
   * name/title, mark it `draft`, clear dirty flag, and explicitly null the
   * claudeSessionId so the SDK can assign a real UUID.
   */
  applyNewConversationDraft(tabId: string, name: string): void {
    this.updateTabInternal(tabId, {
      name,
      title: name,
      status: 'draft',
      isDirty: false,
      claudeSessionId: null,
    });
  }

  /**
   * Apply auto-derived name/title and switch to `streaming`, clearing dirty.
   * Used by the synchronous send path that skips the `draft` intermediate.
   */
  applyNewConversationStreaming(tabId: string, name: string): void {
    this.updateTabInternal(tabId, {
      name,
      title: name,
      status: 'streaming',
      isDirty: false,
    });
  }

  // ----- Session ID + initial-event hijack -----

  /** Attach the real Claude SDK session UUID to the tab. */
  attachSession(tabId: string, sessionId: string): void {
    this.updateTabInternal(tabId, { claudeSessionId: sessionId });
  }

  // TASK_2026_106 Phase 6b — `adoptStreamingSession` removed. The
  // StreamRouter now owns the "first event for a fresh tab seeds the
  // session" flow via `routeStreamEvent` + `ConversationRegistry.
  // appendSession`. Callers that need to attach a session id should use
  // `attachSession` (above) and `markStreaming` (above) — same effect,
  // narrower contract.

  // ----- Streaming state lifecycle -----

  /** Replace the tab's streaming state (or null it out). */
  setStreamingState(tabId: string, state: StreamingState | null): void {
    this.updateTabInternal(tabId, { streamingState: state });
  }

  /**
   * Set both streaming state and currentMessageId in one atomic write.
   * Used by conversation startup which must reset both fields together.
   */
  setStreamingStateAndCurrentMessage(
    tabId: string,
    state: StreamingState | null,
    currentMessageId: string | null,
  ): void {
    this.updateTabInternal(tabId, {
      streamingState: state,
      currentMessageId,
    });
  }

  // ----- Messages -----

  /** Replace the tab's full messages array. */
  setMessages(tabId: string, messages: ExecutionChatMessage[]): void {
    this.updateTabInternal(tabId, { messages });
  }

  /**
   * Append a single user message and reset currentMessageId for a new turn.
   * Used by conversation/message-sender flows on send.
   */
  appendUserMessageForNewTurn(
    tabId: string,
    nextMessages: ExecutionChatMessage[],
  ): void {
    this.updateTabInternal(tabId, {
      messages: nextMessages,
      currentMessageId: null,
    });
  }

  /**
   * Conversation-startup variant that also clears any stale streamingState
   * carried over from a previous session on the same tab. Without the clear,
   * handleSessionStats would see orphaned state and finalize incorrectly.
   */
  appendUserMessageAndResetStreaming(
    tabId: string,
    nextMessages: ExecutionChatMessage[],
  ): void {
    this.updateTabInternal(tabId, {
      messages: nextMessages,
      currentMessageId: null,
      streamingState: null,
    });
  }

  /**
   * Replace messages and force `loaded` (used by failure paths that record
   * an error reply and end the streaming state machine).
   */
  setMessagesAndMarkLoaded(
    tabId: string,
    messages: ExecutionChatMessage[],
  ): void {
    this.updateTabInternal(tabId, { messages, status: 'loaded' });
  }

  // ----- Finalization -----

  /**
   * Finalize a streaming turn: install the finalized messages array, drop
   * the streaming state, transition to `loaded`, and clear currentMessageId.
   * Single atomic write — components observing any of those signals see a
   * consistent end-of-turn snapshot.
   */
  applyFinalizedTurn(tabId: string, messages: ExecutionChatMessage[]): void {
    this.updateTabInternal(tabId, {
      messages,
      streamingState: null,
      status: 'loaded',
      currentMessageId: null,
    });
  }

  /**
   * Finalize a loaded session-history replay: install the rebuilt messages,
   * drop streamingState, mark `loaded`. (No currentMessageId clear — history
   * replay never sets it.)
   */
  applyFinalizedHistory(tabId: string, messages: ExecutionChatMessage[]): void {
    this.updateTabInternal(tabId, {
      messages,
      streamingState: null,
      status: 'loaded',
    });
  }

  /**
   * Drop the streaming state without touching messages. Used when finalize
   * detects the message has already been recorded (deduplication path).
   */
  clearStreamingForLoaded(tabId: string): void {
    this.updateTabInternal(tabId, {
      streamingState: null,
      status: 'loaded',
      currentMessageId: null,
    });
  }

  // ----- Error / abort reset -----

  /**
   * Reset a tab after an error: status=loaded, currentMessageId cleared, and
   * any queued content/options dropped so the next user message is sent
   * fresh instead of draining a stale queue.
   */
  applyErrorReset(tabId: string): void {
    this.updateTabInternal(tabId, {
      status: 'loaded',
      currentMessageId: null,
      queuedContent: null,
      queuedOptions: null,
    });
  }

  /**
   * Lighter error reset: only status + currentMessageId. Used by handlers
   * that don't own the queue (e.g. completion-handler legacy path).
   */
  applyStatusErrorReset(tabId: string): void {
    this.updateTabInternal(tabId, {
      status: 'loaded',
      currentMessageId: null,
    });
  }

  /**
   * Drop the cached claudeSessionId and revert to `loaded`. Used when
   * resume-validation detects the session file no longer exists on disk.
   */
  detachSessionAndMarkLoaded(tabId: string): void {
    this.updateTabInternal(tabId, {
      claudeSessionId: null,
      status: 'loaded',
    });
  }

  // ----- Queue -----

  /** Replace queuedContent only (preserving queuedOptions if any). */
  setQueuedContent(tabId: string, content: string | null): void {
    this.updateTabInternal(tabId, { queuedContent: content });
  }

  /**
   * First-message queue write: store both content and options together so the
   * stored options match the message they were attached to.
   */
  setQueuedContentAndOptions(
    tabId: string,
    content: string,
    options: SendMessageOptions,
  ): void {
    this.updateTabInternal(tabId, {
      queuedContent: content,
      queuedOptions: options,
    });
  }

  /**
   * Reset queue: empty-string queuedContent + null queuedOptions. Used by the
   * conversation-startup path which signals "queue drained, ready for next".
   */
  resetQueuedContentAndOptions(tabId: string): void {
    this.updateTabInternal(tabId, {
      queuedContent: '',
      queuedOptions: null,
    });
  }

  /**
   * Drop both queuedContent (null) and queuedOptions. Used by sendQueuedMessage
   * before dispatching the queued content — null signals "no pending queue".
   */
  clearQueuedContentAndOptions(tabId: string): void {
    this.updateTabInternal(tabId, {
      queuedContent: null,
      queuedOptions: null,
    });
  }

  // ----- Compaction -----

  /** Mark compaction in progress for the tab. */
  markCompactionStart(tabId: string): void {
    this.updateTabInternal(tabId, { isCompacting: true });
  }

  /** Clear the per-tab `isCompacting` flag (no other state touched). */
  clearCompactingFlag(tabId: string): void {
    this.updateTabInternal(tabId, { isCompacting: false });
  }

  /**
   * Apply the compaction-safety-timeout reset: clear isCompacting and reset
   * the streaming state machine so a stuck compaction banner doesn't leave
   * the tab in a non-recoverable state.
   */
  applyCompactionTimeoutReset(tabId: string): void {
    this.updateTabInternal(tabId, {
      isCompacting: false,
      status: 'loaded',
      streamingState: null,
      currentMessageId: null,
    });
  }

  /**
   * Apply the post-compaction reload state: clear messages, install the
   * snapshot preloadedStats, increment compactionCount, reset streaming
   * state machine, and drop any queued message so the next user input is
   * sent fresh against the new compacted session.
   */
  applyCompactionComplete(
    tabId: string,
    payload: {
      preloadedStats: PreloadedStatsPayload | null | undefined;
      compactionCount: number;
    },
  ): void {
    this.updateTabInternal(tabId, {
      messages: [],
      preloadedStats: payload.preloadedStats,
      compactionCount: payload.compactionCount,
      status: 'loaded',
      streamingState: null,
      currentMessageId: null,
      queuedContent: null,
      queuedOptions: null,
    });
  }

  // ----- Stats and model bookkeeping -----

  /** Set the live model stats summary for the tab. */
  setLiveModelStats(tabId: string, stats: LiveModelStatsPayload): void {
    this.updateTabInternal(tabId, { liveModelStats: stats });
  }

  /**
   * Set both liveModelStats and modelUsageList in one write. Used by the
   * SESSION_STATS aggregator when a turn finishes with a modelUsage payload.
   */
  setLiveModelStatsAndUsageList(
    tabId: string,
    stats: LiveModelStatsPayload,
    usageList: TabState['modelUsageList'],
  ): void {
    this.updateTabInternal(tabId, {
      liveModelStats: stats,
      modelUsageList: usageList,
    });
  }

  /** Replace the modelUsageList for the tab. */
  setModelUsageList(
    tabId: string,
    usageList: TabState['modelUsageList'],
  ): void {
    this.updateTabInternal(tabId, { modelUsageList: usageList });
  }

  /** Replace the preloadedStats snapshot for the tab. */
  setPreloadedStats(
    tabId: string,
    stats: PreloadedStatsPayload | null | undefined,
  ): void {
    this.updateTabInternal(tabId, { preloadedStats: stats });
  }

  /**
   * Apply the loaded-session preloaded-stats payload: install both the
   * stats snapshot and the originating sessionModel together so future
   * `chat:continue` calls use the original session model.
   */
  applyLoadedSessionStats(
    tabId: string,
    stats: PreloadedStatsPayload,
    sessionModel: string | null,
  ): void {
    this.updateTabInternal(tabId, {
      preloadedStats: stats,
      sessionModel,
    });
  }

  // ----- Per-session config overrides (canvas tile context) -----

  /** Set the per-tab override model (canvas tile context). */
  setOverrideModel(tabId: string, model: string | null): void {
    this.updateTabInternal(tabId, { overrideModel: model });
  }

  /** Set the per-tab override effort level (canvas tile context). */
  setOverrideEffort(tabId: string, effort: EffortLevel | null): void {
    this.updateTabInternal(tabId, { overrideEffort: effort });
  }

  // ----- Naming -----

  /**
   * Rename a tab from outside the service (e.g. on session rename RPC
   * success). Sets both name and title atomically.
   */
  setNameAndTitle(tabId: string, name: string, title: string): void {
    this.updateTabInternal(tabId, { name, title });
  }

  // ----- Session resume / load -----

  /**
   * Apply the session-loader resume-init state: install loading title/name,
   * attach the resumed sessionId, install an empty streamingState, clear
   * the messages list, and mark `resuming`. Single atomic write so the UI
   * doesn't briefly render an inconsistent in-between snapshot.
   */
  applyResumingSession(
    tabId: string,
    payload: {
      sessionId: string;
      name: string;
      title: string;
      streamingState: StreamingState;
    },
  ): void {
    this.updateTabInternal(tabId, {
      messages: [],
      streamingState: payload.streamingState,
      status: 'resuming',
      title: payload.title,
      name: payload.name,
      claudeSessionId: payload.sessionId,
    });
  }

  /**
   * Resume-fallback path: install the simple-message replay, drop streaming
   * state, mark `loaded`. Used when the backend has only legacy messages
   * (no events array).
   */
  applyResumedHistory(tabId: string, messages: ExecutionChatMessage[]): void {
    this.updateTabInternal(tabId, {
      messages,
      status: 'loaded',
      streamingState: null,
    });
  }

  /** Resume-failure path: drop streamingState, mark `loaded`. */
  applyResumeFailure(tabId: string): void {
    this.updateTabInternal(tabId, {
      status: 'loaded',
      streamingState: null,
    });
  }

  // ----- Generic single-status helper for legacy -----

  /**
   * Generic status setter used by callsites that pass `status` through
   * dynamic logic (e.g. retain streaming/resuming on early exits). Prefer
   * the explicit `markStreaming`/`markLoaded`/`markResuming` helpers when
   * the target status is statically known.
   */
  setStatus(tabId: string, status: SessionStatus): void {
    this.updateTabInternal(tabId, { status });
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

    this.updateTabInternal(tabId, { title: sanitizedTitle });
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
        const sanitizedTabs = state.tabs.map((tab: TabState) => {
          // TASK_2026_106 Phase 6b — drop legacy `placeholderSessionId`
          // field if present in persisted state from older releases. The
          // field is no longer part of `TabState` and routing now lives
          // in `ConversationRegistry` + `TabSessionBinding` (read by
          // StreamRouter at bootstrap).
          const { placeholderSessionId: _drop, ...rest } = tab as TabState & {
            placeholderSessionId?: unknown;
          };
          void _drop;
          return {
            ...rest,
            streamingState: null,
            // Backend sessions don't survive app restarts — clear the ID so
            // the frontend starts a fresh session instead of attempting resume.
            claudeSessionId: null,
            status:
              rest.status === 'streaming' ||
              rest.status === 'resuming' ||
              rest.status === 'switching'
                ? 'loaded'
                : rest.status,
            queuedContent: null,
            queuedOptions: null,
          };
        });
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
   *
   * TASK_2026_103 Wave E2: also drops the AbortController for this tab
   * (without aborting it — the stream finished naturally) so the Map does
   * not grow unbounded across the lifetime of a tab.
   */
  markTabIdle(tabId: string): void {
    this._streamingTabIds.update((set) => {
      const newSet = new Set(set);
      newSet.delete(tabId);
      return newSet;
    });
    this.clearAbortController(tabId);
  }

  // ============================================================================
  // ABORT CONTROLLER LIFECYCLE (TASK_2026_103 Wave E2)
  // ============================================================================
  //
  // Streaming RPCs (chat:start, chat:continue) accept an AbortSignal so that
  // closing a tab while a stream is in-flight cancels the work end-to-end:
  //
  //   1. closeTab(tabId) calls abortStreamingForTab(tabId)
  //   2. controller.abort() fires
  //   3. (a) the in-flight RPC promise resolves with `RPC aborted`
  //      (b) the listener registered by MessageSenderService dispatches
  //          `chat:abort` to the backend with the session id
  //   4. backend stops generating tokens; tab state cleanup proceeds
  //
  // The controller is OWNED by TabManager (single source of truth, easy to
  // wire from closeTab/forceCloseTab). The abort LISTENER is registered by
  // the streaming entry point (MessageSenderService) because only it knows
  // the SessionId required for the chat:abort RPC.
  // ============================================================================

  /**
   * Create a fresh AbortController for the given tab and return its signal.
   * Replaces any existing controller for the tab (the previous controller
   * is aborted defensively to release any stale listeners).
   */
  createAbortController(tabId: string): AbortSignal {
    const existing = this.abortControllers.get(tabId);
    if (existing && !existing.signal.aborted) {
      existing.abort();
    }
    const controller = new AbortController();
    this.abortControllers.set(tabId, controller);
    return controller.signal;
  }

  /**
   * Get the current AbortSignal for a tab, or undefined if none is active.
   */
  getAbortSignal(tabId: string): AbortSignal | undefined {
    return this.abortControllers.get(tabId)?.signal;
  }

  /**
   * Drop the AbortController for a tab WITHOUT aborting it.
   * Used when a stream completes naturally (markTabIdle) or when the tab
   * is force-closed for transfer (pop-out) — in both cases we want the
   * downstream work to keep running, we just stop tracking it.
   */
  clearAbortController(tabId: string): void {
    this.abortControllers.delete(tabId);
  }

  /**
   * Abort the in-flight streaming RPC for a tab and drop the controller.
   * Safe to call when no stream is active (no-op).
   */
  abortStreamingForTab(tabId: string): void {
    const controller = this.abortControllers.get(tabId);
    if (!controller) return;
    this.abortControllers.delete(tabId);
    if (!controller.signal.aborted) {
      controller.abort();
    }
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
    this.updateTabInternal(tabId, { viewMode: newMode });
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
