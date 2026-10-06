import { ChangeDetectionStrategy, Component, computed, input, type InputSignal } from '@angular/core';
import type { StatusNode } from '../view-model/view-model.types';

export type DividerNode = Extract<StatusNode, { kind: 'divider' }>;

/**
 * Complete literal class strings, never concatenated, so Tailwind's content
 * scan keeps every variant. Horizontal keeps daisyUI's own `divider` with its
 * rule and text slot. Vertical no longer relies on daisyUI's ::before/::after:
 * with text those pseudo-elements measured 0px tall and no rule was drawn
 * (visual review round 3), so the vertical rule is two explicit segments in a
 * column flex box instead.
 */
const DIVIDER_CONTAINER_CLASSES = {
  horizontal: 'divider',
  vertical: 'flex flex-col items-center self-stretch min-h-12 gap-1 mx-2 text-sm',
} as const;

/**
 * One half of the vertical rule. `bg-base-content/10` is a theme token with
 * the same 10% content fill daisyUI's own divider rule uses, in both themes.
 */
const VERTICAL_RULE_SEGMENT_CLASS = 'w-0.5 min-h-4 flex-1 bg-base-content/10';

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
    @if (isVertical()) {
      <div role="separator" [attr.aria-orientation]="node().direction" [class]="containerClasses()">
        <span aria-hidden="true" [class]="ruleClass"></span>
        @if (node().text; as text) {
          <span>{{ text.text }}</span>
        }
        <span aria-hidden="true" [class]="ruleClass"></span>
      </div>
    } @else {
      <div role="separator" [attr.aria-orientation]="node().direction" [class]="containerClasses()">
        @if (node().text; as text) {
          {{ text.text }}
        }
      </div>
    }
  `,
})
export class DashboardDividerComponent {
  public readonly node: InputSignal<DividerNode> = input.required<DividerNode>();

  public readonly containerClasses = computed(() => DIVIDER_CONTAINER_CLASSES[this.node().direction]);

  /** Decorative rule segments; the text alone is never the separator. */
  public readonly ruleClass = VERTICAL_RULE_SEGMENT_CLASS;

  public readonly isVertical = computed(() => this.node().direction === 'vertical');
}