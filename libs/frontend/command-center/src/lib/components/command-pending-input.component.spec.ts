import { TestBed } from '@angular/core/testing';
import type { CommandPendingInput } from '../model/command-center.store';
import type { TribunalRosterProposal } from '../model/tribunal-roster-proposal';
import { CommandPendingInputComponent } from './command-pending-input.component';

const pending: CommandPendingInput = {
  id: 'q1',
  kind: 'question',
  title: 'Choose a branch',
  description: 'Which release branch should we inspect?',
};
const roster: TribunalRosterProposal = {
  proposalId: 'p1',
  nonce: 'n1',
  rootSessionId: 'root',
  move: 'council',
  options: ['Decline', 'Confirm'],
  objective: 'Review the release',
  rounds: 1,
  lanes: [
    { laneId: 'codex1', family: 'codex', displayName: 'Codex', cli: 'codex' },
  ],
};

function buttonWithText(root: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll('button')).find((item) =>
    item.textContent?.includes(text),
  );
  if (!button) throw new Error(`Missing button: ${text}`);
  return button;
}

describe('CommandPendingInputComponent', () => {
  function setup(proposal: TribunalRosterProposal | null = roster) {
    TestBed.configureTestingModule({ imports: [CommandPendingInputComponent] });
    const fixture = TestBed.createComponent(CommandPendingInputComponent);
    fixture.componentRef.setInput('pending', pending);
    fixture.componentRef.setInput('proposal', proposal);
    fixture.detectChanges();
    return fixture;
  }

  it('confirms a Tribunal once by click and shows its roster, mode and rounds', () => {
    const fixture = setup();
    const confirm = jest.fn();
    fixture.componentInstance.confirm.subscribe(confirm);
    expect(fixture.nativeElement.textContent).toContain('Codex');
    expect(fixture.nativeElement.textContent).toContain('council');
    expect(fixture.nativeElement.textContent).toContain('Rounds: 1');
    const button = buttonWithText(fixture.nativeElement, 'Confirm');
    button.click();
    button.click();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(roster);
  });

  it('confirms from Enter on the focused button', () => {
    const fixture = setup();
    const confirm = jest.fn();
    fixture.componentInstance.confirm.subscribe(confirm);
    const button = buttonWithText(fixture.nativeElement, 'Confirm');
    button.focus();
    button.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('does not confirm from a spoken or ordinary answer', () => {
    const fixture = setup(null);
    const confirm = jest.fn();
    fixture.componentInstance.confirm.subscribe(confirm);
    fixture.componentInstance.respond('q1', 'yes');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('shows and emits the full ordinary choice', () => {
    const fixture = setup(null);
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

  it('emits Decline and displays timeout', () => {
    const fixture = setup();
    const decline = jest.fn();
    fixture.componentInstance.decline.subscribe(decline);
    (
      fixture.nativeElement.querySelector('button') as HTMLButtonElement
    ).click();
    expect(decline).toHaveBeenCalledWith('p1');
    fixture.componentRef.setInput('timedOut', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('timed out');
    const confirm = buttonWithText(fixture.nativeElement, 'Confirm');
    expect(confirm.disabled).toBe(true);
  });

  it('clears a typed answer when the pending request id changes', () => {
    const fixture = setup(null);
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
    const fixture = setup(null);
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

  it('emits Decline once despite duplicate clicks, including after timeout', () => {
    const fixture = setup();
    const decline = jest.fn();
    fixture.componentInstance.decline.subscribe(decline);
    fixture.componentRef.setInput('timedOut', true);
    fixture.detectChanges();
    const button = buttonWithText(fixture.nativeElement, 'Decline');
    button.click();
    button.click();
    fixture.detectChanges();
    expect(decline).toHaveBeenCalledTimes(1);
    expect(decline).toHaveBeenCalledWith('p1');
    expect(button.disabled).toBe(true);
  });

  it('renders a non-Decline-first proposal as invalid with no Confirm', () => {
    const fixture = setup({ ...roster, options: ['Confirm', 'Decline'] });
    expect(fixture.nativeElement.textContent).toContain(
      'Invalid Tribunal proposal',
    );
    expect(fixture.nativeElement.textContent).not.toContain('Confirm Tribunal');
  });
});
