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
        contextTokens: 2000,
        cacheReadTokens: 900,
        cacheWriteTokens: 300,
        costUsd: 0.0123,
      }),
    );
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('in 1.2k');
    expect(text).toContain('ctx 2.0k');
    expect(text).toContain('cache read 900');
    expect(text).toContain('cache write 300');
    expect(text).toContain('~$0.01 est.');
    expect(text).not.toContain('4m 2s');
    const labels = fixture.nativeElement.querySelectorAll('[role="group"] span');
    expect(labels).toHaveLength(6);
    for (const label of labels) {
      expect(label.classList.contains('text-base-content-muted')).toBe(true);
      expect(label.className).not.toMatch(/text-(?:info|accent|warning)\/70/);
    }
  });

  it('omits token labels that the provider did not report', () => {
    TestBed.configureTestingModule({ imports: [CliLaneUsageSummaryComponent] });
    const fixture = TestBed.createComponent(CliLaneUsageSummaryComponent);
    fixture.componentRef.setInput('agent', agent(null));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('cache read');
    expect(fixture.nativeElement.textContent).not.toContain('cache write');
    expect(fixture.nativeElement.textContent).not.toContain('in ');
    expect(fixture.nativeElement.textContent).toContain('ctx —');
    expect(fixture.nativeElement.textContent).toContain('—');
  });

  it('marks retained and live segment usage as partial when restored structured totals stay null', () => {
    const lane = agent(null);
    lane.segments = [
      { type: 'info', content: '', usage: { inputTokens: 11_900, outputTokens: 56, costUsd: 0.15 } },
      { type: 'info', content: '', usage: { inputTokens: 5, outputTokens: 1 } },
    ];
    TestBed.configureTestingModule({ imports: [CliLaneUsageSummaryComponent] });
    const fixture = TestBed.createComponent(CliLaneUsageSummaryComponent);
    fixture.componentRef.setInput('agent', lane);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('in ≥ 11.9k');
    expect(fixture.nativeElement.textContent).toContain('out ≥ 57');
    expect(fixture.nativeElement.textContent).toContain('≥ ~$0.15 est.');
    expect(fixture.nativeElement.textContent).toContain('ctx —');
    expect(fixture.nativeElement.textContent).not.toContain('cache read');
    expect(fixture.nativeElement.textContent).not.toContain('cache write');
    expect(fixture.nativeElement.querySelector('[role="group"]')?.getAttribute('title')).toBe('From retained output, may be partial');
  });

  it('prefers structured totals to usage segments', () => {
    const lane = agent({ inputTokens: 3, outputTokens: 4 });
    lane.segments = [{ type: 'info', content: '', usage: { inputTokens: 11_900, outputTokens: 56 } }];
    TestBed.configureTestingModule({ imports: [CliLaneUsageSummaryComponent] });
    const fixture = TestBed.createComponent(CliLaneUsageSummaryComponent);
    fixture.componentRef.setInput('agent', lane);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('in 3');
    expect(fixture.nativeElement.textContent).toContain('out 4');
    expect(fixture.nativeElement.textContent).not.toContain('11.9k');
    expect(fixture.nativeElement.textContent).not.toContain('≥');
    expect(fixture.nativeElement.querySelector('[role="group"]')?.getAttribute('title')).toBeNull();
  });
});
