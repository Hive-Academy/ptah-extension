import { Injectable, signal } from '@angular/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { MessageHandler } from './message-router.types';

/**
 * Webview Configuration
 */
export interface WebviewConfig {
  isVSCode: boolean;
  theme: 'light' | 'dark' | 'high-contrast';
  workspaceRoot: string;
  workspaceName: string;
  extensionUri: string;
  baseUri: string;
  iconUri: string;
  userIconUri: string;
  /** Unique panel identifier for multi-webview support (TASK_2025_117). Empty string for sidebar. */
  panelId?: string;
  /** Session ID to auto-load when panel opens (used by pop-out feature). */
  initialSessionId?: string | null;
  /** Session name for auto-loaded session tab title. */
  initialSessionName?: string | null;
  /** Whether the webview is running inside Electron (set by preload script). */
  isElectron?: boolean;
  /** OS platform from Electron main process: 'darwin', 'win32', 'linux'. */
  platform?: string;
}

/**
 * VS Code Webview API interface
 * This is the API provided by VS Code to webviews
 */
interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

/**
 * Extended window interface with VS Code globals
 * These are injected by the extension host before Angular bootstraps
 */
interface PtahWindow extends Window {
  vscode?: VsCodeApi;
  ptahConfig?: WebviewConfig;
  ptahPreviousState?: unknown;
}

/**
 * Safely get the extended window object
 */
function getPtahWindow(): PtahWindow {
  return window as unknown as PtahWindow;
}

/**
 * VSCodeService - Bridge between Angular webview and VS Code extension host
 *
 * Core responsibilities:
 * 1. Provide webview configuration (workspaceRoot, theme, URIs)
 * 2. Expose VS Code API for message sending (used by ClaudeRpcService)
 * 3. Manage webview state persistence (getState/setState)
 *
 * Message routing is handled by MessageRouterService (decoupled via handler pattern).
 * This service is initialized via APP_INITIALIZER before Angular bootstrap.
 */
@Injectable({
  providedIn: 'root',
})
export class VSCodeService implements MessageHandler {
  // VS Code API instance (null in development mode)
  private vscode: VsCodeApi | null = null;

  // Signal-based reactive state
  private readonly _config = signal<WebviewConfig>({
    isVSCode: false,
    theme: 'dark',
    workspaceRoot: '',
    workspaceName: '',
    extensionUri: '',
    baseUri: '',
    iconUri: '',
    userIconUri: '',
    panelId: '',
    isElectron: false,
  });

  private readonly _isConnected = signal(false);

  // Public readonly signals
  readonly config = this._config.asReadonly();
  readonly isConnected = this._isConnected.asReadonly();

  // MessageHandler implementation — receives workspaceChanged from extension host
  readonly handledMessageTypes = [MESSAGE_TYPES.WORKSPACE_CHANGED] as const;

  /**
   * WORKSPACE_CHANGED handler — intentionally no origin-drop logic.
   *
   * `updateWorkspaceRoot` is idempotent: it sets the same signal value,
   * which Angular's signal equality check (Object.is) silently no-ops.
   * Self-echo suppression is the responsibility of ElectronLayoutService,
   * which owns the user-initiated switch flow. This handler only updates
   * the workspace root string for the VS Code host context.
   */
  handleMessage(message: { type: string; payload?: unknown }): void {
    const payload = message.payload as
      | { workspaceInfo?: { path?: string } | null }
      | undefined;
    const path = payload?.workspaceInfo?.path;
    if (path) {
      this.updateWorkspaceRoot(path);
    }
  }

  constructor() {
    this.initializeFromGlobals();
  }

