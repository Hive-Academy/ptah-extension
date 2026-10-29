import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

export type SurfaceSectionTone = 'default' | 'subtle';
export type SurfaceSectionPadding = 'md' | 'lg';
/**
 * The section's glass role (styles.css "Surface roles"; applied only under `data-glass='on'`): `content` is the
 * stable reading plane without blur, `chrome` the blurred pane.
 */
export type SurfaceSectionGlass = 'content' | 'chrome';

@Component({
  selector: 'ptah-surface-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // styles.css lifts the host of an open-popover `content` surface only; this lifts the host for every role, and only
  // while it holds a dialog (an inline host with no offsets: no layout change).
  host: { class: 'has-[[role=dialog]]:relative has-[[role=dialog]]:z-30' },
  template: `<section [class]="classes()" [attr.data-glass-surface]="glassSurface()">
    <ng-content select="[section-header]" /><ng-content />
  </section>`,
})
export class SurfaceSectionComponent {
  readonly tone = input<SurfaceSectionTone>('default');
  readonly padding = input<SurfaceSectionPadding>('lg');
  readonly glassSurface = input<SurfaceSectionGlass>('content');
  protected readonly classes = computed(() =>
    [
      this.tone() === 'subtle' ? 'surface-1' : 'surface-2',
      'rounded-xl',
      this.padding() === 'lg' ? 'p-5 gap-5' : 'p-4 gap-3',
      'flex flex-col',
      // The glass role isolates the section (styles.css `:where([data-glass-surface])`, every theme), which traps an
      // open popover's z-index inside it; later sections would paint over the panel. Lift the section while it holds
      // one (popovers are role="dialog"; the class must not contain "popover": the light theme styles every [class*='popover']).
      'has-[[role=dialog]]:z-30',
    ].join(' '),
  );
}
