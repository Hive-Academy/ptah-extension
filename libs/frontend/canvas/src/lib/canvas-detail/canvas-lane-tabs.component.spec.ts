import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import { WallClockService } from '@ptah-extension/core';
import {
  AgentMonitorStore,
  BackgroundAgentStore,
  PermissionHandlerService,
} from '@ptah-extension/chat-streaming';
import { CanvasLaneTabsComponent } from './canvas-lane-tabs.component';

const TAB_ID = 'tab-owner';

interface CliFixture {
  readonly agentId: string;
  readonly cli: string;
  readonly parentSessionId?: string;
  readonly status: string;
  readonly displayName?: string;
  readonly permissionQueue: readonly { readonly requestId: string }[];
  readonly segments: readonly { readonly content: string }[];
  readonly startedAt: number | null;
  readonly completedAt: number | null;
}

interface SubFixture {
  readonly parentToolUseId: string;
  readonly parentSessionId?: string;
  readonly status?: string;
  readonly agentType?: string;
}

interface BackgroundFixture {
  readonly toolCallId: string;
  readonly sessionId?: string;
  readonly agentType?: string;
  readonly status?: string;
}

const cli = (
  partial: Pick<CliFixture, 'agentId' | 'cli'> &
    Partial<Omit<CliFixture, 'agentId' | 'cli'>>,
): CliFixture => ({
  status: 'running',
  permissionQueue: [],
  segments: [],
  startedAt: null,
  completedAt: null,
  ...partial,
});

/** `count` owned CLI lanes; the dock adds the orchestrator chip. */
const cliRoster = (count: number): CliFixture[] =>
  Array.from({ length: count }, (_, i) =>
    cli({ agentId: `c${i}`, parentSessionId: 'owner', cli: `CLI ${i}` }),
  );

// jsdom has no PointerEvent constructor.
const mousePointer = (type: string, pointerType = 'mouse'): Event =>
  Object.defineProperty(new MouseEvent(type, { bubbles: true }), 'pointerType', {
    value: pointerType,
  });

function fireResize(callback: ResizeObserverCallback, width: number): void {
  const target = document.createElement('div');
  callback(
    [
      {
        borderBoxSize: [],
        contentBoxSize: [],
        contentRect: new DOMRect(0, 0, width, 38),
        devicePixelContentBoxSize: [],
        target,
      },
    ],
    {
      observe: () => undefined,
      unobserve: () => undefined,
      disconnect: () => undefined,
    },
  );
}

