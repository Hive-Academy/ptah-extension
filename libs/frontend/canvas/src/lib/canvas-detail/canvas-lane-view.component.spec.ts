import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideMarkdown } from 'ngx-markdown';
import {
  AgentCardComponent,
  AgentPermissionResponder,
  ChatStore,
  RAIL_MIN_CONTENT_WIDTH,
  SESSION_FOCUSED,
  SESSION_VISIBLE,
  SessionEmbedComponent,
  ExecutionNodeComponent,
  SubagentLaneComponent,
  TabManagerService,
} from '@ptah-extension/chat';
import {
  AgentMonitorStore,
  ExecutionTreeBuilderService,
  BackgroundAgentStore,
  PermissionHandlerService,
} from '@ptah-extension/chat-streaming';
import { CanvasLaneViewComponent } from './canvas-lane-view.component';
import {
  ClaudeRpcService,
  EffortStateService,
  FILE_LINK_OPENER,
  ModelStateService,
  SURFACE_ACTIVE,
} from '@ptah-extension/core';
import { CanvasDetailService } from './canvas-detail.service';
import { CanvasDetailTranscriptComponent } from './canvas-detail-transcript.component';
import { CanvasStore } from '../canvas.store';

@Component({
  selector: 'ptah-test-chat-view',
  standalone: true,
  template:
    '<button type="button" class="opener">Open agent</button><textarea aria-label="Draft"></textarea>',
})
class ChatViewStubComponent {}

