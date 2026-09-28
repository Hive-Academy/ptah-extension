import { TestBed } from '@angular/core/testing';
import { DashboardListComponent, type ListNode } from './dashboard-list.component';

describe('DashboardListComponent and pager', () => {
  const node: ListNode = { id: 'list', kind: 'list', selectable: false, ordered: true,
    title: { text: '<img src=x onerror=alert(1)>' },
    items: [{ text: { text: 'Incident' }, detail: { text: 'Resolved yesterday' }, url: 'https://example.test' }] };
  function setup(value = node) {
    const fixture = TestBed.createComponent(DashboardListComponent);
    fixture.componentRef.setInput('node', value);
    fixture.componentRef.setInput('surfaceId', 'surface');
    fixture.componentInstance.viewStateChange.subscribe(state => fixture.componentRef.setInput('viewState', state));
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    const button = (control: string) => element.querySelector<HTMLButtonElement>(`[data-apps-focus-key="surface:list:${control}"]`)!;
    return { fixture, element, button };
  }
  it('honours ordered lists, secondary detail and literal URL/text without links or styles', () => {
    const { fixture, element } = setup();
    expect(element.querySelector('ol li')).not.toBeNull();
    expect(element.querySelector('ul')).toBeNull();
    expect(element.querySelector('h3')?.textContent).toBe(node.title?.text);
    const paragraphs = element.querySelectorAll('li p');
    expect(paragraphs[1].textContent).toBe('Resolved yesterday');
    expect(paragraphs[1].classList.contains('text-base-content-muted')).toBe(true);
    expect(paragraphs[2].textContent).toBe('https://example.test');
    expect(element.querySelector('a, [href], img, style, [style]')).toBeNull();
    fixture.componentRef.setInput('node', { ...node, ordered: false }); fixture.detectChanges();
    expect(element.querySelector('ul li')).not.toBeNull();
    expect(element.querySelector('ol')).toBeNull();
  });
  it('pages 25 items with native bounded buttons, status, focus keys and clamped indices', () => {
    const { fixture, element, button } = setup({ ...node,
      items: Array.from({ length: 51 }, (_, index) => ({ text: { text: `Row ${index}` } })) });
    expect(element.querySelectorAll('li')).toHaveLength(25);
    expect(element.textContent).toContain('Page 1 of 3');
    expect(button('previous').disabled).toBe(true);
    expect(button('next').disabled).toBe(false);
    expect(button('next').type).toBe('button');
    expect(button('next').tabIndex).toBe(0);
    button('next').click(); fixture.detectChanges();
    expect(element.textContent).toContain('Page 2 of 3');
    expect(element.querySelector('ol')?.start).toBe(26);
    expect(element.querySelector('li')?.textContent).toContain('Row 25');
    fixture.componentRef.setInput('viewState', { page: 999 }); fixture.detectChanges();
    expect(element.querySelectorAll('li')).toHaveLength(1);
    expect(element.textContent).toContain('Page 3 of 3');
    expect(button('next').disabled).toBe(true);
    button('previous').click(); fixture.detectChanges();
    expect(element.textContent).toContain('Page 2 of 3');
    for (const page of [-3, NaN]) {
      fixture.componentRef.setInput('viewState', { page }); fixture.detectChanges();
      expect(element.textContent).toContain('Page 1 of 3');
    }
    expect(Array.from(element.querySelectorAll('button, input')).every(control => control.getAttribute('data-apps-focus-key')?.startsWith('surface:list:'))).toBe(true);
  });
  it('filters visible title/detail/URL text and resets the page with a result count', () => {
    const { fixture, element } = setup({ ...node, items: [...(node.items ?? []), { text: { text: 'Second' } }] });
    const filter = element.querySelector('input')!;
    for (const query of ['YESTERDAY', 'example.test', 'incident']) {
      fixture.componentRef.setInput('viewState', { page: 99 }); fixture.detectChanges();
      filter.value = query; filter.dispatchEvent(new Event('input')); fixture.detectChanges();
      expect(element.querySelectorAll('li')).toHaveLength(1);
      expect(element.textContent).toContain('1 results');
      expect(fixture.componentInstance.viewState().page).toBe(0);
    }
    filter.value = 'absent'; filter.dispatchEvent(new Event('input')); fixture.detectChanges();
    expect(element.querySelectorAll('li')).toHaveLength(0);
    expect(element.textContent).toContain('0 results');
    expect(element.textContent).toContain('Page 1 of 1');
  });
  it('guards selection and emits original item indices after paging and filtering', () => {
    const { fixture, element, button } = setup({ ...node,
      items: Array.from({ length: 30 }, (_, index) => ({ text: { text: `Row ${index}` } })) });
    const emitted = jest.fn(); fixture.componentInstance.selectionChange.subscribe(emitted);
    expect(element.querySelector('li button')).toBeNull();
    fixture.componentInstance.selectItem(0); expect(emitted).not.toHaveBeenCalled();
    fixture.componentRef.setInput('node', { ...fixture.componentInstance.node(), selectable: true }); fixture.detectChanges();
    button('next').click(); fixture.detectChanges();
    button('item-25').click();
    expect(emitted).toHaveBeenLastCalledWith({ componentId: 'list', target: { kind: 'list-item', itemIndex: 25 } });
    fixture.componentInstance.setFilter('Row 29'); fixture.detectChanges();
    button('item-29').click();
    const selection = { componentId: 'list', target: { kind: 'list-item', itemIndex: 29 } };
    expect(emitted).toHaveBeenLastCalledWith(selection);
    fixture.componentRef.setInput('selection', selection); fixture.detectChanges();
    expect(button('item-29').getAttribute('aria-pressed')).toBe('true');
    fixture.componentInstance.selectItem(999); expect(emitted).toHaveBeenCalledTimes(2);
  });
  it('expands through controlled state and Escape returns focus to the icon button', () => {
    const { fixture, element, button } = setup(); document.body.appendChild(element);
    try {
      const expand = button('expand');
      const content = element.querySelector<HTMLElement>(`#${expand.getAttribute('aria-controls')}`)!;
      expect(expand.getAttribute('aria-label')).toBe(`Expand ${node.title?.text}`);
      expect(expand.getAttribute('aria-expanded')).toBe('false');
      expect(content.classList.contains('max-h-64')).toBe(true);
      expand.click(); fixture.detectChanges();
      expect(expand.getAttribute('aria-label')).toBe(`Collapse ${node.title?.text}`);
      expect(expand.getAttribute('aria-expanded')).toBe('true');
      expect(content.classList.contains('max-h-64')).toBe(false);
      element.querySelector('input')!.focus();
      element.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      expect(expand.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(expand);
      expect(element.querySelector('section')?.hasAttribute('tabindex')).toBe(false);
      expect(element.querySelector('section')?.hasAttribute('role')).toBe(false);
    } finally { element.remove(); }
  });
  it('uses unique content and filter ids for instances with the same node id', () => {
    const first = setup(); const second = setup();
    expect(first.button('expand').getAttribute('aria-controls')).not.toBe(second.button('expand').getAttribute('aria-controls'));
    for (const { element, button } of [first, second]) {
      expect(element.querySelector(`#${button('expand').getAttribute('aria-controls')}`)).not.toBeNull();
      expect(element.querySelector('label')?.htmlFor).toBe(element.querySelector('input')?.id);
    }
    expect(first.element.querySelector('input')?.id).not.toBe(second.element.querySelector('input')?.id);
  });
  it('handles malformed items and non-string optional fields without throwing or losing original indices', () => {
    const malformed = { ...node, selectable: true, title: { text: 42 }, items: [null, 2, {},
      { text: { text: 'Valid' }, detail: { text: 12 }, url: {} },
      { text: { text: {} }, detail: { text: 'Detail only' }, url: 'plain-url' }] } as unknown as ListNode;
    const { fixture, element, button } = setup(malformed);
    expect(element.querySelector('h3')?.textContent).toBe('List');
    expect(element.querySelectorAll('li')).toHaveLength(2);
    expect(element.textContent).not.toContain('[object Object]');
    expect(element.textContent).toContain('Detail only');
    const emitted = jest.fn(); fixture.componentInstance.selectionChange.subscribe(emitted);
    button('item-3').click();
    expect(emitted).toHaveBeenCalledWith({ componentId: 'list', target: { kind: 'list-item', itemIndex: 3 } });
    for (const items of [undefined, null, {}, 'not-an-array']) {
      fixture.componentRef.setInput('node', { ...node, items });
      expect(() => fixture.detectChanges()).not.toThrow();
      expect(element.querySelectorAll('li')).toHaveLength(0);
    }
  });
  it('shows an unavailable data notice and row count instead of list or filter controls', () => {
    const { element } = setup({ ...node, items: undefined, data: { resultId: 'opaque', rowCount: 71 } });
    expect(element.textContent).toContain('not available');
    expect(element.textContent).toContain('71 rows');
    expect(element.querySelector('ol, ul, input, ptah-dashboard-pager')).toBeNull();
  });
});
