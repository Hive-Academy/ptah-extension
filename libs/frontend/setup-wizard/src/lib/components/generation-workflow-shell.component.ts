import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  SessionEmbedComponent,
  type SessionStopHandler,
} from '@ptah-extension/chat';
import { TabManagerService } from '@ptah-extension/chat-state';
import { GenerationWorkflowLauncherService } from '@ptah-extension/chat-ui';
import type { SetupGenerationWorkflow } from '@ptah-extension/shared';
import { GenerationWorkflowStore } from '../services/generation-workflow.store';
import { AgentGenerationStore } from '../services/agent-generation.store';
import { GenerationHandoffStore } from '../services/generation-handoff.store';
import { GuidanceGenerationStore } from '../services/guidance-generation.store';
import { GenerationGuidancePageComponent } from './generation-guidance-page.component';
import { AgentSelectionListComponent } from './agent-selection-list.component';
import { AgentRunCardComponent } from './agent-run-card.component';
import { AgentGenerationProgressComponent } from './agent-generation-progress.component';
import { AgentNextStepsComponent } from './agent-next-steps.component';
import { GenerationErrorsComponent } from './generation-errors.component';
import { GenerationStopControlComponent } from './generation-stop-control.component';

@Component({
  selector: 'ptah-generation-workflow-shell',
  standalone: true,
  imports: [
    SessionEmbedComponent,
    AgentSelectionListComponent,
    AgentRunCardComponent,
    AgentGenerationProgressComponent,
    AgentNextStepsComponent,
    GenerationErrorsComponent,
    GenerationStopControlComponent,
    GenerationGuidancePageComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (binding(); as current) {
      <section
        class="flex h-full min-h-0 flex-col"
        aria-label="Generation workflow"
      >
        <div class="sr-only" role="status">{{ store.state() }}</div>
        <div
          class="min-h-0 overflow-y-auto border-b border-base-300 p-3 space-y-3"
        >
          @if (current.workflow === 'setup-agent-generation') {
            <ptah-agent-run-card
              [state]="store.state()"
              [run]="store.run()"
              (resumeRequested)="store.resumeBoundAgents()"
            />
            @if (agents.resumable(); as checkpoint) {
              <div class="alert alert-info block">
                <p>Saved agent run available. Resume keeps completed agents.</p>
                <button
                  type="button"
                  class="btn btn-outline btn-sm"
                  [disabled]="agents.loading()"
                  (click)="agents.resume()"
                >
                  Resume saved run
                </button>
              </div>
              <ptah-agent-generation-progress
                [checkpoint]="checkpoint"
                [remaining]="agents.remainingCounts()"
                [retrying]="agents.retryingIds()"
                (retry)="
                  agents.retry(
                    $event,
                    store.run()?.binding?.runId === checkpoint.runId
                      ? store.run()?.binding
                      : undefined
                  )
                "
              />
            }
            @if (agents.guidanceStatus() === 'missing' && !store.isBound()) {
              <div class="alert alert-info block text-sm">
                <p>
                  No saved project guidance is available. Generate guidance
                  first if you want these agents to use it.
                </p>
                <button
                  type="button"
                  class="btn btn-outline btn-sm"
                  (click)="handoff.manualContinue(current.workspacePath)"
                >
                  Generate guidance first
                </button>
              </div>
            }
            @if (!store.isBound()) {
              <ptah-agent-selection-list [binding]="current" />
            }
            @if (store.rejection(); as rejection) {
              <div class="alert alert-warning text-sm" role="alert">
                @if (rejection.reason === 'blocked') {
                  This run is active in another tab{{
                    rejection.ownerTabId
                      ? ' (' + rejection.ownerTabId + ')'
                      : ''
                  }}.
                } @else if (rejection.reason === 'preview-required') {
                  Review the generation preview before resuming.
                } @else {
                  The saved run could not be resumed.
                }
              </div>
            }
            @if (store.run()?.result; as result) {
              @if (
                result.counts &&
                result.agentOutcomes &&
                result.rejectedSections !== undefined &&
                result.tailoredSections !== undefined &&
                result.propagation
              ) {
                <section
                  class="rounded-lg border border-base-300 bg-base-200 p-4 text-sm"
                  aria-label="Verified agent results"
                >
                  <h2 class="font-semibold">Generated agents</h2>
                  <p>
                    {{ result.counts.total }} selected ·
                    {{ result.counts.written }} written ·
                    {{ result.counts.unchanged }} already current ·
                    {{ result.counts.failed }} failed ·
                    {{ result.counts.skipped }} skipped ·
                    {{ result.counts.rejected }} rejected
                  </p>
                  <p>
                    {{ result.rejectedSections }} sections rejected ·
                    {{ result.tailoredSections }} sections tailored
                  </p>
                  <ul class="list-disc pl-5">
                    @for (agent of result.agentOutcomes; track agent.agentId) {
                      <li>
                        {{ agent.fileName || agent.agentId }}:
                        {{ agent.status }}
                      </li>
                    }
                  </ul>
                  <p>
                    Propagation: {{ result.propagation.status }}; consent:
                    {{
                      propagationConsentLabel(
                        result.propagation.status,
                        result.propagation.consent
                      )
                    }}
                  </p>
                  <p>
                    Guidance used:
                    {{
                      result.enhancedPromptsUsed === undefined
                        ? 'unavailable'
                        : result.enhancedPromptsUsed
                          ? 'yes'
                          : 'no'
                    }}
                  </p>
                </section>
              } @else {
                <p role="status">
                  Verified results unavailable. Continue or skip manually.
                </p>
              }
            } @else if (showNextSteps()) {
              <p role="status">
                Verified results unavailable. Continue or skip manually.
              </p>
            }
            @if (showNextSteps()) {
              <ptah-agent-next-steps
                [pending]="!!handoff.pending()"
                [remainingSeconds]="remainingSeconds()"
                [manualRecovery]="
                  handoff.outcome() === 'manual-recovery' ||
                  !hasVerifiedResults() ||
                  store.state() === 'failed'
                "
                (startNow)="handoff.startNow()"
                (continue)="handoff.manualContinue(current.workspacePath)"
                (skip)="handoff.skip()"
              />
            }
          }
          @if (current.workflow === 'setup-project-prompt') {
            <ptah-generation-guidance-page />
          }
          <ptah-generation-errors
            [errors]="
              agents.error()
                ? ['The action could not be completed. Try again.']
                : []
            "
          />
          <ptah-generation-stop-control
            [active]="store.isBound()"
            (stopRequested)="store.stop()"
          />
          @if (store.isBound()) {
            <p class="text-sm" role="status">
              Finish or stop generation before sending a message.
            </p>
          }
        </div>
        <ptah-session-embed
          class="min-h-0 flex-1"
          [tabId]="current.tabId"
          [startGuard]="startGuard"
          [stopHandler]="stopHandler"
        />
      </section>
    } @else {
      <p role="alert">This generation tab is unavailable in this workspace.</p>
    }
  `,
})
export class GenerationWorkflowShellComponent {
  propagationConsentLabel(status: string, consent: string): string {
    return status === 'not-attempted' ? 'not attempted' : consent;
  }
  private readonly route = inject(ActivatedRoute);
  private readonly paramMap = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  private readonly tabs = inject(TabManagerService);
  private readonly launcher = inject(GenerationWorkflowLauncherService);
  private readonly destroyRef = inject(DestroyRef);
  readonly store = inject(GenerationWorkflowStore);
  readonly agents = inject(AgentGenerationStore);
  readonly handoff = inject(GenerationHandoffStore);
  readonly guidance = inject(GuidanceGenerationStore);
  private discoveryKey = '';
  private activeTabId: string | null = null;
  private combinedTabId: string | null = null;
  private scheduledRunId: string | null = null;
  private combinedBaselineRevision = 0;
  private readonly now = signal(Date.now());
  readonly remainingSeconds = computed(() =>
    Math.max(
      0,
      Math.ceil(
        ((this.handoff.pending()?.guidanceStartDeadline ?? this.now()) -
          this.now()) /
          1000,
      ),
    ),
  );
  readonly showNextSteps = computed(() => {
    const run = this.store.run();
    return (
      !!run &&
      ['completed', 'failed', 'cancelled', 'timed-out'].includes(run.status)
    );
  });
  readonly hasVerifiedResults = computed(() => {
    const result = this.store.run()?.result;
    return !!(
      result?.counts &&
      result.agentOutcomes &&
      result.propagation &&
      result.rejectedSections !== undefined &&
      result.tailoredSections !== undefined
    );
  });
  readonly binding = computed(
    () => {
      this.tabs.tabs();
      const workspacePath = this.tabs.activeWorkspacePath$();
      const tabId = this.paramMap().get('tabId');
      const workflow = this.paramMap().get('workflow');
      if (
        !workspacePath ||
        !tabId ||
        (workflow !== 'setup-agent-generation' &&
          workflow !== 'setup-project-prompt')
      )
        return null;
      const tab = this.tabs
        .getWorkspaceTabs(workspacePath)
        .find(
          (candidate) =>
            candidate.id === tabId && candidate.workflow === workflow,
        );
      return tab
        ? {
            tabId,
            workspacePath,
            workflow: workflow as SetupGenerationWorkflow,
          }
        : null;
    },
    {
      equal: (a, b) =>
        a?.tabId === b?.tabId &&
        a?.workflow === b?.workflow &&
        a?.workspacePath === b?.workspacePath,
    },
  );
  readonly startGuard = () =>
    this.store.isBound()
      ? 'Finish or stop generation before sending a message.'
      : null;
  readonly stopHandler: SessionStopHandler = (tabId) => {
    if (this.binding()?.tabId !== tabId || !this.store.isBound())
      return 'not-handled';
    this.store.stop();
    return 'handled';
  };

  constructor() {
    effect(() => {
      const binding = this.binding();
      if (binding) {
        this.activeTabId = binding.tabId;
        this.store.bind(binding);
        if (binding.workflow === 'setup-project-prompt')
          this.guidance.bind(binding);
        else this.guidance.unbind();
        const key = `${binding.workspacePath}\u0000${binding.tabId}\u0000${binding.workflow}`;
        if (
          binding.workflow === 'setup-agent-generation' &&
          key !== this.discoveryKey
        ) {
          this.discoveryKey = key;
          this.combinedTabId =
            this.launcher.consumeOrigin(binding.tabId) ===
            'analysis-result-continue'
              ? binding.tabId
              : null;
          this.combinedBaselineRevision =
            this.store.acceptedRun()?.revision ?? 0;
          void this.agents.discover();
          void this.agents.checkGuidance(binding.workspacePath);
        }
      } else {
        this.activeTabId = null;
        this.discoveryKey = '';
        this.combinedTabId = null;
        this.store.unbind();
        this.guidance.unbind();
      }
    });
    effect(() => {
      const run = this.store.run();
      if (run?.binding.workflow === 'setup-project-prompt')
        void this.guidance.refresh();
    });
    effect(() => {
      const run = this.store.run();
      const accepted = this.store.acceptedRun();
      if (
        run &&
        run.binding.tabId === this.combinedTabId &&
        accepted?.runId === run.binding.runId &&
        accepted.revision > this.combinedBaselineRevision &&
        run.status === 'completed' &&
        this.hasVerifiedResults() &&
        run.binding.runId !== this.scheduledRunId
      ) {
        this.scheduledRunId = run.binding.runId;
        this.handoff.schedule(run.binding.tabId, run.binding.workspacePath);
      }
    });
    this.destroyRef.onDestroy(() => {
      if (
        this.activeTabId &&
        this.handoff.pending()?.agentTabId === this.activeTabId
      )
        this.handoff.skip();
    });
    effect((onCleanup) => {
      if (!this.handoff.pending()) return;
      const timer = setInterval(() => this.now.set(Date.now()), 250);
      onCleanup(() => clearInterval(timer));
    });
  }
}
