import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { LucideAngularModule, Play, RotateCcw, Square } from 'lucide-angular';
import { safeFailureCopy, type GenerationViewState } from '@ptah-extension/setup-wizard';
import { RunStatusChipComponent, type OnboardingRunChipState } from './run-status-chip.component';

@Component({
  selector: 'ptah-run-panel',
  standalone: true,
  imports: [RunStatusChipComponent, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section class="rounded-[22px] border border-base-300 p-5" data-glass-surface="content" [attr.aria-label]="title()">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div><h2 class="text-lg font-semibold">{{ title() }}</h2><p class="text-sm text-base-content-muted">{{ message() }}</p></div>
        <ptah-run-status-chip [state]="state()" />
      </div>
      @if (safeError(); as errorText) {<p class="mt-3 text-sm text-state-err" role="alert">{{ errorText }}</p>}
      <ng-content />
      <div class="mt-4 flex flex-wrap gap-2">
        @if (state() === 'running') {
          <button type="button" class="btn btn-sm min-h-8" (click)="stop.emit()">
            <lucide-angular [img]="icons.stop" class="size-4" aria-hidden="true" />Stop
          </button>
        } @else if (state() === 'failed' || needsStopRecovery()) {
          <button type="button" class="btn btn-sm min-h-8" (click)="retry.emit()">
            <lucide-angular [img]="icons.retry" class="size-4" aria-hidden="true" />Retry
          </button>
          <button type="button" class="btn btn-sm min-h-8" (click)="startOver.emit()">Start over</button>
        } @else if (state() === 'resumable') {
          <button type="button" class="btn btn-primary btn-sm min-h-8" (click)="resumeRequested.emit()">
            <lucide-angular [img]="icons.play" class="size-4" aria-hidden="true" />Resume
          </button>
        } @else if (state() === 'done') {
          <button type="button" class="btn btn-primary btn-sm min-h-8" (click)="continueRun.emit()">Continue</button>
        }
      </div>
    </section>
  `,
})
export class RunPanelComponent {
  readonly state = input.required<OnboardingRunChipState>();
  readonly viewState = input<GenerationViewState | null>(null);
  readonly title = input.required<string>();
  readonly message = input<string>('');
  readonly error = input<string | null>(null);
  protected readonly safeError = computed(() => {
    const raw = this.error();
    return raw === null ? null : safeFailureCopy(raw, 'The run could not be completed. Try again.');
  });
  protected readonly needsStopRecovery = computed(() =>
    this.state() === 'cancelling' &&
    (this.viewState() === 'stop-unconfirmed' || this.viewState() === 'stop-unknown'),
  );
  readonly stop = output<void>();
  readonly retry = output<void>();
  readonly startOver = output<void>();
  readonly resumeRequested = output<void>();
  readonly continueRun = output<void>();
  protected readonly icons = { stop: Square, retry: RotateCcw, play: Play } as const;
}
