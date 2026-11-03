import { TestBed } from '@angular/core/testing';
import { ProposalStatusCardComponent } from './proposal-status-card.component';
import type { ProposalSessionStatus } from './proposal-session-status';

const cases: readonly [ProposalSessionStatus, string][] = [
  ['loading', 'Loading proposal'],
  ['working', 'Working'],
  ['waiting', 'Waiting for you'],
  ['ready', 'Proposal ready'],
  ['failed', 'Failed'],
  ['stopping', 'Stopping'],
  ['not-connected', 'Not connected'],
];

describe('ProposalStatusCardComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it.each(cases)('renders %s with the correct title and at most one primary', (status, title) => {
    TestBed.configureTestingModule({ imports: [ProposalStatusCardComponent] });
    const fixture = TestBed.createComponent(ProposalStatusCardComponent);
    fixture.componentRef.setInput('status', status);
    fixture.componentRef.setInput('reviewEligible', status === 'ready');
    fixture.componentRef.setInput('canRetryBrief', status === 'failed');
    fixture.componentRef.setInput('meta', 'Revision 2');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[statusTitle]')?.textContent?.trim()).toBe(title);
    expect(el.querySelectorAll('button.btn-primary')).toHaveLength(
      status === 'ready' || status === 'failed' ? 1 : 0,
    );
    const review = el.querySelector('button') as HTMLButtonElement;
    expect(review.disabled).toBe(status !== 'ready');
    if (status !== 'ready') {
      expect(review.getAttribute('aria-describedby')).toBe('review-reason');
      expect(el.querySelector('#review-reason')).not.toBeNull();
    }
    if (status === 'stopping') {
      expect([...el.querySelectorAll('button')].every((button) => button.disabled)).toBe(true);
    }
    expect(el.querySelector('[class*="border-dashed"]')).toBeNull();
  });

  it('emits the selected actions and hides them on Review', () => {
    TestBed.configureTestingModule({ imports: [ProposalStatusCardComponent] });
    const fixture = TestBed.createComponent(ProposalStatusCardComponent);
    fixture.componentRef.setInput('status', 'ready');
    fixture.componentRef.setInput('reviewEligible', true);
    const review = jest.fn();
    const saveDraft = jest.fn();
    const saveAsPreset = jest.fn();
    fixture.componentInstance.review.subscribe(review);
    fixture.componentInstance.saveDraft.subscribe(saveDraft);
    fixture.componentInstance.saveAsPreset.subscribe(saveAsPreset);
    fixture.detectChanges();
    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll('button');
    buttons[0].click();
    buttons[1].click();
    buttons[2].click();
    expect(review).toHaveBeenCalledTimes(1);
    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(saveAsPreset).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('showActions', false);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('button')).toBeNull();
  });
});
