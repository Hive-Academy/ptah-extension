/**
 * App State Manager
 *
 * Keeping essential navigation and loading state.
 */

import { Injectable, signal, computed } from '@angular/core';
import { WorkspaceInfo, MESSAGE_TYPES } from '@ptah-extension/shared';
import { MessageHandler } from './message-router.types';

export type ViewType =
  | 'chat'
  | 'command-builder'
  | 'analytics'
  | 'context-tree'
  | 'settings'
  | 'setup-wizard'
  | 'orchestra-canvas'
  | 'harness-builder'
  | 'setup-hub'
  | 'thoth'
  | 'marketplace'
  | 'tribunal'
  | 'tasks';

/**
 * Active tab id within the Thoth hub. Mirrors the union exported from
 * `@ptah-extension/thoth-shell`; declared here so app-state callers
 * (dashboard, app-shell) don't require a cross-library import for the type.
 */
export type ThothActiveTabId = 'memory' | 'skills' | 'cron' | 'gateway';

/** Layout mode for the chat view content area: single tab or canvas grid */
export type LayoutMode = 'single' | 'grid';

/**
 * `localStorage` key used to persist the "Thoth first-run hint dismissed"
 * flag. Same persistence layer as `ptah-layout-mode` — kept as a module
 * constant so tests can reference it without duplicating the literal.
 */
export const THOTH_FIRST_RUN_DISMISSED_KEY = 'ptah-thoth-first-run-dismissed';

/**
 * Legacy `localStorage` key used before the Thoth rename. The
 * migration shim in {@link AppStateManager.initializeState} reads this key
 * once on startup if the new key is missing, copies it forward, and removes
 * the old entry so user state is preserved across the rename upgrade.
 */
export const LEGACY_HERMES_FIRST_RUN_DISMISSED_KEY =
  'ptah-hermes-first-run-dismissed';

/**
 * Request to open the harness-builder surface and run an agent-driven
 * workflow. `new-project` auto-starts the workflow with the seed prompt;
 * `configure-harness` opens the surface and waits for the first user turn.
 */
export interface HarnessWorkflowRequest {
  mode: 'new-project' | 'configure-harness';
  seedPrompt?: string;
}

export type SettingsTabId =
  | 'claude-auth'
  | 'orchestration'
  | 'pro-features'
  | 'tools';

export interface PendingSettingsTab {
  tab: SettingsTabId;
  providerId?: string;
}

/**
 * Request to launch a chat session seeded with an initial prompt — e.g. the
 * standalone Tasks board firing `/ptah-core:orchestrate <TASK_ID>`. Consumed by
 * the chat lib (a root-provided bridge service), which creates/focuses a
 * session, submits the prompt through the normal send path, then settles
 * `resolve`. Kept in `core` so `tasks-ui` never imports `chat` — the same
 * signal-bridge inversion used by {@link CanvasSessionRequest} and
 * {@link HarnessWorkflowRequest} (NFR-11 / D7).
 */
export interface ChatPromptRequest {
  /** Prompt text submitted as the new session's first message. */
  prompt: string;
  /** Optional session/tab display name (e.g. the originating task id). */
  sessionName?: string;
  /**
   * Internal: resolver wired by {@link AppStateManager.requestChatPrompt} so the
   * caller can `await` the launch outcome. The chat consumer resolves
   * `{ success: true }` once the prompt was submitted, or
   * `{ success: false, error }` on failure. Optional so legacy callers / tests
   * that fabricate the request shape still type-check.
   */
  resolve?: (result: { success: boolean; error?: string }) => void;
}

/** Request to open/focus a session in a canvas tile */
export interface CanvasSessionRequest {
  sessionId: string;
  name?: string;
  /**
   * Internal: resolver wired up by {@link AppStateManager.requestCanvasSession}
   * so the caller can `await` the canvas adoption outcome. The canvas effect
   * in `OrchestraCanvasComponent` resolves this with `true` when a tile is
   * (re-)bound to the requested session, or `false` when the tile cap is hit
   * / the canvas is not mounted. Kept optional so legacy callers / tests that
   * fabricate the request shape still type-check.
   */
  resolve?: (success: boolean) => void;
}

/**
 * Request to adopt an existing chat tab as a canvas tile (F-D3). Fire-and-forget
 * (no resolver): the canvas effect dedups and respects the tile cap, and nothing
 * consumes it in single layout, so it is a harmless no-op there.
 */
