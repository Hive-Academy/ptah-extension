import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { LucideAngularModule, Target } from 'lucide-angular';

@Component({
  selector: 'ptah-step-objective',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  template: `
    <div class="flex flex-col gap-4" data-testid="tribunal-step-objective">
      <header class="flex flex-col gap-1">
        <h3 class="text-base font-semibold text-base-content">
          State the objective
        </h3>
        <p class="text-sm text-base-content/55">
          Describe the task the panel should work on. Every panelist receives
          this objective.
        </p>
      </header>

      <label class="flex flex-col gap-2">
        <span class="flex items-center gap-2 text-xs text-base-content/55">
          <lucide-angular
            [img]="TargetIcon"
            class="h-3.5 w-3.5"
            aria-hidden="true"
          />
          Objective
        </span>
        <textarea
          class="textarea textarea-bordered min-h-[8rem] w-full text-sm"
          rows="5"
          placeholder="e.g. Refactor the auth guard so it enforces the configured route protection."
          aria-label="Tribunal objective"
          [value]="objective()"
          (input)="onInput($event)"
        ></textarea>
      </label>

      @if (objective().trim().length === 0) {
        <p class="text-xs text-base-content/45">
          An objective is required before you can convene the Tribunal.
        </p>
      }
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
export class StepObjectiveComponent {
  readonly objective = input<string>('');
  readonly objectiveChanged = output<string>();

  protected readonly TargetIcon = Target;

  protected onInput(event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value;
    this.objectiveChanged.emit(value);
  }
}
