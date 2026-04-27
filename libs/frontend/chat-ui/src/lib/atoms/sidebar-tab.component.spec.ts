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
  }) {
    const fixture = TestBed.createComponent(SidebarTabComponent);
    fixture.componentRef.setInput('label', opts.label ?? 'Sessions');
    fixture.componentRef.setInput('side', opts.side);
    fixture.componentRef.setInput('isOpen', opts.isOpen);
    if (opts.size) fixture.componentRef.setInput('size', opts.size);
    if (opts.badgeType !== undefined)
      fixture.componentRef.setInput('badgeType', opts.badgeType);
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
});
