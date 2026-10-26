/**
 * ConfirmationDialogComponent specs (TASK_2026_679, plan component 6a).
 *
 * Coverage: dialog role, name and description; initial focus on Cancel;
 * Escape cancels without reaching document listeners (R4); Tab wraps inside
 * the panel; focus returns to the opener after the close has rendered and the
 * page behind is no longer inert (R2); text and button order unchanged.
 */
import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  inject,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConfirmationDialogService } from '@ptah-extension/chat-state';
import { ConfirmationDialogComponent } from './confirmation-dialog.component';

/** The page behind the dialog is inert while it is open, as the modal shell does. */
@Component({
  selector: 'ptah-confirmation-dialog-test-host',
  standalone: true,
  imports: [ConfirmationDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div data-testid="page" [attr.inert]="dialogService.isOpen() ? '' : null">
      <button type="button" data-testid="opener">Delete session</button>
    </div>
    <ptah-confirmation-dialog />
  `,
})
class ConfirmationDialogTestHostComponent {
  protected readonly dialogService = inject(ConfirmationDialogService);
}

function keydown(key: string, options: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
}

describe('ConfirmationDialogComponent', () => {
  let fixture: ComponentFixture<ConfirmationDialogTestHostComponent>;
  let host: HTMLElement;
  let service: ConfirmationDialogService;

  const el = <T extends HTMLElement>(selector: string): T => {
    const found = host.querySelector<T>(selector);
    if (!found) throw new Error(`Missing ${selector}`);
    return found;
  };
  const dialog = (): HTMLElement => el('dialog');
  const buttons = (): HTMLButtonElement[] =>
    Array.from(
      host.querySelectorAll<HTMLButtonElement>('.modal-action button'),
    );
  const opener = (): HTMLButtonElement =>
    el<HTMLButtonElement>('[data-testid="opener"]');

  const render = (): void => {
    fixture.detectChanges();
    TestBed.inject(ApplicationRef).tick();
  };

  const openFromOpener = (): Promise<boolean> => {
    opener().focus();
    const answer = service.confirm({
      title: 'Delete session?',
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      confirmStyle: 'error',
    });
    render();
    return answer;
  };

  // jsdom hides `dialog:not([open])`; DaisyUI's `.modal { display: grid }`
  // overrides that in the app, so the specs load the same rule.
  let daisyModal: HTMLStyleElement;
  beforeAll(() => {
    daisyModal = document.createElement('style');
    daisyModal.textContent = '.modal { display: grid; }';
    document.head.appendChild(daisyModal);
  });
  afterAll(() => daisyModal.remove());

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ConfirmationDialogTestHostComponent],
    });
    service = TestBed.inject(ConfirmationDialogService);
    fixture = TestBed.createComponent(ConfirmationDialogTestHostComponent);
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    render();
  });

  afterEach(() => {
    host.remove();
  });

  it('is a modal dialog named by its title and described by its message', async () => {
    const answer = openFromOpener();

    const panel = dialog();
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    const titleId = panel.getAttribute('aria-labelledby');
    const messageId = panel.getAttribute('aria-describedby');
    expect(titleId).toBeTruthy();
    expect(messageId).toBeTruthy();
    expect(titleId).not.toBe(messageId);
    expect(host.querySelector(`#${titleId}`)?.textContent?.trim()).toBe(
      'Delete session?',
    );
    expect(host.querySelector(`#${messageId}`)?.textContent?.trim()).toBe(
      'This cannot be undone.',
    );

    // Text and button order are unchanged: Cancel first, then the verb.
    expect(buttons().map((button) => button.textContent?.trim())).toEqual([
      'Cancel',
      'Delete',
    ]);
    expect(buttons()[1].classList.contains('btn-error')).toBe(true);

    service.handleCancel();
    await expect(answer).resolves.toBe(false);
  });

  it('gives each instance its own title and message ids', () => {
    const other = TestBed.createComponent(ConfirmationDialogComponent);
    other.detectChanges();
    const otherDialog = (other.nativeElement as HTMLElement).querySelector(
      'dialog',
    );
    expect(otherDialog?.getAttribute('aria-labelledby')).not.toBe(
      dialog().getAttribute('aria-labelledby'),
    );
    expect(otherDialog?.getAttribute('aria-describedby')).not.toBe(
      dialog().getAttribute('aria-describedby'),
    );
  });

  it('moves focus to Cancel after the open renders', () => {
    void openFromOpener();
    expect(document.activeElement).toBe(buttons()[0]);
  });

  it('cancels on Escape and stops it reaching document listeners', async () => {
    const documentEscape = jest.fn();
    document.addEventListener('keydown', documentEscape);
    const cancel = jest.spyOn(service, 'handleCancel');
    try {
      const answer = openFromOpener();
      const event = keydown('Escape');
      buttons()[0].dispatchEvent(event);

      expect(cancel).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
      expect(documentEscape).not.toHaveBeenCalled();
      await expect(answer).resolves.toBe(false);
    } finally {
      document.removeEventListener('keydown', documentEscape);
    }
  });

  it('ignores Escape while an IME composition is active', () => {
    const cancel = jest.spyOn(service, 'handleCancel');
    void openFromOpener();
    buttons()[0].dispatchEvent(keydown('Escape', { isComposing: true }));
    expect(cancel).not.toHaveBeenCalled();
    expect(service.isOpen()).toBe(true);
    service.handleCancel();
  });

  it('wraps Tab and Shift+Tab inside the panel', () => {
    void openFromOpener();
    const [cancelButton, confirmButton] = buttons();

    confirmButton.focus();
    const forward = keydown('Tab');
    confirmButton.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cancelButton);

    const backward = keydown('Tab', { shiftKey: true });
    cancelButton.dispatchEvent(backward);
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(confirmButton);

    service.handleCancel();
  });

  it('starts the Tab order on the first checkbox when the confirm has checkboxes', () => {
    opener().focus();
    void service.confirmWithCheckboxes({
      title: 'Delete session?',
      message: 'This cannot be undone.',
      checkboxes: [{ id: 'files', label: 'Also delete files' }],
    });
    render();
    const checkbox = el<HTMLInputElement>('input[type="checkbox"]');
    const [cancelButton, confirmButton] = buttons();
    expect(document.activeElement).toBe(cancelButton);

    confirmButton.focus();
    confirmButton.dispatchEvent(keydown('Tab'));
    expect(document.activeElement).toBe(checkbox);
    service.handleCancel();
  });

  it('returns focus to the opener after the close renders and the page is no longer inert', async () => {
    const answer = openFromOpener();
    expect(el('[data-testid="page"]').hasAttribute('inert')).toBe(true);

    buttons()[0].click();
    // Check before yielding: zoneless rendering may restore focus during the await.
    expect(document.activeElement).not.toBe(opener());
    await expect(answer).resolves.toBe(false);

    render();
    expect(el('[data-testid="page"]').hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(opener());
  });

  it('returns focus to the opener after Confirm too', async () => {
    const answer = openFromOpener();
    buttons()[1].click();
    await expect(answer).resolves.toBe(true);
    render();
    expect(document.activeElement).toBe(opener());
  });

  it('does not move focus when the opener is gone', () => {
    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    try {
      void openFromOpener();
      opener().remove();
      service.handleCancel();
      elsewhere.focus();
      render();
      expect(document.activeElement).toBe(elsewhere);
    } finally {
      elsewhere.remove();
    }
  });
});
