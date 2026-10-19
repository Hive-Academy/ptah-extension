import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideMarkdown } from 'ngx-markdown';
import { AgentMonitorStore, type MonitoredAgent } from '@ptah-extension/chat-streaming';
import { ClaudeRpcService, FILE_LINK_OPENER, VSCodeService } from '@ptah-extension/core';
import { createMockRpcService, provideSurfaceActiveTesting } from '@ptah-extension/core/testing';
import { AgentMonitorTreeBuilderService } from '../../../services/agent-monitor-tree-builder.service';
import { AgentCardComponent } from './agent-card.component';

function lane(overrides: Partial<MonitoredAgent> = {}): MonitoredAgent {
  return {
    agentId: 'lane-1', cli: 'codex', task: 'Inspect files', status: 'completed',
    startedAt: 1000, completedAt: 3000, stdout: '', stderr: '', expanded: true,
    segments: [], streamEvents: [], streamRevision: 0, permissionQueue: [],
    cliSessionId: 'cli-123', parentSessionId: 'parent-456', model: 'gpt-5',
    usageTotals: { inputTokens: 1200, outputTokens: 80, contextTokens: 2000 },
    ...overrides,
  };
}

describe('AgentCardComponent flat execution header', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AgentCardComponent],
      providers: [
        provideSurfaceActiveTesting(), provideMarkdown(),
        { provide: AgentMonitorStore, useValue: { tick: signal(0), agentsById: signal(new Map()) } },
        { provide: ClaudeRpcService, useValue: createMockRpcService() },
        { provide: FILE_LINK_OPENER, useValue: { open: jest.fn() } },
        { provide: VSCodeService, useValue: { config: signal({ panelId: '' }), postMessage: jest.fn() } },
      ],
    });
  });

  it('moves usage and facts behind one label with a separate Resume action', () => {
    const fixture = TestBed.createComponent(AgentCardComponent);
    fixture.componentRef.setInput('agent', lane());
    fixture.componentRef.setInput('presentation', 'flat');
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const row = root.querySelector<HTMLButtonElement>('[data-test="turn-disclosure-row"]')!;
    expect(row.getAttribute('aria-label')).toContain('Worked for 2s');
    expect(row.getAttribute('aria-label')).toContain('1.3k tokens');
    expect(row.getAttribute('aria-label')).not.toContain('Completed');
    expect(root.querySelector('ptah-agent-card-header')).toBeNull();
    expect(root.querySelector('.badge-success')).toBeNull();
    const resume = root.querySelector<HTMLButtonElement>('[aria-label="Resume codex session"]')!;
    expect(row.closest('ptah-turn-disclosure-row')?.nextElementSibling?.contains(resume)).toBe(true);
    expect(row.contains(resume)).toBe(false);
    expect(root.querySelector('ptah-cli-lane-usage-summary')).toBeNull();
    row.click();
    fixture.detectChanges();
    const details = root.querySelector<HTMLElement>('#cli-lane-details-lane-1')!;
    expect(details.textContent).toContain('Model: gpt-5');
    expect(details.textContent).toContain('Status: Completed');
    expect(details.textContent).toContain('Task: Inspect files');
    expect(details.textContent).toContain('CLI session: cli-123');
    expect(details.textContent).toContain('Parent: parent-456');
    expect(details.textContent).toContain('ctx 2.0k');
  });

  it('shows Stop while running and omits unknown token totals', () => {
    const fixture = TestBed.createComponent(AgentCardComponent);
    fixture.componentRef.setInput('agent', lane({ status: 'running', usageTotals: null, completedAt: undefined }));
    fixture.componentRef.setInput('presentation', 'flat');
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[aria-label="Stop codex"]')).not.toBeNull();
    expect(root.querySelector('[aria-label="Resume codex session"]')).toBeNull();
    expect(root.querySelector('[data-test="turn-disclosure-row"]')?.getAttribute('aria-label')).not.toContain('tokens');
  });

  it.each([
    ['failed', 'Failed'],
    ['timeout', 'Timed out'],
    ['stopped', 'Stopped'],
  ] as const)('shows %s as warning metadata and in details', (status, label) => {
    const fixture = TestBed.createComponent(AgentCardComponent);
    fixture.componentRef.setInput('agent', lane({ status }));
    fixture.componentRef.setInput('presentation', 'flat');
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const row = root.querySelector<HTMLButtonElement>('[data-test="turn-disclosure-row"]')!;
    expect(row.getAttribute('aria-label')).toContain(label);
    expect(root.querySelector('[data-test="turn-disclosure-meta"]')?.className).toContain('!text-warning');
    row.click();
    fixture.detectChanges();
    expect(root.querySelector('#cli-lane-details-lane-1')?.textContent).toContain(`Status: ${label}`);
  });

  it('keeps a guard reason beside a stopped status', () => {
    const fixture = TestBed.createComponent(AgentCardComponent);
    fixture.componentRef.setInput('agent', lane({ status: 'stopped', stopReason: 'tool-call-budget' }));
    fixture.componentRef.setInput('presentation', 'flat');
    fixture.detectChanges();
    const label = fixture.nativeElement.querySelector('[data-test="turn-disclosure-row"]')?.getAttribute('aria-label');
    expect(label).toContain('Stopped');
    expect(label).toContain('Stopped: tool-call limit reached');
  });

  it.each([
    { totalTokens: 0 },
    { inputTokens: 0, outputTokens: 0 },
  ])('omits zero token metadata', (usageTotals) => {
    const fixture = TestBed.createComponent(AgentCardComponent);
    fixture.componentRef.setInput('agent', lane({ usageTotals }));
    fixture.componentRef.setInput('presentation', 'flat');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-test="turn-disclosure-row"]')?.getAttribute('aria-label')).not.toContain('tokens');
  });

  it('marks a structured input and output sum as partial', () => {
    const fixture = TestBed.createComponent(AgentCardComponent);
    fixture.componentRef.setInput('agent', lane({ usageTotals: { inputTokens: 1200, outputTokens: 80 } }));
    fixture.componentRef.setInput('presentation', 'flat');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-test="turn-disclosure-row"]')?.getAttribute('aria-label')).toContain('≥ 1.3k tokens');
  });

  it('constructs the lane tree builder only for flat presentation', () => {
    const treeBuilderFactory = jest.fn(() => ({ buildTreeFromSegments: jest.fn(() => []) }));
    TestBed.overrideProvider(AgentMonitorTreeBuilderService, { useFactory: treeBuilderFactory });
    const fixture = TestBed.createComponent(AgentCardComponent);
    fixture.componentRef.setInput('agent', lane());
    fixture.detectChanges();
    expect(treeBuilderFactory).not.toHaveBeenCalled();
    fixture.componentRef.setInput('presentation', 'flat');
    fixture.detectChanges();
    expect(treeBuilderFactory).toHaveBeenCalledTimes(1);
  });

  it('marks segment totals as partial and displays a guard stop reason', () => {
    const fixture = TestBed.createComponent(AgentCardComponent);
    fixture.componentRef.setInput('agent', lane({
      usageTotals: null,
      stopReason: 'tool-call-budget',
      segments: [{ type: 'info', content: '', usage: { inputTokens: 1200, outputTokens: 80 } }],
    }));
    fixture.componentRef.setInput('presentation', 'flat');
    fixture.detectChanges();
    const row: HTMLButtonElement = fixture.nativeElement.querySelector('[data-test="turn-disclosure-row"]');
    expect(row.getAttribute('aria-label')).toContain('≥ 1.3k tokens');
    expect(row.getAttribute('aria-label')).toContain('Stopped: tool-call limit reached');
    expect(fixture.nativeElement.querySelector('[data-test="turn-disclosure-meta"]')?.className).toContain('!text-warning');
  });
});
