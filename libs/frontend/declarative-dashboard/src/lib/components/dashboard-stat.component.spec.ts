import { TestBed } from '@angular/core/testing';
import { SPARK_HEIGHT, sparklineGeometry } from '../charts/sparkline-geometry';
import { DashboardStatComponent, type StatNode } from './dashboard-stat.component';

describe('DashboardStatComponent', () => {
  const node: StatNode = { id: 'stat', kind: 'stat', selectable: false,
    title: { text: '<img src=x onerror=alert(1)>' }, value: 42, unit: 'deploys', delta: 2,
    description: { text: 'This week' } };
  function setup(value = node) {
    const fixture = TestBed.createComponent(DashboardStatComponent);
    fixture.componentRef.setInput('node', value);
    fixture.componentRef.setInput('surfaceId', 'surface');
    fixture.componentInstance.viewStateChange.subscribe(state => fixture.componentRef.setInput('viewState', state));
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    return { fixture, element };
  }
  it('renders literal label, value, unit and signed delta on a neutral surface without styles', () => {
    const { fixture, element } = setup();
    expect(element.querySelector('h3')?.textContent).toBe(node.title?.text);
    expect(element.textContent).toContain('42 deploys');
    const delta = () => element.querySelector('[data-testid="stat-delta"]');
    expect(delta()?.textContent).toBe('Δ Change +2');
    expect(element.querySelector('img, style, [style]')).toBeNull();
    expect(element.querySelector('section')?.classList.contains('bg-base-200')).toBe(true);
    for (const value of [0, -2, undefined]) {
      fixture.componentRef.setInput('node', { ...node, delta: value }); fixture.detectChanges();
      if (value === undefined) expect(delta()).toBeNull();
      else expect(delta()?.textContent).toBe(`Δ Change ${value}`);
    }
  });
  it('is a compact bordered tile with the delta inline in the header (R10 visual review)', () => {
    const { element } = setup();
    const section = element.querySelector('section')!;
    expect(section.classList).toContain('border');
    expect(section.classList).toContain('px-2');
    expect(section.classList).not.toContain('p-3');
    const header = element.querySelector('h3')!.parentElement!;
    expect(header.querySelector('[data-testid="stat-delta"]')).not.toBeNull();
    expect(header.querySelector('[aria-expanded]')).not.toBeNull();
    expect(element.querySelector('h3')?.classList).toContain('text-[10px]');
    const value = element.querySelector('[data-testid="stat-value"]')!;
    expect(value.textContent).toBe('42 deploys');
    expect(value.classList).toContain('text-sm');
    // Body text colour, not text-primary: primary on base-200 fails WCAG AA (R10 re-check).
    expect(value.classList).toContain('text-base-content');
    expect(value.classList).not.toContain('text-primary');
    // The delta's symbol is decorative; assistive tech reads "Change +2".
    expect(element.querySelector('[data-testid="stat-delta"] [aria-hidden="true"]')?.textContent).toBe('Δ ');
  });
  it('offers selection only for selectable stats and emits the contract target', () => {
    const { fixture, element } = setup();
    const emitted = jest.fn();
    fixture.componentInstance.selectionChange.subscribe(emitted);
    expect(element.querySelector('[data-apps-focus-key="surface:stat:select"]')).toBeNull();
    fixture.componentInstance.selectStat(); expect(emitted).not.toHaveBeenCalled();
    fixture.componentRef.setInput('node', { ...node, selectable: true }); fixture.detectChanges();
    const button = element.querySelector<HTMLButtonElement>('[data-apps-focus-key="surface:stat:select"]')!;
    button.click();
    const selection = { componentId: 'stat', target: { kind: 'stat' } };
    expect(emitted).toHaveBeenCalledWith(selection);
    fixture.componentRef.setInput('selection', selection); fixture.detectChanges();
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });
  it('expands details through controlled state and Escape restores button focus', () => {
    const { fixture, element } = setup({ ...node, selectable: true });
    document.body.appendChild(element);
    try {
      const expand = element.querySelector<HTMLButtonElement>('[aria-expanded]')!;
      const details = element.querySelector<HTMLElement>(`#${expand.getAttribute('aria-controls')}`)!;
      expect(expand.getAttribute('aria-label')).toBe(`Expand ${node.title?.text}`);
      expect(expand.getAttribute('aria-expanded')).toBe('false');
      expect(details.hidden).toBe(true);
      expand.click(); fixture.detectChanges();
      expect(expand.getAttribute('aria-label')).toBe(`Collapse ${node.title?.text}`);
      expect(expand.getAttribute('aria-expanded')).toBe('true');
      expect(details.hidden).toBe(false);
      expect(details.textContent).toContain('This week');
      const select = element.querySelector<HTMLButtonElement>('[data-apps-focus-key="surface:stat:select"]')!;
      select.focus(); select.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      expect(details.hidden).toBe(true);
      expect(expand.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(expand);
      expect(element.querySelector('section')?.hasAttribute('tabindex')).toBe(false);
      expect(element.querySelector('section')?.hasAttribute('role')).toBe(false);
      expect(Array.from(element.querySelectorAll('button')).every(button => button.getAttribute('data-apps-focus-key')?.startsWith('surface:stat:'))).toBe(true);
    } finally { element.remove(); }
  });
  describe('dashboard-catalog/4 trend pill (R4.3)', () => {
    const pill = (element: HTMLElement) => element.querySelector<HTMLElement>('[data-testid="stat-trend"]');
    it('renders no pill and no sparkline without trend or spark', () => {
      const { element } = setup();
      expect(pill(element)).toBeNull();
      expect(element.querySelector('ptah-dashboard-sparkline')).toBeNull();
    });
    it('states direction with an arrow and words, never colour alone', () => {
      const { fixture, element } = setup({ ...node, trend: { direction: 'up', amount: 4.2, percent: true } });
      const up = pill(element)!;
      expect(up.textContent).toBe('Trend up 4.2%');
      const arrow = up.querySelector('svg')!;
      expect(arrow.getAttribute('aria-hidden')).toBe('true');
      const upPath = arrow.querySelector('path')!.getAttribute('d');
      fixture.componentRef.setInput('node', { ...node, trend: { direction: 'down', amount: 3, percent: false } });
      fixture.detectChanges();
      expect(pill(element)!.textContent).toBe('Trend down 3');
      expect(pill(element)!.querySelector('path')!.getAttribute('d')).not.toBe(upPath);
    });
    it('maps good to success, bad to error and no polarity to neutral, with the polarity in text', () => {
      const { fixture, element } = setup();
      const cases = [['good', 'dp-trend--good', 'Trend up 1, good'], ['bad', 'dp-trend--bad', 'Trend up 1, bad'],
        [undefined, 'dp-trend--neutral', 'Trend up 1']] as const;
      for (const [polarity, toneClass, text] of cases) {
        fixture.componentRef.setInput('node', { ...node,
          trend: { direction: 'up', amount: 1, percent: false, ...(polarity ? { polarity } : {}) } });
        fixture.detectChanges();
        expect(pill(element)!.className).toBe(`dp-trend ${toneClass}`);
        expect(pill(element)!.textContent).toBe(text);
      }
      expect(element.querySelector('[style]')).toBeNull();
    });
  });

  describe('dashboard-catalog/4 sparkline (R4.4)', () => {
    const svg = (element: HTMLElement) => element.querySelector<SVGSVGElement>('[data-testid="stat-spark"]')!;
    const barClasses = (element: HTMLElement) => Array.from(svg(element).querySelectorAll('rect')).map(rect => rect.getAttribute('class'));
    it('is one labelled img listing every point, with only the latest bar highlighted in primary', () => {
      const { element } = setup({ ...node, spark: [2, 3, 2, 4, 3, 5, 7] });
      expect(svg(element).getAttribute('role')).toBe('img');
      expect(svg(element).getAttribute('aria-label')).toBe(`${node.title?.text} trend, 7 points: 2, 3, 2, 4, 3, 5, 7; latest 7`);
      const classes = barClasses(element);
      expect(classes).toHaveLength(7);
      expect(classes.slice(0, 6).every(name => name === 'dp-spark-bar')).toBe(true);
      expect(classes[6]).toBe('dp-spark-bar dp-spark-bar--latest');
      expect(element.querySelector('img, style, [style]')).toBeNull();
    });
    it('draws the latest bar in the error fill for a failing (bad polarity) series', () => {
      const { element } = setup({ ...node, spark: [40, 40, 38],
        trend: { direction: 'down', amount: 2, percent: false, polarity: 'bad' } });
      expect(barClasses(element)).toEqual(['dp-spark-bar', 'dp-spark-bar', 'dp-spark-bar dp-spark-bar--failing']);
    });
    it('keeps every bar visible and inside the 30-unit box for zero, negative and extreme points', () => {
      for (const points of [[0, 0], [-5, 3, -1], [Number.MAX_VALUE, -Number.MAX_VALUE], [1, 1, 1]]) {
        const geometry = sparklineGeometry(points);
        expect(geometry.bars).toHaveLength(points.length);
        for (const bar of geometry.bars) {
          expect(Number.isFinite(bar.height) && Number.isFinite(bar.y)).toBe(true);
          expect(bar.height).toBeGreaterThanOrEqual(4);
          expect(bar.y + bar.height).toBeCloseTo(SPARK_HEIGHT);
          expect(bar.y).toBeGreaterThanOrEqual(0);
        }
        expect(geometry.bars.filter(bar => bar.latest).map(bar => bar.index)).toEqual([points.length - 1]);
      }
      const [low, high] = sparklineGeometry([1, 10]).bars;
      expect(high!.height).toBeGreaterThan(low!.height);
    });
  });

  it('assigns unique expansion ids to stat instances sharing a node id', () => {
    const first = setup(); const second = setup();
    const ids = [first, second].map(({ element }) => element.querySelector('[aria-controls]')!.getAttribute('aria-controls'));
    expect(ids[0]).not.toBe(ids[1]);
    expect(first.element.querySelector(`#${ids[0]}`)).not.toBeNull();
    expect(second.element.querySelector(`#${ids[1]}`)).not.toBeNull();
  });
});
