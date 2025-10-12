import { Injectable, signal, computed } from '@angular/core';
import { VSCodeService } from './vscode.service';
import { WorkspaceInfo } from '@ptah-extension/shared';

export type ViewType = 'chat' | 'command-builder' | 'analytics' | 'context-tree';

export interface AppState {
  currentView: ViewType;
  isLoading: boolean;
  statusMessage: string;
  workspaceInfo: WorkspaceInfo | null;
  isConnected: boolean;
}

/**
 * App State Manager - Angular 20+ Signal-Based
 * - Already uses modern signal pattern ✅
 * - OnPush compatible state management
 * - Computed signals for derived state
 * - Pure reactive state updates
 */
@Injectable({
  providedIn: 'root',
})
export class AppStateManager {
  // Core state signals
  private readonly _currentView = signal<ViewType>('chat');
  private readonly _isLoading = signal(false);
  private readonly _statusMessage = signal('Ready');
  private readonly _workspaceInfo = signal<WorkspaceInfo | null>(null);
  private readonly _isConnected = signal(true);

  // Public readonly signals
  readonly currentView = this._currentView.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly statusMessage = this._statusMessage.asReadonly();
  readonly workspaceInfo = this._workspaceInfo.asReadonly();
  readonly isConnected = this._isConnected.asReadonly();

  // Computed signals
  readonly canSwitchViews = computed(() => !this._isLoading() && this._isConnected());
  readonly appTitle = computed(() => {
    const workspace = this._workspaceInfo();
    return workspace ? `Ptah - ${workspace.name}` : 'Ptah';
  });

  constructor(private vscodeService: VSCodeService) {
    this.initializeState();
  }

  private initializeState(): void {
    // Get initial view from window global (set by VS Code provider)
    const initialView = (window as any).initialView || 'chat';
    this._currentView.set(initialView);

    // Restore previous state if available
    const previousState = (window as any).previousState;
    if (previousState) {
      this._currentView.set(previousState.currentView || 'command-builder');
    }
  }

  // State update methods
  setCurrentView(view: ViewType): void {
    if (this.canSwitchViews()) {
      this._currentView.set(view);
      this.persistState();
    }
  }

  setLoading(loading: boolean): void {
    this._isLoading.set(loading);
  }

  setStatusMessage(message: string): void {
    this._statusMessage.set(message);
  }

  setWorkspaceInfo(info: WorkspaceInfo | null): void {
    this._workspaceInfo.set(info);
  }

  setConnected(connected: boolean): void {
    this._isConnected.set(connected);
    if (connected) {
      this.setStatusMessage('Connected to VS Code');
      this.setLoading(false);
    } else {
      this.setStatusMessage('Disconnected from VS Code');
    }
  }

  // Handle initial data from VS Code
  handleInitialData(data: any): void {
    if (data.workspaceInfo) {
      this.setWorkspaceInfo(data.workspaceInfo);
    }
    if (data.currentView) {
      this._currentView.set(data.currentView);
    }
    this.setConnected(true);
  }

  // Handle view switching from VS Code
  handleViewSwitch(view: ViewType): void {
    this._currentView.set(view);
    this.persistState();
  }

  // Handle errors
  handleError(error: string): void {
    this.setStatusMessage(`Error: ${error}`);
  }

  // State persistence
  private persistState(): void {
    const state = {
      currentView: this._currentView(),
      timestamp: new Date().toISOString(),
    };

    this.vscodeService.saveState(state);
  }

  // Get current state snapshot
  getStateSnapshot(): AppState {
    return {
      currentView: this._currentView(),
      isLoading: this._isLoading(),
      statusMessage: this._statusMessage(),
      workspaceInfo: this._workspaceInfo(),
      isConnected: this._isConnected(),
    };
  }
}
