import { TestBed } from '@angular/core/testing';
import { SidebarTabComponent } from './sidebar-tab.component';

describe('SidebarTabComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SidebarTabComponent],
    }).compileComponents();
  });

  function render(opts: {
    isOpen: boolean;
    side: 'left' | 'right';
    label?: string;
    size?: 'sm' | 'default';
    badgeType?: 'warning' | 'info' | 'neutral' | null;
    newCount?: number;
  }) {
    const fixture = TestBed.createComponent(SidebarTabComponent);
    fixture.componentRef.setInput('label', opts.label ?? 'Sessions');
    fixture.componentRef.setInput('side', opts.side);
    fixture.componentRef.setInput('isOpen', opts.isOpen);
    if (opts.size) fixture.componentRef.setInput('size', opts.size);
    if (opts.badgeType !== undefined)
      fixture.componentRef.setInput('badgeType', opts.badgeType);
    if (opts.newCount !== undefined)
      fixture.componentRef.setInput('newCount', opts.newCount);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the rotated label and basic structure', () => {
    const fixture = render({ isOpen: false, side: 'left' });
    expect(fixture.nativeElement.textContent).toContain('Sessions');
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('shows the active indicator line when open', () => {
    const fixture = render({ isOpen: true, side: 'left' });
    expect(
      fixture.nativeElement.querySelectorAll('span.bg-primary').length,
    ).toBeGreaterThan(0);
  });

  it('keeps the open label on base-content, not text-primary (WCAG 1.4.3)', () => {
    const fixture = render({ isOpen: true, side: 'left' });
    const label: HTMLElement =
      fixture.nativeElement.querySelector('.tab-label');
    expect(label.classList).toContain('text-base-content');
    expect(label.classList).not.toContain('text-primary');

    fixture.componentRef.setInput('isOpen', false);
    fixture.detectChanges();
    expect(label.classList).toContain('text-base-content-muted');
    expect(label.classList).not.toContain('text-base-content');
  });

  it('insets the focus outline so the slot cannot clip it', () => {
    const fixture = render({ isOpen: false, side: 'left' });
    const button: HTMLButtonElement =
      fixture.nativeElement.querySelector('button');
    expect(button.classList).toContain('focus-visible:-outline-offset-2');
  });

  it('uses sm width class when size=sm', () => {
    const fixture = render({ isOpen: false, side: 'right', size: 'sm' });
    const button = fixture.nativeElement.querySelector('button');
    expect(button.className).toContain('w-6');
  });

  it('renders a warning badge when badgeType=warning', () => {
    const fixture = render({
      isOpen: false,
      side: 'right',
      badgeType: 'warning',
    });
    expect(fixture.nativeElement.querySelector('.bg-warning')).not.toBeNull();
  });

  it('emits toggled event on click', () => {
    const fixture = render({ isOpen: false, side: 'left' });
    let fired = false;
    fixture.componentInstance.toggled.subscribe(() => (fired = true));
    fixture.nativeElement.querySelector('button').click();
    expect(fired).toBe(true);
  });

  it('names the toggle and exposes aria-expanded from isOpen', () => {
    const closed = render({ isOpen: false, side: 'right', label: 'Display' });
    const button: HTMLButtonElement =
      closed.nativeElement.querySelector('button');
    expect(button.getAttribute('aria-label')).toBe('Toggle Display panel');
    expect(button.getAttribute('aria-expanded')).toBe('false');

    closed.componentRef.setInput('isOpen', true);
    closed.detectChanges();
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows no new badge when newCount is 0', () => {
    const fixture = render({ isOpen: false, side: 'right', newCount: 0 });
    expect(
      fixture.nativeElement.querySelector('[data-testid="sidebar-tab-new"]'),
    ).toBeNull();
  });

  it('shows the "1 new" text badge and adds it to the accessible name (R1.8)', () => {
    const fixture = render({
      isOpen: false,
      side: 'right',
      label: 'Display',
      newCount: 1,
    });
    const badge: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="sidebar-tab-new"]',
    );
    expect(badge.textContent?.trim()).toBe('1 new');
    expect(badge.getAttribute('aria-hidden')).toBe('true');
    expect(
      fixture.nativeElement.querySelector('button').getAttribute('aria-label'),
    ).toBe('Toggle Display panel, 1 new');

    fixture.componentRef.setInput('newCount', 0);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="sidebar-tab-new"]'),
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector('button').getAttribute('aria-label'),
    ).toBe('Toggle Display panel');
  });
});
