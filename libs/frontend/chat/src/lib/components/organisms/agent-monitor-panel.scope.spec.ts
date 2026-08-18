/**
 * AgentMonitorPanelComponent — scope handling for an unresolved session
 * (TASK_2026_295).
 *
 * The panel's `sessionId` input is tri-state: `null` is the GLOBAL panel, a
 * real id is a scoped tile, and `''` is a scoped tile whose session has not
 * resolved yet. Both scope-sensitive branches used a plain falsy test, so `''`
 * fell into the GLOBAL branch — a tile rendered another session's workflow run
 * groups, and its "Clear completed" wiped every session.
 */

import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import { VSCodeService } from '@ptah-extension/core';
import { PanelResizeService } from '../../services/panel-resize.service';
import { AgentMonitorPanelComponent } from './agent-monitor-panel.component';

const OTHER_SESSION = 'session-other';

describe('AgentMonitorPanelComponent — unresolved session scope', () => {
  let storeMock: {
    activeWorkflowSubagents: jest.Mock;
    workflowSubagentsForSession: jest.Mock;
    clearCompleted: jest.Mock;
    clearCompletedInSession: jest.Mock;
    activeTabAgents: jest.Mock;
    pendingPermissions: jest.Mock;
    panelOpen: jest.Mock;
    closePanel: jest.Mock;
    tick: ReturnType<typeof signal<number>>;
  };

  function createPanel(sessionId: string | null) {
    const fixture = TestBed.createComponent(AgentMonitorPanelComponent);
    fixture.componentRef.setInput('embeddedAgents', []);
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
      clearCompleted: jest.fn(),
      clearCompletedInSession: jest.fn(),
      activeTabAgents: jest.fn(() => []),
      pendingPermissions: jest.fn(() => []),
      panelOpen: jest.fn(() => false),
      closePanel: jest.fn(),
      tick: signal(0),
    };

    TestBed.configureTestingModule({
      imports: [AgentMonitorPanelComponent],
      providers: [
        { provide: AgentMonitorStore, useValue: storeMock },
        {
          provide: VSCodeService,
          useValue: {
            config: signal({ panelId: '', workspaceRoot: '/tmp' }),
            postMessage: jest.fn(),
          },
        },
        {
          provide: PanelResizeService,
          useValue: {
            agentPanelWidth: signal(320),
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

  it('still falls back to the active-tab selector for the GLOBAL panel', () => {
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

  it('clears nothing when a tile with an unresolved session clears completed', () => {
    const fixture = createPanel('');

    fixture.componentInstance.onClearCompleted();

    // The falsy test used to send this down the global branch, wiping every
    // OTHER session's completed agents.
    expect(storeMock.clearCompleted).not.toHaveBeenCalled();
    expect(storeMock.clearCompletedInSession).not.toHaveBeenCalled();
  });

  it('still clears globally from the GLOBAL panel', () => {
    const fixture = createPanel(null);

    fixture.componentInstance.onClearCompleted();

    expect(storeMock.clearCompleted).toHaveBeenCalled();
  });

  it('clears only its own session from a resolved tile', () => {
    const fixture = createPanel(OTHER_SESSION);

    fixture.componentInstance.onClearCompleted();

    expect(storeMock.clearCompletedInSession).toHaveBeenCalledWith(
      OTHER_SESSION,
    );
    expect(storeMock.clearCompleted).not.toHaveBeenCalled();
  });
});
