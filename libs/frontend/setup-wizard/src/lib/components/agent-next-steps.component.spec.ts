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
  });
});
