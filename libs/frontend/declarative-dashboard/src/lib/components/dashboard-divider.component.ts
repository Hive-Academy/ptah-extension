import { ChangeDetectionStrategy, Component, computed, input, type InputSignal } from '@angular/core';
import type { StatusNode } from '../view-model/view-model.types';

export type DividerNode = Extract<StatusNode, { kind: 'divider' }>;

/**
 * Complete literal class strings, never concatenated, so Tailwind's content
 * scan keeps both variants. daisyUI 4 inverts its naming relative to the
 * contract: `divider-horizontal` draws a VERTICAL rule, so the contract's
 * `vertical` maps to `divider divider-horizontal` and `horizontal` to the
 * bare `divider`.
 */
const DIVIDER_DIRECTION_CLASSES = {
  horizontal: 'divider',
  vertical: 'divider divider-horizontal',
} as const;

@Component({
  selector: 'ptah-dashboard-divider',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div role="separator" [attr.aria-orientation]="node().direction" [class]="directionClasses()">
      @if (node().text; as text) {
        {{ text.text }}
      }
    </div>
  `,
})
export class DashboardDividerComponent {
  public readonly node: InputSignal<DividerNode> = input.required<DividerNode>();

  public readonly directionClasses = computed(() => DIVIDER_DIRECTION_CLASSES[this.node().direction]);
}