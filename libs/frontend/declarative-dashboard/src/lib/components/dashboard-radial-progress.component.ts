import { ChangeDetectionStrategy, Component, computed, input, type InputSignal } from '@angular/core';
import type { StatusNode } from '../view-model/view-model.types';

export type RadialProgressNode = Extract<StatusNode, { kind: 'radial-progress' }>;

/**
 * Complete literal class strings, never concatenated, so Tailwind's content
 * scan keeps every tone variant. daisyUI's radial ring takes its fill colour
 * from the `text-<tone>` classes. The neutral tone uses `text-base-content`
 * (not `text-neutral`), which keeps a high contrast against the page in both
 * themes (visual review S4: `text-neutral` was 1.12:1 in the dark theme).
 * The colours resolve from the active theme tokens; no hard-coded colours.
 */
const RADIAL_TONE_CLASSES = {
  neutral: 'radial-progress text-base-content',
  primary: 'radial-progress text-primary',
  info: 'radial-progress text-info',
  success: 'radial-progress text-success',
  warning: 'radial-progress text-warning',
  error: 'radial-progress text-error',
} as const;

@Component({
  selector: 'ptah-dashboard-radial-progress',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Visible label text; the ring is sized by its content and filled by the renderer-owned --value custom property. -->
    <span class="text-sm text-base-content" data-testid="radial-progress-label">{{ node().label.text }}</span>
    <div [class]="toneClasses()" role="progressbar" aria-valuemin="0" aria-valuemax="100"
      [attr.aria-valuenow]="node().value" [attr.aria-label]="node().label.text"
      [style.--value]="node().value">{{ node().value }}%</div>
  `,
})
export class DashboardRadialProgressComponent {
  public readonly node: InputSignal<RadialProgressNode> = input.required<RadialProgressNode>();

  public readonly toneClasses = computed(() => RADIAL_TONE_CLASSES[this.node().tone]);
}