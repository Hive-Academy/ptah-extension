import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  computed,
  inject,
} from '@angular/core';
import { Subject } from 'rxjs';
import { LucideAngularModule, AlertCircle } from 'lucide-angular';

// UPDATED: Import from @ptah-extension/core library
import {
  AppStateManager,
  VSCodeService,
  WebviewNavigationService,
  ViewType,
  // ProviderService, // DELETED - provider library removed in Phase 0
} from '@ptah-extension/core';

// UPDATED: Import components from libraries
import {
  AppShellComponent,
  ElectronShellComponent,
} from '@ptah-extension/chat';

@Component({
  selector: 'ptah-root',
  imports: [AppShellComponent, ElectronShellComponent, LucideAngularModule],
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
})
export class App implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();

  /** Lucide icon reference for template binding */
  protected readonly AlertCircleIcon = AlertCircle;

  // ANGULAR 20 PATTERN: Use inject() instead of constructor injection
  public readonly appState = inject(AppStateManager);
  public readonly vscodeService = inject(VSCodeService);
  private readonly navigationService = inject(WebviewNavigationService);
  // private readonly providerService = inject(ProviderService); // DELETED - provider library removed in Phase 0
  // REMOVED: Router injection - using pure signal-based navigation

  // Platform detection: Electron desktop vs VS Code webview (set once at bootstrap, never changes)
  public readonly isElectron = signal(this.vscodeService.isElectron);

  // ANGULAR 20 PATTERN: Signal-based state for reactive UI
  private readonly initializationStatus = signal<
    'idle' | 'initializing' | 'ready' | 'error'
  >('idle');

  // ANGULAR 20 PATTERN: Computed signals for derived state
  public readonly isReady = computed(() => {
    return this.initializationStatus() === 'ready';
  });

  public readonly hasError = computed(
    () => this.initializationStatus() === 'error',
  );
  public readonly isInitializing = computed(
    () => this.initializationStatus() === 'initializing',
  );

  public async ngOnInit(): Promise<void> {
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
    this.destroy$.next();
    this.destroy$.complete();
    this.appState.setConnected(false);
  }

  public async onViewChanged(view: ViewType): Promise<void> {
    // Use navigation service for reliable navigation
    const success = await this.navigationService.navigateToView(view);

    if (!success) {
      console.error(`Ptah App - Navigation to ${view} failed`);
      // Show user-friendly error message
      this.appState.handleError(`Failed to navigate to ${view}`);
    }
  }

  // REMOVED: setupRouterLogging - no longer using Angular Router

  private async handleInitialView(): Promise<void> {
    // Check for initialView in ptahConfig (set by extension for specific views like wizard)
    const ptahConfig = (
      window as unknown as { ptahConfig?: { initialView?: string } }
    ).ptahConfig;
    const rawInitialView = ptahConfig?.initialView;

    // CRITICAL: Validate initialView at runtime with graceful degradation
    // TASK_2025_126: Added 'welcome' for embedded welcome page
    const VALID_VIEWS: ViewType[] = [
      'chat',
      'command-builder',
      'analytics',
      'context-tree',
      'settings',
      'setup-wizard',
      'welcome',
      'orchestra-canvas',
    ];
    const isValidView =
      rawInitialView && VALID_VIEWS.includes(rawInitialView as ViewType);

    // Use configured initial view if valid, otherwise default to 'chat'
    const targetView: ViewType = isValidView
      ? (rawInitialView as ViewType)
      : 'chat';

    if (rawInitialView && !isValidView) {
      console.warn(
        `Invalid initialView "${rawInitialView}" in ptahConfig. Valid values are: ${VALID_VIEWS.join(
          ', ',
        )}. Defaulting to 'chat'.`,
      );
    }

    const success = await this.navigationService.navigateToView(targetView);
    if (!success) {
      console.warn(
        `Initial navigation to ${targetView} failed, using fallback`,
      );
      this.appState.setCurrentView(targetView);
    }
  }
}
