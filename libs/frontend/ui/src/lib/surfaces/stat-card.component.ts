import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'ptah-stat-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<article class="surface-2 rounded-xl p-4">
    <div class="flex items-start justify-between gap-2">
      <div>
        <p class="text-xs font-medium text-base-content-muted">{{ label() }}</p>
        <p class="mt-1 text-2xl font-semibold">{{ value() }}</p>
        @if (trend()) {
          <p class="mt-1 text-xs text-base-content-muted">{{ trend() }}</p>
        }
      </div>
      <ng-content select="[actions]" />
    </div>
    <ng-content />
  </article>`,
})
export class PtahStatCardComponent {
  readonly label = input.required<string>();
  readonly value = input.required<string | number>();
  readonly trend = input<string | null>(null);
}
