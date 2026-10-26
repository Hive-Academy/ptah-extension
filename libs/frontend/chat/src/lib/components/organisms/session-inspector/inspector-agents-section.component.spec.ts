import { TestBed } from '@angular/core/testing';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import {
  SessionInspectorStore,
  type InspectorRequest,
} from '../../../services/session-inspector';
import { signal } from '@angular/core';
import { ModelStateService } from '@ptah-extension/core';
import { SessionAgentTrayService } from '../../../services/session-agents/session-agent-tray.service';
import type { SessionAgent } from '../../../services/session-agents/session-agent-roster';
import { InspectorAgentsSectionComponent } from './inspector-agents-section.component';
import { agentRunLabel, formatAgentDuration } from '@ptah-extension/chat-ui';

function agent(usageTotals?: SessionAgent['usageTotals']): SessionAgent {
  return {
    key: 'cli:lane-1',
    kind: 'cli',
    name: 'Codex',
    cliId: 'codex',
    agentType: null,
    status: 'done',
    startedAt: 1000,
    endedAt: 6000,
    activity: 'Reading files',
    openRequestIds: [],
    usageTotals,
  };
}

describe('inspector CLI usage badges', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [InspectorAgentsSectionComponent],
      providers: [
        {
          provide: AgentMonitorStore,
          useValue: { subagents: signal(new Map()), agents: signal([]) },
        },
        {
          provide: SessionInspectorStore,
          useValue: { answerMissed: () => false, clearAnswerMiss: jest.fn() },
        },
        {
          provide: SessionAgentTrayService,
          useValue: {
            contextsFor: () => new Map(),
            extrasFor: () => new Map(),
          },
        },
        {
          provide: ModelStateService,
          useValue: { availableModels: signal([]) },
        },
      ],
    });
  });

  function render(row: SessionAgent): HTMLElement {
    const fixture = TestBed.createComponent(InspectorAgentsSectionComponent);
    fixture.componentRef.setInput('tabId', 'tab-1');
    fixture.componentRef.setInput('selectedAgentKey', row.key);
    fixture.componentRef.setInput('agents', {
      status: 'ready',
      data: { rows: [{ agent: row, requests: [] }], active: 0, finished: 1 },
    });
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders known token, cost, and duration badges', () => {
    const el = render(
      agent({ inputTokens: 1200, outputTokens: 300, costUsd: 0.25 }),
    );
    expect(el.querySelector('ptah-token-badge')?.textContent).toContain(
      '1.5k tokens',
    );
    expect(
      el.querySelector('[title="Reported or estimated cost"]')?.textContent,
    ).toContain('~$0.25 est.');
    expect(el.querySelector('ptah-cost-badge')).toBeNull();
    expect(
      el.querySelector('[title="Elapsed duration"]')?.textContent,
    ).toContain('5s');
    expect(el.textContent).toContain('CLI lane');
  });

  it('uses reported total tokens when only the total is available', () => {
    const el = render(agent({ totalTokens: 2400 }));
    expect(el.querySelector('ptah-token-badge')?.textContent).toContain(
      '2.4k tokens',
    );
  });

  it('sums input and output tokens when a total is unavailable', () => {
    const el = render(agent({ inputTokens: 1200, outputTokens: 300 }));
    expect(el.querySelector('ptah-token-badge')?.textContent).toContain(
      '1.5k tokens',
    );
  });

  it('omits the token badge when only input tokens are available', () => {
    const el = render(agent({ inputTokens: 1200 }));
    expect(el.querySelector('ptah-token-badge')).toBeNull();
  });

  it('preserves a measured zero token total', () => {
    const el = render(
      agent({ totalTokens: 0, inputTokens: 1200, outputTokens: 300 }),
    );
    expect(el.querySelector('ptah-token-badge')?.textContent).toContain(
      '0 tokens',
    );
  });

  it('omits token and cost badges when usage is absent', () => {
    const el = render(agent());
    expect(el.querySelector('ptah-token-badge')).toBeNull();
    expect(el.querySelector('[title="Reported or estimated cost"]')).toBeNull();
  });

  it('omits partial badges when totals are null and no usage segments exist', () => {
    const el = render({ ...agent(null), segments: [] });
    expect(el.querySelector('ptah-token-badge')).toBeNull();
    expect(el.querySelector('[title="Reported or estimated cost"]')).toBeNull();
    expect(
      el.querySelector('[title="From retained output, may be partial"]'),
    ).toBeNull();
    expect(el.textContent).not.toContain('≥');
  });

  it('uses segment usage and the lane duration text for a restored CLI lane', () => {
    const row = {
      ...agent(null),
      startedAt: 0,
      endedAt: (67 * 60 + 14) * 60_000,
      segments: [
        {
          type: 'info' as const,
          content: '',
          usage: { inputTokens: 11_900, outputTokens: 56, costUsd: 0.15 },
        },
      ],
    };
    const el = render(row);
    expect(
      el.querySelector('[title="From retained output, may be partial"]')
        ?.textContent,
    ).toContain('≥ 12.0k tokens');
    expect(
      el
        .querySelector('[title="From retained output, may be partial"]')
        ?.getAttribute('aria-label'),
    ).toBe('at least 12.0k tokens');
    expect(
      Array.from(
        el.querySelectorAll('[title="From retained output, may be partial"]'),
      ).some((badge) => badge.textContent?.includes('≥ ~$0.15 est.')),
    ).toBe(true);
    expect(
      el.querySelector('[title="Elapsed duration"]')?.textContent,
    ).toContain('67h 14m');
    expect(
      el.querySelector('[data-agent-key]')?.getAttribute('aria-label'),
    ).toContain('67h 14m');
  });

  it('keeps structured totals unmarked and formats CLI duration like the lane', () => {
    const row = {
      ...agent({ totalTokens: 65, costUsd: 0.01 }),
      startedAt: 0,
      endedAt: 65_000,
    };
    const el = render(row);
    expect(el.querySelector('ptah-token-badge')?.textContent).toContain(
      '65 tokens',
    );
    expect(
      el.querySelector('[title="Reported or estimated cost"]')?.textContent,
    ).toContain('~$0.01 est.');
    expect(el.textContent).not.toContain('≥');
    expect(
      el.querySelector('[title="Elapsed duration"]')?.textContent,
    ).toContain(formatAgentDuration(65_000));
    expect(
      el.querySelector('[data-agent-key]')?.getAttribute('aria-label'),
    ).toContain(formatAgentDuration(65_000));
  });

  it('restored CLI lane without end time shows Worked, not lane age', () => {
    const el = render({ ...agent(), startedAt: 1_000, endedAt: null });
    expect(el.querySelector('[title="Elapsed duration"]')).toBeNull();
    expect(agentRunLabel({ running: false, startedAt: 1_000 }, 1_000_000)).toBe(
      'Worked',
    );
    expect(
      el.querySelector('[data-agent-key]')?.getAttribute('aria-label'),
    ).not.toContain('999s');
  });
  it('shows only running and waiting rows, with a single unknown usage dash', () => {
    const fixture = TestBed.createComponent(InspectorAgentsSectionComponent);
    fixture.componentRef.setInput('tabId', 'tab-1');
    fixture.componentRef.setInput('agents', {
      status: 'ready',
      data: {
        rows: ['running', 'waiting', 'queued', 'done', 'failed', 'stopped'].map(
          (status) => ({
            agent: { ...agent(), key: status, status },
            requests: [],
          }),
        ),
        active: 2,
        finished: 3,
      },
    });
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(
      Array.from(el.querySelectorAll('[data-agent-key]')).map((row) =>
        row.getAttribute('data-agent-key'),
      ),
    ).toEqual(['running', 'waiting']);
    expect(
      el
        .querySelector('[data-testid="agent-compact-usage"]')
        ?.textContent?.trim(),
    ).toBe('—');
    expect(
      el
        .querySelector('[data-testid="agent-compact-usage"]')
        ?.getAttribute('aria-label'),
    ).toBe('Tokens unavailable; Cost unavailable');
    expect(el.textContent).not.toContain('No active subagents');
    expect(el.querySelector('.overflow-y-auto')).toBeNull();
  });

  it.each([
    {
      usage: { totalTokens: 12_000, costUsd: 0.1 },
      expected: '12.0k · ~$0.10 est.',
    },
    { usage: { totalTokens: 12_000 }, expected: '12.0k' },
    { usage: { costUsd: 0.1 }, expected: '~$0.10 est.' },
  ])('renders known compact usage as $expected', ({ usage, expected }) => {
    const el = render({ ...agent(usage), status: 'running' });
    expect(
      el
        .querySelector('[data-testid="agent-compact-usage"]')
        ?.textContent?.trim(),
    ).toBe(expected);
  });

  it.each([
    { usage: { inputTokens: 11_900, outputTokens: 100 }, expected: '≥ 12.0k' },
    {
      usage: { inputTokens: 11_900, outputTokens: 100, costUsd: 0.1 },
      expected: '≥ 12.0k · ≥ ~$0.10 est.',
    },
  ])('preserves partial compact usage as $expected', ({ usage, expected }) => {
    const el = render({
      ...agent(null),
      status: 'running',
      segments: [{ type: 'info', content: '', usage }],
    });
    expect(
      el
        .querySelector('[data-testid="agent-compact-usage"]')
        ?.textContent?.trim(),
    ).toBe(expected);
  });

  it('shows the one-line empty state and exposes a selected finished agent', () => {
    const fixture = TestBed.createComponent(InspectorAgentsSectionComponent);
    fixture.componentRef.setInput('tabId', 'tab-1');
    fixture.componentRef.setInput('agents', {
      status: 'ready',
      data: {
        rows: [{ agent: agent(), requests: [] }],
        active: 0,
        finished: 1,
      },
    });
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('No active subagents');
    expect(el.querySelector('[data-agent-key]')).toBeNull();
    fixture.componentRef.setInput('selectedAgentKey', 'cli:lane-1');
    fixture.detectChanges();
    expect(el.querySelector('[data-agent-key="cli:lane-1"]')).not.toBeNull();
    expect(
      el.querySelector('[title="Elapsed duration"]')?.textContent,
    ).toContain('5s');
  });

  it('keeps a finished agent with a pending question visible and forwards its answer', () => {
    const request: InspectorRequest = {
      requestId: 'question-1',
      kind: 'question',
      source: 'lane',
      ownerKey: 'cli:lane-1',
      ownerName: 'Codex',
      agentId: 'lane-1',
      toolName: null,
      command: 'Choose a file',
      questionPreview: 'Choose a file',
      timestamp: 1000,
    };
    const fixture = TestBed.createComponent(InspectorAgentsSectionComponent);
    fixture.componentRef.setInput('tabId', 'tab-1');
    fixture.componentRef.setInput('agents', {
      status: 'ready',
      data: {
        rows: [{ agent: agent(), requests: [request] }],
        active: 0,
        finished: 1,
      },
    });
    const answered = jest.fn();
    fixture.componentInstance.answerRequested.subscribe(answered);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-agent-key="cli:lane-1"]')).not.toBeNull();
    const requestButton = el.querySelector<HTMLButtonElement>(
      '[data-request-button]',
    );
    expect(requestButton).not.toBeNull();
    requestButton?.click();
    expect(answered).toHaveBeenCalledWith('question-1');
  });
  it('reuses subagent lane usage for selected historical context, tokens and model', () => {
    TestBed.overrideProvider(AgentMonitorStore, {
      useValue: {
        agents: signal([]),
        subagents: signal(
          new Map([
            [
              'tool-1',
              {
                parentToolUseId: 'tool-1',
                status: 'completed',
                startedAt: 1000,
                completedAt: 6000,
                totalTokens: 2400,
                usage: { input: 1200, output: 300, model: 'test-model' },
              },
            ],
          ]),
        ),
      },
    });
    const fixture = TestBed.createComponent(InspectorAgentsSectionComponent);
    fixture.componentRef.setInput('tabId', 'tab-1');
    fixture.componentRef.setInput('selectedAgentKey', 'sub:tool-1');
    fixture.componentRef.setInput('agents', {
      status: 'ready',
      data: {
        rows: [
          {
            agent: {
              ...agent(),
              key: 'sub:tool-1',
              kind: 'subagent',
              cliId: null,
            },
            requests: [],
          },
        ],
        active: 0,
        finished: 1,
      },
    });
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(
      el.querySelector('[data-testid="lane-stats-tokens"]')?.textContent,
    ).toContain('2.4k');
    expect(
      el.querySelector('[data-testid="lane-stats-model"]')?.textContent,
    ).toContain('test-model');
    expect(
      el.querySelector('[data-testid="lane-stats-context"]'),
    ).not.toBeNull();
    fixture.componentRef.setInput('selectedAgentKey', null);
    fixture.detectChanges();
    expect(el.querySelector('[data-agent-key]')).toBeNull();
  });
});
