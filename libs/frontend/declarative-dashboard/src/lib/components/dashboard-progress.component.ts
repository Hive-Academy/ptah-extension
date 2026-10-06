import { ChangeDetectionStrategy, Component, computed, input, type InputSignal } from '@angular/core';
import type { StatusNode } from '../view-model/view-model.types';

export type ProgressNode = Extract<StatusNode, { kind: 'progress' }>;

/**
 * Complete literal class strings, never concatenated, so Tailwind's content
 * scan keeps every tone variant. daisyUI 4 has no `progress-neutral`: the
 * neutral tone maps to the bare `progress` class. The colours resolve from
 * the active theme tokens (anubis / anubis-light); no hard-coded colours.
 */
const PROGRESS_TONE_CLASSES = {
  neutral: 'progress',
  primary: 'progress progress-primary',
  info: 'progress progress-info',
  success: 'progress progress-success',
  warning: 'progress progress-warning',
  error: 'progress progress-error',
} as const;

@Component({
  selector: 'ptah-dashboard-progress',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Visible label text, the native progress bar, then the unrounded percentage. The value is renderer-owned. -->
    <span class="text-sm text-base-content" data-testid="progress-label">{{ node().label.text }}</span>
    <progress [class]="toneClasses()" [value]="node().value" max="100"
      role="progressbar" aria-valuemin="0" aria-valuemax="100"
      [attr.aria-valuenow]="node().value" [attr.aria-label]="node().label.text"></progress>
    <span class="text-sm tabular-nums text-base-content">{{ node().value }}%</span>
  `,
})
export class DashboardProgressComponent {
  public readonly node: InputSignal<ProgressNode> = input.required<ProgressNode>();

  public readonly toneClasses = computed(() => PROGRESS_TONE_CLASSES[this.node().tone]);
}