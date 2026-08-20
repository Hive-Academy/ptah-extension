import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import type { BadgeVariant } from '../badge-variant';
import { TagChip } from './tag-chip';

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TagChip],
  template: `<ptah-tag-chip
    [label]="label"
    [variant]="variant"
    [size]="size"
  />`,
})
class HostComponent {
  public label = 'Announcements';
  public variant: BadgeVariant = 'ghost';
  public size: 'xs' | 'sm' | 'md' = 'xs';
}

function render(setup: (host: HostComponent) => void = () => undefined) {
  const fixture = TestBed.createComponent(HostComponent);
  setup(fixture.componentInstance);
  fixture.detectChanges();
  return fixture;
}

describe('TagChip', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [HostComponent] });
  });

  it('renders the label', () => {
    expect(render().nativeElement.textContent.trim()).toBe('Announcements');
  });

  it('defaults to the ghost variant so a tag does not compete with a title', () => {
    const chip = render().nativeElement.querySelector('span');

    expect(chip.className).toContain('badge-ghost');
  });

  it('maps every BadgeVariant to a literal daisyUI modifier', () => {
    // Full literals, not `badge-${variant}` — Tailwind's content scanner
    // tree-shakes a dynamically-built class name and the chip renders unstyled.
    // Iterating the whole union is what stops a seventh variant being added to
    // `BadgeVariant` without a modifier here.
    const variants: BadgeVariant[] = [
      'success',
      'warning',
      'error',
      'info',
      'neutral',
      'ghost',
    ];

    const classes = variants.map(
      (variant) =>
        render((h) => (h.variant = variant)).nativeElement.querySelector('span')
          .className,
    );

    expect(classes).toEqual([
      'badge badge-success badge-xs whitespace-nowrap',
      'badge badge-warning badge-xs whitespace-nowrap',
      'badge badge-error badge-xs whitespace-nowrap',
      'badge badge-info badge-xs whitespace-nowrap',
      'badge badge-neutral badge-xs whitespace-nowrap',
      'badge badge-ghost badge-xs whitespace-nowrap',
    ]);
  });

  it('applies the size modifier', () => {
    const chip = render((h) => (h.size = 'md')).nativeElement.querySelector(
      'span',
    );

    expect(chip.className).toContain('badge-md');
  });

  it('renders NO icon — a tag is not a status (the StatusBadge distinction)', () => {
    // If this ever fails, TagChip has drifted into being StatusBadge and one of
    // the two should be deleted rather than both kept.
    expect(render().nativeElement.querySelector('lucide-angular')).toBeNull();
  });
});
