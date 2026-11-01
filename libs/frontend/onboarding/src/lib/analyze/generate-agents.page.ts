import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TabManagerService } from '@ptah-extension/chat-state';
import { VSCodeService } from '@ptah-extension/core';
import type {
  ResumableGenerationAgent,
  SetupGenerationTabBinding,
} from '@ptah-extension/shared';
import {
  AgentGenerationStore,
  GenerationHandoffStore,
  GenerationWorkflowStore,
  WizardRpcService,
  findBoundGenerationTab,
  safeFailureCopy,
} from '@ptah-extension/setup-wizard';
import { DetailsLogComponent } from '../shared/details-log.component';
import {
  ItemStatusGridComponent,
  type ItemStatusGridRow,
} from '../shared/item-status-grid.component';
import {
  OnboardingStepperComponent,
  type OnboardingStep,
} from '../shared/onboarding-stepper.component';
import {
  RecoveryScreenComponent,
  type OnboardingRecoveryReason,
} from '../shared/recovery-screen.component';
import { RunPanelComponent } from '../shared/run-panel.component';
import { StepMeterComponent } from '../shared/step-meter.component';
import { chipStateFor } from '../shared/run-status-chip.component';
import { onboardingStepLink } from '../shell/onboarding-step-link';
import { GenerationStepStore } from './generation-step.store';

