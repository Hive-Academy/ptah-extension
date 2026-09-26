import { TestBed } from '@angular/core/testing';
import { DashboardChartComponent, type ChartNode } from './dashboard-chart.component';

describe('DashboardChartComponent', () => {
  const node: ChartNode = { id: 'chart', kind: 'line-chart', selectable: false,
    title: { text: '<img src=x onerror=alert(1)>' }, xLabel: { text: 'Day' }, yLabel: { text: 'Count' },
    series: [{ name: 'First', points: [{ x: 'Mon', y: 4 }] }, { name: 'Second', points: [{ x: 'Tue', y: -2 }] }] };
  function setup(value = node) {
    const fixture = TestBed.createComponent(DashboardChartComponent);
    fixture.componentRef.setInput('node', value);
    fixture.componentRef.setInput('surfaceId', 'surface');
    fixture.componentInstance.viewStateChange.subscribe(state => fixture.componentRef.setInput('viewState', state));
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    return { fixture, element };
  }
  it('renders literal text, labelled axes and patterned series without styles', () => {
    const { element } = setup();
    expect(element.querySelector('img')).toBeNull();
    expect(element.textContent).toContain(node.title?.text);
    expect(element.textContent).toContain('Day');
    expect(element.textContent).toContain('Count');
    const lines = element.querySelectorAll('polyline');
    expect(lines).toHaveLength(2);
    expect(lines[0].getAttribute('stroke-dasharray')).not.toBe(lines[1].getAttribute('stroke-dasharray'));
    expect(lines[0].classList.contains('stroke-primary')).toBe(true);
    expect(lines[1].classList.contains('stroke-secondary')).toBe(true);
    const swatches = element.querySelectorAll('ul svg line');
    expect(swatches[0].getAttribute('class')).toBe(lines[0].getAttribute('class'));
    expect(swatches[1].getAttribute('stroke-dasharray')).toBe(lines[1].getAttribute('stroke-dasharray'));
    expect(element.querySelector('svg text')?.classList.contains('text-base-content-muted')).toBe(true);
    expect(element.querySelector('style, [style]')).toBeNull();
  });
  it('toggles the same data to a table and back with aria-pressed', () => {
    const { fixture, element } = setup();
    const toggle = element.querySelector('button')!;
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.getAttribute('data-apps-focus-key')).toBe('surface:chart:table');
    toggle.click(); fixture.detectChanges();
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(element.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(element.querySelector('tbody')?.textContent).toContain('FirstMon4');
    expect(element.querySelectorAll('tbody button')).toHaveLength(0);
    toggle.click(); fixture.detectChanges();
    expect(element.querySelector('table')).toBeNull();
  });
  it('expands and collapses through view state only; Escape collapses and returns focus', () => {
    const { fixture, element } = setup();
    document.body.appendChild(element);
    try {
      const emitted = jest.fn();
      fixture.componentInstance.viewStateChange.subscribe(emitted);
      const expand = element.querySelector('button[aria-expanded]') as HTMLButtonElement;
      const content = element.querySelector(`#${expand.getAttribute('aria-controls')}`) as HTMLElement;
      expect(content.querySelector('svg')?.classList.contains('max-h-64')).toBe(true);
      expect(expand.getAttribute('aria-label')).toBe(`Expand ${node.title?.text}`);
      expect(expand.getAttribute('data-apps-focus-key')).toBe('surface:chart:expand');
      expand.click(); fixture.detectChanges();
      expect(emitted).toHaveBeenLastCalledWith({ expanded: true });
      expect(expand.getAttribute('aria-expanded')).toBe('true');
      expect(expand.textContent?.trim()).toBe('Collapse');
      expect(content.querySelector('svg')?.classList.contains('max-h-64')).toBe(false);
      content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      expect(emitted).toHaveBeenLastCalledWith({ expanded: false });
      expect(expand.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(expand);
    } finally {
      element.remove();
    }
  });
  it('shows a reference notice and rowCount instead of an empty chart', () => {
    const { element } = setup({ ...node, series: undefined, data: { resultId: 'opaque', rowCount: 123 } });
    expect(element.textContent).toContain('not available');
    expect(element.textContent).toContain('123 rows');
    expect(element.querySelector('svg, table, button')).toBeNull();
  });
  it('keeps the 5000-point SVG small and pages selection with original indices', () => {
    const { fixture, element } = setup({ ...node, selectable: true,
      series: [{ name: 'A', points: Array.from({ length: 5000 }, (_, x) => ({ x, y: x })) }] });
    expect(element.querySelectorAll('polyline')).toHaveLength(1);
    expect(element.querySelectorAll('circle')).toHaveLength(0);
    expect(element.querySelectorAll('svg *').length).toBeLessThan(20);
    element.querySelector('button')!.click(); fixture.detectChanges();
    expect(element.querySelectorAll('tbody tr')).toHaveLength(25);
    Array.from(element.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Next')!.click();
    fixture.detectChanges();
    const selected = jest.fn();
    fixture.componentInstance.selectionChange.subscribe(selected);
    element.querySelector<HTMLButtonElement>('tbody button')!.click();
    expect(selected).toHaveBeenCalledWith({ componentId: 'chart', target: { kind: 'chart-point', seriesIndex: 0, pointIndex: 25 } });
    fixture.componentRef.setInput('node', { ...node, selectable: false }); fixture.detectChanges();
    fixture.componentInstance.selectPoint(fixture.componentInstance.geometry().rows[0]);
    expect(selected).toHaveBeenCalledTimes(1);
  });
  it('renders solid primary and hatched secondary bars with matching rect legends', () => {
    const { element } = setup({ ...node, kind: 'bar-chart' });
    const bars = element.querySelectorAll('svg[role="img"] > rect');
    expect(bars).toHaveLength(2);
    expect(bars[0].getAttribute('stroke-dasharray')).not.toBe(bars[1].getAttribute('stroke-dasharray'));
    expect(bars[0].classList.contains('fill-primary')).toBe(true);
    expect(bars[0].classList.contains('stroke-primary')).toBe(true);
    expect(bars[0].getAttribute('fill')).toBeNull();
    expect(bars[1].classList.contains('stroke-secondary')).toBe(true);
    expect(bars[1].getAttribute('class')).not.toContain('fill-');
    const pattern = element.querySelector('pattern')!;
    expect(pattern.getAttribute('patternTransform')).toBe('rotate(45)');
    expect(pattern.getAttribute('patternUnits')).toBe('userSpaceOnUse');
    expect(pattern.querySelector('line')?.classList.contains('stroke-secondary')).toBe(true);
    expect(bars[1].getAttribute('fill')).toBe(`url(#${pattern.id})`);
    const swatches = element.querySelectorAll('ul svg rect');
    expect(swatches).toHaveLength(2);
    expect(element.querySelector('ul svg line')).toBeNull();
    for (let index = 0; index < bars.length; index++) {
      expect(swatches[index].getAttribute('class')).toBe(bars[index].getAttribute('class'));
      expect(swatches[index].getAttribute('fill')).toBe(bars[index].getAttribute('fill'));
    }
    expect(bars[1].textContent).toContain('Second');
    expect(element.querySelector('style, [style]')).toBeNull();
  });
  it('uses unique hatch ids across chart instances with the same node id', () => {
    const first = setup({ ...node, kind: 'bar-chart' });
    const second = setup({ ...node, kind: 'bar-chart' });
    const container = document.createElement('div');
    document.body.appendChild(container);
    container.append(first.element, second.element);
    try {
      const patterns = container.querySelectorAll('pattern');
      expect(patterns).toHaveLength(2);
      expect(patterns[0].id).not.toBe(patterns[1].id);
      for (const { element } of [first, second]) {
        const id = element.querySelector('pattern')!.id;
        const fills = Array.from(element.querySelectorAll('rect[fill]')).map(rect => rect.getAttribute('fill'));
        expect(fills).toEqual([`url(#${id})`, `url(#${id})`]);
        expect(document.getElementById(id)).toBe(element.querySelector('pattern'));
      }
    } finally {
      container.remove();
    }
  });
});
