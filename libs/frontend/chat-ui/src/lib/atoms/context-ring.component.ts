import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'ptah-context-ring',
  standalone: true,
  host: { 'aria-hidden': 'true' },
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" [attr.viewBox]="'0 0 ' + size() + ' ' + size()"
      [style.color]="ink()" class="block -rotate-90">
      <circle [attr.cx]="size() / 2" [attr.cy]="size() / 2" [attr.r]="radius()"
        fill="none" stroke="var(--surface-border-strong)" [attr.stroke-width]="stroke()" />
      <circle [attr.cx]="size() / 2" [attr.cy]="size() / 2" [attr.r]="radius()"
        fill="none" stroke="currentColor" [attr.stroke-width]="stroke()" stroke-linecap="round"
        [attr.stroke-dasharray]="circumference()"
        [attr.stroke-dashoffset]="circumference() * (1 - clamped() / 100)"
        class="arc" />
    </svg>
  `,
  styles: [`
    .arc { transition: stroke-dashoffset 400ms var(--ptah-ease-soft); }
    @media (prefers-reduced-motion: reduce) { .arc { transition: none; } }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContextRingComponent {
  readonly percent = input.required<number>();
  readonly size = input<44 | 28>(44);
  protected readonly clamped = computed(() => Math.max(0, Math.min(100, this.percent())));
  protected readonly radius = computed(() => this.size() === 44 ? 18 : 12);
  protected readonly stroke = computed(() => this.size() === 44 ? 4 : 2);
  protected readonly circumference = computed(() => 2 * Math.PI * this.radius());
  protected readonly ink = computed(() => this.clamped() >= 95 ? 'var(--state-ink-err)'
    : this.clamped() >= 80 ? 'var(--state-ink-need)' : 'var(--ptah-gold, var(--ptah-accent-ink))');
}
