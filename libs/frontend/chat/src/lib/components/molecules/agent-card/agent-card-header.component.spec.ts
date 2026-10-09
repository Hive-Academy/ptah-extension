import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { MonitoredAgent } from '@ptah-extension/chat-streaming';
import { AgentCardHeaderComponent } from './agent-card-header.component';

function lane(overrides: Partial<MonitoredAgent> = {}): MonitoredAgent {
  return {
    agentId: 'agent-1',
    cli: 'codex',
    task: 'Do work',
    status: 'running',
    startedAt: 0,
    stdout: '',
    stderr: '',
    expanded: true,
    segments: [],
    streamEvents: [],
    streamRevision: 0,
    permissionQueue: [],
    cacheState: 'unknown',
    cacheReported: false,
    ...overrides,
  };
}

describe('AgentCardHeaderComponent — prompt cache (N6)', () => {
  let fixture: ComponentFixture<AgentCardHeaderComponent>;

  function setup(agent: MonitoredAgent): HTMLElement {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [AgentCardHeaderComponent] });
    fixture = TestBed.createComponent(AgentCardHeaderComponent);
    fixture.componentRef.setInput('agent', agent);
    fixture.componentRef.setInput('elapsedDisplay', '1s');
    fixture.componentRef.setInput('isStopping', false);
    fixture.componentRef.setInput('isResuming', false);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('keeps cache details in the usage card instead of duplicating them in the lane header', () => {
    const el = setup(lane());
    expect(
      el.querySelector('[data-testid="lane-cache-not-reported"]'),
    ).toBeNull();
    expect(el.textContent).not.toMatch(/\b(warm|cold|ctx)\b/);
  });

  it('shows no cache chip when the agent carries no cache fields', () => {
    const el = setup(lane({ cacheReported: undefined, cacheState: undefined }));
    expect(el.querySelector('[data-testid="lane-cache-not-reported"]')).toBe(
      null,
    );
  });

  it('explains a tool-call budget stop and a repeat-call stop', () => {
    const budget = setup(
      lane({ status: 'stopped', stopReason: 'tool-call-budget' }),
    );
    expect(
      budget.querySelector('[data-testid="lane-stop-reason"]')?.textContent,
    ).toContain('Stopped: tool-call limit reached');

    const repeat = setup(
      lane({ status: 'stopped', stopReason: 'repeat-call' }),
    );
    expect(
      repeat.querySelector('[data-testid="lane-stop-reason"]')?.textContent,
    ).toContain('Stopped: repeated the same tool call');
  });

  it('hides the stop reason while the lane is running and when none was recorded', () => {
    const running = setup(
      lane({ status: 'running', stopReason: 'tool-call-budget' }),
    );
    expect(
      running.querySelector('[data-testid="lane-stop-reason"]'),
    ).toBeNull();

    const plain = setup(lane({ status: 'stopped' }));
    expect(plain.querySelector('[data-testid="lane-stop-reason"]')).toBeNull();
  });
});
