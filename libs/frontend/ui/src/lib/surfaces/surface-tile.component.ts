import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

@Component({
  selector: 'ptah-surface-tile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div
    [class]="classes()"
    [attr.data-selected]="selected() ? 'true' : null"
  >
    <ng-content />
  </div>`,
})
export class SurfaceTileComponent {
  readonly selected = input(false);
  readonly density = input<'compact' | 'default'>('default');
  protected readonly classes = computed(() =>
    [
      'surface-2',
      'rounded-lg',
      this.density() === 'compact' ? 'p-2' : 'p-3',
      this.selected() ? 'border-[var(--surface-border-strong)] elev-1' : '',
    ].join(' '),
  );
}
