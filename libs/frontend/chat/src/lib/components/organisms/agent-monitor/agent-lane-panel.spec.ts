import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  AgentMonitorStore,
  type MonitoredAgent,
} from '@ptah-extension/chat-streaming';
import { TabManagerService } from '@ptah-extension/chat-state';
import { VSCodeService } from '@ptah-extension/core';
import {
  SplitHandleComponent,
  SubagentTranscriptViewerComponent,
} from '@ptah-extension/chat-ui';
import { AgentMonitorPanelComponent } from '../agent-monitor-panel.component';
import { AgentCardComponent } from '../../molecules/agent-card/agent-card.component';
import { AgentContinueInputComponent } from '../../molecules/agent-continue-input/agent-continue-input.component';
import { AgentLaneGridComponent } from './agent-lane-grid.component';

@Component({
  selector: 'ptah-agent-card',
  standalone: true,
  template: '{{ agent().agentId }}',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class CardStub {
  readonly agent = input.required<MonitoredAgent>();
  readonly toggleExpanded = output<void>();
}
@Component({
  selector: 'ptah-agent-continue-input',
  standalone: true,
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class ContinueStub {
  readonly agent = input.required<MonitoredAgent>();
}
@Component({
  selector: 'ptah-subagent-transcript-viewer',
  standalone: true,
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class TranscriptStub {
  readonly agentName = input('');
  readonly messages = input<readonly unknown[]>([]);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly refresh = output<void>();
  readonly closed = output<void>();
}

function agent(id: string, startedAt = 1): MonitoredAgent {
  return {
    agentId: id,
    cli: 'ptah-cli',
    task: id,
    status: 'running',
    startedAt,
    stdout: '',
    stderr: '',
    expanded: true,
    segments: [],
    streamEvents: [],
    streamRevision: 0,
    permissionQueue: [],
  };
}

function blockedAgent(id: string): MonitoredAgent {
  return {
    ...agent(id),
    permissionQueue: [
      {
        requestId: `req-${id}`,
        agentId: id,
        kind: 'read',
        description: 'Read file',
        timestamp: 1,
        timeoutAt: 0,
        toolName: 'read',
        toolArgs: 'file',
      },
    ],
  };
}

describe('agent panel lanes', () => {
  const originalObserver = globalThis.ResizeObserver;
  let postMessage: jest.Mock;
  let clearPermission: jest.Mock;
  let pendingPermissions: ReturnType<typeof signal<MonitoredAgent[]>>;
  const observers: {
    callback: ResizeObserverCallback;
    observe: jest.Mock;
    disconnect: jest.Mock;
  }[] = [];

  beforeEach(() => {
    observers.length = 0;
    globalThis.ResizeObserver = class {
      observe = jest.fn();
      unobserve = jest.fn();
      disconnect = jest.fn();
      constructor(readonly callback: ResizeObserverCallback) {
        observers.push(this);
      }
    };
    postMessage = jest.fn();
    clearPermission = jest.fn();
    pendingPermissions = signal<MonitoredAgent[]>([]);
    TestBed.configureTestingModule({
      imports: [AgentMonitorPanelComponent],
      providers: [
        {
          provide: AgentMonitorStore,
          useValue: {
            activeTabAgents: signal([]),
            activeWorkflowSubagents: signal([]),
            workflowSubagentsForSession: jest.fn(() => [
              {
                parentToolUseId: 'sub',
                workflowRunId: 'run',
                status: 'running',
                description: 'Workflow child',
              },
            ]),
            pendingPermissions,
            panelOpen: signal(true),
            toggleAgentExpanded: jest.fn(),
            clearPermission,
          },
        },
        { provide: VSCodeService, useValue: { postMessage } },
        {
          provide: TabManagerService,
          useValue: { findTabBySessionIdAcrossWorkspaces: jest.fn(() => null) },
        },
      ],
    }).overrideComponent(AgentMonitorPanelComponent, {
      remove: {
        imports: [
          AgentCardComponent,
          AgentContinueInputComponent,
          SubagentTranscriptViewerComponent,
        ],
      },
      add: { imports: [CardStub, ContinueStub, TranscriptStub] },
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    globalThis.ResizeObserver = originalObserver;
  });

  function create(
    width = 650,
    agents = [agent('a', 3), agent('b', 2), agent('c', 1)],
  ) {
    const fixture = TestBed.createComponent(AgentMonitorPanelComponent);
    fixture.componentRef.setInput('embeddedAgents', agents);
    fixture.componentRef.setInput('embeddedOpen', true);
    fixture.componentRef.setInput('sessionId', 'session');
    fixture.detectChanges();
    fixture.componentInstance.deselect();
    fixture.componentInstance.bodyWidth.set(width);
    fixture.detectChanges();
    return fixture;
  }

  it('switches at 600px of body width and caps at three standalone columns', () => {
    const fixture = create(599);
    expect(
      fixture.debugElement.query(By.directive(AgentLaneGridComponent)),
    ).toBeNull();
    fixture.componentInstance.bodyWidth.set(600);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelectorAll('[data-lane-id]'),
    ).toHaveLength(2);
    expect(
      fixture.nativeElement.querySelectorAll('ptah-agent-card'),
    ).toHaveLength(2);
    fixture.componentInstance.bodyWidth.set(900);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelectorAll('[data-lane-id]'),
    ).toHaveLength(3);
    fixture.componentInstance.bodyWidth.set(599);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelectorAll('ptah-agent-card'),
    ).toHaveLength(1);
  });

  it('defaults to lanes on first wide render even when a workflow agent is first', () => {
    const fixture = TestBed.createComponent(AgentMonitorPanelComponent);
    fixture.componentRef.setInput('embeddedAgents', [
      { ...agent('workflow'), workflowRunId: 'run' },
      agent('a'),
      agent('b'),
    ]);
    fixture.componentRef.setInput('embeddedOpen', true);
    fixture.componentRef.setInput('sessionId', 'session');
    fixture.detectChanges();
    fixture.componentInstance.bodyWidth.set(650);
    fixture.detectChanges();
    expect(fixture.componentInstance.showLaneGrid()).toBe(true);
    expect(fixture.componentInstance.laneGrid()?.shownIds()).toEqual([
      'a',
      'b',
    ]);
    fixture.componentInstance.selectAgent('sub');
    fixture.detectChanges();
    expect(fixture.componentInstance.showLaneGrid()).toBe(false);
  });

  it('keeps lanes visible when a picked standalone disappears ahead of a fallback workflow', () => {
    const workflow = { ...agent('workflow'), workflowRunId: 'run' };
    const fixture = create(650, [
      workflow,
      agent('a', 3),
      agent('b', 2),
      agent('c', 1),
    ]);
    fixture.componentInstance.pickStandalone('a');
    fixture.detectChanges();
    fixture.componentRef.setInput('embeddedAgents', [
      workflow,
      agent('b', 2),
      agent('c', 1),
    ]);
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedAgentId()).toBe('a');
    expect(fixture.componentInstance.effectiveSelectedAgent()?.agentId).toBe(
      'workflow',
    );
    expect(fixture.componentInstance.showLaneGrid()).toBe(true);
    expect(
      fixture.nativeElement.querySelector('ptah-agent-lane-grid').style.display,
    ).not.toBe('none');
    expect(
      fixture.nativeElement.querySelectorAll('ptah-agent-card'),
    ).toHaveLength(2);
  });

  it('does not substitute another workflow when an explicitly selected workflow disappears', () => {
    const fallback = { ...agent('fallback'), workflowRunId: 'run' };
    const selected = { ...agent('selected'), workflowRunId: 'run' };
    const fixture = create(650, [fallback, selected, agent('a'), agent('b')]);
    fixture.componentInstance.selectAgent('selected');
    fixture.detectChanges();
    expect(fixture.componentInstance.showLaneGrid()).toBe(false);
    fixture.componentRef.setInput('embeddedAgents', [
      fallback,
      agent('a'),
      agent('b'),
    ]);
    fixture.detectChanges();
    expect(fixture.componentInstance.showLaneGrid()).toBe(true);
  });

  it('does not use workflow agents to reach the two-lane threshold', () => {
    const fixture = create(1000, [
      agent('a'),
      { ...agent('workflow'), workflowRunId: 'run' },
    ]);
    expect(fixture.componentInstance.lanesMode()).toBe(false);
  });

  it('toggles forced single view with an accessible pressed state', () => {
    const fixture = create();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[title="Show one agent"]',
    );
    button.click();
    fixture.detectChanges();
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.title).toBe('Show agents side by side');
    expect(fixture.componentInstance.lanesMode()).toBe(false);
    button.click();
    fixture.detectChanges();
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.title).toBe('Show one agent');
    expect(
      fixture.nativeElement.querySelectorAll('[data-lane-id]'),
    ).toHaveLength(2);
  });

  it('hides the toggle on narrow panels but keeps an active force-single toggle available', () => {
    const fixture = create(599);
    expect(
      fixture.nativeElement.querySelector('button[title="Show one agent"]'),
    ).toBeNull();
    fixture.componentInstance.bodyWidth.set(650);
    fixture.detectChanges();
    const toggle: HTMLButtonElement = fixture.nativeElement.querySelector(
      'button[title="Show one agent"]',
    );
    toggle.click();
    fixture.detectChanges();
    fixture.componentInstance.bodyWidth.set(599);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector(
        'button[title="Show agents side by side"]',
      ),
    ).toBe(toggle);
    toggle.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.forceSingle()).toBe(false);
    expect(fixture.nativeElement.contains(toggle)).toBe(false);
  });

  it('focuses shown lanes, replaces the oldest pick, and marks shown chips', () => {
    const fixture = create();
    const panel = fixture.componentInstance;
    panel.pickStandalone('a');
    fixture.detectChanges();
    expect((document.activeElement as HTMLElement).dataset['laneId']).toBe('a');
    panel.pickStandalone('c');
    fixture.detectChanges();
    expect(panel.laneGrid()?.shownIds()).toEqual(['a', 'c']);
    expect(
      fixture.nativeElement
        .querySelector('button[title="c"]')
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      fixture.nativeElement
        .querySelector('button[title="b"]')
        .getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('keeps streaming column positions and replaces only finished work on a new arrival', () => {
    const fixture = create();
    fixture.componentRef.setInput('embeddedAgents', [
      { ...agent('a', 3), status: 'completed' },
      agent('b', 2),
      agent('c', 1),
    ]);
    fixture.detectChanges();
    expect(fixture.componentInstance.laneGrid()?.shownIds()).toEqual([
      'a',
      'b',
    ]);
    fixture.componentRef.setInput('embeddedAgents', [
      { ...agent('a', 3), status: 'completed' },
      agent('b', 2),
      agent('new', 4),
    ]);
    fixture.detectChanges();
    expect(fixture.componentInstance.laneGrid()?.shownIds()).toEqual([
      'new',
      'b',
    ]);
    fixture.componentInstance.pickStandalone('a');
    fixture.detectChanges();
    fixture.componentRef.setInput('embeddedAgents', [
      { ...agent('a', 3), status: 'completed' },
      agent('b', 2),
      agent('new', 4),
      agent('newest', 5),
    ]);
    fixture.detectChanges();
    expect(fixture.componentInstance.laneGrid()?.shownIds()).toEqual([
      'new',
      'a',
    ]);
  });

  it('picks a hidden blocked agent only when a new permission arrives', () => {
    const fixture = create();
    const grid = fixture.componentInstance.laneGrid();
    if (!grid) throw new Error('Expected the lane grid to be rendered');
    const blocked = {
      ...agent('c', 1),
      permissionQueue: [
        {
          requestId: 'req-c',
          agentId: 'c',
          kind: 'read',
          description: 'Read file',
          timestamp: 1,
          timeoutAt: 0,
          toolName: 'read',
          toolArgs: 'file',
        },
      ],
    };
    expect(grid.shownIds()).toEqual(['a', 'b']);
    fixture.componentRef.setInput('embeddedAgents', [
      agent('a', 3),
      agent('b', 2),
      blocked,
    ]);
    pendingPermissions.set([blocked]);
    fixture.detectChanges();
    expect(grid.shownIds()).toContain('c');
    expect(
      fixture.nativeElement.querySelector('[data-lane-id="c"] .btn-success'),
    ).not.toBeNull();
    grid.remove('c');
    fixture.detectChanges();
    pendingPermissions.set([{ ...blocked }]);
    fixture.detectChanges();
    expect(grid.shownIds()).not.toContain('c');
    pendingPermissions.set([
      {
        ...blocked,
        permissionQueue: [
          { ...blocked.permissionQueue[0], requestId: 'req-c-2' },
        ],
      },
    ]);
    fixture.detectChanges();
    expect(grid.shownIds()).toContain('c');
  });

  it.each([false, true])(
    'opens workflow permission controls in the full body (new agent: %s)',
    (newAgent) => {
      const workflow = { ...blockedAgent('workflow'), workflowRunId: 'run' };
      const standalone = [agent('a', 3), agent('b', 2)];
      const fixture = create(
        650,
        newAgent
          ? standalone
          : [...standalone, { ...workflow, permissionQueue: [] }],
      );
      fixture.componentRef.setInput('embeddedAgents', [
        ...standalone,
        workflow,
      ]);
      pendingPermissions.set([workflow]);
      fixture.detectChanges();
      expect(fixture.componentInstance.selectedAgentId()).toBe('workflow');
      expect(fixture.componentInstance.showLaneGrid()).toBe(false);
      expect(
        fixture.nativeElement.querySelector('ptah-agent-lane-grid').style
          .display,
      ).toBe('none');
      const allow: HTMLButtonElement =
        fixture.nativeElement.querySelector('.btn-success');
      expect(allow.closest('ptah-agent-lane-grid')).toBeNull();
      allow.click();
      expect(clearPermission).toHaveBeenCalledWith('workflow', 'req-workflow');
      // Re-emitting an already surfaced workflow request must not steal detail again.
      fixture.componentInstance.pickStandalone('a');
      pendingPermissions.set([{ ...workflow }]);
      fixture.detectChanges();
      expect(fixture.componentInstance.showLaneGrid()).toBe(true);
    },
  );

  it('queues simultaneous workflow permissions oldest first and marks waiting tiles', () => {
    const standalone = [agent('a', 3), agent('b', 2)];
    const first = {
      ...blockedAgent('first'),
      workflowRunId: 'run',
      displayName: 'First workflow',
    };
    const second = {
      ...blockedAgent('second'),
      workflowRunId: 'run',
      displayName: 'Second workflow',
    };
    first.permissionQueue = first.permissionQueue.map((request) => ({
      ...request,
      timestamp: 10,
    }));
    second.permissionQueue = second.permissionQueue.map((request) => ({
      ...request,
      timestamp: 20,
    }));
    const fixture = create(650, standalone);
    // Reverse input order to prove selection follows request time, not iteration order.
    fixture.componentRef.setInput('embeddedAgents', [
      ...standalone,
      second,
      first,
    ]);
    pendingPermissions.set([second, first]);
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedAgentId()).toBe('first');
    expect(fixture.componentInstance.showLaneGrid()).toBe(false);
    const waiting: HTMLElement = fixture.nativeElement.querySelector(
      'button[title="Second workflow"] .badge-warning',
    );
    expect(waiting.textContent?.trim()).toBe('1');
    expect(waiting.getAttribute('aria-label')).toBe('1 pending permissions');
    pendingPermissions.set([{ ...second }, { ...first }]);
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedAgentId()).toBe('first');
    fixture.componentRef.setInput('embeddedAgents', [
      ...standalone,
      second,
      { ...first, permissionQueue: [] },
    ]);
    pendingPermissions.set([second]);
    fixture.detectChanges();
    // This transition also proves the waiting request was not prematurely marked shown.
    expect(fixture.componentInstance.selectedAgentId()).toBe('second');
    expect(
      fixture.componentInstance.effectiveSelectedAgent()?.permissionQueue[0]
        .requestId,
    ).toBe('req-second');
  });

  it('keeps the current workflow visible when another new request arrives', () => {
    const standalone = [agent('a'), agent('b')];
    const first = { ...blockedAgent('first'), workflowRunId: 'run' };
    const second = { ...blockedAgent('second'), workflowRunId: 'run' };
    const fixture = create(650, standalone);
    fixture.componentRef.setInput('embeddedAgents', [...standalone, first]);
    pendingPermissions.set([first]);
    fixture.detectChanges();
    fixture.componentRef.setInput('embeddedAgents', [
      ...standalone,
      second,
      first,
    ]);
    pendingPermissions.set([second, first]);
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedAgentId()).toBe('first');
  });

  it.each(['standalone', 'closed transcript'])(
    'preserves a later user choice (%s) until a new workflow request arrives',
    (choice) => {
      const standalone = [agent('a'), agent('b')];
      const first = { ...blockedAgent('first'), workflowRunId: 'run' };
      const second = { ...blockedAgent('second'), workflowRunId: 'run' };
      const fixture = create(650, standalone);
      fixture.componentRef.setInput('embeddedAgents', [
        ...standalone,
        first,
        second,
      ]);
      pendingPermissions.set([first, second]);
      fixture.detectChanges();
      expect(fixture.componentInstance.selectedAgentId()).toBe('first');
      if (choice === 'standalone') {
        fixture.componentInstance.pickStandalone('a');
      } else {
        fixture.componentInstance.selectAgent('sub');
        fixture.detectChanges();
        fixture.debugElement
          .query(By.directive(TranscriptStub))
          .componentInstance.closed.emit();
      }
      fixture.detectChanges();
      pendingPermissions.set([{ ...first }, { ...second }]);
      fixture.detectChanges();
      expect(fixture.componentInstance.showLaneGrid()).toBe(true);
      // Resolving the old request alone must not steal the user's chosen view either.
      fixture.componentRef.setInput('embeddedAgents', [
        ...standalone,
        { ...first, permissionQueue: [] },
        second,
      ]);
      pendingPermissions.set([second]);
      fixture.detectChanges();
      expect(fixture.componentInstance.showLaneGrid()).toBe(true);
      const newRequest = {
        ...first,
        permissionQueue: first.permissionQueue.map((request) => ({
          ...request,
          requestId: 'req-first-new',
          timestamp: 30,
        })),
      };
      fixture.componentRef.setInput('embeddedAgents', [
        ...standalone,
        newRequest,
        second,
      ]);
      pendingPermissions.set([newRequest, second]);
      fixture.detectChanges();
      expect(fixture.componentInstance.selectedAgentId()).toBe('second');
      expect(fixture.componentInstance.showLaneGrid()).toBe(false);
    },
  );

  it('picks a new standalone and its permission into the grid in the same tick', () => {
    const fixture = create(650, [agent('a', 3), agent('b', 2)]);
    const blocked = blockedAgent('new');
    fixture.componentRef.setInput('embeddedAgents', [
      agent('a', 3),
      agent('b', 2),
      blocked,
    ]);
    pendingPermissions.set([blocked]);
    fixture.detectChanges();
    expect(fixture.componentInstance.showLaneGrid()).toBe(true);
    expect(fixture.componentInstance.laneGrid()?.shownIds()).toContain('new');
    expect(
      fixture.nativeElement.querySelector('[data-lane-id="new"] .btn-success'),
    ).not.toBeNull();
  });

  it('retries the same request on the next run if the first standalone pick was rejected', () => {
    const fixture = create();
    const grid = fixture.componentInstance.laneGrid();
    if (!grid) throw new Error('Expected the lane grid to be rendered');
    const blocked = blockedAgent('c');
    fixture.componentRef.setInput('embeddedAgents', [
      agent('a', 3),
      agent('b', 2),
      blocked,
    ]);
    fixture.detectChanges();
    const pick = jest
      .spyOn(grid, 'pick')
      .mockImplementationOnce(() => undefined);
    pendingPermissions.set([blocked]);
    fixture.detectChanges();
    expect(pick).toHaveBeenCalledTimes(1);
    expect(grid.shownIds()).not.toContain('c');
    pendingPermissions.set([{ ...blocked }]);
    fixture.detectChanges();
    expect(pick).toHaveBeenCalledTimes(2);
    expect(grid.shownIds()).toContain('c');
  });

  it('keeps removed columns out during output updates and permits picking them again', () => {
    const fixture = create();
    const grid = fixture.componentInstance.laneGrid();
    if (!grid) throw new Error('Expected the lane grid to be rendered');
    grid.remove('b');
    fixture.detectChanges();
    fixture.componentRef.setInput('embeddedAgents', [
      agent('a', 3),
      agent('b', 2),
      agent('c', 1),
    ]);
    fixture.detectChanges();
    expect(grid.shownIds()).toEqual(['a']);
    grid.pick('b');
    fixture.detectChanges();
    expect(grid.shownIds()).toEqual(['a', 'b']);
    expect(grid.fractions().reduce((sum, value) => sum + value, 0)).toBeCloseTo(
      1,
    );
  });

  it('uses shared handles, clamps a drag, resets, and renormalises on panel resize', () => {
    const fixture = create(800);
    const grid = fixture.componentInstance.laneGrid();
    if (!grid) throw new Error('Expected the lane grid to be rendered');
    const handle = fixture.debugElement.query(
      By.directive(SplitHandleComponent),
    ).componentInstance as SplitHandleComponent;
    handle.sizeChange.emit(1000);
    fixture.detectChanges();
    expect(grid.fractions()[1] * grid.availableWidth()).toBeCloseTo(240);
    handle.sizeReset.emit();
    fixture.detectChanges();
    expect(grid.fractions()).toEqual([0.5, 0.5]);
    handle.sizeChange.emit(500);
    fixture.detectChanges();
    fixture.componentInstance.bodyWidth.set(600);
    fixture.detectChanges();
    expect(
      Math.min(...grid.fractions()) * grid.availableWidth(),
    ).toBeGreaterThanOrEqual(239.999);
  });

  it('returns from a full-body workflow transcript to the same columns', () => {
    const fixture = create();
    const panel = fixture.componentInstance;
    const grid = panel.laneGrid();
    panel.selectAgent('sub');
    fixture.detectChanges();
    expect(panel.showLaneGrid()).toBe(false);
    expect(
      fixture.nativeElement.querySelector('ptah-subagent-transcript-viewer'),
    ).not.toBeNull();
    fixture.debugElement
      .query(By.directive(TranscriptStub))
      .componentInstance.closed.emit();
    fixture.detectChanges();
    expect(panel.showLaneGrid()).toBe(true);
    expect(panel.laneGrid()).toBe(grid);
  });

  it('routes lane permission buttons through the facade handlers', () => {
    const fixture = create(650, [
      {
        ...agent('a'),
        permissionQueue: [
          {
            requestId: 'req',
            agentId: 'a',
            kind: 'read',
            description: 'Read file',
            timestamp: 1,
            timeoutAt: 0,
            toolName: 'read',
            toolArgs: 'file',
          },
        ],
      },
      agent('b'),
    ]);
    const allow: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-lane-id="a"] .btn-success',
    );
    allow.click();
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { requestId: 'req', decision: 'allow' },
      }),
    );
    expect(clearPermission).toHaveBeenCalledWith('a', 'req');
  });

  it('measures the body through ResizeObserver and disconnects every observer', () => {
    const fixture = create(599);
    const panelObserver = observers[0];
    const body = panelObserver.observe.mock.calls[0][0] as HTMLElement;
    panelObserver.callback(
      [
        {
          target: body,
          contentRect: {
            x: 0,
            y: 0,
            width: 700,
            height: 400,
            top: 0,
            right: 700,
            bottom: 400,
            left: 0,
            toJSON: () => ({}),
          },
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        },
      ],
      { observe: jest.fn(), unobserve: jest.fn(), disconnect: jest.fn() },
    );
    fixture.detectChanges();
    expect(fixture.componentInstance.lanesMode()).toBe(true);
    fixture.destroy();
    expect(
      observers.every((observer) => observer.disconnect.mock.calls.length > 0),
    ).toBe(true);
  });

  it('renders safely when ResizeObserver is unavailable', () => {
    Reflect.deleteProperty(globalThis, 'ResizeObserver');
    expect(() => create(599)).not.toThrow();
  });
});
