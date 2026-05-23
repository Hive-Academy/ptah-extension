import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { EligibilityHistogramDto } from '@ptah-extension/shared';

interface HistogramBar {
  readonly id: keyof EligibilityHistogramDto;
  readonly label: string;
  readonly value: number;
  readonly widthPercent: number;
  readonly colorClass: string;
}

@Component({
  selector: 'ptah-eligibility-histogram',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (totalValue() === 0) {
      <div class="text-xs text-base-content/60">
        No eligibility data recorded yet.
      </div>
    } @else {
      <div class="flex flex-col gap-1" role="list">
        @for (bar of bars(); track bar.id) {
          <div class="flex items-center gap-2 text-xs" role="listitem">
            <span class="w-40 truncate">{{ bar.label }}</span>
            <div
              class="flex-1 bg-base-300 rounded h-3 overflow-hidden"
              [attr.aria-label]="bar.label + ' count'"
            >
              <div
                class="h-full"
                [class]="bar.colorClass"
                [style.width.%]="bar.widthPercent"
              ></div>
            </div>
            <span class="tabular-nums w-8 text-right">{{ bar.value }}</span>
          </div>
        }
      </div>
    }
  `,
})
export class EligibilityHistogramComponent {
  public readonly histogram = input.required<EligibilityHistogramDto>();

  protected readonly totalValue = computed<number>(() => {
    const h = this.histogram();
    return (
      h.tooFewTurns + h.lowFidelity + h.insufficientAbstraction + h.accepted
    );
  });

  protected readonly bars = computed<readonly HistogramBar[]>(() => {
    const h = this.histogram();
    const max = Math.max(
      h.tooFewTurns,
      h.lowFidelity,
      h.insufficientAbstraction,
      h.accepted,
      1,
    );
    return [
      {
        id: 'tooFewTurns',
        label: 'Too few turns',
        value: h.tooFewTurns,
        widthPercent: (h.tooFewTurns / max) * 100,
        colorClass: 'bg-warning',
      },
      {
        id: 'lowFidelity',
        label: 'Low fidelity',
        value: h.lowFidelity,
        widthPercent: (h.lowFidelity / max) * 100,
        colorClass: 'bg-warning',
      },
      {
        id: 'insufficientAbstraction',
        label: 'Insufficient abstraction',
        value: h.insufficientAbstraction,
        widthPercent: (h.insufficientAbstraction / max) * 100,
        colorClass: 'bg-warning',
      },
      {
        id: 'accepted',
        label: 'Accepted',
        value: h.accepted,
        widthPercent: (h.accepted / max) * 100,
        colorClass: 'bg-success',
      },
    ];
  });
}