  /**
   * Initialize from VS Code injected globals
   *
   * IMPORTANT: The extension host injects these globals BEFORE Angular bootstraps:
   * - window.vscode: The VS Code API (from acquireVsCodeApi())
   * - window.ptahConfig: Webview configuration (theme, workspace, URIs)
   * - window.ptahPreviousState: Restored state from previous session
   *
   * This approach is safer than calling acquireVsCodeApi() because:
   * 1. acquireVsCodeApi() can only be called once per webview lifetime
   * 2. Extension host calls it in the bootstrap script before Angular loads
   * 3. We just reference the already-acquired API from window.vscode
   */
  private initializeFromGlobals(): void {
    const ptahWindow = getPtahWindow();

    // Check if we have the VS Code API (injected by extension host)
    if (ptahWindow.vscode) {
      this.vscode = ptahWindow.vscode;
      this._isConnected.set(true);

      // Load configuration from injected global
      if (ptahWindow.ptahConfig) {
        this._config.set(ptahWindow.ptahConfig);
      } else {
        console.warn('VSCodeService: VS Code API found but no ptahConfig');
      }

      // Restore previous state if available (no logging needed)
    } else {
      // Development mode - no VS Code API available
      this._isConnected.set(false);
    }
  }

  getAssetUri(relativePath: string): string {
    const config = this.config();
    // Electron: assets are co-located with index.html, use relative path
    if (config.isElectron) {
      return `./${relativePath}`;
    }
    if (this.isConnected() && config.extensionUri) {
      return `${config.extensionUri}/${relativePath}`;
    }
    return `/${relativePath}`;
  }

  /**
   * Update the workspace root and name in the config signal.
   * Called by ElectronLayoutService after workspace:switch RPC succeeds.
   * All consumers reading config().workspaceRoot will reactively see the new value.
   *
   * @param newPath - The new workspace folder path
   */
  updateWorkspaceRoot(newPath: string): void {
    const workspaceName = newPath.split(/[/\\]/).pop() ?? 'Workspace';
    this._config.update((current) => ({
      ...current,
      workspaceRoot: newPath,
      workspaceName,
    }));
  }

  /**
   * Whether the webview is running inside Electron desktop app
   */
  get isElectron(): boolean {
    return this._config().isElectron === true;
  }

  /**
   * Get Ptah icon URI
   */
  getPtahIconUri(): string {
    return this.config().iconUri || this.getAssetUri('assets/ptah-icon.svg');
  }

  /**
   * Get Ptah user icon URI
   */
  getPtahUserIconUri(): string {
    return (
      this.config().userIconUri || this.getAssetUri('assets/user-icon.png')
    );
  }

  /**
   * Send message to VS Code extension host
   * Public wrapper for vscode.postMessage() to avoid type assertions
   */
  public postMessage(message: unknown): void {
    if (this.vscode) {
      this.vscode.postMessage(message);
    } else {
      console.warn(
        '[VSCodeService] postMessage called but VS Code API not available',
      );
    }
  }

  /**
   * Get a value from the webview state by key
   *
   * VS Code webview state is persisted across webview lifecycles.
   * This method provides keyed access to the state object.
   *
   * @param key - The key to retrieve from state
   * @returns The value if found, undefined otherwise
   */
  public getState<T>(key: string): T | undefined {
    if (!this.vscode) {
      return undefined;
    }

    const state = this.vscode.getState() as Record<string, unknown> | undefined;
    if (!state) {
      return undefined;
    }

    return state[key] as T | undefined;
  }

  /**
   * Set a value in the webview state by key
   *
   * VS Code webview state is persisted across webview lifecycles.
   * This method provides keyed access to the state object, merging
   * with existing state to preserve other keys.
   *
   * @param key - The key to set in state
   * @param value - The value to store
   */
  public setState<T>(key: string, value: T): void {
    if (!this.vscode) {
      console.warn(
        '[VSCodeService] setState called but VS Code API not available',
      );
      return;
    }

    // Get existing state and merge with new key-value
    const currentState =
      (this.vscode.getState() as Record<string, unknown>) || {};
    const newState = { ...currentState, [key]: value };
    this.vscode.setState(newState);
  }
}

/**
 * Factory function for APP_INITIALIZER
 * Ensures VSCodeService is initialized before application bootstrap.
 */
export function initializeVSCodeService(
  _vscodeService: VSCodeService,
): () => void {
  return () => {
    // Service is already initialized in constructor
    // This function ensures it happens during APP_INITIALIZER phase
  };
}

/**
 * Provider function for VSCodeService with APP_INITIALIZER
 */
export function provideVSCodeService() {
  return [
    VSCodeService,
    {
      provide: 'APP_INITIALIZER',
      useFactory: initializeVSCodeService,
      deps: [VSCodeService],
      multi: true,
    },
  ];
}
