import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TabManagerService } from '@ptah-extension/chat-state';
import { GenerationWorkflowLauncherService } from '@ptah-extension/chat-ui';
import { VSCodeService } from '@ptah-extension/core';
import type { EnhancedPromptsDetectedStack, SetupGenerationTabBinding } from '@ptah-extension/shared';
import { GenerationHandoffStore, GenerationWorkflowStore, GuidanceGenerationStore, GuidanceResultPanelComponent, WizardRpcService, findBoundGenerationTab, safeFailureCopy } from '@ptah-extension/setup-wizard';
import { DetailsLogComponent } from '../shared/details-log.component';
import { OnboardingStepperComponent, type OnboardingStep } from '../shared/onboarding-stepper.component';
import { RecoveryScreenComponent, type OnboardingRecoveryReason } from '../shared/recovery-screen.component';
import { RunPanelComponent } from '../shared/run-panel.component';
import { chipStateFor } from '../shared/run-status-chip.component';
import { onboardingStepLink } from '../shell/onboarding-step-link';
import { GenerationStepStore } from './generation-step.store';

@Component({
  selector: 'ptah-project-guidance-page', standalone: true,
  imports: [DetailsLogComponent, GuidanceResultPanelComponent, OnboardingStepperComponent, RecoveryScreenComponent, RunPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush, host: { class: 'block' },
  styles: [`:host ::ng-deep [data-testid="guidance-saved-card"] > ptah-guidance-result-panel > section { border: 0; background: transparent; padding: 0; }
    :host ::ng-deep ptah-run-panel button.btn-sm, :host ::ng-deep [data-testid="guidance-saved-card"] button.btn-sm { min-height: 36px; }
    :host ::ng-deep [data-testid="guidance-saved-card"] button.btn-ghost { margin-top: 12px; }`],
  template: `
    <section class="mx-auto max-w-[760px] space-y-5 p-4" aria-labelledby="project-guidance-title" data-testid="project-guidance-page">
      <header><h1 id="project-guidance-title" tabindex="-1" class="text-2xl font-semibold">Project guidance</h1>
        <p class="text-sm text-base-content-muted">Build guidance for this workspace and choose when to use it.</p></header>
      <ptah-onboarding-stepper [steps]="steps()" />
      @if (recovery() || workflow.runMismatch()) {
        <div data-testid="guidance-recovery-panel"><ptah-recovery-screen [reason]="workflow.runMismatch() ? 'stale-run' : recovery()!" (primary)="openLatest()" /></div>
      } @else if (workflow.lookupExhausted()) {
        <section class="rounded-[22px] border border-state-err/70 p-5" role="alert" data-testid="guidance-lookup-exhausted">
          <h2 class="font-semibold">Run state is unavailable</h2><p>We could not confirm this run. Try the lookup again.</p>
          <button type="button" class="btn btn-primary btn-sm mt-3 min-h-9" (click)="refresh()">Retry</button>
        </section>
      } @else if (lookupError()) {
        <section class="rounded-[22px] border border-state-err/70 p-5" role="alert" data-testid="guidance-lookup-error">
          <h2 class="font-semibold">Run state is unavailable</h2><p>We could not check the current guidance run.</p>
          <button type="button" class="btn btn-primary btn-sm mt-3 min-h-9" (click)="retryLookup()">Retry</button>
        </section>
      } @else {
        <div data-testid="guidance-state-chip" [attr.data-state]="workflow.state()">
          <ptah-run-panel [state]="panelState()" [viewState]="workflow.state()" [title]="runTitle()" [message]="runMessage()"
            continueLabel="Continue" (stop)="workflow.stop()" (retry)="retry()" (startOver)="retry()"
            (continueRun)="continueDone()" (resumeRequested)="retry()">
            @if (workflow.state() === 'starting') { <button type="button" class="btn btn-sm min-h-8 mt-3" (click)="workflow.stop()">Stop</button> }
            @if (workflow.state() === 'idle' && !lookupPending() && !handoff.inFlight() && !handoff.pending()) { <button type="button" class="btn btn-primary min-h-8 mt-3" data-testid="guidance-start" (click)="start()">Start guidance</button> }
          </ptah-run-panel>
        </div>
        @if (workflow.rejection()?.reason === 'blocked') {
          <section class="flex flex-col gap-3 rounded-[14px] border border-state-err/70 p-4 text-sm sm:flex-row sm:items-center" role="status" data-testid="guidance-owner-conflict">
            <p class="min-w-0 flex-1 text-state-need"><strong>Another run is active.</strong> Open the active run before starting another.</p>
            <div class="flex flex-wrap gap-2"><button type="button" class="btn btn-sm min-h-9" (click)="openOwner()">Open it</button>
              <button type="button" class="btn btn-sm min-h-9" (click)="refresh()">Check again</button></div>
          </section>
        }
        @if (detectedStack(); as stack) {
          <section class="rounded-[22px] border border-base-300 p-5" data-glass-surface="content" data-testid="guidance-detected-stack">
            <h2 class="font-semibold">Detected stack</h2><p class="text-sm">{{ stack.projectType }}</p>
            @if (stack.languages.length) { <p class="text-sm">Languages: {{ stack.languages.join(', ') }}</p> }
            @if (stack.frameworks.length) { <p class="text-sm">Frameworks: {{ stack.frameworks.join(', ') }}</p> }
            @if (stack.buildTools.length) { <p class="text-sm">Build tools: {{ stack.buildTools.join(', ') }}</p> }
            @if (stack.testingFrameworks.length) { <p class="text-sm">Testing: {{ stack.testingFrameworks.join(', ') }}</p> }
          </section>
        }
        @if (sections(); as summary) {
          <section class="rounded-[22px] border border-base-300 p-5" data-glass-surface="content" data-testid="guidance-summary-card">
            <h2 class="font-semibold">Generated guidance</h2>
            <ul class="mt-3 space-y-2">@for (section of summary.sections; track section.name) {
              <li class="flex justify-between gap-3 rounded-[10px] border border-base-300 p-3 text-sm" data-testid="guidance-summary-row">
                <span>{{ section.name }}</span><span>{{ section.wordCount }} words</span>
              </li>
            }</ul>
            <p class="mt-3 text-sm">{{ generatedCount() }} of 4 sections generated</p>
          </section>
        }
        @if (guidance.run()?.committedState === 'unchanged' && workflow.state() === 'completed') {
          <p role="status" data-testid="guidance-unchanged">Saved guidance was already current; nothing needed changing.</p>
        }
        <section class="rounded-[22px] border border-base-300 p-5" data-glass-surface="content" data-testid="guidance-saved-card">
          <ptah-guidance-result-panel [result]="guidance.result()" [runActive]="workflow.isBound()" [showSkip]="true"
            (enabledChanged)="setEnabled($event)" (cacheRequested)="refreshSaved()" (contentRequested)="loadContent()"
            (downloadRequested)="download()" (regenerateRequested)="retry()" (skipRequested)="skip()" />
        </section>
        @if (guidance.content(); as content) { <section class="rounded-[22px] border border-base-300 p-5" data-testid="guidance-content"><h2 class="font-semibold">Saved guidance content</h2><pre class="whitespace-pre-wrap break-words text-sm">{{ content }}</pre></section> }
        @if (guidance.actionFailed()) { <p role="alert">The guidance action could not be completed. Try again.</p> }
        @if (!standalone()) { <button type="button" class="btn btn-ghost min-h-9 mt-3" data-testid="guidance-skip" (click)="skip()">Skip to Done</button> }
        @if (binding(); as bound) { <ptah-details-log mode="tab" [tabId]="bound.tabId" /> }
      }
    </section>
  `,
})
export class ProjectGuidancePage implements OnInit {
  protected readonly workflow = inject(GenerationWorkflowStore);
  protected readonly guidance = inject(GuidanceGenerationStore);
  protected readonly handoff = inject(GenerationHandoffStore);
  private readonly step = inject(GenerationStepStore);
  private readonly rpc = inject(WizardRpcService);
  private readonly tabs = inject(TabManagerService);
  private readonly vscode = inject(VSCodeService);
  private readonly launcher = inject(GenerationWorkflowLauncherService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private destroyed = false;
  private autoStartedTab: string | null = null;
  private boundRunId: string | null = null;
  protected readonly binding = signal<SetupGenerationTabBinding | null>(null);
  protected readonly recovery = signal<OnboardingRecoveryReason | null>(null);
  protected readonly lookupError = signal(false);
  protected readonly lookupPending = signal(true);
  protected readonly detectedStack = signal<EnhancedPromptsDetectedStack | null>(null);
  protected readonly standalone = computed(() => this.route.snapshot.data['standalone'] === true);
  protected readonly panelState = computed(() => this.workflow.state() === 'cancelled' ? 'failed' : chipStateFor(this.workflow.state()));
  protected readonly runTitle = computed(() => ({ idle: 'Ready to create guidance', starting: 'Starting guidance', running: 'Creating guidance', quiet: 'Checking run state', cancelling: 'Stopping guidance', 'stop-unconfirmed': 'Checking stop', 'stop-unknown': 'Checking run state', completed: 'Guidance ready', cancelled: 'Guidance stopped', failed: 'Guidance failed', 'timed-out': 'Guidance timed out' }[this.workflow.state()]));
  protected readonly runMessage = computed(() => {
    const state = this.workflow.state();
    const reason = this.workflow.startError();
    if (state === 'failed') return safeFailureCopy(reason, 'Guidance failed. Retry the run or start over.');
    if (state === 'timed-out') return safeFailureCopy(reason ?? 'timed out', 'Guidance timed out. Retry the run.');
    if (state === 'cancelled') return 'Guidance stopped. You can try again.';
    if (state === 'cancelling' || state === 'stop-unconfirmed' || state === 'stop-unknown') return 'Stopping guidance. Check its status before starting another run.';
    if (reason) return safeFailureCopy(reason, 'Guidance could not start. Try again.');
    if (state === 'idle') return 'Start when you are ready.';
    return state === 'completed' ? 'Your saved guidance is ready to use.' : 'The run continues in its bound session.';
  });
  protected readonly sections = computed(() => {
    const binding = this.binding();
    const run = this.guidance.run();
    const saved = this.guidance.result();
    if (!binding || !run || this.workflow.state() !== 'completed' || run.status !== 'completed' || (run.committedState ?? run.result?.committedState) !== 'committed' || !saved?.enabled || !this.workflow.run() || this.workflow.run()?.binding.runId !== run.binding.runId) return null;
    return this.step.guidanceSections(binding.workspacePath, run.binding.runId, saved.generatedAt);
  });
  protected readonly generatedCount = computed(() => this.sections()?.sections.filter((section) => section.generated).length ?? 0);
  protected readonly steps = computed<readonly OnboardingStep[]>(() => this.standalone() ? [
    { id: 'guidance', label: 'Project guidance', state: 'current' }, { id: 'done', label: 'Done', state: 'upcoming' },
  ] : [
    { id: 'analyze', label: 'Analyze', state: 'completed' }, { id: 'agents', label: 'Choose agents', state: 'completed' },
    { id: 'generate', label: 'Generate agents', state: 'completed', link: onboardingStepLink('guidance', 'generate', this.route.snapshot.queryParams) },
    { id: 'guidance', label: 'Project guidance', state: 'current' }, { id: 'done', label: 'Done', state: 'upcoming' },
  ]);

  constructor() {
    this.destroyRef.onDestroy(() => { this.destroyed = true; });
    effect(() => {
      const run = this.workflow.run();
      if (run?.binding.workflow === 'setup-project-prompt') this.guidance.adopt(run);
    });
    effect(() => {
      const started = this.handoff.started();
      const binding = this.binding();
      if (!started || !binding || this.lookupPending() || this.boundRunId || this.destroyed ||
        started.tabId !== binding.tabId || started.workspacePath !== binding.workspacePath) return;
      void this.bindLateHandoff(binding, started.runId);
    });
  }

  async ngOnInit(): Promise<void> {
    const tabId = this.route.snapshot.queryParamMap.get('tab');
    const workspacePath = this.tabs.activeWorkspacePath || this.vscode.config().workspaceRoot;
    if (!workspacePath) { this.recovery.set('workspace-mismatch'); return; }
    const binding: SetupGenerationTabBinding = { tabId: tabId ?? '', workspacePath, workflow: 'setup-project-prompt' };
    if (!tabId || !findBoundGenerationTab(this.tabs, binding)) { this.recovery.set('missing-tab'); return; }
    this.binding.set(binding);
    await this.bindRunSequence(binding);
    if (this.destroyed) return;
  }
  private async bindRunSequence(binding: SetupGenerationTabBinding): Promise<void> {
    this.lookupPending.set(true);
    this.lookupError.set(false);
    // URL identity wins, then a handoff started for this tab, then the host's latest run.
    let runId = this.route.snapshot.queryParamMap.get('run');
    const started = this.handoff.started();
    if (!runId && started?.tabId === binding.tabId && started.workspacePath === binding.workspacePath) runId = started.runId;
    if (!runId) {
      try { runId = (await this.rpc.getBoundRunState(binding))?.binding.runId ?? null; }
      catch { if (!this.destroyed) { this.lookupError.set(true); this.lookupPending.set(false); } return; }
      if (this.destroyed) return;
      const late = this.handoff.started();
      if (late?.tabId === binding.tabId && late.workspacePath === binding.workspacePath) runId = late.runId;
    }
    const result = this.step.bindGuidance(binding, runId ?? undefined);
    if (result !== 'bound') { this.recovery.set(result === 'workspace-mismatch' ? 'workspace-mismatch' : 'foreign-tab'); this.lookupPending.set(false); return; }
    this.boundRunId = runId;
    this.lookupPending.set(false);
    await this.workflow.refresh();
    if (this.destroyed) return;
    await this.guidance.refreshCommitted();
    if (this.destroyed) return;
    await this.refreshStatus();
    if (this.destroyed) return;
    if (runId && !this.route.snapshot.queryParamMap.get('run')) { await this.router.navigate([], { queryParams: { ...this.route.snapshot.queryParams, run: runId }, replaceUrl: true }); if (this.destroyed) return; }
    if (this.destroyed) return;
    // An idle handoff can already be inside manualContinue: only a pending
    // countdown is proof that this page may start it.
    const pending = this.handoff.pending();
    if (!runId && pending?.agentTabId === this.route.snapshot.queryParamMap.get('gen') &&
      this.handoff.outcome() !== 'manual-recovery' && this.autoStartedTab !== binding.tabId) {
      this.autoStartedTab = binding.tabId;
      await this.handoff.startNow();
      if (this.destroyed) return;
      const accepted = this.handoff.started();
      if (accepted?.tabId === binding.tabId && accepted.workspacePath === binding.workspacePath) {
        this.boundRunId = accepted.runId;
        this.workflow.bind(binding, accepted.runId);
        await this.workflow.refresh();
        if (this.destroyed) return;
        await this.router.navigate([], { queryParams: { ...this.route.snapshot.queryParams, run: accepted.runId }, replaceUrl: true });
        if (this.destroyed) return;
      }
    }
  }
  private async bindLateHandoff(binding: SetupGenerationTabBinding, runId: string): Promise<void> {
    const result = this.step.bindGuidance(binding, runId);
    if (result !== 'bound') { this.recovery.set(result === 'workspace-mismatch' ? 'workspace-mismatch' : 'foreign-tab'); return; }
    this.boundRunId = runId;
    this.lookupError.set(false);
    await this.workflow.refresh();
    if (this.destroyed) return;
    await this.guidance.refreshCommitted();
    if (this.destroyed) return;
    await this.refreshStatus();
    if (this.destroyed) return;
    await this.router.navigate([], { queryParams: { ...this.route.snapshot.queryParams, run: runId }, replaceUrl: true });
    if (this.destroyed) return;
  }
  protected async retryLookup(): Promise<void> {
    const binding = this.binding();
    if (binding) { await this.bindRunSequence(binding); if (this.destroyed) return; }
  }
  private async refreshStatus(): Promise<void> {
    const binding = this.binding();
    if (!binding) return;
    try {
      const status = await this.rpc.getEnhancedPromptsStatus(binding.workspacePath);
      if (!this.destroyed && this.binding()?.tabId === binding.tabId && !status.error) this.detectedStack.set(status.detectedStack);
    } catch { /* The saved result panel presents status failures. */ }
  }
  protected async refresh(): Promise<void> { await this.workflow.refresh(); if (this.destroyed) return; await this.guidance.refresh(); if (this.destroyed) return; await this.refreshStatus(); if (this.destroyed) return; }
  protected async openLatest(): Promise<void> {
    const binding = this.binding();
    if (!binding) { await this.router.navigate(['/onboarding']); if (this.destroyed) return; return; }
    this.workflow.bind(binding);
    await this.refresh();
    if (this.destroyed) return;
    const run = this.workflow.run();
    if (run) { await this.router.navigate([], { queryParams: { ...this.route.snapshot.queryParams, run: run.binding.runId }, replaceUrl: true }); if (this.destroyed) return; }
  }
  protected async start(): Promise<void> {
    const binding = this.binding();
    const started = this.handoff.started();
    if (!binding || this.lookupError() || this.lookupPending() || this.handoff.inFlight() || this.handoff.pending() ||
      this.boundRunId || (started?.tabId === binding.tabId && started.workspacePath === binding.workspacePath)) return;
    await this.workflow.startGuidance();
    if (this.destroyed) return;
    await this.refresh();
    if (this.destroyed) return;
  }
  protected async retry(): Promise<void> { await this.workflow.regenerateGuidance(); if (this.destroyed) return; await this.refresh(); if (this.destroyed) return; }
  protected async setEnabled(value: boolean): Promise<void> { await this.guidance.setEnabled(value); if (this.destroyed) return; await this.refreshStatus(); if (this.destroyed) return; }
  protected async refreshSaved(): Promise<void> { await this.guidance.refreshCommitted(); if (this.destroyed) return; await this.refreshStatus(); if (this.destroyed) return; }
  protected async loadContent(): Promise<void> { await this.guidance.loadContent(); if (this.destroyed) return; }
  protected async download(): Promise<void> { await this.guidance.download(); if (this.destroyed) return; }
  protected async openOwner(): Promise<void> {
    const binding = this.binding();
    if (!binding) return;
    await this.launcher.open({ workspacePath: binding.workspacePath, workflow: 'setup-project-prompt', origin: 'blocked-run' });
    if (this.destroyed) return;
  }
  protected async skip(): Promise<void> { await this.navigateDone(); if (this.destroyed) return; }
  protected async continueDone(): Promise<void> { await this.navigateDone(); if (this.destroyed) return; }
  private async navigateDone(): Promise<void> {
    if (this.standalone()) { await this.router.navigate(['/onboarding']); if (this.destroyed) return; return; }
    const link = onboardingStepLink('guidance', 'done', this.route.snapshot.queryParams);
    await this.router.navigate(link.commands, { queryParams: link.queryParams });
    if (this.destroyed) return;
  }
}
