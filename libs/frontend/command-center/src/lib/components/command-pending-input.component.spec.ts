import { TestBed } from '@angular/core/testing';
import type { CommandPendingInput } from '../model/command-center.store';
import { CommandPendingInputComponent } from './command-pending-input.component';

const pending: CommandPendingInput = {
  id: 'q1',
  kind: 'question',
  title: 'Choose a branch',
  description: 'Which release branch should we inspect?',
};
function buttonWithText(root: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll('button')).find((item) =>
    item.textContent?.includes(text),
  );
  if (!button) throw new Error(`Missing button: ${text}`);
  return button;
}

describe('CommandPendingInputComponent', () => {
  function setup() {
    TestBed.configureTestingModule({ imports: [CommandPendingInputComponent] });
    const fixture = TestBed.createComponent(CommandPendingInputComponent);
    fixture.componentRef.setInput('pending', pending);
    fixture.detectChanges();
    return fixture;
  }

  it('keeps an assertive announcement region mounted while pending changes', () => {
    const fixture = setup();
    const live = fixture.nativeElement.querySelector('[aria-live="assertive"]') as HTMLElement;
    expect(live.getAttribute('aria-atomic')).toBe('true');
    expect(live.textContent).toContain('Action required: Choose a branch');
    fixture.componentRef.setInput('pending', null);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[aria-live="assertive"]')).toBe(live);
    expect(live.textContent?.trim()).toBe('');
    expect(fixture.nativeElement.querySelector('#pending-title')).toBeNull();
    fixture.componentRef.setInput('pending', { ...pending, title: 'Choose a target' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[aria-live="assertive"]')).toBe(live);
    expect(live.textContent).toContain('Action required: Choose a target');
  });

  it('uses readable light input tokens and a base-content focus ring', () => {
    const fixture = setup();
    const answer = fixture.nativeElement.querySelector(
      '#pending-answer',
    ) as HTMLInputElement;
    expect(answer.className).toContain('placeholder:!text-base-content-muted');
    expect(answer.className).toContain('!border-base-content/70');
    expect(answer.className).toContain('focus-visible:outline-base-content');
  });




  it('scrolls the question body while keeping Send answer outside it', () => {
    const fixture = setup();
    fixture.componentRef.setInput('choices', ['release/next']);
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector('section') as HTMLElement;
    const input = fixture.nativeElement.querySelector(
      '#pending-answer',
    ) as HTMLInputElement;
    expect(card.className).not.toContain('overflow-y-auto');
    expect(card.className).toContain('border-state-need');
    const description = card.querySelector('p.overflow-y-auto') as HTMLElement;
    expect(description.className).toContain('max-h-[96px]');
    expect(description.textContent).toContain(pending.description);
    expect(description.contains(buttonWithText(card, 'Send answer'))).toBe(
      false,
    );
    expect(input.placeholder).toBe('e.g. release/next');
    expect(input.className).toContain('!border-base-content/50');
    expect(input.className).toContain('placeholder:!text-base-content-muted');
    expect(input.className).toContain('focus-visible:outline-2');
  });

  it('shows and emits the full ordinary choice', () => {
    const fixture = setup();
    fixture.componentRef.setInput('choices', [
      'release/next',
      'release/stable',
    ]);
    fixture.detectChanges();
    const response = jest.fn();
    fixture.componentInstance.response.subscribe(response);
    const choice = buttonWithText(fixture.nativeElement, 'release/stable');
    choice.click();
    expect(response).toHaveBeenCalledWith({
      id: 'q1',
      answer: 'release/stable',
    });
    expect(fixture.nativeElement.textContent).toContain(pending.description);
  });


  it('clears a typed answer when the pending request id changes', () => {
    const fixture = setup();
    fixture.componentInstance.answer.set('answer for q1');
    fixture.detectChanges();
    fixture.componentRef.setInput('pending', { ...pending, id: 'q2' });
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector(
      '#pending-answer',
    ) as HTMLInputElement | null;
    if (!input) throw new Error('Missing answer input');
    expect(input.value).toBe('');
    expect(fixture.componentInstance.answer()).toBe('');
  });

  it('emits an ordinary answer once despite duplicate clicks', () => {
    const fixture = setup();
    const response = jest.fn();
    fixture.componentInstance.response.subscribe(response);
    const choice = buttonWithText(fixture.nativeElement, 'Send answer');
    fixture.componentInstance.answer.set('release/next');
    fixture.detectChanges();
    choice.click();
    choice.click();
    fixture.detectChanges();
    expect(response).toHaveBeenCalledTimes(1);
    expect(choice.disabled).toBe(true);
  });

  it('re-enables a rejected answer with feedback, then sends a valid answer once', () => {
    const fixture = setup();
    fixture.componentRef.setInput('choices', ['Decline']);
    fixture.detectChanges();
    const response = jest.fn();
    fixture.componentInstance.response.subscribe(response);
    fixture.componentInstance.answer.set('yes');
    fixture.detectChanges();
    const send = buttonWithText(fixture.nativeElement, 'Send answer');
    send.click();
    send.click();
    expect(response).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('answerResult', {
      id: 'q1',
      accepted: false,
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'That answer is not accepted here',
    );
    expect(send.disabled).toBe(false);
    const decline = buttonWithText(fixture.nativeElement, 'Decline');
    decline.click();
    decline.click();
    expect(response).toHaveBeenCalledTimes(2);
    expect(response).toHaveBeenLastCalledWith({ id: 'q1', answer: 'Decline' });
    fixture.componentRef.setInput('answerResult', { id: 'q1', accepted: true });
    fixture.detectChanges();
    expect(send.disabled).toBe(true);
  });



  it('uses a scoped question card and keeps the typed answer available', () => {
    const fixture = setup();
    expect(fixture.nativeElement.textContent).toContain('For this session');
    expect(fixture.nativeElement.querySelector('#pending-title')?.textContent).toContain(pending.title);
    expect(fixture.nativeElement.querySelector('[data-test="pending-kind-icon"] svg')).not.toBeNull();
    const response = jest.fn();
    fixture.componentInstance.response.subscribe(response);
    const answer = fixture.nativeElement.querySelector('#pending-answer') as HTMLInputElement;
    answer.value = 'release/next';
    answer.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    buttonWithText(fixture.nativeElement, 'Send answer').click();
    expect(response).toHaveBeenCalledWith({ id: 'q1', answer: 'release/next' });
  });

  it('uses the approval card with explicit Deny and Approve controls', () => {
    const fixture = setup();
    fixture.componentRef.setInput('pending', { ...pending, kind: 'approval', title: 'Repository access' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Action required · approval');
    expect(fixture.nativeElement.querySelector('[data-test="pending-kind-icon"] svg')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#pending-answer')).toBeNull();
    const response = jest.fn();
    fixture.componentInstance.response.subscribe(response);
    buttonWithText(fixture.nativeElement, 'Approve').click();
    expect(response).toHaveBeenCalledWith({ id: 'q1', answer: 'Approve' });
  });

});
