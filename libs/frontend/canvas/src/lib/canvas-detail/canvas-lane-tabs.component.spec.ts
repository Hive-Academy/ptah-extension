import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  AgentMonitorStore,
  BackgroundAgentStore,
} from '@ptah-extension/chat-streaming';
import { CanvasLaneTabsComponent } from './canvas-lane-tabs.component';

describe('CanvasLaneTabsComponent', () => {
  const agents = signal<any[]>([]);
  const subagents = signal(new Map<string, any>());
  const background = signal<any[]>([]);

  beforeEach(() => {
    agents.set([]);
    subagents.set(new Map());
    background.set([]);
    TestBed.configureTestingModule({
      imports: [CanvasLaneTabsComponent],
      providers: [
        { provide: AgentMonitorStore, useValue: { agents, subagents } },
        { provide: BackgroundAgentStore, useValue: { agents: background } },
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
      {
        agentId: 'c',
        parentSessionId: 'owner',
        cli: 'Codex',
        status: 'completed',
      },
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
    fixture.componentRef.setInput('sessionId', 'owner');
    fixture.detectChanges();
    const tabs = [
      ...fixture.nativeElement.querySelectorAll('[role="tab"]'),
    ] as HTMLElement[];
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual([
      'Orchestrator',
      'Worker',
      'Codex',
      'Review',
    ]);
    expect(fixture.nativeElement.textContent).toContain('Sub-agents');
    expect(fixture.nativeElement.textContent).toContain('CLI lanes');
    expect(fixture.nativeElement.textContent).toContain('Background');
    expect(tabs[2].getAttribute('title')).toBe('completed');
  });

  it('excludes foreign and unresolved owners and falls back for an unknown key', () => {
    agents.set([
      { agentId: 'foreign', parentSessionId: 'other', cli: 'Other' },
      { agentId: 'unknown', cli: 'Unknown' },
    ]);
    subagents.set(
      new Map([['x', { parentToolUseId: 'x', status: 'running' }]]),
    );
    background.set([{ toolCallId: 'b', agentType: 'Unowned' }]);
    const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
    fixture.componentRef.setInput('sessionId', 'owner');
    fixture.componentRef.setInput('laneKey', 'cli:gone');
    const selected = jest.fn();
    fixture.componentInstance.laneSelected.subscribe(selected);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[role="tab"]')).toHaveLength(
      1,
    );
    expect(
      fixture.nativeElement
        .querySelector('[role="tab"]')
        .getAttribute('aria-selected'),
    ).toBe('true');
    expect(selected).toHaveBeenCalledWith('orchestrator');
  });

  it('migrates a selected sub-agent tab to its background tab', () => {
    const sub = { parentToolUseId: 'x', parentSessionId: 'owner', status: 'running', agentType: 'Worker' };
    subagents.set(new Map([['x', sub]]));
    const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
    fixture.componentRef.setInput('sessionId', 'owner');
    fixture.componentRef.setInput('laneKey', 'sub:x');
    const selected = jest.fn();
    fixture.componentInstance.laneSelected.subscribe(selected);
    fixture.detectChanges();
    expect(selected).not.toHaveBeenCalled();

    subagents.set(new Map([['x', { ...sub, status: 'background' }]]));
    fixture.detectChanges();
    expect(selected).toHaveBeenCalledWith('bg:x');
    expect(selected).not.toHaveBeenCalledWith('orchestrator');
    expect(fixture.nativeElement.querySelector('[role="tab"][aria-selected="true"]').id).toContain('bg:x');
  });

  it('shows an owned CLI lane once while excluding unresolved and foreign lanes', () => {
    agents.set([
      { agentId: 'unowned', cli: 'Unowned', status: 'running' },
      { agentId: 'foreign', parentSessionId: 'other', cli: 'Foreign', status: 'running' },
      { agentId: 'owned', parentSessionId: 'owner', cli: 'Owned', status: 'running' },
    ]);
    const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
    fixture.componentRef.setInput('sessionId', 'owner');
    fixture.detectChanges();
    const tabs = [...fixture.nativeElement.querySelectorAll('[role="tab"]')] as HTMLElement[];
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(['Orchestrator', 'Owned']);
    expect(tabs.filter((tab) => tab.id.includes('cli:owned'))).toHaveLength(1);
  });

  it('moves between tabs with arrow keys', () => {
    agents.set([
      {
        agentId: 'c',
        parentSessionId: 'owner',
        cli: 'Codex',
        status: 'running',
      },
    ]);
    const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
    fixture.componentRef.setInput('sessionId', 'owner');
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

  it('reveals the selected tab on strip resize and disconnects on destroy', async () => {
    const original = globalThis.ResizeObserver;
    let resize: ResizeObserverCallback = () => undefined;
    const disconnect = jest.fn();
    const observe = jest.fn();
    globalThis.ResizeObserver = jest.fn().mockImplementation((callback: ResizeObserverCallback) => {
      resize = callback;
      return { observe, disconnect };
    });
    const scrollIntoView = jest.fn();
    const previous = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    try {
      const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
      fixture.componentRef.setInput('sessionId', 'owner');
      fixture.detectChanges();
      await fixture.whenStable();
      expect(observe).toHaveBeenCalledTimes(1);
      resize([], {} as ResizeObserver);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
      fixture.destroy();
      expect(disconnect).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.ResizeObserver = original;
      HTMLElement.prototype.scrollIntoView = previous;
    }
  });

  it('reveals a newly selected lane', async () => {
    agents.set([{ agentId: 'c', parentSessionId: 'owner', cli: 'Codex', status: 'running' }]);
    const scrollIntoView = jest.fn();
    const previous = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    try {
      const fixture = TestBed.createComponent(CanvasLaneTabsComponent);
      fixture.componentRef.setInput('sessionId', 'owner');
      fixture.detectChanges();
      await fixture.whenStable();
      scrollIntoView.mockClear();
      fixture.componentRef.setInput('laneKey', 'cli:c');
      fixture.detectChanges();
      await fixture.whenStable();
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    } finally {
      HTMLElement.prototype.scrollIntoView = previous;
    }
  });
});
