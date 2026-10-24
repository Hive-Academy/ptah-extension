import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideMarkdown } from 'ngx-markdown';
import {
  AgentMonitorStore,
  type MonitoredAgent,
} from '@ptah-extension/chat-streaming';
import {
  ClaudeRpcService,
  FILE_LINK_OPENER,
  ModelStateService,
  VSCodeService,
} from '@ptah-extension/core';
import {
  createMockRpcService,
  provideSurfaceActiveTesting,
} from '@ptah-extension/core/testing';
import { AgentMonitorTreeBuilderService } from '../../../services/agent-monitor-tree-builder.service';
import { AgentCardComponent } from './agent-card.component';

function lane(overrides: Partial<MonitoredAgent> = {}): MonitoredAgent {
  return {
    agentId: 'lane-1',
    cli: 'codex',
    task: 'Inspect files',
    status: 'completed',
    startedAt: 1000,
    completedAt: 3000,
    stdout: '',
    stderr: '',
    expanded: true,
    segments: [],
    streamEvents: [],
    streamRevision: 0,
    permissionQueue: [],
    cliSessionId: 'cli-123',
    parentSessionId: 'parent-456',
    model: 'gpt-5',
    usageTotals: { inputTokens: 1200, outputTokens: 80, contextTokens: 2000 },
    ...overrides,
  };
}

/** The lane control row's meta text (end status, guard reason). */
function metaText(root: HTMLElement): string {
  return (
    root.querySelector('[data-test="execution-header-meta"]')?.textContent ?? ''
  );
}

function detailsToggle(root: HTMLElement): HTMLButtonElement {
  return root.querySelector<HTMLButtonElement>(
    '[data-test="execution-header-details"]',
  )!;
}

