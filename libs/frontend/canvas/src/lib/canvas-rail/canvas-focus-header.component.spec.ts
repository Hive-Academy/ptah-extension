import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SendToMessagingComponent } from '@ptah-extension/chat';
import { FloatingUIService } from '@ptah-extension/ui';
import { CanvasFocusHeaderComponent } from './canvas-focus-header.component';

@Component({
  selector: 'ptah-send-to-messaging',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<button type="button">Send to messaging</button>',
  host: { '[attr.data-trigger]': 'trigger()' },
})
class MessagingStub {
  readonly tabId = input.required<string>();
  readonly trigger = input<'text' | 'icon'>('text');
}

describe('CanvasFocusHeaderComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [CanvasFocusHeaderComponent],
    });
    TestBed.overrideComponent(CanvasFocusHeaderComponent, {
      remove: { imports: [SendToMessagingComponent] },
      add: { imports: [MessagingStub] },
    });
  });
  function mount() {
    const fixture = TestBed.createComponent(CanvasFocusHeaderComponent);
    fixture.componentRef.setInput('tabId', 'a');
    fixture.componentRef.setInput('running', true);
    fixture.detectChanges();
    return fixture;
  }

  it.each([false, true])('renders controls without a header (rail=%s)', rail => {
    const fixture = mount();
    fixture.componentRef.setInput('rail', rail);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('header')).toBeNull();
    for (const label of ['Stop session', 'Switch to compact view', 'More session actions', 'Close session']) {
      expect(root.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
    }
  });

  it('keeps Stop, view toggle and Close wired to their outputs', () => {
    const fixture = mount();
    const stopped = jest.fn(), toggled = jest.fn(), closed = jest.fn();
    fixture.componentInstance.stop.subscribe(stopped);
    fixture.componentInstance.toggleViewMode.subscribe(toggled);
    fixture.componentInstance.closeRequested.subscribe(closed);
    const root: HTMLElement = fixture.nativeElement;
    root.querySelector<HTMLButtonElement>('[data-stop]')?.click();
    root.querySelector<HTMLButtonElement>('[data-compact]')?.click();
    root.querySelector<HTMLButtonElement>('[aria-label="Close session"]')?.click();
    expect(stopped).toHaveBeenCalledTimes(1);
    expect(toggled).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('keeps split actions in the floating group and returns focus after Escape', () => {
    const fixture = mount();
    fixture.componentRef.setInput('floating', true);
    fixture.componentRef.setInput('splitDisplayed', true);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    document.body.appendChild(root);
    expect(root.querySelector('[data-stop]')).toBeNull();
    const trigger = root.querySelector<HTMLButtonElement>('[data-header-menu]')!;
    trigger.click();
    fixture.detectChanges();
    expect(root.querySelectorAll('[role="menuitem"]')).toHaveLength(3);
    // The menu sizes to its labels instead of the narrow floating group, so none wraps.
    const menu = root.querySelector<HTMLElement>('[role="menu"]')!;
    for (const cls of ['w-max', 'min-w-36', 'whitespace-nowrap']) {
      expect(menu.classList).toContain(cls);
    }
    root.querySelectorAll('[role="menuitem"]').forEach((item) => {
      expect(item.classList).toContain('whitespace-nowrap');
    });
    const swapped = jest.fn();
    fixture.componentInstance.swapPanesRequested.subscribe(swapped);
    root.querySelector<HTMLButtonElement>('[data-action="swap-panes"]')!.click();
    fixture.detectChanges();
    expect(swapped).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
    trigger.click();
    fixture.detectChanges();
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(root.querySelector('[role="menu"]')).toBeNull();
    root.remove();
  });

  it('preserves Hand off in the sidebar session menu', () => {
    const fixture = mount();
    fixture.componentInstance.menuOpen.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('ptah-send-to-messaging')).not.toBeNull();
  });

  it('repairs focus when Stop disappears', () => {
    const fixture = mount();
    const root: HTMLElement = fixture.nativeElement;
    document.body.appendChild(root);
    root.querySelector<HTMLButtonElement>('[data-stop]')!.focus();
    fixture.componentRef.setInput('running', false);
    fixture.detectChanges();
    expect(document.activeElement).toBe(root.querySelector('[data-compact]'));
    root.remove();
  });

  it('embedded in the title row, shows Hand off as an icon between the view toggle and Close, with no menu', () => {
    const fixture = mount();
    fixture.componentRef.setInput('embedded', true);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[data-header-menu]')).toBeNull();
    const group = root.querySelector<HTMLElement>('[role="group"]')!;
    const order = Array.from(group.children).map(
      (el) =>
        el.getAttribute('aria-label') ??
        `${el.tagName.toLowerCase()}:${el.getAttribute('data-trigger')}`,
    );
    expect(order).toEqual([
      'Stop session',
      'Switch to compact view',
      'ptah-send-to-messaging:icon',
      'Close session',
    ]);
    // With split actions the menu returns, but never carries a second Hand off.
    fixture.componentRef.setInput('splitDisplayed', true);
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('[data-header-menu]')!.click();
    fixture.detectChanges();
    const menu = root.querySelector<HTMLElement>('[role="menu"]')!;
    expect(menu.querySelector('ptah-send-to-messaging')).toBeNull();
    expect(root.querySelectorAll('ptah-send-to-messaging')).toHaveLength(1);
  });

  it('opens the rail menu as a fixed layer and closes it on an outside press', () => {
    const fixture = mount();
    fixture.componentRef.setInput('rail', true);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    document.body.appendChild(root);
    root.querySelector<HTMLButtonElement>('[data-header-menu]')!.click();
    fixture.detectChanges();
    const menu = root.querySelector<HTMLElement>('[role="menu"]')!;
    expect(menu.classList.contains('fixed')).toBe(true);
    expect(menu.classList.contains('absolute')).toBe(false);
    expect(menu.querySelector('ptah-send-to-messaging')).not.toBeNull();
    // A press inside the menu keeps it open; one outside closes it.
    menu.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(root.querySelector('[role="menu"]')).not.toBeNull();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(root.querySelector('[role="menu"]')).toBeNull();
    root.remove();
  });

  it('places the rail menu fully left of the rail edge, not just left of its trigger', () => {
    const fixture = mount();
    fixture.componentRef.setInput('rail', true);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const rail = document.createElement('div');
    rail.setAttribute('data-inspector-rail', '');
    rail.appendChild(root);
    document.body.appendChild(rail);
    const rect = (left: number) => ({ left }) as DOMRect;
    jest.spyOn(rail, 'getBoundingClientRect').mockReturnValue(rect(1496));
    const trigger = root.querySelector<HTMLButtonElement>('[data-header-menu]')!;
    jest.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(rect(1510));
    const floatingUI = fixture.debugElement.injector.get(FloatingUIService);
    const position = jest.spyOn(floatingUI, 'position').mockResolvedValue(undefined);
    trigger.click();
    fixture.detectChanges();
    TestBed.tick();
    // 14px trigger inset in the rail + 6px gap.
    expect(position).toHaveBeenCalledWith(trigger, expect.any(HTMLElement), {
      placement: 'left-start',
      offset: 20,
    });
    rail.remove();
  });
});
