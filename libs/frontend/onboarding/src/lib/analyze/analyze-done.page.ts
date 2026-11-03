import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
  type WritableSignal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ActivatedRoute,
  Router,
  RouterLink,
  type ParamMap,
} from '@angular/router';
import { TabManagerService } from '@ptah-extension/chat-state';
import { AppStateManager, VSCodeService } from '@ptah-extension/core';
import {
  MESSAGE_TYPES,
  type FileOutcome,
  type SetupGenerationRunState,
  type SetupGenerationTabBinding,
} from '@ptah-extension/shared';
import {
  GradeExpectationComponent,
  LibraryStaleNoticeComponent,
  OutcomeSummaryComponent,
  SetupWizardStateService,
  WizardRpcService,
  findBoundGenerationTab,
  libraryReachable,
  safeFailureCopy,
  type OutcomeFileRow,
} from '@ptah-extension/setup-wizard';
import { OnboardingFlagService } from '../first-run/onboarding-flag.service';
import {
  OnboardingStepperComponent,
  type OnboardingStep,
} from '../shared/onboarding-stepper.component';
import { onboardingStepLink } from '../shell/onboarding-step-link';

const DONE_STEPS: readonly OnboardingStep[] = [
  { id: 'analyze', label: 'Analyze', state: 'completed' },
  { id: 'agents', label: 'Choose agents', state: 'completed' },
  { id: 'generate', label: 'Generate agents', state: 'completed' },
  { id: 'guidance', label: 'Project guidance', state: 'completed' },
  { id: 'done', label: 'Done', state: 'current-complete' },
];

type FactState =
  | 'loading'
  | 'ready'
  | 'missing'
  | 'running'
  | 'failed-lookup'
  | 'mismatched-tab';

