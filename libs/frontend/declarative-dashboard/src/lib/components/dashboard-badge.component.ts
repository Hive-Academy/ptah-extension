import { ChangeDetectionStrategy, Component, computed, input, output, type InputSignal } from '@angular/core';
import type { SurfaceSelection } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { StatusNode } from '../view-model/view-model.types';

export type BadgeNode = Extract<StatusNode, { kind: 'badge' }>;

/**
 * Complete literal class strings, never concatenated, so Tailwind's content
 * scan keeps every tone variant. The colours resolve from the active theme
 * tokens (anubis / anubis-light); no hard-coded colour utilities.
 */
const BADGE_TONE_CLASSES = {
  neutral: 'badge badge-neutral',
  primary: 'badge badge-primary',
  info: 'badge badge-info',
  success: 'badge badge-success',
  warning: 'badge badge-warning',
  error: 'badge badge-error',
} as const;

@Component({
  selector: 'ptah-dashboard-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (node().selectable) {
      <button type="button" [class]="toneClasses()" [attr.aria-label]="'Select ' + node().text.text"
        [attr.aria-pressed]="selection()?.componentId === node().id && selection()?.target?.kind === 'badge'"
        [attr.data-apps-focus-key]="focusKey('select')" (click)="selectBadge()">{{ node().text.text }}</button>
    } @else {
      <span [class]="toneClasses()">{{ node().text.text }}</span>
    }
  `,
})
export class DashboardBadgeComponent {
  public readonly node: InputSignal<BadgeNode> = input.required<BadgeNode>();
  public readonly surfaceId = input('');
  public readonly selection = input<SurfaceSelection | null>(null);
  public readonly selectionChange = output<SurfaceSelection>();

  public readonly toneClasses = computed(() => BADGE_TONE_CLASSES[this.node().tone]);

  public focusKey(control: string): string { return `${this.surfaceId()}:${this.node().id}:${control}`; }

  /** Emits the only host-valid badge selection target: dashboard.select on this badge. */
  public selectBadge(): void {
    if (this.node().selectable) this.selectionChange.emit({ componentId: this.node().id, target: { kind: 'badge' } });
  }
}