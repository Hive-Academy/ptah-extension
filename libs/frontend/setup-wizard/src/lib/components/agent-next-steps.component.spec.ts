import { TestBed } from '@angular/core/testing';
import { AgentNextStepsComponent } from './agent-next-steps.component';

describe('AgentNextStepsComponent', () => {
  it('shows countdown actions only for a pending handoff', () => {
    TestBed.configureTestingModule({ imports: [AgentNextStepsComponent] });
    const fixture = TestBed.createComponent(AgentNextStepsComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Continue to project guidance',
    );
    expect(fixture.nativeElement.textContent).not.toContain('Start now');
    fixture.componentRef.setInput('pending', true);
    fixture.componentRef.setInput('remainingSeconds', 5);
    fixture.componentRef.setInput('previewModel', 'sonnet');
    fixture.componentRef.setInput('previewProvider', 'anthropic');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Start now');
    expect(fixture.nativeElement.textContent).toContain('5 seconds');
    expect(fixture.nativeElement.textContent).toContain('Will use: anthropic');
    expect(fixture.nativeElement.textContent).toContain('sonnet');
    const start = jest.fn();
    const skip = jest.fn();
    fixture.componentInstance.startNow.subscribe(start);
    fixture.componentInstance.skip.subscribe(skip);
    const buttons = fixture.nativeElement.querySelectorAll('button');
    buttons[0].click();
    buttons[1].click();
    expect(start).toHaveBeenCalledTimes(1);
    expect(skip).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelectorAll('li')).toHaveLength(5);
  });

  it('turns manual Skip into a visible skipped state', () => {
    TestBed.configureTestingModule({ imports: [AgentNextStepsComponent] });
    const fixture = TestBed.createComponent(AgentNextStepsComponent);
    fixture.componentRef.setInput('manualRecovery', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Skip guidance');
    fixture.componentRef.setInput('skipped', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Project guidance skipped',
    );
    expect(fixture.nativeElement.textContent).not.toContain('Skip guidance');
  });
});
