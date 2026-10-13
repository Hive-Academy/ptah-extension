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
  it('hides button words and model in a narrow band while preserving labels', () => {
    const fixture = mount(); fixture.componentRef.setInput('band', 'sm'); fixture.componentRef.setInput('model', 'Opus'); fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).not.toContain('Opus');
    expect(host.querySelector('[data-compact]')?.textContent).not.toContain('Compact');
    expect(host.querySelector('[data-compact]')?.getAttribute('aria-label')).toBe('Switch to compact view');
  });
});
