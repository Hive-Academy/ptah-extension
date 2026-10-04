/**
 * AgentMonitorPanelComponent grouping tests.
 *
 * Covers the pure `groupAgentsByWorkflowRun` partition that the panel's
 * `workflowGroups()` / `standaloneAgents()` computeds delegate to:
 *   - workflow agents partition into runs keyed by workflowRunId
 *   - standalone (no workflowRunId) agents are unaffected
 *   - aggregate run status / counts roll up correctly
 */

import type {
  MonitoredAgent,
  SubagentRecord,
} from '@ptah-extension/chat-streaming';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideSurfaceActiveTesting } from '@ptah-extension/core/testing';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import { TabManagerService } from '@ptah-extension/chat-state';
import { VSCodeService } from '@ptah-extension/core';
import { PanelResizeService } from '../../services/panel-resize.service';
import { AgentMonitorPanelComponent } from './agent-monitor-panel.component';
import { groupAgentsByWorkflowRun } from './agent-monitor-panel.grouping';

/** Minimal MonitoredAgent factory — the grouping only reads a few fields. */
function agent(overrides: Partial<MonitoredAgent>): MonitoredAgent {
  return {
    agentId: 'a1',
    cli: 'ptah-cli',
    task: 'do work',
    status: 'running',
    startedAt: Date.now(),
    stdout: '',
    stderr: '',
    expanded: false,
    segments: [],
    streamEvents: [],
    streamRevision: 0,
    permissionQueue: [],
    ...overrides,
  } as MonitoredAgent;
}

describe('groupAgentsByWorkflowRun', () => {
  it('partitions workflow agents into runs keyed by workflowRunId', () => {
    const agents = [
      agent({ agentId: 'a', workflowRunId: 'run-1', workflowName: 'Build' }),
      agent({ agentId: 'b', workflowRunId: 'run-1' }),
      agent({ agentId: 'c', workflowRunId: 'run-2', workflowName: 'Deploy' }),
    ];

    const { groups, standalone } = groupAgentsByWorkflowRun(agents);

    expect(standalone).toHaveLength(0);
    expect(groups).toHaveLength(2);

    const run1 = groups.find((g) => g.workflowRunId === 'run-1');
    expect(run1?.agents.map((a) => a.agentId)).toEqual(['a', 'b']);
    expect(run1?.total).toBe(2);
    // Name is taken from the first agent that reported one.
    expect(run1?.workflowName).toBe('Build');

    const run2 = groups.find((g) => g.workflowRunId === 'run-2');
    expect(run2?.total).toBe(1);
    expect(run2?.workflowName).toBe('Deploy');
  });

  it('preserves first-appearance run order', () => {
    const agents = [
      agent({ agentId: 'a', workflowRunId: 'run-b' }),
      agent({ agentId: 'b', workflowRunId: 'run-a' }),
      agent({ agentId: 'c', workflowRunId: 'run-b' }),
    ];

    const { groups } = groupAgentsByWorkflowRun(agents);

    expect(groups.map((g) => g.workflowRunId)).toEqual(['run-b', 'run-a']);
  });

  it('leaves standalone agents (no workflowRunId) ungrouped and unaffected', () => {
    const agents = [
      agent({ agentId: 'plain-1' }),
      agent({ agentId: 'wf-1', workflowRunId: 'run-1' }),
      agent({ agentId: 'plain-2' }),
    ];

    const { groups, standalone } = groupAgentsByWorkflowRun(agents);

    expect(groups).toHaveLength(1);
    expect(standalone.map((a) => a.agentId)).toEqual(['plain-1', 'plain-2']);
  });

  it('returns no groups when every agent is standalone', () => {
    const agents = [agent({ agentId: 'x' }), agent({ agentId: 'y' })];

    const { groups, standalone } = groupAgentsByWorkflowRun(agents);

    expect(groups).toHaveLength(0);
    expect(standalone).toHaveLength(2);
  });

  it('rolls up aggregate status to running when any agent is running', () => {
    const { groups } = groupAgentsByWorkflowRun([
      agent({ agentId: 'a', workflowRunId: 'r', status: 'completed' }),
      agent({ agentId: 'b', workflowRunId: 'r', status: 'running' }),
    ]);

    expect(groups[0].status).toBe('running');
    expect(groups[0].running).toBe(1);
    expect(groups[0].completed).toBe(1);
  });

  it('rolls up aggregate status to completed when all agents completed', () => {
    const { groups } = groupAgentsByWorkflowRun([
      agent({ agentId: 'a', workflowRunId: 'r', status: 'completed' }),
      agent({ agentId: 'b', workflowRunId: 'r', status: 'completed' }),
    ]);

    expect(groups[0].status).toBe('completed');
  });

  it('rolls up aggregate status to failed when a non-running agent failed', () => {
    const { groups } = groupAgentsByWorkflowRun([
      agent({ agentId: 'a', workflowRunId: 'r', status: 'failed' }),
      agent({ agentId: 'b', workflowRunId: 'r', status: 'completed' }),
    ]);

    expect(groups[0].status).toBe('failed');
    expect(groups[0].failed).toBe(1);
  });

  it('sums tokens across a run when agents report a token count', () => {
    const { groups } = groupAgentsByWorkflowRun([
      // MonitoredAgent has no token field today; the grouping reads it
      // structurally so it is forward-compatible.
      agent({ agentId: 'a', workflowRunId: 'r', totalTokens: 100 } as never),
      agent({ agentId: 'b', workflowRunId: 'r', totalTokens: 250 } as never),
    ]);

    expect(groups[0].totalTokens).toBe(350);
  });

  it('leaves totalTokens undefined when no agent reports tokens', () => {
    const { groups } = groupAgentsByWorkflowRun([
      agent({ agentId: 'a', workflowRunId: 'r' }),
    ]);

    expect(groups[0].totalTokens).toBeUndefined();
  });
});

