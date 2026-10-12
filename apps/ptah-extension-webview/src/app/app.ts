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
  VSCodeService,
} from '@ptah-extension/core';

import {
  AppShellComponent,
  ElectronShellComponent,
  UpdateDialogComponent,
} from '@ptah-extension/chat';
import { BootProgressComponent } from '@ptah-extension/chat-ui';
import { StreamRouter } from '@ptah-extension/chat-routing';

import { injectInitialNavigation } from './initial-navigation';

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
  private readonly runInitialNavigation = injectInitialNavigation();
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
   * The application's ONE initial navigation: the host deep link, the saved
   * route or `chat`, by decision D5. See `injectInitialNavigation`.
   */
  private async handleInitialView(): Promise<void> {
    await this.runInitialNavigation();
  }
}