export interface CanvasTabRequest {
  tabId: string;
  name?: string;
}

export interface AppState {
  currentView: ViewType;
  isLoading: boolean;
  statusMessage: string;
  workspaceInfo: WorkspaceInfo | null;
  isConnected: boolean;
}

/**
 * App State Manager - Signal-based global state
 * KEEPING: This service is clean and functional
 */
@Injectable({ providedIn: 'root' })
export class AppStateManager implements MessageHandler {
  readonly handledMessageTypes = [MESSAGE_TYPES.SWITCH_VIEW] as const;

  handleMessage(message: { type: string; payload?: unknown }): void {
    const payload = message.payload as { view?: string } | undefined;
    const view = payload?.view;
    const validViews: ViewType[] = [
      'chat',
      'command-builder',
      'analytics',
      'context-tree',
      'settings',
      'setup-wizard',
      'orchestra-canvas',
      'harness-builder',
      'setup-hub',
      'thoth',
      'marketplace',
      'tribunal',
      'tasks',
    ];
    if (view && validViews.includes(view as ViewType)) {
      this.handleViewSwitch(view as ViewType);
    } else {
      console.warn(
        `[AppStateManager] switchView received with invalid or missing view: ${view}`,
      );
    }
  }
  private readonly _currentView = signal<ViewType>('chat');
  private readonly _isLoading = signal(false);
  private readonly _statusMessage = signal('Ready');
  private readonly _workspaceInfo = signal<WorkspaceInfo | null>(null);
  private readonly _isConnected = signal(true);
  /** Tracks which views are currently "open" as tab pills (Electron navbar). Chat is always present. */
  private readonly _openViews = signal<Set<ViewType>>(new Set(['chat']));
  private readonly _layoutMode = signal<LayoutMode>('grid');
  /** Signal bridge: request to open/focus a session in a canvas tile (from sidebar click in grid mode) */
  private readonly _canvasSessionRequest = signal<CanvasSessionRequest | null>(
    null,
  );
  /** Signal bridge: request to create a new session as a canvas tile (from "New Session" in grid mode) */
  private readonly _newCanvasSessionRequest = signal<string | null>(null);
  /**
   * Signal bridge: request to adopt an EXISTING tab as a canvas tile without
   * creating a new tab/session. Fire-and-forget (mirrors
   * {@link _newCanvasSessionRequest}): used by the Tasks-board launch path so an
   * orchestration tab created while the canvas is ALREADY mounted becomes a tile
   * (the one gap `restoreCanvasTilesFromTabs` — which only runs on canvas mount —
   * doesn't cover). Nothing consumes it in single layout, so it's a harmless
   * no-op there; `CanvasStore.adoptTab` dedups and respects the tile cap.
   */
  private readonly _canvasTabRequest = signal<CanvasTabRequest | null>(null);
  /** Signal bridge: request to open the harness surface and run a workflow */
  private readonly _harnessWorkflowRequest =
    signal<HarnessWorkflowRequest | null>(null);
  /** Signal bridge: request to launch a chat session with a seed prompt (Tasks board → orchestrate) */
  private readonly _chatPromptRequest = signal<ChatPromptRequest | null>(null);
  private readonly _pendingSettingsTab = signal<PendingSettingsTab | null>(
    null,
  );

  /**
   * Active tab inside the Thoth hub. Persisted via setter so re-entering
   * the `'thoth'` view restores the user's last tab.
   */
  private readonly _thothActiveTab = signal<ThothActiveTabId>('memory');
  /**
   * Currently selected marketplace provider id (e.g. 'official-mcp',
   * 'skills-sh'), or null when no provider is selected. Persisted in-memory
   * via setter so re-entering the `'marketplace'` view restores the user's
   * last provider — mirrors {@link _thothActiveTab}.
   */
  private readonly _marketplaceActiveProvider = signal<string | null>(null);
  /**
   * Whether the user has dismissed the Thoth first-run hint.
   * Persisted to `localStorage` under {@link THOTH_FIRST_RUN_DISMISSED_KEY}
   * (same pattern as `ptah-layout-mode`) so a reload preserves the dismissed
   * state and the tooltip never reappears after the user closes it once.
   */
  private readonly _thothFirstRunDismissed = signal<boolean>(false);

  constructor() {
    this.initializeState();
  }