describe('AgentCardComponent flat execution header', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AgentCardComponent],
      providers: [
        provideSurfaceActiveTesting(),
        provideMarkdown(),
        {
          provide: AgentMonitorStore,
          useValue: { tick: signal(0), agentsById: signal(new Map()) },
        },
        { provide: ClaudeRpcService, useValue: createMockRpcService() },
        { provide: FILE_LINK_OPENER, useValue: { open: jest.fn() } },
        {
          provide: VSCodeService,
          useValue: { config: signal({ panelId: '' }), postMessage: jest.fn() },
        },
        {
          provide: ModelStateService,
          useValue: { availableModels: signal([]) },
        },
      ],
    });
  });

  it('puts stats, facts and Resume in one control row without a turn label', () => {
    const fixture = TestBed.createComponent(AgentCardComponent);
    fixture.componentRef.setInput('agent', lane());
    fixture.componentRef.setInput('presentation', 'flat');
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const row = root.querySelector<HTMLElement>(
      '[data-test="execution-header-row"]',
    )!;
    const toggle = detailsToggle(root);
    // The transcript bubble owns "Worked for …" and the tool counts.
    expect(root.querySelector('ptah-turn-disclosure-row')).toBeNull();
    expect(toggle.getAttribute('aria-label')).toBe('Worked for 2s details');
    // Tokens live in the stats chips, a completed run has no status meta.
    expect(metaText(root)).not.toContain('tokens');
    expect(metaText(root)).not.toContain('Completed');
    const stats = root.querySelector<HTMLElement>('ptah-agent-lane-stats')!;
    expect(row.contains(stats)).toBe(true);
    expect(
      stats.querySelector('[data-testid="lane-stats-tokens"]')?.textContent,
    ).toContain('≥ 1.3k');
    expect(
      stats.querySelector('[data-testid="lane-stats-context"]')?.textContent,
    ).toContain('2.0k');
    expect(
      stats.querySelector('[data-testid="lane-stats-model"]')?.textContent,
    ).toBeTruthy();
    expect(root.querySelector('ptah-agent-card-header')).toBeNull();
    expect(root.querySelector('.badge-success')).toBeNull();
    const resume = root.querySelector<HTMLButtonElement>(
      '[aria-label="Resume codex session"]',
    )!;
    expect(row.contains(resume)).toBe(true);
    expect(toggle.contains(resume)).toBe(false);
    expect(root.querySelector('ptah-cli-lane-usage-summary')).toBeNull();
    toggle.click();
    fixture.detectChanges();
    const details = root.querySelector<HTMLElement>(
      '#cli-lane-details-lane-1',
    )!;
    expect(details.textContent).not.toContain('Model:');
    expect(details.textContent).toMatch(/Status:\s*Completed/);
    expect(details.textContent).toMatch(/Task:\s*Inspect files/);
    expect(details.textContent).toMatch(/CLI session:\s*cli-123/);
    expect(details.textContent).toMatch(/Parent:\s*parent-456/);
    expect(details.textContent).not.toContain('ctx ');
  });

  it('shows Stop while running and omits unknown token totals', () => {
    const fixture = TestBed.createComponent(AgentCardComponent);
    fixture.componentRef.setInput(
      'agent',
      lane({ status: 'running', usageTotals: null, completedAt: undefined }),
    );
    fixture.componentRef.setInput('presentation', 'flat');
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[aria-label="Stop codex"]')).not.toBeNull();
    expect(
      root.querySelector('[aria-label="Resume codex session"]'),
    ).toBeNull();
    expect(metaText(root)).not.toContain('tokens');
  });

  it.each([
    ['failed', 'Failed'],
    ['timeout', 'Timed out'],
    ['stopped', 'Stopped'],
  ] as const)(
    'shows %s as warning metadata and in details',
    (status, label) => {
      const fixture = TestBed.createComponent(AgentCardComponent);
      fixture.componentRef.setInput('agent', lane({ status }));
      fixture.componentRef.setInput('presentation', 'flat');
      fixture.detectChanges();
      const root: HTMLElement = fixture.nativeElement;
      expect(metaText(root)).toContain(label);
      expect(
        root.querySelector('[data-test="execution-header-meta"]')?.className,
      ).toContain('!text-warning');
      detailsToggle(root).click();
      fixture.detectChanges();
      expect(
        root.querySelector('#cli-lane-details-lane-1')?.textContent,
      ).toMatch(new RegExp(`Status:\\s*${label}`));
    },
  );

  it('keeps a guard reason beside a stopped status', () => {
    const fixture = TestBed.createComponent(AgentCardComponent);
    fixture.componentRef.setInput(
      'agent',
      lane({ status: 'stopped', stopReason: 'tool-call-budget' }),
    );
    fixture.componentRef.setInput('presentation', 'flat');
    fixture.detectChanges();
    const label = metaText(fixture.nativeElement);
    expect(label).toContain('Stopped');
    expect(label).toContain('Stopped: tool-call limit reached');
  });

  it.each([{ totalTokens: 0 }, { inputTokens: 0, outputTokens: 0 }])(
    'omits zero token metadata',
    (usageTotals) => {
      const fixture = TestBed.createComponent(AgentCardComponent);
      fixture.componentRef.setInput('agent', lane({ usageTotals }));
      fixture.componentRef.setInput('presentation', 'flat');
      fixture.detectChanges();
      expect(metaText(fixture.nativeElement)).not.toContain('tokens');
    },
  );

  it('shows an exact reported total without the partial prefix', () => {
    const fixture = TestBed.createComponent(AgentCardComponent);
    fixture.componentRef.setInput(
      'agent',
      lane({
        usageTotals: { inputTokens: 1200, outputTokens: 80, totalTokens: 1280 },
      }),
    );
    fixture.componentRef.setInput('presentation', 'flat');
    fixture.detectChanges();
    expect(
      fixture.nativeElement
        .querySelector('[data-testid="lane-stats-tokens"]')
        ?.textContent?.trim(),
    ).toBe('1.3k');
  });

  it('builds no lane tree of its own in either presentation', () => {
    const treeBuilderFactory = jest.fn(() => ({
      buildTreeFromSegments: jest.fn(() => []),
    }));
    TestBed.overrideProvider(AgentMonitorTreeBuilderService, {
      useFactory: treeBuilderFactory,
    });
    const fixture = TestBed.createComponent(AgentCardComponent);
    fixture.componentRef.setInput('agent', lane());
    fixture.detectChanges();
    expect(treeBuilderFactory).not.toHaveBeenCalled();
    fixture.componentRef.setInput('presentation', 'flat');
    fixture.detectChanges();
    // The header no longer counts tools, so only the output builds a tree.
    expect(treeBuilderFactory).not.toHaveBeenCalled();
  });

  it('marks segment totals as partial and displays a guard stop reason', () => {
    const fixture = TestBed.createComponent(AgentCardComponent);
    fixture.componentRef.setInput(
      'agent',
      lane({
        usageTotals: null,
        stopReason: 'tool-call-budget',
        segments: [
          {
            type: 'info',
            content: '',
            usage: { inputTokens: 1200, outputTokens: 80 },
          },
        ],
      }),
    );
    fixture.componentRef.setInput('presentation', 'flat');
    fixture.detectChanges();
    const meta = metaText(fixture.nativeElement);
    expect(meta).not.toContain('tokens');
    expect(
      fixture.nativeElement.querySelector('[data-testid="lane-stats-tokens"]')
        ?.textContent,
    ).toContain('≥ 1.3k');
    expect(meta).toContain('Stopped: tool-call limit reached');
    expect(
      fixture.nativeElement.querySelector('[data-test="execution-header-meta"]')
        ?.className,
    ).toContain('!text-warning');
  });
});
