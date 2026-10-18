import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { GenerationWorkflowStore } from '../services/generation-workflow.store';
import {
  GuidanceGenerationStore,
  type GuidanceRunStatus,
} from '../services/guidance-generation.store';
import { GuidanceRunCardComponent } from './guidance-run-card.component';
import { GuidanceResultPanelComponent } from './guidance-result-panel.component';

@Component({
  selector: 'ptah-generation-guidance-page',
  standalone: true,
  imports: [GuidanceRunCardComponent, GuidanceResultPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="rounded-lg border border-base-300 bg-base-200 p-4 text-sm"
      aria-label="Context source"
    >
      <h2 class="font-semibold">Context source</h2>
      <p class="text-base-content-muted">
        {{ guidance.source() ?? 'Checked when the run starts' }}
      </p>
    </section>
    <ptah-guidance-run-card
      [status]="status()"
      [snapshot]="guidance.snapshot()"
      (stopRequested)="workflow.stop()"
      (retryRequested)="workflow.startGuidance()"
      (refreshRequested)="refresh()"
    />
    @if (!workflow.isBound()) {
      <button
        type="button"
        class="btn btn-primary btn-sm"
        (click)="workflow.startGuidance()"
        [disabled]="workflow.isBound()"
      >
        Generate guidance
      </button>
    }
    @if (workflow.rejection(); as rejection) {
      <p class="alert alert-warning text-sm" role="alert">
        @if (rejection.reason === 'blocked') {
          This run is active in another tab.
        } @else if (rejection.reason === 'workspace-mismatch') {
          Switch to this workspace before generating guidance.
        } @else {
          Project guidance could not start. Try again.
        }
      </p>
    }
    @if (workflow.chatTurnRejection()) {
      <p class="alert alert-warning text-sm" role="alert">
        Finish this chat reply first.
      </p>
    }
    @if (workflow.startError()) {
      <p class="alert alert-warning text-sm" role="alert">
        The selected model is not available for this provider.
      </p>
    }
    @if (
      guidance.run()?.committedState === 'unchanged' && status() === 'completed'
    ) {
      <p role="status">
        Saved guidance was already current; nothing needed changing.
      </p>
    }
    <ptah-guidance-result-panel
      [result]="guidance.result()"
      [runActive]="workflow.isBound()"
      (enabledChanged)="guidance.setEnabled($event)"
      (cacheRequested)="guidance.refreshCommitted()"
      (contentRequested)="guidance.loadContent()"
      (downloadRequested)="guidance.download()"
      (regenerateRequested)="workflow.regenerateGuidance()"
    />
    @if (guidance.content(); as content) {
      <section
        class="rounded-lg border border-base-300 p-4"
        aria-label="Saved guidance content"
      >
        <h2 class="font-semibold">Saved guidance</h2>
        <pre class="whitespace-pre-wrap break-words text-sm">{{ content }}</pre>
      </section>
    }
    @if (guidance.actionFailed()) {
      <p role="alert">The guidance action could not be completed. Try again.</p>
    }
  `,
})
export class GenerationGuidancePageComponent {
  readonly workflow = inject(GenerationWorkflowStore);
  readonly guidance = inject(GuidanceGenerationStore);
  readonly status = computed<GuidanceRunStatus>(() => {
    const state = this.workflow.state();
    if (this.workflow.isBound()) {
      if (state === 'quiet') return 'running';
      if (state === 'stop-unconfirmed') return 'stop-unknown';
      return state as GuidanceRunStatus;
    }
    return this.guidance.status();
  });
  refresh(): void {
    void this.workflow.refresh();
    void this.guidance.refresh();
  }
}
