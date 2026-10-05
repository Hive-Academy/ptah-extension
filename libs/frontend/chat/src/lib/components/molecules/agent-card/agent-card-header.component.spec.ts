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

  it('shows "cache not reported" on a CLI lane, with no context size or warm/cold badge', () => {
    const el = setup(lane());
    const chip = el.querySelector('[data-testid="lane-cache-not-reported"]');
    expect(chip?.textContent?.trim()).toBe('cache not reported');
    expect(el.textContent).not.toMatch(/\b(warm|cold|ctx)\b/);
    expect(el.textContent).not.toContain('0 tok');
  });

  it('shows no cache chip when the agent carries no cache fields', () => {
    const el = setup(lane({ cacheReported: undefined, cacheState: undefined }));
    expect(el.querySelector('[data-testid="lane-cache-not-reported"]')).toBe(
      null,
    );
  });
});
