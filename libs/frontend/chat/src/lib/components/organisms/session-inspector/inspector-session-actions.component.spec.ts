import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import type { TabState } from '@ptah-extension/chat-types';
import { LoggingService } from '@ptah-extension/core';
import { ChatStore } from '../../../services/chat.store';
import { SessionOrganizerService } from '../../../services/session-list/session-organizer.service';
import { SessionRowActionsService } from '../../../services/session-list/session-row-actions.service';
import { InspectorSessionActionsComponent } from './inspector-session-actions.component';

@Component({
  standalone: true,
  imports: [InspectorSessionActionsComponent],
  template: `<header (keydown.escape)="escapes.update(count => count + 1)"><span>Session title</span><ptah-inspector-session-actions tabId="inspector-tab" [running]="running()" /><button data-panel-toggle>Panel</button></header>`,
})
class HostComponent { readonly running = signal(false); readonly escapes = signal(0); }

describe('InspectorSessionActionsComponent', () => {
  const tab = signal<TabState | null>(null);
  const available = signal(true);
  const rename = jest.fn();
  const openForSession = jest.fn();
  const abortWithConfirmationFor = jest.fn();
  let width = 320;
  let resize: ResizeObserverCallback | null = null;
  const originalObserver = globalThis.ResizeObserver;

  class HeaderObserver implements ResizeObserver {
    constructor(callback: ResizeObserverCallback) { resize = callback; }
    observe(): void { /* test drives resize explicitly */ }
    unobserve(): void { /* no-op */ }
    disconnect(): void { resize = null; }
  }

  beforeEach(() => {
    tab.set(null);
    available.set(true);
    rename.mockReset();
    openForSession.mockReset();
    abortWithConfirmationFor.mockReset();
    width = 320;
    globalThis.ResizeObserver = HeaderObserver;
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width }) as DOMRect);
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        { provide: TabManagerService, useValue: {
          tabs: tab,
          findTabByIdAcrossWorkspaces: (id: string) => id === 'inspector-tab' && tab() ? { tab: tab() } : null,
        } },
        { provide: SessionRowActionsService, useValue: { rename } },
        { provide: SessionOrganizerService, useValue: { available, openForSession } },
        { provide: ChatStore, useValue: { abortWithConfirmationFor } },
        { provide: LoggingService, useValue: { error: jest.fn() } },
      ],
    });
  });
  afterEach(() => {
    globalThis.ResizeObserver = originalObserver;
    jest.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  function persisted(): void {
    tab.set({ id: 'inspector-tab', title: 'Inspector', claudeSessionId: 'session-inspector' } as TabState);
  }
  async function create() {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    return { fixture, root, button: (action: string) => root.querySelector<HTMLButtonElement>(`[data-inspector-action="${action}"]`) };
  }
  async function setWidth(fixture: ReturnType<typeof TestBed.createComponent<HostComponent>>, next: number) {
    width = next;
    resize?.([], {} as ResizeObserver);
    fixture.detectChanges();
  }

  it('shows only persisted Rename/Organize and only running Stop for this inspector', async () => {
    const { fixture, button } = await create();
    expect(button('rename')).toBeNull();
    expect(button('organize')).toBeNull();
    fixture.componentInstance.running.set(true);
    fixture.detectChanges();
    expect(button('stop')?.disabled).toBe(true);
    persisted();
    fixture.detectChanges();
    expect(button('rename')).not.toBeNull();
    expect(button('organize')).not.toBeNull();
    button('stop')?.click();
    expect(abortWithConfirmationFor).toHaveBeenCalledWith('inspector-tab', 'session-inspector');
    available.set(false);
    fixture.detectChanges();
    expect(button('organize')).toBeNull();
    fixture.componentInstance.running.set(false);
    fixture.detectChanges();
    expect(button('stop')).toBeNull();
  });

  it('uses one More menu below 320px, restores focus on Escape and selection, and keeps the panel toggle', async () => {
    persisted();
    const { fixture, root, button } = await create();
    document.body.appendChild(root);
    await setWidth(fixture, 280);
    expect(button('rename')).toBeNull();
    expect(root.querySelector('[data-panel-toggle]')).not.toBeNull();
    button('more')?.click();
    fixture.detectChanges();
    expect(button('more')?.getAttribute('aria-expanded')).toBe('true');
    root.querySelector<HTMLElement>('[role="menu"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    await Promise.resolve();
    expect(button('more')?.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button('more'));
    button('more')?.click();
    fixture.detectChanges();
    openForSession.mockResolvedValue('opened');
    root.querySelector<HTMLButtonElement>('[data-inspector-menu-action="organize"]')?.click();
    fixture.detectChanges();
    await Promise.resolve();
    expect(openForSession).toHaveBeenCalledWith('session-inspector', 'Inspector', expect.any(Function));
    expect(button('more')?.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button('more'));
    await setWidth(fixture, 320);
    expect(button('rename')).not.toBeNull();
    root.remove();
  });

  it('guards repeat Rename submits and preserves the draft after a failed save', async () => {
    persisted();
    const { fixture, root, button } = await create();
    document.body.appendChild(root);
    button('rename')?.click();
    fixture.detectChanges();
    let resolveRename: ((value: 'failed') => void) | undefined;
    rename.mockImplementation(() => new Promise((resolve) => { resolveRename = resolve; }));
    const input = root.querySelector<HTMLInputElement>('#inspector-session-name');
    if (!input) throw new Error('Rename input missing');
    input.value = 'Updated';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    const form = root.querySelector<HTMLFormElement>('form[role="dialog"]');
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(rename).toHaveBeenCalledTimes(1);
    expect(rename).toHaveBeenCalledWith('session-inspector', 'Inspector', 'Updated');
    resolveRename?.('failed');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.textContent).toContain("Couldn't rename. Try again.");
    expect(input.value).toBe('Updated');
    root.querySelector<HTMLButtonElement>('form button[type="button"]')?.click();
    fixture.detectChanges();
    await Promise.resolve();
    expect(document.activeElement).toBe(button('rename'));
    root.remove();
  });

  it('navigates the More menu with arrow keys and dismisses it on focus loss and outside pointer', async () => {
    persisted();
    const { fixture, root, button } = await create();
    document.body.appendChild(root);
    await setWidth(fixture, 280);
    button('more')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    const items = [...root.querySelectorAll<HTMLButtonElement>('[data-inspector-menu-action]')];
    expect(document.activeElement).toBe(items[0]);
    items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(items[items.length - 1]);
    items[items.length - 1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(items[0]);
    items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(items[1]);
    root.querySelector<HTMLButtonElement>('[data-panel-toggle]')?.focus();
    fixture.detectChanges();
    expect(button('more')?.getAttribute('aria-expanded')).toBe('false');
    button('more')?.click();
    fixture.detectChanges();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(button('more')?.getAttribute('aria-expanded')).toBe('false');
    root.remove();
  });

  it('contains rename focus and Escape, then restores focus after close', async () => {
    persisted();
    const { fixture, root, button } = await create();
    document.body.appendChild(root);
    button('rename')?.focus();
    button('rename')?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const input = root.querySelector<HTMLInputElement>('#inspector-session-name')!;
    const cancel = root.querySelector<HTMLButtonElement>('form button[type="button"]')!;
    const save = root.querySelector<HTMLButtonElement>('form button[type="submit"]')!;
    expect(document.activeElement).toBe(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(save);
    save.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(input);
    cancel.focus();
    cancel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    await Promise.resolve();
    expect(root.querySelector('form[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(button('rename'));
    expect(fixture.componentInstance.escapes()).toBe(0);
    root.remove();
  });

  it('consumes Escape only while the More menu is open', async () => {
    persisted();
    const { fixture, root, button } = await create();
    await setWidth(fixture, 280);
    button('more')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(fixture.componentInstance.escapes()).toBe(1);
    button('more')?.click();
    fixture.detectChanges();
    root.querySelector<HTMLElement>('[role="menu"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.escapes()).toBe(1);
    expect(button('more')?.getAttribute('aria-expanded')).toBe('false');
  });
});
