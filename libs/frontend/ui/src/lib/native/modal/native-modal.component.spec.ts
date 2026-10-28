import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NativeDrawerComponent } from '../drawer/native-drawer.component';
import {
  NativeModalComponent,
  NativeModalSize,
} from './native-modal.component';

/**
 * jsdom implements no HTMLDialogElement methods, so the modal's
 * showModal()/close() would throw the moment it opens. The stub reflects the
 * `open` attribute, which is all these specs observe (same approach as
 * `diff-view.component.spec.ts:55-69`).
 */
beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(
      this: HTMLDialogElement,
    ) {
      this.setAttribute('open', '');
    } as HTMLDialogElement['showModal'];
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(
      this: HTMLDialogElement,
    ) {
      this.removeAttribute('open');
    } as HTMLDialogElement['close'];
  }
});

@Component({
  standalone: true,
  imports: [NativeModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-native-modal
      [isOpen]="isOpen()"
      [ariaLabel]="ariaLabel()"
      [ariaLabelledby]="ariaLabelledby()"
      [size]="size()"
      (closed)="onClosed()"
    >
      <h3 modal-header>Header <button id="modal-first" type="button">✕</button></h3>
      <p id="modal-body">Body <button id="modal-disabled" type="button" disabled>Off</button></p>
      <div modal-footer><span id="modal-footer">Footer</span> <button id="modal-last" type="button">Done</button></div>
    </ptah-native-modal>
  `,
})
class HostComponent {
  readonly isOpen = signal(false);
  readonly ariaLabel = signal<string | undefined>('Connect a provider');
  readonly ariaLabelledby = signal<string | undefined>(undefined);
  readonly size = signal<NativeModalSize>('md');
  closedCount = 0;

  onClosed(): void {
    this.closedCount++;
  }
}

describe('NativeModalComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const dialogEl = (): HTMLDialogElement =>
    root().querySelector(
      '[data-testid="native-modal-dialog"]',
    ) as HTMLDialogElement;

  const modalBox = (): HTMLElement =>
    root().querySelector('.modal-box') as HTMLElement;

  const backdropButton = (): HTMLButtonElement =>
    root().querySelector('.modal-backdrop button') as HTMLButtonElement;

  const open = (): void => {
    host.isOpen.set(true);
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

  it('calls showModal when opened and close when closed', () => {
    const dialog = dialogEl();
    const show = jest.spyOn(dialog, 'showModal');
    const close = jest.spyOn(dialog, 'close');

    host.isOpen.set(true);
    fixture.detectChanges();
    expect(show).toHaveBeenCalledTimes(1);

    host.isOpen.set(false);
    fixture.detectChanges();
    expect(close).toHaveBeenCalledTimes(1);
  });

  // Gate V 36 V36-1: daisyUI .modal is display:grid + opacity:0, so a closed dialog's controls were Tab stops.
  it('keeps a closed dialog inert, and an open one interactive', () => {
    const dialog = dialogEl();
    expect(dialog.inert).toBe(true);

    open();
    expect(dialog.inert).toBe(false);

    host.isOpen.set(false);
    fixture.detectChanges();
    expect(dialog.inert).toBe(true);
  });

  it('lifts inert before showModal, so the opened dialog can take focus', () => {
    const dialog = dialogEl();
    let inertAtShow: boolean | undefined;
    jest.spyOn(dialog, 'showModal').mockImplementation(function (this: HTMLDialogElement) {
      inertAtShow = this.inert;
      this.setAttribute('open', '');
    });
    open();
    expect(inertAtShow).toBe(false);
  });

  it('emits closed on cancel without closing the dialog itself', () => {
    open();
    const dialog = dialogEl();
    const close = jest.spyOn(dialog, 'close');

    dialog.dispatchEvent(new Event('cancel'));

    expect(host.closedCount).toBe(1);
    expect(close).not.toHaveBeenCalled();
    expect(dialog.hasAttribute('open')).toBe(true);
  });

  it('emits closed when the backdrop button is clicked', () => {
    open();
    // The bubbling click still runs jsdom's button activation behaviour
    // after the handler, which logs a requestSubmit "Not implemented"
    // console error. The test stays green: Jest does not fail on
    // console.error, and in a real browser `method="dialog"` closes the
    // dialog without any submission.
    backdropButton().dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    expect(host.closedCount).toBe(1);
  });

  it('exposes the aria label on the dialog and omits it when unset', () => {
    open();
    expect(dialogEl().getAttribute('aria-label')).toBe('Connect a provider');

    host.ariaLabel.set(undefined);
    host.ariaLabelledby.set('modal-title');
    fixture.detectChanges();
    expect(dialogEl().hasAttribute('aria-label')).toBe(false);
  });

  it('names the dialog through aria-labelledby when given', () => {
    host.ariaLabel.set(undefined);
    host.ariaLabelledby.set('modal-title');
    fixture.detectChanges();
    expect(dialogEl().getAttribute('aria-labelledby')).toBe('modal-title');
  });

  it('reports a missing accessible name in dev mode until one is provided', () => {
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    host.ariaLabel.set(undefined);
    host.ariaLabelledby.set(undefined);
    fixture.detectChanges();
    expect(errorSpy).toHaveBeenCalledWith(
      'ptah-native-modal requires an accessible name: pass ariaLabel or ariaLabelledby.',
    );

    errorSpy.mockClear();
    host.ariaLabelledby.set('modal-title');
    fixture.detectChanges();
    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it('maps each size preset to a modal-box width class', () => {
    open();
    expect(modalBox().className).toContain('max-w-lg');

    host.size.set('sm');
    fixture.detectChanges();
    expect(modalBox().className).toContain('max-w-sm');

    host.size.set('lg');
    fixture.detectChanges();
    expect(modalBox().className).toContain('max-w-2xl');
  });

  it('projects the header, body and footer slots', () => {
    open();
    const dialog = dialogEl();
    expect(dialog.textContent).toContain('Header');
    expect(dialog.textContent).toContain('Body');
    expect(root().querySelector('#modal-footer')).toBeTruthy();
  });

  it('emits closed and closes the dialog when destroyed while open', () => {
    open();
    const dialog = dialogEl();
    expect(dialog.hasAttribute('open')).toBe(true);

    fixture.destroy();
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(host.closedCount).toBe(1);
  });

  it('does not emit closed when destroyed while already closed', () => {
    fixture.destroy();
    expect(host.closedCount).toBe(0);
  });

  // TASK_2026_555 Batch 32: Chromium lets Tab leave a showModal() dialog for the browser UI at its last control.
  describe('Tab wrap', () => {
    const button = (id: string) => root().querySelector(`#${id}`) as HTMLButtonElement;
    const tab = (shiftKey = false): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
      (root().ownerDocument.activeElement ?? dialogEl()).dispatchEvent(event);
      return event;
    };

    beforeEach(() => {
      // jsdom has no layout: every control counts as rendered.
      jest.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
      open();
    });
    afterEach(() => jest.restoreAllMocks());

    it('moves Tab from the last control to the first', () => {
      button('modal-last').focus();
      const event = tab();
      expect(event.defaultPrevented).toBe(true);
      expect(root().ownerDocument.activeElement).toBe(button('modal-first'));
    });

    it('moves Shift+Tab from the first control to the last, skipping disabled ones', () => {
      button('modal-first').focus();
      const event = tab(true);
      expect(event.defaultPrevented).toBe(true);
      expect(root().ownerDocument.activeElement).toBe(button('modal-last'));
    });

    it('leaves Tab between inner controls to the browser', () => {
      button('modal-first').focus();
      expect(tab().defaultPrevented).toBe(false);
      expect(root().ownerDocument.activeElement).toBe(button('modal-first'));
    });

    it('does nothing while the dialog is closed', () => {
      host.isOpen.set(false);
      fixture.detectChanges();
      button('modal-last').focus();
      expect(tab().defaultPrevented).toBe(false);
    });
  });
});

