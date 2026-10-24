import { ChatStore } from '../../../services/chat.store';
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  AgentMonitorStore,
  SubagentExecutionStore,
  type SubagentExecutionEntry,
  type SubagentRecord,
} from '@ptah-extension/chat-streaming';
import {
  ClaudeRpcService,
  FILE_LINK_OPENER,
  ModelStateService,
  SURFACE_ACTIVE,
  VSCodeService,
} from '@ptah-extension/core';
import { createMockRpcService } from '@ptah-extension/core/testing';
import { provideMarkdown } from 'ngx-markdown';
import { createExecutionNode } from '@ptah-extension/shared';
import type { TrayAgentContext } from '../../../services/session-agents/session-agent-tray';
import { SessionAgentTrayService } from '../../../services/session-agents/session-agent-tray.service';
import { ChatAgentFeedbackSender } from '../../../services/agent-feedback/chat-agent-feedback-sender.service';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ArtifactStore } from '../../../services/artifact.store';
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
  const loadSubagentCacheInfo = jest
    .fn<Promise<void>, [string]>()
    .mockResolvedValue(undefined);
  const sendFeedback = jest.fn().mockResolvedValue({ sent: true });
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
    loadSubagentCacheInfo.mockClear();
    sendFeedback.mockClear();
    setEntry();
    stop.mockResolvedValue(undefined);
    sendToBackground.mockResolvedValue(true);
    TestBed.configureTestingModule({
      imports: [SubagentLaneComponent],
      providers: [
        {
          provide: ChatStore,
          useValue: {
            getPermissionForTool: () => null,
            handlePermissionResponse: jest.fn(),
          },
        },
        { provide: VSCodeService, useValue: { isElectron: false } },
        { provide: SURFACE_ACTIVE, useValue: signal(true) },
        provideMarkdown(),
        {
          provide: AgentMonitorStore,
          useValue: {
            tick,
            subagentRpcError: rpcError,
            stopAgent: stop,
            backgroundAgent: sendToBackground,
            loadSubagentCacheInfo,
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
        {
          provide: ChatAgentFeedbackSender,
          useValue: { send: sendFeedback },
        },
        {
          provide: ModelStateService,
          useValue: { availableModels: signal([]) },
        },
        // A tool node renders a real tool row, which reads these two.
        {
          provide: ArtifactStore,
          useValue: { recordById: () => null },
        },
        { provide: TabManagerService, useValue: { activeTabId: signal(null) } },
        { provide: ClaudeRpcService, useValue: createMockRpcService() },
        { provide: FILE_LINK_OPENER, useValue: { open: jest.fn() } },
      ],
    });
  });

  it('uses the shared header, an always-visible stats bar, and details facts', () => {
    const fixture = setup({
      ...base,
      taskDescription: 'Map the repository',
      description: 'Reading files',
      totalTokens: 1200,
      usage: { input: 1000, output: 200, model: 'claude-sonnet' },
    });
    const root: HTMLElement = fixture.nativeElement;
    const row = root.querySelector<HTMLButtonElement>(
      '[data-test="execution-header-details"]',
    )!;
    const meta = () =>
      root.querySelector('[data-test="execution-header-meta"]')?.textContent;
    // No tree yet, so no bubble: the control row keeps the record's count.
    expect(meta()).toContain('4 tools');
    // Tokens moved from the header meta into the stats bar.
    expect(meta()).not.toContain('tokens');
    // Stats chips sit in the control row, in the chat column.
    expect(
      root
        .querySelector('[data-test="execution-header-row"]')
        ?.contains(root.querySelector('ptah-agent-lane-stats')),
    ).toBe(true);
    expect(
      root.querySelector('ptah-execution-header')?.getAttribute('data-kind'),
    ).toBe('subagent');
    expect(root.textContent).toContain('Starting agent');
    // Collapsed header, stats still shown.
    expect(
      root.querySelector<HTMLElement>('#subagent-lane-details-tool-1')?.hidden,
    ).toBe(true);
    const stats = root.querySelector('ptah-agent-lane-stats');
    expect(
      stats?.querySelector('[data-testid="lane-stats-tokens"]')?.textContent,
    ).toContain('1.2k');
    expect(
      stats?.querySelector('[data-testid="lane-stats-model"]')?.textContent,
    ).toContain('claude-sonnet');
    row.click();
    fixture.detectChanges();
    const details = root.querySelector('#subagent-lane-details-tool-1')!;
    expect(details.textContent).not.toContain('Model:');
    expect(details.textContent).toMatch(/Task:\s*Map the repository/);
    expect(details.textContent).not.toContain('Reading files');
    expect(details.textContent).toMatch(/Parent:\s*session-/);
  });

  // The control row (stats, meta, Details, actions) renders inline in the
  // lane, above its transcript, in every host.
  it('renders its control row inside the lane', () => {
    const fixture = setup();
    const lane: HTMLElement = fixture.nativeElement;
    const header = lane.querySelector('ptah-execution-header');
    expect(header?.parentElement).toBe(lane);
    expect(lane.firstElementChild).toBe(header);
    const row = header!.querySelector('[data-test="execution-header-row"]');
    expect(row?.querySelector('ptah-agent-lane-stats')).not.toBeNull();
    const toggle = row!.querySelector<HTMLButtonElement>(
      '[data-test="execution-header-details"]',
    )!;
    const regions = () =>
      lane.querySelectorAll<HTMLElement>(
        `#${toggle.getAttribute('aria-controls')}[role="region"]`,
      );
    expect(regions()).toHaveLength(1);
    expect(header!.contains(regions()[0])).toBe(true);
    expect(regions()[0].hidden).toBe(true);
    toggle.click();
    fixture.detectChanges();
    expect(regions()).toHaveLength(1);
    expect(regions()[0].hidden).toBe(false);
  });

  it('leaves the tool count to the transcript bubble once the tree has a tool', () => {
    const text = createExecutionNode({
      id: 'msg-1-text-0',
      type: 'text',
      status: 'complete',
      content: 'Reading files',
    });
    const tool = createExecutionNode({
      id: 'msg-1-tool-1',
      type: 'tool',
      status: 'complete',
      content: null,
      toolName: 'Read',
      toolInput: { file_path: 'C:\\ws\\a.ts' },
    });
    treeFor.mockImplementation(() => [text, tool] as never[]);
    try {
      const fixture = setup({ ...base, status: 'background' });
      const root: HTMLElement = fixture.nativeElement;
      const header = root.querySelector('ptah-execution-header')!;
      expect(header.querySelector('ptah-turn-disclosure-row')).toBeNull();
      // The header keeps its run mode under its own hook, never the bubble's.
      expect(
        header.querySelector('[data-test="execution-header-meta"]')
          ?.textContent,
      ).toBe('Background');
      expect(header.querySelector('[data-test="turn-disclosure-meta"]')).toBeNull();
    } finally {
      treeFor.mockImplementation(() => []);
    }
  });

  it('keeps the record tool count while the tree has text only', () => {
    const text = createExecutionNode({
      id: 'msg-1-text-0',
      type: 'text',
      status: 'complete',
      content: 'Reading files',
    });
    treeFor.mockImplementation(() => [text] as never[]);
    try {
      const fixture = setup({ ...base, status: 'background' });
      const root: HTMLElement = fixture.nativeElement;
      // No bubble shows a count for a text-only turn, so the header does,
      // exactly once.
      expect(
        root.querySelector('[data-test="execution-header-meta"]')?.textContent,
      ).toBe('4 tools · Background');
      expect(root.textContent?.match(/4 tools/g)).toHaveLength(1);
    } finally {
      treeFor.mockImplementation(() => []);
    }
  });

  it('hides the Task row when the start carried no task', () => {
    const fixture = setup({ ...base, description: 'Reading files' });
    const root: HTMLElement = fixture.nativeElement;
    root
      .querySelector<HTMLButtonElement>(
        '[data-test="execution-header-details"]',
      )!
      .click();
    fixture.detectChanges();
    expect(
      root.querySelector('#subagent-lane-details-tool-1')?.textContent,
    ).not.toContain('Task:');
  });

  it('loads the cache info once per agent key', () => {
    const fixture = setup();
    fixture.componentRef.setInput('record', { ...base, toolUses: 5 });
    fixture.detectChanges();
    expect(loadSubagentCacheInfo).toHaveBeenCalledTimes(1);
    expect(loadSubagentCacheInfo).toHaveBeenCalledWith('tool-1');
    fixture.componentRef.setInput('record', {
      ...base,
      parentToolUseId: 'tool-2',
    });
    fixture.detectChanges();
    expect(loadSubagentCacheInfo).toHaveBeenCalledTimes(2);
    expect(loadSubagentCacheInfo).toHaveBeenLastCalledWith('tool-2');
  });

  it.each(['running', 'completed'] as const)(
    'shows the composer for a %s agent',
    (status) => {
      // A live agent takes input only through a steerable tray context.
      if (status === 'running') {
        contexts.set(new Map([['tool-1', context({ steerable: true })]]));
      }
      const fixture = setup({ ...base, status });
      const composer = fixture.nativeElement.querySelector(
        'ptah-subagent-lane-composer',
      );
      expect(
        composer?.querySelector('ptah-agent-steer-input textarea'),
      ).not.toBeNull();
    },
  );

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
    fixture.detectChanges();
    expect(sendToBackground).toHaveBeenCalledWith('session-123456', 'tool-1');
    expect(stop).toHaveBeenCalledWith('task-1', 'session-123456');
    expect(root.querySelector('[aria-label="Message Explore"]')).toBeNull();
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
      root.querySelector('[data-test="execution-header-row"]')?.textContent,
    ).not.toContain('tokens');
    expect(root.textContent).toContain('No output recorded');
  });

  it('shows the finished record summary when the parent tree is unavailable', async () => {
    const fixture = setup({
      ...base,
      status: 'completed',
      latestSummary: 'Investigation finished',
    });
    await fixture.whenStable();
    expect(
      fixture.nativeElement.querySelector('.chat-msg-slot .cs-answer'),
    ).not.toBeNull();
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
    const root = fixture.nativeElement as HTMLElement;
    expect(
      root.querySelector('[data-test="execution-header-meta"]')?.textContent,
    ).toContain('Background');
    expect(
      root.querySelector('[data-test="execution-header-peek"]')?.textContent,
    ).toBe('Reviewing tests');
  });

  it('keeps the draft after a failed steer and clears it after success', async () => {
    contexts.set(new Map([['tool-1', context({ steerable: true })]]));
    steer.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const fixture = setup();
    const root: HTMLElement = fixture.nativeElement;
    const field = root.querySelector<HTMLTextAreaElement>(
      'ptah-agent-steer-input textarea',
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
      root.querySelector<HTMLTextAreaElement>('ptah-agent-steer-input textarea')
        ?.value,
    ).toBe('Check tests');
    root
      .querySelector<HTMLButtonElement>('[aria-label="Send steer message"]')!
      .click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      root.querySelector<HTMLTextAreaElement>('ptah-agent-steer-input textarea')
        ?.value,
    ).toBe('');
    expect(root.textContent).not.toContain('Could not send your message');
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
