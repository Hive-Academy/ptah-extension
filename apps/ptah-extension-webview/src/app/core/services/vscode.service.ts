import { Injectable, signal, computed } from '@angular/core';
import { Observable, Subject, fromEvent } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import {
  StrictMessage,
  MessagePayloadMap,
  StrictMessageType,
  StateSavePayload,
  createStrictMessage,
  CorrelationId,
  SessionId,
  VSCodeMessage,
  CommandTemplate,
} from '@ptah-extension/shared';

// Re-export for backward compatibility
export type { VSCodeMessage };

export interface WebviewConfig {
  isVSCode: boolean;
  theme: 'light' | 'dark' | 'high-contrast';
  workspaceRoot: string;
  workspaceName: string;
  extensionUri: string;
  baseUri?: string;
  iconUri?: string;
}

// VS Code API interface - replaces any type
export interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

@Injectable({
  providedIn: 'root',
})
export class VSCodeService {
  private vscode: VsCodeApi | null = null;
  private messageSubject = new Subject<StrictMessage>();

  // ANGULAR 20 PATTERN: Private signals for internal state
  private _config = signal<WebviewConfig>({
    isVSCode: false,
    theme: 'dark',
    workspaceRoot: '',
    workspaceName: '',
    extensionUri: '',
  });

  private _isConnected = signal(false);

  // ANGULAR 20 PATTERN: Readonly computed signals for external access
  readonly config = this._config.asReadonly();
  readonly isConnected = this._isConnected.asReadonly();

  // ANGULAR 20 PATTERN: Computed signals for derived state
  readonly isDevelopmentMode = computed(() => !this.isConnected());
  readonly currentTheme = computed(() => this.config().theme);
  readonly workspaceDisplayName = computed(
    () => this.config().workspaceName || 'Unknown Workspace',
  );

  constructor() {
    this.initializeVSCodeAPI();
    this.setupMessageListener();
    this.setupThemeListener();
  }

  private initializeVSCodeAPI(): void {
    console.log('VSCodeService: Initializing VS Code API...');
    try {
      // Check if we're running in VS Code webview
      if (typeof window !== 'undefined' && (window as unknown as { vscode?: VsCodeApi }).vscode) {
        console.log('VSCodeService: VS Code API found in window');
        this.vscode = (window as unknown as { vscode: VsCodeApi }).vscode;
        this._isConnected.set(true);
      } else if (
        typeof (window as unknown as { acquireVsCodeApi?: () => VsCodeApi }).acquireVsCodeApi !==
        'undefined'
      ) {
        console.log('VSCodeService: acquiring VS Code API...');
        this.vscode = (
          window as unknown as { acquireVsCodeApi: () => VsCodeApi }
        ).acquireVsCodeApi();
        this._isConnected.set(true);
      } else {
        console.warn('VSCodeService: VS Code API not available - running in development mode');
        this._isConnected.set(false);
        this.setupDevelopmentMode();
      }

      // Get initial config from window
      const windowConfig = (window as unknown as { ptahConfig?: Partial<WebviewConfig> })
        .ptahConfig;
      if (windowConfig) {
        console.log('VSCodeService: Found window config:', windowConfig);
        this._config.set({
          isVSCode: windowConfig.isVSCode || false,
          theme: windowConfig.theme || 'dark',
          workspaceRoot: windowConfig.workspaceRoot || '',
          workspaceName: windowConfig.workspaceName || '',
          extensionUri: windowConfig.extensionUri || '',
          baseUri: windowConfig.baseUri || '',
          iconUri: windowConfig.iconUri || '',
        });
      }

      console.log('VSCodeService: Initialization complete. Connected:', this.isConnected());
    } catch (error) {
      console.error('VSCodeService: Failed to initialize VS Code API:', error);
      this._isConnected.set(false);
      this.setupDevelopmentMode();
    }
  }

