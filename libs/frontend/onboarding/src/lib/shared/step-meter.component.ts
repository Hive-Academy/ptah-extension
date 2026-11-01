import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'ptah-step-meter',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="space-y-1.5">
      <div class="flex justify-between gap-3 text-xs"><span>{{ label() }}</span><span>{{ value() }}%</span></div>
      <div role="progressbar" [attr.aria-label]="label()" aria-valuemin="0" aria-valuemax="100"
           [attr.aria-valuenow]="value()" class="h-2 overflow-hidden rounded-full bg-base-300" data-glass-surface="tile">
        <div class="h-full rounded-full bg-primary transition-[width] duration-[400ms] motion-reduce:transition-none"
             [style.width.%]="value()"></div>
      </div>
    </div>
  `,
})
export class StepMeterComponent {
  readonly label = input.required<string>();
  readonly percent = input.required<number>();
  protected readonly value = computed(() => Math.max(0, Math.min(100, Number.isFinite(this.percent()) ? Math.round(this.percent()) : 0)));
}
