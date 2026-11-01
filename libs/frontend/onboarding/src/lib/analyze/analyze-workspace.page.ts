import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { LucideAngularModule, Play, ScanSearch } from 'lucide-angular';
import {
  ConfirmationModalComponent,
  SetupWizardStateService,
  WizardAnalysisRunner,
  WizardRpcService,
  safeFailureCopy,
  type GenerationViewState,
} from '@ptah-extension/setup-wizard';
import { DetailsLogComponent } from '../shared/details-log.component';
import { RunPanelComponent } from '../shared/run-panel.component';
import { onboardingStepLink } from '../shell/onboarding-step-link';
import { AnalysisStepStore } from './analysis-step.store';
import { PhaseListComponent } from './phase-list.component';

@Component({
  selector: 'ptah-analyze-workspace-page',
  standalone: true,
  imports: [
    ConfirmationModalComponent,
    DatePipe,
    DetailsLogComponent,
    RunPanelComponent,
    PhaseListComponent,
    LucideAngularModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section
      class="mx-auto max-w-[760px] space-y-5 p-4"
      aria-labelledby="analyze-workspace-title"
      data-testid="analyze-workspace"
    >
      <header class="flex items-center gap-3">
        <span
          class="rounded-xl border border-base-300 p-2"
          data-glass-surface="tile"
          ><lucide-angular [img]="icons.scan" class="size-6" aria-hidden="true"
        /></span>
        <div>
          <h1 id="analyze-workspace-title" class="text-2xl font-semibold">
            Analyze workspace
          </h1>
          <p class="text-sm text-base-content-muted">
            Understand this project before choosing agents.
          </p>
        </div>
      </header>

      @if (stopRecovery()) {
        <ptah-run-panel
          state="cancelling"
          [viewState]="viewState()"
          title="Stopping analysis"
          message="The stop could not be confirmed. The analysis may still be running."
          (retry)="retry()"
          (startOver)="startFresh()"
        />
      } @else if (runner.isRunning()) {
        <ptah-run-panel
          state="running"
          [viewState]="viewState()"
          title="Analyzing workspace"
          [message]="runner.statusText()"
          (stop)="confirmStop()"
        >
          @if (store.phaseHeader(); as header) {
            <p class="mt-3 text-sm" data-testid="phase-header">
              Phase {{ header.current }} of {{ header.total }}
            </p>
          }
          <ptah-phase-list [phases]="store.phaseRows()" />
          @if (elapsedSeconds() !== null) {
            <p class="mt-3 text-xs text-base-content-muted">
              {{ elapsedSeconds() }}s since you opened this page
            </p>
          }
        </ptah-run-panel>
        <ptah-details-log
          mode="analysis"
          [streamCounts]="store.streamCounts()"
        />
      } @else if (runner.isCanceling()) {
        <ptah-run-panel
          state="cancelling"
          [viewState]="viewState()"
          title="Stopping analysis"
          message="Waiting for the run to stop."
        />
      } @else if (runner.errorMessage(); as rawError) {
        <ptah-run-panel
          state="failed"
          [viewState]="viewState()"
          title="Analysis failed"
          [message]="safeError(rawError)"
          (retry)="retry()"
          (startOver)="startFresh()"
        />
        <p class="text-sm text-base-content-muted">
          The analysis may still be running if the connection was lost. Retry
          can continue the saved run.
        </p>
      } @else if (store.loaded(); as result) {
        <ptah-run-panel
          state="done"
          [viewState]="viewState()"
          title="Analysis complete"
          continueLabel="Choose agents"
          [message]="
            'Completed in ' + duration(result.manifest.totalDurationMs)
          "
          (continueRun)="chooseAgents()"
        >
          <ptah-phase-list [phases]="store.phaseRows()" />
        </ptah-run-panel>
        <section
          class="space-y-2 rounded-[22px] border border-base-300 p-5"
          data-glass-surface="content"
        >
          <h2 class="font-semibold">Phase details</h2>
          @for (phase of store.phaseRows(); track phase.id) {
            <details
              class="rounded-[10px] border border-base-300 p-3"
              data-glass-surface="tile"
            >
              <summary class="cursor-pointer">
                {{ phase.label }} · {{ phase.status }}
              </summary>
              <pre class="mt-3 whitespace-pre-wrap break-words text-sm">{{
                result.phaseContents[phase.id]
              }}</pre>
            </details>
          }
          <button
            type="button"
            class="btn btn-sm"
            (click)="manualAdjust.show()"
          >
            Manual adjust
          </button>
        </section>
      } @else if (interrupted()) {
        <section
          class="rounded-[22px] border border-base-300 p-5"
          data-glass-surface="content"
        >
          <h2 class="text-lg font-semibold">Interrupted analysis</h2>
          <p class="mt-1 text-sm text-base-content-muted">
            An unfinished run is available.
          </p>
          <div class="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              class="btn btn-primary btn-sm"
              (click)="continuePrevious()"
            >
              Continue previous run
            </button>
            <button type="button" class="btn btn-sm" (click)="startFresh()">
              Start fresh
            </button>
          </div>
        </section>
      } @else {
        <section
          class="rounded-[22px] border border-base-300 p-5"
          data-glass-surface="content"
        >
          <h2 class="text-lg font-semibold">Start a workspace analysis</h2>
          <p class="mt-1 text-sm text-base-content-muted">
            Review the project structure, architecture, and quality.
          </p>
          <button
            type="button"
            class="btn btn-primary mt-4"
            (click)="startFresh()"
          >
            <lucide-angular
              [img]="icons.play"
              class="size-4"
              aria-hidden="true"
            />Start analysis
          </button>
        </section>
      }

      @if (savedError() || visibleSaved().length || selectError()) {
        <section
          class="rounded-[22px] border border-base-300 p-5"
          data-glass-surface="content"
        >
          <h2 class="text-lg font-semibold">Saved analyses</h2>
          @if (savedError()) {
            <p class="text-sm text-state-err" role="alert">
              Saved analyses could not be loaded. Try again.
            </p>
            <button type="button" class="btn btn-sm" (click)="loadSaved()">
              Retry
            </button>
          }
          <ul class="mt-3 space-y-2">
            @for (item of visibleSaved(); track item.filename) {
              <li
                class="flex flex-wrap items-center gap-3 rounded-[10px] border border-base-300 p-3"
                data-glass-surface="tile"
              >
                <div class="min-w-0 w-full min-[720px]:flex-1">
                  <p class="font-medium">{{ item.projectType }}</p>
                  <p class="text-xs text-base-content-muted">
                    {{ item.savedAt | date: 'medium' }} ·
                    {{ duration(item.durationMs) }}
                  </p>
                </div>
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  (click)="useSaved(item.filename)"
                >
                  Use
                </button>
                <button
                  type="button"
                  class="btn btn-sm"
                  (click)="store.hideAnalysis(item.filename)"
                >
                  Hide from list
                </button>
              </li>
            }
          </ul>
          @if (selectError()) {
            <p class="mt-2 text-sm text-state-err" role="alert">
              {{ selectError() }}
            </p>
          }
        </section>
      }
      <ptah-confirmation-modal
        #stopModal
        title="Stop analysis?"
        message="You can continue an unfinished analysis later."
        confirmText="Stop analysis"
        confirmClass="btn-error"
        (confirmed)="stop()"
      />
      <ptah-confirmation-modal
        #manualAdjust
        title="Manual adjust"
        message="Manual adjustments are coming soon."
        mode="alert"
        confirmText="OK"
      />
    </section>
  `,
})
export class AnalyzeWorkspacePage implements OnInit, OnDestroy {
  readonly analysis = input<string | undefined>();
  protected readonly store = inject(AnalysisStepStore);
  protected readonly runner = inject(WizardAnalysisRunner);
  private readonly rpc = inject(WizardRpcService);
  private readonly wizardState = inject(SetupWizardStateService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private destroyed = false;
  private pendingAnalysis: string | null = null;
  protected readonly stopModal =
    viewChild.required<ConfirmationModalComponent>('stopModal');
  protected readonly manualAdjust =
    viewChild.required<ConfirmationModalComponent>('manualAdjust');
  protected readonly interrupted = signal(false);
  protected readonly savedError = signal(false);
  protected readonly visibleSaved = computed(() =>
    this.store
      .saved()
      .filter((item) => !this.store.hidden().has(item.filename)),
  );
  protected readonly selectError = signal<string | null>(null);
  protected readonly stopRecovery = signal(false);
  // Analysis has no workflow view state; map its runner status for RunPanel recovery.
  protected readonly viewState = computed<GenerationViewState>(() =>
    this.stopRecovery()
      ? 'stop-unconfirmed'
      : this.runner.isCanceling()
        ? 'cancelling'
        : this.runner.isRunning()
          ? 'running'
          : this.runner.errorMessage()
            ? 'failed'
            : this.store.loaded()
              ? 'completed'
              : 'idle',
  );
  private readonly openedAt = signal<number | null>(null);
  private readonly now = signal(Date.now());
  private timer: ReturnType<typeof setInterval> | null = null;
  protected readonly elapsedSeconds = computed(() =>
    this.openedAt() === null
      ? null
      : Math.max(0, Math.floor((this.now() - this.openedAt()!) / 1000)),
  );
  protected readonly icons = { scan: ScanSearch, play: Play } as const;
  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
    });
  }
  async ngOnInit(): Promise<void> {
    this.pendingAnalysis = this.analysis() ?? null;
    await this.loadSaved();
    if (this.destroyed) return;
    const resumable = await this.rpc.getResumableRun();
    if (this.destroyed) return;
    this.interrupted.set(
      resumable.analysis !== null &&
        resumable.analysis?.manifest.lifecycle !== 'completed',
    );
  }
  ngOnDestroy(): void {
    this.store.detachStream();
    this.stopClock();
  }
  protected safeError(raw: string): string {
    return safeFailureCopy(raw, 'Analysis could not finish. Try again.');
  }
  protected duration(ms: number): string {
    return `${Math.round(ms / 1000)}s`;
  }
  protected async loadSaved(): Promise<void> {
    try {
      await this.store.listAnalyses();
    } catch {
      // degradation-audit: reported — savedError displays the saved-analyses load failure.
      if (!this.destroyed) this.savedError.set(true);
      return;
    }
    if (this.destroyed) return;
    this.savedError.set(false);
    const filename = this.pendingAnalysis;
    this.pendingAnalysis = null;
    if (
      filename &&
      this.store.saved().some((item) => item.filename === filename)
    )
      await this.useSaved(filename);
  }
  protected async useSaved(filename: string): Promise<void> {
    try {
      const result = await this.store.selectAnalysis(filename);
      if (this.destroyed) return;
      this.selectError.set(
        result === 'loaded'
          ? null
          : result === 'not-found'
            ? 'That analysis is no longer available.'
            : 'The analysis could not be loaded. Try again.',
      );
      if (result === 'loaded')
        await this.router.navigate([], {
          queryParams: { analysis: filename },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
    } catch {
      if (!this.destroyed)
        this.selectError.set('The analysis could not be loaded. Try again.');
    }
  }
  protected async startFresh(): Promise<void> {
    this.pendingAnalysis = null;
    this.wizardState.reset();
    this.runner.reset();
    this.stopRecovery.set(false);
    this.store.clearSelection();
    this.interrupted.set(false);
    this.startClock();
    await this.runner.startFreshAnalysis();
    if (this.destroyed) return;
    await this.loadSaved();
  }
  protected async continuePrevious(): Promise<void> {
    this.pendingAnalysis = null;
    this.store.clearSelection();
    this.interrupted.set(false);
    this.stopRecovery.set(false);
    this.startClock();
    await this.runner.resumeAnalysis();
    await this.loadSaved();
  }
  protected async retry(): Promise<void> {
    await this.continuePrevious();
  }
  protected confirmStop(): void {
    this.stopModal().show();
  }
  protected async stop(): Promise<void> {
    try {
      await this.runner.cancel();
      this.stopRecovery.set(false);
    } catch {
      this.stopRecovery.set(true);
    } finally {
      this.store.detachStream();
      this.stopClock();
    }
  }
  private startClock(): void {
    const startedAt = Date.now();
    this.store.attachStream();
    this.now.set(startedAt);
    this.openedAt.set(startedAt);
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (this.runner.isRunning() || this.runner.isCanceling())
        this.now.set(Date.now());
      else this.stopClock();
    }, 1000);
  }
  private stopClock(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.openedAt.set(null);
  }
  protected async chooseAgents(): Promise<void> {
    const identity = {
      analysis: this.store.selected() ?? this.store.loaded()?.manifest.slug,
    };
    const link = onboardingStepLink('analyze', 'agents', identity);
    await this.router.navigate([...link.commands], {
      queryParams: link.queryParams,
      state: { explicitBack: false },
    });
  }
}