  private setupDevelopmentMode(): void {
    // Setup mock configuration for development
    this._config.set({
      isVSCode: false,
      theme: 'dark',
      workspaceRoot: '/mock/workspace',
      workspaceName: 'Mock Workspace',
      extensionUri: '',
    });
  }

  private setupMessageListener(): void {
    window.addEventListener('message', (event) => {
      const message = event.data as StrictMessage;

      // Handle theme changes
      if (message.type === 'themeChanged') {
        const themePayload = message.payload as MessagePayloadMap['themeChanged'];
        this._config.update((config: WebviewConfig) => ({
          ...config,
          theme: themePayload.theme,
        }));
      }

      // Handle state management responses
      if (message.type === 'state:saved') {
        console.log('VSCodeService: State saved successfully');
        // Don't emit to general message stream as this is handled internally
        return;
      } else if (message.type === 'error') {
        const errorPayload = message.payload as MessagePayloadMap['error'];
        console.error('VSCodeService: Error:', errorPayload.message);
      } else if (message.type === 'state:loaded') {
        console.log('VSCodeService: State loaded:', message.payload);
      }

      // Emit message to subscribers
      this.messageSubject.next(message);
    });
  }

  private setupThemeListener(): void {
    // Listen for VS Code theme changes via custom events
    fromEvent(window, 'vscode-theme-changed').subscribe((event: Event) => {
      const customEvent = event as CustomEvent<{ theme: 'light' | 'dark' | 'high-contrast' }>;
      if (customEvent.detail) {
        this._config.update((config: WebviewConfig) => ({
          ...config,
          theme: customEvent.detail.theme,
        }));
      }
    });
  }

  /**
   * Send type-safe message to VS Code extension
   */
  postStrictMessage<T extends keyof MessagePayloadMap>(
    type: T,
    payload: MessagePayloadMap[T],
    correlationId?: CorrelationId,
  ): void {
    if (!this.isConnected() || !this.vscode) {
      console.warn('VSCodeService: Cannot send message - not connected:', {
        type,
        payload,
        isConnected: this.isConnected(),
        hasVscode: !!this.vscode,
      });
      return;
    }

    try {
      const message = createStrictMessage(type, payload, correlationId);
      console.log('VSCodeService: Sending message:', { type, correlationId });
      this.vscode.postMessage(message);
    } catch (error) {
      console.error('VSCodeService: Failed to send message to VS Code:', { type, error });
    }
  }

  /**
   * @deprecated Use postStrictMessage for type safety
   * Legacy method for backward compatibility
   */
  postMessage(type: string, data?: unknown): void {
    console.warn('VSCodeService.postMessage is deprecated. Use postStrictMessage for type safety.');
    if (!this.isConnected() || !this.vscode) {
      console.warn('VS Code API not available, message not sent:', { type, data });
      return;
    }

    try {
      this.vscode.postMessage({ type, data });
    } catch (error) {
      console.error('Failed to send message to VS Code:', error);
    }
  }

  /**
   * Listen for messages from VS Code extension
   */
  onMessage(): Observable<StrictMessage> {
    return this.messageSubject.asObservable();
  }

  /**
   * Listen for specific message types with type safety
   */
  onMessageType<T extends keyof MessagePayloadMap>(
    messageType: T,
  ): Observable<MessagePayloadMap[T]> {
    return this.messageSubject.pipe(
      filter((message): message is StrictMessage<T> => message.type === messageType),
      map((message) => message.payload),
    );
  }

  /**
   * Notify VS Code that webview is ready
   */
  notifyReady(): void {
    this.postStrictMessage('webview-ready', {});
  }

  /**
   * Navigate to a specific route within the Angular app
   */
  navigateToRoute(route: string): void {
    this.postStrictMessage('view:routeChanged', { route });
  }

  /**
   * Request file picker from VS Code
   */
  requestFilePicker(options?: { multiple?: boolean }): void {
    this.postStrictMessage('commands:selectFile', { multiple: options?.multiple });
  }

