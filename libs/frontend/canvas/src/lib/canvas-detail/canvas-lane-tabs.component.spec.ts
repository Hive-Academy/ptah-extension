import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
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

  it('orders populated groups and keeps terminal lanes', () => {
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
    const dock = fixture.nativeElement.querySelector('[role="tablist"]') as HTMLElement;
    expect(dock.classList.contains('z-10')).toBe(true);
    expect(dock.classList.contains('z-20')).toBe(false);
    expect(dock.querySelector('ptah-agent-dock-menu')).not.toBeNull();
    expect(dock.classList.contains('pb-1')).toBe(true);
    expect(dock.classList.contains('shadow-[0_6px_8px_-6px_rgb(0_0_0/0.45)]')).toBe(true);
    expect(dock.classList.contains('border-b')).toBe(true);
    expect(dock.classList.contains('border-surface-border')).toBe(true);
    expect(dock.classList.contains('bg-surface-1')).toBe(true);
    const tabs = [
      ...fixture.nativeElement.querySelectorAll('[role="tab"]'),
    ] as HTMLElement[];
    expect(tabLabels(fixture.nativeElement)).toEqual([
      'Orchestrator, done',
      'Worker, Sub-agent, done',
      'Codex, CLI lane, done',
      'Review, Background, done',
    ]);
    expect(fixture.nativeElement.querySelectorAll('[data-testid="dock-divider"]')).toHaveLength(3);
    expect(tabs[2].getAttribute('aria-label')).toContain('done');
    expect(tabs[2].getAttribute('title')).toBeNull();

    tabStatus.set('streaming');
    fixture.detectChanges();
    expect(tabLabels(fixture.nativeElement)[0]).toBe('Orchestrator, running');

    const trigger = fixture.nativeElement.querySelector(
      '[aria-haspopup="menu"]',
    ) as HTMLButtonElement;
    expect(trigger.getAttribute('aria-label')).toBe('4 agents');
    trigger.click();
    fixture.detectChanges();
    const menu = fixture.nativeElement.querySelector('[role="menu"]') as HTMLElement;
    expect(dock.contains(menu)).toBe(true);
    expect(menu.textContent).toContain('Orchestrator');
    expect(menu.textContent).toContain('Sub-agents');
    expect(menu.textContent).toContain('CLI lanes');
    expect(menu.textContent).toContain('Background');
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
    const tabs = [...fixture.nativeElement.querySelectorAll('[role="tab"]')] as HTMLElement[];
    expect(tabLabels(fixture.nativeElement)).toEqual([
      'Orchestrator, done',
      'Owned, CLI lane, running',
    ]);
    expect(tabs.filter((tab) => tab.id.includes('cli:owned'))).toHaveLength(1);
  });

  it('moves between tabs with arrow keys', () => {
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
    const selected = jest.fn();
    fixture.componentInstance.laneSelected.subscribe(selected);
    fixture.nativeElement
      .querySelector('[role="tab"]')
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
    expect(selected).toHaveBeenCalledWith('cli:c');
  });

  it('keeps a waiting agent and hides a done one at 400px, and disconnects the observer', async () => {
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
      ]);
      const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
      fixture.componentRef.setInput('tabId', TAB_ID);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(observe).toHaveBeenCalledTimes(1);
      fireResize(resize, 400);
      fixture.detectChanges();
      const labels = tabLabels(fixture.nativeElement);
      expect(labels).toHaveLength(4);
      expect(labels.some((label) => label.includes('Waiter'))).toBe(true);
      expect(labels.some((label) => label.includes('Finished'))).toBe(false);
      const selected = jest.fn();
      fixture.componentInstance.laneSelected.subscribe(selected);
      fixture.nativeElement
        .querySelector('[role="tab"]')
        .dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
        );
      expect(selected).toHaveBeenCalledWith('cli:wait');
      expect(selected).not.toHaveBeenCalledWith('cli:fin');
      fireResize(resize, 0);
      fixture.detectChanges();
      expect(tabLabels(fixture.nativeElement)).toEqual(['Orchestrator, done']);
      expect(
        fixture.nativeElement
          .querySelector('[aria-haspopup="menu"]')
          .getAttribute('aria-label'),
      ).toBe('5 agents, 1 waiting, needs you, 1 failed');
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
      fireResize(resize, 320);
      fixture.detectChanges();
      expect(tabLabels(fixture.nativeElement).some((label) => label.includes('Finished'))).toBe(
        false,
      );
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

  it('selects from the menu with Enter, returns focus on Escape, and describes the hovered tab', async () => {
    const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
    fixture.componentRef.setInput('tabId', TAB_ID);
    const selected = jest.fn();
    fixture.componentInstance.laneSelected.subscribe(selected);
    fixture.detectChanges();
    const trigger = fixture.nativeElement.querySelector(
      '[aria-haspopup="menu"]',
    ) as HTMLButtonElement;

    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const menu = fixture.nativeElement.querySelector('[role="menu"]') as HTMLElement;
    expect(menu).not.toBeNull();
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
    expect(selected).toHaveBeenCalledWith('orchestrator');
    expect(fixture.nativeElement.querySelector('[role="menu"]')).toBeNull();

    jest.useFakeTimers();
    try {
      const tab = fixture.nativeElement.querySelector('[role="tab"]') as HTMLElement;
      // jsdom has no PointerEvent constructor.
      const pointerEnter = (pointerType: string): Event =>
        Object.defineProperty(
          new MouseEvent('pointerenter', { bubbles: true }),
          'pointerType',
          { value: pointerType },
        );
      // Menu Enter returned keyboard focus to the tab, which opened its card.
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
      expect(
        fixture.nativeElement.querySelector('[role="tab"][aria-selected="true"]').id,
      ).toContain('orchestrator');
    } finally {
      jest.useRealTimers();
    }
  });
});