@Component({
  selector: 'ptah-generate-agents-page',
  standalone: true,
  imports: [
    DetailsLogComponent,
    ItemStatusGridComponent,
    OnboardingStepperComponent,
    RecoveryScreenComponent,
    RunPanelComponent,
    StepMeterComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  styles: [
    `
      :host ::ng-deep .has-failed-agents ptah-run-status-chip {
        display: none;
      }
      :host ::ng-deep ptah-run-panel button.btn-sm {
        min-height: 36px;
      }
    `,
  ],
  template: `
    <section
      class="mx-auto max-w-[760px] space-y-5 p-4"
      aria-labelledby="generate-agents-title"
      data-testid="generate-agents-page"
    >
      <header>
        <h1
          id="generate-agents-title"
          tabindex="-1"
          class="text-2xl font-semibold"
        >
          Generating your agents
        </h1>
        <p class="text-sm text-base-content-muted">
          Your agents are tailored to this workspace. You can leave this page
          while the run continues.
        </p>
      </header>
      <ptah-onboarding-stepper [steps]="steps()" />
      @if (continueError()) {
        <p
          class="rounded-[10px] border border-state-err p-3 text-sm"
          role="alert"
          data-testid="generate-continue-error"
        >
          {{ continueError() }}
        </p>
      }
      @if (recovery() || workflow.runMismatch()) {
        <div data-testid="generate-recovery-panel">
          <ptah-recovery-screen
            [reason]="workflow.runMismatch() ? 'stale-run' : recovery()!"
            (primary)="openLatest()"
          />
        </div>
      } @else if (workflow.lookupExhausted()) {
        <section
          class="rounded-[22px] border border-state-err/70 p-5"
          role="alert"
          data-testid="generate-lookup-exhausted"
        >
          <h2 class="font-semibold">Run state is unavailable</h2>
          <p>We could not confirm this run. Try the lookup again.</p>
          <button
            type="button"
            class="btn btn-primary btn-sm mt-3 min-h-9"
            (click)="refresh()"
          >
            Retry
          </button>
        </section>
      } @else {
        <div
          data-testid="generate-state-chip"
          [attr.data-state]="workflow.state()"
          [class.has-failed-agents]="
            workflow.state() === 'completed' && hasFailedAgents()
          "
        >
          <ptah-run-panel
            [state]="panelState()"
            [viewState]="workflow.state()"
            [title]="runTitle()"
            [message]="runMessage()"
            continueLabel="Continue to guidance"
            (stop)="workflow.stop()"
            (retry)="retryRun()"
            (startOver)="backToAgents()"
            (resumeRequested)="resume()"
            (continueRun)="continueGuidance()"
          >
            @if (workflow.state() === 'starting') {
              <button
                type="button"
                class="btn btn-sm min-h-8 mt-3"
                data-testid="generate-stop-starting"
                (click)="workflow.stop()"
              >
                Stop
              </button>
            }
            @if (progress(); as value) {
              <ptah-step-meter
                label="Agent generation progress"
                [percent]="value"
              />
            }
            @if (workflow.state() === 'completed' && hasFailedAgents()) {
              <span
                class="mt-3 inline-flex rounded-full border border-state-need px-2.5 py-1 text-xs font-medium text-state-need"
                data-testid="generate-partial-warning"
                >Needs attention</span
              >
            }
            @if (workflow.run()?.result?.counts; as counts) {
              <p class="mt-3 text-sm" data-testid="generate-facts">
                {{ counts.written }} written · {{ counts.unchanged }} unchanged
                · {{ counts.failed }} failed · {{ counts.skipped }} skipped ·
                {{ counts.rejected }} rejected
              </p>
            }
          </ptah-run-panel>
        </div>
        @if (workflow.rejection()?.reason === 'blocked') {
          <section
            class="flex flex-col gap-3 rounded-[14px] border border-state-err/70 p-4 text-sm sm:flex-row sm:items-center"
            role="status"
            data-testid="generate-owner-conflict"
          >
            <p class="min-w-0 flex-1 text-state-need">
              <strong>Another run is active.</strong> Open the active run before
              starting another.
            </p>
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class="btn btn-sm min-h-9"
                (click)="openOwner()"
              >
                Open it
              </button>
              <button
                type="button"
                class="btn btn-sm min-h-9"
                (click)="refresh()"
              >
                Check again
              </button>
            </div>
          </section>
        }
        @if (workflow.run()?.result?.agentOutcomes; as outcomes) {
          <div
            class="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3"
            aria-label="Generated agents"
          >
            @for (agent of outcomes; track agent.agentId) {
              <article
                class="rounded-[10px] border border-base-300 p-4"
                data-glass-surface="tile"
                data-testid="generate-agent-card"
              >
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <h2 class="font-semibold">{{ agent.agentId }}</h2>
                  <span
                    class="inline-flex min-h-9 items-center rounded-full border border-base-300 px-2.5 py-1 text-xs font-medium capitalize"
                    data-glass-surface="tile"
                    data-testid="generate-agent-status"
                    [class.text-state-err]="agent.status === 'failed'"
                    [class.text-state-done]="agent.status === 'written'"
                    [class.text-base-content-muted]="
                      agent.status !== 'failed' && agent.status !== 'written'
                    "
                    >{{ agent.status }}</span
                  >
                </div>
                @if (agent.fileName) {
                  <p
                    class="break-all font-mono text-xs"
                    data-testid="generate-agent-file"
                  >
                    {{ agent.fileName }}
                  </p>
                }
                @if (agent.status === 'failed') {
                  <button
                    type="button"
                    class="btn btn-sm min-h-9 mt-3"
                    (click)="retryAgent(agent.agentId)"
                  >
                    Retry this agent
                  </button>
                }
              </article>
            }
          </div>
        } @else if (rows().length) {
          <div data-testid="generate-agent-cards">
            <ptah-item-status-grid
              [items]="rows()"
              (retry)="retryAgent($event)"
            />
          </div>
        }
        @if (handoff.pending(); as pending) {
          <section
            class="rounded-[22px] border border-base-300 p-5"
            data-glass-surface="content"
            data-testid="generate-countdown"
          >
            <h2 class="font-semibold">
              Project guidance starts in {{ remainingSeconds() }}s
            </h2>
            <div class="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                class="btn btn-primary min-h-8"
                data-testid="generate-start-now"
                (click)="startNow()"
              >
                Start now
              </button>
              <button
                type="button"
                class="btn min-h-8"
                data-testid="generate-skip"
                (click)="skipGuidance()"
              >
                Skip
              </button>
            </div>
          </section>
        }
        @if (binding(); as bound) {
          <ptah-details-log mode="tab" [tabId]="bound.tabId" />
        }
      }
    </section>
  `,
})
export class GenerateAgentsPage implements OnInit {
  protected readonly workflow = inject(GenerationWorkflowStore);
  protected readonly handoff = inject(GenerationHandoffStore);
  private readonly agents = inject(AgentGenerationStore);
  private readonly step = inject(GenerationStepStore);
  private readonly rpc = inject(WizardRpcService);
  private readonly tabs = inject(TabManagerService);
  private readonly vscode = inject(VSCodeService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private destroyed = false;
  private navigatedRun: string | null = null;
  protected readonly binding = signal<SetupGenerationTabBinding | null>(null);
  protected readonly recovery = signal<OnboardingRecoveryReason | null>(null);
  protected readonly continueError = signal<string | null>(null);
  private readonly now = signal(Date.now());
  protected readonly remainingSeconds = computed(() =>
    Math.max(
      0,
      Math.ceil(
        ((this.handoff.pending()?.guidanceStartDeadline ?? this.now()) -
          this.now()) /
          1000,
      ),
    ),
  );
  protected readonly chipStateFor = chipStateFor;
  protected readonly rows = computed<readonly ItemStatusGridRow[]>(() => {
    const runId = this.workflow.run()?.binding.runId;
    const checkpoint = this.agents.checkpoint();
    return runId && checkpoint?.runId === runId
      ? checkpoint.agents.map((agent: ResumableGenerationAgent) => ({
          agent,
          retrying: this.agents.retryingIds().has(agent.agentId),
        }))
      : [];
  });
  protected readonly progress = computed(() => {
    const rows = this.rows();
    if (!rows.length) return null;
    return (
      (100 *
        rows.filter((row) => !['pending', 'running'].includes(row.agent.status))
          .length) /
      rows.length
    );
  });
  protected readonly steps = computed<readonly OnboardingStep[]>(() => [
    { id: 'analyze', label: 'Analyze', state: 'completed' },
    {
      id: 'agents',
      label: 'Choose agents',
      state: 'completed',
      link: onboardingStepLink(
        'generate',
        'agents',
        this.route.snapshot.queryParams,
      ),
    },
    { id: 'generate', label: 'Generate agents', state: 'current' },
    { id: 'guidance', label: 'Project guidance', state: 'upcoming' },
    { id: 'done', label: 'Done', state: 'upcoming' },
  ]);
  protected readonly hasFailedAgents = computed(
    () => (this.workflow.run()?.result?.counts?.failed ?? 0) > 0,
  );
  protected readonly panelState = computed(() =>
    chipStateFor(this.workflow.state()),
  );
  protected readonly runTitle = computed(() =>
    this.workflow.state() === 'completed' && this.hasFailedAgents()
      ? 'Some agents failed'
      : {
          starting: 'Starting generation',
          running: 'Generating agents',
          quiet: 'Checking run state',
          cancelling: 'Stopping generation',
          'stop-unconfirmed': 'Checking stop',
          'stop-unknown': 'Checking run state',
          completed: 'Agents generated',
          cancelled: 'Generation stopped',
          failed: 'Generation failed',
          'timed-out': 'Generation timed out',
          idle: 'No generation run',
        }[this.workflow.state()],
  );
  protected readonly runMessage = computed(() => {
    const state = this.workflow.state();
    const reason =
      this.workflow.startError() ??
      this.workflow
        .run()
        ?.result?.agentOutcomes?.find((agent) => agent.status === 'failed')
        ?.error;
    if (state === 'failed')
      return safeFailureCopy(
        reason,
        'Generation failed. Retry the run or start over.',
      );
    if (state === 'timed-out')
      return safeFailureCopy(
        reason ?? 'timed out',
        'Generation timed out. Retry the run.',
      );
    if (state === 'cancelled')
      return 'Generation stopped. Resume when you are ready.';
    if (
      state === 'cancelling' ||
      state === 'stop-unconfirmed' ||
      state === 'stop-unknown'
    )
      return 'Stopping this run. Check its status before starting another.';
    if (this.workflow.startError())
      return safeFailureCopy(
        this.workflow.startError(),
        'The run could not start.',
      );
    if (state === 'completed')
      return this.hasFailedAgents()
        ? 'Review the failed agents and retry them before continuing.'
        : 'Review the generated agents and continue to project guidance.';
    return state === 'idle'
      ? 'Choose agents to begin.'
      : 'The run continues in its bound session.';
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
    });
    effect((cleanup) => {
      const pending = this.handoff.pending();
      if (!pending) return;
      this.now.set(Date.now());
      const timer = setInterval(() => this.now.set(Date.now()), 250);
      cleanup(() => clearInterval(timer));
    });
    effect(() => {
      const started = this.handoff.started();
      if (
        started &&
        this.workflow.state() === 'completed' &&
        this.binding()?.tabId &&
        started.workspacePath === this.binding()?.workspacePath &&
        started.runId !== this.navigatedRun
      ) {
        this.navigatedRun = started.runId;
        void this.goGuidance(started.tabId, started.runId);
      }
    });
  }

  async ngOnInit(): Promise<void> {
    const tabId = this.route.snapshot.queryParamMap.get('tab');
    const workspacePath =
      this.tabs.activeWorkspacePath || this.vscode.config().workspaceRoot;
    if (!workspacePath) {
      this.recovery.set('workspace-mismatch');
      return;
    }
    const binding: SetupGenerationTabBinding = {
      tabId: tabId ?? '',
      workspacePath,
      workflow: 'setup-agent-generation',
    };
    if (!tabId || !findBoundGenerationTab(this.tabs, binding)) {
      this.recovery.set('missing-tab');
      return;
    }
    this.binding.set(binding);
    const result = this.step.bindAgents(
      binding,
      this.route.snapshot.queryParamMap.get('run') ?? undefined,
    );
    if (result !== 'bound') {
      this.recovery.set(
        result === 'workspace-mismatch' ? 'workspace-mismatch' : 'foreign-tab',
      );
      return;
    }
    await this.workflow.refresh();
    if (this.destroyed) return;
    const run = this.workflow.run();
    if (run) {
      try {
        const resumable = await this.rpc.getResumableRun();
        if (this.destroyed) return;
        if (resumable.generation?.runId === run.binding.runId) {
          await this.agents.discover();
          if (this.destroyed) return;
        }
      } catch {
        /* Run state remains authoritative if checkpoint discovery fails. */
      }
    }
  }
  protected async refresh(): Promise<void> {
    await this.workflow.refresh();
    if (this.destroyed) return;
  }
  protected async openLatest(): Promise<void> {
    const binding = this.binding();
    if (!binding) {
      await this.backToAgents();
      if (this.destroyed) return;
      return;
    }
    this.workflow.bind(binding);
    await this.workflow.refresh();
    if (this.destroyed) return;
    const run = this.workflow.run();
    if (!run) {
      await this.backToAgents();
      if (this.destroyed) return;
      return;
    }
    await this.router.navigate([], {
      queryParams: { tab: binding.tabId, run: run.binding.runId },
      replaceUrl: true,
    });
    if (this.destroyed) return;
  }
  protected async retryRun(): Promise<void> {
    await this.workflow.refresh();
    if (this.destroyed) return;
    if (!this.workflow.isBound()) {
      await this.backToAgents();
      if (this.destroyed) return;
    }
  }
  protected async resume(): Promise<void> {
    await this.agents.resume();
    if (this.destroyed) return;
    await this.workflow.refresh();
    if (this.destroyed) return;
  }
  protected async retryAgent(agentId: string): Promise<void> {
    const run = this.workflow.run();
    if (!run) return;
    await this.agents.retry(agentId, run.binding);
    if (this.destroyed) return;
    await this.workflow.refresh();
    if (this.destroyed) return;
  }
  protected async startNow(): Promise<void> {
    await this.handoff.startNow();
    if (this.destroyed) return;
    const started = this.handoff.started();
    if (started && started.workspacePath === this.binding()?.workspacePath) {
      await this.goGuidance(started.tabId, started.runId);
      if (this.destroyed) return;
    }
  }
  protected async continueGuidance(): Promise<void> {
    const binding = this.binding();
    if (!binding) return;
    this.continueError.set(null);
    const started = this.handoff.started();
    if (started?.workspacePath !== binding.workspacePath) {
      try {
        await this.handoff.manualContinue(binding.workspacePath);
        if (this.destroyed) return;
      } catch {
        // degradation-audit: reported — continueError shows the retryable guidance failure.
        if (!this.destroyed)
          this.continueError.set('Could not open project guidance. Try again.');
        return;
      }
    }
    if (this.destroyed) return;
    const current = this.handoff.started();
    if (current?.workspacePath === binding.workspacePath) {
      await this.goGuidance(current.tabId, current.runId);
      if (this.destroyed) return;
      return;
    }
    const opened = this.handoff.openedTab();
    if (opened?.workspacePath === binding.workspacePath) {
      await this.goGuidance(opened.tabId);
      if (this.destroyed) return;
    } else this.continueError.set('Project guidance did not open. Try again.');
  }
  private async goGuidance(tabId: string, guidanceRun?: string): Promise<void> {
    const binding = this.binding();
    if (!binding || this.destroyed) return;
    const link = onboardingStepLink('generate', 'guidance', {
      tab: tabId,
      gen: binding.tabId,
      guidanceRun,
    });
    await this.router.navigate(link.commands, {
      queryParams: link.queryParams,
    });
    if (this.destroyed) return;
  }
  protected async skipGuidance(): Promise<void> {
    this.handoff.skip();
    const binding = this.binding();
    const link = onboardingStepLink('guidance', 'done', {
      gen: binding?.tabId,
    });
    await this.router.navigate(link.commands, {
      queryParams: link.queryParams,
    });
    if (this.destroyed) return;
  }
  protected async backToAgents(): Promise<void> {
    const link = onboardingStepLink('generate', 'agents', {
      tab: this.binding()?.tabId,
    });
    await this.router.navigate(link.commands, {
      queryParams: link.queryParams,
      state: { explicitBack: true },
    });
    if (this.destroyed) return;
  }
  protected async openOwner(): Promise<void> {
    await this.backToAgents();
    if (this.destroyed) return;
  }
}
