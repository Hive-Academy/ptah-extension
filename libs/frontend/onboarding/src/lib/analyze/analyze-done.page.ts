import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal, type WritableSignal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TabManagerService } from '@ptah-extension/chat-state';
import { AppStateManager, VSCodeService } from '@ptah-extension/core';
import { MESSAGE_TYPES, type SetupGenerationRunState, type SetupGenerationTabBinding } from '@ptah-extension/shared';
import { WizardRpcService, findBoundGenerationTab } from '@ptah-extension/setup-wizard';
import { OnboardingFlagService } from '../first-run/onboarding-flag.service';
import { OnboardingStepperComponent, type OnboardingStep } from '../shared/onboarding-stepper.component';

const DONE_STEPS: readonly OnboardingStep[] = [
  { id: 'analyze', label: 'Analyze', state: 'completed' },
  { id: 'agents', label: 'Choose agents', state: 'completed' },
  { id: 'generate', label: 'Generate agents', state: 'completed' },
  { id: 'guidance', label: 'Project guidance', state: 'completed' },
  { id: 'done', label: 'Done', state: 'current' },
];

@Component({
  selector: 'ptah-analyze-done-page', standalone: true,
  imports: [OnboardingStepperComponent],
  changeDetection: ChangeDetectionStrategy.OnPush, host: { class: 'block' },
  template: `
    <section class="mx-auto max-w-[760px] space-y-5 p-4" aria-labelledby="analyze-done-title" data-testid="analyze-done-page">
      <header><h1 id="analyze-done-title" tabindex="-1" class="text-2xl font-semibold">You're ready to work</h1>
        <p class="text-sm text-base-content-muted">Your workspace setup is complete. You can return to these steps anytime.</p></header>
      <ptah-onboarding-stepper [steps]="steps" />
      <section class="rounded-[22px] border border-base-300 p-5" data-glass-surface="content" data-testid="analyze-done-facts">
        <h2 class="font-semibold">What happened</h2>
        @if (agents(); as run) {
          <p class="mt-2 text-sm">Agents: {{ run.status }}
            @if (run.result?.counts; as counts) { · {{ counts.written }} written, {{ counts.unchanged }} unchanged, {{ counts.failed }} failed }
          </p>
        } @else { <p class="mt-2 text-sm">Agent generation was skipped or is unavailable.</p> }
        @if (guidance(); as run) { <p class="mt-2 text-sm">Project guidance: {{ (guidanceEnabled() ?? (run.status === 'completed')) ? 'on' : 'off' }} ({{ run.status }})</p> }
        @else { <p class="mt-2 text-sm">Project guidance: off (skipped or unavailable).</p> }
      </section>
      <nav class="flex flex-wrap gap-2" aria-label="Next steps">
        <button type="button" class="btn btn-primary min-h-8" data-testid="done-open-chat" (click)="openChat()">Open chat</button>
        <button type="button" class="btn min-h-8" data-testid="done-command-center" (click)="commandCenter()">Command center</button>
        <button type="button" class="btn min-h-8" data-testid="done-tribunal" (click)="tribunal()">Ask the panel in chat</button>
        <button type="button" class="btn btn-ghost min-h-8" data-testid="done-run-again" (click)="runAgain()">Run again</button>
      </nav>
    </section>
  `,
})
export class AnalyzeDonePage implements OnInit {
  protected readonly steps = DONE_STEPS;
  protected readonly agents = signal<SetupGenerationRunState | null>(null);
  protected readonly guidance = signal<SetupGenerationRunState | null>(null);
  protected readonly guidanceEnabled = signal<boolean | null>(null);
  private readonly flags = inject(OnboardingFlagService);
  private readonly vscode = inject(VSCodeService);
  private readonly appState = inject(AppStateManager);
  private readonly rpc = inject(WizardRpcService);
  private readonly tabs = inject(TabManagerService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private destroyed = false;
  constructor() { this.destroyRef.onDestroy(() => { this.destroyed = true; }); }

  async ngOnInit(): Promise<void> {
    this.flags.markCompleted();
    await this.loadFact('gen', 'setup-agent-generation', this.agents);
    if (this.destroyed) return;
    await this.loadFact('tab', 'setup-project-prompt', this.guidance);
    if (this.destroyed) return;
    const workspacePath = this.tabs.activeWorkspacePath || this.vscode.config().workspaceRoot;
    if (workspacePath) {
      try {
        const status = await this.rpc.getEnhancedPromptsStatus(workspacePath);
        if (!this.destroyed && !status.error) this.guidanceEnabled.set(status.enabled);
      } catch { /* The run fact still describes guidance when saved status is unavailable. */ }
    }
  }
  private async loadFact(key: 'gen' | 'tab', workflow: SetupGenerationTabBinding['workflow'], target: WritableSignal<SetupGenerationRunState | null>): Promise<void> {
    const tabId = this.route.snapshot.queryParamMap.get(key);
    if (!tabId) return;
    const workspacePath = this.tabs.activeWorkspacePath || this.vscode.config().workspaceRoot;
    if (!workspacePath) return;
    const binding: SetupGenerationTabBinding = { tabId, workflow, workspacePath };
    if (!findBoundGenerationTab(this.tabs, binding)) return;
    try {
      const run = await this.rpc.getBoundRunState(binding);
      if (!this.destroyed && run && ['completed', 'cancelled', 'failed', 'timed-out'].includes(run.status)) target.set(run);
    } catch { /* The Done page remains useful without an optional fact lookup. */ }
  }
  protected openChat(): void { this.vscode.postMessage({ type: MESSAGE_TYPES.SETUP_WIZARD_COMPLETE }); this.appState.setCurrentView('chat'); }
  protected async commandCenter(): Promise<void> { await this.router.navigate(['/command-center']); }
  protected async tribunal(): Promise<void> { this.openChat(); await this.router.navigate(['/chat']); }
  protected async runAgain(): Promise<void> { await this.router.navigate(['/onboarding', 'analyze']); }
}
