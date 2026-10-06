import { TestBed } from '@angular/core/testing';
import { DashboardBadgeComponent, type BadgeNode } from './dashboard-badge.component';

describe('DashboardBadgeComponent', () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const node: BadgeNode = { id: 'badge', kind: 'badge', tone: 'neutral',
    text: { text: '3 open' }, selectable: false };
  /** Both theme roots the webview ships: dark anubis and light anubis-light. */
  const themeRoots = ['anubis', 'anubis-light'] as const;
  const toneClasses = {
    neutral: 'badge badge-neutral',
    primary: 'badge badge-primary',
    info: 'badge badge-info',
    success: 'badge badge-success',
    warning: 'badge badge-warning',
    error: 'badge badge-error',
  } as const;
  function setup(value: BadgeNode = node) {
    const fixture = TestBed.createComponent(DashboardBadgeComponent);
    fixture.componentRef.setInput('node', value);
    fixture.componentRef.setInput('surfaceId', 'surface');
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    return { fixture, element };
  }
  it('renders every tone with its exact literal class and text under both theme roots', () => {
    for (const tone of ['neutral', 'primary', 'info', 'success', 'warning', 'error'] as const) {
      const { fixture, element } = setup({ ...node, tone });
      const badge = element.querySelector('span')!;
      for (const theme of themeRoots) {
        element.setAttribute('data-theme', theme);
        fixture.detectChanges();
        expect(badge.className).toBe(toneClasses[tone]);
        expect(badge.textContent).toContain('3 open');
        expect(badge.classList).not.toContain('progress'); // alert/badge/divider maps stay disjoint
      }
    }
  });
  it('interpolates text only: agent markup never becomes markup, style or colour', () => {
    const { element } = setup({ ...node, text: { text: hostile } });
    expect(element.querySelector('img, style, [style], script')).toBeNull();
    expect(element.textContent).toContain(hostile);
    const classes = element.querySelector('span')!.className;
    expect(/#([0-9a-f]{3,8})|text-(red|blue|green|yellow|slate|gray|zinc)-/.test(classes)).toBe(false);
  });
  it('is a non-interactive span without a dashboard.select action and emits nothing', () => {
    const { fixture, element } = setup();
    const emitted = jest.fn();
    fixture.componentInstance.selectionChange.subscribe(emitted);
    expect(element.querySelector('button')).toBeNull();
    expect(element.querySelector('span')!.classList).toContain('badge');
    fixture.componentInstance.selectBadge();
    expect(emitted).not.toHaveBeenCalled();
  });
  it('renders an accessible button when selectable and emits the badge selection target', () => {
    const { fixture, element } = setup({ ...node, selectable: true, tone: 'success' });
    const emitted = jest.fn();
    fixture.componentInstance.selectionChange.subscribe(emitted);
    const button = element.querySelector<HTMLButtonElement>('button')!;
    expect(button.className).toBe('badge badge-success');
    expect(button.getAttribute('aria-label')).toBe('Select 3 open');
    expect(button.getAttribute('data-apps-focus-key')).toBe('surface:badge:select');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    button.click();
    const selection = { componentId: 'badge', target: { kind: 'badge' } };
    expect(emitted).toHaveBeenCalledTimes(1);
    expect(emitted).toHaveBeenCalledWith(selection);
    fixture.componentRef.setInput('selection', selection);
    fixture.detectChanges();
    expect(button.getAttribute('aria-pressed')).toBe('true');
    fixture.componentRef.setInput('selection', { componentId: 'other', target: { kind: 'badge' } });
    fixture.detectChanges();
    expect(button.getAttribute('aria-pressed')).toBe('false');
    fixture.componentRef.setInput('selection', { componentId: 'badge', target: { kind: 'stat' } });
    fixture.detectChanges();
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });
});