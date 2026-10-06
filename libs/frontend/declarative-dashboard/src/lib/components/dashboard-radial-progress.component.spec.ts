import { TestBed } from '@angular/core/testing';
import { DashboardRadialProgressComponent, type RadialProgressNode } from './dashboard-radial-progress.component';

describe('DashboardRadialProgressComponent', () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const node: RadialProgressNode = { id: 'radial', kind: 'radial-progress', value: 42.5, tone: 'primary',
    label: { text: 'Coverage' }, selectable: false };
  /** Both theme roots the webview ships: dark anubis and light anubis-light. */
  const themeRoots = ['anubis', 'anubis-light'] as const;
  const toneClasses = {
    neutral: 'radial-progress text-base-content',
    primary: 'radial-progress text-primary',
    info: 'radial-progress text-info',
    success: 'radial-progress text-success',
    warning: 'radial-progress text-warning',
    error: 'radial-progress text-error',
  } as const;
  const tones = ['neutral', 'primary', 'info', 'success', 'warning', 'error'] as const;
  function setup(value: RadialProgressNode = node) {
    const fixture = TestBed.createComponent(DashboardRadialProgressComponent);
    fixture.componentRef.setInput('node', value);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    return { fixture, element };
  }
  it('renders every tone with its exact literal class under both theme roots', () => {
    for (const tone of tones) {
      const { fixture, element } = setup({ ...node, tone });
      const ring = element.querySelector('[role="progressbar"]')!;
      for (const theme of themeRoots) {
        element.setAttribute('data-theme', theme);
        fixture.detectChanges();
        expect(ring.className).toBe(toneClasses[tone]);
      }
    }
  });
  it('exposes the full progressbar ARIA contract with an exact, unrounded value', () => {
    const { element } = setup();
    const ring = element.querySelector<HTMLElement>('[role="progressbar"]')!;
    expect(ring.getAttribute('role')).toBe('progressbar');
    expect(ring.getAttribute('aria-valuemin')).toBe('0');
    expect(ring.getAttribute('aria-valuemax')).toBe('100');
    expect(ring.getAttribute('aria-valuenow')).toBe('42.5');
    expect(ring.getAttribute('aria-label')).toBe('Coverage');
    for (const value of [0, 100]) {
      const edge = setup({ ...node, value }).element;
      expect(edge.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe(`${value}`);
    }
  });
  it('binds only the renderer-owned --value custom property from the validated number', () => {
    const { element } = setup();
    const ring = element.querySelector<HTMLElement>('[role="progressbar"]')!;
    expect(ring.style.getPropertyValue('--value')).toBe('42.5');
    expect(ring.style.color).toBe('');
    expect(ring.style.backgroundColor).toBe('');
    expect(ring.style.length).toBe(1);
  });
  it('keeps the label as visible text and shows the unrounded percentage', () => {
    const { element } = setup();
    expect(element.querySelector('[data-testid="radial-progress-label"]')?.textContent).toBe('Coverage');
    const ring = element.querySelector('[role="progressbar"]')!;
    expect(ring.textContent).toBe('42.5%');
    const whole = setup({ ...node, value: 7 }).element;
    expect(whole.querySelector('[role="progressbar"]')!.textContent).toBe('7%');
  });
  it('interpolates label text only: agent markup never becomes markup, style or colour', () => {
    const { element } = setup({ ...node, label: { text: hostile } });
    expect(element.querySelector('img, script')).toBeNull();
    expect(element.textContent).toContain(hostile);
    const ring = element.querySelector('[role="progressbar"]')!;
    const style = ring.getAttribute('style') ?? '';
    expect(style).toContain('--value');
    expect(style).not.toContain('onerror');
    expect(/#([0-9a-f]{3,8})/.test(style)).toBe(false);
    expect(/#([0-9a-f]{3,8})|text-(red|blue|green|yellow|slate|gray|zinc)-/.test(ring.className)).toBe(false);
  });
});