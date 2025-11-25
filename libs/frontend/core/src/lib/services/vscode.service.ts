import { Injectable, computed, signal } from '@angular/core';
import {
  StrictMessage,
  MessagePayloadMap,
  CommandTemplate,
  CorrelationId,
  createStrictMessage,
} from '@ptah-extension/shared';

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
 * Service for communicating with VS Code extension
 *
 * Provides type-safe message passing between Angular webview and VS Code extension host.
 * Uses signals for reactive state management.
 *
 * @example
 * ```typescript
 * class ChatComponent {
 *   private readonly vscode = inject(VSCodeService);
 *
 *   ngOnInit() {
 *     // Send message to extension
 *     this.vscode.postStrictMessage('chat:sendMessage', {
 *       content: 'Hello, Claude!',
 *       correlationId: CorrelationId.create()
 *     });
 *   }
 *
 *   get isDevelopment() {
 *     return this.vscode.isDevelopmentMode();
 *   }
 * }
 * ```
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

  // Computed signals for derived state
  readonly isDevelopmentMode = computed(() => !this.isConnected());
  readonly currentTheme = computed(() => this.config().theme);

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
   * Post type-safe message to VS Code extension
   * Uses MessagePayloadMap for compile-time type safety
   */
  postStrictMessage<T extends keyof MessagePayloadMap>(
    type: T,
    payload: MessagePayloadMap[T],
    correlationId?: CorrelationId
  ): void {
    const message = createStrictMessage(type, payload, correlationId);

    if (this.vscode) {
      this.vscode.postMessage(message);
    }
    // Development mode - silently skip message sending
  }

  /**
   * Get asset URI for webview resources
   */
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

  /**
   * Show VS Code message
   */
  showMessage(
    message: string,
    messageType: 'info' | 'warning' | 'error' = 'info'
  ): void {
    // NOTE: Using string literal 'error' directly (MessagePayloadMap type)
    // SYSTEM_MESSAGE_TYPES constant was deleted during event purge
    this.postStrictMessage('error', {
      message: `${messageType.toUpperCase()}: ${message}`,
      code: messageType.toUpperCase(),
      source: 'VSCodeService',
    });
  }

  /**
   * Send RPC request to extension and wait for response
   * TASK_2025_019 Phase 1: RPC integration for file autocomplete
   *
   * @param request - RPC request with type and data
   * @returns Promise resolving to response data
   */
  async sendRequest<T>(request: { type: string; data: unknown }): Promise<T> {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timeoutMs = 15000; // 15 second timeout (increased for discovery operations)

      // Set up timeout
      const timeoutId = setTimeout(() => {
        window.removeEventListener('message', handler);
        reject(new Error(`RPC request timeout: ${request.type}`));
      }, timeoutMs);

      // Register response handler
      const handler = (event: MessageEvent) => {
        const message = event.data;

        if (
          message.type === 'rpc:response' &&
          message.requestId === requestId
        ) {
          clearTimeout(timeoutId);
          window.removeEventListener('message', handler);

          if (message.error) {
            reject(
              new Error(
                `RPC error: ${message.error.message || 'Unknown error'}`
              )
            );
          } else {
            resolve(message.result as T);
          }
        }
      };

      window.addEventListener('message', handler);

      // Send request to backend
      if (this.vscode) {
        this.vscode.postMessage({
          type: 'rpc:request',
          requestId,
          method: request.type,
          params: request.data,
        });
      } else {
        // Development mode - reject immediately
        clearTimeout(timeoutId);
        window.removeEventListener('message', handler);
        reject(new Error('VS Code API not available (development mode)'));
      }
    });
  }

  /**
   * Get asset URI for webview resources (images, icons, etc.)
   */
  getImageUrl(imagePath: string): string {
    const config = this.config();
    if (this.isConnected() && config.extensionUri) {
      return `${config.extensionUri}/out/webview/browser/${imagePath}`;
    } else {
      return `/${imagePath}`;
    }
  }

  /**
   * Setup message listener for webview communication
   * Handles both RPC responses and unified JSONL messages
   */
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

      // Route chat:chunk messages to ChatStore (TASK_2025_023)
      if (message.type === 'chat:chunk') {
        if (message.payload && this.chatStore) {
          const { message: jsonlMessage } = message.payload;
          this.chatStore.processJsonlChunk(jsonlMessage);
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

      // Handle chat completion
      if (message.type === 'chat:complete') {
        if (message.payload) {
          const { sessionId, code } = message.payload;
          console.log('[VSCodeService] Chat complete:', { sessionId, code });
          // ChatStore will finalize the message when it receives result JSONL
        } else {
          console.warn(
            '[VSCodeService] chat:complete received but payload is undefined!'
          );
        }
      }

      // Handle chat errors
      if (message.type === 'chat:error') {
        if (message.payload) {
          const { sessionId, error } = message.payload;
          console.error('[VSCodeService] Chat error:', { sessionId, error });
          if (this.chatStore) {
            // Set error state in ChatStore
            this.chatStore._isStreaming?.set(false);
          }
        } else {
          console.warn(
            '[VSCodeService] chat:error received but payload is undefined!'
          );
          if (this.chatStore) {
            this.chatStore._isStreaming?.set(false);
          }
        }
      }
    });
  }
}

/**
 * Factory function for APP_INITIALIZER
 *
 * Ensures VSCodeService is initialized before application bootstrap.
 * Use this in your app.config.ts:
 *
 * @example
 * ```typescript
 * import { ApplicationConfig } from '@angular/core';
 * import { provideVSCodeService } from '@ptah-extension/core';
 *
 * export const appConfig: ApplicationConfig = {
 *   providers: [
 *     provideVSCodeService(),
 *     // ... other providers
 *   ]
 * };
 * ```
 *
 * This ensures:
 * 1. VSCodeService is eagerly instantiated (not lazy)
 * 2. Connection is established before any components render
 * 3. Initial config is loaded from window.ptahConfig
 * 4. Theme listener is active before first component render
 */
export function initializeVSCodeService(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _vscodeService: VSCodeService
): () => void {
  return () => {
    // Service is already initialized in constructor
    // This function ensures it happens during APP_INITIALIZER phase
    // (initialization is silent - use window.PTAH_DEBUG_LOGGING = true to see details)
  };
}

/**
 * Provider function for VSCodeService with APP_INITIALIZER
 *
 * This is the recommended way to include VSCodeService in your application.
 * It ensures the service is initialized before the app starts.
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
