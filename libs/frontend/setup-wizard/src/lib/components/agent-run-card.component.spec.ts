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
  });
});
