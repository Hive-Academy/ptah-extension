import { TestBed } from '@angular/core/testing';
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
    expect(element.textContent).toContain('Change: +2');
    expect(element.querySelector('img, style, [style]')).toBeNull();
    expect(element.querySelector('section')?.classList.contains('bg-base-200')).toBe(true);
    for (const delta of [0, -2, undefined]) {
      fixture.componentRef.setInput('node', { ...node, delta }); fixture.detectChanges();
      if (delta === undefined) expect(element.textContent).not.toContain('Change:');
      else expect(element.textContent).toContain(`Change: ${delta}`);
    }
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
  it('assigns unique expansion ids to stat instances sharing a node id', () => {
    const first = setup(); const second = setup();
    const ids = [first, second].map(({ element }) => element.querySelector('[aria-controls]')!.getAttribute('aria-controls'));
    expect(ids[0]).not.toBe(ids[1]);
    expect(first.element.querySelector(`#${ids[0]}`)).not.toBeNull();
    expect(second.element.querySelector(`#${ids[1]}`)).not.toBeNull();
  });
});
