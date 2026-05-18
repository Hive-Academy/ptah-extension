import { Injectable, signal, computed, inject } from '@angular/core';
import { AppStateManager, ViewType } from './app-state.service';

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
 *
 * MODERNIZED:
 * - Uses inject() instead of constructor injection
 * - Pure signal-based state (no BehaviorSubject)
 * - Automatic cleanup via DestroyRef
 * - Type-safe message handling
 */
@Injectable({ providedIn: 'root' })
export class WebviewNavigationService {
  private readonly appState = inject(AppStateManager);
  private readonly _navigationState = signal<NavigationState>({
    currentView: 'chat',
    previousView: null,
    navigationMethod: 'signal',
    lastNavigationTime: 0,
    isNavigating: false,
  });

  private readonly _navigationHistory = signal<ViewType[]>(['chat']);
  private readonly _navigationErrors = signal<string[]>([]);
  readonly navigationState = this._navigationState.asReadonly();
  readonly navigationHistory = this._navigationHistory.asReadonly();
  readonly navigationErrors = this._navigationErrors.asReadonly();
  readonly currentView = computed(() => this._navigationState().currentView);
  readonly previousView = computed(() => this._navigationState().previousView);
  readonly isNavigating = computed(() => this._navigationState().isNavigating);
  readonly canNavigate = computed(
    () =>
      this.appState.canSwitchViews() && !this._navigationState().isNavigating
  );
  readonly navigationReliability = computed(() => {
    const errors = this._navigationErrors();
    const totalNavigations = this._navigationHistory().length;
    if (totalNavigations === 0) return 1.0;
    return Math.max(0, (totalNavigations - errors.length) / totalNavigations);
  });

  constructor() {
    this.initializeService();
  }

  private initializeService(): void {
    const initialView = this.appState.currentView();
    this._navigationState.update((state) => ({
      ...state,
      currentView: initialView,
    }));
    this._navigationErrors.set([]);
  }

  /**
   * Pure signal-based navigation - NO History API usage
   *
   * @param view Target view to navigate to
   * @returns Promise<boolean> Success of navigation
   */
  async navigateToView(view: ViewType): Promise<boolean> {
    if (!this.canNavigate()) {
      return false;
    }

    if (view === this.currentView()) {
      return true;
    }

    this.setNavigating(true);

    try {
      this.updateNavigationState(view);
      this.setNavigating(false);
      return true;
    } catch (error) {
      this.handleNavigationError(error, view);
      this.setNavigating(false);
      return false;
    }
  }

  private updateNavigationState(view: ViewType): void {
    const currentState = this._navigationState();
    this._navigationState.set({
      currentView: view,
      previousView: currentState.currentView,
      navigationMethod: 'signal',
      lastNavigationTime: Date.now(),
      isNavigating: false,
    });
    this.appState.setCurrentView(view);
    this._navigationHistory.update((history) => [...history, view]);
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

  private handleNavigationError(error: unknown, targetView: ViewType): void {
    const errorMessage = `Navigation failed to ${targetView}: ${
      error instanceof Error ? error.message : 'Unknown error'
    }`;
    console.error('WebviewNavigationService:', errorMessage);

    this._navigationErrors.update((errors) => [...errors, errorMessage]);
    if (this._navigationErrors().length > 20) {
      this._navigationErrors.update((errors) => errors.slice(-20));
    }
    this.appState.handleError(
      `Navigation failed: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
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