@Component({
  selector: 'ptah-analyze-done-page',
  standalone: true,
  imports: [
    OnboardingStepperComponent,
    RouterLink,
    OutcomeSummaryComponent,
    GradeExpectationComponent,
    LibraryStaleNoticeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section
      class="mx-auto max-w-[760px] space-y-5 p-4"
      aria-labelledby="analyze-done-title"
      data-testid="analyze-done-page"
    >
      <header>
        <h1
          id="analyze-done-title"
          tabindex="-1"
          class="text-2xl font-semibold"
        >
          {{ pageHeading() }}
        </h1>
        <p class="text-sm text-base-content-muted">
          {{ pageSubtitle() }}
        </p>
      </header>
      <ptah-onboarding-stepper [steps]="steps" />
      <section
        class="rounded-[22px] border border-base-300 p-5"
        data-glass-surface="content"
        data-testid="analyze-done-facts"
      >
        <h2 class="font-semibold">What happened</h2>
        @if (agentState() === 'loading') {
          <p class="mt-2 text-sm" data-testid="done-agents-loading">
            Loading agent results…
          </p>
        } @else if (agentState() === 'running') {
          <p class="mt-2 text-sm" data-testid="done-agents-running">
            Agent generation is still running. Return here when it finishes.
          </p>
        } @else if (agentState() === 'failed-lookup') {
          <p
            class="mt-2 text-sm text-state-need"
            data-testid="done-agents-lookup-error"
          >
            Could not load agent results. Return to Generate agents to check the
            run.
          </p>
        } @else if (agentState() === 'mismatched-tab') {
          <p
            class="mt-2 text-sm text-state-need"
            data-testid="done-agents-mismatched-tab"
          >
            This agent run belongs to a different tab or workspace.
          </p>
        } @else if (agentState() === 'missing') {
          <p class="mt-2 text-sm" data-testid="done-agents-missing">
            Agent generation was skipped or is unavailable.
          </p>
        }
        @if (agents(); as run) {
          <p
            class="mt-3 text-sm font-semibold"
            data-testid="done-outcome-header"
          >
            {{ outcomeHeading() }}
          </p>
          @if (run.status === 'cancelled') {
            <p class="text-sm text-base-content-muted">
              Agent generation was cancelled. Review the run before continuing.
            </p>
          } @else if (run.status === 'timed-out') {
            <p class="text-sm text-base-content-muted">
              Agent generation timed out. Review the run before continuing.
            </p>
          } @else if (
            run.status === 'failed' || run.result?.success === false
          ) {
            <p class="text-sm text-base-content-muted">
              Some agents were not generated. Files written earlier are kept —
              review the failures below.
            </p>
          }
          <p class="mt-2 text-sm" [class.text-state-need]="hasFailures()">
            Agents:
            {{
              run.status === 'completed' && hasFailures()
                ? 'needs attention'
                : run.status
            }}
            @if (run.result?.counts; as counts) {
              @if (!run.result?.agentOutcomes) {
                · {{ counts.written }} written, {{ counts.kept ?? 0 }} kept,
                {{ counts.unchanged }} already current,
                {{ counts.changedSincePreview ?? 0 }} changed since preview
                (kept),
                <strong>{{ counts.failed }} failed</strong>
              }
            }
          </p>
          @if (hasFailures()) {
            <span
              class="inline-flex rounded-full border border-state-need px-2.5 py-1 text-xs font-medium text-state-need"
              data-testid="done-agents-warning"
              >Needs attention</span
            >
            <a
              class="ml-2 text-sm font-medium text-state-need underline"
              [routerLink]="generateLink().commands"
              [queryParams]="generateLink().queryParams"
              data-testid="done-review-agents"
              >{{
                run.status === 'cancelled' || run.status === 'timed-out'
                  ? 'Review agent run'
                  : 'Review failed agents'
              }}</a
            >
          }
        }
        @if (agents()?.result; as result) {
          @if (result.rejectedSections && result.rejectedSections > 0) {
            <span
              class="mt-3 inline-flex rounded-full border border-state-need px-2.5 py-1 text-xs font-medium text-state-need"
              data-testid="done-rejected-sections"
              >{{ result.rejectedSections }} sections rejected</span
            >
          }
          <div class="mt-4" data-testid="done-agent-outcomes">
            @if (result.agentOutcomes && outcomeRows().length === 0) {
              <p
                class="mb-3 text-sm text-base-content-muted"
                data-testid="done-no-outcomes"
              >
                Nothing new was written. No agent files were written in this
                run.
              </p>
            }
            <div class="mb-2 flex items-center gap-2">
              <h3 class="text-sm font-semibold">
                Generated Agents
                <span
                  class="text-base-content-muted"
                  data-testid="done-agent-count"
                  >({{
                    result.agentOutcomes
                      ? outcomeRows().length
                      : (result.counts?.total ?? 0)
                  }})</span
                >
              </h3>
              @if (result.enhancedPromptsUsed) {
                <span
                  class="rounded-full border border-state-done px-2.5 py-1 text-xs font-medium text-state-done"
                  data-testid="done-enhanced"
                  >Enhanced</span
                >
              }
            </div>
            @if (outputDirectory(); as directory) {
              <p
                class="mb-3 text-xs text-base-content-muted"
                data-testid="done-output-directory"
              >
                Output directory:
                <code
                  class="[overflow-wrap:anywhere] rounded bg-base-300 px-1.5 py-0.5"
                  >{{ directory }}</code
                >
              </p>
            }
            @if (generationErrors().length > 0) {
              <div
                class="mb-3 rounded-lg border border-state-need p-3 text-sm text-state-need"
                role="alert"
                data-testid="done-generation-errors"
              >
                <p class="font-medium">Generation errors</p>
                <ul class="mt-1 list-inside list-disc space-y-1">
                  @for (error of generationErrors(); track $index) {
                    <li>{{ error }}</li>
                  }
                </ul>
              </div>
            }
            <ptah-outcome-summary
              [rows]="outcomeRows()"
              [libraryDiverged]="result.libraryDiverged ?? []"
              [target]="result.target"
              [isElectron]="isElectron"
              [outputDirectory]="outputDirectory()"
              (openLibrary)="openLibrary()"
            />
            @if (showsLibrary()) {
              <ptah-grade-expectation [rows]="outcomeRows()" />
              <ptah-library-stale-notice [libraryPass]="result.libraryPass" />
            }
          </div>
        }
        @if (
          agents()?.status === 'failed' &&
          !agents()?.result?.counts &&
          outcomeRows().length === 0 &&
          generationErrors().length === 0
        ) {
          <p
            class="mt-3 text-sm text-state-need"
            data-testid="done-run-failure-reason"
          >
            Agent generation failed. Review the run and try again.
          </p>
        }
        @if (guidanceState() === 'loading') {
          <p class="mt-2 text-sm" data-testid="done-guidance-loading">
            Loading project guidance…
          </p>
        } @else if (guidanceState() === 'running') {
          <p class="mt-2 text-sm">Project guidance is still running.</p>
        } @else if (guidanceState() === 'failed-lookup') {
          <p class="mt-2 text-sm text-state-need">
            Could not load project guidance.
          </p>
        } @else if (guidanceState() === 'mismatched-tab') {
          <p class="mt-2 text-sm text-state-need">
            Project guidance belongs to a different tab or workspace.
          </p>
        } @else if (guidance(); as run) {
          <p class="mt-2 text-sm">
            Project guidance:
            {{
              (guidanceEnabled() ?? run.status === 'completed') ? 'on' : 'off'
            }}
            ({{ run.status }})
          </p>
        } @else {
          <p class="mt-2 text-sm">
            Project guidance: off (skipped or unavailable).
          </p>
        }
      </section>
      <section
        class="rounded-[22px] border border-base-300 p-5"
        data-glass-surface="content"
        data-testid="done-quick-start"
      >
        <h2 class="font-semibold">Quick Start Guide</h2>
        <h3 class="mt-3 text-sm font-semibold">Start a Development Workflow</h3>
        <p class="mt-2 text-sm text-base-content-muted">
          Use the
          <code class="rounded bg-base-300 px-1.5 py-0.5">/orchestrate</code>
          command to start an intelligent workflow:
        </p>
        <pre
          class="mt-3 overflow-x-auto rounded-lg bg-base-200 p-3 text-sm"
          tabindex="0"
          aria-label="Example orchestrate command"
        ><code>/orchestrate Add user authentication</code></pre>
        <p class="mt-2 text-xs text-base-content-muted">
          The orchestrator will analyze your task and coordinate specialized
          agents.
        </p>
        <div class="mt-5 grid gap-5 min-[640px]:grid-cols-2">
          <div>
            <h3 class="text-sm font-semibold" data-testid="done-workflow-types">
              Available Workflow Types
            </h3>
            <ul class="mt-2 grid grid-cols-2 gap-2 text-xs">
              <li class="rounded border border-base-300 p-2">✨ FEATURE</li>
              <li class="rounded border border-base-300 p-2">🐛 BUGFIX</li>
              <li class="rounded border border-base-300 p-2">🔧 REFACTORING</li>
              <li class="rounded border border-base-300 p-2">📚 DOCS</li>
              <li class="rounded border border-base-300 p-2">🔍 RESEARCH</li>
              <li class="rounded border border-base-300 p-2">⚙️ DEVOPS</li>
            </ul>
            <div class="mt-5 rounded-lg bg-base-200 p-3">
              <h3 class="text-sm font-semibold" data-testid="done-pro-tips">
                Pro Tips
              </h3>
              <ul
                class="mt-2 list-inside list-disc space-y-1 text-xs text-base-content-muted"
              >
                <li>
                  Use
                  <code class="rounded bg-base-300 px-1 py-0.5"
                    >@agent-name</code
                  >
                  to invoke specific agents
                </li>
                <li>
                  Progress saved in
                  <code class="rounded bg-base-300 px-1 py-0.5"
                    >.ptah/specs/</code
                  >
                </li>
              </ul>
            </div>
          </div>
          <div>
            <h3
              class="text-sm font-semibold"
              data-testid="done-example-commands"
            >
              Example Commands
            </h3>
            <ul class="mt-2 space-y-2 text-xs">
              <li>
                <code class="block overflow-x-auto rounded bg-base-200 p-2"
                  >/orchestrate Fix login form validation</code
                ><span class="text-base-content-muted"># BUGFIX workflow</span>
              </li>
              <li>
                <code class="block overflow-x-auto rounded bg-base-200 p-2"
                  >/orchestrate Refactor UserService</code
                ><span class="text-base-content-muted"
                  ># REFACTORING workflow</span
                >
              </li>
              <li>
                <code class="block overflow-x-auto rounded bg-base-200 p-2"
                  >/orchestrate Create API docs</code
                ><span class="text-base-content-muted"
                  ># DOCUMENTATION workflow</span
                >
              </li>
            </ul>
            <h4 class="mt-4 text-xs font-semibold">Continue Existing Tasks</h4>
            <code
              class="mt-2 block overflow-x-auto rounded bg-base-200 p-2 text-xs"
              >/orchestrate TASK_2025_XXX</code
            >
            <p class="mt-1 text-xs text-base-content-muted">
              # Resumes from checkpoint
            </p>
          </div>
        </div>
      </section>
      <nav
        class="flex flex-col gap-2 min-[480px]:flex-row min-[480px]:flex-wrap"
        aria-label="Next steps"
      >
        <button
          type="button"
          class="btn btn-primary min-h-9 w-full min-[480px]:w-auto"
          data-testid="done-open-chat"
          (click)="openChat()"
        >
          Open chat
        </button>
        <button
          type="button"
          class="btn min-h-9 w-full min-[480px]:w-auto"
          data-testid="done-command-center"
          (click)="commandCenter()"
        >
          Command center
        </button>
        <button
          type="button"
          class="btn min-h-9 w-full min-[480px]:w-auto"
          data-testid="done-tribunal"
          (click)="tribunal()"
        >
          Get a second opinion in chat
        </button>
        <button
          type="button"
          class="btn btn-ghost min-h-9 w-full min-[480px]:w-auto"
          data-testid="done-run-again"
          (click)="runAgain()"
        >
          Run setup again
        </button>
      </nav>
    </section>
  `,
})
export class AnalyzeDonePage implements OnInit {
  protected readonly steps = DONE_STEPS;
  protected readonly agents = signal<SetupGenerationRunState | null>(null);
  protected readonly agentState = signal<FactState>('loading');
  protected readonly guidanceState = signal<FactState>('loading');
  protected readonly isElectron = inject(VSCodeService).isElectron === true;
  protected readonly outcomeRows = computed<OutcomeFileRow[]>(() =>
    (this.agents()?.result?.agentOutcomes ?? []).flatMap((outcome) => {
      if (outcome.status === 'skipped') return [];
      const status: FileOutcome =
        outcome.status === 'rejected' ? 'failed' : outcome.status;
      return [
        {
          id: outcome.agentId,
          fileName: outcome.fileName || `${outcome.agentId}.md`,
          status,
          ...(outcome.error ? { error: outcome.error } : {}),
        },
      ];
    }),
  );
  protected readonly showsLibrary = computed(() =>
    libraryReachable(this.isElectron, this.agents()?.result?.target),
  );
  protected readonly outputDirectory = computed(() => {
    const target = this.agents()?.result?.target;
    if (!target) return null;
    return target.chosen === 'opened-folder'
      ? target.openedFolder
      : target.harnessRoot;
  });
  protected readonly guidance = signal<SetupGenerationRunState | null>(null);
  protected readonly guidanceEnabled = signal<boolean | null>(null);
  private readonly setupReady = computed(
    () =>
      !this.hasFailures() &&
      (this.agents()?.status === 'completed' ||
        this.agentState() === 'missing'),
  );
  protected readonly pageHeading = computed(() =>
    this.setupReady() ? "You're ready to work" : 'Review workspace setup',
  );
  protected readonly pageSubtitle = computed(() => {
    if (this.setupReady()) {
      return 'Your workspace setup is complete. You can return to these steps anytime.';
    }
    return this.agents()
      ? 'Review the agent run and return to these steps anytime.'
      : 'Review the setup steps below and return to them anytime.';
  });
  protected readonly outcomeHeading = computed(() => {
    const status = this.agents()?.status;
    if (status === 'cancelled') return 'Setup Cancelled';
    if (status === 'timed-out') return 'Setup Timed Out';
    return this.hasFailures()
      ? 'Setup Finished With Errors'
      : 'Setup Complete!';
  });
  protected readonly hasFailures = computed(
    () =>
      (this.agents()?.result?.counts?.failed ?? 0) > 0 ||
      this.outcomeRows().some((row) => row.status === 'failed') ||
      this.agents()?.result?.success === false ||
      ['failed', 'cancelled', 'timed-out'].includes(
        this.agents()?.status ?? '',
      ),
  );
  protected readonly generationErrors = computed(() => {
    const runResult = this.agents()?.result;
    if (!runResult) return [];
    // Older host payloads may carry errors on the bound result even though
    // the current shared contract does not declare that optional field.
    const boundErrors: unknown =
      'errors' in runResult ? runResult.errors : null;
    if (Array.isArray(boundErrors))
      return boundErrors
        .filter((error): error is string => typeof error === 'string')
        .map((error) =>
          safeFailureCopy(
            error,
            'An agent could not be generated. Review the run.',
          ),
        );
    const completion = this.wizardState.completionData();
    if (!completion?.result || !completion.errors?.length) return [];
    // The completion payload has no run ID. Only use it when its result facts
    // agree with the bound run, so a previous run cannot supply its errors.
    const saved = completion.result;
    if (
      saved.status !== runResult.status ||
      saved.counts?.total !== runResult.counts?.total ||
      saved.counts?.failed !== runResult.counts?.failed ||
      saved.agentOutcomes?.length !== runResult.agentOutcomes?.length ||
      saved.agentOutcomes?.some(
        (outcome, index) =>
          outcome.agentId !== runResult.agentOutcomes?.[index]?.agentId ||
          outcome.status !== runResult.agentOutcomes?.[index]?.status,
      )
    )
      return [];
    return completion.errors.map((error) =>
      safeFailureCopy(
        error,
        'An agent could not be generated. Review the run.',
      ),
    );
  });
  private readonly queryParams = signal<ParamMap | null>(null);
  protected readonly generateLink = () =>
    onboardingStepLink('guidance', 'generate', {
      gen: this.queryParams()?.get('gen') ?? null,
    });
  private readonly flags = inject(OnboardingFlagService);
  private readonly vscode = inject(VSCodeService);
  private readonly appState = inject(AppStateManager);
  private readonly rpc = inject(WizardRpcService);
  private readonly wizardState = inject(SetupWizardStateService);
  private readonly tabs = inject(TabManagerService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private destroyed = false;
  private lookupVersion = 0;
  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
    });
  }

  ngOnInit(): void {
    this.flags.markCompleted();
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        this.queryParams.set(params);
        void this.reloadFacts(params);
      });
  }

  private async reloadFacts(params: ParamMap): Promise<void> {
    const version = ++this.lookupVersion;
    this.agents.set(null);
    this.guidance.set(null);
    this.guidanceEnabled.set(null);
    this.agentState.set('loading');
    this.guidanceState.set('loading');
    await Promise.all([
      this.loadFact(
        params.get('gen'),
        'setup-agent-generation',
        this.agents,
        this.agentState,
        version,
      ),
      this.loadFact(
        params.get('tab'),
        'setup-project-prompt',
        this.guidance,
        this.guidanceState,
        version,
      ),
    ]);
    if (this.destroyed || version !== this.lookupVersion) return;
    const workspacePath =
      this.tabs.activeWorkspacePath || this.vscode.config().workspaceRoot;
    if (workspacePath) {
      try {
        const status = await this.rpc.getEnhancedPromptsStatus(workspacePath);
        if (this.destroyed || version !== this.lookupVersion) return;
        if (!status.error) {
          this.guidanceEnabled.set(status.enabled);
        }
      } catch {
        /* The run fact still describes guidance when saved status is unavailable. */
      }
    }
  }
  private async loadFact(
    tabId: string | null,
    workflow: SetupGenerationTabBinding['workflow'],
    target: WritableSignal<SetupGenerationRunState | null>,
    state: WritableSignal<FactState>,
    version: number,
  ): Promise<void> {
    if (!tabId) {
      state.set('missing');
      return;
    }
    const workspacePath =
      this.tabs.activeWorkspacePath || this.vscode.config().workspaceRoot;
    if (!workspacePath) {
      state.set('missing');
      return;
    }
    const binding: SetupGenerationTabBinding = {
      tabId,
      workflow,
      workspacePath,
    };
    if (!findBoundGenerationTab(this.tabs, binding)) {
      state.set('mismatched-tab');
      return;
    }
    try {
      const run = await this.rpc.getBoundRunState(binding);
      if (this.destroyed || version !== this.lookupVersion) return;
      if (!run) {
        state.set('missing');
      } else if (
        ['completed', 'cancelled', 'failed', 'timed-out'].includes(run.status)
      ) {
        target.set(run);
        state.set('ready');
      } else {
        state.set('running');
      }
    } catch {
      if (!this.destroyed && version === this.lookupVersion)
        state.set('failed-lookup');
    }
  }
  protected openChat(): void {
    this.vscode.postMessage({ type: MESSAGE_TYPES.SETUP_WIZARD_COMPLETE });
    this.appState.setCurrentView('chat');
  }
  protected openLibrary(): void {
    this.appState.openSkillsDivergedClones();
  }
  protected async commandCenter(): Promise<void> {
    await this.router.navigate(['/command-center']);
    if (this.destroyed) return;
  }
  protected async tribunal(): Promise<void> {
    this.openChat();
    await this.router.navigate(['/chat']);
    if (this.destroyed) return;
  }
  protected async runAgain(): Promise<void> {
    await this.router.navigate(['/onboarding', 'analyze']);
    if (this.destroyed) return;
  }
}
