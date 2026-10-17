/**
 * PreviousSessionsDialogService (TASK_2026_679, Batch 4 Task 4.2).
 *
 * Covers open/close state, focus return to the opener after the close
 * renders (R2: once the shell row is no longer `inert`), the first visible
 * Previous sessions trigger when the opener is gone, and `restoreFocus:false`.
 */
import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  inject,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PreviousSessionsDialogService } from './previous-sessions-dialog.service';

/** The shell's shape: the row behind the modal is `inert` while it is open. */
@Component({
  selector: 'ptah-dialog-host',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div id="shellRow" [attr.inert]="dialog.isOpen() ? '' : null">
      <button id="opener" type="button" data-previous-sessions-trigger>
        Previous sessions
      </button>
    </div>
  `,
})
class DialogHostComponent {
  readonly dialog = inject(PreviousSessionsDialogService);
}

function button(id: string, trigger = false): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.id = id;
  if (trigger) element.setAttribute('data-previous-sessions-trigger', '');
  document.body.appendChild(element);
  return element;
}

describe('PreviousSessionsDialogService', () => {
  let service: PreviousSessionsDialogService;
  let appRef: ApplicationRef;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PreviousSessionsDialogService);
    appRef = TestBed.inject(ApplicationRef);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    document.body.innerHTML = '';
  });

  function render(): void {
    appRef.tick();
  }

  describe('open and close', () => {
    it('toggles isOpen', () => {
      expect(service.isOpen()).toBe(false);
      service.open();
      expect(service.isOpen()).toBe(true);
      service.close();
      expect(service.isOpen()).toBe(false);
    });

    it('keeps the first opener when open() is called while open', () => {
      const first = button('first');
      const second = button('second');
      first.focus();
      service.open();
      second.focus();

      service.open();
      expect(service.isOpen()).toBe(true);
      service.close();
      render();

      expect(document.activeElement).toBe(first);
    });

    it('does nothing when close() is called while closed', () => {
      const opener = button('opener');
      const elsewhere = button('elsewhere');
      opener.focus();
      service.open();
      service.close();
      render();
      elsewhere.focus();

      service.close();
      render();

      expect(service.isOpen()).toBe(false);
      expect(document.activeElement).toBe(elsewhere);
    });
  });

  describe('focus restore (R2)', () => {
    it('focuses the opener only after the close renders and the shell row is no longer inert', () => {
      const fixture = TestBed.createComponent(DialogHostComponent);
      appRef.attachView(fixture.componentRef.hostView);
      render();
      const host: HTMLElement = fixture.nativeElement;
      document.body.appendChild(host);
      const shellRow = host.querySelector('#shellRow') as HTMLElement;
      const opener = host.querySelector('#opener') as HTMLButtonElement;
      opener.focus();

      service.open();
      render();
      expect(shellRow.hasAttribute('inert')).toBe(true);
      const modalControl = button('modal-close');
      modalControl.focus();

      service.close();
      expect(document.activeElement).toBe(modalControl);
      expect(shellRow.hasAttribute('inert')).toBe(true);

      render();
      expect(shellRow.hasAttribute('inert')).toBe(false);
      expect(document.activeElement).toBe(opener);

      appRef.detachView(fixture.componentRef.hostView);
      fixture.destroy();
    });

    it('runs the restore once', () => {
      const opener = button('opener');
      opener.focus();
      service.open();
      service.close();
      render();
      expect(document.activeElement).toBe(opener);

      const elsewhere = button('elsewhere');
      elsewhere.focus();
      render();

      expect(document.activeElement).toBe(elsewhere);
    });

    it('does not pull focus out of a modal reopened before the close rendered', () => {
      const opener = button('opener');
      opener.focus();
      service.open();
      service.close();
      const modalControl = button('modal-search');

      service.open();
      modalControl.focus();
      render();

      expect(service.isOpen()).toBe(true);
      expect(document.activeElement).toBe(modalControl);
    });
  });

  describe('opener gone', () => {
    it('focuses the first visible trigger when the opener was removed', () => {
      const opener = button('opener', true);
      const hidden = button('hidden-trigger', true);
      hidden.style.display = 'none';
      const inertWrap = document.createElement('div');
      inertWrap.setAttribute('inert', '');
      const inertTrigger = document.createElement('button');
      inertTrigger.setAttribute('data-previous-sessions-trigger', '');
      inertWrap.appendChild(inertTrigger);
      document.body.appendChild(inertWrap);
      const visible = button('visible-trigger', true);
      button('later-trigger', true);
      opener.focus();
      service.open();

      opener.remove();
      service.close();
      render();

      expect(document.activeElement).toBe(visible);
    });

    it('falls back to a trigger when the opener is still inside an inert subtree', () => {
      const wrap = document.createElement('div');
      document.body.appendChild(wrap);
      const opener = document.createElement('button');
      wrap.appendChild(opener);
      const trigger = button('trigger', true);
      opener.focus();
      service.open();

      wrap.setAttribute('inert', '');
      service.close();
      render();

      expect(document.activeElement).toBe(trigger);
    });

    it('falls back to a trigger when the opener is hidden', () => {
      const opener = button('opener');
      const trigger = button('trigger', true);
      opener.focus();
      service.open();

      opener.style.visibility = 'hidden';
      service.close();
      render();

      expect(document.activeElement).toBe(trigger);
    });

    it('does not move focus when there is no opener and no visible trigger', () => {
      const elsewhere = button('elsewhere');
      service.open();
      elsewhere.focus();

      service.close();
      render();

      expect(document.activeElement).toBe(elsewhere);
    });
  });

  describe('restoreFocus: false', () => {
    it('closes without moving focus and forgets the opener', () => {
      const opener = button('opener');
      const trigger = button('trigger', true);
      opener.focus();
      service.open();
      const elsewhere = button('elsewhere');
      elsewhere.focus();

      service.close({ restoreFocus: false });
      render();

      expect(service.isOpen()).toBe(false);
      expect(document.activeElement).toBe(elsewhere);

      // A later open with nothing focused does not reuse the forgotten opener.
      elsewhere.blur();
      service.open();
      service.close();
      render();
      expect(document.activeElement).toBe(trigger);
    });
  });
});
