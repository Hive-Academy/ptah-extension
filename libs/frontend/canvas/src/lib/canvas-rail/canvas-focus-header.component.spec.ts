import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SendToMessagingComponent } from '@ptah-extension/chat';
import { CanvasFocusHeaderComponent } from './canvas-focus-header.component';

@Component({ selector: 'ptah-send-to-messaging', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush, template: '<button type="button">Send to messaging</button>' })
class MessagingStub { readonly tabId = input.required<string>(); }

describe('CanvasFocusHeaderComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CanvasFocusHeaderComponent] });
    TestBed.overrideComponent(CanvasFocusHeaderComponent, { remove: { imports: [SendToMessagingComponent] }, add: { imports: [MessagingStub] } });
  });
  function mount() {
    const fixture = TestBed.createComponent(CanvasFocusHeaderComponent);
    fixture.componentRef.setInput('tabId', 'a'); fixture.componentRef.setInput('running', true);
    fixture.componentRef.setInput('title', 'Alpha'); fixture.detectChanges(); return fixture;
  }
  it('keeps the focused Stop node on title and state changes', () => {
    const fixture = mount(); const host = fixture.nativeElement as HTMLElement;
    const stop = host.querySelector<HTMLButtonElement>('[data-stop]')!;
    stop.focus(); fixture.componentRef.setInput('title', 'Beta'); fixture.componentRef.setInput('state', 'needs'); fixture.detectChanges();
    expect(host.querySelector('[data-stop]')).toBe(stop); expect(document.activeElement).toBe(stop);
  });
  it('moves focus to Compact when Stop disappears', () => {
    const fixture = mount(); const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLButtonElement>('[data-stop]')!.focus();
    fixture.componentRef.setInput('running', false); fixture.detectChanges();
    expect(host.querySelector('[data-stop]')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('[data-compact]'));
  });
  it('closes its own menu on Escape, consumes the event and returns focus to the trigger', () => {
    const fixture = mount(); const host = fixture.nativeElement as HTMLElement;
    const trigger = host.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
    trigger.click(); fixture.detectChanges();
    const menu = host.querySelector<HTMLElement>('[role="menu"]')!;
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    const parent = jest.fn(); host.addEventListener('keydown', parent);
    menu.dispatchEvent(event); fixture.detectChanges();
    expect(event.defaultPrevented).toBe(true); expect(parent).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger); expect(host.querySelector('[role="menu"]')).toBeNull();
  });
  function split(detailsOpen = false) {
    const fixture = mount(); fixture.componentRef.setInput('splitDisplayed', true);
    fixture.componentRef.setInput('detailsOpen', detailsOpen); fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const emitted: string[] = [];
    const component = fixture.componentInstance;
    component.closeSplitRequested.subscribe(() => emitted.push('closeSplit'));
    component.closePaneRequested.subscribe(() => emitted.push('closePane'));
    component.swapPanesRequested.subscribe(() => emitted.push('swapPanes'));
    component.detailsRequested.subscribe(() => emitted.push('details'));
    component.closeRequested.subscribe(() => emitted.push('closeSession'));
    const trigger = host.querySelector<HTMLButtonElement>('[data-header-menu]')!;
    return { fixture, host, emitted, trigger };
  }
  it.each([
    ['swap-panes', 'Swap panes', 'swapPanes'],
    ['close-pane', 'Close pane', 'closePane'],
    ['close-split', 'Close split', 'closeSplit'],
  ])('split menu item %s emits its void output once, closes the menu and returns focus to the trigger', (action, label, output) => {
    const { fixture, host, emitted, trigger } = split();
    trigger.click(); fixture.detectChanges();
    const item = host.querySelector<HTMLButtonElement>(`[role="menu"] [data-action="${action}"]`)!;
    expect(item.getAttribute('role')).toBe('menuitem');
    expect(item.textContent?.trim()).toBe(label);
    item.click(); fixture.detectChanges();
    expect(emitted).toEqual([output]);
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it('split actions are keyboard reachable right after the menu trigger and before Close session', () => {
    const { fixture, host, trigger } = split();
    trigger.click(); fixture.detectChanges();
    const items = [...host.querySelectorAll<HTMLButtonElement>('[role="menu"] button[role="menuitem"]')];
    expect(items.map((item) => item.dataset['action'])).toEqual(['swap-panes', 'close-pane', 'close-split']);
    const close = host.querySelector<HTMLButtonElement>('[aria-label="Close session"]')!;
    for (const item of items) {
      expect(item.tabIndex).toBe(0);
      expect(trigger.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(item.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
  it('Escape closes an open split menu first and never emits a close output', () => {
    const { fixture, host, emitted, trigger } = split();
    trigger.click(); fixture.detectChanges();
    const item = host.querySelector<HTMLButtonElement>('[data-action="close-pane"]')!;
    item.focus();
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    item.dispatchEvent(event); fixture.detectChanges();
    expect(event.defaultPrevented).toBe(true);
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(emitted).toEqual([]);
    expect(document.activeElement).toBe(trigger);
  });
  it('R9x-fix: Escape from the still-focused trigger closes a keyboard-opened menu once and closes no pane', () => {
    const { fixture, host, emitted, trigger } = split();
    const parent = jest.fn(); host.addEventListener('keydown', parent);
    // Enter/Space on a focused native button activates it as a click; focus stays on the trigger.
    trigger.focus(); trigger.click(); fixture.detectChanges();
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(trigger);
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    trigger.dispatchEvent(escape); fixture.detectChanges();
    expect(escape.defaultPrevented).toBe(true);
    expect(parent).not.toHaveBeenCalled();
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
    expect(emitted).toEqual([]);
    // Consumed once: with the menu closed, the next Escape passes through untouched.
    const next = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    trigger.dispatchEvent(next); fixture.detectChanges();
    expect(next.defaultPrevented).toBe(false);
    expect(parent).toHaveBeenCalledTimes(1);
    expect(emitted).toEqual([]);
  });
  it('single focus offers neither the split actions nor the header Details control', () => {
    const fixture = mount(); const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLButtonElement>('[data-header-menu]')!.click(); fixture.detectChanges();
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-action]')).toHaveLength(0);
    expect(host.querySelector('[data-details]')).toBeNull();
  });
  it('NEW-3: split Details is an in-flow header control that emits and reports its overlay state', () => {
    const { fixture, host, emitted } = split();
    const details = host.querySelector<HTMLButtonElement>('header > [data-details]')!;
    expect(details.getAttribute('aria-label')).toBe('Open details');
    expect(details.getAttribute('aria-expanded')).toBe('false');
    expect(details.className).not.toMatch(/\babsolute\b/);
    details.click();
    expect(emitted).toEqual(['details']);
    fixture.componentRef.setInput('detailsOpen', true); fixture.detectChanges();
    expect(details.getAttribute('aria-expanded')).toBe('true');
    expect([...host.querySelectorAll('header button')].filter((button) => /\babsolute\b/.test(button.className))).toHaveLength(0);
  });
  it('a split pane drops button words but keeps every label', () => {
    const { host } = split();
    expect(host.querySelector('[data-compact]')?.textContent).not.toContain('Compact');
    expect(host.querySelector('[data-stop]')?.textContent).not.toContain('Stop');
    expect(host.querySelector('[data-stop]')?.getAttribute('aria-label')).toBe('Stop session');
    expect(host.querySelector('[aria-label="Close session"]')?.textContent).not.toContain('Close');
  });
  it('hides button words and model in a narrow band while preserving labels', () => {
    const fixture = mount(); fixture.componentRef.setInput('band', 'sm'); fixture.componentRef.setInput('model', 'Opus'); fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).not.toContain('Opus');
    expect(host.querySelector('[data-compact]')?.textContent).not.toContain('Compact');
    expect(host.querySelector('[data-compact]')?.getAttribute('aria-label')).toBe('Switch to compact view');
  });
});
