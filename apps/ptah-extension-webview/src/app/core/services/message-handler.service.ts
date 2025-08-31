import { Injectable } from '@angular/core';
import { VSCodeService } from './vscode.service';
import { AppStateManager, ViewType } from './app-state.service';
import {
  StrictMessage,
  ViewChangedPayload,
  InitialDataPayload,
  ErrorPayload,
  ThemeChangedPayload,
  SwitchViewPayload,
  WorkspaceChangedPayload,
  MessagePayloadMap,
} from '@ptah-extension/shared';

@Injectable({
  providedIn: 'root',
})
export class MessageHandlerService {
  constructor(
    private vscodeService: VSCodeService,
    private appState: AppStateManager,
  ) {
    this.setupMessageHandling();
  }

  private setupMessageHandling(): void {
    this.vscodeService
      .onMessage()
      .subscribe(<T extends keyof MessagePayloadMap>(message: StrictMessage<T>) => {
        this.handleMessage(message);
      });
  }

  private handleMessage<T extends keyof MessagePayloadMap>(message: StrictMessage<T>): void {
    try {
      switch (message.type) {
        case 'switchView':
          this.handleSwitchView(message.payload as SwitchViewPayload);
          break;

        case 'initialData':
          this.handleInitialData(message.payload as InitialDataPayload);
          break;

        case 'error':
          this.handleError(message.payload as ErrorPayload);
          break;

        case 'workspaceChanged':
          this.handleWorkspaceChanged(message.payload as WorkspaceChangedPayload);
          break;

        case 'themeChanged':
          this.handleThemeChanged(message.payload as ThemeChangedPayload);
          break;

        // Chat-specific messages
        case 'chat:sessionCreated':
        case 'chat:sessionSwitched':
        case 'chat:messageAdded':
        case 'chat:messageChunk':
        case 'chat:messageComplete':
        case 'chat:error':
        case 'chat:sessionsUpdated':
          // These are handled directly by ChatComponent
          // We just log them here for debugging
          console.log('Chat message received:', message.type, message.payload);
          break;

        case 'context:filesLoaded':
          // Context files loaded notification
          console.log('Context files loaded:', message.payload);
          break;

        default:
          console.log('Unhandled message type:', message.type, message);
      }
    } catch (error) {
      console.error('Error handling VS Code message:', error, message);
      this.appState.handleError(`Failed to handle message: ${message.type}`);
    }
  }

  private handleSwitchView(payload: SwitchViewPayload): void {
    if (payload?.view && this.isValidViewType(payload.view)) {
      this.appState.handleViewSwitch(payload.view);
    }
  }

  private handleInitialData(payload: InitialDataPayload): void {
    if (payload) {
      this.appState.handleInitialData(payload);
    }
  }

  private handleError(payload: ErrorPayload): void {
    const errorMessage = payload?.message || 'Unknown error';
    this.appState.handleError(errorMessage);
  }

  private handleWorkspaceChanged(payload: WorkspaceChangedPayload): void {
    if (payload?.workspaceInfo && typeof payload.workspaceInfo === 'object') {
      // Type assertion since workspaceInfo is unknown but should be WorkspaceInfo
      this.appState.setWorkspaceInfo(payload.workspaceInfo as any);
    }
  }

  private handleThemeChanged(payload: ThemeChangedPayload): void {
    // Handle theme changes if needed
    console.log('Theme changed:', payload.theme);
  }

  private isValidViewType(view: string): view is ViewType {
    return ['chat', 'command-builder', 'analytics'].includes(view);
  }

  // Public methods for sending messages to VS Code using strict typing
  notifyViewChanged(view: ViewType): void {
    this.vscodeService.postStrictMessage('view:changed', { view });
  }

  notifyReady(): void {
    const state = this.appState.getStateSnapshot();
    this.vscodeService.postStrictMessage('ready', { currentView: state.currentView });
  }

  requestInitialData(): void {
    this.vscodeService.postStrictMessage('requestInitialData', {});
  }

  // Chat-specific message senders with strict typing
  sendChatMessage(content: string, correlationId: string): void {
    this.vscodeService.postStrictMessage('chat:sendMessage', {
      content,
      correlationId: correlationId as any, // Cast to CorrelationId brand type
      files: [],
    });
  }

  createNewSession(name?: string): void {
    this.vscodeService.postStrictMessage('chat:newSession', { name });
  }

  switchToSession(sessionId: string): void {
    this.vscodeService.postStrictMessage('chat:switchSession', {
      sessionId: sessionId as any, // Cast to SessionId brand type
    });
  }

  requestChatSessions(): void {
    this.vscodeService.postStrictMessage('chat:getHistory', {});
  }
}
