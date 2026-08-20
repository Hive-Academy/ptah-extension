import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  NativeDrawerComponent,
  NativeDrawerSide,
} from './native-drawer.component';

@Component({
  standalone: true,
  imports: [NativeDrawerComponent],
  template: `
    <button type="button" id="opener" (click)="isOpen.set(true)">Open</button>
    <ptah-native-drawer
      [isOpen]="isOpen()"
      [side]="side()"
      [ariaLabel]="'Skill details'"
      [showCloseButton]="showCloseButton()"
      [closeOnEscape]="closeOnEscape()"
      [closeOnBackdrop]="closeOnBackdrop()"
      (opened)="openedCount = openedCount + 1"
      (closed)="onClosed()"
    >
      <h2 drawer-header>Header</h2>
      <button type="button" id="first">First</button>
      <button type="button" id="last">Last</button>
      <div drawer-footer><span id="footer-text">Footer</span></div>
    </ptah-native-drawer>
  `,
})
class HostComponent {
  isOpen = signal(false);
  side = signal<NativeDrawerSide>('right');
  showCloseButton = signal(true);
  closeOnEscape = signal(true);
  closeOnBackdrop = signal(true);
  openedCount = 0;
  closedCount = 0;

  onClosed(): void {
    this.closedCount++;
    this.isOpen.set(false);
  }
}

/** Lets the drawer's queueMicrotask-deferred focus move run. */
const flushMicrotasks = (): Promise<void> => Promise.resolve();

describe('NativeDrawerComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const q = <T extends HTMLElement>(selector: string): T | null =>
    (fixture.nativeElement as HTMLElement).querySelector<T>(selector);

  const panel = (): HTMLElement =>
    q<HTMLElement>('[data-testid="native-drawer-panel"]') as HTMLElement;

  const open = async (): Promise<void> => {
    host.isOpen.set(true);
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders nothing while closed', () => {
    expect(q('[data-testid="native-drawer-root"]')).toBeNull();
  });

  it('renders a modal dialog with an accessible name when open', async () => {
    await open();
    expect(panel().getAttribute('role')).toBe('dialog');
    expect(panel().getAttribute('aria-modal')).toBe('true');
    expect(panel().getAttribute('aria-label')).toBe('Skill details');
    expect(q('[data-testid="native-drawer-backdrop"]')).toBeTruthy();
  });

  it('projects header, body and footer slots', async () => {
    await open();
    const body = q('[data-testid="native-drawer-body"]') as HTMLElement;
    expect(body.textContent).toContain('First');
    expect(panel().textContent).toContain('Header');
    expect(q('#footer-text')).toBeTruthy();
  });

  it('slides in from the right by default and from the left when asked', async () => {
    await open();
    expect(panel().className).toContain('ml-auto');
    expect(panel().className).not.toContain('ptah-drawer-panel-left');

    host.isOpen.set(false);
    fixture.detectChanges();
    host.side.set('left');
    await open();
    expect(panel().className).toContain('ptah-drawer-panel-left');
    expect(panel().className).toContain('mr-auto');
  });

  it('moves focus to the first focusable element in the panel and emits opened', async () => {
    (q('#opener') as HTMLButtonElement).focus();
    await open();
    expect(document.activeElement).toBe(
      q('[data-testid="native-drawer-close"]'),
    );
    expect(panel().contains(document.activeElement)).toBe(true);
    expect(host.openedCount).toBe(1);
  });

  it('restores focus to the previously focused element on close', async () => {
    const opener = q<HTMLButtonElement>('#opener') as HTMLButtonElement;
    opener.focus();
    await open();
    expect(document.activeElement).not.toBe(opener);

    host.isOpen.set(false);
    fixture.detectChanges();
    expect(document.activeElement).toBe(opener);
  });

  it('requests closure on Escape', async () => {
    await open();
    panel().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(host.closedCount).toBe(1);
  });

  it('does not close on Escape when closeOnEscape is false', async () => {
    host.closeOnEscape.set(false);
    await open();
    panel().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(host.closedCount).toBe(0);
  });

  it('requests closure on backdrop click', async () => {
    await open();
    (q('[data-testid="native-drawer-backdrop"]') as HTMLElement).click();
    expect(host.closedCount).toBe(1);
  });

  it('does not close on backdrop click when closeOnBackdrop is false', async () => {
    host.closeOnBackdrop.set(false);
    await open();
    (q('[data-testid="native-drawer-backdrop"]') as HTMLElement).click();
    expect(host.closedCount).toBe(0);
  });

  it('requests closure from the built-in close button, which can be hidden', async () => {
    await open();
    (q('[data-testid="native-drawer-close"]') as HTMLButtonElement).click();
    expect(host.closedCount).toBe(1);

    host.showCloseButton.set(false);
    await open();
    expect(q('[data-testid="native-drawer-close"]')).toBeNull();
  });

  it('traps Tab at the end of the panel and Shift+Tab at the start', async () => {
    await open();
    const focusables = Array.from(
      panel().querySelectorAll<HTMLElement>('button'),
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    last.focus();
    panel().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
    );
    expect(document.activeElement).toBe(first);

    first.focus();
    panel().dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
      }),
    );
    expect(document.activeElement).toBe(last);
  });

  it('leaves interior Tab presses alone', async () => {
    await open();
    const first = q<HTMLButtonElement>(
      '[data-testid="native-drawer-close"]',
    ) as HTMLButtonElement;
    first.focus();
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    panel().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
