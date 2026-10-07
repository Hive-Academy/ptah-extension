import { TestBed } from '@angular/core/testing';
import type { MonitoredAgent } from '@ptah-extension/chat-streaming';
import { CliLaneUsageSummaryComponent } from './cli-lane-usage-summary.component';

function agent(usageTotals?: MonitoredAgent['usageTotals']): MonitoredAgent {
  return {
    agentId: 'lane-1',
    cli: 'codex',
    task: 'Task',
    status: 'running',
    startedAt: 0,
    stdout: '',
    stderr: '',
    expanded: true,
    segments: [],
    streamEvents: [],
    streamRevision: 0,
    permissionQueue: [],
    usageTotals,
  };
}

describe('CliLaneUsageSummaryComponent', () => {
  it('renders cache usage reported by a CLI', () => {
    TestBed.configureTestingModule({ imports: [CliLaneUsageSummaryComponent] });
    const fixture = TestBed.createComponent(CliLaneUsageSummaryComponent);
    fixture.componentRef.setInput(
      'agent',
      agent({
        inputTokens: 1200,
        outputTokens: 80,
        cacheReadTokens: 900,
        cacheWriteTokens: 300,
        costUsd: 0.0123,
      }),
    );
    fixture.componentRef.setInput('duration', '4m 2s');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('in 1.2k');
    expect(text).toContain('cache read 900');
    expect(text).toContain('cache write 300');
    expect(text).toContain('~$0.01 est.');
    expect(text).toContain('4m 2s');
  });

  it('does not substitute zero when the CLI has not reported usage', () => {
    TestBed.configureTestingModule({ imports: [CliLaneUsageSummaryComponent] });
    const fixture = TestBed.createComponent(CliLaneUsageSummaryComponent);
    fixture.componentRef.setInput('agent', agent(null));
    fixture.componentRef.setInput('duration', '1s');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('cache not reported');
    expect(fixture.nativeElement.textContent).toContain('in —');
  });
});
