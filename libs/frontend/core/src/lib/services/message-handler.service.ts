import { Injectable, inject } from '@angular/core';
import { VSCodeService } from './vscode.service';
import { AppStateManager, ViewType } from './app-state.service';
import {
  StrictMessage,
  InitialDataPayload,
  ErrorPayload,
  CorrelationId,
  SessionId,
} from '@ptah-extension/shared';

/**
 * Payload interfaces for legacy messages (not in MessagePayloadMap)
 */
interface SwitchViewPayload {
  view: string;
}

interface WorkspaceChangedPayload {
  workspaceInfo: {
    name: string;
    path: string;
    type?: string;
  };
}

/**
 * Message routing and handling service
 *
 * Routes messages from VS Code extension to appropriate handlers.
 * Provides type-safe message sending to extension.
 *
 * @example
 * ```typescript
 * class MyComponent {
 *   private readonly messageHandler = inject(MessageHandlerService);
 *
 *   ngOnInit() {
 *     this.messageHandler.notifyReady();
 *   }
 *
 *   switchView() {
 *     this.messageHandler.notifyViewChanged('analytics');
 *   }
 * }
 * ```
 */
@Injectable({
  providedIn: 'root',
})
export class MessageHandlerService {
  private readonly vscodeService = inject(VSCodeService);
  private readonly appState = inject(AppStateManager);

  constructor() {
    this.setupMessageHandling();
  }

  /**
   * Setup message handling subscription
   */
  private setupMessageHandling(): void {
    this.vscodeService.onMessage().subscribe((message: StrictMessage) => {
      this.handleMessage(message);
    });
  }

  /**
   * Route message to appropriate handler
   * Uses runtime type checking for message routing
   */
  private handleMessage(message: StrictMessage): void {
    try {
      const messageType = message.type as string; // Widen type for legacy messages

      // Handle legacy typed messages
      if (messageType === 'switchView') {
        this.handleSwitchView(message.payload as unknown as SwitchViewPayload);
        return;
      }

      if (messageType === 'initialData') {
        this.handleInitialData(
          message.payload as unknown as InitialDataPayload
        );
        return;
      }

      if (messageType === 'error') {
        this.handleError(message.payload as unknown as ErrorPayload);
        return;
      }

      if (messageType === 'workspaceChanged') {
        this.handleWorkspaceChanged(
          message.payload as unknown as WorkspaceChangedPayload
        );
        return;
      }

      // Handle chat messages (logged for debugging, handled by ChatComponent)
      const chatMessageTypes = [
        'chat:sessionCreated',
        'chat:sessionSwitched',
        'chat:messageAdded',
        'chat:messageChunk',
        'chat:messageComplete',
        'chat:error',
        'chat:sessionsUpdated',
      ];

      if (chatMessageTypes.includes(messageType)) {
        console.log('Chat message received:', message.type, message.payload);
        return;
      }

      // Handle context messages
      if (messageType === 'context:getFiles') {
        console.log('Context files loaded:', message.payload);
        return;
      }

      // Handle provider messages (handled by ProviderService)
      const providerMessageTypes = [
        'providers:availableUpdated',
        'providers:currentChanged',
        'providers:healthChanged',
        'providers:getAvailable:response',
        'providers:getCurrent:response',
        'providers:getAllHealth:response',
        'providers:error',
      ];

      if (providerMessageTypes.includes(messageType)) {
        // Silently handled by ProviderService subscriptions
        return;
      }

      // Handle analytics messages (handled by AnalyticsService)
      const analyticsMessageTypes = [
        'analytics:trackEvent:response',
        'analytics:getMetrics:response',
      ];

      if (analyticsMessageTypes.includes(messageType)) {
        // Silently handled by AnalyticsService subscriptions
        return;
      }

      // Log unhandled messages
      console.log('Unhandled message type:', message.type, message);
    } catch (error) {
      console.error('Error handling VS Code message:', error, message);
      this.appState.handleError(`Failed to handle message: ${message.type}`);
    }
  }

  /**
   * Handle view switch message
   */
  private handleSwitchView(payload: SwitchViewPayload): void {
    if (payload?.view && this.isValidViewType(payload.view)) {
      this.appState.handleViewSwitch(payload.view);
    }
  }

  /**
   * Handle initial data message
   * Payload structure: { success, data: { sessions, currentSession }, config, timestamp }
   * See InitialDataPayload in message.types.ts and AngularWebviewProvider.sendInitialData()
   */
  private handleInitialData(payload: InitialDataPayload): void {
    if (payload && payload.success) {
      // Extract workspace info from config
      const workspaceInfo = payload.config.workspaceInfo as
        | { name?: string; path?: string; projectType?: string }
        | unknown;
      if (
        workspaceInfo &&
        typeof workspaceInfo === 'object' &&
        workspaceInfo !== null
      ) {
        const info = workspaceInfo as {
          name?: string;
          path?: string;
          projectType?: string;
        };
        this.appState.setWorkspaceInfo({
          name: info.name || '',
          path: info.path || '',
          type: info.projectType || 'unknown',
        });
      }

      // Chat/Analytics services handle the session data from payload.data.sessions
      // No need to extract currentView here - AppComponent handles view initialization

      this.appState.setConnected(true);
    }
  }

  /**
   * Handle error message
   */
  private handleError(payload: ErrorPayload): void {
    const errorMessage = payload?.message || 'Unknown error';
    this.appState.handleError(errorMessage);
  }

  /**
   * Handle workspace changed message
   */
  private handleWorkspaceChanged(payload: WorkspaceChangedPayload): void {
    if (payload?.workspaceInfo && typeof payload.workspaceInfo === 'object') {
      this.appState.setWorkspaceInfo({
        ...payload.workspaceInfo,
        type: payload.workspaceInfo.type || 'unknown',
      });
    }
  }

  /**
   * Type guard for view types
   */
  private isValidViewType(view: string): view is ViewType {
    return ['chat', 'command-builder', 'analytics'].includes(view);
  }

  // ==================== Public Message Senders ====================

  /**
   * Notify extension of view change
   */
  notifyViewChanged(view: ViewType): void {
    this.vscodeService.postStrictMessage('view:changed', { view });
  }

  /**
   * Notify extension that webview is ready
   */
  notifyReady(): void {
    const state = this.appState.getStateSnapshot();
    // Call VSCodeService's notifyReady method which handles the message
    this.vscodeService.notifyReady();
    console.log('Webview ready with current view:', state.currentView);
  }

  /**
   * Request initial data from extension
   */
  requestInitialData(): void {
    // Use view:changed as a signal to request data
    this.vscodeService.postStrictMessage('view:changed', { view: 'chat' });
  }

  /**
   * Send chat message
   */
  sendChatMessage(content: string, correlationId: string): void {
    this.vscodeService.sendChatMessage(
      content,
      undefined,
      correlationId as unknown as CorrelationId
    );
  }

  /**
   * Create new chat session
   */
  createNewSession(name?: string): void {
    this.vscodeService.createNewChatSession(name);
  }

  /**
   * Switch to a different chat session
   */
  switchToSession(sessionId: string): void {
    this.vscodeService.switchChatSession(sessionId);
  }

  /**
   * Request chat sessions history
   */
  requestChatSessions(): void {
    this.vscodeService.postStrictMessage('chat:getHistory', {
      sessionId: '' as unknown as SessionId,
    });
  }
}
