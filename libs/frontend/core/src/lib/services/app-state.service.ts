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
  | 'welcome';

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
    ];
    if (view && validViews.includes(view as ViewType)) {
      console.log(
        `[AppStateManager] Backend requested view switch to: ${view}`
      );
      this.handleViewSwitch(view as ViewType);
    } else {
      console.warn(
        `[AppStateManager] switchView received with invalid or missing view: ${view}`
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

  constructor() {
    this.initializeState();
  }

  // Public readonly signals
  readonly currentView = this._currentView.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly statusMessage = this._statusMessage.asReadonly();
  readonly workspaceInfo = this._workspaceInfo.asReadonly();
  readonly isConnected = this._isConnected.asReadonly();
  /** Whether the user has a valid license - controls RPC access */
  readonly isLicensed = this._isLicensed.asReadonly();

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

    const initialView = windowWithState.initialView || 'chat';
    console.log(
      `[AppStateManager] Initializing with view: ${initialView}, isLicensed: ${isLicensed}, workspace: ${
        workspaceRoot || 'none'
      }`
    );
    this._currentView.set(initialView);
  }

  // State update methods
  setCurrentView(view: ViewType): void {
    if (this.canSwitchViews()) {
      this._currentView.set(view);
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
    if (data.currentView) this._currentView.set(data.currentView);
    this.setConnected(true);
  }

  handleViewSwitch(view: ViewType): void {
    this._currentView.set(view);
  }

  handleError(error: string): void {
    this.setStatusMessage(`Error: ${error}`);
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
}