  /**
   * Normalize backward-compat view values. 'orchestra-canvas' was previously a view;
   * it's now a layout mode. Map it to 'chat' + grid layout so every entry point
   * behaves consistently (no blank shell).
   */
  private normalizeView(view: ViewType): ViewType {
    if (view === 'orchestra-canvas') {
      this._layoutMode.set('grid');
      return 'chat';
    }
    return view;
  }
  readonly currentView = this._currentView.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly statusMessage = this._statusMessage.asReadonly();
  readonly workspaceInfo = this._workspaceInfo.asReadonly();
  readonly isConnected = this._isConnected.asReadonly();
  /** Open views as an array for template iteration. */
  readonly openViews = computed(() => Array.from(this._openViews()));
  /** Current layout mode: 'single' (tab view) or 'grid' (canvas view) */
  readonly layoutMode = this._layoutMode.asReadonly();
  /** Pending request to open a session in a canvas tile (consumed by OrchestraCanvasComponent) */
  readonly canvasSessionRequest = this._canvasSessionRequest.asReadonly();
  /** Pending request to create a new canvas tile (consumed by OrchestraCanvasComponent) */
  readonly newCanvasSessionRequest = this._newCanvasSessionRequest.asReadonly();
  /** Pending request to adopt an existing tab as a canvas tile (consumed by OrchestraCanvasComponent) */
  readonly canvasTabRequest = this._canvasTabRequest.asReadonly();
  /** Pending request to open the harness surface workflow (consumed by HarnessBuilderViewComponent) */
  readonly harnessWorkflowRequest = this._harnessWorkflowRequest.asReadonly();
  /** Pending request to launch a chat session with a seed prompt (consumed by the chat-lib bridge) */
  readonly chatPromptRequest = this._chatPromptRequest.asReadonly();
  readonly pendingSettingsTab = this._pendingSettingsTab.asReadonly();
  /** Active tab id inside the Thoth hub (memory / skills / cron / gateway). */
  readonly thothActiveTab = this._thothActiveTab.asReadonly();
  /** Selected marketplace provider id (null when none selected). */
  readonly marketplaceActiveProvider =
    this._marketplaceActiveProvider.asReadonly();
  /** Whether the Thoth first-run hint has been dismissed. */
  readonly thothFirstRunDismissed = this._thothFirstRunDismissed.asReadonly();
  readonly canSwitchViews = computed(() => {
    return !this._isLoading() && this._isConnected();
  });
  readonly appTitle = computed(() => {
    const workspace = this._workspaceInfo();
    return workspace ? `Ptah - ${workspace.name}` : 'Ptah';
  });

  /**
   * Initialize application state from window object augmentation.
   *
   * **Window Augmentation for Debugging:**
   * The extension backend can inject initial state into the webview by augmenting
   * the window object before the Angular app bootstraps. This is useful for:
   * - Setting initial view based on command context (e.g., open wizard directly)
   * - Debugging webview initialization in VS Code DevTools
   * - Testing different initial states during development
   *
   * **Usage in Extension:**
   * ```typescript
   * panel.webview.html = generateHtml({
   *   workspaceInfo: {...},
   *   initialView: 'setup-wizard' // Sets window.initialView before app loads
   * });
   * ```
   *
   * **DevTools Debugging:**
   * You can inspect/modify window.initialView in Chrome DevTools before app loads:
   * ```javascript
   * // In VS Code DevTools console (before app bootstrap)
   * window.initialView = 'analytics'; // Force initial view
   * ```
   *
   * **Production Warning:**
   * This pattern is safe for production as it only reads from window during
   * initialization. However, avoid writing to window after app bootstrap as it
   * bypasses Angular's change detection.
   *
   * @private
   */
  private initializeState(): void {
    const windowWithState = window as Window & {
      initialView?: ViewType;
      ptahConfig?: {
        initialView?: string;
        workspaceRoot?: string;
        workspaceName?: string;
      };
    };
    const workspaceRoot = windowWithState.ptahConfig?.workspaceRoot;
    const workspaceName = windowWithState.ptahConfig?.workspaceName;
    if (
      workspaceRoot &&
      workspaceRoot !== 'undefined' &&
      workspaceRoot !== ''
    ) {
      this._workspaceInfo.set({
        name:
          workspaceName && workspaceName !== 'undefined' ? workspaceName : '',
        path: workspaceRoot,
        type: 'workspace',
      });
    }

    let initialView =
      windowWithState.initialView ||
      (windowWithState.ptahConfig?.initialView as ViewType) ||
      'chat';
    let savedLayoutMode: LayoutMode | null = null;

    savedLayoutMode = localStorage.getItem(
      'ptah-layout-mode',
    ) as LayoutMode | null;
    if (savedLayoutMode === 'single' || savedLayoutMode === 'grid') {
      this._layoutMode.set(savedLayoutMode);
    }

    const newValue = localStorage.getItem(THOTH_FIRST_RUN_DISMISSED_KEY);
    if (newValue === null) {
      const legacyValue = localStorage.getItem(
        LEGACY_HERMES_FIRST_RUN_DISMISSED_KEY,
      );
      if (legacyValue !== null) {
        localStorage.setItem(THOTH_FIRST_RUN_DISMISSED_KEY, legacyValue);
        localStorage.removeItem(LEGACY_HERMES_FIRST_RUN_DISMISSED_KEY);
        if (legacyValue === 'true') {
          this._thothFirstRunDismissed.set(true);
        }
      }
    } else if (newValue === 'true') {
      this._thothFirstRunDismissed.set(true);
    }
    initialView = this.normalizeView(initialView);

    this._currentView.set(initialView);
    if (initialView !== 'chat') {
      this._openViews.update((views) => {
        const next = new Set(views);
        next.add(initialView);
        return next;
      });
    }
  }
  setCurrentView(view: ViewType): void {
    if (this.canSwitchViews()) {
      view = this.normalizeView(view);
      this._openViews.update((views) => {
        const next = new Set(views);
        next.add(view);
        return next;
      });
      this._currentView.set(view);
    }
  }

