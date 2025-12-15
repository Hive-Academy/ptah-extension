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

@Component({
  selector: 'ptah-root',
  imports: [AppShellComponent],
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

    this.initializationStatus.set('initializing');

    try {
      this.appState.setConnected(true);

      await this.handleInitialView();

      this.initializationStatus.set('ready');
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

    // Check for initialView in ptahConfig (set by extension for specific views like wizard)
    const ptahConfig = (window as any).ptahConfig;
    const initialView = ptahConfig?.initialView as ViewType | null;

    // Use configured initial view or default to 'chat'
    const targetView: ViewType = initialView || 'chat';
    console.log(`Initial view target: ${targetView}`, {
      fromConfig: !!initialView,
    });

    const success = await this.navigationService.navigateToView(targetView);
    if (!success) {
      console.warn(
        `Initial navigation to ${targetView} failed, using fallback`
      );
      this.appState.setCurrentView(targetView);
    }
  }
}