  /**
   * Execute VS Code command
   */
  executeVSCodeCommand(templateId: string, parameters?: Record<string, unknown>): void {
    this.postStrictMessage('commands:executeCommand', { templateId, parameters: parameters ?? {} });
  }

  /**
   * Update VS Code configuration
   */
  updateConfiguration(key: string, value: unknown): void {
    this.postStrictMessage('config:set', { key, value });
  }

  /**
   * Get proper webview URI for assets
   * Converts relative paths to webview-safe URIs
   */
  getAssetUri(relativePath: string): string {
    const config = this.config();

    if (!this.isConnected() || !config.baseUri) {
      // Development mode - return relative path as-is
      return relativePath;
    }

    // Use the baseUri provided by the extension
    const baseUri = config.baseUri.endsWith('/') ? config.baseUri : config.baseUri + '/';
    return baseUri + relativePath;
  }

  /**
   * Get the proper webview URI for the Ptah icon
   */
  getPtahIconUri(): string {
    const config = this.config();

    if (!this.isConnected() || !config.iconUri) {
      // Development mode - return relative path
      return 'images/ptah-icon.png';
    }

    return config.iconUri;
  }

  /**
   * Show VS Code message
   */
  showMessage(message: string, type: 'info' | 'warning' | 'error' = 'info'): void {
    this.postStrictMessage('error', { message: `${type.toUpperCase()}: ${message}` });
  }

  /**
   * Save webview state to VS Code
   * FIXED: Use state:save protocol and strict typing
   */
  saveState(state: unknown): void {
    // Validate state exists
    if (state !== null && state !== undefined) {
      this.postStrictMessage('state:save', { state });
    } else {
      console.warn('VSCodeService: saveState called with null/undefined state:', state);
      // Send empty object as fallback
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

  /**
   * Chat-related methods
   */
  sendChatMessage(content: string, files?: readonly string[], correlationId?: CorrelationId): void {
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
    this.postStrictMessage('chat:switchSession', { sessionId: sessionId as SessionId });
  }

  /**
   * Command Builder methods
   */
  getCommandTemplates(): void {
    this.postStrictMessage('commands:getTemplates', {});
  }

  executeCommand(templateId: string, parameters: Record<string, unknown>): void {
    this.postStrictMessage('commands:executeCommand', { templateId, parameters });
  }

  saveCommandTemplate(template: CommandTemplate): void {
    this.postStrictMessage('commands:saveTemplate', { template });
  }

  /**
   * Context Management methods
   */
  getContextFiles(): void {
    this.postStrictMessage('context:getFiles', {});
  }

  includeFile(filePath: string): void {
    this.postStrictMessage('context:includeFile', { filePath });
  }

  excludeFile(filePath: string): void {
    this.postStrictMessage('context:excludeFile', { filePath });
  }

  /**
   * Analytics methods
   */
  getAnalyticsData(): void {
    this.postStrictMessage('analytics:getData', {});
  }

  trackAnalyticsEvent(event: string, properties?: Record<string, unknown>): void {
    this.postStrictMessage('analytics:trackEvent', { event, properties });
  }

  /**
   * Provider Management methods
   */
  getAvailableProviders(): void {
    this.postStrictMessage('providers:getAvailable', {});
  }

  getCurrentProvider(): void {
    this.postStrictMessage('providers:getCurrent', {});
  }

  switchProvider(
    providerId: string,
    reason?: 'user-request' | 'auto-fallback' | 'error-recovery',
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

  /**
   * Asset methods
   */
  getImageUrl(imagePath: string): string {
    const config = this.config();
    if (this.isConnected() && config.extensionUri) {
      // In VS Code, images are served from the webview URI
      // The build process places images in the browser output directory
      return `${config.extensionUri}/out/webview/browser/${imagePath}`;
    } else {
      // In development mode, use the public path
      return `/${imagePath}`;
    }
  }
}
