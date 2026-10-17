import { TestBed } from '@angular/core/testing';
import { AgentRunCardComponent } from './agent-run-card.component';

describe('AgentRunCardComponent', () => {
  it('offers Resume for an interrupted run', () => {
    TestBed.configureTestingModule({ imports: [AgentRunCardComponent] });
    const fixture = TestBed.createComponent(AgentRunCardComponent);
    fixture.componentRef.setInput('state', 'cancelled');
    fixture.componentRef.setInput('run', { interrupted: true });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Resume');
    const resume = jest.fn();
    fixture.componentInstance.resumeRequested.subscribe(resume);
    fixture.nativeElement.querySelector('button').click();
    expect(resume).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('run', null);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
  });
});
