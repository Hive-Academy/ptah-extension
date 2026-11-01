import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LucideAngularModule, Play } from 'lucide-angular';
import { RunStatusChipComponent } from '../shared/run-status-chip.component';

@Component({
  selector: 'ptah-resume-banner',
  standalone: true,
  imports: [LucideAngularModule, RunStatusChipComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section class="flex flex-wrap items-center gap-3 rounded-[14px] border border-state-need/70 p-4"
             data-glass-surface="chrome" aria-label="Continue an interrupted run">
      <ptah-run-status-chip state="resumable" />
      <div class="min-w-0 flex-1"><p class="font-medium">{{ title() }}</p>
        @if (detail(); as fact) {<p class="text-sm text-base-content-muted">{{ fact }}</p>}
      </div>
      <button type="button" class="btn btn-primary btn-sm min-h-8" (click)="resumeRequested.emit()">
        <lucide-angular [img]="icons.play" class="size-4" aria-hidden="true" />Resume
      </button>
    </section>
  `,
})
export class ResumeBannerComponent {
  readonly title = input.required<string>();
  readonly detail = input<string | null>(null);
  readonly resumeRequested = output<void>();
  protected readonly icons = { play: Play } as const;
}
