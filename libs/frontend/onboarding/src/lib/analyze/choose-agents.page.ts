import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TabManagerService } from '@ptah-extension/chat-state';
import { GenerationWorkflowLauncherService } from '@ptah-extension/chat-ui';
import { VSCodeService } from '@ptah-extension/core';
import type { SetupGenerationRejection, SetupGenerationTabBinding } from '@ptah-extension/shared';
import {
  AgentPreviewDialogComponent,
  CommunityPacksPanelComponent,
  GenerationModelPickerComponent,
  GenerationPreviewStore,
  GenerationSourceStatusComponent,
  GenerationWorkflowStore,
  findBoundGenerationTab,
  safeFailureCopy,
} from '@ptah-extension/setup-wizard';
import { LucideAngularModule, Bot, ArrowRight } from 'lucide-angular';
import { OwnerConflictBannerComponent } from '../shared/owner-conflict-banner.component';
import { OnboardingStepperComponent, type OnboardingStep } from '../shared/onboarding-stepper.component';
import { RecoveryScreenComponent } from '../shared/recovery-screen.component';
import { onboardingStepLink } from '../shell/onboarding-step-link';
import { AgentRecommendationListComponent } from './agent-recommendation-list.component';
import { AnalysisStepStore } from './analysis-step.store';

