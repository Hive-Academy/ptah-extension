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
import { TabManagerService } from '@ptah-extension/chat-state';
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
  let findTabBySessionIdAcrossWorkspaces: jest.Mock;

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
    findTabBySessionIdAcrossWorkspaces = jest.fn(() => null);

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

  it('delegates an unresolved tile to the scoped selector, never the global one', () => {
    const fixture = createPanel('');

    expect(fixture.componentInstance.effectiveWorkflowSubagents()).toEqual([]);
    // The falsy test used to send this down the active-tab branch, so the tile
    // rendered ANOTHER session's workflow run groups. One rule now decides
    // both halves, inside `agentVisibleInSession` via the store.
    expect(storeMock.activeWorkflowSubagents).not.toHaveBeenCalled();
    expect(storeMock.workflowSubagentsForSession).toHaveBeenCalledWith('');
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

    it('publishes no tab for the GLOBAL panel, which already follows the active tab', () => {
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
