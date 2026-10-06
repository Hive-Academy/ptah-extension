import { TestBed } from '@angular/core/testing';
import { DashboardProgressComponent, type ProgressNode } from './dashboard-progress.component';

describe('DashboardProgressComponent', () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const node: ProgressNode = { id: 'progress', kind: 'progress', value: 42.5, tone: 'primary',
    label: { text: 'Indexing' }, selectable: false };
  /** Both theme roots the webview ships: dark anubis and light anubis-light. */
  const themeRoots = ['anubis', 'anubis-light'] as const;
  const toneClasses = {
    neutral: 'progress',
    primary: 'progress progress-primary',
    info: 'progress progress-info',
    success: 'progress progress-success',
    warning: 'progress progress-warning',
    error: 'progress progress-error',
  } as const;
  const tones = ['neutral', 'primary', 'info', 'success', 'warning', 'error'] as const;
  function setup(value: ProgressNode = node) {
    const fixture = TestBed.createComponent(DashboardProgressComponent);
    fixture.componentRef.setInput('node', value);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    return { fixture, element };
  }
  it('renders every tone with its exact literal class under both theme roots', () => {
    for (const tone of tones) {
      const { fixture, element } = setup({ ...node, tone });
      const bar = element.querySelector('progress')!;
      for (const theme of themeRoots) {
        element.setAttribute('data-theme', theme);
        fixture.detectChanges();
        expect(bar.className).toBe(toneClasses[tone]);
      }
    }
    expect(toneClasses.neutral).toBe('progress'); // daisyUI has no progress-neutral
  });
  it('exposes the full progressbar ARIA contract with an exact, unrounded value', () => {
    const { element } = setup();
    const bar = element.querySelector<HTMLProgressElement>('progress')!;
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuenow')).toBe('42.5');
    expect(bar.value).toBe(42.5);
    for (const value of [0, 100]) {
      const edge = setup({ ...node, value }).element;
      expect(edge.querySelector('progress')!.getAttribute('aria-valuenow')).toBe(`${value}`);
    }
  });
  it('takes the accessible label from label and keeps the label as visible text with the unrounded percentage', () => {
    const { element } = setup();
    expect(element.querySelector('progress')!.getAttribute('aria-label')).toBe('Indexing');
    expect(element.querySelector('[data-testid="progress-label"]')?.textContent).toBe('Indexing');
    expect(element.textContent).toContain('42.5%');
    const whole = setup({ ...node, value: 7 }).element;
    expect(whole.textContent).toContain('7%');
  });
  it('interpolates label text only: agent markup never becomes markup, style or colour', () => {
    const { element } = setup({ ...node, label: { text: hostile } });
    expect(element.querySelector('img, style, [style], script')).toBeNull();
    expect(element.textContent).toContain(hostile);
    const classes = element.querySelector('progress')!.className;
    expect(/#([0-9a-f]{3,8})|text-(red|blue|green|yellow|slate|gray|zinc)-/.test(classes)).toBe(false);
  });
});