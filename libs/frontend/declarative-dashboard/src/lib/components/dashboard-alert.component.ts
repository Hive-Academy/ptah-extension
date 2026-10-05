import { ChangeDetectionStrategy, Component, computed, input, type InputSignal } from '@angular/core';
import type { StatusNode } from '../view-model/view-model.types';

export type AlertNode = Extract<StatusNode, { kind: 'alert' }>;

/**
 * Complete literal class strings, never concatenated, so Tailwind's content
 * scan keeps every tone variant. The root stays the daisyUI `alert` component
 * on a neutral surface, so the text keeps base-content contrast on both theme
 * roots (S2); the tone shows as a border and icon accent, never as filled
 * text backgrounds. The icon classes carry their size so each string is
 * complete on its own.
 */
const ALERT_TONE_STYLES = {
  info: {
    root: 'alert border border-info bg-base-200 text-base-content',
    icon: 'h-4 w-4 shrink-0 text-info',
    label: 'Info',
  },
  success: {
    root: 'alert border border-success bg-base-200 text-base-content',
    icon: 'h-4 w-4 shrink-0 text-success',
    label: 'Success',
  },
  warning: {
    root: 'alert border border-warning bg-base-200 text-base-content',
    icon: 'h-4 w-4 shrink-0 text-warning',
    label: 'Warning',
  },
  error: {
    root: 'alert border border-error bg-base-200 text-base-content',
    icon: 'h-4 w-4 shrink-0 text-error',
    label: 'Error',
  },
} as const;

@Component({
  selector: 'ptah-dashboard-alert',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- One compact line: tone icon, visible tone label, optional bold title, then the text. -->
    <div [class]="tone().root" [attr.role]="alertRole()">
      @switch (node().tone) {
        @case ('info') {
          <svg [class]="tone().icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M12 8h.01M12 12v4" /></svg>
        }
        @case ('success') {
          <svg [class]="tone().icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M8 12l3 3 5-6" /></svg>
        }
        @case ('warning') {
          <svg [class]="tone().icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></svg>
        }
        @case ('error') {
          <svg [class]="tone().icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" /></svg>
        }
      }
      <span class="font-semibold" data-testid="alert-tone">{{ tone().label }}</span>
      @if (node().title; as title) {
        <span class="font-semibold" data-testid="alert-title"> {{ title.text }}</span>
      }
      {{ node().text.text }}</div>
  `,
})
export class DashboardAlertComponent {
  public readonly node: InputSignal<AlertNode> = input.required<AlertNode>();

  public readonly tone = computed(() => ALERT_TONE_STYLES[this.node().tone]);

  /** warning/error interrupt (assertive); info/success announce politely. */
  public readonly alertRole = computed(() =>
    this.node().tone === 'warning' || this.node().tone === 'error' ? 'alert' : 'status',
  );
}