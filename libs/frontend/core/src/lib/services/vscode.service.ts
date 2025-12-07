import { Injectable, signal } from '@angular/core';
import { ExecutionNode } from '@ptah-extension/shared';

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
 * 2. Route incoming messages to appropriate services (RPC responses, chat chunks)
 * 3. Expose VS Code API for message sending (used by ClaudeRpcService)
 *
 * This service is initialized via APP_INITIALIZER before Angular bootstrap.
 */
@Injectable({
  providedIn: 'root',
})
export class VSCodeService {
  // VS Code API instance (null in development mode)
  private vscode: VsCodeApi | null = null;

  // RPC service will be injected lazily to avoid circular dependency
  private claudeRpcService: any = null;

  // ChatStore will be injected lazily to avoid circular dependency
  private chatStore: any = null;

  // Signal-based reactive state
  private readonly _config = signal<WebviewConfig>({
    isVSCode: false,
    theme: 'dark',
    workspaceRoot: '',
    workspaceName: '',
    extensionUri: '',
    baseUri: '',
    iconUri: '',
  });

  private readonly _isConnected = signal(false);

  // Public readonly signals
  readonly config = this._config.asReadonly();
  readonly isConnected = this._isConnected.asReadonly();

  constructor() {
    this.initializeFromGlobals();
    this.setupMessageListener();
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

  /**
   * Set RPC service for response routing
   * Called by ClaudeRpcService constructor to avoid circular dependency
   */
  setRpcService(rpcService: any): void {
    this.claudeRpcService = rpcService;
    console.log('[VSCodeService] RPC service registered for response routing');
  }

  /**
   * Set ChatStore for message routing
   * Called by ChatStore constructor to avoid circular dependency
   */
  setChatStore(chatStore: any): void {
    this.chatStore = chatStore;
    console.log('[VSCodeService] ChatStore registered for message routing');
  }

  getAssetUri(relativePath: string): string {
    const config = this.config();
    if (this.isConnected() && config.extensionUri) {
      return `${config.extensionUri}/${relativePath}`;
    }
    return `/${relativePath}`;
  }

  /**
   * Get Ptah icon URI
   */
  getPtahIconUri(): string {
    return this.config().iconUri || this.getAssetUri('assets/ptah-icon.svg');
  }

  private setupMessageListener(): void {
    window.addEventListener('message', (event) => {
      const message = event.data;

      // Route RPC responses to ClaudeRpcService
      if (message.type === 'rpc:response') {
        console.log('[VSCodeService] Received RPC response:', message);
        if (this.claudeRpcService) {
          this.claudeRpcService.handleResponse(message);
        } else {
          console.warn(
            '[VSCodeService] RPC response received but no RPC service registered!'
          );
        }
      }

      // Route chat:chunk messages to ChatStore (SDK path only)
      if (message.type === 'chat:chunk') {
        if (message.payload && this.chatStore) {
          const { sessionId, message: node } = message.payload;
          this.chatStore.processExecutionNode(node as ExecutionNode, sessionId);
        } else if (!message.payload) {
          console.warn(
            '[VSCodeService] chat:chunk received but payload is undefined!'
          );
        } else {
          console.warn(
            '[VSCodeService] chat:chunk received but ChatStore not registered!'
          );
        }
      }

      // Handle chat completion - CRITICAL for resetting streaming state
      if (message.type === 'chat:complete') {
        const { sessionId, code } = message.payload ?? {};
        console.log('[VSCodeService] Chat complete:', { sessionId, code });
        if (this.chatStore) {
          // Call ChatStore to reset streaming state and finalize message
          this.chatStore.handleChatComplete({ sessionId, code: code ?? 0 });
        } else {
          console.warn(
            '[VSCodeService] chat:complete received but ChatStore not registered!'
          );
        }
      }

      // Handle chat errors - CRITICAL for resetting streaming state on error
      if (message.type === 'chat:error') {
        const { sessionId, error } = message.payload ?? {};
        console.error('[VSCodeService] Chat error:', { sessionId, error });
        if (this.chatStore) {
          // Call ChatStore to reset streaming state
          this.chatStore.handleChatError({
            sessionId,
            error: error ?? 'Unknown error',
          });
        } else {
          console.warn(
            '[VSCodeService] chat:error received but ChatStore not registered!'
          );
        }
      }

      // Handle session ID resolution (TASK_2025_027 Batch 2)
      if (message.type === 'session:id-resolved') {
        if (message.payload && this.chatStore) {
          this.chatStore.handleSessionIdResolved(message.payload);
        } else if (!message.payload) {
          console.warn(
            '[VSCodeService] session:id-resolved received but payload is undefined!'
          );
        } else {
          console.warn(
            '[VSCodeService] session:id-resolved received but ChatStore not registered!'
          );
        }
      }

      // Handle permission request (TASK_2025_026)
      if (message.type === 'permission:request') {
        if (message.payload && this.chatStore) {
          console.log(
            '[VSCodeService] Permission request received:',
            message.payload
          );
          this.chatStore.handlePermissionRequest(message.payload);
        } else if (!message.payload) {
          console.warn(
            '[VSCodeService] permission:request received but payload is undefined!'
          );
        } else {
          console.warn(
            '[VSCodeService] permission:request received but ChatStore not registered!'
          );
        }
      }

      // Handle agent summary chunk (real-time agent summary streaming)
      if (message.type === 'agent:summary-chunk') {
        if (message.payload && this.chatStore) {
          this.chatStore.handleAgentSummaryChunk(message.payload);
        } else if (!message.payload) {
          console.warn(
            '[VSCodeService] agent:summary-chunk received but payload is undefined!'
          );
        } else {
          console.warn(
            '[VSCodeService] agent:summary-chunk received but ChatStore not registered!'
          );
        }
      }
    });
  }
}

/**
 * Factory function for APP_INITIALIZER
 * Ensures VSCodeService is initialized before application bootstrap.
 */
export function initializeVSCodeService(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _vscodeService: VSCodeService
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
