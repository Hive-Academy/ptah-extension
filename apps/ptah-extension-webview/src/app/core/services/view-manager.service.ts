import { Injectable } from '@angular/core';
import { AppStateManager, ViewType } from './app-state.service';
import { MessageHandlerService } from './message-handler.service';

@Injectable({
  providedIn: 'root',
})
export class ViewManagerService {
  constructor(
    private appState: AppStateManager,
    private messageHandler: MessageHandlerService,
  ) {}

  /**
   * Switch to a different view
   */
  switchView(view: ViewType): void {
    if (this.canSwitchView(view)) {
      this.appState.setCurrentView(view);
      this.messageHandler.notifyViewChanged(view);
    }
  }

  /**
   * Check if view switching is allowed
   */
  canSwitchView(view: ViewType): boolean {
    return this.appState.canSwitchViews() && view !== this.appState.currentView();
  }

  /**
   * Get the current view
   */
  getCurrentView(): ViewType {
    return this.appState.currentView();
  }

  /**
   * Initialize the view manager
   */
  async initialize(): Promise<void> {
    try {
      // Request initial data from VS Code
      this.messageHandler.requestInitialData();

      // Signal that we're ready
      this.messageHandler.notifyReady();

      this.appState.setConnected(true);
    } catch (error) {
      console.error('Failed to initialize view manager:', error);
      this.appState.handleError('Failed to initialize application');
    }
  }

  /**
   * Handle application shutdown
   */
  dispose(): void {
    // Clean up if needed
    this.appState.setConnected(false);
  }
}
