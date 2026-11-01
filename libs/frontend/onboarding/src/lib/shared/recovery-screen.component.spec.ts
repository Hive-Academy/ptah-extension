import { TestBed } from '@angular/core/testing';
import { RecoveryScreenComponent } from './recovery-screen.component';

describe('RecoveryScreenComponent', () => {
  it('shows the reason and emits its recovery actions', () => {
    TestBed.configureTestingModule({ imports: [RecoveryScreenComponent] });
    const fixture = TestBed.createComponent(RecoveryScreenComponent);
    fixture.componentRef.setInput('reason', 'proposal-unavailable');
    fixture.componentRef.setInput('canRestoreDraft', true);
    const primary = jest.fn();
    const restore = jest.fn();
    fixture.componentInstance.primary.subscribe(primary);
    fixture.componentInstance.restoreDraft.subscribe(restore);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Proposal unavailable');
    const buttons = el.querySelectorAll('button');
    buttons[0].click();
    buttons[1].click();
    expect(primary).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it('gives each instance its own labelled heading', () => {
    TestBed.configureTestingModule({ imports: [RecoveryScreenComponent] });
    const first = TestBed.createComponent(RecoveryScreenComponent);
    const second = TestBed.createComponent(RecoveryScreenComponent);
    first.componentRef.setInput('reason', 'missing-tab');
    second.componentRef.setInput('reason', 'stale-run');
    first.detectChanges();
    second.detectChanges();
    const firstSection = (first.nativeElement as HTMLElement).querySelector('section') as HTMLElement;
    const secondSection = (second.nativeElement as HTMLElement).querySelector('section') as HTMLElement;
    expect(firstSection.getAttribute('aria-labelledby')).toBe(firstSection.querySelector('h2')?.id);
    expect(secondSection.getAttribute('aria-labelledby')).toBe(secondSection.querySelector('h2')?.id);
    expect(firstSection.querySelector('h2')?.id).not.toBe(secondSection.querySelector('h2')?.id);
  });
});
