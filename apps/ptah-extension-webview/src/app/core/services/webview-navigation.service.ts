import { Injectable, signal, computed, inject } from '@angular/core';
import { AppStateManager, ViewType } from './app-state.service';
import { VSCodeService } from './vscode.service';
// REMOVED: Angular Router imports - using pure signal-based navigation for VS Code webview compatibility

export interface NavigationState {
  currentView: ViewType;
  previousView: ViewType | null;
  navigationMethod: 'signal';
  lastNavigationTime: number;
  isNavigating: boolean;
}

/**
 * Pure Signal-Based Navigation Service for VS Code Webview
 *
 * CRITICAL: This service completely avoids Angular Router and History API
 * which are incompatible with VS Code webviews due to security restrictions.
 *
 * Navigation is achieved through:
 * 1. Signal-based component state switching
 * 2. Direct extension communication
 * 3. NO History API calls (pushState/replaceState blocked in webviews)
 * 4. NO URL manipulation
 */
@Injectable({ providedIn: 'root' })
export class WebviewNavigationService {
  private readonly appState = inject(AppStateManager);
  private readonly vscodeService = inject(VSCodeService);

  // Private signals for internal state
  private readonly _navigationState = signal<NavigationState>({
    currentView: 'chat',
    previousView: null,
    navigationMethod: 'signal',
    lastNavigationTime: 0,
    isNavigating: false,
  });

  private readonly _navigationHistory = signal<ViewType[]>(['chat']);
  private readonly _navigationErrors = signal<string[]>([]);

  // Public readonly signals
  readonly navigationState = this._navigationState.asReadonly();
  readonly navigationHistory = this._navigationHistory.asReadonly();
  readonly navigationErrors = this._navigationErrors.asReadonly();

  // Computed signals for derived state
  readonly currentView = computed(() => this._navigationState().currentView);
  readonly previousView = computed(() => this._navigationState().previousView);
  readonly isNavigating = computed(() => this._navigationState().isNavigating);
  readonly canNavigate = computed(
    () => this.appState.canSwitchViews() && !this._navigationState().isNavigating,
  );
  readonly navigationReliability = computed(() => {
    const errors = this._navigationErrors();
    const totalNavigations = this._navigationHistory().length;
    if (totalNavigations === 0) return 1.0;
    return Math.max(0, (totalNavigations - errors.length) / totalNavigations);
  });

  constructor() {
    this.initializeService();
    this.setupVSCodeListener();
  }

  private initializeService(): void {
    // Sync initial state with AppStateManager
    const initialView = this.appState.currentView();
    this._navigationState.update((state) => ({
      ...state,
      currentView: initialView,
    }));

    // Clear any stale error state
    this._navigationErrors.set([]);

    console.log('WebviewNavigationService: Initialized with pure signal-based navigation');
  }

  private setupVSCodeListener(): void {
    // Listen for navigation requests from VS Code extension
    this.vscodeService.onMessageType('navigate').subscribe(async (data: { route: string }) => {
      console.log(
        'WebviewNavigationService: Received navigation request from VS Code:',
        data.route,
      );

      // Extract view from route
      const view = data.route.replace('/', '').replace('#/', '') as ViewType;
      if (this.isValidViewType(view)) {
        await this.navigateToView(view);
      }
    });
  }

  private isValidViewType(view: string): view is ViewType {
    return ['chat', 'command-builder', 'analytics'].includes(view);
  }

  /**
   * Pure signal-based navigation - NO History API usage
   *
   * @param view Target view to navigate to
   * @returns Promise<boolean> Success of navigation
   */
  async navigateToView(view: ViewType): Promise<boolean> {
    if (!this.canNavigate()) {
      console.warn('WebviewNavigationService: Navigation blocked - conditions not met');
      return false;
    }

    if (view === this.currentView()) {
      console.info('WebviewNavigationService: Already on requested view:', view);
      return true;
    }

    this.setNavigating(true);

    try {
      console.log('WebviewNavigationService: Navigating to view via signals:', view);

      // Pure signal-based navigation - update component state directly
      this.updateNavigationState(view);

      // Notify extension of view change (no URL manipulation)
      this.vscodeService.postMessage('view-changed', { view });

      this.setNavigating(false);
      console.log('WebviewNavigationService: Navigation complete via signals to:', view);
      return true;
    } catch (error) {
      this.handleNavigationError(error, view);
      this.setNavigating(false);
      return false;
    }
  }

  private updateNavigationState(view: ViewType): void {
    const currentState = this._navigationState();

    // Update navigation state
    this._navigationState.set({
      currentView: view,
      previousView: currentState.currentView,
      navigationMethod: 'signal',
      lastNavigationTime: Date.now(),
      isNavigating: false,
    });

    // Update app state to trigger component switching
    this.appState.setCurrentView(view);

    // Update history
    this._navigationHistory.update((history) => [...history, view]);

    // Keep history manageable (last 50 navigations)
    if (this._navigationHistory().length > 50) {
      this._navigationHistory.update((history) => history.slice(-50));
    }
  }

  private setNavigating(navigating: boolean): void {
    this._navigationState.update((state) => ({
      ...state,
      isNavigating: navigating,
    }));
  }

  private handleNavigationError(error: any, targetView: ViewType): void {
    const errorMessage = `Navigation failed to ${targetView}: ${error?.message || 'Unknown error'}`;
    console.error('WebviewNavigationService:', errorMessage);

    this._navigationErrors.update((errors) => [...errors, errorMessage]);

    // Keep error log manageable (last 20 errors)
    if (this._navigationErrors().length > 20) {
      this._navigationErrors.update((errors) => errors.slice(-20));
    }

    // Notify app state of error
    this.appState.handleError(`Navigation failed: ${error?.message || 'Unknown error'}`);
  }

  /**
   * Navigate back to previous view if available
   */
  async navigateBack(): Promise<boolean> {
    const prevView = this.previousView();
    if (prevView) {
      return this.navigateToView(prevView);
    }
    return false;
  }

  /**
   * Get current view type
   */
  getCurrentView(): ViewType {
    return this.currentView();
  }

  /**
   * Check if navigation to view is possible
   */
  canNavigateToView(view: ViewType): boolean {
    return this.canNavigate() && view !== this.currentView();
  }

  /**
   * Get navigation performance metrics
   */
  getNavigationMetrics(): {
    totalNavigations: number;
    signalSuccessRate: number;
    overallReliability: number;
    averageNavigationTime: number;
  } {
    const history = this._navigationHistory();

    return {
      totalNavigations: history.length,
      signalSuccessRate: this.navigationReliability(), // All navigations are signal-based
      overallReliability: this.navigationReliability(),
      averageNavigationTime: 1, // Signal updates are essentially instant
    };
  }

  /**
   * Clear navigation history and error state
   */
  clearNavigationHistory(): void {
    this._navigationHistory.set([this.currentView()]);
    this._navigationErrors.set([]);
  }
}