  /** Close a view tab pill. Chat can never be closed. Falls back to chat if closing the active view. */
  closeView(view: ViewType): void {
    if (view === 'chat') return;
    this._openViews.update((views) => {
      const next = new Set(views);
      next.delete(view);
      return next;
    });
    if (this._currentView() === view) {
      this._currentView.set('chat');
    }
  }

  setLoading(loading: boolean): void {
    this._isLoading.set(loading);
  }

  setStatusMessage(message: string): void {
    this._statusMessage.set(message);
  }

  setWorkspaceInfo(info: WorkspaceInfo | null): void {
    this._workspaceInfo.set(info);
  }

  setConnected(connected: boolean): void {
    this._isConnected.set(connected);
    if (connected) {
      this.setStatusMessage('Connected to VS Code');
      this.setLoading(false);
    } else {
      this.setStatusMessage('Disconnected from VS Code');
    }
  }

  handleInitialData(data: {
    workspaceInfo?: WorkspaceInfo;
    currentView?: ViewType;
  }): void {
    if (data.workspaceInfo) this.setWorkspaceInfo(data.workspaceInfo);
    if (data.currentView) {
      const normalized = this.normalizeView(data.currentView);
      this._currentView.set(normalized);
    }
    this.setConnected(true);
  }

  handleViewSwitch(view: ViewType): void {
    if (!this.canSwitchViews()) return;

    view = this.normalizeView(view);

    this._openViews.update((views) => {
      const next = new Set(views);
      next.add(view);
      return next;
    });
    this._currentView.set(view);
  }

  handleError(error: string): void {
    this.setStatusMessage(`Error: ${error}`);
  }

  /** Update the active Thoth hub tab. */
  setThothActiveTab(tab: ThothActiveTabId): void {
    this._thothActiveTab.set(tab);
  }

  /** Update the selected marketplace provider id (null to clear selection). */
  setMarketplaceActiveProvider(id: string | null): void {
    this._marketplaceActiveProvider.set(id);
  }

  /**
   * Mark the Thoth first-run hint as dismissed and persist the flag to
   * `localStorage` so a reload preserves the dismissed state. Idempotent —
   * calling this when already dismissed is a no-op for state but still
   * re-writes the storage key (cheap, keeps the code branch-free).
   */
  dismissThothFirstRun(): void {
    this._thothFirstRunDismissed.set(true);

    localStorage.setItem(THOTH_FIRST_RUN_DISMISSED_KEY, 'true');
  }

  getStateSnapshot(): AppState {
    return {
      currentView: this._currentView(),
      isLoading: this._isLoading(),
      statusMessage: this._statusMessage(),
      workspaceInfo: this._workspaceInfo(),
      isConnected: this._isConnected(),
    };
  }

  /** Set the layout mode and persist to localStorage */
  setLayoutMode(mode: LayoutMode): void {
    this._layoutMode.set(mode);

    localStorage.setItem('ptah-layout-mode', mode);
  }

