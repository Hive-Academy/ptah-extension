import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

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
      <h3 modal-header>Header</h3>
      <p id="modal-body">Body</p>
      <div modal-footer><span id="modal-footer">Footer</span></div>
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
});