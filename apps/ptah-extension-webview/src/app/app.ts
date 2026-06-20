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

import {
  AppStateManager,
  VSCodeService,
  WebviewNavigationService,
  ViewType,
} from '@ptah-extension/core';

import {
  AppShellComponent,
  ElectronShellComponent,
  UpdateBannerComponent,
} from '@ptah-extension/chat';
import { StreamRouter } from '@ptah-extension/chat-routing';

@Component({
  selector: 'ptah-root',
  imports: [
    AppShellComponent,
    ElectronShellComponent,
    UpdateBannerComponent,
    LucideAngularModule,
  ],
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
})
export class App implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();

  /** Lucide icon reference for template binding */
  protected readonly AlertCircleIcon = AlertCircle;

  public readonly appState = inject(AppStateManager);
  public readonly vscodeService = inject(VSCodeService);
  private readonly navigationService = inject(WebviewNavigationService);
  private readonly _streamRouter = inject(StreamRouter);
  public readonly isElectron = signal(this.vscodeService.isElectron);
  private readonly initializationStatus = signal<
    'idle' | 'initializing' | 'ready' | 'error'
  >('idle');
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
    const success = await this.navigationService.navigateToView(view);

    if (!success) {
      console.error(`Ptah App - Navigation to ${view} failed`);
      this.appState.handleError(`Failed to navigate to ${view}`);
    }
  }

  private async handleInitialView(): Promise<void> {
    const ptahConfig = (
      window as unknown as { ptahConfig?: { initialView?: string } }
    ).ptahConfig;
    const rawInitialView = ptahConfig?.initialView;
    const VALID_VIEWS: ViewType[] = [
      'chat',
      'command-builder',
      'analytics',
      'context-tree',
      'settings',
      'setup-wizard',
      'welcome',
      'orchestra-canvas',
      'tribunal',
    ];
    const isValidView =
      rawInitialView && VALID_VIEWS.includes(rawInitialView as ViewType);
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