@Component({
  standalone: true,
  imports: [NativeDrawerComponent, NativeModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-native-drawer [isOpen]="drawerOpen()" ariaLabel="Accounts" (closed)="onDrawerClosed()">
      <button type="button" id="drawer-control">Remove account</button>
      <ptah-native-modal [isOpen]="modalOpen()" ariaLabel="Remove account?" (closed)="onModalClosed()">
        <div modal-footer><button id="modal-cancel" type="button">Cancel</button></div>
      </ptah-native-modal>
    </ptah-native-drawer>
  `,
})
class DrawerHostComponent {
  readonly drawerOpen = signal(true);
  readonly modalOpen = signal(false);
  drawerClosedCount = 0;
  modalClosedCount = 0;

  onDrawerClosed(): void {
    this.drawerClosedCount++;
    this.drawerOpen.set(false);
  }

  onModalClosed(): void {
    this.modalClosedCount++;
    this.modalOpen.set(false);
  }
}

// TASK_2026_719 P5 review F2: Escape inside a modal nested in a drawer bubbled to the drawer panel and closed the drawer.
describe('NativeModalComponent inside a NativeDrawerComponent', () => {
  let fixture: ComponentFixture<DrawerHostComponent>;
  let host: DrawerHostComponent;

  const q = <T extends HTMLElement>(selector: string): T =>
    (fixture.nativeElement as HTMLElement).querySelector<T>(selector) as T;
  const escape = (target: HTMLElement): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [DrawerHostComponent] }).compileComponents();
    fixture = TestBed.createComponent(DrawerHostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
  });

  it('keeps the drawer open when Escape is pressed inside the open modal', () => {
    host.modalOpen.set(true);
    fixture.detectChanges();

    const event = escape(q<HTMLButtonElement>('#modal-cancel'));

    expect(host.drawerClosedCount).toBe(0);
    expect(q('[data-testid="native-drawer-panel"]')).toBeTruthy();
    // The default action stays, so the browser still fires the dialog's native `cancel`.
    expect(event.defaultPrevented).toBe(false);
  });

  it('still closes the modal through its native cancel event', () => {
    host.modalOpen.set(true);
    fixture.detectChanges();
    const dialog = q<HTMLDialogElement>('[data-testid="native-modal-dialog"]');

    dialog.dispatchEvent(new Event('cancel'));
    fixture.detectChanges();

    expect(host.modalClosedCount).toBe(1);
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(host.drawerClosedCount).toBe(0);
  });

  it('lets Escape close the drawer while the modal is closed', () => {
    escape(q<HTMLButtonElement>('#drawer-control'));

    expect(host.drawerClosedCount).toBe(1);
    expect(host.modalClosedCount).toBe(0);
  });
});