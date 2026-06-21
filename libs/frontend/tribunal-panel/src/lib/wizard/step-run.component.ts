import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule, Scale, Loader2 } from 'lucide-angular';
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
          will switch to the live grid once the run starts.
        </p>
      </div>

      @if (error()) {
        <p class="text-xs text-error" role="alert">{{ error() }}</p>
      }

      <button
        type="button"
        class="btn btn-primary gap-2"
        [disabled]="
          launching() || lanes().length === 0 || objective().trim().length === 0
        "
        aria-label="Convene the Tribunal"
        (click)="run()"
      >
        @if (launching()) {
          <lucide-angular
            [img]="LoaderIcon"
            class="h-4 w-4 animate-spin"
            aria-hidden="true"
          />
          Convening…
        } @else {
          <lucide-angular
            [img]="ScaleIcon"
            class="h-4 w-4"
            aria-hidden="true"
          />
          Convene Tribunal
        }
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
  readonly objective = input<string>('');
  readonly launched = output<void>();

  private readonly runService = inject(TribunalRunService);

  private readonly _launching = signal(false);
  private readonly _error = signal<string | null>(null);

  protected readonly launching = this._launching.asReadonly();
  protected readonly error = this._error.asReadonly();

  protected readonly ScaleIcon = Scale;
  protected readonly LoaderIcon = Loader2;

  protected async run(): Promise<void> {
    if (this._launching() || this.lanes().length === 0) return;
    if (this.objective().trim().length === 0) {
      this._error.set('An objective is required to convene the Tribunal.');
      return;
    }
    this._launching.set(true);
    this._error.set(null);
    try {
      const ok = await this.runService.launch(
        this.move(),
        this.lanes(),
        this.objective(),
      );
      if (ok) {
        this.launched.emit();
      } else {
        this._error.set('Failed to start the Tribunal. Please try again.');
      }
    } catch (error: unknown) {
      this._error.set(
        error instanceof Error
          ? error.message
          : 'Failed to start the Tribunal.',
      );
    } finally {
      this._launching.set(false);
    }
  }
}
