import { TestBed } from '@angular/core/testing';
import { DashboardAlertComponent, type AlertNode } from './dashboard-alert.component';

describe('DashboardAlertComponent', () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const node: AlertNode = { id: 'alert', kind: 'alert', tone: 'info',
    text: { text: 'Disk almost full' }, selectable: false };
  /** Both theme roots the webview ships: dark anubis and light anubis-light. */
  const themeRoots = ['anubis', 'anubis-light'] as const;
  const toneClasses = {
    info: 'alert alert-info',
    success: 'alert alert-success',
    warning: 'alert alert-warning',
    error: 'alert alert-error',
  } as const;
  const roles = { info: 'status', success: 'status', warning: 'alert', error: 'alert' } as const;
  function setup(value: AlertNode = node) {
    const fixture = TestBed.createComponent(DashboardAlertComponent);
    fixture.componentRef.setInput('node', value);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    return { fixture, element };
  }
  it('renders every tone with its exact literal class, role, tone word and text under both theme roots', () => {
    for (const tone of ['info', 'success', 'warning', 'error'] as const) {
      const { fixture, element } = setup({ ...node, tone });
      const alert = element.querySelector(`[role="${roles[tone]}"]`)!;
      for (const theme of themeRoots) {
        element.setAttribute('data-theme', theme);
        fixture.detectChanges();
        expect(alert.className).toBe(toneClasses[tone]);
        expect(alert.getAttribute('role')).toBe(roles[tone]);
        expect(alert.textContent).toContain(tone);
        expect(alert.textContent).toContain('Disk almost full');
      }
      expect(element.querySelector(`[role="${roles[tone] === 'alert' ? 'status' : 'alert'}"]`)).toBeNull();
    }
  });
  it('interpolates text only: agent markup never becomes markup, style or colour', () => {
    const { element } = setup({ ...node, text: { text: hostile } });
    expect(element.querySelector('img, style, [style], script')).toBeNull();
    expect(element.textContent).toContain(hostile);
    const classes = element.querySelector('[role]')!.className;
    expect(/#([0-9a-f]{3,8})|text-(red|blue|green|yellow|slate|gray|zinc)-/.test(classes)).toBe(false);
  });
  it('renders no title node without a title, and an inline bold title before the text with one', () => {
    const { element } = setup();
    const bare = element.querySelector('[role]')!;
    expect(element.querySelector('[data-testid="alert-title"]')).toBeNull();
    expect(bare.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull();
    expect(bare.children.length).toBe(1); // only the sr-only tone span; no empty placeholder
    const titled = setup({ ...node, tone: 'warning', title: { text: 'Deploy failed' } }).element;
    const alert = titled.querySelector('[role="alert"]')!;
    const title = titled.querySelector('[data-testid="alert-title"]')!;
    expect(title.textContent).toContain('Deploy failed');
    expect(title.classList).toContain('font-semibold');
    expect(title.parentElement).toBe(alert); // same element, not a sibling heading
    expect(alert.textContent!.indexOf('Deploy failed')).toBeLessThan(alert.textContent!.indexOf('Disk almost full'));
    expect(alert.textContent).toContain('Deploy failed Disk almost full'); // title, space, text: reads as one note
    expect(alert.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull();
  });
});