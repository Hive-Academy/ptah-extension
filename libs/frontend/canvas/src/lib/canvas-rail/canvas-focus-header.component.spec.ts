import { TestBed } from '@angular/core/testing';
import { CanvasFocusHeaderComponent } from './canvas-focus-header.component';

describe('CanvasFocusHeaderComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CanvasFocusHeaderComponent] });
  });
  function mount() {
    const fixture = TestBed.createComponent(CanvasFocusHeaderComponent);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    document.body.appendChild(root);
    return { fixture, root };
  }

  it('shows only the pane actions trigger: no session controls', () => {
    const { root } = mount();
    const group = root.querySelector<HTMLElement>('[role="group"]')!;
    expect(group.getAttribute('aria-label')).toBe('Pane controls');
    expect(
      Array.from(group.querySelectorAll('button')).map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Pane actions']);
    for (const label of [
      'Stop session',
      'Switch to compact view',
      'Switch to full view',
      'Close session',
      'More session actions',
    ]) {
      expect(root.querySelector(`[aria-label="${label}"]`)).toBeNull();
    }
    expect(root.querySelector('ptah-send-to-messaging')).toBeNull();
    root.remove();
  });

  it('offers Swap panes, Close pane and Close split, and returns focus after a choice and Escape', () => {
    const { fixture, root } = mount();
    const trigger = root.querySelector<HTMLButtonElement>('[data-header-menu]')!;
    trigger.click();
    fixture.detectChanges();
    const items = Array.from(root.querySelectorAll('[role="menuitem"]'));
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      'Swap panes',
      'Close pane',
      'Close split',
    ]);
    // The menu sizes to its labels instead of the narrow floating group, so none wraps.
    const menu = root.querySelector<HTMLElement>('[role="menu"]')!;
    for (const cls of ['w-max', 'min-w-36', 'whitespace-nowrap']) {
      expect(menu.classList).toContain(cls);
    }
    trigger.click();
    fixture.detectChanges();
    expect(root.querySelector('[role="menu"]')).toBeNull();
    const swapped = jest.fn();
    const paneClosed = jest.fn();
    const splitClosed = jest.fn();
    fixture.componentInstance.swapPanesRequested.subscribe(swapped);
    fixture.componentInstance.closePaneRequested.subscribe(paneClosed);
    fixture.componentInstance.closeSplitRequested.subscribe(splitClosed);
    for (const action of ['swap-panes', 'close-pane', 'close-split']) {
      trigger.click();
      fixture.detectChanges();
      root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.click();
      fixture.detectChanges();
      expect(document.activeElement).toBe(trigger);
      expect(root.querySelector('[role="menu"]')).toBeNull();
    }
    expect(swapped).toHaveBeenCalledTimes(1);
    expect(paneClosed).toHaveBeenCalledTimes(1);
    expect(splitClosed).toHaveBeenCalledTimes(1);
    trigger.click();
    fixture.detectChanges();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    trigger.dispatchEvent(escape);
    fixture.detectChanges();
    expect(escape.defaultPrevented).toBe(true);
    expect(root.querySelector('[role="menu"]')).toBeNull();
    root.remove();
  });

  it('focuses the first item on open and roves with ArrowUp/Down, Home and End; Escape returns to the trigger', () => {
    const { fixture, root } = mount();
    const trigger = root.querySelector<HTMLButtonElement>('[data-header-menu]')!;
    trigger.focus();
    trigger.click();
    fixture.detectChanges();
    TestBed.tick();
    const [swap, closePane, closeSplit] = Array.from(
      root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    );
    expect(document.activeElement).toBe(swap);
    const press = (key: string) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      document.activeElement!.dispatchEvent(event);
      fixture.detectChanges();
      return event;
    };
    expect(press('ArrowDown').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(closePane);
    press('End');
    expect(document.activeElement).toBe(closeSplit);
    press('ArrowDown');
    expect(document.activeElement).toBe(swap);
    press('ArrowUp');
    expect(document.activeElement).toBe(closeSplit);
    press('Home');
    expect(document.activeElement).toBe(swap);
    expect(press('Tab').defaultPrevented).toBe(false);
    expect(press('Escape').defaultPrevented).toBe(true);
    expect(root.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    root.remove();
  });

  it('closes the menu on an outside press, not on a press inside it', () => {
    const { fixture, root } = mount();
    root.querySelector<HTMLButtonElement>('[data-header-menu]')!.click();
    fixture.detectChanges();
    const menu = root.querySelector<HTMLElement>('[role="menu"]')!;
    menu.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(root.querySelector('[role="menu"]')).not.toBeNull();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(root.querySelector('[role="menu"]')).toBeNull();
    root.remove();
  });
});
