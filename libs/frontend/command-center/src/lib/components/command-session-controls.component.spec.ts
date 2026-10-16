import { TestBed } from '@angular/core/testing';
import { CommandSessionControlsComponent } from './command-session-controls.component';

describe('CommandSessionControlsComponent', () => {
  it('sends the trimmed draft and retains status and new-session actions', () => {
    TestBed.configureTestingModule({
      imports: [CommandSessionControlsComponent],
    });
    const fixture = TestBed.createComponent(CommandSessionControlsComponent);
    fixture.componentRef.setInput('sessionStatus', 'idle');
    const send = jest.fn();
    const startNew = jest.fn();
    const status = jest.fn();
    fixture.componentInstance.commandSubmit.subscribe(send);
    fixture.componentInstance.newSession.subscribe(startNew);
    fixture.componentInstance.requestStatus.subscribe(status);
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector(
      'input',
    ) as HTMLInputElement;
    expect(input.placeholder).toBe('Or type a command for Ptah...');
    expect(input.parentElement?.className).toContain('border-base-content');
    expect(input.className).toContain('focus-visible:outline-warning');
    input.value = '  Review release  ';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (
      fixture.nativeElement.querySelector('form') as HTMLFormElement
    ).dispatchEvent(new Event('submit', { cancelable: true }));
    expect(send).toHaveBeenCalledWith('Review release');
    const buttons = [
      ...fixture.nativeElement.querySelectorAll('button'),
    ] as HTMLButtonElement[];
    buttons
      .find((button) => button.textContent?.trim() === 'Start new')
      ?.click();
    buttons.find((button) => button.textContent?.trim() === 'Status')?.click();
    expect(startNew).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledTimes(1);
  });
});
