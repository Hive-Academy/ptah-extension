/**
 * EffortSelectorComponent - Compact Reasoning Effort Level Selector
 * TASK_2025_184: Reasoning Effort Configuration
 *
 * A standalone dropdown for selecting Claude's reasoning effort level.
 * Placed in the chat input bar near the model selector.
 *
 * Pattern: Signal-based state, output() API
 * UI: DaisyUI select with ghost styling matching model-selector compact style
 */

import {
  Component,
  signal,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { type EffortLevel } from '@ptah-extension/shared';

const VALID_EFFORTS: readonly EffortLevel[] = [
  'low',
  'medium',
  'high',
  'max',
] as const;

function isValidEffort(v: string): v is EffortLevel {
  return (VALID_EFFORTS as readonly string[]).includes(v);
}

@Component({
  selector: 'ptah-effort-selector',
  standalone: true,
  template: `
    <select
      class="select select-ghost select-xs h-6 min-h-0 text-[10px] font-mono w-20 focus:outline-none"
      [value]="selectedEffort()"
      (change)="onEffortChange($event)"
      aria-label="Select reasoning effort level"
      title="Reasoning effort level"
    >
      <option value="">Default</option>
      <option value="low">Low</option>
      <option value="medium">Medium</option>
      <option value="high">High</option>
      <option value="max">Max</option>
    </select>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EffortSelectorComponent {
  /** Current selected effort level. Empty string means SDK default (high). */
  readonly selectedEffort = signal<EffortLevel | ''>('');

  /** Emits when user changes effort level. undefined means use SDK default. */
  readonly effortChanged = output<EffortLevel | undefined>();

  /**
   * Handle effort level change from select element.
   * Emits undefined when "Default" is selected, otherwise emits the EffortLevel value.
   */
  onEffortChange(event: Event): void {
    const target = event.target as HTMLSelectElement;
    const value = target.value;
    if (value === '') {
      this.selectedEffort.set('');
      this.effortChanged.emit(undefined);
    } else if (isValidEffort(value)) {
      this.selectedEffort.set(value);
      this.effortChanged.emit(value);
    }
    // Invalid values are silently ignored (should never happen with our <option> elements)
  }
}
