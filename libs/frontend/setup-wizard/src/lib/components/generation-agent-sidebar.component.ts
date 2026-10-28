import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  ModelStateService,
  ProvidersSettingsStateService,
} from '@ptah-extension/core';
import type { SetupGenerationWorkflow } from '@ptah-extension/shared';
import { GenerationWorkflowStore } from '../services/generation-workflow.store';
import { AgentGenerationStore } from '../services/agent-generation.store';
import { GenerationHandoffStore } from '../services/generation-handoff.store';
import { AgentSelectionListComponent } from './agent-selection-list.component';
import { AgentRunCardComponent } from './agent-run-card.component';
import { AgentGenerationProgressComponent } from './agent-generation-progress.component';
import { AgentNextStepsComponent } from './agent-next-steps.component';
type AgentBinding = {
  tabId: string;
  workspacePath: string;
  workflow: SetupGenerationWorkflow;
};
@Component({
  selector: 'ptah-generation-agent-sidebar',
  standalone: true,
  imports: [
    AgentSelectionListComponent,
    AgentRunCardComponent,
    AgentGenerationProgressComponent,
    AgentNextStepsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-agent-run-card
      [state]="store.state()"
      [run]="store.run()"
      (resumeRequested)="store.resumeBoundAgents()"
    />
    @if (agents.resumable(); as checkpoint) {
      @if (!store.run()) {
        <div class="alert alert-info block">
          <p>Saved agent run available. Resume keeps completed agents.</p>
          <button
            type="button"
            class="btn btn-outline btn-sm"
            [disabled]="agents.loading() || store.isBound()"
            (click)="store.resumeCheckpoint()"
          >
            Resume saved run
          </button>
        </div>
      }
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
          No saved project guidance is available. Generate guidance first if you
          want these agents to use it.
        </p>
        <button
          type="button"
          class="btn btn-outline btn-sm"
          (click)="handoff.manualContinue(binding().workspacePath)"
        >
          Generate guidance first
        </button>
      </div>
    }
    @if (!store.isBound()) {
      <!-- Deferred: the list, packs panel and their stores stay out of the initial bundle. -->
      @defer (on immediate) {
        <ptah-agent-selection-list
          [binding]="binding()"
          [primary]="!handoff.pending()"
        />
      }
    }
    @if (store.rejection(); as rejection) {
      <div class="alert alert-warning text-sm" role="alert">
        @if (rejection.reason === 'blocked') {
          This run is active in another tab{{
            rejection.ownerTabId ? ' (' + rejection.ownerTabId + ')' : ''
          }}.
        } @else if (rejection.reason === 'preview-required') {
          Review the generation preview before resuming.
        } @else {
          The saved run could not be resumed.
        }
      </div>
    }
    @if (store.startError(); as startError) {
      <p class="alert alert-warning text-sm" role="alert">
        {{ startError }}
      </p>
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
      @defer (on immediate) {
        <ptah-agent-next-steps
          [pending]="!!handoff.pending()"
          [remainingSeconds]="remainingSeconds()"
          [previewModel]="guidancePreviewModel()"
          [previewProvider]="guidancePreviewProvider()"
          [manualRecovery]="
            handoff.outcome() === 'manual-recovery' ||
            !hasVerifiedResults() ||
            store.state() === 'failed'
          "
          [skipped]="handoff.outcome() === 'skipped'"
          [started]="handoff.outcome() === 'started'"
          (startNow)="handoff.startNow()"
          (continue)="handoff.manualContinue(binding().workspacePath)"
          (skip)="handoff.skip()"
        />
      }
    }
  `,
})
export class GenerationAgentSidebarComponent {
  readonly binding = input.required<AgentBinding>();
  readonly store = inject(GenerationWorkflowStore);
  readonly agents = inject(AgentGenerationStore);
  readonly handoff = inject(GenerationHandoffStore);
  private readonly tabs = inject(TabManagerService);
  private readonly models = inject(ModelStateService, { optional: true });
  private readonly providers = inject(ProvidersSettingsStateService, {
    optional: true,
  });
  readonly now = input.required<number>();
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
  readonly guidancePreviewModel = computed(() => {
    const pending = this.handoff.pending();
    if (!pending) return null;
    this.tabs.tabs();
    const tab = this.tabs.findWorkflowTab(
      pending.workspacePath,
      'setup-project-prompt',
    );
    return tab?.overrideModel ?? this.models?.currentModel() ?? null;
  });
  readonly guidancePreviewProvider = computed(() =>
    this.handoff.pending()?.workspacePath === this.tabs.activeWorkspacePath
      ? (this.providers?.activeProviderId() ?? null)
      : null,
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
  propagationConsentLabel(status: string, consent: string): string {
    return status === 'not-attempted' ? 'not attempted' : consent;
  }
}
