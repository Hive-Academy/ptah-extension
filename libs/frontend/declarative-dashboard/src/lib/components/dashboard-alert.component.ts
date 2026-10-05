import { ChangeDetectionStrategy, Component, computed, input, type InputSignal } from '@angular/core';
import type { StatusNode } from '../view-model/view-model.types';

export type AlertNode = Extract<StatusNode, { kind: 'alert' }>;

/**
 * Complete literal class strings, never concatenated, so Tailwind's content
 * scan keeps every tone variant. The colours resolve from the active theme
 * tokens (anubis / anubis-light); no hard-coded colour utilities.
 */
const ALERT_TONE_CLASSES = {
  info: 'alert alert-info',
  success: 'alert alert-success',
  warning: 'alert alert-warning',
  error: 'alert alert-error',
} as const;

@Component({
  selector: 'ptah-dashboard-alert',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Short inline note: the tone word is read out (sr-only), then the optional bold title, then the text. -->
    <div [class]="toneClasses()" [attr.role]="alertRole()">
      <span class="sr-only">{{ node().tone }}.</span>
      @if (node().title; as title) {
        <span class="font-semibold" data-testid="alert-title">{{ title.text }}</span>
      }
      {{ node().text.text }}</div>
  `,
})
export class DashboardAlertComponent {
  public readonly node: InputSignal<AlertNode> = input.required<AlertNode>();

  public readonly toneClasses = computed(() => ALERT_TONE_CLASSES[this.node().tone]);

  /** warning/error interrupt (assertive); info/success announce politely. */
  public readonly alertRole = computed(() =>
    this.node().tone === 'warning' || this.node().tone === 'error' ? 'alert' : 'status',
  );
}