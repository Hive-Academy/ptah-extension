import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CircleCheck, CircleDashed, CircleX, FastForward, Loader, LucideAngularModule } from 'lucide-angular';
import type { PhaseRow, PhaseStatus } from './analysis-step.store';

const copy: Record<PhaseStatus, string> = {
  pending: 'Waiting', running: 'Running', completed: 'Completed', failed: 'Failed', skipped: 'Skipped',
};

@Component({
  selector: 'ptah-phase-list', standalone: true, imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush, host: { class: 'block' },
  template: `
    <ol class="space-y-2" aria-label="Analysis phases">
      @for (phase of phases(); track phase.id) {
        <li class="flex flex-wrap items-center gap-3 rounded-[10px] border border-base-300 px-4 py-3" data-glass-surface="tile" [attr.data-status]="phase.status">
          <lucide-angular [img]="icon(phase.status)" class="size-4 shrink-0" aria-hidden="true" />
          <span class="min-w-0 flex-1 font-medium">{{ phase.label }}</span>
          <span class="text-sm text-base-content-muted">{{ label(phase.status) }}</span>
          @if (phase.durationMs !== undefined && phase.status === 'completed') {
            <span class="text-xs text-base-content-muted">{{ duration(phase.durationMs) }}</span>
          }
        </li>
      }
    </ol>
  `,
})
export class PhaseListComponent {
  readonly phases = input.required<readonly PhaseRow[]>();
  protected label(status: PhaseStatus): string { return copy[status]; }
  protected icon(status: PhaseStatus) {
    return { pending: CircleDashed, running: Loader, completed: CircleCheck, failed: CircleX, skipped: FastForward }[status];
  }
  protected duration(ms: number): string { return `${Math.round(ms / 1000)}s`; }
}
