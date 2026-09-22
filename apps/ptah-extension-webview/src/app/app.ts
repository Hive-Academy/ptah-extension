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
import { LucideAngularModule, AlertCircle } from 'lucide-angular';

import {
  AppStateManager,
  BootStatusService,
  SurfaceRouterService,
  surfaceNavigationLanded,
  VSCodeService,
} from '@ptah-extension/core';

import {
  AppShellComponent,
  ElectronShellComponent,
  UpdateDialogComponent,
} from '@ptah-extension/chat';
import { BootProgressComponent } from '@ptah-extension/chat-ui';
import { StreamRouter } from '@ptah-extension/chat-routing';

@Component({
  selector: 'ptah-root',
  imports: [
    AppShellComponent,
    ElectronShellComponent,
    UpdateDialogComponent,
    BootProgressComponent,
    LucideAngularModule,
  ],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./app.css'],
})
export class App implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();

  /** Lucide icon reference for template binding */
  protected readonly AlertCircleIcon = AlertCircle;

  public readonly appState = inject(AppStateManager);
  public readonly vscodeService = inject(VSCodeService);
  /**
   * Boot progress. Defaults to `ready`, so under VS Code — which never
   * receives `boot:readinessChanged` — every branch below behaves exactly as
   * it did before this service existed.
   */
  public readonly bootStatus = inject(BootStatusService);
  private readonly surfaceRouter = inject(SurfaceRouterService);
  private readonly _streamRouter = inject(StreamRouter);
  public readonly isElectron = signal(this.vscodeService.isElectron);
  private readonly initializationStatus = signal<
    'idle' | 'initializing' | 'ready' | 'error'
  >('idle');
  public readonly isReady = computed(() => {
    return this.initializationStatus() === 'ready';
  });

  public readonly hasError = computed(
    () =>
      this.initializationStatus() === 'error' || this.bootStatus.hasFailed(),
  );

  /**
   * The error branch's message. A failed boot is a real, specific failure the
   * host already described, so its `detail` is shown rather than the generic
   * "please refresh" line.
   */
  public readonly errorMessage = computed(() =>
    this.bootStatus.hasFailed()
      ? (this.bootStatus.detail() ??
        'The desktop backend failed to start. Please restart Ptah.')
      : 'Failed to initialize the application. Please try refreshing.',
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

  /**
   * The application's ONE initial navigation.
   *
   * `provideRouter` runs with `withDisabledInitialNavigation()`, so nothing has
   * navigated when this is called — that is deliberate. Without it the Router
   * resolves the empty URL first and a panel opened on `setup-wizard` paints
   * chat before it, which is a visible flash on a surface the user is waiting
   * for.
   *
   * **Window augmentation.** The host injects the deep link before Angular
   * bootstraps: `panel.webview.html` carries `ptahConfig.initialView`, and
   * `window.initialView` is the DevTools override for the same thing (set it in
   * the console before bootstrap to force a surface). This is the only place
   * either is read — `AppStateManager.initializeState` used to read them too,
   * and the two paths could disagree.
   *
   * There is no allow-list here any more. `normalizeInitialView` validates
   * against `SURFACE_ROUTE_IDS`, the same list `app.routes.ts` is built from,
   * so an unknown or missing value falls back to `chat` and the route table is
   * the only thing that has to be kept in step.
   */
  private async handleInitialView(): Promise<void> {
    const hostWindow = window as unknown as {
      initialView?: string;
      ptahConfig?: { initialView?: string };
    };
    const rawInitialView =
      hostWindow.initialView ?? hostWindow.ptahConfig?.initialView;
    const targetView = this.appState.normalizeInitialView(rawInitialView);

    const result = await this.surfaceRouter.navigateToSurface(targetView);
    if (!surfaceNavigationLanded(result)) {
      // `already-there` is a success, so it is not reported: nothing has
      // navigated yet under `withDisabledInitialNavigation()`, but a route
      // whose path equals the Router's starting URL would legitimately skip.
      console.warn(
        `Initial navigation to ${targetView} did not land: ${result}`,
      );
    }
  }
}