/** Minimal SubagentRecord factory — grouping only reads status/workflow fields. */
function subagent(overrides: Partial<SubagentRecord>): SubagentRecord {
  return {
    parentToolUseId: 'toolu_x',
    status: 'running',
    ...overrides,
  } as SubagentRecord;
}

describe('groupAgentsByWorkflowRun — SubagentRecords', () => {
  it('groups workflow SubagentRecords by workflowRunId (structural shape)', () => {
    const records = [
      subagent({
        parentToolUseId: 'toolu_a',
        workflowRunId: 'run-1',
        workflowName: 'Release',
        status: 'running',
      }),
      subagent({
        parentToolUseId: 'toolu_b',
        workflowRunId: 'run-1',
        status: 'completed',
      }),
      subagent({
        parentToolUseId: 'toolu_c',
        workflowRunId: 'run-2',
        status: 'running',
      }),
    ];

    const { groups, standalone } = groupAgentsByWorkflowRun(records);

    expect(standalone).toHaveLength(0);
    expect(groups).toHaveLength(2);

    const run1 = groups.find((g) => g.workflowRunId === 'run-1');
    expect(run1?.total).toBe(2);
    expect(run1?.running).toBe(1);
    expect(run1?.completed).toBe(1);
    expect(run1?.status).toBe('running');
    expect(run1?.workflowName).toBe('Release');
    expect(run1?.agents.map((r) => r.parentToolUseId)).toEqual([
      'toolu_a',
      'toolu_b',
    ]);
  });

  it('sums SubagentRecord totalTokens across a run', () => {
    const { groups } = groupAgentsByWorkflowRun([
      subagent({ parentToolUseId: 't1', workflowRunId: 'r', totalTokens: 500 }),
      subagent({ parentToolUseId: 't2', workflowRunId: 'r', totalTokens: 750 }),
    ]);

    expect(groups[0].totalTokens).toBe(1250);
  });

  it('rolls up killed/failed SubagentRecords to failed status', () => {
    const { groups } = groupAgentsByWorkflowRun([
      subagent({ parentToolUseId: 't1', workflowRunId: 'r', status: 'killed' }),
      subagent({
        parentToolUseId: 't2',
        workflowRunId: 'r',
        status: 'completed',
      }),
    ]);

    expect(groups[0].status).toBe('failed');
    expect(groups[0].failed).toBe(1);
  });

  it('treats SubagentRecords without a workflowRunId as standalone', () => {
    const { groups, standalone } = groupAgentsByWorkflowRun([
      subagent({ parentToolUseId: 't1' }),
      subagent({ parentToolUseId: 't2', workflowRunId: 'r' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(standalone.map((r) => r.parentToolUseId)).toEqual(['t1']);
  });
});

describe('AgentMonitorPanelComponent — overlay focus', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AgentMonitorPanelComponent],
      providers: [
        {
          provide: AgentMonitorStore,
          useValue: {
            activeWorkflowSubagents: signal([]),
            workflowSubagentsForSession: jest.fn(() => []),
            activeSessionSubagents: signal([]),
            sessionSubagentsForSession: jest.fn(() => []),
            activeTabAgents: signal([]),
            pendingPermissions: signal([]),
            panelOpen: signal(false),
            closePanel: jest.fn(),
            clearCompleted: jest.fn(),
            clearCompletedInSession: jest.fn(),
            getSubagent: jest.fn(),
          },
        },
        {
          provide: VSCodeService,
          useValue: {
            config: signal({ panelId: '', workspaceRoot: '/tmp' }),
            postMessage: jest.fn(),
          },
        },
        {
          provide: TabManagerService,
          useValue: {
            findTabBySessionIdAcrossWorkspaces: jest.fn(() => null),
            activeTabSessionId: signal(null),
          },
        },
        {
          provide: PanelResizeService,
          useValue: {
            customWidth: signal<number | null>(320),
            dragging: signal(false),
          },
        },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  function createPanel(isOverlay: boolean) {
    const fixture = TestBed.createComponent(AgentMonitorPanelComponent);
    fixture.componentRef.setInput('embeddedAgents', []);
    fixture.componentRef.setInput('embeddedOpen', false);
    fixture.componentRef.setInput('sessionId', 'session-1');
    fixture.componentRef.setInput('isOverlay', isOverlay);
    fixture.detectChanges();
    return fixture;
  }

  it('moves focus to the close control when the overlay opens', () => {
    const fixture = createPanel(true);
    const closeButton = fixture.nativeElement.querySelector(
      'button[title="Close panel"]',
    ) as HTMLButtonElement;

    fixture.componentRef.setInput('embeddedOpen', true);
    fixture.detectChanges();

    expect(document.activeElement).toBe(closeButton);
  });

  it('does not move focus when the panel opens in wide mode', () => {
    const fixture = createPanel(false);
    const closeButton = fixture.nativeElement.querySelector(
      'button[title="Close panel"]',
    ) as HTMLButtonElement;
    const focusSpy = jest.spyOn(closeButton, 'focus');

    fixture.componentRef.setInput('embeddedOpen', true);
    fixture.detectChanges();

    expect(focusSpy).not.toHaveBeenCalled();
  });
});

describe('AgentMonitorPanelComponent — session subagents', () => {
  let activeWorkflowSubagentsSig: ReturnType<typeof signal<SubagentRecord[]>>;
  let activeSessionSubagentsSig: ReturnType<typeof signal<SubagentRecord[]>>;
  let activeTabAgentsSig: ReturnType<typeof signal<MonitoredAgent[]>>;
  let sessionSubagentsForSessionMock: jest.Mock;
  let workflowSubagentsForSessionMock: jest.Mock;
  let getSubagentTranscriptMock: jest.Mock;
  let allSubagentsMap: Map<string, SubagentRecord>;
  let getSubagentMock: jest.Mock;
  let loadSubagentCacheInfoMock: jest.Mock;

  beforeEach(() => {
    loadSubagentCacheInfoMock = jest.fn().mockResolvedValue(undefined);
    activeWorkflowSubagentsSig = signal<SubagentRecord[]>([]);
    activeSessionSubagentsSig = signal<SubagentRecord[]>([]);
    activeTabAgentsSig = signal<MonitoredAgent[]>([]);
    sessionSubagentsForSessionMock = jest.fn(() => []);
    workflowSubagentsForSessionMock = jest.fn(() => []);
    getSubagentTranscriptMock = jest.fn().mockResolvedValue([]);
    allSubagentsMap = new Map<string, SubagentRecord>();
    getSubagentMock = jest.fn((id: string) => {
      return (
        allSubagentsMap.get(id) ??
        activeSessionSubagentsSig().find((r) => r.parentToolUseId === id) ??
        activeWorkflowSubagentsSig().find((r) => r.parentToolUseId === id)
      );
    });

    TestBed.configureTestingModule({
      imports: [AgentMonitorPanelComponent],
      providers: [
        provideSurfaceActiveTesting(),
        {
          provide: AgentMonitorStore,
          useValue: {
            activeWorkflowSubagents: activeWorkflowSubagentsSig,
            workflowSubagentsForSession: workflowSubagentsForSessionMock,
            activeSessionSubagents: activeSessionSubagentsSig,
            sessionSubagentsForSession: sessionSubagentsForSessionMock,
            activeTabAgents: activeTabAgentsSig,
            pendingPermissions: signal([]),
            panelOpen: signal(true),
            closePanel: jest.fn(),
            clearCompleted: jest.fn(),
            clearCompletedInSession: jest.fn(),
            toggleAgentExpanded: jest.fn(),
            tick: signal(0),
            getSubagent: getSubagentMock,
            getSubagentTranscript: getSubagentTranscriptMock,
            loadSubagentCacheInfo: loadSubagentCacheInfoMock,
          },
        },
        {
          provide: VSCodeService,
          useValue: {
            config: signal({ panelId: '', workspaceRoot: '/tmp' }),
            postMessage: jest.fn(),
          },
        },
        {
          provide: TabManagerService,
          useValue: {
            findTabBySessionIdAcrossWorkspaces: jest.fn(() => null),
            activeTabSessionId: signal(null),
          },
        },
        {
          provide: PanelResizeService,
          useValue: {
            customWidth: signal<number | null>(320),
            dragging: signal(false),
          },
        },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  function createPanel(sessionId: string | null = null) {
    const fixture = TestBed.createComponent(AgentMonitorPanelComponent);
    fixture.componentRef.setInput('embeddedAgents', undefined);
    fixture.componentRef.setInput('embeddedOpen', true);
    fixture.componentRef.setInput('sessionId', sessionId);
    fixture.detectChanges();
    return fixture;
  }

  it('includes session subagents in totalCount and header badge', () => {
    activeSessionSubagentsSig.set([
      subagent({
        parentToolUseId: 'toolu_task_1',
        teammateName: 'Worker 1',
        status: 'running',
      }),
    ]);
    const fixture = createPanel(null);

    expect(fixture.componentInstance.totalCount()).toBe(1);
    const badge = fixture.nativeElement.querySelector(
      '.badge.badge-sm.badge-neutral',
    );
    expect(badge?.textContent?.trim()).toBe('1');
  });

  it('prevents empty state from showing when session subagents exist', () => {
    activeSessionSubagentsSig.set([
      subagent({
        parentToolUseId: 'toolu_task_1',
        teammateName: 'Worker 1',
        status: 'running',
      }),
    ]);
    const fixture = createPanel(null);

    expect(fixture.nativeElement.textContent).not.toContain('No agents');
  });

  it('shows empty state when no agents or subagents exist', () => {
    const fixture = createPanel(null);

    expect(fixture.componentInstance.totalCount()).toBe(0);
    expect(fixture.nativeElement.textContent).toContain('No agents');
  });

  it('renders a tile for the session subagent and displays transcript viewer on selection', () => {
    activeSessionSubagentsSig.set([
      subagent({
        parentToolUseId: 'toolu_task_1',
        teammateName: 'Worker 1',
        status: 'running',
        agentId: 'short_agent_1',
        parentSessionId: 'sess_1',
      }),
    ]);
    const fixture = createPanel(null);

    // Session subagent is NOT auto-selected
    expect(fixture.componentInstance.selectedAgentId()).toBeNull();

    // The tile should be rendered
    const tile = fixture.nativeElement.querySelector(
      'button[title="Worker 1"]',
    ) as HTMLButtonElement;
    expect(tile).toBeTruthy();
    expect(tile?.textContent).toContain('Worker 1');

    // Explicitly click the tile to select it
    tile.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.selectedAgentId()).toBe('toolu_task_1');
    expect(
      fixture.componentInstance.selectedWorkflowSubagent()?.teammateName,
    ).toBe('Worker 1');

    // Transcript viewer should be rendered for the selected subagent
    const transcriptViewer = fixture.nativeElement.querySelector(
      'ptah-subagent-transcript-viewer',
    );
    expect(transcriptViewer).toBeTruthy();
  });

  it('shows the usage summary only once a subagent row is opened, and loads its cache info then', () => {
    activeSessionSubagentsSig.set([
      subagent({
        parentToolUseId: 'toolu_task_1',
        teammateName: 'Worker 1',
        status: 'running',
      }),
    ]);
    const fixture = createPanel(null);
    expect(
      fixture.nativeElement.querySelector('ptah-subagent-usage-summary'),
    ).toBeNull();
    expect(loadSubagentCacheInfoMock).not.toHaveBeenCalled();

    (
      fixture.nativeElement.querySelector(
        'button[title="Worker 1"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('ptah-subagent-usage-summary'),
    ).toBeTruthy();
    expect(loadSubagentCacheInfoMock).toHaveBeenCalledWith('toolu_task_1');
  });

  it('does not auto-select session subagents when a CLI agent is selected', () => {
    activeTabAgentsSig.set([
      agent({ agentId: 'cli_1', displayName: 'CLI Agent' }),
    ]);
    const fixture = createPanel(null);
    expect(fixture.componentInstance.selectedAgentId()).toBe('cli_1');

    // Spawning a new session subagent must not steal selection
    activeSessionSubagentsSig.set([
      subagent({
        parentToolUseId: 'toolu_task_1',
        teammateName: 'Worker 1',
        status: 'running',
      }),
    ]);
    fixture.detectChanges();

    expect(fixture.componentInstance.selectedAgentId()).toBe('cli_1');
  });

  it('preserves the currently selected session subagent (tile + detail) after it becomes terminal until another is selected or clear completed', () => {
    const worker1 = subagent({
      parentToolUseId: 'toolu_task_1',
      teammateName: 'Worker 1',
      status: 'running',
      agentId: 'short_agent_1',
      parentSessionId: 'sess_1',
    });
    allSubagentsMap.set('toolu_task_1', worker1);
    activeSessionSubagentsSig.set([worker1]);
    const fixture = createPanel(null);

    // Select the session subagent by clicking its tile
    const tile = fixture.nativeElement.querySelector(
      'button[title="Worker 1"]',
    ) as HTMLButtonElement;
    tile.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedAgentId()).toBe('toolu_task_1');

    // Subagent finishes and drops out of activeSessionSubagents
    const completedWorker = { ...worker1, status: 'completed' as const };
    allSubagentsMap.set('toolu_task_1', completedWorker);
    activeSessionSubagentsSig.set([]);
    fixture.detectChanges();

    // Tile and detail remain visible while selected
    expect(fixture.componentInstance.selectedAgentId()).toBe('toolu_task_1');
    expect(fixture.componentInstance.sessionSubagents()).toHaveLength(1);
    expect(fixture.componentInstance.selectedWorkflowSubagent()?.status).toBe(
      'completed',
    );
    expect(
      fixture.nativeElement.querySelector('ptah-subagent-transcript-viewer'),
    ).toBeTruthy();

    // Clicking clear completed deselects and removes it
    fixture.componentInstance.onClearCompleted();
    fixture.detectChanges();

    expect(fixture.componentInstance.selectedAgentId()).toBeNull();
    expect(fixture.componentInstance.sessionSubagents()).toHaveLength(0);
  });

  it('renders fallback empty-state message when subagent has no agentId or parentSessionId', () => {
    activeSessionSubagentsSig.set([
      subagent({
        parentToolUseId: 'toolu_task_no_id',
        teammateName: 'Pending Agent',
        status: 'running',
        agentId: undefined,
        parentSessionId: undefined,
      }),
    ]);
    const fixture = createPanel(null);

    // Select the subagent
    const tile = fixture.nativeElement.querySelector(
      'button[title="Pending Agent"]',
    ) as HTMLButtonElement;
    tile.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.selectedAgentId()).toBe(
      'toolu_task_no_id',
    );
    expect(
      fixture.nativeElement.querySelector('ptah-subagent-transcript-viewer'),
    ).toBeNull();
    expect(fixture.nativeElement.textContent).toContain(
      'Transcript is not available yet',
    );
  });

  function selectTile(
    fixture: ReturnType<typeof createPanel>,
    title: string,
  ): void {
    (
      fixture.nativeElement.querySelector(
        `button[title="${title}"]`,
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
  }

  it('renders the transcript viewer and loads the transcript once for a background subagent whose agentId came from background_agent_started', () => {
    activeSessionSubagentsSig.set([
      subagent({
        parentToolUseId: 'toolu_bg_named',
        teammateName: 'reviewer-pr2',
        status: 'running',
        agentId: 'a1b2c3',
        parentSessionId: 'sess_bg',
      }),
    ]);
    const fixture = createPanel(null);

    selectTile(fixture, 'reviewer-pr2');
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('ptah-subagent-transcript-viewer'),
    ).toBeTruthy();
    expect(fixture.nativeElement.textContent).not.toContain(
      'Transcript is not available yet',
    );
    expect(getSubagentTranscriptMock).toHaveBeenCalledTimes(1);
    expect(getSubagentTranscriptMock).toHaveBeenCalledWith('sess_bg', 'a1b2c3');
  });

  it('falls back to the active tab session when the record has no parentSessionId', () => {
    (
      TestBed.inject(TabManagerService).activeTabSessionId as ReturnType<
        typeof signal<string | null>
      >
    ).set('sess_active');
    activeSessionSubagentsSig.set([
      subagent({
        parentToolUseId: 'toolu_bg_no_session',
        teammateName: 'No Session',
        status: 'running',
        agentId: 'd4e5f6',
        parentSessionId: undefined,
      }),
    ]);
    const fixture = createPanel(null);

    selectTile(fixture, 'No Session');

    expect(
      fixture.nativeElement.querySelector('ptah-subagent-transcript-viewer'),
    ).toBeTruthy();
    expect(getSubagentTranscriptMock).toHaveBeenCalledTimes(1);
    expect(getSubagentTranscriptMock).toHaveBeenCalledWith(
      'sess_active',
      'd4e5f6',
    );
  });

  it('ensures a record is never shown twice even if present in workflow and session subagents', () => {
    activeWorkflowSubagentsSig.set([
      subagent({
        parentToolUseId: 'toolu_dup',
        workflowRunId: 'run-1',
        teammateName: 'Duplicate Subagent',
        status: 'running',
      }),
    ]);
    activeSessionSubagentsSig.set([
      subagent({
        parentToolUseId: 'toolu_dup',
        teammateName: 'Duplicate Subagent',
        status: 'running',
      }),
    ]);
    const fixture = createPanel(null);

    // Should only be counted once (totalCount = 1)
    expect(fixture.componentInstance.totalCount()).toBe(1);
    expect(fixture.componentInstance.sessionSubagents()).toHaveLength(0);
  });

  it('scopes session subagents when sessionId is provided', () => {
    sessionSubagentsForSessionMock.mockReturnValue([
      subagent({
        parentToolUseId: 'toolu_scoped',
        teammateName: 'Scoped Subagent',
        status: 'running',
      }),
    ]);
    const fixture = createPanel('sess-xyz');

    expect(sessionSubagentsForSessionMock).toHaveBeenCalledWith('sess-xyz');
    expect(fixture.componentInstance.totalCount()).toBe(1);
  });
});