describe('CanvasLaneViewComponent', () => {
  const agents = signal<any[]>([]);
  const subagents = signal(new Map<string, any>());
  const background = signal<any[]>([]);
  const permissionRequests = signal<any[]>([]);
  const stopAgent = jest.fn().mockResolvedValue(undefined);
  const backgroundAgent = jest.fn().mockResolvedValue(undefined);
  const sendMessageToAgent = jest.fn().mockResolvedValue(true);
  const getPermissionForTool = jest.fn();
  const handlePermissionResponse = jest.fn();
  const toggleAgentExpanded = jest.fn();
  const respondLane = jest.fn();
  const respondSession = jest.fn();
  const getSubagentTranscript = jest.fn().mockResolvedValue([]);
  const tabRecord = signal<any>(null);
  const selectLaneFor = jest.fn();

  beforeEach(() => {
    agents.set([]);
    subagents.set(new Map());
    background.set([]);
    permissionRequests.set([]);
    stopAgent.mockClear();
    backgroundAgent.mockClear();
    sendMessageToAgent.mockClear();
    getPermissionForTool.mockReset();
    handlePermissionResponse.mockClear();
    toggleAgentExpanded.mockClear();
    respondLane.mockClear();
    respondSession.mockClear();
    getSubagentTranscript.mockClear();
    tabRecord.set(null);
    selectLaneFor.mockClear();
    TestBed.configureTestingModule({
      imports: [CanvasLaneViewComponent],
      providers: [
        provideMarkdown(),
        {
          provide: AgentMonitorStore,
          useValue: {
            agents,
            subagents,
            stopAgent,
            toggleAgentExpanded,
            getSubagentTranscript,
            subagentRpcError: signal(null),
            tick: signal(0),
            backgroundAgent,
            sendMessageToAgent,
          },
        },
        {
          provide: BackgroundAgentStore,
          useValue: {
            agents: background,
            isBackgroundAgent: jest.fn(() => false),
          },
        },
        { provide: PermissionHandlerService, useValue: { permissionRequests } },
        {
          provide: AgentPermissionResponder,
          useValue: { respondLane, respondSession },
        },
        { provide: ClaudeRpcService, useValue: {} },
        {
          provide: EffortStateService,
          useValue: { isLoaded: signal(false), currentEffort: signal(null) },
        },
        {
          provide: ModelStateService,
          useValue: { isLoaded: signal(false), currentModel: signal(null) },
        },
        {
          provide: ChatStore,
          useValue: { getPermissionForTool, handlePermissionResponse },
        },
        {
          provide: TabManagerService,
          useValue: {
            findTabByIdAcrossWorkspaces: () =>
              tabRecord() ? { tab: tabRecord() } : null,
            visibleTabIds: signal<ReadonlySet<string>>(new Set()),
            registerVisibleTab: jest.fn(),
            unregisterVisibleTab: jest.fn(),
            tabs: signal([]),
          },
        },
        {
          provide: ExecutionTreeBuilderService,
          useValue: { buildTree: () => [] },
        },
        { provide: CanvasDetailService, useValue: { selectLaneFor } },
        { provide: CanvasStore, useValue: { startBlockReason: jest.fn() } },
        { provide: SURFACE_ACTIVE, useValue: signal(true) },
        { provide: FILE_LINK_OPENER, useValue: { open: jest.fn() } },
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

  it('keeps the lane subtree for unrelated input changes and replaces it on lane switch', () => {
    const fixture = TestBed.createComponent(CanvasLaneViewComponent);
    fixture.componentRef.setInput('tabId', 'tab');
    fixture.componentRef.setInput('laneKey', 'orchestrator');
    fixture.detectChanges();
    const lane = fixture.nativeElement.querySelector('.rail-lane-enter');
    expect(lane).not.toBeNull();

    fixture.componentRef.setInput('paneFocused', false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.rail-lane-enter')).toBe(lane);

    fixture.componentRef.setInput('laneKey', 'cli:a');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.rail-lane-enter')).not.toBe(lane);
  });

  it('does not reopen a CLI lane after its user collapses it', () => {
    const agent = {
      agentId: 'a',
      parentSessionId: 'owner',
      cli: 'Codex',
      expanded: false,
      permissionQueue: [],
    };
    agents.set([agent]);
    const fixture = TestBed.createComponent(CanvasLaneViewComponent);
    fixture.componentRef.setInput('tabId', 'tab');
    fixture.componentRef.setInput('sessionId', 'owner');
    fixture.componentRef.setInput('laneKey', 'cli:a');
    fixture.detectChanges();
    expect(toggleAgentExpanded).toHaveBeenCalledTimes(1);
    agents.set([{ ...agent, expanded: true }]);
    fixture.detectChanges();
    agents.set([{ ...agent, expanded: false }]);
    fixture.detectChanges();
    expect(toggleAgentExpanded).toHaveBeenCalledTimes(1);
  });

  it('expands the same CLI lane again after switching away and re-selecting it', () => {
    const agent = {
      agentId: 'a',
      parentSessionId: 'owner',
      cli: 'Codex',
      expanded: false,
      permissionQueue: [],
    };
    agents.set([agent]);
    const fixture = TestBed.createComponent(CanvasLaneViewComponent);
    fixture.componentRef.setInput('tabId', 'tab');
    fixture.componentRef.setInput('sessionId', 'owner');
    fixture.componentRef.setInput('laneKey', 'cli:a');
    fixture.detectChanges();
    expect(toggleAgentExpanded).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('laneKey', 'orchestrator');
    fixture.detectChanges();
    fixture.componentRef.setInput('laneKey', 'cli:a');
    fixture.detectChanges();
    expect(toggleAgentExpanded).toHaveBeenCalledTimes(2);
  });

  it('uses the owner responder for CLI Allow and Deny', () => {
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
      ...fixture.nativeElement.querySelectorAll(
        'button',
      ),
    ] as HTMLButtonElement[];
    buttons[0].click();
    buttons[1].click();
    expect(respondLane).toHaveBeenNthCalledWith(1, 'a', 'r', 'allow');
    expect(respondLane).toHaveBeenNthCalledWith(2, 'a', 'r', 'deny');
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

  it('leaves sub-agent permissions to the inline bubble and retains transcript across progress', () => {
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
    expect(
      fixture.nativeElement.querySelector('[aria-label="Permission request"]'),
    ).toBeNull();
    expect(respondSession).not.toHaveBeenCalled();
    subagents.set(new Map([['task-tool', { ...sub, progress: 1 }]]));
    fixture.detectChanges();
    expect(getSubagentTranscript).toHaveBeenCalledTimes(1);
  });

  it('renders a live depth-2 agent with full tile mode and returns on Escape', async () => {
    TestBed.overrideComponent(CanvasLaneViewComponent, {
      set: {
        imports: [AgentCardComponent, NgTemplateOutlet, SubagentLaneComponent],
        schemas: [NO_ERRORS_SCHEMA],
      },
    });
    const nested = { type: 'agent', toolCallId: 'nested', children: [] };
    const agent = {
      type: 'agent',
      toolCallId: 'task-tool',
      children: [nested],
      summaryContent: 'Investigation finished',
    };
    tabRecord.set({
      messages: [{ streamingState: { type: 'root', children: [agent] } }],
      streamingState: null,
    });
    subagents.set(
      new Map([
        [
          'task-tool',
          {
            parentToolUseId: 'task-tool',
            parentSessionId: 'owner',
            agentId: 'sub',
            status: 'completed',
          },
        ],
      ]),
    );
    const fixture = TestBed.createComponent(CanvasLaneViewComponent);
    fixture.componentRef.setInput('tabId', 'tab');
    fixture.componentRef.setInput('sessionId', 'owner');
    fixture.componentRef.setInput('laneKey', 'sub:task-tool');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.agentNode()).toBe(agent);
    expect(
      fixture.nativeElement.querySelector('ptah-subagent-lane'),
    ).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Investigation finished');
    expect(fixture.nativeElement.querySelectorAll('ptah-execution-header')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('ptah-subagent-usage-summary')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('ptah-subagent-transcript-viewer'),
    ).toBeNull();
    fixture.nativeElement.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(selectLaneFor).toHaveBeenCalledWith('tab', 'orchestrator');
  });

  it('labels the saved transcript fallback without a contradictory empty state and offers Refresh', () => {
    subagents.set(
      new Map([
        [
          'task-tool',
          {
            parentToolUseId: 'task-tool',
            parentSessionId: 'owner',
            agentId: 'sub',
            status: 'completed',
          },
        ],
      ]),
    );
    const fixture = TestBed.createComponent(CanvasLaneViewComponent);
    fixture.componentRef.setInput('tabId', 'tab');
    fixture.componentRef.setInput('sessionId', 'owner');
    fixture.componentRef.setInput('laneKey', 'sub:task-tool');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Live agent unavailable. Showing saved transcript.',
    );
    expect(fixture.nativeElement.textContent).not.toContain('No output recorded');
    expect(
      fixture.nativeElement.querySelector('ptah-subagent-transcript-viewer'),
    ).not.toBeNull();
    fixture.componentInstance.loadTranscript('sub', 'owner');
    expect(getSubagentTranscript).toHaveBeenCalled();
  });

  it('opens a backgrounded agent as a full live lane without fetching an RPC transcript', () => {
    const agent = { type: 'agent', toolCallId: 'task-tool', children: [] };
    tabRecord.set({
      messages: [{ streamingState: agent }],
      streamingState: null,
    });
    subagents.set(
      new Map([
        [
          'task-tool',
          {
            parentToolUseId: 'task-tool',
            parentSessionId: 'owner',
            agentId: 'sub',
            status: 'background',
          },
        ],
      ]),
    );
    const fixture = TestBed.createComponent(CanvasLaneViewComponent);
    fixture.componentRef.setInput('tabId', 'tab');
    fixture.componentRef.setInput('sessionId', 'owner');
    fixture.componentRef.setInput('laneKey', 'bg:task-tool');
    fixture.detectChanges();
    expect(fixture.componentInstance.agentNode()).toBe(agent);
    expect(
      fixture.nativeElement.querySelector('ptah-subagent-lane'),
    ).not.toBeNull();
    expect(getSubagentTranscript).not.toHaveBeenCalled();
  });

  it('keeps the same sub-agent lane open when its record becomes backgrounded', () => {
    const agent = { type: 'agent', toolCallId: 'task-tool', children: [] };
    tabRecord.set({
      messages: [{ streamingState: agent }],
      streamingState: null,
    });
    const sub = {
      parentToolUseId: 'task-tool',
      parentSessionId: 'owner',
      agentId: 'sub',
      status: 'running',
    };
    subagents.set(new Map([['task-tool', sub]]));
    const fixture = TestBed.createComponent(CanvasLaneViewComponent);
    fixture.componentRef.setInput('tabId', 'tab');
    fixture.componentRef.setInput('sessionId', 'owner');
    fixture.componentRef.setInput('laneKey', 'sub:task-tool');
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedKind()).toBe('subagent');
    subagents.set(new Map([['task-tool', { ...sub, status: 'background' }]]));
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedKind()).toBe('subagent');
    expect(fixture.componentInstance.agentNode()).toBe(agent);
    expect(
      fixture.nativeElement.querySelector('ptah-subagent-lane'),
    ).not.toBeNull();
  });

  it('keeps the migrated background lane open and labels it with the background tab', () => {
    const sub = {
      parentToolUseId: 'task-tool',
      parentSessionId: 'owner',
      agentId: 'sub',
      status: 'running',
    };
    subagents.set(new Map([['task-tool', sub]]));
    const fixture = TestBed.createComponent(CanvasLaneViewComponent);
    fixture.componentRef.setInput('tabId', 'tab');
    fixture.componentRef.setInput('sessionId', 'owner');
    fixture.componentRef.setInput('laneKey', 'sub:task-tool');
    fixture.detectChanges();
    subagents.set(new Map([['task-tool', { ...sub, status: 'background' }]]));
    fixture.componentRef.setInput('laneKey', 'bg:task-tool');
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedKind()).toBe('background');
    expect(
      fixture.nativeElement
        .querySelector('[role="tabpanel"]')
        .getAttribute('aria-labelledby'),
    ).toBe('canvas-lane-panel-tab-bg:task-tool');
    expect(fixture.nativeElement.querySelector('[role="tabpanel"]')?.getAttribute('tabindex')).toBe('-1');
    expect(fixture.nativeElement.querySelector('[aria-label="Back to conversation"]')).toBeNull();
  });

  it('resolves a nested depth-2 agent by its own lane key', () => {
    const nested = { type: 'agent', toolCallId: 'nested', children: [] };
    tabRecord.set({
      messages: [
        {
          streamingState: {
            type: 'agent',
            toolCallId: 'parent',
            children: [nested],
          },
        },
      ],
      streamingState: null,
    });
    subagents.set(
      new Map([
        [
          'nested',
          {
            parentToolUseId: 'nested',
            parentSessionId: 'owner',
            agentId: 'child',
            status: 'running',
          },
        ],
      ]),
    );
    const fixture = TestBed.createComponent(CanvasLaneViewComponent);
    fixture.componentRef.setInput('tabId', 'tab');
    fixture.componentRef.setInput('sessionId', 'owner');
    fixture.componentRef.setInput('laneKey', 'sub:nested');
    fixture.detectChanges();
    expect(fixture.componentInstance.agentNode()).toBe(nested);
    expect(
      fixture.nativeElement.querySelector('ptah-subagent-lane'),
    ).not.toBeNull();
  });

  it('keeps one transcript and draft while covering it, and focuses the lane then restores the opener', async () => {
    TestBed.overrideComponent(CanvasLaneViewComponent, {
      set: {
        imports: [
          AgentCardComponent,
          NgTemplateOutlet,
          CanvasDetailTranscriptComponent,
        ],
        schemas: [NO_ERRORS_SCHEMA],
      },
    });
    TestBed.overrideComponent(SessionEmbedComponent, {
      set: {
        template: '<ptah-test-chat-view />',
        imports: [ChatViewStubComponent],
      },
    });
    const sub = {
      parentToolUseId: 'task-tool',
      parentSessionId: 'owner',
      agentId: 'sub',
      status: 'running',
    };
    subagents.set(new Map([['task-tool', sub]]));
    const fixture = TestBed.createComponent(CanvasLaneViewComponent);
    fixture.componentRef.setInput('tabId', 'tab');
    fixture.componentRef.setInput('sessionId', 'owner');
    fixture.detectChanges();
    const transcript = fixture.debugElement.query(
      By.directive(CanvasDetailTranscriptComponent),
    );
    fixture.componentRef.setInput('paneFocused', false);
    fixture.componentRef.setInput('splitDisplayed', true);
    fixture.detectChanges();
    expect(
      transcript.componentInstance.childInjector.get(SESSION_VISIBLE)(),
    ).toBe(true);
    expect(
      transcript.componentInstance.childInjector.get(SESSION_FOCUSED)(),
    ).toBe(false);
    expect(
      transcript.componentInstance.childInjector.get(RAIL_MIN_CONTENT_WIDTH)(),
    ).toBe(360);
    fixture.componentRef.setInput('paneFocused', true);
    fixture.detectChanges();
    const chatView = fixture.debugElement.query(
      By.directive(ChatViewStubComponent),
    ).componentInstance;
    const opener = fixture.nativeElement.querySelector(
      '.opener',
    ) as HTMLButtonElement;
    const draft = fixture.nativeElement.querySelector(
      'textarea',
    ) as HTMLTextAreaElement;
    draft.value = 'keep this draft';
    opener.focus();
    fixture.componentRef.setInput('laneKey', 'sub:task-tool');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(
      fixture.debugElement.query(By.directive(CanvasDetailTranscriptComponent))
        .componentInstance,
    ).toBe(transcript.componentInstance);
    expect(
      fixture.debugElement.query(By.directive(ChatViewStubComponent))
        .componentInstance,
    ).toBe(chatView);
    expect(
      transcript.componentInstance.childInjector.get(SESSION_VISIBLE)(),
    ).toBe(false);
    expect(
      transcript.componentInstance.childInjector.get(SESSION_FOCUSED)(),
    ).toBe(false);
    expect(
      transcript.componentInstance.childInjector.get(SURFACE_ACTIVE)(),
    ).toBe(false);
    const panel = fixture.nativeElement.querySelector('[role="tabpanel"]') as HTMLElement;
    expect(document.activeElement).toBe(panel);
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.componentRef.setInput('laneKey', 'orchestrator');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(opener);
    expect(fixture.nativeElement.querySelector('textarea')).toBe(draft);
    expect(
      fixture.debugElement.query(By.directive(ChatViewStubComponent))
        .componentInstance,
    ).toBe(chatView);
    expect(draft.value).toBe('keep this draft');
    expect(
      transcript.componentInstance.childInjector.get(SESSION_VISIBLE)(),
    ).toBe(true);
    expect(selectLaneFor).toHaveBeenCalledWith('tab', 'orchestrator');
    selectLaneFor.mockClear();
    opener.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(selectLaneFor).not.toHaveBeenCalled();
    opener.focus();
    fixture.componentRef.setInput('laneKey', 'sub:task-tool');
    fixture.detectChanges();
    await fixture.whenStable();
    const editor = document.createElement('textarea');
    fixture.nativeElement.appendChild(editor);
    editor.focus();
    editor.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(selectLaneFor).not.toHaveBeenCalled();
    editor.remove();
    panel.focus();
    panel.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(selectLaneFor).toHaveBeenCalledWith('tab', 'orchestrator');
    fixture.componentRef.setInput('laneKey', 'orchestrator');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(opener);
    opener.remove();
    fixture.componentRef.setInput('laneKey', 'sub:task-tool');
    fixture.detectChanges();
    await fixture.whenStable();
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.componentRef.setInput('laneKey', 'orchestrator');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(draft);
  });

  it('keeps focus outside the lane view when a lane opens from the tab strip', async () => {
    subagents.set(
      new Map([
        [
          'task-tool',
          {
            parentToolUseId: 'task-tool',
            parentSessionId: 'owner',
            status: 'running',
          },
        ],
      ]),
    );
    const fixture = TestBed.createComponent(CanvasLaneViewComponent);
    fixture.componentRef.setInput('tabId', 'tab');
    fixture.componentRef.setInput('sessionId', 'owner');
    fixture.detectChanges();
    const tab = document.createElement('button');
    document.body.appendChild(tab);
    try {
      tab.focus();
      fixture.componentRef.setInput('laneKey', 'sub:task-tool');
      fixture.detectChanges();
      await fixture.whenStable();
      expect(document.activeElement).toBe(tab);
      expect(fixture.nativeElement.querySelector('[aria-label="Back to conversation"]')).toBeNull();
      expect(fixture.nativeElement.querySelector('[role="tabpanel"]')?.getAttribute('tabindex')).toBe('-1');
    } finally {
      tab.remove();
    }
  });

  it('does not move focus when tabId swaps to an already open lane', async () => {
    subagents.set(
      new Map([
        [
          'task-tool',
          {
            parentToolUseId: 'task-tool',
            parentSessionId: 'owner',
            status: 'running',
          },
        ],
      ]),
    );
    const fixture = TestBed.createComponent(CanvasLaneViewComponent);
    fixture.componentRef.setInput('tabId', 'first');
    fixture.componentRef.setInput('sessionId', 'owner');
    fixture.detectChanges();
    const focused = document.createElement('button');
    fixture.nativeElement.appendChild(focused);
    focused.focus();
    fixture.componentRef.setInput('tabId', 'second');
    fixture.componentRef.setInput('laneKey', 'sub:task-tool');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(focused);
  });

  it('does not request a frame or add a focus fade when tabId changes', () => {
    const fixture = TestBed.createComponent(CanvasLaneViewComponent);
    fixture.componentRef.setInput('tabId', 'first');
    fixture.detectChanges();
    const originalRequestFrame = globalThis.requestAnimationFrame;
    const requestFrame = jest.spyOn(globalThis, 'requestAnimationFrame');
    const frameStacks: string[] = [];
    requestFrame.mockImplementation((callback) => {
      frameStacks.push(new Error().stack ?? '');
      return originalRequestFrame(callback);
    });
    try {
      fixture.componentRef.setInput('tabId', 'second');
      fixture.detectChanges();
      expect(frameStacks.filter((stack) => stack.includes('canvas-lane-view.component.ts'))).toEqual([]);
      expect(fixture.nativeElement.querySelector('[role="tabpanel"]')?.className).toBe('h-full min-h-0');
    } finally {
      requestFrame.mockRestore();
    }
  });

  it('does not move focus on first mount with a lane already open', async () => {
    subagents.set(
      new Map([
        [
          'task-tool',
          {
            parentToolUseId: 'task-tool',
            parentSessionId: 'owner',
            status: 'running',
          },
        ],
      ]),
    );
    const focused = document.createElement('button');
    document.body.appendChild(focused);
    try {
      focused.focus();
      const fixture = TestBed.createComponent(CanvasLaneViewComponent);
      fixture.componentRef.setInput('tabId', 'tab');
      fixture.componentRef.setInput('sessionId', 'owner');
      fixture.componentRef.setInput('laneKey', 'sub:task-tool');
      fixture.detectChanges();
      await fixture.whenStable();
      expect(document.activeElement).toBe(focused);
    } finally {
      focused.remove();
    }
  });

  it('mounts child execution nodes in the subagent lane and routes Stop through its header', async () => {
    TestBed.overrideComponent(CanvasLaneViewComponent, {
      set: {
        imports: [AgentCardComponent, NgTemplateOutlet, SubagentLaneComponent],
        schemas: [NO_ERRORS_SCHEMA],
      },
    });
    const agent = {
      id: 'task-tool',
      type: 'agent',
      toolCallId: 'task-tool',
      status: 'streaming',
      agentType: 'review',
      children: [
        {
          id: 'tool-1',
          type: 'tool',
          toolCallId: 'tool-1',
          toolName: 'Read',
          status: 'error',
          isPermissionRequest: true,
          children: [],
        },
      ],
    };
    const request = {
      id: 'perm-1',
      toolName: 'Read',
      toolInput: {},
      timestamp: Date.now(),
      description: 'Read file',
      timeoutAt: 0,
    };
    getPermissionForTool.mockImplementation((id: string) =>
      id === 'tool-1' ? request : null,
    );
    tabRecord.set({
      messages: [{ streamingState: agent }],
      streamingState: null,
    });
    subagents.set(
      new Map([
        [
          'task-tool',
          {
            parentToolUseId: 'task-tool',
            parentSessionId: 'owner',
            agentId: 'sub',
            taskId: 'task-1',
            status: 'running',
          },
        ],
      ]),
    );
    const fixture = TestBed.createComponent(CanvasLaneViewComponent);
    fixture.componentRef.setInput('tabId', 'tab');
    fixture.componentRef.setInput('sessionId', 'owner');
    fixture.componentRef.setInput('laneKey', 'sub:task-tool');
    fixture.detectChanges();
    const rendered = fixture.debugElement.query(
      By.directive(ExecutionNodeComponent),
    );
    expect(fixture.debugElement.query(By.directive(SubagentLaneComponent)).componentInstance.nodes()).toBe(agent.children);
    expect(rendered.componentInstance.node()).toBe(agent.children[0]);
    expect(rendered.componentInstance.agentTileMode()).toBe(false);
    const stop = fixture.nativeElement.querySelector(
      '[aria-label="Stop sub"]',
    ) as HTMLButtonElement;
    expect(stop).not.toBeNull();
    expect(
      [...fixture.nativeElement.querySelectorAll('button')].filter(
        (button: Element) =>
          /^stop\b/i.test(button.textContent?.trim() ?? '') ||
          /^stop\b/i.test(button.getAttribute('aria-label') ?? ''),
      ),
    ).toHaveLength(1);
    stop.click();
    expect(stopAgent).toHaveBeenCalledWith('task-1', 'owner');
    const allow = fixture.nativeElement.querySelector(
      '[aria-label="Allow this request once"]',
    ) as HTMLButtonElement;
    expect(allow).not.toBeNull();
    allow.click();
    expect(handlePermissionResponse).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'perm-1', decision: 'allow' }),
    );
    const backgroundButton = fixture.nativeElement.querySelector(
      '[aria-label="Send sub to background"]',
    ) as HTMLButtonElement;
    backgroundButton.click();
    expect(backgroundAgent).toHaveBeenCalledWith('owner', 'task-tool');
    subagents.set(
      new Map([
        [
          'task-tool',
          {
            parentToolUseId: 'task-tool',
            parentSessionId: 'owner',
            agentId: 'sub',
            taskId: 'task-1',
            status: 'background',
          },
        ],
      ]),
    );
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedKind()).toBe('subagent');
    expect(
      fixture.debugElement
        .query(By.directive(ExecutionNodeComponent))
        .componentInstance.node(),
    ).toBe(agent.children[0]);
    fixture.destroy();
  });

  it('renders nested Copy controls in the full lane', () => {
    TestBed.overrideComponent(CanvasLaneViewComponent, {
      set: {
        imports: [AgentCardComponent, NgTemplateOutlet, SubagentLaneComponent],
        schemas: [NO_ERRORS_SCHEMA],
      },
    });
    const agent = {
      id: 'task-tool',
      type: 'agent',
      toolCallId: 'task-tool',
      status: 'streaming',
      agentType: 'review',
      children: [
        {
          id: 'tool-1',
          type: 'tool',
          toolCallId: 'tool-1',
          toolName: 'Read',
          status: 'complete',
          toolOutput: 'file contents',
          children: [],
        },
      ],
    };
    tabRecord.set({
      messages: [{ streamingState: agent }],
      streamingState: null,
    });
    subagents.set(
      new Map([
        [
          'task-tool',
          {
            parentToolUseId: 'task-tool',
            parentSessionId: 'owner',
            agentId: 'sub',
            status: 'running',
          },
        ],
      ]),
    );
    const fixture = TestBed.createComponent(CanvasLaneViewComponent);
    fixture.componentRef.setInput('tabId', 'tab');
    fixture.componentRef.setInput('sessionId', 'owner');
    fixture.componentRef.setInput('laneKey', 'sub:task-tool');
    fixture.detectChanges();
    const lane =
      fixture.nativeElement.querySelector('[data-testid="canvas-lane-view"]') ??
      fixture.nativeElement;
    expect(
      fixture.debugElement
        .query(By.directive(ExecutionNodeComponent))
        .componentInstance.node(),
    ).toBe(agent.children[0]);
    const toolHeader = lane.querySelector(
      'ptah-tool-call-header button[aria-expanded]',
    ) as HTMLButtonElement;
    expect(toolHeader).not.toBeNull();
    toolHeader.click();
    fixture.detectChanges();
    expect(
      lane.querySelector('ptah-copy-text-button, ptah-copy-button'),
    ).not.toBeNull();
  });
});
