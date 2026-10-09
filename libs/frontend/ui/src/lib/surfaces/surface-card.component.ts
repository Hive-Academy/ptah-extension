import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

@Component({
  selector: 'ptah-surface-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<article [class]="classes()"><ng-content /></article>`,
})
export class SurfaceCardComponent {
  readonly elevation = input<1 | 2>(1);
  readonly interactive = input(false);
  protected readonly classes = computed(() =>
    [
      'surface-2',
      'rounded-xl',
      'p-4',
      this.elevation() === 2 ? 'elev-3' : 'elev-1',
      this.interactive()
        ? 'cursor-pointer transition-colors hover:border-[var(--surface-border-strong)]'
        : '',
    ].join(' '),
  );
}
