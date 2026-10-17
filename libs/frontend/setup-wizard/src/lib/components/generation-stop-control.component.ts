import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';

@Component({
  selector: 'ptah-generation-stop-control',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (active()) {
      <button
        type="button"
        class="btn btn-sm btn-outline"
        (click)="stopRequested.emit()"
      >
        Stop generation
      </button>
      <p class="text-xs text-base-content-muted">
        Stopping may take a moment. Saved results remain available.
      </p>
    }
  `,
})
export class GenerationStopControlComponent {
  readonly active = input(false);
  readonly stopRequested = output<void>();
}
