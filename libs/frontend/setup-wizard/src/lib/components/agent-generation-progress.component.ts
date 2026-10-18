import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import type { ResumableGenerationRun } from '@ptah-extension/shared';

@Component({
  selector: 'ptah-agent-generation-progress',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (checkpoint(); as run) {
      <section class="space-y-2" aria-label="Saved agent progress">
        @for (agent of run.agents; track agent.agentId) {
          <div
            class="flex items-center justify-between gap-2 rounded border border-base-300 p-2"
          >
            <span class="min-w-0 truncate">{{ agent.agentId }}</span>
            <span class="badge badge-outline">{{ agent.status }}</span>
            @if (agent.status === 'failed') {
              <button
                type="button"
                class="btn btn-outline btn-xs"
                [disabled]="
                  retrying().has(agent.agentId) ||
                  remaining()[agent.agentId] === 0
                "
                (click)="retry.emit(agent.agentId)"
              >
                Retry ({{ remaining()[agent.agentId] ?? 3 }} left)
              </button>
            }
          </div>
        }
      </section>
    }
  `,
})
export class AgentGenerationProgressComponent {
  readonly checkpoint = input<ResumableGenerationRun | null>(null);
  readonly remaining = input<Record<string, number>>({});
  readonly retrying = input<ReadonlySet<string>>(new Set());
  readonly retry = output<string>();
}