/** A2 owns its preview session; the tab and selected analysis remain in the URL. */
@Component({
  selector: 'ptah-choose-agents-page',
  standalone: true,
  imports: [
    AgentRecommendationListComponent,
    AgentPreviewDialogComponent,
    CommunityPacksPanelComponent,
    GenerationModelPickerComponent,
    GenerationSourceStatusComponent,
    OwnerConflictBannerComponent,
    OnboardingStepperComponent,
    RecoveryScreenComponent,
    LucideAngularModule,
  ],
  providers: [GenerationPreviewStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <main class="mx-auto max-w-[760px] space-y-5 p-4" data-testid="choose-agents">
      <header class="flex items-center gap-3">
        <span class="rounded-xl border border-base-300 p-2" data-glass-surface="tile"><lucide-angular [img]="icons.bot" class="size-6" aria-hidden="true" /></span>
        <div><h1 tabindex="-1" class="text-2xl font-semibold">Choose agents</h1><p class="text-sm text-base-content-muted">Pick the agents that fit this workspace.</p></div>
      </header>
      <ptah-onboarding-stepper [steps]="steps()" />
      @if (recovery()) {
        <ptah-recovery-screen [reason]="recovery()!" (primary)="analyzeFirst()" />
      } @else {
        @if (source() === 'catalog') {
          <section class="rounded-[14px] border border-state-need/70 p-4 text-sm" data-glass-surface="chrome" data-testid="agent-only-banner">
            No analysis is used; recommendations come from the workspace catalog.
            <button type="button" class="btn btn-link btn-sm" (click)="analyzeFirst()">Analyze first</button>
          </section>
        }
        <div data-testid="context-source">
          @if (generation.run(); as activeRun) {
            <ptah-generation-source-status [source]="activeRun.source" [recorded]="true" />
          } @else {
            <p class="text-sm text-base-content-muted">Context source: {{ source() === 'catalog' ? 'Workspace discovery' : 'Selected analysis' }}. The host checks the source when generation starts.</p>
          }
        </div>
        @if (loadError()) {
          <section class="rounded-[14px] border border-state-err/70 p-4" data-glass-surface="content" role="alert">
            <p>{{ loadError() }}</p>
            <button type="button" class="btn btn-sm mt-2" (click)="retryLoad()">Retry</button>
          </section>
        } @else if (loading()) {
          <p role="status">Loading recommendations…</p>
        } @else {
          <div data-testid="choose-agents-list">
            <div data-testid="choose-agents-toolbar">
              <ptah-agent-recommendation-list
                [recommendations]="store.recommendations()"
                [selection]="store.selection()"
                [disabled]="submitting() || preview.isOpen()"
                (toggled)="store.toggleAgent($event)"
                (selectRecommended)="store.selectRecommended()"
                (clearSelection)="store.clearAgents()" />
            </div>
          </div>
          @if (binding(); as bound) {
            <section class="rounded-[22px] border border-base-300 p-5" data-glass-surface="content">
              <ptah-generation-model-picker [tabId]="bound.tabId" [locked]="submitting() || generation.state() !== 'idle'" [effectiveProvider]="generation.provider()" [effectiveModel]="generation.model()" />
            </section>
            <section class="rounded-[22px] border border-base-300 p-5" data-glass-surface="content">
              <ptah-community-packs-panel />
            </section>
            @if (ownerConflict()) {
              <div data-testid="choose-agents-owner-banner">
                <ptah-owner-conflict-banner (openOwner)="openOwner()" (retry)="openPreview()" />
              </div>
            }
            @if (submitError()) { <p class="text-sm text-state-err" role="alert">{{ submitError() }}</p> }
            @if (reviewAgain()) { <p class="text-sm text-state-need" role="status">Targets need another review.</p> }
            <div class="flex flex-wrap items-center gap-2" data-testid="choose-agents-actions">
              <button type="button" class="btn btn-primary min-h-8" data-testid="choose-agents-preview-trigger"
                [disabled]="store.selection().size === 0 || submitting()" (click)="openPreview()">
                Preview and generate <lucide-angular [img]="icons.next" class="size-4" aria-hidden="true" />
              </button>
            </div>
          }
        }
      }
      <ptah-agent-preview-dialog
        [open]="preview.isOpen()" [retryOnError]="true" [loading]="preview.loading()"
        [preview]="preview.preview()" [snapshot]="preview.decisions()" [changed]="preview.changed()"
        [error]="preview.error() !== null" [model]="generation.model()" [isElectron]="vscode.isElectron"
        (dismissed)="preview.cancel()" (confirm)="confirmPreview()"
        (decisionChange)="preview.setRowDecision($event)" (applyAll)="preview.setAllRowDecisions($event)"
        (targetChange)="changeTarget($event)" />
    </main>
  `,
})
export class ChooseAgentsPage implements OnInit {
  protected readonly store = inject(AnalysisStepStore);
  protected readonly preview = inject(GenerationPreviewStore);
  protected readonly generation = inject(GenerationWorkflowStore);
  protected readonly vscode = inject(VSCodeService);
  private readonly tabs = inject(TabManagerService);
  private readonly launcher = inject(GenerationWorkflowLauncherService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private destroyed = false;
  private pendingAnalysis: string | null = null;
  protected readonly binding = signal<SetupGenerationTabBinding | null>(null);
  protected readonly source = signal<'analysis' | 'catalog'>('analysis');
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly submitError = signal<string | null>(null);
  protected readonly reviewAgain = signal(false);
  protected readonly submitting = signal(false);
  protected readonly recovery = signal<'missing-tab' | 'workspace-mismatch' | null>(null);
  protected readonly ownerConflict = computed(() => this.generation.rejection()?.reason === 'blocked');
  protected readonly steps = computed<readonly OnboardingStep[]>(() => [
    this.source() === 'catalog'
      ? { id: 'analyze', label: 'Analyze', state: 'skipped' }
      : { id: 'analyze', label: 'Analyze', state: 'completed', link: onboardingStepLink('agents', 'analyze', this.route.snapshot.queryParams) },
    { id: 'agents', label: 'Choose agents', state: 'current' },
    { id: 'generate', label: 'Generate agents', state: 'upcoming' },
    { id: 'guidance', label: 'Project guidance', state: 'upcoming' },
    { id: 'done', label: 'Done', state: 'upcoming' },
  ]);
  protected readonly icons = { bot: Bot, next: ArrowRight } as const;

  constructor() { this.destroyRef.onDestroy(() => { this.destroyed = true; }); }

  async ngOnInit(): Promise<void> {
    const explicitBack = this.router.getCurrentNavigation()?.extras.state?.['explicitBack'] === true;
    const params = this.route.snapshot.queryParamMap;
    const source = params.get('source') === 'catalog' ? 'catalog' : 'analysis';
    this.source.set(source);
    const workspacePath = this.tabs.activeWorkspacePath || this.vscode.config().workspaceRoot;
    if (!workspacePath) { this.recovery.set('workspace-mismatch'); this.loading.set(false); return; }
    const requestedTab = params.get('tab');
    const tab = requestedTab ? findBoundGenerationTab(this.tabs, { tabId: requestedTab, workspacePath }) : null;
    let tabId: string;
    if (tab?.workflow === 'setup-agent-generation') {
      tabId = tab.id;
    } else {
      const opened = await this.launcher.open({ workspacePath, workflow: 'setup-agent-generation', origin: 'onboarding-choose-agents', focus: false });
      if (this.destroyed) return;
      if (opened.outcome !== 'landed') { this.recovery.set('missing-tab'); this.loading.set(false); return; }
      tabId = opened.tabId;
      await this.router.navigate([], { relativeTo: this.route, queryParams: { tab: tabId }, queryParamsHandling: 'merge', replaceUrl: true });
      if (this.destroyed) return;
    }
    const binding: SetupGenerationTabBinding = { tabId, workspacePath, workflow: 'setup-agent-generation' };
    this.binding.set(binding);
    this.generation.bind(binding);
    await this.generation.refresh();
    if (this.destroyed) return;
    const activeRun = this.generation.run();
    if (!explicitBack && this.generation.state() !== 'idle' && activeRun) {
      await this.goToRun(activeRun.binding.runId);
      return;
    }
    const analysis = params.get('analysis');
    if (source === 'analysis' && analysis) {
      this.pendingAnalysis = analysis;
      await this.loadAnalysisAndRecommendations(analysis);
      return;
    }
    if (source === 'analysis' && !this.store.loaded()) {
      this.loadError.set('Choose a completed analysis first.');
      this.loading.set(false);
      return;
    }
    await this.loadRecommendations();
  }

  protected async retryLoad(): Promise<void> {
    if (this.pendingAnalysis) await this.loadAnalysisAndRecommendations(this.pendingAnalysis);
    else await this.loadRecommendations();
  }

  private async loadAnalysisAndRecommendations(analysis: string): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      await this.store.listAnalyses();
      if (this.destroyed) return;
      const selected = await this.store.selectAnalysis(analysis);
      if (this.destroyed) return;
      if (selected !== 'loaded') {
        this.loadError.set(selected === 'not-found'
          ? 'That analysis is no longer available. Analyze the workspace again.'
          : 'The analysis could not be loaded. Try again.');
        return;
      }
    } catch {
      if (this.destroyed) return;
      this.loadError.set('The analysis could not be loaded. Try again.');
      return;
    } finally {
      if (!this.destroyed) this.loading.set(false);
    }
    this.pendingAnalysis = null;
    await this.loadRecommendations();
  }

  protected async loadRecommendations(): Promise<void> {
    const binding = this.binding();
    if (!binding) return;
    this.loading.set(true);
    this.loadError.set(null);
    try { await this.store.loadRecommendations(binding, this.source()); }
    catch (error: unknown) { if (!this.destroyed) this.loadError.set(safeFailureCopy(error instanceof Error ? error.message : '', 'Recommendations unavailable. Try again.')); }
    finally { if (!this.destroyed) this.loading.set(false); }
  }
  protected async openPreview(): Promise<void> {
    const binding = this.binding();
    if (!binding || this.store.selection().size === 0) return;
    this.submitError.set(null); this.reviewAgain.set(false);
    await this.preview.open([...this.store.selection()], false, binding);
  }
  protected async changeTarget(choice: Parameters<GenerationPreviewStore['changeTarget']>[1]): Promise<void> {
    await this.preview.changeTarget([...this.store.selection()], choice);
  }
  protected async confirmPreview(): Promise<void> {
    const binding = this.binding();
    if (!binding || this.submitting()) return;
    const ids = [...this.store.selection()];
    const confirmed = await this.preview.confirm(ids);
    if (this.destroyed) return;
    if (!confirmed.submit) return;
    this.submitting.set(true);
    this.submitError.set(null);
    try {
      const result = await this.store.submit(binding, confirmed.decisions);
      if (this.destroyed) return;
      if ('runId' in result) { await this.goToRun(result.runId); return; }
      if ('rejection' in result) {
        if (result.rejection.reason === 'preview-required') {
          this.reviewAgain.set(true);
          await this.preview.open(ids, true, binding);
          if (this.destroyed) return;
        } else if (result.rejection.reason !== 'blocked') {
          this.submitError.set('Generation could not start. Try again.');
        }
      } else {
        this.submitError.set(safeFailureCopy(result.error, 'Generation could not start. Try again.'));
      }
    } finally { if (!this.destroyed) this.submitting.set(false); }
  }
  protected async openOwner(): Promise<void> {
    const binding = this.binding();
    const rejection: SetupGenerationRejection | null = this.generation.rejection();
    if (!binding || rejection?.reason !== 'blocked' || !rejection.ownerTabId) return;
    const owner = findBoundGenerationTab(this.tabs, { tabId: rejection.ownerTabId, workspacePath: binding.workspacePath });
    if (!owner) return;
    await this.launcher.open({ workspacePath: binding.workspacePath, workflow: 'setup-agent-generation', origin: 'blocked-run' });
  }
  protected async analyzeFirst(): Promise<void> {
    const link = onboardingStepLink('agents', 'analyze', this.route.snapshot.queryParams);
    await this.router.navigate(link.commands, { queryParams: link.queryParams, state: { explicitBack: true } });
  }
  private async goToRun(runId: string): Promise<void> {
    if (this.destroyed) return;
    const binding = this.binding();
    if (!binding) return;
    const link = onboardingStepLink('agents', 'generate', { ...this.route.snapshot.queryParams, tab: binding.tabId, run: runId });
    await this.router.navigate(link.commands, { queryParams: link.queryParams, replaceUrl: true });
  }
}
