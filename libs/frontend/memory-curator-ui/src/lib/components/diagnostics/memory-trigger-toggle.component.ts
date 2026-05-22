import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';

export interface TriggerToggleChange {
  readonly enabled: boolean;
  readonly value?: number;
}

@Component({
  selector: 'ptah-memory-trigger-toggle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex items-center justify-between gap-2 rounded-md border border-base-300 bg-base-100 px-3 py-2"
    >
      <label class="flex flex-1 cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          class="checkbox checkbox-sm"
          [checked]="enabled()"
          (change)="onToggle($event)"
          [attr.aria-label]="label() + ' enabled'"
        />
        <span class="text-sm font-medium">{{ label() }}</span>
      </label>
      @if (hasValue()) {
        <div class="flex items-center gap-1">
          <input
            type="number"
            class="input input-bordered input-xs w-20"
            [value]="value() ?? 0"
            [disabled]="!enabled()"
            [attr.min]="min() ?? null"
            [attr.max]="max() ?? null"
            (change)="onValueChange($event)"
            [attr.aria-label]="label() + ' value'"
          />
          @if (valueLabel(); as units) {
            <span class="text-xs text-base-content/60">{{ units }}</span>
          }
        </div>
      }
    </div>
  `,
})
export class MemoryTriggerToggleComponent {
  public readonly label = input.required<string>();
  public readonly enabled = input.required<boolean>();
  public readonly value = input<number | undefined>(undefined);
  public readonly valueLabel = input<string | undefined>(undefined);
  public readonly min = input<number | undefined>(undefined);
  public readonly max = input<number | undefined>(undefined);

  public readonly triggerChange = output<TriggerToggleChange>();

  protected readonly hasValue = computed(() => this.value() !== undefined);

  protected onToggle(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const v = this.value();
    this.triggerChange.emit(
      v !== undefined ? { enabled: checked, value: v } : { enabled: checked },
    );
  }

  protected onValueChange(event: Event): void {
    const raw = (event.target as HTMLInputElement).valueAsNumber;
    const next = Number.isFinite(raw) ? raw : 0;
    this.triggerChange.emit({ enabled: this.enabled(), value: next });
  }
}
