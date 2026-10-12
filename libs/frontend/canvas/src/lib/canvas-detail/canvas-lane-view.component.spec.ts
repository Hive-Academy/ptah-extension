import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import {
  AgentCardComponent,
  AgentPermissionResponder,
} from '@ptah-extension/chat';
import {
  AgentMonitorStore,
  BackgroundAgentStore,
  PermissionHandlerService,
} from '@ptah-extension/chat-streaming';
import { CanvasLaneViewComponent } from './canvas-lane-view.component';
import { ClaudeRpcService } from '@ptah-extension/core';

describe('CanvasLaneViewComponent', () => {
  const agents = signal<any[]>([]);
  const subagents = signal(new Map<string, any>());
  const background = signal<any[]>([]);
  const permissionRequests = signal<any[]>([]);
  const stopAgent = jest.fn().mockResolvedValue(undefined);
  const toggleAgentExpanded = jest.fn();
  const respondLane = jest.fn();
  const respondSession = jest.fn();
  const getSubagentTranscript = jest.fn().mockResolvedValue([]);

  beforeEach(() => {
    agents.set([]);
    subagents.set(new Map());
    background.set([]);
    permissionRequests.set([]);
    stopAgent.mockClear();
    toggleAgentExpanded.mockClear();
    respondLane.mockClear();
    respondSession.mockClear();
    getSubagentTranscript.mockClear();
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
            getSubagentTranscript,
          },
        },
        { provide: BackgroundAgentStore, useValue: { agents: background } },
        { provide: PermissionHandlerService, useValue: { permissionRequests } },
        {
          provide: AgentPermissionResponder,
          useValue: { respondLane, respondSession },
        },
        { provide: ClaudeRpcService, useValue: {} },
      ],
    });
    TestBed.overrideComponent(CanvasLaneViewComponent, {
      set: {
        imports: [AgentCardComponent, NgTemplateOutlet],
        schemas: [NO_ERRORS_SCHEMA],
      },
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
    expect(respondLane).toHaveBeenNthCalledWith(1, 'a', 'r', 'allow');
    expect(respondLane).toHaveBeenNthCalledWith(2, 'a', 'r', 'deny');
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

  it('answers a sub-agent session permission and retains transcript across progress', () => {
    const sub = {
      parentToolUseId: 'task-tool',
      parentSessionId: 'owner',
      agentId: 'sub',
      status: 'running',
    };
    subagents.set(new Map([['task-tool', sub]]));
    const request = {
      id: 'permission',
      toolName: 'Write',
      agentToolCallId: 'task-tool',
      sessionId: 'owner',
    };
    permissionRequests.set([request]);
    const fixture = TestBed.createComponent(CanvasLaneViewComponent);
    fixture.componentRef.setInput('tabId', 'tab');
    fixture.componentRef.setInput('sessionId', 'owner');
    fixture.componentRef.setInput('laneKey', 'sub:task-tool');
    fixture.detectChanges();
    const buttons = [
      ...fixture.nativeElement.querySelectorAll(
        '[aria-label="Permission request"] button',
      ),
    ] as HTMLButtonElement[];
    expect(buttons).toHaveLength(2);
    buttons[0].click();
    buttons[1].click();
    expect(respondSession).toHaveBeenNthCalledWith(1, request, 'allow', 'tab');
    expect(respondSession).toHaveBeenNthCalledWith(2, request, 'deny', 'tab');
    subagents.set(new Map([['task-tool', { ...sub, progress: 1 }]]));
    fixture.detectChanges();
    expect(getSubagentTranscript).toHaveBeenCalledTimes(1);
  });
});