  /** Toggle between 'single' and 'grid' layout modes */
  toggleLayoutMode(): void {
    const next = this._layoutMode() === 'grid' ? 'single' : 'grid';
    this.setLayoutMode(next);
  }

  /**
   * Request that the canvas opens/focuses a tile for the given session.
   *
   * Returns a Promise that resolves to `true` when the canvas effect adopts
   * the request and a tile is bound, or `false` when the request is dropped
   * (tile cap reached, canvas not mounted, etc.). Callers that need to gate
   * downstream destructive actions on a successful swap (e.g. "delete the
   * original session after switching to the new one") should `await` this.
   * Legacy fire-and-forget callers can ignore the returned promise.
   *
   * If the canvas never resolves (it was unmounted before the effect ran),
   * the promise still settles via a 5s safety timeout to `false` so awaiters
   * are never wedged.
   */
  requestCanvasSession(sessionId: string, name?: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (success: boolean): void => {
        if (settled) return;
        settled = true;
        resolve(success);
      };
      const timer = setTimeout(() => settle(false), 5000);
      this._canvasSessionRequest.set({
        sessionId,
        name,
        resolve: (success: boolean) => {
          clearTimeout(timer);
          settle(success);
        },
      });
    });
  }

  /**
   * Clear the canvas session request after the canvas has processed it.
   * Callers should invoke `request.resolve(success)` BEFORE calling this so
   * any awaiter unblocks; clearing alone does not settle the promise.
   */
  clearCanvasSessionRequest(): void {
    this._canvasSessionRequest.set(null);
  }

  /** Request that the canvas creates a new tile with the given name */
  requestNewCanvasSession(name: string): void {
    this._newCanvasSessionRequest.set(name);
  }

  /** Clear the new canvas session request after the canvas has processed it */
  clearNewCanvasSessionRequest(): void {
    this._newCanvasSessionRequest.set(null);
  }

  /**
   * Request that the canvas adopts an already-existing tab as a tile (no new
   * tab/session created). Fire-and-forget: the canvas effect calls
   * `CanvasStore.adoptTab` (dedups, respects `MAX_TILES`) and focuses it. When
   * the canvas isn't mounted (single layout) nothing consumes the signal — a
   * harmless no-op, so callers need not gate on layout themselves.
   */
  requestCanvasTab(tabId: string, name?: string): void {
    this._canvasTabRequest.set({ tabId, ...(name ? { name } : {}) });
  }

  /** Clear the canvas tab-adoption request after the canvas has processed it. */
  clearCanvasTabRequest(): void {
    this._canvasTabRequest.set(null);
  }

  /** Request that the harness surface opens and runs the given workflow. */
  requestHarnessWorkflow(req: HarnessWorkflowRequest): void {
    this._harnessWorkflowRequest.set(req);
  }

  /**
   * Request that the chat lib launches a session seeded with `request.prompt`.
   * Mirrors {@link requestCanvasSession}: the chat-lib bridge consumes the
   * signal, creates/focuses a session, submits the prompt, and settles
   * `request.resolve`. Fire-and-forget for callers that don't need the outcome;
   * awaiters wire a `resolve` callback (see the Tasks board Start flow).
   */
  requestChatPrompt(request: ChatPromptRequest): void {
    this._chatPromptRequest.set(request);
  }

  /**
   * Clear the chat-prompt request after the bridge has processed it. Callers
   * should invoke `request.resolve(...)` BEFORE calling this so any awaiter
   * unblocks; clearing alone does not settle the promise.
   */
  clearChatPromptRequest(): void {
    this._chatPromptRequest.set(null);
  }

  /**
   * Consume the pending harness workflow request (read-and-clear). Returns
   * the request or null. Mirrors the canvas request consume pattern — the
   * harness view reads this once on init so re-entry doesn't replay a stale
   * workflow.
   */
  consumeHarnessWorkflowRequest(): HarnessWorkflowRequest | null {
    const req = this._harnessWorkflowRequest();
    if (req) {
      this._harnessWorkflowRequest.set(null);
    }
    return req;
  }

  requestSettingsTab(target: PendingSettingsTab): void {
    this._pendingSettingsTab.set(target);
  }

  consumePendingSettingsTab(): PendingSettingsTab | null {
    const target = this._pendingSettingsTab();
    if (target) {
      this._pendingSettingsTab.set(null);
    }
    return target;
  }
}
