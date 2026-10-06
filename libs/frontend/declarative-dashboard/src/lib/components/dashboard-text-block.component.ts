import { ChangeDetectionStrategy, Component, input, type InputSignal } from '@angular/core';
import type { StatusNode } from '../view-model/view-model.types';

export type TextBlockNode = Extract<StatusNode, { kind: 'text-block' }>;

@Component({
  selector: 'ptah-dashboard-text-block',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Native semantics per role: a heading element for heading, a paragraph for body. Base-content typography tokens only. -->
    @if (node().role === 'heading') {
      <h3 class="text-lg font-semibold leading-tight text-base-content" data-testid="text-block-heading">{{ node().text.text }}</h3>
    } @else {
      <p class="text-base leading-relaxed text-base-content" data-testid="text-block-body">{{ node().text.text }}</p>
    }
  `,
})
export class DashboardTextBlockComponent {
  public readonly node: InputSignal<TextBlockNode> = input.required<TextBlockNode>();
}