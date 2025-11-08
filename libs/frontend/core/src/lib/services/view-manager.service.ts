import { Injectable, inject } from '@angular/core';
import { AppStateManager, ViewType } from './app-state.service';
import { MessageHandlerService } from './message-handler.service';

/**
 * View Manager Service
 *
 * Manages view switching and application lifecycle in the Angular webview.
 * Coordinates between AppStateManager and MessageHandlerService for view navigation.
 *
 * MODERNIZED:
 * - Uses inject() instead of constructor injection
 * - Delegates to signal-based AppStateManager
 * - Zero direct state management (pure orchestration)
 */
@Injectable({
  providedIn: 'root',
})
export class ViewManagerService {
  private readonly appState = inject(AppStateManager);
  private readonly messageHandler = inject(MessageHandlerService);

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
    return (
      this.appState.canSwitchViews() && view !== this.appState.currentView()
    );
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
