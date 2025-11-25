import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  computed,
  inject,
} from '@angular/core';
import { Subject } from 'rxjs';

// UPDATED: Import from @ptah-extension/core library
import {
  AppStateManager,
  VSCodeService,
  WebviewNavigationService,
  ViewType,
  // ProviderService, // DELETED - provider library removed in Phase 0
} from '@ptah-extension/core';

// UPDATED: Import components from libraries
import { AppShellComponent } from '@ptah-extension/chat';
// import { SettingsViewComponent } from '@ptah-extension/providers'; // DELETED - provider library removed
import { LoadingSpinnerComponent } from '@ptah-extension/shared-ui';
// import { VIEW_MESSAGE_TYPES } from '@ptah-extension/shared'; // DELETED - message types purged

@Component({
  selector: 'ptah-root',
  imports: [
    LoadingSpinnerComponent,
    AppShellComponent,
    // SettingsViewComponent, // DELETED - provider library removed
  ],
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
})
export class App implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();

  // ANGULAR 20 PATTERN: Use inject() instead of constructor injection
  public readonly appState = inject(AppStateManager);
  public readonly vscodeService = inject(VSCodeService);
  private readonly navigationService = inject(WebviewNavigationService);
  // private readonly providerService = inject(ProviderService); // DELETED - provider library removed in Phase 0
  // REMOVED: Router injection - using pure signal-based navigation

  // ANGULAR 20 PATTERN: Signal-based state for reactive UI
  private readonly initializationStatus = signal<
    'idle' | 'initializing' | 'ready' | 'error'
  >('idle');

  // ANGULAR 20 PATTERN: Computed signals for derived state
  public readonly isReady = computed(() => {
    const status = this.initializationStatus();
    const ready = status === 'ready';
    console.log('🔍 [App] isReady computed:', {
      initializationStatus: status,
      isReady: ready,
    });
    return ready;
  });

  public readonly hasError = computed(
    () => this.initializationStatus() === 'error'
  );
  public readonly isInitializing = computed(
    () => this.initializationStatus() === 'initializing'
  );

  public async ngOnInit(): Promise<void> {
    console.log('=================================================');
    console.log('PTAH APP NGONINIT STARTING');
    console.log('=================================================');
    console.warn('🚨 APP COMPONENT: ngOnInit called!');
    alert('PTAH App: ngOnInit starting');
    this.initializationStatus.set('initializing');

    try {
      console.log('Step 1: Requesting initial data from extension...');
      // Request initial data - AppStateManager handles the response
      // this.vscodeService.postStrictMessage(VIEW_MESSAGE_TYPES.CHANGED, { // DELETED - message types purged
      //   view: 'chat',
      // });
      this.appState.setConnected(true);
      console.log('Step 1: COMPLETE - Initial data requested');

      console.log('Step 2: Notifying VS Code that webview is ready...');
      // this.vscodeService.notifyReady();
      console.log('Step 2: COMPLETE - VS Code notified (stub)');

      // console.log('Step 3: Initializing ProviderService...'); // DELETED - provider library removed in Phase 0
      // this.providerService.initialize();
      // console.log('Step 3: COMPLETE - ProviderService initialized');

      console.log('Step 4: Handling initial view setup...');
      await this.handleInitialView();
      console.log('Step 4: COMPLETE - Initial view set up');

      console.log('=================================================');
      console.log('SETTING initializationStatus TO READY');
      console.log(
        'isReady() will now return:',
        this.initializationStatus() === 'ready'
      );
      console.log('=================================================');
      this.initializationStatus.set('ready');
      console.log(
        'After set - initializationStatus():',
        this.initializationStatus()
      );
      console.log('After set - isReady():', this.isReady());
      console.log('Zone.js will automatically trigger change detection');
    } catch (error) {
      console.error('=================================================');
      console.error('PTAH APP INITIALIZATION FAILED');
      console.error('Error:', error);
      console.error('=================================================');
      this.initializationStatus.set('error');
    }
  }

  public ngOnDestroy(): void {
    console.log('Ptah App - disposing...');
    this.destroy$.next();
    this.destroy$.complete();
    this.appState.setConnected(false);
  }

  public async onViewChanged(view: ViewType): Promise<void> {
    console.log('Ptah App - View changed to:', view);

    // Use navigation service for reliable navigation
    const success = await this.navigationService.navigateToView(view);

    if (success) {
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
