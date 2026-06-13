import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';

export type SkillTriggerKey =
  | 'sessionEnd'
  | 'idleMs'
  | 'bootScan'
  | 'subagentStop'
  | 'turnComplete'
  | 'postToolUse'
  | 'postToolUseMinEditCount'
  | 'maxAnalyzesPerHour';

export interface SkillTriggerChange {
  readonly key: SkillTriggerKey;
  readonly value: boolean | number;
}

@Component({
  selector: 'ptah-skill-trigger-toggle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-center justify-between gap-2 text-xs">
      <label class="flex items-center gap-2 flex-1 min-w-0">
        <input
          type="checkbox"
          class="checkbox checkbox-sm"
          [checked]="enabled()"
          [attr.aria-label]="label() + ' enabled'"
          (change)="onToggleEnabled($event)"
        />
        <span class="truncate">{{ label() }}</span>
      </label>
      @if (numericValue() !== null) {
        <input
          type="number"
          class="input input-bordered input-xs w-24"
          [value]="numericValue()"
          [attr.min]="min() ?? null"
          [attr.max]="max() ?? null"
          [attr.aria-label]="label() + ' value'"
          (change)="onNumericChange($event)"
        />
      }
    </div>
  `,
})
export class SkillTriggerToggleComponent {
  public readonly key = input.required<SkillTriggerKey>();
  public readonly label = input.required<string>();
  public readonly enabled = input.required<boolean>();
  public readonly numericValue = input<number | null>(null);
  public readonly min = input<number | null>(null);
  public readonly max = input<number | null>(null);

  public readonly triggerChange = output<SkillTriggerChange>();

  protected onToggleEnabled(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.triggerChange.emit({ key: this.key(), value: checked });
  }

  protected onNumericChange(event: Event): void {
    const raw = (event.target as HTMLInputElement).valueAsNumber;
    if (!Number.isFinite(raw)) return;
    this.triggerChange.emit({ key: this.key(), value: raw });
  }
}
