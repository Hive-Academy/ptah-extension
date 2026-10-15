/**
 * AgentMonitorPanelComponent — scope handling for an unresolved session
 * (TASK_2026_295).
 *
 * SESSION_CONTEXT marks a scoped host. A null or empty sessionId in that host
 * owns nothing. Without the token, the main panel stays tolerant.
 */

import { provideSurfaceActiveTesting } from '@ptah-extension/core/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AgentMonitorStore, type MonitoredAgent } from '@ptah-extension/chat-streaming';
import { TabManagerService } from '@ptah-extension/chat-state';
import { VSCodeService } from '@ptah-extension/core';
import { PanelResizeService } from '../../services/panel-resize.service';
import { SESSION_CARD_ACTIONS, SESSION_CONTEXT } from '../../tokens/session-context.token';
import { AgentMonitorPanelComponent } from './agent-monitor-panel.component';

const OTHER_SESSION = 'session-other';

describe('AgentMonitorPanelComponent — unresolved session scope', () => {
  let storeMock: {
    activeWorkflowSubagents: jest.Mock;
    workflowSubagentsForSession: jest.Mock;
    activeSessionSubagents: jest.Mock;
    sessionSubagentsForSession: jest.Mock;
    getSubagent: jest.Mock;
    clearCompleted: jest.Mock;
    clearCompletedInSession: jest.Mock;
    activeTabAgents: jest.Mock;
    pendingPermissions: jest.Mock;
    panelOpen: jest.Mock;
    closePanel: jest.Mock;
    tick: ReturnType<typeof signal<number>>;
  };
  let findTabBySessionIdAcrossWorkspaces: jest.Mock;

  function createPanel(
    sessionId: string | null,
    agents: MonitoredAgent[] = [],
  ) {
    const fixture = TestBed.createComponent(AgentMonitorPanelComponent);
    fixture.componentRef.setInput('embeddedAgents', agents);
    fixture.componentRef.setInput('embeddedOpen', false);
    fixture.componentRef.setInput('sessionId', sessionId);
    return fixture;
  }

  beforeEach(() => {
    storeMock = {
      activeWorkflowSubagents: jest.fn(() => [
        { parentToolUseId: 'toolu_foreign', status: 'running' },
      ]),
      workflowSubagentsForSession: jest.fn(() => []),
      activeSessionSubagents: jest.fn(() => []),
      sessionSubagentsForSession: jest.fn(() => []),
      getSubagent: jest.fn(() => undefined),
      clearCompleted: jest.fn(),
      clearCompletedInSession: jest.fn(),
      activeTabAgents: jest.fn(() => []),
      pendingPermissions: jest.fn(() => []),
      panelOpen: jest.fn(() => false),
      closePanel: jest.fn(),
      tick: signal(0),
    };
    findTabBySessionIdAcrossWorkspaces = jest.fn(() => null);

    TestBed.configureTestingModule({
      imports: [AgentMonitorPanelComponent],
      providers: [
        provideSurfaceActiveTesting(),
        { provide: SESSION_CONTEXT, useValue: signal<string | null>('tab-scoped') },
        { provide: AgentMonitorStore, useValue: storeMock },
        {
          provide: VSCodeService,
          useValue: {
            config: signal({ panelId: '', workspaceRoot: '/tmp' }),
            postMessage: jest.fn(),
          },
        },
        {
          provide: TabManagerService,
          useValue: { findTabBySessionIdAcrossWorkspaces },
        },
        {
          provide: PanelResizeService,
          useValue: {
            agentPanelWidth: signal(320),
            customWidth: signal<number | null>(320),
            dragging: signal(false),
            setDragging: jest.fn(),
            setAgentPanelWidth: jest.fn(),
          },
        },
      ],
    });
  });

  it('renders no workflow run groups for a tile whose session is still empty', () => {
    const fixture = createPanel('');

    expect(fixture.componentInstance.effectiveWorkflowSubagents()).toEqual([]);
    expect(storeMock.activeWorkflowSubagents).not.toHaveBeenCalled();
  });

  it('shows no active-tab records for a scoped host with a null session id', () => {
    const foreign = { agentId: 'foreign', parentSessionId: OTHER_SESSION, status: 'running' } as MonitoredAgent;
    const unowned = { agentId: 'unowned', status: 'running' } as MonitoredAgent;
    storeMock.activeSessionSubagents.mockReturnValue([{ parentToolUseId: 'session-foreign' }]);
    storeMock.pendingPermissions.mockReturnValue([{ agentId: 'foreign' }]);
    storeMock.getSubagent.mockReturnValue({ parentToolUseId: 'selected', status: 'completed' });
    const panel = createPanel(null, [foreign, unowned]).componentInstance;
    panel.selectedAgentId.set('selected');

    expect(panel.effectiveAgents()).toEqual([]);
    expect(panel.effectiveWorkflowSubagents()).toEqual([]);
    expect(panel.effectiveSessionSubagents()).toEqual([]);
    expect(panel.sessionSubagents()).toEqual([]);
    expect(panel.effectivePermissions()).toEqual([]);
    expect(panel.totalCount()).toBe(0);
    expect(storeMock.activeWorkflowSubagents).not.toHaveBeenCalled();
    expect(storeMock.activeSessionSubagents).not.toHaveBeenCalled();
    expect(storeMock.activeTabAgents).not.toHaveBeenCalled();
    expect(storeMock.workflowSubagentsForSession).not.toHaveBeenCalled();
    expect(storeMock.sessionSubagentsForSession).not.toHaveBeenCalled();
  });

  it('does not clear any session from a scoped host with a null session id', () => {
    const fixture = createPanel(null);

    fixture.componentInstance.onClearCompleted();

    expect(storeMock.clearCompleted).not.toHaveBeenCalled();
    expect(storeMock.clearCompletedInSession).not.toHaveBeenCalled();
  });

  it('falls back to the active-tab selector for the unscoped main panel', () => {
    TestBed.overrideProvider(SESSION_CONTEXT, { useValue: null });
    const fixture = createPanel(null);

    expect(fixture.componentInstance.effectiveWorkflowSubagents()).toHaveLength(
      1,
    );
    expect(storeMock.activeWorkflowSubagents).toHaveBeenCalled();
  });

  it('scopes the selector to a resolved tile session', () => {
    const fixture = createPanel(OTHER_SESSION);

    fixture.componentInstance.effectiveWorkflowSubagents();

    expect(storeMock.workflowSubagentsForSession).toHaveBeenCalledWith(
      OTHER_SESSION,
    );
  });

  it('keeps only owned CLI agents and workflow/session subagents in a scoped panel', () => {
    const owned = { agentId: 'owned', parentSessionId: OTHER_SESSION, status: 'running' } as MonitoredAgent;
    const unowned = { agentId: 'unowned', status: 'running' } as MonitoredAgent;
    const foreign = { agentId: 'foreign', parentSessionId: 'another', status: 'running' } as MonitoredAgent;
    const workflow = [
      { parentToolUseId: 'workflow-owned', parentSessionId: OTHER_SESSION, workflowRunId: 'run' },
      { parentToolUseId: 'workflow-unowned', workflowRunId: 'run' },
      { parentToolUseId: 'workflow-foreign', parentSessionId: 'another', workflowRunId: 'run' },
    ];
    const session = [
      { parentToolUseId: 'session-owned', parentSessionId: OTHER_SESSION },
      { parentToolUseId: 'session-unowned' },
      { parentToolUseId: 'session-foreign', parentSessionId: 'another' },
    ];
    storeMock.workflowSubagentsForSession.mockReturnValue(workflow);
    storeMock.sessionSubagentsForSession.mockReturnValue(session);
    storeMock.pendingPermissions.mockReturnValue([
      { agentId: 'owned' },
      { agentId: 'unowned' },
    ]);
    const fixture = createPanel(OTHER_SESSION, [owned, unowned, foreign]);
    const panel = fixture.componentInstance;

    expect(panel.effectiveAgents().map((agent) => agent.agentId)).toEqual(['owned']);
    expect(panel.effectiveWorkflowSubagents().map((agent) => agent.parentToolUseId)).toEqual(['workflow-owned']);
    expect(panel.effectiveSessionSubagents().map((agent) => agent.parentToolUseId)).toEqual(['session-owned']);
    expect(panel.workflowGroups()).toHaveLength(1);
    expect(panel.sessionSubagents()).toHaveLength(1);
    expect(panel.totalCount()).toBe(3);
    expect(panel.effectivePermissions().map((permission) => permission.agentId)).toEqual(['owned']);
  });

  it('keeps unresolved agents visible in the unscoped main panel', () => {
    TestBed.overrideProvider(SESSION_CONTEXT, { useValue: null });
    const unowned = { agentId: 'unowned', status: 'running' } as MonitoredAgent;
    storeMock.activeWorkflowSubagents.mockReturnValue([
      { parentToolUseId: 'workflow-unowned', workflowRunId: 'run' },
    ]);
    storeMock.activeSessionSubagents.mockReturnValue([
      { parentToolUseId: 'session-unowned' },
    ]);
    const panel = createPanel(null, [unowned]).componentInstance;

    expect(panel.effectiveAgents()).toEqual([unowned]);
    expect(panel.effectiveWorkflowSubagents()).toHaveLength(1);
    expect(panel.sessionSubagents()).toHaveLength(1);
    expect(panel.totalCount()).toBe(3);
  });

  it('keeps unresolved agents in the main-panel host even with a resolved session id', () => {
    TestBed.overrideProvider(SESSION_CONTEXT, { useValue: null });
    const unowned = { agentId: 'unowned', status: 'running' } as MonitoredAgent;
    storeMock.workflowSubagentsForSession.mockReturnValue([
      { parentToolUseId: 'workflow-unowned', workflowRunId: 'run' },
    ]);
    storeMock.sessionSubagentsForSession.mockReturnValue([
      { parentToolUseId: 'session-unowned' },
    ]);
    const panel = createPanel(OTHER_SESSION, [unowned]).componentInstance;

    expect(panel.effectiveAgents()).toEqual([unowned]);
    expect(panel.effectiveWorkflowSubagents()).toHaveLength(1);
    expect(panel.sessionSubagents()).toHaveLength(1);
    expect(panel.totalCount()).toBe(3);
  });

  it('does not restore an unowned selected terminal subagent into a scoped group', () => {
    storeMock.getSubagent.mockReturnValue({
      parentToolUseId: 'finished',
      status: 'completed',
    });
    const panel = createPanel(OTHER_SESSION).componentInstance;
    panel.selectedAgentId.set('finished');

    expect(panel.sessionSubagents()).toEqual([]);
  });

  it('keeps an empty scoped session out of both scoped and active selectors', () => {
    const fixture = createPanel('');

    expect(fixture.componentInstance.effectiveWorkflowSubagents()).toEqual([]);
    expect(storeMock.activeWorkflowSubagents).not.toHaveBeenCalled();
    expect(storeMock.workflowSubagentsForSession).not.toHaveBeenCalled();
  });

  it('clears nothing when a tile with an unresolved session clears completed', () => {
    const fixture = createPanel('');

    fixture.componentInstance.onClearCompleted();

    // The falsy test used to send this down the global branch, wiping every
    // OTHER session's completed agents.
    expect(storeMock.clearCompleted).not.toHaveBeenCalled();
    expect(storeMock.clearCompletedInSession).not.toHaveBeenCalled();
  });

  it('still clears globally from the GLOBAL panel', () => {
    TestBed.overrideProvider(SESSION_CONTEXT, { useValue: null });
    const fixture = createPanel(null);

    fixture.componentInstance.onClearCompleted();

    expect(storeMock.clearCompleted).toHaveBeenCalled();
  });

  it('keeps SESSION_CARD_ACTIONS-only hosts tolerant', () => {
    TestBed.overrideProvider(SESSION_CONTEXT, { useValue: null });
    TestBed.overrideProvider(SESSION_CARD_ACTIONS, {
      useValue: { openLane: jest.fn(), openSession: jest.fn() },
    });
    const unowned = { agentId: 'unowned', status: 'running' } as MonitoredAgent;
    const panel = createPanel(null, [unowned]).componentInstance;

    expect(panel.effectiveAgents()).toEqual([unowned]);
    expect(panel.effectiveWorkflowSubagents()).toHaveLength(1);
    panel.onClearCompleted();
    expect(storeMock.clearCompleted).toHaveBeenCalledTimes(1);
  });

  it('clears only its own session from a resolved tile', () => {
    const fixture = createPanel(OTHER_SESSION);

    fixture.componentInstance.onClearCompleted();

    expect(storeMock.clearCompletedInSession).toHaveBeenCalledWith(
      OTHER_SESSION,
    );
    expect(storeMock.clearCompleted).not.toHaveBeenCalled();
  });

  /**
   * L-7. The panel renders agent markdown and so opts into file links, but it
   * carried no tab marker — a relative link from an agent in a BACKGROUND
   * workspace resolved against the ACTIVE one and could open a same-named file
   * from a different repository (AC 22).
   */
  describe('file-link tab context', () => {
    it('publishes the owning tab for a scoped panel', () => {
      findTabBySessionIdAcrossWorkspaces.mockReturnValue({
        tab: { id: 'tab-bg' },
        workspacePath: 'D:/background-ws',
      });
      const fixture = createPanel(OTHER_SESSION);
      fixture.detectChanges();

      expect(findTabBySessionIdAcrossWorkspaces).toHaveBeenCalledWith(
        OTHER_SESSION,
      );
      const host = fixture.nativeElement as HTMLElement;
      expect(host.hasAttribute('data-ptah-file-links')).toBe(true);
      expect(host.getAttribute('data-ptah-tab-id')).toBe('tab-bg');
    });

    it('publishes no tab for an unresolved scoped panel', () => {
      const fixture = createPanel(null);
      fixture.detectChanges();

      expect(findTabBySessionIdAcrossWorkspaces).not.toHaveBeenCalled();
      expect(
        (fixture.nativeElement as HTMLElement).hasAttribute('data-ptah-tab-id'),
      ).toBe(false);
    });

    it('publishes no tab when the scoped session has no tab anywhere', () => {
      findTabBySessionIdAcrossWorkspaces.mockReturnValue(null);
      const fixture = createPanel(OTHER_SESSION);
      fixture.detectChanges();

      expect(
        (fixture.nativeElement as HTMLElement).hasAttribute('data-ptah-tab-id'),
      ).toBe(false);
    });
  });
});
