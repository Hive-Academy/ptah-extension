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
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Start now');
    expect(fixture.nativeElement.textContent).toContain('5 seconds');
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
});
