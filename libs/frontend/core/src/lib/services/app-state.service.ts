/**
 * App State Manager - SIMPLIFIED for TASK_2025_023
 *
 * Keeping essential navigation and loading state.
 * This service is already well-designed with signals.
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
  | 'welcome'
  | 'orchestra-canvas'
  | 'harness-builder'
  | 'setup-hub'
  | 'hermes';

/**
 * Active tab id within the Hermes hub. Mirrors the union exported from
 * `@ptah-extension/hermes-shell`; declared here so app-state callers
 * (dashboard, app-shell) don't require a cross-library import for the type.
 */
export type HermesActiveTabId = 'memory' | 'skills' | 'cron' | 'gateway';

/** Layout mode for the chat view content area: single tab or canvas grid */
export type LayoutMode = 'single' | 'grid';

/** Request to open/focus a session in a canvas tile */
export interface CanvasSessionRequest {
  sessionId: string;
  name?: string;
}

export interface AppState {
  currentView: ViewType;
  isLoading: boolean;
  statusMessage: string;
  workspaceInfo: WorkspaceInfo | null;
  isConnected: boolean;
  /** Whether the user has a valid license */
  isLicensed: boolean;
}

/**
 * App State Manager - Signal-based global state
 * KEEPING: This service is clean and functional
 */
