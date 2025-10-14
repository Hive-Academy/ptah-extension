import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  computed,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { Subject } from 'rxjs';

// UPDATED: Import from @ptah-extension/core library
import {
  AppStateManager,
  ViewManagerService,
  VSCodeService,
  WebviewNavigationService,
  ViewType,
} from '@ptah-extension/core';

// UPDATED: Import components from libraries
import { ChatComponent } from '@ptah-extension/chat';
import { AnalyticsComponent } from '@ptah-extension/analytics';
import { LoadingSpinnerComponent } from '@ptah-extension/shared-ui';

@Component({
  selector: 'ptah-root',
  imports: [LoadingSpinnerComponent, ChatComponent, AnalyticsComponent],
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();

  // ANGULAR 20 PATTERN: Use inject() instead of constructor injection
  public readonly appState = inject(AppStateManager);
  private readonly viewManager = inject(ViewManagerService);
  public readonly vscodeService = inject(VSCodeService);
  private readonly navigationService = inject(WebviewNavigationService);
  // REMOVED: Router injection - using pure signal-based navigation

  // ANGULAR 20 PATTERN: Signal-based state for reactive UI
  private readonly initializationStatus = signal<
    'idle' | 'initializing' | 'ready' | 'error'
  >('idle');

  // ANGULAR 20 PATTERN: Computed signals for derived state
  public readonly isReady = computed(
    () => this.initializationStatus() === 'ready'
  );
  public readonly hasError = computed(
    () => this.initializationStatus() === 'error'
  );
  public readonly isInitializing = computed(
    () => this.initializationStatus() === 'initializing'
  );

  public async ngOnInit(): Promise<void> {
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

  public ngOnDestroy(): void {
    console.log('Ptah App - disposing...');
    this.destroy$.next();
    this.destroy$.complete();
    this.viewManager.dispose();
  }

  public async onViewChanged(view: ViewType): Promise<void> {
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
