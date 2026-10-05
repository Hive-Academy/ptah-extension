import { ChangeDetectionStrategy, Component, computed, input, type InputSignal } from '@angular/core';
import type { StatusNode } from '../view-model/view-model.types';

export type DividerNode = Extract<StatusNode, { kind: 'divider' }>;

/**
 * Complete literal class strings, never concatenated, so Tailwind's content
 * scan keeps both variants. daisyUI 4 inverts its naming relative to the
 * contract: `divider-horizontal` draws a VERTICAL rule, so the contract's
 * `vertical` maps to `divider divider-horizontal` and `horizontal` to the
 * bare `divider`. The vertical rule's ::before grows inside a column flex
 * box, so it needs a definite height: `h-full` fills a stretched host, and
 * `min-h-12` keeps the rule visible when the host sits inside a wrapper that
 * does not stretch (visual review S1).
 */
const DIVIDER_DIRECTION_CLASSES = {
  horizontal: 'divider',
  vertical: 'divider divider-horizontal h-full min-h-12',
} as const;

@Component({
  selector: 'ptah-dashboard-divider',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // Vertical only: the host must stretch across the stack row so the inner
    // rule has a height to fill. The horizontal divider keeps its default host.
    '[class.self-stretch]': 'isVertical()',
    '[class.flex]': 'isVertical()',
  },
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

  public readonly isVertical = computed(() => this.node().direction === 'vertical');
}