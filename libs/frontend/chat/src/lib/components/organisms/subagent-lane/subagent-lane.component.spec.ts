import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  AgentMonitorStore,
  SubagentExecutionStore,
  type SubagentExecutionEntry,
  type SubagentRecord,
} from '@ptah-extension/chat-streaming';
import { SURFACE_ACTIVE } from '@ptah-extension/core';
import { provideMarkdown } from 'ngx-markdown';
import type { TrayAgentContext } from '../../../services/session-agents/session-agent-tray';
import { SessionAgentTrayService } from '../../../services/session-agents/session-agent-tray.service';
import { SubagentUsageSummaryComponent } from '../../molecules/agent-card/subagent-usage-summary.component';
import { SubagentLaneComponent } from './subagent-lane.component';

describe('SubagentLaneComponent', () => {
  const contexts = signal<ReadonlyMap<string, TrayAgentContext>>(new Map());
  const rpcError =
    signal<ReturnType<AgentMonitorStore['subagentRpcError']>>(null);
  const tick = signal(0);
  const steer = jest.fn<Promise<boolean>, [TrayAgentContext, string]>();
  const stop = jest.fn<Promise<void>, [string, string]>();
  const sendToBackground = jest.fn<Promise<boolean>, [string, string]>();
  const entries = signal<ReadonlyMap<string, SubagentExecutionEntry>>(
    new Map(),
  );
  const treeFor = jest.fn(() => []);
  const retain = jest.fn();
  const release = jest.fn();
  const syncRecord = jest.fn();
  const ensureHistory = jest
    .fn<Promise<void>, [string]>()
    .mockResolvedValue(undefined);
  function setEntry(changes: Partial<SubagentExecutionEntry> = {}): void {
    entries.set(
      new Map([
        [
          'tool-1',
          {
            state: null,
            finalized: [],
            sessionId: 'session-123456',
            live: true,
            truncated: false,
            spilled: false,
            clipped: 0,
            history: 'idle',
            generation: 0,
            lastEventAt: 0,
            refs: 0,
            idAlias: new Map(),
            revision: 0,
            ...changes,
          },
        ],
      ]),
    );
  }
  const base: SubagentRecord = {
    parentToolUseId: 'tool-1',
    parentSessionId: 'session-123456',
    teammateName: 'Explore',
    status: 'running',
    startedAt: 1000,
    description: 'Inspect files',
    toolUses: 4,
  };

  function context(
    flags: {
      canBackground?: boolean;
      stoppable?: boolean;
      steerable?: boolean;
    } = {},
  ): TrayAgentContext {
    return {
      entry: {
        id: 'tool-1',
        name: 'Explore',
        origin: 'foreground',
        status: 'running',
        canBackground: flags.canBackground ?? false,
        stoppable: flags.stoppable ?? false,
        steerable: flags.steerable ?? false,
        canViewTranscript: false,
      },
      taskId: 'task-1',
      sessionId: 'session-123456',
      model: null,
    };
  }

  function setup(
    record: SubagentRecord = base,
  ): ComponentFixture<SubagentLaneComponent> {
    const fixture = TestBed.createComponent(SubagentLaneComponent);
    fixture.componentRef.setInput('record', record);
    fixture.componentRef.setInput('sessionId', 'session-123456');
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    contexts.set(new Map());
    rpcError.set(null);
    steer.mockReset();
    stop.mockClear();
    sendToBackground.mockClear();
    treeFor.mockClear();
    retain.mockClear();
    release.mockClear();
    syncRecord.mockClear();
    ensureHistory.mockClear();
    setEntry();
    stop.mockResolvedValue(undefined);
    sendToBackground.mockResolvedValue(true);
    TestBed.configureTestingModule({
      imports: [SubagentLaneComponent],
      providers: [
        { provide: SURFACE_ACTIVE, useValue: signal(true) },
        provideMarkdown(),
        {
          provide: AgentMonitorStore,
          useValue: {
            tick,
            subagentRpcError: rpcError,
            stopAgent: stop,
            backgroundAgent: sendToBackground,
            loadSubagentCacheInfo: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: SubagentExecutionStore,
          useValue: {
            entries,
            entryFor: (key: string) => entries().get(key),
            revisionFor: () => entries(),
            treeFor,
            retain,
            release,
            syncRecord,
            ensureHistory,
          },
        },
        {
          provide: SessionAgentTrayService,
          useValue: { contextsFor: () => contexts(), steer },
        },
      ],
    });
    TestBed.overrideComponent(SubagentUsageSummaryComponent, {
      set: { template: '<span>Usage summary</span>' },
    });
  });

  it('uses the shared header, fallback counts, and details facts', () => {
    const fixture = setup({
      ...base,
      totalTokens: 1200,
      usage: { input: 1000, output: 200, model: 'claude-sonnet' },
    });
    const root: HTMLElement = fixture.nativeElement;
    const row = root.querySelector<HTMLButtonElement>(
      '[data-test="turn-disclosure-row"]',
    )!;
    expect(row.getAttribute('aria-label')).toContain('4 tools');
    expect(row.getAttribute('aria-label')).toContain('1.2k tokens');
    expect(
      root.querySelector('ptah-execution-header')?.getAttribute('data-kind'),
    ).toBe('subagent');
    expect(root.textContent).toContain('Starting agent');
    expect(root.querySelector('ptah-subagent-usage-summary')).toBeNull();
    row.click();
    fixture.detectChanges();
    const details = root.querySelector('#subagent-lane-details-tool-1')!;
    expect(details.textContent).toContain('Usage summary');
    expect(details.textContent).toMatch(/Model:\s*claude-sonnet/);
    expect(details.textContent).toMatch(/Task:\s*Inspect files/);
    expect(details.textContent).toMatch(/Parent:\s*session-/);
  });

  it('offers only the actions allowed by the tray context', () => {
    const ctx = context({
      canBackground: true,
      stoppable: true,
      steerable: true,
    });
    contexts.set(new Map([['tool-1', ctx]]));
    const fixture = setup();
    const root: HTMLElement = fixture.nativeElement;
    root
      .querySelector<HTMLButtonElement>(
        '[aria-label="Send Explore to background"]',
      )!
      .click();
    root
      .querySelector<HTMLButtonElement>('[aria-label="Stop Explore"]')!
      .click();
    root
      .querySelector<HTMLButtonElement>('[aria-label="Message Explore"]')!
      .click();
    fixture.detectChanges();
    expect(sendToBackground).toHaveBeenCalledWith('session-123456', 'tool-1');
    expect(stop).toHaveBeenCalledWith('task-1', 'session-123456');
    expect(root.querySelector('ptah-agent-steer-input')).not.toBeNull();
    contexts.set(new Map([['tool-1', context({ steerable: true })]]));
    fixture.detectChanges();
    expect(root.querySelector('[aria-label="Stop Explore"]')).toBeNull();
    expect(
      root.querySelector('[aria-label="Send Explore to background"]'),
    ).toBeNull();
  });

  it('shows no actions without tray context and no output when finished', () => {
    const fixture = setup({ ...base, status: 'completed', totalTokens: 0 });
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[executionHeaderActions]')).toBeNull();
    expect(
      root
        .querySelector('[data-test="turn-disclosure-row"]')
        ?.getAttribute('aria-label'),
    ).not.toContain('tokens');
    expect(root.textContent).toContain('No output recorded');
  });

  it('renders a finished agent summary without an empty message or duplicate agent header', async () => {
    const fixture = setup({ ...base, status: 'completed' });
    fixture.componentRef.setInput(
      'summaryContent',
      'Completed the investigation',
    );
    fixture.detectChanges();
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.textContent).toContain('Completed the investigation');
    expect(root.textContent).not.toContain('No output recorded');
    expect(root.querySelectorAll('ptah-execution-header')).toHaveLength(1);
  });

  it('shows the finished record summary when the parent tree is unavailable', async () => {
    const fixture = setup({
      ...base,
      status: 'completed',
      latestSummary: 'Investigation finished',
    });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain(
      'Investigation finished',
    );
    expect(fixture.nativeElement.textContent).not.toContain(
      'No output recorded',
    );
  });

  it('retains the store tree once and releases it on destroy', () => {
    const fixture = setup();
    expect(treeFor).toHaveBeenCalledWith('tool-1');
    expect(retain).toHaveBeenCalledTimes(1);
    fixture.destroy();
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith('tool-1');
  });

  it('does not release an active history load when the record object changes', () => {
    const fixture = setup();
    setEntry({ history: 'loading' });
    fixture.componentRef.setInput('record', { ...base, toolUses: 5 });
    fixture.detectChanges();
    expect(retain).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
  });

  it.each([
    ['loading', 'Loading saved output'],
    ['error', 'Could not load saved output'],
    ['not-found', 'No saved output for this agent'],
    ['unresolved', 'Saved output for this agent could not be linked'],
    ['loaded', 'No output recorded'],
  ] as const)('shows %s history state', (history, label) => {
    setEntry({ live: false, history });
    const fixture = setup({ ...base, status: 'completed' });
    expect(fixture.nativeElement.textContent).toContain(label);
    if (history === 'error' || history === 'unresolved') {
      (
        fixture.nativeElement.querySelector(
          'button.btn-link',
        ) as HTMLButtonElement
      ).click();
      expect(ensureHistory).toHaveBeenCalledWith('tool-1');
    }
  });

  it('loads idle saved output once and offers full output for trimmed trees', () => {
    setEntry({ live: false, history: 'idle', truncated: true, clipped: 1 });
    const fixture = setup({ ...base, status: 'completed' });
    expect(ensureHistory).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.textContent).toContain(
      'Earlier output trimmed',
    );
    expect(fixture.nativeElement.textContent).toContain(
      'Some long outputs were shortened',
    );
    (
      fixture.nativeElement.querySelector(
        'button.btn-link',
      ) as HTMLButtonElement
    ).click();
    expect(ensureHistory).toHaveBeenCalledTimes(2);
  });

  it('offers full output when the live tree was spilled', () => {
    setEntry({ live: false, history: 'idle', spilled: true });
    const fixture = setup({ ...base, status: 'completed' });
    expect(fixture.nativeElement.textContent).toContain(
      'Earlier output trimmed',
    );
    (
      fixture.nativeElement.querySelector(
        'button.btn-link',
      ) as HTMLButtonElement
    ).click();
    expect(ensureHistory).toHaveBeenCalledTimes(2);
  });

  it('disables Stop and Background during their requests and ignores repeated clicks', async () => {
    let finishStop!: () => void;
    let finishBackground!: (value: boolean) => void;
    stop.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishStop = resolve;
        }),
    );
    sendToBackground.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finishBackground = resolve;
        }),
    );
    contexts.set(
      new Map([['tool-1', context({ stoppable: true, canBackground: true })]]),
    );
    const fixture = setup();
    const root: HTMLElement = fixture.nativeElement;
    const stopButton = root.querySelector<HTMLButtonElement>(
      '[aria-label="Stop Explore"]',
    )!;
    const backgroundButton = root.querySelector<HTMLButtonElement>(
      '[aria-label="Send Explore to background"]',
    )!;
    stopButton.click();
    backgroundButton.click();
    fixture.detectChanges();
    expect(stopButton.disabled).toBe(true);
    expect(backgroundButton.disabled).toBe(true);
    stopButton.click();
    backgroundButton.click();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(sendToBackground).toHaveBeenCalledTimes(1);
    finishStop();
    finishBackground(true);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(stopButton.disabled).toBe(false);
    expect(backgroundButton.disabled).toBe(false);
  });

  it('shows background state and the latest progress in a live row', () => {
    const fixture = setup({
      ...base,
      status: 'background',
      latestSummary: 'Reviewing tests',
    });
    const row = fixture.nativeElement.querySelector(
      '[data-test="turn-disclosure-row"]',
    ) as HTMLButtonElement;
    const label = row.getAttribute('aria-label') as string;
    expect(label).toContain('Background');
    expect(
      row.querySelector('[data-test="turn-disclosure-peek"]')?.textContent,
    ).toBe('Reviewing tests');
    expect(label).not.toContain('Reviewing tests');
  });

  it('keeps the draft after a failed steer and closes it after success', async () => {
    contexts.set(new Map([['tool-1', context({ steerable: true })]]));
    steer.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const fixture = setup();
    const root: HTMLElement = fixture.nativeElement;
    root
      .querySelector<HTMLButtonElement>('[aria-label="Message Explore"]')!
      .click();
    fixture.detectChanges();
    const field = root.querySelector<HTMLInputElement>(
      'ptah-agent-steer-input input',
    )!;
    field.value = 'Check tests';
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    root
      .querySelector<HTMLButtonElement>('[aria-label="Send steer message"]')!
      .click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(steer).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1' }),
      'Check tests',
    );
    expect(root.textContent).toContain('Could not send your message');
    expect(
      root.querySelector<HTMLInputElement>('ptah-agent-steer-input input')
        ?.value,
    ).toBe('Check tests');
    root
      .querySelector<HTMLButtonElement>('[aria-label="Send steer message"]')!
      .click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('ptah-agent-steer-input')).toBeNull();
  });

  it('links the steer toggle to its input and restores focus on Escape', async () => {
    contexts.set(new Map([['tool-1', context({ steerable: true })]]));
    const fixture = setup();
    const root: HTMLElement = fixture.nativeElement;
    document.body.appendChild(root);
    try {
      const toggle = root.querySelector<HTMLButtonElement>(
        '[aria-label="Message Explore"]',
      )!;
      expect(toggle.getAttribute('aria-controls')).toBe(
        'subagent-steer-tool-1',
      );
      toggle.click();
      fixture.detectChanges();
      await fixture.whenStable();
      const input = root.querySelector<HTMLInputElement>(
        '#subagent-steer-tool-1 input',
      )!;
      expect(document.activeElement).toBe(input);
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      fixture.detectChanges();
      expect(root.querySelector('ptah-agent-steer-input')).toBeNull();
      expect(document.activeElement).toBe(toggle);
    } finally {
      root.remove();
    }
  });

  it('shows only this agent’s RPC error', () => {
    const fixture = setup();
    rpcError.set({
      parentToolUseId: 'other',
      method: 'subagent:stop',
      message: 'Other failed',
      timestamp: 1,
    });
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="subagent-command-error"]',
      ),
    ).toBeNull();
    rpcError.set({
      parentToolUseId: 'tool-1',
      method: 'subagent:stop',
      message: 'Stop failed',
      timestamp: 2,
    });
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="subagent-command-error"]',
      )?.textContent,
    ).toContain('Stop failed');
  });
});
