import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  computed,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { AppStateManager, ViewType } from './core/services/app-state.service';
import { ViewManagerService } from './core/services/view-manager.service';
import { VSCodeService } from './core/services/vscode.service';
import { WebviewNavigationService } from './core/services/webview-navigation.service';
import { Subject } from 'rxjs';
// Components
import { VSCodeChatComponent } from './smart-components/chat/chat.component';
import { AnalyticsComponent } from './smart-components/analytics/analytics.component';
import { VSCodeLoadingSpinnerComponent } from './dumb-components';

@Component({
  selector: 'app-root',
  imports: [VSCodeLoadingSpinnerComponent, VSCodeChatComponent, AnalyticsComponent],
  templateUrl: './app.html',
styleUrls: ['./app.css'],
})
export class App implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  // ANGULAR 20 PATTERN: Use inject() instead of constructor injection
  public appState = inject(AppStateManager);
  private viewManager = inject(ViewManagerService);
  public vscodeService = inject(VSCodeService);
  private navigationService = inject(WebviewNavigationService);
  // REMOVED: Router injection - using pure signal-based navigation

  // ANGULAR 20 PATTERN: Signal-based state for reactive UI
  private initializationStatus = signal<'idle' | 'initializing' | 'ready' | 'error'>('idle');

  // ANGULAR 20 PATTERN: Computed signals for derived state
  readonly isReady = computed(() => this.initializationStatus() === 'ready');
  readonly hasError = computed(() => this.initializationStatus() === 'error');
  readonly isInitializing = computed(() => this.initializationStatus() === 'initializing');


  async ngOnInit(): Promise<void> {
    console.log('Ptah App ngOnInit - starting initialization...');
    this.initializationStatus.set('initializing');

    try {
      // Initialize view manager
      await this.viewManager.initialize();
      console.log('Ptah App - ViewManager initialized successfully');

      // Notify VS Code that the app is ready
      this.vscodeService.notifyReady();

      // Handle initial view setup
      await this.handleInitialView();

      this.initializationStatus.set('ready');
    } catch (error) {
      console.error('Ptah App - Failed to initialize ViewManager:', error);
      this.initializationStatus.set('error');
    }
  }

  ngOnDestroy(): void {
    console.log('Ptah App - disposing...');
    this.destroy$.next();
    this.destroy$.complete();
    this.viewManager.dispose();
  }

  async onViewChanged(view: ViewType): Promise<void> {
    console.log('Ptah App - View changed to:', view);

    // Use hybrid navigation service for reliable navigation
    const success = await this.navigationService.navigateToView(view);

    if (success) {
      // Update view manager for consistency
      this.viewManager.switchView(view);
      console.log(`Ptah App - Navigation to ${view} completed successfully`);
    } else {
      console.error(`Ptah App - Navigation to ${view} failed`);
      // Show user-friendly error message
      this.appState.handleError(`Failed to navigate to ${view}`);
    }
  }



  // REMOVED: setupRouterLogging - no longer using Angular Router

  private async handleInitialView(): Promise<void> {
    console.log('Setting up initial view with pure signal navigation');

    // Initialize to chat view by default
    const success = await this.navigationService.navigateToView('chat');
    if (!success) {
      console.warn('Initial navigation to chat failed, using fallback');
      this.appState.setCurrentView('chat');
    }
  }
}
