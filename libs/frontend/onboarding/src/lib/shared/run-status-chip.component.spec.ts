import { TestBed } from '@angular/core/testing';
import type { GenerationViewState } from '@ptah-extension/setup-wizard';
import { chipStateFor, RunStatusChipComponent, type OnboardingRunChipState } from './run-status-chip.component';

describe('RunStatusChipComponent', () => {
  it.each<[GenerationViewState, OnboardingRunChipState]>([
    ['idle', 'idle'], ['starting', 'running'], ['running', 'running'],
    ['quiet', 'running'], ['cancelling', 'cancelling'],
    ['stop-unconfirmed', 'cancelling'], ['stop-unknown', 'cancelling'],
    ['completed', 'done'], ['cancelled', 'resumable'],
    ['failed', 'failed'], ['timed-out', 'failed'],
  ])('maps %s to %s', (view, chip) => {
    expect(chipStateFor(view)).toBe(chip);
  });

  it.each<[OnboardingRunChipState, string]>([
    ['idle', 'Ready'], ['running', 'Running'], ['cancelling', 'Stopping'],
    ['failed', 'Failed'], ['resumable', 'Interrupted'], ['done', 'Done'],
  ])('pairs the %s glyph with text', (state, label) => {
    TestBed.configureTestingModule({ imports: [RunStatusChipComponent] });
    const fixture = TestBed.createComponent(RunStatusChipComponent);
    fixture.componentRef.setInput('state', state);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('lucide-angular')?.getAttribute('aria-hidden')).toBe('true');
    expect(el.textContent).toContain(label);
    if (state === 'running') expect(el.querySelector('lucide-angular')?.className).toContain('motion-reduce:animate-none');
    TestBed.resetTestingModule();
  });
});
