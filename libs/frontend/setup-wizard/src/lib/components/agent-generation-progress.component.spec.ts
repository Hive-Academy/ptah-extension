import { TestBed } from '@angular/core/testing';
import { AgentGenerationProgressComponent } from './agent-generation-progress.component';

describe('AgentGenerationProgressComponent', () => {
  it('keeps written checkpoint outcomes and offers retry only for failures', () => {
    TestBed.configureTestingModule({
      imports: [AgentGenerationProgressComponent],
    });
    const fixture = TestBed.createComponent(AgentGenerationProgressComponent);
    fixture.componentRef.setInput('checkpoint', {
      agents: [
        { agentId: 'written', status: 'written' },
        { agentId: 'failed', status: 'failed' },
      ],
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('written');
    expect(fixture.nativeElement.querySelectorAll('button').length).toBe(1);
    const retry = jest.fn();
    fixture.componentInstance.retry.subscribe(retry);
    fixture.nativeElement.querySelector('button').click();
    expect(retry).toHaveBeenCalledWith('failed');
    fixture.componentRef.setInput('remaining', { failed: 0 });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button').disabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('written');
  });
});
