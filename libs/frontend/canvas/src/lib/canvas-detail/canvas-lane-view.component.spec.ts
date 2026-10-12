import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  AgentCardComponent,
  AgentPermissionResponder,
} from '@ptah-extension/chat';
import {
  AgentMonitorStore,
  BackgroundAgentStore,
} from '@ptah-extension/chat-streaming';
import { CanvasLaneViewComponent } from './canvas-lane-view.component';
import { ClaudeRpcService } from '@ptah-extension/core';

describe('CanvasLaneViewComponent', () => {
  const agents = signal<any[]>([]);
  const subagents = signal(new Map<string, any>());
  const background = signal<any[]>([]);
  const stopAgent = jest.fn().mockResolvedValue(undefined);
  const toggleAgentExpanded = jest.fn();
  const respondLane = jest.fn();

  beforeEach(() => {
    agents.set([]);
    subagents.set(new Map());
    background.set([]);
    stopAgent.mockClear();
    toggleAgentExpanded.mockClear();
    respondLane.mockClear();
    TestBed.configureTestingModule({
      imports: [CanvasLaneViewComponent],
      providers: [
        {
          provide: AgentMonitorStore,
          useValue: {
            agents,
            subagents,
            stopAgent,
            toggleAgentExpanded,
            getSubagentTranscript: jest.fn().mockResolvedValue([]),
          },
        },
        { provide: BackgroundAgentStore, useValue: { agents: background } },
        { provide: AgentPermissionResponder, useValue: { respondLane } },
        { provide: ClaudeRpcService, useValue: {} },
      ],
    });
    TestBed.overrideComponent(CanvasLaneViewComponent, {
      set: { imports: [AgentCardComponent], schemas: [NO_ERRORS_SCHEMA] },
    });
    TestBed.overrideComponent(AgentCardComponent, {
      set: { template: '<span>CLI card</span>', imports: [] },
    });
  });

  it('renders one card, expands it once, and destroys it on lane switch', () => {
    agents.set([
      {
        agentId: 'a',
        parentSessionId: 'owner',
        cli: 'Codex',
        expanded: false,
        permissionQueue: [],
      },
      {
        agentId: 'b',
        parentSessionId: 'owner',
        cli: 'Claude',
        expanded: true,
        permissionQueue: [],
      },
    ]);
    const fixture = TestBed.createComponent(CanvasLaneViewComponent);
    fixture.componentRef.setInput('tabId', 'tab');
    fixture.componentRef.setInput('sessionId', 'owner');
    fixture.componentRef.setInput('laneKey', 'cli:a');
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelectorAll('ptah-agent-card'),
    ).toHaveLength(1);
    const previousCard = fixture.nativeElement.querySelector('ptah-agent-card');
    expect(toggleAgentExpanded).toHaveBeenCalledWith('a');
    fixture.componentRef.setInput('laneKey', 'cli:b');
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelectorAll('ptah-agent-card'),
    ).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('ptah-agent-card')).not.toBe(
      previousCard,
    );
    expect(toggleAgentExpanded).not.toHaveBeenCalledWith('b');
  });

  it('uses the owner for stop and the responder for Allow and Deny', async () => {
    agents.set([
      {
        agentId: 'a',
        parentSessionId: 'owner',
        cli: 'Codex',
        expanded: true,
        permissionQueue: [{ requestId: 'r', toolName: 'Write' }],
      },
    ]);
    const fixture = TestBed.createComponent(CanvasLaneViewComponent);
    fixture.componentRef.setInput('tabId', 'tab');
    fixture.componentRef.setInput('sessionId', 'owner');
    fixture.componentRef.setInput('laneKey', 'cli:a');
    fixture.detectChanges();
    const buttons = [
      ...fixture.nativeElement.querySelectorAll('button'),
    ] as HTMLButtonElement[];
    buttons[0].click();
    buttons[1].click();
    expect(respondLane).toHaveBeenNthCalledWith(
      1,
      'a',
      'r',
      'allow',
      undefined,
    );
    expect(respondLane).toHaveBeenNthCalledWith(
      2,
      'a',
      'r',
      'deny',
      'User denied',
    );
    await fixture.componentInstance.stop('task', 'owner');
    expect(stopAgent).toHaveBeenCalledWith('task', 'owner');
  });

  it('does not show a foreign or unresolved agent', () => {
    agents.set([
      {
        agentId: 'a',
        parentSessionId: 'other',
        cli: 'Codex',
        expanded: true,
        permissionQueue: [],
      },
    ]);
    const fixture = TestBed.createComponent(CanvasLaneViewComponent);
    fixture.componentRef.setInput('tabId', 'tab');
    fixture.componentRef.setInput('sessionId', 'owner');
    fixture.componentRef.setInput('laneKey', 'cli:a');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('ptah-agent-card')).toBeNull();
  });
});
