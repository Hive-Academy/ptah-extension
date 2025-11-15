import {
  Injectable,
  computed,
  signal,
  inject,
  ApplicationRef,
} from '@angular/core';
import { Subject, Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import {
  StrictMessage,
  MessagePayloadMap,
  CommandTemplate,
  CorrelationId,
  SessionId,
  createStrictMessage,
  CHAT_MESSAGE_TYPES,
  SYSTEM_MESSAGE_TYPES,
  VIEW_MESSAGE_TYPES,
  CONTEXT_MESSAGE_TYPES,
  COMMAND_MESSAGE_TYPES,
  STATE_MESSAGE_TYPES,
  PROVIDER_MESSAGE_TYPES,
  ANALYTICS_MESSAGE_TYPES,
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
 * Uses signals for reactive state management and RxJS for message streaming.
 *
 * @example
 * ```typescript
 * class ChatComponent {
 *   private readonly vscode = inject(VSCodeService);
 *
 *   ngOnInit() {
 *     // Subscribe to chat messages
 *     this.vscode.onMessageType('chat:messageChunk')
 *       .subscribe(payload => this.handleMessageChunk(payload));
 *
 *     // Send message to extension
 *     this.vscode.sendChatMessage('Hello, Claude!');
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
  // NOTE: No longer need ApplicationRef - using Zone.js-based change detection
  // Zone.js automatically triggers change detection for window.addEventListener

  // VS Code API instance (null in development mode)
  private vscode: VsCodeApi | null = null;

  // RxJS Subject for message streaming (appropriate use case for Subject)
  private readonly messageSubject = new Subject<StrictMessage>();

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

  // Signal to track last message timestamp (triggers change detection)
  private readonly _lastMessageTime = signal(0);

  // Public readonly signals
  readonly config = this._config.asReadonly();
  readonly isConnected = this._isConnected.asReadonly();
  readonly lastMessageTime = this._lastMessageTime.asReadonly();

  // Computed signals for derived state
  readonly isDevelopmentMode = computed(() => !this.isConnected());
  readonly currentTheme = computed(() => this.config().theme);

  constructor() {
    console.log('=== VSCodeService Constructor Called ===');
    this.initializeFromGlobals();
    this.setupMessageListener();
    this.setupThemeListener();
    console.log('=== VSCodeService Initialization Complete ===', {
      isConnected: this._isConnected(),
      hasVscode: !!this.vscode,
      config: this._config(),
    });
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
        console.log(
          'VSCodeService: Initialized with VS Code config',
          ptahWindow.ptahConfig
        );
      } else {
        console.warn('VSCodeService: VS Code API found but no ptahConfig');
      }

      // Restore previous state if available
      if (ptahWindow.ptahPreviousState) {
        console.log('VSCodeService: Restored previous state');
      }
    } else {
      // Development mode - no VS Code API available
      console.log(
        'VSCodeService: Running in development mode (no VS Code API)'
      );
      this._isConnected.set(false);
    }
  }

  /**
   * Setup message listener for messages from extension
   *
   * WITH ZONE.JS:
   * window.addEventListener is patched by Zone.js, so it automatically triggers
   * change detection when the callback runs. No manual triggering needed.
   */
  private setupMessageListener(): void {
    console.log(
      '=== VSCodeService: Setting up message listener (Zone.js mode) ==='
    );

    window.addEventListener('message', (event: MessageEvent) => {
      // FILTER OUT Angular DevTools messages (memory leak prevention)
      const data = event.data;
      if (
        data &&
        typeof data === 'object' &&
        ('__NG_DEVTOOLS_EVENT__' in data ||
          '__ignore_ng_zone__' in data ||
          data.source === 'angular-devtools-detect-angular' ||
          data.topic === 'detectAngular' ||
          // Additional DevTools detection patterns
          ('isAngular' in data && 'isAngularDevTools' in data))
      ) {
        // Silently ignore Angular DevTools messages
        return;
      }

      // Validate message structure (must have 'type' property)
      const message = event.data as StrictMessage;
      if (!message || !message.type || typeof message.type !== 'string') {
        // Silently ignore invalid messages (likely more DevTools spam)
        // Only log in development mode for debugging
        if (console.debug) {
          console.debug(
            '[VSCodeService] Ignoring invalid message:',
            event.data
          );
        }
        return;
      }

      console.log(`[VSCodeService] Message received: ${message.type}`);

      // Emit to RxJS subject for subscribers
      this.messageSubject.next(message);

      // Update signal (Zone.js will automatically detect this and trigger change detection)
      this._lastMessageTime.set(Date.now());
    });

    console.log('=== VSCodeService: Message listener setup complete ===');
  }

  /**
   * Setup theme change listener
   */
  private setupThemeListener(): void {
    // Listen for theme changes from extension via themeChanged message
    this.onMessageType('themeChanged').subscribe((payload) => {
      const currentConfig = this.config();
      this._config.set({
        ...currentConfig,
        theme: payload.theme,
      });
      console.log('VSCodeService: Theme changed to', payload.theme);
    });
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
    } else {
      console.log('[Dev Mode] Would send message:', message);
    }
  }

  /**
   * Observable stream of all messages from extension
   */
  onMessage(): Observable<StrictMessage> {
    return this.messageSubject.asObservable();
  }

  /**
   * Observable stream of messages filtered by type
   * Provides type-safe payload access
   */
  onMessageType<T extends keyof MessagePayloadMap>(
    messageType: T
  ): Observable<MessagePayloadMap[T]> {
    return this.messageSubject.asObservable().pipe(
      filter((msg): msg is StrictMessage<T> => msg.type === messageType),
      map((msg) => msg.payload)
    );
  }

  /**
   * Notify extension that webview is ready
   */
  notifyReady(): void {
    this.postStrictMessage(SYSTEM_MESSAGE_TYPES.WEBVIEW_READY, {});
  }

  /**
   * Navigate to a route in the webview
   */
  navigateToRoute(route: string): void {
    this.postStrictMessage(VIEW_MESSAGE_TYPES.ROUTE_CHANGED, { route });
  }

  /**
   * Request file picker from VS Code
   * TODO: Implement proper file picker message type
   */
  requestFilePicker(): void {
    this.postStrictMessage(CONTEXT_MESSAGE_TYPES.INCLUDE_FILE, {
      filePath: '',
    });
  }

  /**
   * Execute VS Code command
   */
  executeVSCodeCommand(
    templateId: string,
    parameters?: Record<string, unknown>
  ): void {
    this.postStrictMessage(COMMAND_MESSAGE_TYPES.EXECUTE_COMMAND, {
      templateId,
      parameters: parameters ?? {},
    });
  }

  /**
   * Update VS Code configuration
   */
  updateConfiguration(key: string, value: unknown): void {
    this.postStrictMessage(STATE_MESSAGE_TYPES.SAVE, {
      state: { [key]: value },
    });
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
    type: 'info' | 'warning' | 'error' = 'info'
  ): void {
    this.postStrictMessage(SYSTEM_MESSAGE_TYPES.ERROR, {
      message: `${type.toUpperCase()}: ${message}`,
    });
  }

  /**
   * Save webview state to VS Code
   */
  saveState(state: unknown): void {
    if (state !== null && state !== undefined) {
      this.postStrictMessage(STATE_MESSAGE_TYPES.SAVE, { state });
    } else {
      console.warn(
        'VSCodeService: saveState called with null/undefined state:',
        state
      );
      this.postStrictMessage(STATE_MESSAGE_TYPES.SAVE, { state: {} });
    }
  }

  /**
   * Get saved webview state from VS Code
   */
  getState(): unknown {
    if (this.vscode && this.vscode.getState) {
      return this.vscode.getState();
    }
    return null;
  }

  /**
   * Request saved state from VS Code extension
   */
  requestSavedState(): void {
    this.postStrictMessage(STATE_MESSAGE_TYPES.LOAD, {});
  }

  // ==================== Chat Methods ====================

  sendChatMessage(
    content: string,
    files?: readonly string[],
    correlationId?: CorrelationId
  ): void {
    this.postStrictMessage(CHAT_MESSAGE_TYPES.SEND_MESSAGE, {
      content,
      files,
      correlationId: correlationId ?? (crypto.randomUUID() as CorrelationId),
    });
  }

  createNewChatSession(name?: string): void {
    this.postStrictMessage(CHAT_MESSAGE_TYPES.NEW_SESSION, { name });
  }

  switchChatSession(sessionId: string): void {
    this.postStrictMessage(CHAT_MESSAGE_TYPES.SWITCH_SESSION, {
      sessionId: sessionId as SessionId,
    });
  }

  // ==================== Command Builder Methods ====================

  getCommandTemplates(): void {
    this.postStrictMessage(COMMAND_MESSAGE_TYPES.GET_TEMPLATES, {});
  }

  executeCommand(
    templateId: string,
    parameters: Record<string, unknown>
  ): void {
    this.postStrictMessage(COMMAND_MESSAGE_TYPES.EXECUTE_COMMAND, {
      templateId,
      parameters,
    });
  }

  saveCommandTemplate(template: CommandTemplate): void {
    this.postStrictMessage(COMMAND_MESSAGE_TYPES.SAVE_TEMPLATE, { template });
  }

  // ==================== Context Management Methods ====================

  getContextFiles(): void {
    this.postStrictMessage(CONTEXT_MESSAGE_TYPES.GET_FILES, {});
  }

  includeFile(filePath: string): void {
    this.postStrictMessage(CONTEXT_MESSAGE_TYPES.INCLUDE_FILE, { filePath });
  }

  excludeFile(filePath: string): void {
    this.postStrictMessage(CONTEXT_MESSAGE_TYPES.EXCLUDE_FILE, { filePath });
  }

  // ==================== Analytics Methods ====================

  getAnalyticsData(): void {
    this.postStrictMessage(ANALYTICS_MESSAGE_TYPES.GET_DATA, {});
  }

  trackAnalyticsEvent(
    event: string,
    properties?: Record<string, string | number | boolean>
  ): void {
    this.postStrictMessage(ANALYTICS_MESSAGE_TYPES.TRACK_EVENT, {
      event,
      properties: properties ?? {},
    });
  }

  // ==================== Provider Management Methods ====================

  getAvailableProviders(): void {
    this.postStrictMessage(PROVIDER_MESSAGE_TYPES.GET_AVAILABLE, {});
  }

  getCurrentProvider(): void {
    this.postStrictMessage(PROVIDER_MESSAGE_TYPES.GET_CURRENT, {});
  }

  switchProvider(
    providerId: string,
    reason?: 'user-request' | 'auto-fallback' | 'error-recovery'
  ): void {
    this.postStrictMessage(PROVIDER_MESSAGE_TYPES.SWITCH, {
      providerId,
      reason,
    });
  }

  getProviderHealth(providerId?: string): void {
    this.postStrictMessage(PROVIDER_MESSAGE_TYPES.GET_HEALTH, { providerId });
  }

  getAllProviderHealth(): void {
    this.postStrictMessage(PROVIDER_MESSAGE_TYPES.GET_ALL_HEALTH, {});
  }

  setDefaultProvider(providerId: string): void {
    this.postStrictMessage(PROVIDER_MESSAGE_TYPES.SET_DEFAULT, { providerId });
  }

  enableProviderFallback(enabled: boolean): void {
    this.postStrictMessage(PROVIDER_MESSAGE_TYPES.ENABLE_FALLBACK, { enabled });
  }

  setProviderAutoSwitch(enabled: boolean): void {
    this.postStrictMessage(PROVIDER_MESSAGE_TYPES.SET_AUTO_SWITCH, { enabled });
  }

  // ==================== Asset Methods ====================

  getImageUrl(imagePath: string): string {
    const config = this.config();
    if (this.isConnected() && config.extensionUri) {
      return `${config.extensionUri}/out/webview/browser/${imagePath}`;
    } else {
      return `/${imagePath}`;
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
  vscodeService: VSCodeService
): () => void {
  return () => {
    // Service is already initialized in constructor
    // This function ensures it happens during APP_INITIALIZER phase
    console.log('VSCodeService: Initialized via APP_INITIALIZER', {
      isConnected: vscodeService.isConnected(),
      isDevelopmentMode: vscodeService.isDevelopmentMode(),
      theme: vscodeService.currentTheme(),
    });
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
