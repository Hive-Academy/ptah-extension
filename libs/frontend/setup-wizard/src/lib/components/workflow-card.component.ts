import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';

@Component({
  selector: 'ptah-workflow-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="rounded-xl border border-base-300 bg-base-200 p-4"
      [attr.aria-labelledby]="id()"
    >
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <h3 class="font-bold" [id]="id()">
            {{ title() }}
            @if (optional()) {
              <span class="badge badge-sm">Optional</span>
            }
          </h3>
          <p class="text-sm text-base-content/70">{{ description() }}</p>
          <ng-content />
        </div>
        <button
          type="button"
          class="btn btn-outline btn-sm min-w-40"
          [disabled]="disabled()"
          (click)="open.emit()"
        >
          {{ action() }}
        </button>
      </div>
    </section>
  `,
})
export class WorkflowCardComponent {
  readonly id = input.required<string>();
  readonly title = input.required<string>();
  readonly description = input.required<string>();
  readonly action = input.required<string>();
  readonly optional = input(false);
  readonly disabled = input(false);
  readonly open = output<void>();
}
