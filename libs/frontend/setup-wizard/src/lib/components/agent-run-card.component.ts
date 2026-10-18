import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import type { SetupGenerationRunState } from '@ptah-extension/shared';
import type { GenerationViewState } from '../services/generation-workflow.store';

@Component({
  selector: 'ptah-agent-run-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="rounded-lg border border-base-300 bg-base-200 p-4"
      aria-labelledby="agent-run-title"
    >
      <h2 id="agent-run-title" class="font-semibold">Agent generation</h2>
      <p class="text-sm" role="status">{{ state() }}</p>
      @if (run()?.interrupted) {
        <p class="text-sm">
          This run was interrupted. Its saved outcomes can be recovered.
        </p>
        <button
          type="button"
          class="btn btn-outline btn-sm"
          (click)="resumeRequested.emit()"
        >
          Resume
        </button>
      }
      @if (state() === 'quiet') {
        <p class="text-sm">Waiting for a verified run update.</p>
      }
      @if (state() === 'failed' && !run()?.result) {
        <p class="text-sm">No verified agent result was saved for this run.</p>
      }
    </section>
  `,
})
export class AgentRunCardComponent {
  readonly state = input.required<GenerationViewState>();
  readonly run = input<SetupGenerationRunState | null>(null);
  readonly resumeRequested = output<void>();
}
