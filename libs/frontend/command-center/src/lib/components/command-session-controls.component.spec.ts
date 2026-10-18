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
    expect(input.parentElement?.className).toContain('min-w-[15rem]');
    expect(input.parentElement?.className).toContain('flex-[1_1_15rem]');
    expect(input.className).toContain('focus-visible:outline-base-content');
    input.value = '  Review release  ';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (
      fixture.nativeElement.querySelector('form') as HTMLFormElement
    ).dispatchEvent(new Event('submit', { cancelable: true }));
    expect(send).toHaveBeenCalledWith('Review release');
    expect(fixture.componentInstance.draft()).toBe('  Review release  ');
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

  it('clears only the draft that was sent', () => {
    TestBed.configureTestingModule({
      imports: [CommandSessionControlsComponent],
    });
    const controls = TestBed.createComponent(
      CommandSessionControlsComponent,
    ).componentInstance;
    controls.draft.set('  first  ');
    controls.clearDraft('first');
    expect(controls.draft()).toBe('');
    controls.draft.set('first and more');
    controls.clearDraft('first');
    expect(controls.draft()).toBe('first and more');
  });
});
