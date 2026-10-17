import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { GenerationContextSource } from '@ptah-extension/shared';

@Component({
  selector: 'ptah-generation-source-status',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="rounded-lg border border-base-300 bg-base-200 p-3"
      aria-labelledby="generation-source-title"
    >
      <h3 id="generation-source-title" class="font-semibold">Context source</h3>
      @if (source(); as current) {
        @if (current.kind === 'verified-analysis') {
          <p class="text-sm">Verified latest analysis</p>
          <p class="text-xs text-base-content/70">
            The host verified this analysis for the current workspace.
          </p>
        } @else {
          <p class="text-sm">Workspace discovery</p>
          <p class="text-xs text-base-content/70">
            {{ reasonLabel() }} The workspace will be inspected when generation
            starts.
          </p>
        }
        @if (recorded()) {
          <p class="text-xs text-base-content/70">Recorded for this run.</p>
        }
      } @else {
        <p class="text-sm text-base-content/70">
          Context source is checked when generation starts.
        </p>
      }
    </section>
  `,
})
export class GenerationSourceStatusComponent {
  readonly source = input<GenerationContextSource | null>(null);
  readonly recorded = input(false);
  readonly reasonLabel = computed(() => {
    const source = this.source();
    switch (source?.kind === 'workspace-discovery' ? source.reason : null) {
      case 'stale':
        return 'The saved analysis is out of date.';
      case 'not-latest':
        return 'A newer analysis exists.';
      case 'unreadable':
        return 'The saved analysis could not be read.';
      case 'lookup-failed':
        return 'The latest analysis could not be checked.';
      default:
        return 'No current analysis is available.';
    }
  });
}
