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
    return h.prefilterTooThin + h.prefilterRejected + h.accepted;
  });

  protected readonly bars = computed<readonly HistogramBar[]>(() => {
    const h = this.histogram();
    const max = Math.max(
      h.prefilterTooThin,
      h.prefilterRejected,
      h.accepted,
      1,
    );
    return [
      {
        id: 'prefilterTooThin',
        label: 'Prefilter too thin',
        value: h.prefilterTooThin,
        widthPercent: (h.prefilterTooThin / max) * 100,
        colorClass: 'bg-warning',
      },
      {
        id: 'prefilterRejected',
        label: 'Prefilter rejected',
        value: h.prefilterRejected,
        widthPercent: (h.prefilterRejected / max) * 100,
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
