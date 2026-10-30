import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import { ModelStateService, WallClockService } from '@ptah-extension/core';
import {
  SessionInspectorStore,
  type InspectorRequest,
  type OrchestratorCardModel,
} from '../../../services/session-inspector';
import { SessionAgentTrayService } from '../../../services/session-agents/session-agent-tray.service';
import { SessionAgentRosterService } from '../../../services/session-agents/session-agent-roster.service';
import type { SessionAgent } from '../../../services/session-agents/session-agent-roster';
import { InspectorAgentsSectionComponent } from './inspector-agents-section.component';

function agent(
  overrides: Partial<SessionAgent> = {},
  usageTotals?: SessionAgent['usageTotals'],
): SessionAgent {
  return {
    key: 'cli:lane-1',
    kind: 'cli',
    name: 'Codex',
    cliId: 'codex',
    agentType: null,
    status: 'done',
    startedAt: 1000,
    endedAt: 6000,
    activity: 'Usage: 2284653 input, 19323 output tokens',
    openRequestIds: [],
    usageTotals,
    ...overrides,
  };
}

const ORCHESTRATOR: SessionAgent = agent({
  key: 'orchestrator',
  kind: 'orchestrator',
  name: 'Orchestrator',
  cliId: null,
  status: 'done',
  startedAt: null,
  endedAt: null,
  activity: null,
});

const CARD: OrchestratorCardModel = {
  model: 'claude-opus-5-5',
  state: { kind: 'idle' },
  contextPercent: 42,
  contextWindow: 200_000,
  tokens: 1_100_000,
  cost: 0.8,
  turns: 14,
  requests: [],
};