@Injectable({ providedIn: 'root' })
export class AppStateManager implements MessageHandler {
  // MessageHandler implementation
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
      'welcome',
      'orchestra-canvas',
      'harness-builder',
      'setup-hub',
      'hermes',
    ];
    if (view && validViews.includes(view as ViewType)) {
      this.handleViewSwitch(view as ViewType);
    } else {
      console.warn(
        `[AppStateManager] switchView received with invalid or missing view: ${view}`,
      );
    }
  }

  // Core state signals
  private readonly _currentView = signal<ViewType>('chat');
  private readonly _isLoading = signal(false);
  private readonly _statusMessage = signal('Ready');
  private readonly _workspaceInfo = signal<WorkspaceInfo | null>(null);
  private readonly _isConnected = signal(true);
  /** License status - controls access to premium features and RPC calls */
  private readonly _isLicensed = signal(true);
  /** Tracks which views are currently "open" as tab pills (Electron navbar). Chat is always present. */
  private readonly _openViews = signal<Set<ViewType>>(new Set(['chat']));

  // Layout mode signals (canvas-first layout)
  private readonly _layoutMode = signal<LayoutMode>('grid');
  /** Signal bridge: request to open/focus a session in a canvas tile (from sidebar click in grid mode) */
  private readonly _canvasSessionRequest = signal<CanvasSessionRequest | null>(
    null,
  );
  /** Signal bridge: request to create a new session as a canvas tile (from "New Session" in grid mode) */
  private readonly _newCanvasSessionRequest = signal<string | null>(null);

  /**
   * Active tab inside the Hermes hub. Persisted via setter so re-entering
   * the `'hermes'` view restores the user's last tab.
   */
  private readonly _hermesActiveTab = signal<HermesActiveTabId>('memory');
  /** Whether the user has dismissed the Hermes first-run hint. */
  private readonly _hermesFirstRunDismissed = signal<boolean>(false);

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

  // Public readonly signals
  readonly currentView = this._currentView.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly statusMessage = this._statusMessage.asReadonly();
  readonly workspaceInfo = this._workspaceInfo.asReadonly();
  readonly isConnected = this._isConnected.asReadonly();
  /** Whether the user has a valid license - controls RPC access */
  readonly isLicensed = this._isLicensed.asReadonly();
  /** Open views as an array for template iteration. Excludes 'welcome' (license gate, not a tab). */
  readonly openViews = computed(() =>
    Array.from(this._openViews()).filter((v) => v !== 'welcome'),
  );

  // Layout mode public readonly signals
  /** Current layout mode: 'single' (tab view) or 'grid' (canvas view) */
  readonly layoutMode = this._layoutMode.asReadonly();
  /** Pending request to open a session in a canvas tile (consumed by OrchestraCanvasComponent) */
  readonly canvasSessionRequest = this._canvasSessionRequest.asReadonly();
  /** Pending request to create a new canvas tile (consumed by OrchestraCanvasComponent) */
  readonly newCanvasSessionRequest = this._newCanvasSessionRequest.asReadonly();
  /** Active tab id inside the Hermes hub (memory / skills / cron / gateway). */
  readonly hermesActiveTab = this._hermesActiveTab.asReadonly();
  /** Whether the Hermes first-run hint has been dismissed. */
  readonly hermesFirstRunDismissed = this._hermesFirstRunDismissed.asReadonly();

  // Computed signals
  // TASK_2025_126: Added welcome view check to prevent license bypass
  // Users on welcome view (unlicensed) cannot navigate to other views
  readonly canSwitchViews = computed(() => {
    const onWelcomeView = this._currentView() === 'welcome';
    if (onWelcomeView) {
      // Block navigation from welcome view - license gate enforcement
      return false;
    }
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
        isLicensed?: boolean;
        initialView?: string;
        workspaceRoot?: string;
        workspaceName?: string;
      };
    };

    // Read license status from ptahConfig (set by backend)
    const isLicensed = windowWithState.ptahConfig?.isLicensed ?? true;
    this._isLicensed.set(isLicensed);

    // Read workspace info from ptahConfig (injected by webview HTML generator)
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

    // Restore layout mode from localStorage BEFORE normalizeView,
    // so that explicit normalizeView overrides (e.g. 'orchestra-canvas' → grid)
    // take precedence over the saved preference.
    let savedLayoutMode: LayoutMode | null = null;
    try {
      savedLayoutMode = localStorage.getItem(
        'ptah-layout-mode',
      ) as LayoutMode | null;
    } catch {
      /* localStorage unavailable in restricted environments */
    }
    if (savedLayoutMode === 'single' || savedLayoutMode === 'grid') {
      this._layoutMode.set(savedLayoutMode);
    }

    // Backward compat: normalizeView() maps 'orchestra-canvas' → 'chat' + grid layout.
    // This runs AFTER localStorage restore so it can override saved preference when needed.
    initialView = this.normalizeView(initialView);

    this._currentView.set(initialView);
    if (initialView !== 'chat' && initialView !== 'welcome') {
      this._openViews.update((views) => {
        const next = new Set(views);
        next.add(initialView);
        return next;
      });
    }
  }

  // State update methods
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

  /** Update the active Hermes hub tab. */
  setHermesActiveTab(tab: HermesActiveTabId): void {
    this._hermesActiveTab.set(tab);
  }

  /** Mark the Hermes first-run hint as dismissed. */
  dismissHermesFirstRun(): void {
    this._hermesFirstRunDismissed.set(true);
  }

  getStateSnapshot(): AppState {
    return {
      currentView: this._currentView(),
      isLoading: this._isLoading(),
      statusMessage: this._statusMessage(),
      workspaceInfo: this._workspaceInfo(),
      isConnected: this._isConnected(),
      isLicensed: this._isLicensed(),
    };
  }

  // ============================================================================
  // LAYOUT MODE METHODS
  // ============================================================================

  /** Set the layout mode and persist to localStorage */
  setLayoutMode(mode: LayoutMode): void {
    this._layoutMode.set(mode);
    try {
      localStorage.setItem('ptah-layout-mode', mode);
    } catch {
      /* localStorage unavailable in restricted environments */
    }
  }

  /** Toggle between 'single' and 'grid' layout modes */
  toggleLayoutMode(): void {
    const next = this._layoutMode() === 'grid' ? 'single' : 'grid';
    this.setLayoutMode(next);
  }

  // ============================================================================
  // CANVAS SESSION REQUEST METHODS (Signal Bridge)
  // ============================================================================

  /** Request that the canvas opens/focuses a tile for the given session */
  requestCanvasSession(sessionId: string, name?: string): void {
    this._canvasSessionRequest.set({ sessionId, name });
  }

  /** Clear the canvas session request after the canvas has processed it */
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
}
