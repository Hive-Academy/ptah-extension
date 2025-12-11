import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConfirmationModalComponent } from './confirmation-modal.component';

describe('ConfirmationModalComponent', () => {
  let component: ConfirmationModalComponent;
  let fixture: ComponentFixture<ConfirmationModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConfirmationModalComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ConfirmationModalComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('Input Properties', () => {
    it('should have required title input', () => {
      fixture.componentRef.setInput('title', 'Test Title');
      fixture.detectChanges();

      const heading = fixture.nativeElement.querySelector('h3');
      expect(heading.textContent).toContain('Test Title');
    });

    it('should have required message input', () => {
      fixture.componentRef.setInput('title', 'Test');
      fixture.componentRef.setInput('message', 'Test message content');
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Test message content');
    });

    it('should have default confirmText', () => {
      fixture.componentRef.setInput('title', 'Test');
      fixture.componentRef.setInput('message', 'Test message');
      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector('.btn:last-child');
      expect(button.textContent).toContain('Confirm');
    });

    it('should allow custom confirmText', () => {
      fixture.componentRef.setInput('title', 'Test');
      fixture.componentRef.setInput('message', 'Test message');
      fixture.componentRef.setInput('confirmText', 'Delete Now');
      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector('.btn:last-child');
      expect(button.textContent).toContain('Delete Now');
    });

    it('should have default cancelText', () => {
      fixture.componentRef.setInput('title', 'Test');
      fixture.componentRef.setInput('message', 'Test message');
      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector('.btn-ghost');
      expect(button.textContent).toContain('Cancel');
    });

    it('should allow custom cancelText', () => {
      fixture.componentRef.setInput('title', 'Test');
      fixture.componentRef.setInput('message', 'Test message');
      fixture.componentRef.setInput('cancelText', 'Go Back');
      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector('.btn-ghost');
      expect(button.textContent).toContain('Go Back');
    });

    it('should have default mode as confirm', () => {
      fixture.componentRef.setInput('title', 'Test');
      fixture.componentRef.setInput('message', 'Test message');
      fixture.detectChanges();

      const buttons = fixture.nativeElement.querySelectorAll('.btn');
      expect(buttons.length).toBe(2); // Both confirm and cancel
    });

    it('should have default confirmClass', () => {
      fixture.componentRef.setInput('title', 'Test');
      fixture.componentRef.setInput('message', 'Test message');
      fixture.detectChanges();

      const confirmButton =
        fixture.nativeElement.querySelector('.btn:last-child');
      expect(confirmButton.classList.contains('btn-primary')).toBe(true);
    });

    it('should allow custom confirmClass', () => {
      fixture.componentRef.setInput('title', 'Test');
      fixture.componentRef.setInput('message', 'Test message');
      fixture.componentRef.setInput('confirmClass', 'btn-error');
      fixture.detectChanges();

      const confirmButton =
        fixture.nativeElement.querySelector('.btn:last-child');
      expect(confirmButton.classList.contains('btn-error')).toBe(true);
    });
  });

  describe('Confirm Mode', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('title', 'Delete Item?');
      fixture.componentRef.setInput('message', 'This action cannot be undone.');
      fixture.componentRef.setInput('mode', 'confirm');
      fixture.detectChanges();
    });

    it('should display both buttons in confirm mode', () => {
      const buttons = fixture.nativeElement.querySelectorAll('.btn');
      expect(buttons.length).toBe(2);
    });

    it('should display cancel button', () => {
      const cancelButton = fixture.nativeElement.querySelector('.btn-ghost');
      expect(cancelButton).toBeTruthy();
    });

    it('should display confirm button', () => {
      const confirmButton =
        fixture.nativeElement.querySelector('.btn:last-child');
      expect(confirmButton).toBeTruthy();
    });

    it('should emit confirmed event on confirm click', (done) => {
      component.confirmed.subscribe(() => {
        expect(true).toBe(true);
        done();
      });

      const confirmButton =
        fixture.nativeElement.querySelector('.btn:last-child');
      confirmButton.click();
    });

    it('should emit cancelled event on cancel click', (done) => {
      component.cancelled.subscribe(() => {
        expect(true).toBe(true);
        done();
      });

      const cancelButton = fixture.nativeElement.querySelector('.btn-ghost');
      cancelButton.click();
    });

    it('should hide modal on confirm click', () => {
      jest.spyOn(component, 'hide');

      const confirmButton =
        fixture.nativeElement.querySelector('.btn:last-child');
      confirmButton.click();

      expect(component.hide).toHaveBeenCalled();
    });

    it('should hide modal on cancel click', () => {
      jest.spyOn(component, 'hide');

      const cancelButton = fixture.nativeElement.querySelector('.btn-ghost');
      cancelButton.click();

      expect(component.hide).toHaveBeenCalled();
    });

    it('should use custom confirmClass in confirm mode', () => {
      fixture.componentRef.setInput('confirmClass', 'btn-warning');
      fixture.detectChanges();

      const confirmButton =
        fixture.nativeElement.querySelector('.btn:last-child');
      expect(confirmButton.classList.contains('btn-warning')).toBe(true);
    });
  });

  describe('Alert Mode', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('title', 'Information');
      fixture.componentRef.setInput('message', 'Feature coming soon!');
      fixture.componentRef.setInput('mode', 'alert');
      fixture.detectChanges();
    });

    it('should display only one button in alert mode', () => {
      const buttons = fixture.nativeElement.querySelectorAll('.btn');
      expect(buttons.length).toBe(1);
    });

    it('should not display cancel button in alert mode', () => {
      const cancelButton = fixture.nativeElement.querySelector('.btn-ghost');
      expect(cancelButton).toBeFalsy();
    });

    it('should display confirm button as primary in alert mode', () => {
      const confirmButton = fixture.nativeElement.querySelector('.btn');
      expect(confirmButton.classList.contains('btn-primary')).toBe(true);
    });

    it('should emit confirmed event on button click', (done) => {
      component.confirmed.subscribe(() => {
        expect(true).toBe(true);
        done();
      });

      const button = fixture.nativeElement.querySelector('.btn');
      button.click();
    });

    it('should hide modal on button click', () => {
      jest.spyOn(component, 'hide');

      const button = fixture.nativeElement.querySelector('.btn');
      button.click();

      expect(component.hide).toHaveBeenCalled();
    });

    it('should ignore confirmClass in alert mode', () => {
      fixture.componentRef.setInput('confirmClass', 'btn-error');
      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector('.btn');
      expect(button.classList.contains('btn-primary')).toBe(true);
      expect(button.classList.contains('btn-error')).toBe(false);
    });
  });

  describe('Modal Visibility', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('title', 'Test');
      fixture.componentRef.setInput('message', 'Test message');
      fixture.detectChanges();
    });

    it('should show modal when show() is called', () => {
      jest.spyOn(component['modal'].nativeElement, 'showModal');

      component.show();

      expect(component['modal'].nativeElement.showModal).toHaveBeenCalled();
    });

    it('should hide modal when hide() is called', () => {
      jest.spyOn(component['modal'].nativeElement, 'close');

      component.hide();

      expect(component['modal'].nativeElement.close).toHaveBeenCalled();
    });

    it('should have static modal ViewChild', () => {
      expect(component['modal']).toBeTruthy();
      expect(component['modal'].nativeElement.tagName).toBe('DIALOG');
    });
  });

  describe('Backdrop Click', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('title', 'Test');
      fixture.componentRef.setInput('message', 'Test message');
      fixture.detectChanges();
    });

    it('should emit cancelled event on backdrop click', (done) => {
      component.cancelled.subscribe(() => {
        expect(true).toBe(true);
        done();
      });

      const backdropButton = fixture.nativeElement.querySelector(
        '.modal-backdrop button'
      );
      backdropButton.click();
    });

    it('should hide modal on backdrop click', () => {
      jest.spyOn(component, 'hide');

      const backdropButton = fixture.nativeElement.querySelector(
        '.modal-backdrop button'
      );
      backdropButton.click();

      expect(component.hide).toHaveBeenCalled();
    });
  });

  describe('Modal Structure', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('title', 'Test Title');
      fixture.componentRef.setInput('message', 'Test message');
      fixture.detectChanges();
    });

    it('should render dialog element', () => {
      const dialog = fixture.nativeElement.querySelector('dialog');
      expect(dialog).toBeTruthy();
      expect(dialog.classList.contains('modal')).toBe(true);
    });

    it('should render modal-box', () => {
      const modalBox = fixture.nativeElement.querySelector('.modal-box');
      expect(modalBox).toBeTruthy();
    });

    it('should render title as h3', () => {
      const title = fixture.nativeElement.querySelector('h3');
      expect(title).toBeTruthy();
      expect(title.classList.contains('font-bold')).toBe(true);
    });

    it('should render message in paragraph', () => {
      const message = fixture.nativeElement.querySelector('p.py-4');
      expect(message).toBeTruthy();
    });

    it('should render modal-action container', () => {
      const modalAction = fixture.nativeElement.querySelector('.modal-action');
      expect(modalAction).toBeTruthy();
    });

    it('should render modal-backdrop', () => {
      const backdrop = fixture.nativeElement.querySelector('.modal-backdrop');
      expect(backdrop).toBeTruthy();
    });
  });

  describe('Accessibility', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('title', 'Test Title');
      fixture.componentRef.setInput('message', 'Test message');
      fixture.detectChanges();
    });

    it('should use semantic dialog element', () => {
      const dialog = fixture.nativeElement.querySelector('dialog');
      expect(dialog).toBeTruthy();
    });

    it('should have proper heading level', () => {
      const h3 = fixture.nativeElement.querySelector('h3');
      expect(h3).toBeTruthy();
    });

    it('should have accessible button text', () => {
      const buttons = fixture.nativeElement.querySelectorAll('button');
      buttons.forEach((button: HTMLButtonElement) => {
        expect(button.textContent?.trim()).toBeTruthy();
      });
    });

    it('should use native modal dialog functionality', () => {
      const dialog = fixture.nativeElement.querySelector('dialog');
      expect(typeof dialog.showModal).toBe('function');
      expect(typeof dialog.close).toBe('function');
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long title', () => {
      const longTitle =
        'This is a very long title that might cause layout issues if not handled properly';
      fixture.componentRef.setInput('title', longTitle);
      fixture.componentRef.setInput('message', 'Test');
      fixture.detectChanges();

      const heading = fixture.nativeElement.querySelector('h3');
      expect(heading.textContent).toContain(longTitle);
    });

    it('should handle very long message', () => {
      const longMessage =
        'This is a very long message that spans multiple lines and contains a lot of text to test how the component handles overflow and wrapping of content in the modal dialog box.';
      fixture.componentRef.setInput('title', 'Test');
      fixture.componentRef.setInput('message', longMessage);
      fixture.detectChanges();

      const paragraph = fixture.nativeElement.querySelector('p');
      expect(paragraph.textContent).toContain(longMessage);
    });

    it('should handle empty confirmText', () => {
      fixture.componentRef.setInput('title', 'Test');
      fixture.componentRef.setInput('message', 'Test');
      fixture.componentRef.setInput('confirmText', '');
      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector('.btn:last-child');
      expect(button).toBeTruthy();
    });

    it('should handle empty cancelText', () => {
      fixture.componentRef.setInput('title', 'Test');
      fixture.componentRef.setInput('message', 'Test');
      fixture.componentRef.setInput('cancelText', '');
      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector('.btn-ghost');
      expect(button).toBeTruthy();
    });

    it('should handle multiline message', () => {
      const multilineMessage = 'Line 1\nLine 2\nLine 3';
      fixture.componentRef.setInput('title', 'Test');
      fixture.componentRef.setInput('message', multilineMessage);
      fixture.detectChanges();

      const paragraph = fixture.nativeElement.querySelector('p');
      expect(paragraph.textContent).toContain('Line 1');
      expect(paragraph.textContent).toContain('Line 3');
    });

    it('should handle special characters in title', () => {
      fixture.componentRef.setInput('title', 'Delete "Item"? <confirm>');
      fixture.componentRef.setInput('message', 'Test');
      fixture.detectChanges();

      const heading = fixture.nativeElement.querySelector('h3');
      expect(heading.textContent).toContain('Delete "Item"?');
    });

    it('should handle special characters in message', () => {
      fixture.componentRef.setInput('title', 'Test');
      fixture.componentRef.setInput('message', 'Are you sure? <yes/no>');
      fixture.detectChanges();

      const paragraph = fixture.nativeElement.querySelector('p');
      expect(paragraph.textContent).toContain('Are you sure?');
    });

    it('should handle multiple show/hide cycles', () => {
      fixture.componentRef.setInput('title', 'Test');
      fixture.componentRef.setInput('message', 'Test');
      fixture.detectChanges();

      jest.spyOn(component['modal'].nativeElement, 'showModal');
      jest.spyOn(component['modal'].nativeElement, 'close');

      component.show();
      component.hide();
      component.show();
      component.hide();

      expect(component['modal'].nativeElement.showModal).toHaveBeenCalledTimes(
        2
      );
      expect(component['modal'].nativeElement.close).toHaveBeenCalledTimes(2);
    });
  });

  describe('Output Events', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('title', 'Test');
      fixture.componentRef.setInput('message', 'Test');
      fixture.detectChanges();
    });

    it('should not emit events on initial render', (done) => {
      let confirmedEmitted = false;
      let cancelledEmitted = false;

      component.confirmed.subscribe(() => {
        confirmedEmitted = true;
      });
      component.cancelled.subscribe(() => {
        cancelledEmitted = true;
      });

      setTimeout(() => {
        expect(confirmedEmitted).toBe(false);
        expect(cancelledEmitted).toBe(false);
        done();
      }, 100);
    });

    it('should emit confirmed event only once per click', () => {
      let emitCount = 0;
      component.confirmed.subscribe(() => {
        emitCount++;
      });

      const confirmButton =
        fixture.nativeElement.querySelector('.btn:last-child');
      confirmButton.click();

      expect(emitCount).toBe(1);
    });

    it('should emit cancelled event only once per click', () => {
      let emitCount = 0;
      component.cancelled.subscribe(() => {
        emitCount++;
      });

      const cancelButton = fixture.nativeElement.querySelector('.btn-ghost');
      cancelButton.click();

      expect(emitCount).toBe(1);
    });

    it('should not emit cancelled in alert mode', (done) => {
      fixture.componentRef.setInput('mode', 'alert');
      fixture.detectChanges();

      let cancelledEmitted = false;
      component.cancelled.subscribe(() => {
        cancelledEmitted = true;
      });

      const button = fixture.nativeElement.querySelector('.btn');
      button.click();

      setTimeout(() => {
        expect(cancelledEmitted).toBe(false);
        done();
      }, 100);
    });
  });

  describe('Custom Styling', () => {
    it('should apply btn-error class', () => {
      fixture.componentRef.setInput('title', 'Delete');
      fixture.componentRef.setInput('message', 'Delete?');
      fixture.componentRef.setInput('confirmClass', 'btn-error');
      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector('.btn:last-child');
      expect(button.classList.contains('btn-error')).toBe(true);
    });

    it('should apply btn-success class', () => {
      fixture.componentRef.setInput('title', 'Confirm');
      fixture.componentRef.setInput('message', 'Proceed?');
      fixture.componentRef.setInput('confirmClass', 'btn-success');
      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector('.btn:last-child');
      expect(button.classList.contains('btn-success')).toBe(true);
    });

    it('should apply btn-warning class', () => {
      fixture.componentRef.setInput('title', 'Warning');
      fixture.componentRef.setInput('message', 'Continue?');
      fixture.componentRef.setInput('confirmClass', 'btn-warning');
      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector('.btn:last-child');
      expect(button.classList.contains('btn-warning')).toBe(true);
    });

    it('should apply multiple classes', () => {
      fixture.componentRef.setInput('title', 'Test');
      fixture.componentRef.setInput('message', 'Test');
      fixture.componentRef.setInput('confirmClass', 'btn-error btn-sm');
      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector('.btn:last-child');
      expect(button.classList.contains('btn-error')).toBe(true);
      expect(button.classList.contains('btn-sm')).toBe(true);
    });
  });
});
