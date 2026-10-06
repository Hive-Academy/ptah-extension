import { TestBed } from '@angular/core/testing';
import { DashboardTextBlockComponent, type TextBlockNode } from './dashboard-text-block.component';

describe('DashboardTextBlockComponent', () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const node: TextBlockNode = { id: 'text', kind: 'text-block', role: 'heading',
    text: { text: 'Deploy notes' }, selectable: false };
  /** Both theme roots the webview ships: dark anubis and light anubis-light. */
  const themeRoots = ['anubis', 'anubis-light'] as const;
  function setup(value: TextBlockNode = node) {
    const fixture = TestBed.createComponent(DashboardTextBlockComponent);
    fixture.componentRef.setInput('node', value);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    return { fixture, element };
  }
  it('renders heading as a heading element and body as a paragraph under both theme roots', () => {
    for (const theme of themeRoots) {
      const heading = setup().element;
      heading.setAttribute('data-theme', theme);
      const h = heading.querySelector('h1, h2, h3, h4, h5, h6')!;
      expect(h).not.toBeNull();
      expect(h.textContent).toBe('Deploy notes');
      expect(heading.querySelector('p')).toBeNull();
      expect(heading.querySelector('[role]')).toBeNull(); // native semantics, no override

      const body = setup({ ...node, role: 'body' }).element;
      body.setAttribute('data-theme', theme);
      const p = body.querySelector('p')!;
      expect(p.textContent).toBe('Deploy notes');
      expect(body.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull();
    }
  });
  it('uses base-content typography tokens only, with no hard-coded colours', () => {
    const h = setup().element.querySelector('[data-testid="text-block-heading"]')!;
    expect(h.classList).toContain('text-base-content');
    const p = setup({ ...node, role: 'body' }).element.querySelector('[data-testid="text-block-body"]')!;
    expect(p.classList).toContain('text-base-content');
    for (const el of [h, p]) {
      expect(/#([0-9a-f]{3,8})|text-(red|blue|green|yellow|slate|gray|zinc)-/.test(el.className)).toBe(false);
    }
  });
  it('interpolates text only: agent markup never becomes markup, style or colour', () => {
    const { element } = setup({ ...node, text: { text: hostile } });
    expect(element.querySelector('img, style, [style], script')).toBeNull();
    expect(element.textContent).toContain(hostile);
  });
});