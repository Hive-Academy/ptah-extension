import { TestBed } from '@angular/core/testing';
import { ReviewConfirmDialogComponent } from './review-confirm-dialog.component';

describe('ReviewConfirmDialogComponent', () => {
  it('traps Tab, closes on Escape, and restores the trigger focus', () => {
    TestBed.configureTestingModule({ imports: [ReviewConfirmDialogComponent] });
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const fixture = TestBed.createComponent(ReviewConfirmDialogComponent);
    fixture.componentRef.setInput('dialogId', 'test-confirm');
    fixture.componentRef.setInput('title', 'Confirm action');
    fixture.componentRef.setInput('description', 'This action has effects.');
    const cancelled = jest.fn();
    fixture.componentInstance.cancelled.subscribe(cancelled);
    fixture.detectChanges();
    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    const heading = dialog.querySelector('h2') as HTMLElement;
    const buttons = dialog.querySelectorAll('button');
    expect(document.activeElement).toBe(heading);
    buttons[1].focus();
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(heading);
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(cancelled).toHaveBeenCalledTimes(1);
    fixture.destroy();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
