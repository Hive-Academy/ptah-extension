import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CircleCheck, CircleDashed, CircleX, Loader, Pause, LucideAngularModule } from 'lucide-angular';
import type { GenerationViewState } from '@ptah-extension/setup-wizard';

export type OnboardingRunChipState = 'idle' | 'running' | 'cancelling' | 'failed' | 'resumable' | 'done';

export const INTERRUPTED_RUN_ICON = Pause;

const VIEW_TO_CHIP: Record<GenerationViewState, OnboardingRunChipState> = {
  idle: 'idle',
  starting: 'running',
  running: 'running',
  quiet: 'running',
  cancelling: 'cancelling',
  'stop-unconfirmed': 'cancelling',
  'stop-unknown': 'cancelling',
  completed: 'done',
  cancelled: 'resumable',
  failed: 'failed',
  'timed-out': 'failed',
};

export function chipStateFor(view: GenerationViewState): OnboardingRunChipState {
  return VIEW_TO_CHIP[view];
}

const CHIP = {
  idle: { label: 'Ready', icon: CircleDashed, className: 'text-base-content-muted' },
  running: { label: 'Running', icon: Loader, className: 'text-state-run' },
  cancelling: { label: 'Stopping', icon: Pause, className: 'text-state-need' },
  failed: { label: 'Failed', icon: CircleX, className: 'text-state-err' },
  resumable: { label: 'Interrupted', icon: INTERRUPTED_RUN_ICON, className: 'text-state-need' },
  done: { label: 'Done', icon: CircleCheck, className: 'text-state-done' },
} as const;

@Component({
  selector: 'ptah-run-status-chip',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex' },
  template: `
    <span class="inline-flex items-center gap-1.5 rounded-full border border-base-300 px-2.5 py-1 text-xs font-medium"
          data-glass-surface="tile" [class]="display().className" [attr.data-state]="state()">
      <lucide-angular [img]="display().icon" class="size-3.5 motion-reduce:animate-none"
                      [class.animate-spin]="state() === 'running'"
                      aria-hidden="true" />
      {{ display().label }}
    </span>
  `,
})
export class RunStatusChipComponent {
  readonly state = input.required<OnboardingRunChipState>();
  protected readonly display = computed(() => CHIP[this.state()]);
}
