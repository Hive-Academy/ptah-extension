import { TestBed } from '@angular/core/testing';
import { DashboardDividerComponent, type DividerNode } from './dashboard-divider.component';

describe('DashboardDividerComponent', () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const node: DividerNode = { id: 'divider', kind: 'divider', direction: 'horizontal', selectable: false };
  /** Both theme roots the webview ships: dark anubis and light anubis-light. */
  const themeRoots = ['anubis', 'anubis-light'] as const;
  const directionClasses = {
    horizontal: 'divider',
    vertical: 'divider divider-horizontal',
  } as const;
  function setup(value: DividerNode = node) {
    const fixture = TestBed.createComponent(DashboardDividerComponent);
    fixture.componentRef.setInput('node', value);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    return { fixture, element };
  }
  it('maps each contract direction to its exact literal class and keeps aria-orientation equal to it, under both theme roots', () => {
    for (const direction of ['horizontal', 'vertical'] as const) {
      const { fixture, element } = setup({ ...node, direction });
      const divider = element.querySelector('[role="separator"]')!;
      for (const theme of themeRoots) {
        element.setAttribute('data-theme', theme);
        fixture.detectChanges();
        expect(divider.className).toBe(directionClasses[direction]);
        expect(divider.getAttribute('role')).toBe('separator');
        expect(divider.getAttribute('aria-orientation')).toBe(direction); // contract direction, not the daisyUI class name
      }
    }
  });
  it('renders no text node without text, plain text with text, and never agent markup', () => {
    const { element } = setup();
    const bare = element.querySelector('[role="separator"]')!;
    expect(bare.textContent!.trim()).toBe('');
    expect(bare.children.length).toBe(0); // no empty placeholder element
    const withText = setup({ ...node, text: { text: 'Section break' } }).element;
    expect(withText.querySelector('[role="separator"]')!.textContent).toContain('Section break');
    const hostileElement = setup({ ...node, text: { text: hostile } }).element;
    expect(hostileElement.querySelector('img, style, [style], script')).toBeNull();
    expect(hostileElement.textContent).toContain(hostile);
  });
});