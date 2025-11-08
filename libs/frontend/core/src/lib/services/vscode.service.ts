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
      console.log('=== VSCodeService: Raw message event received ===', {
        origin: event.origin,
        dataType: typeof event.data,
        data: event.data,
      });

      const message = event.data as StrictMessage;
      if (message && message.type) {
        console.log(
          `=== VSCodeService: Processing message type: ${message.type} ===`
        );

        // Emit to RxJS subject for subscribers
        this.messageSubject.next(message);
        console.log(`   - Emitted to RxJS subject`);

        // Update signal (Zone.js will automatically detect this and trigger change detection)
        this._lastMessageTime.set(Date.now());
        console.log(
          `   - Updated _lastMessageTime signal (Zone.js handles change detection)`
        );

        console.log(
          `=== VSCodeService: Message processed successfully: ${message.type} ===`
        );
      } else {
        console.warn(
          '=== VSCodeService: Invalid message received ===',
          event.data
        );
      }
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
    this.postStrictMessage('webview-ready', {});
  }

  /**
   * Navigate to a route in the webview
   */
  navigateToRoute(route: string): void {
    this.postStrictMessage('view:routeChanged', { route });
  }

  /**
   * Request file picker from VS Code
   * TODO: Implement proper file picker message type
   */
  requestFilePicker(): void {
    this.postStrictMessage('context:includeFile', { filePath: '' });
  }

  /**
   * Execute VS Code command
   */
  executeVSCodeCommand(
    templateId: string,
    parameters?: Record<string, unknown>
  ): void {
    this.postStrictMessage('commands:executeCommand', {
      templateId,
      parameters: parameters ?? {},
    });
  }

  /**
   * Update VS Code configuration
   */
  updateConfiguration(key: string, value: unknown): void {
    this.postStrictMessage('state:save', { state: { [key]: value } });
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
    this.postStrictMessage('error', {
      message: `${type.toUpperCase()}: ${message}`,
    });
  }

  /**
   * Save webview state to VS Code
   */
  saveState(state: unknown): void {
    if (state !== null && state !== undefined) {
      this.postStrictMessage('state:save', { state });
    } else {
      console.warn(
        'VSCodeService: saveState called with null/undefined state:',
        state
      );
      this.postStrictMessage('state:save', { state: {} });
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
    this.postStrictMessage('state:load', {});
  }

  // ==================== Chat Methods ====================

  sendChatMessage(
    content: string,
    files?: readonly string[],
    correlationId?: CorrelationId
  ): void {
    this.postStrictMessage('chat:sendMessage', {
      content,
      files,
      correlationId: correlationId ?? (crypto.randomUUID() as CorrelationId),
    });
  }

  createNewChatSession(name?: string): void {
    this.postStrictMessage('chat:newSession', { name });
  }

  switchChatSession(sessionId: string): void {
    this.postStrictMessage('chat:switchSession', {
      sessionId: sessionId as SessionId,
    });
  }

  // ==================== Command Builder Methods ====================

  getCommandTemplates(): void {
    this.postStrictMessage('commands:getTemplates', {});
  }

  executeCommand(
    templateId: string,
    parameters: Record<string, unknown>
  ): void {
    this.postStrictMessage('commands:executeCommand', {
      templateId,
      parameters,
    });
  }

  saveCommandTemplate(template: CommandTemplate): void {
    this.postStrictMessage('commands:saveTemplate', { template });
  }

  // ==================== Context Management Methods ====================

  getContextFiles(): void {
    this.postStrictMessage('context:getFiles', {});
  }

  includeFile(filePath: string): void {
    this.postStrictMessage('context:includeFile', { filePath });
  }

  excludeFile(filePath: string): void {
    this.postStrictMessage('context:excludeFile', { filePath });
  }

  // ==================== Analytics Methods ====================

  getAnalyticsData(): void {
    this.postStrictMessage('analytics:getData', {});
  }

  trackAnalyticsEvent(
    event: string,
    properties?: Record<string, string | number | boolean>
  ): void {
    this.postStrictMessage('analytics:trackEvent', {
      event,
      properties: properties ?? {},
    });
  }

  // ==================== Provider Management Methods ====================

  getAvailableProviders(): void {
    this.postStrictMessage('providers:getAvailable', {});
  }

  getCurrentProvider(): void {
    this.postStrictMessage('providers:getCurrent', {});
  }

  switchProvider(
    providerId: string,
    reason?: 'user-request' | 'auto-fallback' | 'error-recovery'
  ): void {
    this.postStrictMessage('providers:switch', { providerId, reason });
  }

  getProviderHealth(providerId?: string): void {
    this.postStrictMessage('providers:getHealth', { providerId });
  }

  getAllProviderHealth(): void {
    this.postStrictMessage('providers:getAllHealth', {});
  }

  setDefaultProvider(providerId: string): void {
    this.postStrictMessage('providers:setDefault', { providerId });
  }

  enableProviderFallback(enabled: boolean): void {
    this.postStrictMessage('providers:enableFallback', { enabled });
  }

  setProviderAutoSwitch(enabled: boolean): void {
    this.postStrictMessage('providers:setAutoSwitch', { enabled });
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
