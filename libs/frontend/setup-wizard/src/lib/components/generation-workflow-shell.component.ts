import {
  ChangeDetectionStrategy,
  Component,
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
import type { SetupGenerationWorkflow } from '@ptah-extension/shared';
import { GenerationWorkflowStore } from '../services/generation-workflow.store';
import { AgentGenerationStore } from '../services/agent-generation.store';
import { GenerationHandoffStore } from '../services/generation-handoff.store';
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
              (resumeRequested)="agents.resume()"
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
                (retry)="agents.retry($event)"
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
            @if (store.run()?.result) {
              <p class="text-sm">
                Guidance used:
                {{ store.run()?.result?.enhancedPromptsUsed ? 'yes' : 'no' }}
              </p>
            }
            @if (showNextSteps()) {
              <ptah-agent-next-steps
                [pending]="!!handoff.pending()"
                [remainingSeconds]="remainingSeconds()"
                [manualRecovery]="
                  handoff.outcome() === 'manual-recovery' ||
                  store.state() === 'failed'
                "
                (startNow)="handoff.startNow()"
                (continue)="handoff.manualContinue(current.workspacePath)"
                (skip)="handoff.skip()"
              />
            }
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
  private readonly route = inject(ActivatedRoute);
  private readonly paramMap = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  private readonly tabs = inject(TabManagerService);
  readonly store = inject(GenerationWorkflowStore);
  readonly agents = inject(AgentGenerationStore);
  readonly handoff = inject(GenerationHandoffStore);
  private discoveryKey = '';
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
  readonly binding = computed(() => {
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
      ? { tabId, workspacePath, workflow: workflow as SetupGenerationWorkflow }
      : null;
  });
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
        this.store.bind(binding);
        const key = `${binding.workspacePath}\u0000${binding.tabId}\u0000${binding.workflow}`;
        if (
          binding.workflow === 'setup-agent-generation' &&
          key !== this.discoveryKey
        ) {
          this.discoveryKey = key;
          void this.agents.discover();
          void this.agents.checkGuidance(binding.workspacePath);
        }
      } else {
        this.discoveryKey = '';
        this.store.unbind();
      }
    });
    effect((onCleanup) => {
      if (!this.handoff.pending()) return;
      const timer = setInterval(() => this.now.set(Date.now()), 250);
      onCleanup(() => clearInterval(timer));
    });
  }
}