describe('InspectorAgentsSectionComponent (B+ agents list)', () => {
  const fixedNow = signal(10_000);

  beforeEach(() => {
    fixedNow.set(10_000);
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
            focus: jest.fn(),
          },
        },
        {
          provide: SessionAgentRosterService,
          useValue: { roster: () => [ORCHESTRATOR] },
        },
        {
          provide: ModelStateService,
          useValue: {
            availableModels: signal([
              { id: 'claude-opus-5-5', name: 'Opus 5.5' },
            ]),
          },
        },
        {
          provide: WallClockService,
          useValue: { now: () => fixedNow, acquire: () => () => undefined },
        },
      ],
    });
  });

  function mount(
    rows: readonly SessionAgent[],
    options: {
      selected?: string | null;
      requests?: Record<string, InspectorRequest[]>;
      laneSurface?: boolean;
    } = {},
  ): ComponentFixture<InspectorAgentsSectionComponent> {
    const fixture = TestBed.createComponent(InspectorAgentsSectionComponent);
    fixture.componentRef.setInput('tabId', 'tab-1');
    fixture.componentRef.setInput('orchestrator', CARD);
    fixture.componentRef.setInput('sessionTokens', {
      input: 1_050_000,
      output: 48_000,
    });
    fixture.componentRef.setInput(
      'hasLaneSurface',
      options.laneSurface ?? false,
    );
    if (options.selected !== undefined) {
      fixture.componentRef.setInput('selectedAgentKey', options.selected);
    }
    fixture.componentRef.setInput('agents', {
      status: 'ready',
      data: {
        rows: rows.map((row) => ({
          agent: row,
          requests: options.requests?.[row.key] ?? [],
        })),
        active: 0,
        finished: 0,
      },
    });
    fixture.detectChanges();
    return fixture;
  }

  const keys = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('[data-agent-key]')).map((row) =>
      row.getAttribute('data-agent-key'),
    );

  it('lists every agent with running first, then the Orchestrator, then the rest', () => {
    const el: HTMLElement = mount([
      agent({ key: 'cli:done', status: 'done' }),
      agent({ key: 'cli:run', status: 'running', endedAt: null }),
      agent({ key: 'cli:failed', status: 'failed' }),
    ]).nativeElement;
    expect(keys(el)).toEqual([
      'cli:run',
      'orchestrator',
      'cli:done',
      'cli:failed',
    ]);
    expect(el.querySelector('h3')?.textContent?.trim()).toBe('AGENTS');
    expect(
      el.querySelector('[data-testid="agents-count"]')?.textContent?.trim(),
    ).toBe('1 running · 4');
    expect(el.textContent).not.toContain('ACTIVE SUBAGENTS');
    expect(el.textContent).not.toContain('Usage: 2284653');
  });

  it('shows provider avatar, type line, status ink and compact tokens and cost', () => {
    const el: HTMLElement = mount([
      agent(
        {},
        { inputTokens: 2_284_653, outputTokens: 19_323, costUsd: 0.25 },
      ),
    ]).nativeElement;
    const row = el.querySelector(
      '[data-agent-key="cli:lane-1"]',
    ) as HTMLElement;
    expect(row.querySelector('ptah-agent-avatar')).not.toBeNull();
    expect(row.textContent).toContain('CLI lane');
    const status = Array.from(row.querySelectorAll('span')).find(
      (span) => span.textContent?.trim() === 'done',
    );
    expect(status?.classList.contains('text-state-done')).toBe(true);
    expect(
      row
        .querySelector('[data-testid="agent-row-tokens"]')
        ?.textContent?.trim(),
    ).toBe('2.3M');
    expect(
      row.querySelector('[data-testid="agent-row-cost"]')?.textContent?.trim(),
    ).toBe('~$0.25');
    const orchestrator = el.querySelector(
      '[data-agent-key="orchestrator"]',
    ) as HTMLElement;
    expect(orchestrator.textContent).toContain('Opus 5.5');
    expect(
      orchestrator
        .querySelector('[data-testid="agent-row-cost"]')
        ?.textContent?.trim(),
    ).toBe('$0.80');
  });

  it('renders an unknown figure as a quiet dash with a not-reported tooltip', () => {
    const el: HTMLElement = mount([agent()]).nativeElement;
    const tokens = el.querySelector(
      '[data-agent-key="cli:lane-1"] [data-testid="agent-row-tokens"]',
    ) as HTMLElement;
    expect(tokens.textContent?.trim()).toBe('—');
    expect(tokens.getAttribute('title')).toBe('not reported');
    expect(tokens.classList.contains('text-base-content-muted')).toBe(true);
  });

  it('keeps unknown Orchestrator token data as a dash', () => {
    const fixture = mount([]);
    fixture.componentRef.setInput('orchestrator', null);
    fixture.componentRef.setInput('sessionTokens', null);
    fixture.detectChanges();
    const tokens = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-agent-key="orchestrator"] [data-testid="agent-row-tokens"]',
    );
    expect(tokens?.textContent?.trim()).toBe('—');
    expect(tokens?.getAttribute('title')).toBe('not reported');
  });

  it('acquires the shared clock only while an agent runs and advances elapsed time', () => {
    jest.useFakeTimers({
      doNotFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
    }).setSystemTime(10_000);
    try {
      TestBed.overrideProvider(WallClockService, {
        useFactory: () => new WallClockService(),
        deps: [],
      });
      const clock = TestBed.inject(WallClockService);
      const setIntervalSpy = jest.spyOn(globalThis, 'setInterval');
      const clearIntervalSpy = jest.spyOn(globalThis, 'clearInterval');
      const realAcquire = clock.acquire.bind(clock);
      let clockInterval: ReturnType<typeof setInterval> | undefined;
      let release: jest.Mock | undefined;
      const acquire = jest.spyOn(clock, 'acquire').mockImplementation((cadence) => {
        const previous = setIntervalSpy.mock.results.length;
        release = jest.fn(realAcquire(cadence));
        const created = setIntervalSpy.mock.results.slice(previous);
        expect(created).toHaveLength(1);
        clockInterval = created[0].value;
        return release;
      });

      const fixture = mount([]);
      TestBed.tick();
      expect(acquire).not.toHaveBeenCalled();

      const running = agent({ status: 'running', startedAt: 1_000, endedAt: null });
      fixture.componentRef.setInput('agents', {
        status: 'ready',
        data: { rows: [{ agent: running, requests: [] }], active: 1, finished: 0 },
      });
      fixture.detectChanges();
      TestBed.tick();
      expect(acquire).toHaveBeenCalledWith('second');
      const row = () => (fixture.nativeElement as HTMLElement).querySelector(
        '[data-agent-key="cli:lane-1"]',
      );
      expect(row()?.getAttribute('aria-label')).toContain('running 9s');

      jest.advanceTimersByTime(1_000);
      TestBed.tick();
      fixture.detectChanges();
      expect(row()?.getAttribute('aria-label')).toContain('running 10s');

      fixture.componentRef.setInput('agents', {
        status: 'ready',
        data: {
          rows: [{ agent: { ...running, status: 'done', endedAt: 11_000 }, requests: [] }],
          active: 0,
          finished: 1,
        },
      });
      fixture.detectChanges();
      TestBed.tick();
      expect(release).toHaveBeenCalledTimes(1);
      expect(clearIntervalSpy).toHaveBeenCalledWith(clockInterval);
      fixture.destroy();
    } finally {
      jest.restoreAllMocks();
      jest.useRealTimers();
    }
  });

  it('marks partial usage from retained segments as a lower bound', () => {
    const el: HTMLElement = mount([
      agent({
        usageTotals: null,
        segments: [
          {
            type: 'info',
            content: '',
            usage: { inputTokens: 11_900, outputTokens: 100, costUsd: 0.1 },
          },
        ],
      }),
    ]).nativeElement;
    const row = el.querySelector(
      '[data-agent-key="cli:lane-1"]',
    ) as HTMLElement;
    expect(
      row
        .querySelector('[data-testid="agent-row-tokens"]')
        ?.textContent?.trim(),
    ).toBe('≥ 12.0k');
    expect(
      row.querySelector('[data-testid="agent-row-cost"]')?.textContent?.trim(),
    ).toBe('≥ ~$0.10');
  });

  it('marks the Orchestrator row as selected by default with its in / out tooltip', () => {
    const el: HTMLElement = mount([agent()]).nativeElement;
    const button = el.querySelector(
      '[data-agent-key="orchestrator"]',
    ) as HTMLElement;
    expect(button.closest('li')?.getAttribute('aria-current')).toBe('true');
    expect(button.hasAttribute('aria-expanded')).toBe(false);
    expect(
      button
        .querySelector('[data-testid="agent-row-tokens"]')
        ?.getAttribute('title'),
    ).toBe('In 1.1M · Out 48.0k');
    expect(el.textContent).not.toContain('Open thread');
  });

  it('selects one row at a time and opens its thread on click', () => {
    const fixture = mount(
      [agent({}, { inputTokens: 1200, outputTokens: 300 })],
      {
        laneSurface: true,
      },
    );
    const selected = jest.fn();
    const lane = jest.fn();
    fixture.componentInstance.agentSelected.subscribe(selected);
    fixture.componentInstance.laneRequested.subscribe(lane);
    const el: HTMLElement = fixture.nativeElement;
    const row = el.querySelector<HTMLButtonElement>(
      '[data-agent-key="cli:lane-1"]',
    )!;
    row.click();
    fixture.detectChanges();
    expect(selected).toHaveBeenCalledWith('cli:lane-1');
    expect(lane).toHaveBeenCalledWith('cli:lane-1');
    expect(row.closest('li')?.getAttribute('aria-current')).toBe('true');
    expect(
      el
        .querySelector('[data-agent-key="orchestrator"]')
        ?.closest('li')
        ?.getAttribute('aria-current'),
    ).toBeNull();
    expect(
      row
        .querySelector('[data-testid="agent-row-tokens"]')
        ?.getAttribute('title'),
    ).toBe('In 1.2k · Out 300');
    row.click();
    expect(selected).toHaveBeenCalledTimes(1);
    expect(lane).toHaveBeenCalledTimes(2);
  });

  it('selects the Orchestrator without a thread request when no lane surface exists', () => {
    const fixture = mount([agent()], { selected: 'cli:lane-1' });
    const lane = jest.fn();
    fixture.componentInstance.laneRequested.subscribe(lane);
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-agent-key="orchestrator"]')!
      .click();
    expect(lane).not.toHaveBeenCalled();
  });

  it('follows the host selection and reports a key that left the roster', () => {
    const fixture = mount(
      [agent({ key: 'bg:tool-1', kind: 'background', cliId: null })],
      {
        selected: 'sub:tool-1',
      },
    );
    const selected = jest.fn();
    fixture.componentInstance.agentSelected.subscribe(selected);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(
      el
        .querySelector('[data-agent-key="bg:tool-1"]')
        ?.closest('li')
        ?.getAttribute('aria-current'),
    ).toBe('true');
    fixture.componentRef.setInput('selectedAgentKey', 'cli:gone');
    fixture.detectChanges();
    expect(selected).toHaveBeenCalledWith('orchestrator');
  });

  it('shows six rows, then expands in place with "Show N more"', () => {
    const rows = Array.from({ length: 9 }, (_, i) =>
      agent({ key: `cli:l${i}`, name: `Lane ${i}` }),
    );
    const fixture = mount(rows);
    const el: HTMLElement = fixture.nativeElement;
    expect(keys(el)).toHaveLength(6);
    const toggle = el.querySelector<HTMLButtonElement>(
      '[data-testid="agents-show-more"]',
    )!;
    expect(toggle.textContent?.trim()).toBe('Show 4 more');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    fixture.detectChanges();
    expect(keys(el)).toHaveLength(10);
    expect(toggle.textContent?.trim()).toBe('Show fewer');
  });

  it('keeps a selected row below the fold visible', () => {
    const rows = Array.from({ length: 9 }, (_, i) =>
      agent({ key: `cli:l${i}`, name: `Lane ${i}` }),
    );
    const el: HTMLElement = mount(rows, { selected: 'cli:l8' }).nativeElement;
    expect(keys(el)).toContain('cli:l8');
    expect(
      el.querySelector('[data-testid="agents-show-more"]')?.textContent?.trim(),
    ).toBe('Show 3 more');
  });

  it('keeps a finished agent with a pending question on its row and forwards the answer', () => {
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
    const fixture = mount([agent()], { requests: { 'cli:lane-1': [request] } });
    const answered = jest.fn();
    fixture.componentInstance.answerRequested.subscribe(answered);
    const el: HTMLElement = fixture.nativeElement;
    expect(keys(el)[0]).toBe('cli:lane-1');
    el.querySelector<HTMLButtonElement>('[data-request-button]')?.click();
    expect(answered).toHaveBeenCalledWith('question-1');
  });

  it('reuses sub-agent lane usage for tokens, the in / out tooltip and the model', () => {
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
    const el: HTMLElement = mount(
      [
        agent({
          key: 'sub:tool-1',
          kind: 'subagent',
          cliId: null,
          name: 'Explore',
        }),
      ],
      { selected: 'sub:tool-1' },
    ).nativeElement;
    const row = el.querySelector(
      '[data-agent-key="sub:tool-1"]',
    ) as HTMLElement;
    expect(
      row
        .querySelector('[data-testid="agent-row-tokens"]')
        ?.textContent?.trim(),
    ).toBe('2.4k');
    expect(
      row.querySelector('[data-testid="agent-row-model"]')?.textContent?.trim(),
    ).toBe('test-model');
    expect(
      row
        .querySelector('[data-testid="agent-row-model"]')
        ?.getAttribute('title'),
    ).toBe('Sub-agent · test-model');
    expect(row.getAttribute('aria-label')).toContain(
      'Model test-model. 2.4k tokens (In 1.2k · Out 300)',
    );
    expect(
      row
        .querySelector('[data-testid="agent-row-tokens"]')
        ?.getAttribute('title'),
    ).toBe('In 1.2k · Out 300');
  });

  it('keeps sub-agent usage after the sub-agent moves to the background', () => {
    TestBed.overrideProvider(AgentMonitorStore, {
      useValue: {
        agents: signal([]),
        subagents: signal(
          new Map([
            [
              'tool-1',
              {
                parentToolUseId: 'tool-1',
                status: 'background',
                startedAt: 1000,
                totalTokens: 2400,
                usage: { input: 1200, output: 300, model: 'test-model' },
              },
            ],
          ]),
        ),
      },
    });
    const el: HTMLElement = mount(
      [
        agent({
          key: 'bg:tool-1',
          kind: 'background',
          cliId: null,
          name: 'Explore',
          status: 'running',
          endedAt: null,
        }),
      ],
      { selected: 'bg:tool-1' },
    ).nativeElement;
    const row = el.querySelector('[data-agent-key="bg:tool-1"]') as HTMLElement;
    expect(
      row
        .querySelector('[data-testid="agent-row-tokens"]')
        ?.textContent?.trim(),
    ).toBe('2.4k');
    expect(
      row
        .querySelector('[data-testid="agent-row-tokens"]')
        ?.getAttribute('title'),
    ).toBe('In 1.2k · Out 300');
  });

  it('shows no "Show more" when the selected seventh row makes every row visible', () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      agent({ key: `cli:l${i}`, name: `Lane ${i}` }),
    );
    const el: HTMLElement = mount(rows, { selected: 'cli:l5' }).nativeElement;
    expect(keys(el)).toHaveLength(7);
    expect(el.querySelector('[data-testid="agents-show-more"]')).toBeNull();
  });
});
