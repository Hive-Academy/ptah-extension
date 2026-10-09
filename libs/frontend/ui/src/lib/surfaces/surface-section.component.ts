import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

export type SurfaceSectionTone = 'default' | 'subtle';
export type SurfaceSectionPadding = 'md' | 'lg';

@Component({
  selector: 'ptah-surface-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section [class]="classes()">
    <ng-content select="[section-header]" /><ng-content />
  </section>`,
})
export class SurfaceSectionComponent {
  readonly tone = input<SurfaceSectionTone>('default');
  readonly padding = input<SurfaceSectionPadding>('lg');
  protected readonly classes = computed(() =>
    [
      this.tone() === 'subtle' ? 'surface-1' : 'surface-2',
      'rounded-xl',
      this.padding() === 'lg' ? 'p-5 gap-5' : 'p-4 gap-3',
      'flex flex-col',
    ].join(' '),
  );
}
