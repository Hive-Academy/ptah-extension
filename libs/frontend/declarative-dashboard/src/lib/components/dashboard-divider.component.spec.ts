import { TestBed } from '@angular/core/testing';
import { DashboardDividerComponent, type DividerNode } from './dashboard-divider.component';

describe('DashboardDividerComponent', () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const node: DividerNode = { id: 'divider', kind: 'divider', direction: 'horizontal', selectable: false };
  /** Both theme roots the webview ships: dark anubis and light anubis-light. */
  const themeRoots = ['anubis', 'anubis-light'] as const;
  const containerClasses = {
    horizontal: 'divider',
    vertical: 'flex flex-col items-center self-stretch min-h-12 gap-1 mx-2 text-sm',
  } as const;
  const segmentClass = 'w-0.5 min-h-4 flex-1 bg-base-content/10';
  function setup(value: DividerNode = node) {
    const fixture = TestBed.createComponent(DashboardDividerComponent);
    fixture.componentRef.setInput('node', value);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    return { fixture, element };
  }
  it('keeps role, aria-orientation and the exact class set per direction under both theme roots', () => {
    for (const direction of ['horizontal', 'vertical'] as const) {
      const { fixture, element } = setup({ ...node, direction });
      const divider = element.querySelector('[role="separator"]')!;
      for (const theme of themeRoots) {
        element.setAttribute('data-theme', theme);
        fixture.detectChanges();
        // Ivy writes the class set in its own order; the complete literal in the
        // component source is what Tailwind scans, so compare the exact set.
        expect(divider.className.split(/\s+/).sort().join(' ')).toBe(containerClasses[direction].split(/\s+/).sort().join(' '));
        expect(divider.getAttribute('role')).toBe('separator');
        expect(divider.getAttribute('aria-orientation')).toBe(direction); // contract direction, not the daisyUI class name
      }
    }
  });
  it('draws the vertical rule with two explicit segments around the optional text (round 3)', () => {
    const withText = setup({ ...node, direction: 'vertical', text: { text: 'or' } }).element;
    const container = withText.querySelector('[role="separator"]')!;
    const segments = Array.from(container.querySelectorAll<HTMLElement>('[aria-hidden="true"]'));
    expect(segments.length).toBe(2); // the explicit rule, not daisyUI ::before/::after
    for (const segment of segments) {
      expect(segment.className.split(/\s+/).sort().join(' ')).toBe(segmentClass.split(/\s+/).sort().join(' '));
      expect(segment.textContent).toBe(''); // pure rule segment, no hidden content
    }
    const textSpan = container.querySelector<HTMLElement>('span:not([aria-hidden="true"])')!;
    expect(textSpan.textContent).toBe('or');
    // the text sits between the two rule halves
    expect(segments[0].compareDocumentPosition(textSpan) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(segments[1].compareDocumentPosition(textSpan) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    const bare = setup({ ...node, direction: 'vertical' }).element;
    const bareContainer = bare.querySelector('[role="separator"]')!;
    expect(bareContainer.querySelectorAll('[aria-hidden="true"]').length).toBe(2); // the rule is still drawn with no text
    expect(bareContainer.querySelector('span:not([aria-hidden="true"])')).toBeNull(); // no empty text span
    expect(bareContainer.textContent!.trim()).toBe('');
  });
  it('stretches the host only for the vertical divider; horizontal keeps daisyUI\'s own divider', () => {
    const vertical = setup({ ...node, direction: 'vertical' }).element;
    expect(vertical.classList.contains('flex')).toBe(true);
    expect(vertical.classList.contains('self-stretch')).toBe(true);
    const horizontal = setup().element;
    expect(horizontal.classList.contains('flex')).toBe(false); // horizontal host unchanged
    expect(horizontal.classList.contains('self-stretch')).toBe(false);
    const horizontalContainer = horizontal.querySelector('[role="separator"]')!;
    expect(horizontalContainer.className).toBe('divider'); // daisy's own rule and text slot unchanged
    expect(horizontalContainer.querySelectorAll('[aria-hidden="true"]').length).toBe(0);
  });
  it('renders plain text only and never agent markup, in both directions', () => {
    for (const direction of ['horizontal', 'vertical'] as const) {
      const element = setup({ ...node, direction, text: { text: 'Section break' } }).element;
      expect(element.querySelector('[role="separator"]')!.textContent).toContain('Section break');
      const hostileElement = setup({ ...node, direction, text: { text: hostile } }).element;
      expect(hostileElement.querySelector('img, style, [style], script')).toBeNull();
      expect(hostileElement.textContent).toContain(hostile);
    }
    const bare = setup().element;
    expect(bare.querySelector('[role="separator"]')!.textContent!.trim()).toBe('');
    expect(bare.querySelector('[role="separator"]')!.children.length).toBe(0); // no empty placeholder element
  });
});