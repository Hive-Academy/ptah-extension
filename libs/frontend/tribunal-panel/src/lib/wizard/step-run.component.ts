import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule, Scale } from 'lucide-angular';
import { TribunalRunService } from '../services/tribunal-run.service';
import type { TribunalMove, VendorLane } from '../types/tribunal-ui.types';

@Component({
  selector: 'ptah-step-run',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  template: `
    <div
      class="flex flex-col items-center gap-4 py-4 text-center"
      data-testid="tribunal-step-run"
    >
      <div
        class="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"
      >
        <lucide-angular [img]="ScaleIcon" class="h-7 w-7" aria-hidden="true" />
      </div>
      <div class="flex flex-col gap-1">
        <h3 class="text-base font-semibold text-base-content">
          Ready to convene
        </h3>
        <p class="max-w-sm text-sm text-base-content/55">
          {{ lanes().length }} vendor(s) will join the {{ move() }}. The page
          switches to the live grid — type your objective in the conductor chat
          to start the run.
        </p>
      </div>

      @if (error()) {
        <p class="text-xs text-error" role="alert">{{ error() }}</p>
      }

      <button
        type="button"
        class="btn btn-primary gap-2"
        [disabled]="lanes().length === 0"
        aria-label="Open the Tribunal"
        (click)="run()"
      >
        <lucide-angular [img]="ScaleIcon" class="h-4 w-4" aria-hidden="true" />
        Open Tribunal
      </button>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class StepRunComponent {
  readonly move = input<TribunalMove>('council');
  readonly lanes = input<readonly VendorLane[]>([]);
  readonly launched = output<void>();

  private readonly runService = inject(TribunalRunService);

  private readonly _error = signal<string | null>(null);

  protected readonly error = this._error.asReadonly();

  protected readonly ScaleIcon = Scale;

  protected run(): void {
    if (this.lanes().length === 0) return;
    this._error.set(null);
    const ok = this.runService.prepare(this.move(), this.lanes());
    if (ok) {
      this.launched.emit();
    } else {
      this._error.set('Failed to open the Tribunal. Please try again.');
    }
  }
}
