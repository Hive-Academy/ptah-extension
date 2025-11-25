import { Injectable, computed, signal, inject } from '@angular/core';
import {
  StrictMessage,
  MessagePayloadMap,
  CommandTemplate,
  CorrelationId,
  SessionId,
  createStrictMessage,
} from '@ptah-extension/shared';
import { ChatStateService, type JSONLMessage } from './chat-state.service';

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

  // Inject ChatStateService for JSONL message routing (OLD - will be removed)
  private readonly chatStateService = inject(ChatStateService);

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

      // NEW: Route chat:chunk messages to ChatStore (TASK_2025_023 Batch 6)
      if (message.type === 'chat:chunk') {
        const { sessionId, message: jsonlMessage } = message.data;
        if (this.chatStore) {
          this.chatStore.processJsonlChunk(jsonlMessage);
        } else {
          console.warn(
            '[VSCodeService] chat:chunk received but ChatStore not registered!'
          );
        }
      }

      // NEW: Handle chat completion
      if (message.type === 'chat:complete') {
        const { sessionId, code } = message.data;
        console.log('[VSCodeService] Chat complete:', { sessionId, code });
        // ChatStore will finalize the message when it receives result JSONL
      }

      // NEW: Handle chat errors
      if (message.type === 'chat:error') {
        const { sessionId, error } = message.data;
        console.error('[VSCodeService] Chat error:', { sessionId, error });
        if (this.chatStore) {
          // Set error state in ChatStore
          this.chatStore._isStreaming?.set(false);
        }
      }

      // OLD: Unified JSONL message handler (will be deprecated)
      if (message.type === 'jsonl-message') {
        const { sessionId, message: jsonlMessage } = message.data;
        this.handleJSONLMessage(sessionId, jsonlMessage);
      }
    });
  }

  /**
   * Discriminate JSONL messages based on type field
   * Routes to ChatStateService for state updates
   *
   * Core Principle: Receive typed object, discriminate on message.type, update signals
   *
   * @param sessionId - Session identifier from backend
   * @param message - Complete JSONL object with type field
   */
  private handleJSONLMessage(
    sessionId: SessionId,
    message: JSONLMessage
  ): void {
    switch (message.type) {
      case 'system':
        // Session initialization
        if (message.subtype === 'init' && message.session_id) {
          this.chatStateService.handleSessionInit(
            sessionId,
            message.session_id,
            message.model
          );
        }
        break;

      case 'assistant':
        // Assistant messages (thinking vs content discrimination)
        this.chatStateService.handleAssistantMessage(sessionId, message);
        break;

      case 'tool':
        // Tool lifecycle + agent correlation
        this.chatStateService.handleToolMessage(sessionId, message);
        break;

      case 'permission':
        // Permission dialog
        this.chatStateService.handlePermissionRequest(sessionId, message);
        break;

      case 'stream_event':
        // Streaming control events
        this.chatStateService.handleStreamEvent(sessionId, message);
        break;

      case 'result':
        // Final metrics
        this.chatStateService.handleResult(sessionId, message);
        break;

      case 'user':
        // Tool results come as 'user' messages with tool_result content
        // These are the results of tools Claude called (Read, Write, Bash, etc.)
        // The tool timeline already tracks tool lifecycle via 'tool' messages
        // Log for debugging but don't display in chat (would be noise)
        console.debug('[VSCodeService] Tool result received (user type):', {
          sessionId,
          hasContent: !!(message as any).message?.content,
          parentToolUseId: (message as any).parent_tool_use_id,
        });
        break;

      default:
        console.warn('[VSCodeService] Unknown JSONL message type:', message);
    }
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