describe('CanvasLaneTabsComponent', () => {
  let originalResizeObserver: typeof ResizeObserver | undefined;
  let measuredResize: ResizeObserverCallback;
  const agents = signal<CliFixture[]>([]);
  const subagents = signal(new Map<string, SubFixture>());
  const background = signal<BackgroundFixture[]>([]);
  const tabStatus = signal('loaded');
  const permissionRequests = signal<
    readonly { readonly id: string; readonly agentToolCallId?: string; readonly sessionId?: string }[]
  >([]);
  const questionRequests = signal<
    readonly { readonly id: string; readonly sessionId?: string }[]
  >([]);

  function tabLabels(root: HTMLElement): string[] {
    return [...root.querySelectorAll<HTMLElement>('[role="tab"]')].map(
      (tab) => tab.getAttribute('aria-label') ?? '',
    );
  }

  beforeEach(() => {
    originalResizeObserver = globalThis.ResizeObserver;
    class MeasuredResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) { measuredResize = callback; }
      observe(): void { fireResize(this.callback, 760); }
      unobserve(): void { return; }
      disconnect(): void { return; }
    }
    globalThis.ResizeObserver = MeasuredResizeObserver as typeof ResizeObserver;
    agents.set([]);
    subagents.set(new Map());
    background.set([]);
    tabStatus.set('loaded');
    permissionRequests.set([]);
    questionRequests.set([]);
    TestBed.configureTestingModule({
      imports: [CanvasLaneTabsComponent],
      providers: [
        { provide: AgentMonitorStore, useValue: { agents, subagents } },
        { provide: BackgroundAgentStore, useValue: { agents: background } },
        {
          provide: TabManagerService,
          useValue: {
            findTabByIdAcrossWorkspaces: (id: string) =>
              id === TAB_ID
                ? {
                    tab: {
                      id: TAB_ID,
                      claudeSessionId: 'owner',
                      status: tabStatus(),
                    },
                  }
                : undefined,
            findTabBySessionIdAcrossWorkspaces: () => undefined,
          },
        },
        {
          provide: PermissionHandlerService,
          useValue: {
            permissionRequests,
            questionRequests,
            targetTabsFor: () => [],
            questionTargetTabsFor: () => [],
            routingTargetRevision: signal(0),
          },
        },
      ],
    });
  });

  afterEach(() => { globalThis.ResizeObserver = originalResizeObserver as typeof ResizeObserver; });

  it('acquires the second clock only while an agent with a start time is running', () => {
    jest.useFakeTimers({
      doNotFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
    }).setSystemTime(10_000);
    const setIntervalSpy = jest.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = jest.spyOn(globalThis, 'clearInterval');
    const clock = TestBed.inject(WallClockService);
    const realAcquire = clock.acquire.bind(clock);
    const releases: Array<jest.Mock<void, []>> = [];
    const intervals: Array<ReturnType<typeof setInterval>> = [];
    const acquire = jest.spyOn(clock, 'acquire').mockImplementation((cadence) => {
      const prior = setIntervalSpy.mock.results.length;
      const release = jest.fn(realAcquire(cadence));
      expect(setIntervalSpy.mock.results.slice(prior)).toHaveLength(1);
      intervals.push(setIntervalSpy.mock.results[prior].value);
      releases.push(release);
      return release;
    });
    try {
      const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
      fixture.componentRef.setInput('tabId', TAB_ID);
      fixture.detectChanges();
      TestBed.tick();
      expect(acquire).not.toHaveBeenCalled();

      agents.set([cli({ agentId: 'timed', parentSessionId: 'owner', cli: 'Timed', startedAt: 10_000 })]);
      fixture.detectChanges();
      TestBed.tick();
      expect(acquire).toHaveBeenCalledWith('second');
      const label = () => tabLabels(fixture.nativeElement).find((value) => value.includes('Timed')) ?? '';
      expect(label()).not.toContain('0s');
      jest.advanceTimersByTime(1_000);
      fixture.detectChanges();
      expect(label()).toContain('1s');
      jest.advanceTimersByTime(1_000);
      fixture.detectChanges();
      expect(label()).toContain('2s');

      agents.set([cli({ agentId: 'timed', parentSessionId: 'owner', cli: 'Timed', status: 'completed', startedAt: 10_000, completedAt: 12_000 })]);
      fixture.detectChanges();
      TestBed.tick();
      expect(releases[0]).toHaveBeenCalledTimes(1);
      expect(clearIntervalSpy).toHaveBeenCalledWith(intervals[0]);
      fixture.destroy();
    } finally {
      jest.restoreAllMocks();
      jest.useRealTimers();
    }
  });

  it('rail shows five active avatars, expands overflow and selects with the shared tooltip', () => {
    jest.useFakeTimers();
    try {
      agents.set([...cliRoster(7), cli({ agentId: 'finished', parentSessionId: 'owner', cli: 'Done', status: 'completed' })]);
      const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
      fixture.componentRef.setInput('tabId', TAB_ID);
      fixture.componentRef.setInput('rail', true);
      fixture.detectChanges();
      const root: HTMLElement = fixture.nativeElement;
      expect(root.querySelectorAll('[role="tab"]')).toHaveLength(5);
      const overflow = root.querySelector<HTMLButtonElement>('[aria-label="Show 2 more active agents"]')!;
      expect(overflow.textContent).toContain('+2');
      const expand = jest.fn(), select = jest.fn();
      fixture.componentInstance.expandRequested.subscribe(expand);
      fixture.componentInstance.railPicked.subscribe(select);
      overflow.click();
      expect(expand).toHaveBeenCalledTimes(1);
      const avatar = root.querySelector<HTMLButtonElement>('[role="tab"]')!;
      avatar.dispatchEvent(mousePointer('pointerenter'));
      jest.advanceTimersByTime(220);
      fixture.detectChanges();
      expect(root.querySelector('ptah-agent-dock-card')).not.toBeNull();
      avatar.click();
      expect(select).toHaveBeenCalledWith('cli:c0');
      fixture.destroy();
    } finally { jest.useRealTimers(); }
  });

  it('rail falls back to the orchestrator when no agents are active', () => {
    const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
    fixture.componentRef.setInput('tabId', TAB_ID);
    fixture.componentRef.setInput('rail', true);
    fixture.detectChanges();
    expect(tabLabels(fixture.nativeElement)).toEqual([expect.stringContaining('Orchestrator')]);
    fixture.destroy();
  });

  it('rail arrow keys move focus only, keep one tab stop, and leave selection to Enter or a click', async () => {
    agents.set(cliRoster(7));
    const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
    fixture.componentRef.setInput('tabId', TAB_ID);
    fixture.componentRef.setInput('rail', true);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    document.body.appendChild(root);
    const tabs = () => [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    // One tab stop for the whole strip (roving tabindex).
    expect(tabs().filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
    // `+N` expands the sidebar; it is not a tab, so it sits outside the tablist.
    expect(root.querySelector('[role="tablist"] [aria-label="Show 2 more active agents"]')).toBeNull();
    expect(root.querySelector('[aria-label="Show 2 more active agents"]')).not.toBeNull();
    const select = jest.fn(), expand = jest.fn(), normalized = jest.fn();
    fixture.componentInstance.railPicked.subscribe(select);
    fixture.componentInstance.laneSelected.subscribe(normalized);
    fixture.componentInstance.expandRequested.subscribe(expand);
    const first = tabs()[0];
    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(select).not.toHaveBeenCalled();
    expect(expand).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(tabs()[1]);
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([-1, 0, -1, -1, -1]);
    tabs()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(tabs()[4]);
    expect(select).not.toHaveBeenCalled();
    // Enter is left to the button's native activation, which clicks: that selects.
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    tabs()[4].dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    tabs()[4].click();
    expect(select).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith('cli:c4');
    expect(normalized).not.toHaveBeenCalled();
    root.remove();
    fixture.destroy();
  });

  it('rail key normalization updates the selection without a user pick', () => {
    agents.set(cliRoster(3));
    const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
    fixture.componentRef.setInput('tabId', TAB_ID);
    fixture.componentRef.setInput('rail', true);
    const normalized = jest.fn(), picked = jest.fn();
    fixture.componentInstance.laneSelected.subscribe(normalized);
    fixture.componentInstance.railPicked.subscribe(picked);
    // A stale key (the lane left the roster) is corrected by the component itself.
    fixture.componentRef.setInput('laneKey', 'cli:gone');
    fixture.detectChanges();
    expect(normalized).toHaveBeenCalled();
    expect(normalized).not.toHaveBeenCalledWith('cli:gone');
    expect(picked).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it.each([1, 5])('hides the dropdown when no agent is hidden (%i total)', (count) => {
    agents.set(Array.from({ length: count - 1 }, (_, i) => cli({ agentId: `c${i}`, parentSessionId: 'owner', cli: `CLI ${i}` })));
    const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
    fixture.componentRef.setInput('tabId', TAB_ID);
    fixture.detectChanges();
    TestBed.tick();
    expect(fixture.nativeElement.querySelectorAll('[role="tab"]')).toHaveLength(count);
    expect(fixture.nativeElement.querySelector('[aria-haspopup="menu"]')).toBeNull();
    fixture.destroy();
  });

  it('caps a six-agent roster at five chips with one overflow row', () => {
    agents.set(cliRoster(5));
    const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
    fixture.componentRef.setInput('tabId', TAB_ID);
    fixture.detectChanges();
    TestBed.tick();
    expect(fixture.nativeElement.querySelectorAll('[role="tab"]')).toHaveLength(5);
    expect(fixture.nativeElement.querySelectorAll('[role="menuitemradio"]')).toHaveLength(0);
    expect(fixture.nativeElement.querySelector('[aria-haspopup="menu"]')?.getAttribute('aria-label')).toBe('1 more agent');
    fixture.destroy();
  });

  it('does not show a tooltip for the selected named tile', () => {
    jest.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
      fixture.componentRef.setInput('tabId', TAB_ID);
      fixture.detectChanges();
      const tab = fixture.nativeElement.querySelector('[aria-selected="true"]') as HTMLElement;
      tab.dispatchEvent(Object.defineProperty(new MouseEvent('pointerenter'), 'pointerType', { value: 'mouse' }));
      jest.advanceTimersByTime(220);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[role="tooltip"]')).toBeNull();
      fixture.destroy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('gives the rail dock tab ids that differ from the chat dock for the same panel', () => {
    agents.set(cliRoster(2));
    const ids = [false, true].map((rail) => {
      const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
      fixture.componentRef.setInput('tabId', TAB_ID);
      fixture.componentRef.setInput('rail', rail);
      fixture.detectChanges();
      const tabIds = [
        ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('[role="tab"]'),
      ].map((tab) => tab.id);
      fixture.destroy();
      return tabIds;
    });
    expect(ids[0]).toContain('canvas-lane-panel-tab-orchestrator');
    expect(ids[1].length).toBeGreaterThan(0);
    for (const id of ids[1]) {
      expect(id.startsWith('canvas-lane-panel-rail-tab-')).toBe(true);
      expect(ids[0]).not.toContain(id);
    }
  });

  it('names every chip and opens no card when five or fewer agents', () => {
    agents.set(cliRoster(2));
    jest.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
      fixture.componentRef.setInput('tabId', TAB_ID);
      fixture.detectChanges();
      TestBed.tick();
      const root = fixture.nativeElement as HTMLElement;
      const tabs = [...root.querySelectorAll<HTMLElement>('[role="tab"]')];
      expect(tabs).toHaveLength(3);
      expect(
        tabs.map((tab) => tab.querySelector('[data-testid="dock-chip-name"]')?.textContent?.trim()),
      ).toEqual(['Orchestrator', 'CLI 0', 'CLI 1']);
      const unselected = tabs.filter((tab) => tab.getAttribute('aria-selected') === 'false');
      expect(unselected).toHaveLength(2);
      for (const tab of unselected) {
        expect(tab.classList.contains('border-secondary')).toBe(false);
        expect(tab.classList.contains('hover:bg-base-200')).toBe(true);
        expect(tab.classList.contains('max-w-[140px]')).toBe(true);
        expect(tab.classList.contains('size-7')).toBe(false);
        expect(tab.tabIndex).toBe(-1);
        expect(
          tab.querySelector('[data-testid="dock-chip-name"]')?.classList.contains('truncate'),
        ).toBe(true);
      }
      expect(root.querySelector('[aria-haspopup="menu"]')).toBeNull();

      const tab = unselected[0];
      tab.dispatchEvent(mousePointer('pointerenter'));
      jest.advanceTimersByTime(220);
      fixture.detectChanges();
      expect(root.querySelector('[role="tooltip"]')).toBeNull();

      const matches = HTMLElement.prototype.matches;
      jest.spyOn(tab, 'matches').mockImplementation((selector) =>
        selector === ':focus-visible' ? true : matches.call(tab, selector),
      );
      tab.focus();
      fixture.detectChanges();
      expect(root.querySelector('[role="tooltip"]')).toBeNull();
      expect(tab.getAttribute('aria-describedby')).toBeNull();
      fixture.destroy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows avatar circles with a card when more than five agents', () => {
    agents.set(cliRoster(5));
    jest.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
      fixture.componentRef.setInput('tabId', TAB_ID);
      fixture.detectChanges();
      TestBed.tick();
      const root = fixture.nativeElement as HTMLElement;
      const selected = root.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      expect(selected?.querySelector('[data-testid="dock-chip-name"]')?.textContent).toContain(
        'Orchestrator',
      );
      const circles = [
        ...root.querySelectorAll<HTMLElement>('[role="tab"][aria-selected="false"]'),
      ];
      expect(circles).toHaveLength(4);
      expect(root.querySelector('[aria-haspopup="menu"]')?.getAttribute('aria-label')).toBe('1 more agent');
      for (const circle of circles) {
        expect(circle.classList.contains('size-7')).toBe(true);
        expect(circle.querySelector('[data-testid="dock-chip-name"]')).toBeNull();
      }
      circles[0].dispatchEvent(mousePointer('pointerenter'));
      jest.advanceTimersByTime(220);
      fixture.detectChanges();
      expect(root.querySelector('[role="tooltip"]')).not.toBeNull();
      fixture.destroy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps terminal lanes inline when the small roster fits', () => {
    subagents.set(
      new Map([
        [
          's',
          {
            parentToolUseId: 's',
            parentSessionId: 'owner',
            status: 'completed',
            agentType: 'Worker',
          },
        ],
      ]),
    );
    agents.set([
      cli({
        agentId: 'c',
        parentSessionId: 'owner',
        cli: 'codex',
        displayName: 'Codex',
        status: 'completed',
      }),
    ]);
    background.set([
      {
        toolCallId: 'b',
        sessionId: 'owner',
        agentType: 'Review',
        status: 'completed',
      },
    ]);
    const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
    fixture.componentRef.setInput('tabId', TAB_ID);
    fixture.detectChanges();
    TestBed.tick();
    const dock = fixture.nativeElement.querySelector('[role="tablist"]') as HTMLElement;
    expect(dock.classList.contains('z-10')).toBe(true);
    expect(dock.classList.contains('z-20')).toBe(false);
    expect(dock.querySelector('ptah-agent-dock-menu')).toBeNull();
    expect(dock.classList.contains('pt-1')).toBe(true);
    expect(dock.classList.contains('pb-0.5')).toBe(true);
    expect(dock.classList.contains('border-b')).toBe(true);
    expect(dock.classList.contains('border-surface-border')).toBe(true);
    expect(dock.classList.contains('bg-surface-1')).toBe(true);
    expect(tabLabels(fixture.nativeElement)).toEqual([
      'Orchestrator, done',
      'Worker, Sub-agent, done',
      'Codex, CLI lane, done',
      'Review, Background, done',
    ]);
    expect(fixture.nativeElement.querySelectorAll('[data-testid="dock-divider"]')).toHaveLength(0);

    tabStatus.set('streaming');
    fixture.detectChanges();
    expect(tabLabels(fixture.nativeElement)[0]).toBe('Orchestrator, running');

    expect(dock.querySelector('[aria-haspopup="menu"]')).toBeNull();
  });

  it('keeps a focused finished chip inline until focus leaves the dock', () => {
    agents.set(cliRoster(6));
    const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
    fixture.componentRef.setInput('tabId', TAB_ID);
    fixture.detectChanges();
    TestBed.tick();
    const root = fixture.nativeElement as HTMLElement;
    document.body.appendChild(root);
    const chip = root.querySelector<HTMLElement>('#canvas-lane-panel-tab-cli\\:c0')!;
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    try {
      chip.focus();
      fixture.detectChanges();
      agents.set(cliRoster(6).map((agent) =>
        agent.agentId === 'c0' ? { ...agent, status: 'completed' } : agent,
      ));
      fixture.detectChanges();
      expect(document.activeElement).toBe(chip);
      expect(chip.isConnected).toBe(true);
      outside.focus();
      fixture.detectChanges();
      expect(root.querySelector('#canvas-lane-panel-tab-cli\\:c0')).toBeNull();
      expect(root.querySelector('[aria-haspopup="menu"]')).not.toBeNull();
    } finally {
      outside.remove();
      root.remove();
      fixture.destroy();
    }
  });

  it('does not freeze visible chips after a pointer click focuses a tab', () => {
    agents.set(cliRoster(6));
    const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
    fixture.componentRef.setInput('tabId', TAB_ID);
    fixture.detectChanges();
    TestBed.tick();
    const root = fixture.nativeElement as HTMLElement;
    document.body.appendChild(root);
    try {
      const chip = root.querySelector<HTMLElement>('#canvas-lane-panel-tab-cli\\:c0')!;
      chip.dispatchEvent(mousePointer('pointerdown'));
      chip.focus();
      chip.click();
      fixture.detectChanges();
      agents.set(cliRoster(6).map((agent) =>
        agent.agentId === 'c1' ? { ...agent, status: 'completed' } : agent,
      ));
      fixture.detectChanges();
      expect(root.querySelector('#canvas-lane-panel-tab-cli\\:c1')).toBeNull();
      expect(root.querySelector('[aria-haspopup="menu"]')).not.toBeNull();
    } finally {
      root.remove();
      fixture.destroy();
    }
  });

  it('freezes visible chips while a tab has keyboard focus', () => {
    agents.set(cliRoster(6));
    const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
    fixture.componentRef.setInput('tabId', TAB_ID);
    fixture.detectChanges();
    TestBed.tick();
    const root = fixture.nativeElement as HTMLElement;
    document.body.appendChild(root);
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    try {
      const chip = root.querySelector<HTMLElement>('#canvas-lane-panel-tab-cli\\:c0')!;
      chip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      chip.focus();
      fixture.detectChanges();
      agents.set(cliRoster(6).map((agent) =>
        agent.agentId === 'c1' ? { ...agent, status: 'completed' } : agent,
      ));
      fixture.detectChanges();
      expect(root.querySelector('#canvas-lane-panel-tab-cli\\:c1')).not.toBeNull();
      outside.focus();
      fixture.detectChanges();
      expect(root.querySelector('#canvas-lane-panel-tab-cli\\:c1')).toBeNull();
    } finally {
      outside.remove();
      root.remove();
      fixture.destroy();
    }
  });

  it.each(['waiting', 'failed'])('keeps a new %s agent in overflow while keyboard focus freezes the dock', (status) => {
    agents.set(cliRoster(6));
    const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
    fixture.componentRef.setInput('tabId', TAB_ID);
    fixture.detectChanges();
    TestBed.tick();
    const root = fixture.nativeElement as HTMLElement;
    document.body.appendChild(root);
    try {
      root.querySelector<HTMLElement>('#canvas-lane-panel-tab-cli\\:c0')!.focus();
      fixture.detectChanges();
      agents.set([...cliRoster(6), cli({
        agentId: 'new',
        parentSessionId: 'owner',
        cli: 'New',
        status: status === 'waiting' ? 'running' : status,
        permissionQueue: status === 'waiting' ? [{ requestId: 'request-new' }] : [],
      })]);
      fixture.detectChanges();
      expect(root.querySelector('#canvas-lane-panel-tab-cli\\:new')).toBeNull();
    } finally {
      root.remove();
      fixture.destroy();
    }
  });

  it('clears the remembered chip when focus moves to the menu', async () => {
    agents.set([
      cli({ agentId: 'c0', parentSessionId: 'owner', cli: 'Running' }),
      cli({ agentId: 'c1', parentSessionId: 'owner', cli: 'Finished', status: 'completed' }),
    ]);
    const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
    fixture.componentRef.setInput('tabId', TAB_ID);
    fixture.detectChanges();
    TestBed.tick();
    fireResize(measuredResize, 270);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    document.body.appendChild(root);
    try {
      root.querySelector<HTMLElement>('#canvas-lane-panel-tab-cli\\:c0')!.focus();
      const trigger = root.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
      trigger.focus();
      fixture.detectChanges();
      agents.set(agents().filter((agent) => agent.agentId !== 'c0'));
      fixture.detectChanges();
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      outside.focus();
      fixture.detectChanges();
      await fixture.whenStable();
      expect(root.querySelector('[aria-haspopup="menu"]')).toBeNull();
      expect(document.activeElement).toBe(outside);
      outside.remove();
    } finally {
      root.remove();
      fixture.destroy();
    }
  });

  it('restores focus to the selected tab when a focused agent leaves the roster', async () => {
    agents.set(cliRoster(2));
    const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
    fixture.componentRef.setInput('tabId', TAB_ID);
    fixture.detectChanges();
    TestBed.tick();
    const root = fixture.nativeElement as HTMLElement;
    document.body.appendChild(root);
    try {
      root.querySelector<HTMLElement>('#canvas-lane-panel-tab-cli\\:c0')!.focus();
      fixture.detectChanges();
      agents.set(cliRoster(2).filter((agent) => agent.agentId !== 'c0'));
      fixture.detectChanges();
      await fixture.whenStable();
      expect(document.activeElement).toBe(root.querySelector('[role="tab"][aria-selected="true"]'));
    } finally {
      root.remove();
      fixture.destroy();
    }
  });

  it('keeps a finished selected chip available for reverse arrow navigation', async () => {
    agents.set([
      cli({ agentId: 'c0', parentSessionId: 'owner', cli: 'Finished', status: 'completed' }),
      cli({ agentId: 'c1', parentSessionId: 'owner', cli: 'Running' }),
    ]);
    const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
    fixture.componentRef.setInput('tabId', TAB_ID);
    fixture.componentRef.setInput('laneKey', 'cli:c0');
    fixture.componentInstance.laneSelected.subscribe((key) => fixture.componentRef.setInput('laneKey', key));
    fixture.detectChanges();
    TestBed.tick();
    const root = fixture.nativeElement as HTMLElement;
    document.body.appendChild(root);
    try {
      const finished = root.querySelector<HTMLElement>('#canvas-lane-panel-tab-cli\\:c0')!;
      finished.focus();
      finished.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      fixture.detectChanges();
      await fixture.whenStable();
      const running = root.querySelector<HTMLElement>('#canvas-lane-panel-tab-cli\\:c1')!;
      expect(document.activeElement).toBe(running);
      expect(root.querySelector('#canvas-lane-panel-tab-cli\\:c0')).not.toBeNull();
      running.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      fixture.detectChanges();
      await fixture.whenStable();
      expect(document.activeElement?.id).toBe('canvas-lane-panel-tab-cli:c0');
    } finally {
      root.remove();
      fixture.destroy();
    }
  });

  it('closes the hover card when its chip moves into the menu', () => {
    jest.useFakeTimers();
    try {
      agents.set(cliRoster(5));
      const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
      fixture.componentRef.setInput('tabId', TAB_ID);
      fixture.detectChanges();
      TestBed.tick();
      const root = fixture.nativeElement as HTMLElement;
      root.querySelector<HTMLElement>('#canvas-lane-panel-tab-cli\\:c0')!
        .dispatchEvent(mousePointer('pointerenter'));
      jest.advanceTimersByTime(220);
      fixture.detectChanges();
      expect(root.querySelector('[role="tooltip"]')).not.toBeNull();
      agents.set(cliRoster(5).map((agent) =>
        agent.agentId === 'c0' ? { ...agent, status: 'completed' } : agent,
      ));
      fixture.detectChanges();
      expect(root.querySelector('#canvas-lane-panel-tab-cli\\:c0')).toBeNull();
      expect(root.querySelector('[role="tooltip"]')).toBeNull();
      fixture.destroy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('excludes foreign and unresolved owners and falls back for an unknown key', () => {
    agents.set([
      cli({ agentId: 'foreign', parentSessionId: 'other', cli: 'Other' }),
      cli({ agentId: 'unknown', cli: 'Unknown' }),
    ]);
    subagents.set(
      new Map([['x', { parentToolUseId: 'x', status: 'running' }]]),
    );
    background.set([{ toolCallId: 'b', agentType: 'Unowned' }]);
    const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
    fixture.componentRef.setInput('tabId', TAB_ID);
    fixture.componentRef.setInput('laneKey', 'cli:gone');
    const selected = jest.fn();
    fixture.componentInstance.laneSelected.subscribe(selected);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[role="tab"]')).toHaveLength(1);
    expect(
      fixture.nativeElement
        .querySelector('[role="tab"]')
        .getAttribute('aria-selected'),
    ).toBe('true');
    expect(selected).toHaveBeenCalledWith('orchestrator');
  });

  it('migrates a selected sub-agent tab to its background tab', () => {
    const sub = {
      parentToolUseId: 'x',
      parentSessionId: 'owner',
      status: 'running',
      agentType: 'Worker',
    };
    subagents.set(new Map([['x', sub]]));
    const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
    fixture.componentRef.setInput('tabId', TAB_ID);
    fixture.componentRef.setInput('laneKey', 'sub:x');
    const selected = jest.fn();
    fixture.componentInstance.laneSelected.subscribe(selected);
    fixture.detectChanges();
    expect(selected).not.toHaveBeenCalled();

    subagents.set(new Map([['x', { ...sub, status: 'background' }]]));
    fixture.detectChanges();
    expect(selected).toHaveBeenCalledWith('bg:x');
    expect(selected).not.toHaveBeenCalledWith('orchestrator');
    expect(
      fixture.nativeElement.querySelector('[role="tab"][aria-selected="true"]').id,
    ).toContain('bg:x');
  });

  it('migrates a selected background tab back to its completed sub-agent tab', () => {
    const sub = {
      parentToolUseId: 'x',
      parentSessionId: 'owner',
      status: 'background',
      agentType: 'Worker',
    };
    subagents.set(new Map([['x', sub]]));
    const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
    fixture.componentRef.setInput('tabId', TAB_ID);
    fixture.componentRef.setInput('laneKey', 'bg:x');
    const selected = jest.fn();
    fixture.componentInstance.laneSelected.subscribe(selected);
    fixture.detectChanges();
    subagents.set(new Map([['x', { ...sub, status: 'completed' }]]));
    fixture.detectChanges();
    expect(selected).toHaveBeenCalledWith('sub:x');
    expect(selected).not.toHaveBeenCalledWith('orchestrator');
    expect(
      fixture.nativeElement.querySelector('[role="tab"][aria-selected="true"]').id,
    ).toContain('sub:x');
  });

  it('falls back to orchestrator when a background lane has no matching key', () => {
    subagents.set(
      new Map([
        [
          'other',
          {
            parentToolUseId: 'other',
            parentSessionId: 'owner',
            status: 'completed',
            agentType: 'Worker',
          },
        ],
      ]),
    );
    const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
    fixture.componentRef.setInput('tabId', TAB_ID);
    fixture.componentRef.setInput('laneKey', 'bg:x');
    const selected = jest.fn();
    fixture.componentInstance.laneSelected.subscribe(selected);
    fixture.detectChanges();
    expect(selected).toHaveBeenCalledWith('orchestrator');
    expect(selected).not.toHaveBeenCalledWith('sub:other');
    expect(
      fixture.nativeElement.querySelector('[role="tab"][aria-selected="true"]').id,
    ).toContain('orchestrator');
  });

  it('shows an owned CLI lane once while excluding unresolved and foreign lanes', () => {
    agents.set([
      cli({ agentId: 'unowned', cli: 'Unowned', status: 'running' }),
      cli({
        agentId: 'foreign',
        parentSessionId: 'other',
        cli: 'Foreign',
        status: 'running',
      }),
      cli({
        agentId: 'owned',
        parentSessionId: 'owner',
        cli: 'Owned',
        status: 'running',
      }),
    ]);
    const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
    fixture.componentRef.setInput('tabId', TAB_ID);
    fixture.detectChanges();
    TestBed.tick();
    const tabs = [...fixture.nativeElement.querySelectorAll('[role="tab"]')] as HTMLElement[];
    expect(tabLabels(fixture.nativeElement)).toEqual([
      'Orchestrator, done',
      'Owned, CLI lane, running',
    ]);
    expect(tabs.filter((tab) => tab.id.includes('cli:owned'))).toHaveLength(1);
  });

  it('moves focus between tabs with arrow keys without selecting', async () => {
    agents.set([
      cli({
        agentId: 'c',
        parentSessionId: 'owner',
        cli: 'Codex',
        status: 'running',
      }),
    ]);
    const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
    fixture.componentRef.setInput('tabId', TAB_ID);
    fixture.detectChanges();
    TestBed.tick();
    const root = fixture.nativeElement as HTMLElement;
    document.body.appendChild(root);
    const selected = jest.fn();
    fixture.componentInstance.laneSelected.subscribe(selected);
    const firstTab = root.querySelector<HTMLElement>('[role="tab"]')!;
    firstTab.focus();
    firstTab.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    fixture.detectChanges();
    await fixture.whenStable();
    expect((document.activeElement as HTMLElement).id).toContain('cli:c');
    expect(selected).not.toHaveBeenCalled();
    root.remove();
    fixture.destroy();
  });

  it('keeps a waiting agent in the five-chip 360px plan and disconnects the observer', async () => {
    const original = globalThis.ResizeObserver;
    let resize: ResizeObserverCallback = () => undefined;
    const disconnect = jest.fn();
    const observe = jest.fn();
    class FakeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe = observe;
      unobserve(): void {
        return undefined;
      }
      disconnect = disconnect;
    }
    globalThis.ResizeObserver = FakeResizeObserver as typeof ResizeObserver;
    try {
      agents.set([
        cli({
          agentId: 'wait',
          parentSessionId: 'owner',
          cli: 'Waiter',
          status: 'running',
          permissionQueue: [{ requestId: 'p' }],
        }),
        cli({
          agentId: 'bad',
          parentSessionId: 'owner',
          cli: 'Broken',
          status: 'failed',
        }),
        cli({
          agentId: 'run',
          parentSessionId: 'owner',
          cli: 'Runner',
          status: 'running',
        }),
        cli({
          agentId: 'fin',
          parentSessionId: 'owner',
          cli: 'Finished',
          status: 'completed',
        }),
        cli({ agentId: 'extra', parentSessionId: 'owner', cli: 'Extra', status: 'completed' }),
      ]);
      const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
      fixture.componentRef.setInput('tabId', TAB_ID);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(observe).toHaveBeenCalledTimes(1);
      fireResize(resize, 360);
      fixture.detectChanges();
      const labels = tabLabels(fixture.nativeElement);
      expect(labels).toHaveLength(5);
      expect(labels.some((label) => label.includes('Waiter'))).toBe(true);
      expect(labels.some((label) => label.includes('Finished'))).toBe(true);
      expect(labels.some((label) => label.includes('Extra'))).toBe(false);
      const selected = jest.fn();
      fixture.componentInstance.laneSelected.subscribe(selected);
      fixture.nativeElement
        .querySelector('[role="tab"]')
        .dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
        );
      expect(selected).not.toHaveBeenCalled();
      fireResize(resize, 0);
      fixture.detectChanges();
      expect(tabLabels(fixture.nativeElement)).toEqual([]);
      expect(
        fixture.nativeElement
          .querySelector('[aria-haspopup="menu"]')
          .getAttribute('aria-label'),
      ).toBe('6 more agents, 1 waiting, needs you, 1 failed');
      const trigger = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
      trigger.click();
      fixture.detectChanges();
      const rows = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
      expect(rows.map((row) => row.querySelector('.truncate')?.textContent?.trim())).toEqual([
        'Runner', 'Waiter', 'Broken', 'Orchestrator', 'Finished', 'Extra',
      ]);
      expect(rows).toHaveLength(Number(trigger.getAttribute('aria-label')?.match(/^\d+/)?.[0]));
      expect(rows.some((row) => row.textContent?.includes('Orchestrator'))).toBe(true);
      expect((fixture.nativeElement as HTMLElement).querySelectorAll('[role="tab"]')).toHaveLength(0);
      fixture.destroy();
      expect(disconnect).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.ResizeObserver = original;
    }
  });

  it('keeps a newly selected lane rendered when the dock is narrow', async () => {
    const original = globalThis.ResizeObserver;
    let resize: ResizeObserverCallback = () => undefined;
    class FakeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe(): void {
        return undefined;
      }
      unobserve(): void {
        return undefined;
      }
      disconnect(): void {
        return undefined;
      }
    }
    globalThis.ResizeObserver = FakeResizeObserver as typeof ResizeObserver;
    try {
      agents.set([
        cli({
          agentId: 'wait',
          parentSessionId: 'owner',
          cli: 'Waiter',
          status: 'running',
          permissionQueue: [{ requestId: 'p' }],
        }),
        cli({
          agentId: 'fin',
          parentSessionId: 'owner',
          cli: 'Finished',
          status: 'completed',
        }),
      ]);
      const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
      fixture.componentRef.setInput('tabId', TAB_ID);
      fixture.detectChanges();
      await fixture.whenStable();
      fireResize(resize, 240);
      fixture.detectChanges();
      expect(tabLabels(fixture.nativeElement).some((label) => label.includes('Finished'))).toBe(
        false,
      );
      expect(fixture.nativeElement.querySelector('[aria-haspopup="menu"]')).not.toBeNull();
      fixture.componentRef.setInput('laneKey', 'cli:fin');
      fixture.detectChanges();
      const selected = fixture.nativeElement.querySelector(
        '[role="tab"][aria-selected="true"]',
      ) as HTMLElement;
      expect(selected.id).toContain('cli:fin');
      expect(selected.getAttribute('aria-label')).toContain('Finished');
    } finally {
      globalThis.ResizeObserver = original;
    }
  });

  it('keeps menu focus on a remaining hidden agent and restores the selected tab when overflow empties', async () => {
    agents.set([
      cli({ agentId: 'run', parentSessionId: 'owner', cli: 'Runner' }),
      cli({ agentId: 'done-a', parentSessionId: 'owner', cli: 'Done A', status: 'completed' }),
      cli({ agentId: 'done-b', parentSessionId: 'owner', cli: 'Done B', status: 'completed' }),
    ]);
    const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
    fixture.componentRef.setInput('tabId', TAB_ID);
    fixture.detectChanges();
    TestBed.tick();
    fireResize(measuredResize, 270);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    document.body.appendChild(root);
    try {
      root.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!.click();
      fixture.detectChanges();
      await fixture.whenStable();
      const rows = () => [...root.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
      expect(rows()).toHaveLength(2);
      expect(document.activeElement).toBe(rows()[0]);
      expect(rows().filter((row) => row.tabIndex === 0)).toHaveLength(1);

      agents.set(agents().filter((agent) => agent.agentId !== 'done-a'));
      fixture.detectChanges();
      await fixture.whenStable();
      expect(rows()).toHaveLength(1);
      expect(rows()[0].textContent).toContain('Done B');
      expect(rows()[0].tabIndex).toBe(0);
      expect(document.activeElement).toBe(rows()[0]);

      agents.set(agents().filter((agent) => agent.agentId !== 'done-b'));
      fixture.detectChanges();
      await fixture.whenStable();
      expect(root.querySelector('[role="menu"]')).toBeNull();
      expect(root.querySelector('[aria-haspopup="menu"]')).toBeNull();
      expect(document.activeElement).toBe(root.querySelector('[role="tab"][aria-selected="true"]'));
    } finally {
      root.remove();
      fixture.destroy();
    }
  });

  it('restores the selected tab when overflow empties while the closed menu trigger has focus', async () => {
    agents.set([
      cli({ agentId: 'run', parentSessionId: 'owner', cli: 'Runner' }),
      cli({ agentId: 'done-a', parentSessionId: 'owner', cli: 'Done A', status: 'completed' }),
    ]);
    const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
    fixture.componentRef.setInput('tabId', TAB_ID);
    fixture.detectChanges();
    TestBed.tick();
    fireResize(measuredResize, 270);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    document.body.appendChild(root);
    try {
      const trigger = root.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
      trigger.focus();
      expect(document.activeElement).toBe(trigger);
      expect(root.querySelector('[role="menu"]')).toBeNull();

      agents.set(agents().filter((agent) => agent.agentId !== 'done-a'));
      fixture.detectChanges();
      await fixture.whenStable();
      expect(root.querySelector('[aria-haspopup="menu"]')).toBeNull();
      expect(document.activeElement).toBe(root.querySelector('[role="tab"][aria-selected="true"]'));
    } finally {
      root.remove();
      fixture.destroy();
    }
  });

  it('selects from the menu with Enter, returns focus on Escape, and describes the hovered tab', async () => {
    agents.set([
      ...Array.from({ length: 4 }, (_, i) => cli({ agentId: `c${i}`, parentSessionId: 'owner', cli: `CLI ${i}` })),
      cli({ agentId: 'finished', parentSessionId: 'owner', cli: 'Finished', status: 'completed' }),
    ]);
    const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
    const root = fixture.nativeElement as HTMLElement;
    document.body.appendChild(root);
    fixture.componentRef.setInput('tabId', TAB_ID);
    const selected = jest.fn();
    fixture.componentInstance.laneSelected.subscribe((key) => {
      selected(key);
      fixture.componentRef.setInput('laneKey', key);
    });
    fixture.detectChanges();
    TestBed.tick();
    const trigger = fixture.nativeElement.querySelector(
      '[aria-haspopup="menu"]',
    ) as HTMLButtonElement;

    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const menu = fixture.nativeElement.querySelector('[role="menu"]') as HTMLElement;
    expect(menu).not.toBeNull();
    const menuRows = [...menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    expect(menuRows).toHaveLength(1);
    expect(menuRows[0].textContent).toContain('Finished');
    expect(trigger.getAttribute('aria-label')).toBe('1 more agent');
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const reopened = fixture.nativeElement.querySelector('[role="menu"]') as HTMLElement;
    reopened.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    expect(selected).toHaveBeenCalledWith('cli:finished');
    expect(fixture.nativeElement.querySelector('[role="menu"]')).toBeNull();

    jest.useFakeTimers();
    try {
      const tab = fixture.nativeElement.querySelector('[role="tab"][aria-selected="false"]') as HTMLElement;
      // jsdom has no PointerEvent constructor.
      const pointerEnter = (pointerType: string): Event =>
        Object.defineProperty(
          new MouseEvent('pointerenter', { bubbles: true }),
          'pointerType',
          { value: pointerType },
        );
      // Menu Enter returned keyboard focus to the selected tab.
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[role="tooltip"]')).toBeNull();

      tab.dispatchEvent(pointerEnter('touch'));
      jest.advanceTimersByTime(220);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[role="tooltip"]')).toBeNull();

      tab.dispatchEvent(pointerEnter('mouse'));
      jest.advanceTimersByTime(219);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[role="tooltip"]')).toBeNull();
      jest.advanceTimersByTime(1);
      fixture.detectChanges();
      const card = fixture.nativeElement.querySelector('[role="tooltip"]') as HTMLElement;
      expect(card).not.toBeNull();
      expect(fixture.nativeElement.querySelector('[role="tablist"]')?.contains(card)).toBe(true);
      expect(card.closest('ptah-agent-dock-card')).not.toBeNull();
      expect(card.id).toBe('canvas-lane-panel-agent-card');
      expect(tab.getAttribute('aria-describedby')).toBe(card.id);
      expect(card.textContent).toContain('Click to view this thread');
      expect(card.textContent).not.toContain('Needs you');
      expect(card.textContent).not.toContain('Error');

      const calls = selected.mock.calls.length;
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[role="tooltip"]')).toBeNull();
      expect(selected.mock.calls.length).toBe(calls);
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      outside.focus();
      fixture.detectChanges();
      await fixture.whenStable();
      expect(
        fixture.nativeElement.querySelector('[role="tab"][aria-selected="true"]').id,
      ).toContain('cli:finished');
      outside.remove();
    } finally {
      jest.useRealTimers();
      root.remove();
      fixture.destroy();
    }
  });

  it('closes the card after the pointer leaves the tab and card without keyboard focus', () => {
    agents.set(cliRoster(5));
    jest.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
      fixture.componentRef.setInput('tabId', TAB_ID);
      fixture.detectChanges();
      TestBed.tick();
      const tab: HTMLElement | null = fixture.nativeElement.querySelector('[role="tab"][aria-selected="false"]');
      expect(tab).not.toBeNull();
      if (!tab) return;
      tab.focus();
      const matches = HTMLElement.prototype.matches;
      jest.spyOn(tab, 'matches').mockImplementation((selector) =>
        selector === ':focus-visible' ? false : matches.call(tab, selector),
      );
      const pointer = (type: string) => new MouseEvent(type, { bubbles: true });
      tab.dispatchEvent(Object.defineProperty(pointer('pointerenter'), 'pointerType', { value: 'mouse' }));
      jest.advanceTimersByTime(220);
      fixture.detectChanges();
      const card: HTMLElement | null = fixture.nativeElement.querySelector('[role="tooltip"]');
      expect(card).not.toBeNull();
      if (!card) return;

      tab.dispatchEvent(pointer('pointerleave'));
      card.dispatchEvent(pointer('pointerenter'));
      jest.advanceTimersByTime(220);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[role="tooltip"]')).not.toBeNull();

      card.dispatchEvent(pointer('pointerleave'));
      jest.advanceTimersByTime(220);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[role="tooltip"]')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('closes the open card after a quick pointer sweep across two tabs', () => {
    jest.useFakeTimers();
    try {
      agents.set(cliRoster(5));
      const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
      fixture.componentRef.setInput('tabId', TAB_ID);
      fixture.detectChanges();
      TestBed.tick();
      const tabs: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('[role="tab"]');
      expect(tabs).toHaveLength(5);
      const [tabB, tabA] = [...tabs];
      const pointer = (type: string) => new MouseEvent(type, { bubbles: true });
      const enter = () => Object.defineProperty(pointer('pointerenter'), 'pointerType', { value: 'mouse' });

      tabA.dispatchEvent(enter());
      jest.advanceTimersByTime(220);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[role="tooltip"]')).not.toBeNull();

      tabA.dispatchEvent(pointer('pointerleave'));
      tabB.dispatchEvent(enter());
      jest.advanceTimersByTime(100);
      tabB.dispatchEvent(pointer('pointerleave'));
      jest.advanceTimersByTime(220);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[role="tooltip"]')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('CanvasLaneTabsComponent dock', () => {
interface CliFixture {
  agentId: string;
  cli: string;
  parentSessionId: string;
  status: string;
  permissionQueue: readonly { requestId: string }[];
  segments: readonly { content: string }[];
  startedAt: number | null;
  completedAt: number | null;
}
const cli = (index: number, status = 'running'): CliFixture => ({
  agentId: `c${index}`, cli: `CLI ${index}`, parentSessionId: 'owner', status,
  permissionQueue: [], segments: [], startedAt: null, completedAt: null,
});
const cliRoster = (count: number): CliFixture[] => Array.from({ length: count }, (_, index) => cli(index));

function fireResize(callback: ResizeObserverCallback, width: number): void {
  const target = document.createElement('div');
  callback([{ borderBoxSize: [], contentBoxSize: [], contentRect: new DOMRect(0, 0, width, 38),
    devicePixelContentBoxSize: [], target }], {
    observe: () => undefined, unobserve: () => undefined, disconnect: () => undefined,
  });
}


  const agents = signal<CliFixture[]>([]);
  const subagents = signal(new Map<string, { parentToolUseId: string; parentSessionId: string; status: string; agentType: string }>());
  const background = signal<readonly { toolCallId: string; sessionId: string; agentType: string; status: string }[]>([]);
  const tabStatus = signal('loaded');
  let resize: ResizeObserverCallback;
  let originalResizeObserver: typeof ResizeObserver | undefined;
  const observe = jest.fn();
  const disconnect = jest.fn();

  const tabs = (root: HTMLElement): HTMLButtonElement[] =>
    [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const ids = (root: HTMLElement): string[] => tabs(root).map((tab) => tab.id);
  const trigger = (root: HTMLElement): HTMLButtonElement | null =>
    root.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]');

  beforeEach(() => {
    agents.set([]);
    subagents.set(new Map());
    background.set([]);
    tabStatus.set('loaded');
    observe.mockClear();
    disconnect.mockClear();
    originalResizeObserver = globalThis.ResizeObserver;
    class FakeResizeObserver {
      constructor(callback: ResizeObserverCallback) { resize = callback; }
      observe = observe;
      unobserve(): void { return; }
      disconnect = disconnect;
    }
    globalThis.ResizeObserver = FakeResizeObserver as typeof ResizeObserver;
    TestBed.configureTestingModule({
      imports: [CanvasLaneTabsComponent],
      providers: [
        { provide: AgentMonitorStore, useValue: { agents, subagents } },
        { provide: BackgroundAgentStore, useValue: { agents: background } },
        { provide: TabManagerService, useValue: {
          findTabByIdAcrossWorkspaces: (id: string) => id === TAB_ID
            ? { tab: { id: TAB_ID, claudeSessionId: 'owner', status: tabStatus() } } : undefined,
          findTabBySessionIdAcrossWorkspaces: () => undefined,
        } },
        { provide: PermissionHandlerService, useValue: {
          permissionRequests: signal([]), questionRequests: signal([]),
          targetTabsFor: () => [], questionTargetTabsFor: () => [], routingTargetRevision: signal(0),
        } },
      ],
    });
  });

  afterEach(() => { globalThis.ResizeObserver = originalResizeObserver as typeof ResizeObserver; });

  function create(rail = false) {
    const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
    fixture.componentRef.setInput('tabId', TAB_ID);
    fixture.componentRef.setInput('rail', rail);
    fixture.detectChanges();
    return fixture;
  }

  it.each([0, 4, 5, 6, 12])('starts safely with %i CLI agents before a width measurement', (count) => {
    agents.set(cliRoster(count));
    const fixture = create();
    const root: HTMLElement = fixture.nativeElement;
    expect(tabs(root)).toHaveLength(1);
    expect(tabs(root)[0].id).toContain('orchestrator');
    if (count > 0) expect(trigger(root)?.textContent).toContain(`+${count}`);
    expect(trigger(root) === null).toBe(count === 0);
    fixture.destroy();
  });

  it('uses the same one-chip plan when ResizeObserver is unavailable', () => {
    Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, writable: true, value: undefined });
    agents.set(cliRoster(8));
    const fixture = create();
    const root: HTMLElement = fixture.nativeElement;
    expect(tabs(root)).toHaveLength(1);
    expect(trigger(root)?.getAttribute('aria-label')).toBe('8 more agents');
    fixture.destroy();
  });

  it('caps measured widths at five chips and keeps overflow at zero width', async () => {
    agents.set(cliRoster(9));
    const fixture = create();
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(observe).toHaveBeenCalledTimes(1);
    fireResize(resize, 760);
    fixture.detectChanges();
    expect(tabs(root)).toHaveLength(5);
    expect(trigger(root)?.getAttribute('aria-label')).toBe('5 more agents');
    fireResize(resize, 300);
    fixture.detectChanges();
    expect(tabs(root).length).toBeLessThanOrEqual(3);
    fireResize(resize, 0);
    fixture.detectChanges();
    expect(tabs(root)).toHaveLength(0);
    expect(trigger(root)?.getAttribute('aria-label')).toBe('10 more agents');
    trigger(root)?.click();
    fixture.detectChanges();
    expect(root.querySelectorAll('[role="menuitemradio"]')).toHaveLength(10);
    expect(root.querySelector('[role="menuitemradio"][aria-checked="true"]')?.textContent).toContain('Orchestrator');
    fixture.destroy();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('renders selected non-running first, then running chips across kinds in roster order', async () => {
    agents.set([cli(0), cli(1, 'failed'), cli(2)]);
    subagents.set(new Map([['s', { parentToolUseId: 's', parentSessionId: 'owner', status: 'running', agentType: 'Worker' }]]));
    background.set([{ toolCallId: 'b', sessionId: 'owner', agentType: 'Review', status: 'running' }]);
    const fixture = create();
    await fixture.whenStable();
    fireResize(resize, 760);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const shown = tabs(root);
    expect(shown.length).toBeLessThanOrEqual(5);
    expect(shown[0].id).toContain('orchestrator');
    const statuses = shown.slice(1).map((tab) => tab.getAttribute('aria-label') ?? '');
    const firstNonRunning = statuses.findIndex((label) => !label.includes('running'));
    if (firstNonRunning >= 0) expect(statuses.slice(firstNonRunning).every((label) => !label.includes('running'))).toBe(true);
    expect(shown.some((tab) => tab.id.includes('cli:c0'))).toBe(true);
    fixture.destroy();
  });

  it('moves focus in rendered order without selection and selects on click', async () => {
    agents.set(cliRoster(6));
    const fixture = create();
    await fixture.whenStable();
    fireResize(resize, 760);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    document.body.appendChild(root);
    try {
      const select = jest.fn();
      fixture.componentInstance.laneSelected.subscribe(select);
      tabs(root)[0].focus();
      for (const [key, expected] of [['ArrowRight', 1], ['End', 4], ['Home', 0], ['ArrowLeft', 4]] as const) {
        (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        fixture.detectChanges();
        await fixture.whenStable();
        expect(document.activeElement).toBe(tabs(root)[expected]);
        expect(tabs(root).filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
      }
      expect(select).not.toHaveBeenCalled();
      tabs(root)[4].click();
      expect(select).toHaveBeenCalledWith('cli:c3');
    } finally { root.remove(); fixture.destroy(); }
  });

  it.each(['waiting', 'failed'])('keeps at most five frozen chips when an agent becomes %s, then replans on blur', async (status) => {
    agents.set(cliRoster(7));
    const fixture = create();
    await fixture.whenStable();
    fireResize(resize, 760);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    document.body.appendChild(root);
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    try {
      const before = ids(root);
      tabs(root)[1].focus();
      tabs(root)[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
      fixture.detectChanges();
      await fixture.whenStable();
      agents.set(cliRoster(7).map((item) => item.agentId !== 'c1' ? item
        : status === 'waiting'
          ? { ...item, permissionQueue: [{ requestId: 'pending' }] }
          : { ...item, status: 'failed' }));
      fixture.detectChanges();
      expect(ids(root)).toEqual(before);
      expect(tabs(root)).toHaveLength(5);
      outside.focus();
      fixture.detectChanges();
      expect(ids(root)).not.toEqual(before);
      expect(tabs(root)).toHaveLength(5);
      expect(root.querySelector('[aria-selected="true"]')?.id).toContain('orchestrator');
    } finally { outside.remove(); root.remove(); fixture.destroy(); }
  });

  it('moves focus to overflow if a resize hides its focused chip', async () => {
    agents.set(cliRoster(6));
    const fixture = create();
    await fixture.whenStable();
    fireResize(resize, 760);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    document.body.appendChild(root);
    try {
      tabs(root)[4].focus();
      fireResize(resize, 0);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(tabs(root)).toHaveLength(0);
      expect(document.activeElement).toBe(trigger(root));
      expect(trigger(root)?.getAttribute('aria-label')).toBe('7 more agents');
    } finally { root.remove(); fixture.destroy(); }
  });

  it('keeps the menu closed and returns focus after choosing a hidden lane', async () => {
    agents.set(cliRoster(6));
    const fixture = create();
    const root: HTMLElement = fixture.nativeElement;
    document.body.appendChild(root);
    try {
      const selected = jest.fn();
      fixture.componentInstance.laneSelected.subscribe((key) => {
        selected(key);
        fixture.componentRef.setInput('laneKey', key);
      });
      const overflow = trigger(root)!;
      overflow.click();
      fixture.detectChanges();
      await fixture.whenStable();
      root.querySelector<HTMLButtonElement>('[role="menuitemradio"]')!.click();
      fixture.detectChanges();
      await fixture.whenStable();
      expect(selected).toHaveBeenCalledWith('cli:c0');
      expect(root.querySelector('[role="menu"]')).toBeNull();
      expect(trigger(root)?.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(trigger(root));
    } finally { root.remove(); fixture.destroy(); }
  });

  it('keeps the rail strip at five active avatars and expands overflow', () => {
    agents.set(cliRoster(7));
    const fixture = create(true);
    const root: HTMLElement = fixture.nativeElement;
    expect(tabs(root)).toHaveLength(5);
    expect(root.querySelector('[role="tablist"] [aria-haspopup="menu"]')).toBeNull();
    const expand = jest.fn();
    fixture.componentInstance.expandRequested.subscribe(expand);
    root.querySelector<HTMLButtonElement>('[aria-label="Show 2 more active agents"]')?.click();
    expect(expand).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });

  it('keeps hover details available for unnamed chips', async () => {
    agents.set(cliRoster(6));
    const fixture = create();
    await fixture.whenStable();
    fireResize(resize, 760);
    fixture.detectChanges();
    jest.useFakeTimers({ doNotFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    try {
      const root: HTMLElement = fixture.nativeElement;
      const chip = tabs(root)[1];
      const pointer = Object.defineProperty(new MouseEvent('pointerenter', { bubbles: true }), 'pointerType', { value: 'mouse' });
      chip.dispatchEvent(pointer);
      jest.advanceTimersByTime(220);
      fixture.detectChanges();
      expect(root.querySelector('[role="tooltip"]')).not.toBeNull();
      expect(chip.getAttribute('aria-describedby')).toBe('canvas-lane-panel-agent-card');
    } finally { jest.useRealTimers(); fixture.destroy(); }
  });
});
