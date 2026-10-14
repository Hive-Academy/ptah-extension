import axe from 'axe-core';
import { Component, input, output, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideSurfaceActiveTesting } from '@ptah-extension/core/testing';
import { VSCodeService } from '@ptah-extension/core';
import {
  AgentMonitorStore,
  type MonitoredAgent,
  type SubagentRecord,
} from '@ptah-extension/chat-streaming';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  DISPLAY_PANEL_SUMMARY_KEY,
  DisplayPanelComponent,
  type DisplayPanelViewStateChange,
  type DisplaySurface,
} from '@ptah-extension/chat-ui/display-panel';
import type { TurnSummaryModel } from '@ptah-extension/chat-ui/turn-recap';
import type { SurfaceViewState } from '@ptah-extension/declarative-dashboard';
import type { SurfaceContent } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { TurnChangeSet } from '@ptah-extension/shared';
import { DisplayDockState } from '../../../services/display-dock/display-dock.state';
import { ChangeSetActionsService } from '../../../services/change-set/change-set-actions.service';
import { PanelResizeService } from '../../../services/panel-resize.service';
import { AgentMonitorPanelComponent } from '../agent-monitor-panel.component';
import { DisplayDockComponent } from './display-dock.component';

/** Stands in for the lazy panel so the dock's own wiring is what is tested. */
@Component({
  selector: 'ptah-display-panel',
  standalone: true,
  template: `<span data-testid="stub-panel">{{ surfaces().length }}</span>`,
})
class StubDisplayPanelComponent {
  readonly surfaces = input<readonly DisplaySurface[]>([]);
  readonly summary = input<TurnSummaryModel | null>(null);
  readonly selectedKey = input<string | null>(null);
  readonly pinned = input(false);
  readonly viewStates = input<ReadonlyMap<string, SurfaceViewState>>(new Map());
  readonly actionError = input<string | null>(null);
  readonly selectedKeyChange = output<string>();
  readonly viewStateChange = output<DisplayPanelViewStateChange>();
  readonly openFile = output<string>();
  readonly review = output<void>();
}

const TAB = 'tab-1';

function surface(key: string, updatedSeq = 1): DisplaySurface {
  return {
    key,
    displayId: key.slice(3),
    content: { marker: key } as unknown as SurfaceContent,
    title: key,
    description: null,
    turnKey: 'turn-1',
    fenceKey: `m1:n1:${key}:${updatedSeq}`,
    createdSeq: 1,
    updatedSeq,
    componentSignatures: new Map(),
    retainedViewStateIds: new Set(),
  };
}

function changeSet(): TurnChangeSet {
  return {
    sessionId: 's',
    workspaceRoot: '/w',
    turnStartedAt: 0,
    turnEndedAt: 1,
    files: [{ path: 'src/a.ts', status: 'M', additions: 1, deletions: 0 }],
    truncatedCount: 0,
    totals: { files: 1, additions: 1, deletions: 0 },
    countsUnavailable: false,
  } as TurnChangeSet;
}

const MODEL = { marker: 'summary' } as unknown as TurnSummaryModel;

function runningAgent(): MonitoredAgent {
  return {
    agentId: 'a1',
    cli: 'ptah-cli',
    task: 'work',
    status: 'running',
    startedAt: 0,
    stdout: '',
    stderr: '',
    expanded: false,
    segments: [],
    streamEvents: [],
    streamRevision: 0,
    permissionQueue: [],
  } as MonitoredAgent;
}

describe('DisplayDockComponent', () => {
  let fixture: ComponentFixture<DisplayDockComponent>;
  let dock: DisplayDockState;
  let actions: { openFile: jest.Mock; review: jest.Mock };

  beforeEach(() => {
    actions = {
      openFile: jest.fn().mockResolvedValue(undefined),
      review: jest.fn().mockResolvedValue(undefined),
    };
    TestBed.configureTestingModule({
      imports: [DisplayDockComponent],
      providers: [
        provideSurfaceActiveTesting(),
        DisplayDockState,
        { provide: ChangeSetActionsService, useValue: actions },
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
            toggleAgentExpanded: jest.fn(),
            tick: signal(0),
            cliOutputDemand: signal([]),
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
            customWidth: signal<number | null>(null),
            dragging: signal(false),
          },
        },
      ],
    });
    TestBed.overrideComponent(DisplayDockComponent, {
      remove: { imports: [DisplayPanelComponent] },
      add: { imports: [StubDisplayPanelComponent] },
    });
    dock = TestBed.inject(DisplayDockState);
    dock.open(TAB);
    fixture = TestBed.createComponent(DisplayDockComponent);
    fixture.componentRef.setInput('tabId', TAB);
    fixture.componentRef.setInput('sessionId', 'session-1');
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    TestBed.resetTestingModule();
  });

  const native = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const tabs = (): HTMLButtonElement[] =>
    Array.from(native().querySelectorAll('[data-testid="display-dock-tab"]'));
  const tab = (name: 'displays' | 'agents'): HTMLButtonElement =>
    native().querySelector(`[data-tab="${name}"]`) as HTMLButtonElement;
  const tabpanel = (name: 'displays' | 'agents'): HTMLElement =>
    native().querySelector(`[data-testid="display-dock-${name}"]`) as HTMLElement;
  const panel = (): StubDisplayPanelComponent =>
    fixture.debugElement.query(By.directive(StubDisplayPanelComponent))
      .componentInstance as StubDisplayPanelComponent;
  const flush = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  describe('Displays | Agents tablist (design assertions 6-9)', () => {
    it('is a labelled tablist with one selected tab controlling its tabpanel', () => {
      const list = native().querySelector('[role="tablist"]');
      expect(list?.getAttribute('aria-label')).toBe('Display panel sections');
      expect(tabs()).toHaveLength(2);
      expect(tabs().filter((t) => t.getAttribute('aria-selected') === 'true')).toEqual([
        tab('displays'),
      ]);
      for (const name of ['displays', 'agents'] as const) {
        const controlled = native().querySelector(
          `#${tab(name).getAttribute('aria-controls')}`,
        );
        expect(controlled).toBe(tabpanel(name));
        expect(controlled?.getAttribute('role')).toBe('tabpanel');
        expect(controlled?.getAttribute('aria-labelledby')).toBe(tab(name).id);
      }
      expect(tab('displays').tabIndex).toBe(0);
      expect(tab('agents').tabIndex).toBe(-1);
      expect(tabpanel('displays').hidden).toBe(false);
      expect(tabpanel('agents').hidden).toBe(true);
    });

    it('moves selection and focus with wrapping arrows, Home and End', () => {
      tab('displays').focus();
      tab('displays').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
      fixture.detectChanges();
      expect(dock.tab(TAB).activeTab).toBe('agents');
      expect(document.activeElement).toBe(tab('agents'));
      expect(tabpanel('agents').hidden).toBe(false);
      expect(tabpanel('displays').hidden).toBe(true);
      expect(tab('agents').tabIndex).toBe(0);

      tab('agents').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
      fixture.detectChanges();
      expect(dock.tab(TAB).activeTab).toBe('displays');

      tab('displays').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
      );
      fixture.detectChanges();
      expect(dock.tab(TAB).activeTab).toBe('agents');

      tab('agents').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Home', bubbles: true }),
      );
      fixture.detectChanges();
      expect(dock.tab(TAB).activeTab).toBe('displays');
      expect(document.activeElement).toBe(tab('displays'));
    });

    // jsdom does not compute CSS, so it cannot show `.flex { display: flex }`
    // overriding the `[hidden]` attribute. The class contract is the guard:
    // the inactive panel must never carry `flex` and must carry `hidden` (D1, #149).
    it.each([
      ['displays', 'agents'],
      ['agents', 'displays'],
    ] as const)(
      'with %s active, hides the %s panel by attribute and class, not overridden by flex',
      (active, inactive) => {
        dock.selectTab(TAB, active);
        fixture.detectChanges();

        const shown = tabpanel(active);
        expect(shown.classList.contains('flex')).toBe(true);
        expect(shown.classList.contains('hidden')).toBe(false);
        expect(shown.hasAttribute('hidden')).toBe(false);

        const off = tabpanel(inactive);
        expect(off.hasAttribute('hidden')).toBe(true);
        expect(off.classList.contains('hidden')).toBe(true);
        expect(off.classList.contains('flex')).toBe(false);
      },
    );

    it('keeps both tabpanels mounted across tab switches', () => {
      dock.selectTab(TAB, 'agents');
      fixture.detectChanges();
      expect(tabpanel('displays')).not.toBeNull();
      expect(panel()).toBeTruthy();
      dock.selectTab(TAB, 'displays');
      fixture.detectChanges();
      expect(tabpanel('agents')).not.toBeNull();
    });

    it('labels each tab with its count and a running suffix', () => {
      dock.setSurfaces(TAB, {
        surfaces: [surface('id:a'), surface('id:b')],
        statuses: new Map(),
      });
      fixture.componentRef.setInput('agents', [runningAgent()]);
      fixture.detectChanges();
      expect(tab('displays').textContent).toContain('Displays (2)');
      expect(tab('agents').textContent).toContain('Agents (1)');
      expect(tab('agents').textContent).toContain(', 1 running');
      // Agents is not shown and has a running agent: it is marked new.
      expect(tab('agents').querySelector('.sr-only')?.textContent).toBe('New: ');
    });

    it('marks the Displays tab new when a surface changes while Agents shows', () => {
      dock.setSurfaces(TAB, { surfaces: [surface('id:a', 1)], statuses: new Map() });
      fixture.detectChanges();
      dock.selectTab(TAB, 'agents');
      fixture.detectChanges();
      expect(tab('displays').querySelector('[data-testid="display-dock-tab-new"]')).toBeNull();

      dock.setSurfaces(TAB, { surfaces: [surface('id:a', 2)], statuses: new Map() });
      fixture.detectChanges();
      expect(
        tab('displays').querySelector('[data-testid="display-dock-tab-new"]'),
      ).not.toBeNull();

      dock.selectTab(TAB, 'displays');
      fixture.detectChanges();
      dock.selectTab(TAB, 'agents');
      fixture.detectChanges();
      expect(tab('displays').querySelector('[data-testid="display-dock-tab-new"]')).toBeNull();
    });
  });

  it('always has the Agents tabpanel, with "No agents in this session" (R1.13, #11)', () => {
    tab('agents').click();
    fixture.detectChanges();
    const agents = tabpanel('agents');
    expect(agents.getAttribute('role')).toBe('tabpanel');
    expect(agents.hidden).toBe(false);
    expect(agents.getAttribute('aria-labelledby')).toBe(tab('agents').id);
    expect(agents.textContent).toContain('No agents in this session');
    // The dock owns close: the docked monitor has no close button of its own.
    expect(agents.querySelector('button[title="Close panel"]')).toBeNull();
  });

  describe('hideAgents (HIDE_AGENT_SIDEBAR, decision 109)', () => {
    const workflowSubagent = {
      parentToolUseId: 'toolu_wf',
      status: 'running',
      workflowRunId: 'run-1',
      workflowName: 'Panel run',
      teammateName: 'Panelist A',
      parentSessionId: 'session-1',
    } as SubagentRecord;
    const sessionSubagent = {
      parentToolUseId: 'toolu_bg',
      status: 'background',
      teammateName: 'Panelist B',
      parentSessionId: 'session-1',
    } as SubagentRecord;

    let store: Record<string, jest.Mock>;

    /** Remounts the dock with workflow and session subagents in the store. */
    function remount(hideAgents?: boolean): void {
      fixture.destroy();
      store = TestBed.inject(AgentMonitorStore) as unknown as Record<
        string,
        jest.Mock
      >;
      store['workflowSubagentsForSession'].mockClear();
      store['sessionSubagentsForSession'].mockClear();
      store['workflowSubagentsForSession'].mockReturnValue([workflowSubagent]);
      store['sessionSubagentsForSession'].mockReturnValue([sessionSubagent]);
      store['getSubagent'].mockImplementation((id: string) =>
        [workflowSubagent, sessionSubagent].find((r) => r.parentToolUseId === id),
      );
      store['getSubagentTranscript'] = jest.fn().mockResolvedValue([]);
      store['loadSubagentCacheInfo'] = jest.fn().mockResolvedValue(undefined);
      dock.setSurfaces(TAB, { surfaces: [surface('id:chart')], statuses: new Map() });
      fixture = TestBed.createComponent(DisplayDockComponent);
      fixture.componentRef.setInput('tabId', TAB);
      fixture.componentRef.setInput('sessionId', 'session-1');
      if (hideAgents !== undefined) {
        fixture.componentRef.setInput('hideAgents', hideAgents);
      }
      fixture.detectChanges();
      dock.selectTab(TAB, 'agents');
      fixture.detectChanges();
    }

    const monitor = (): AgentMonitorPanelComponent =>
      fixture.debugElement.query(By.directive(AgentMonitorPanelComponent))
        ?.componentInstance as AgentMonitorPanelComponent;

    it('shows no workflow or session subagent tiles and keeps the displays', () => {
      remount(true);
      expect(tab('agents').textContent).toContain('Agents (0)');
      // The store-reading monitor never mounts, so no subagent is read.
      expect(monitor()).toBeUndefined();
      expect(store['workflowSubagentsForSession']).not.toHaveBeenCalled();
      expect(store['sessionSubagentsForSession']).not.toHaveBeenCalled();
      const agents = tabpanel('agents');
      expect(agents.hidden).toBe(false);
      expect(agents.getAttribute('role')).toBe('tabpanel');
      expect(agents.textContent).toContain('No agents in this session');
      expect(agents.textContent).not.toContain('Panelist');
      expect(agents.textContent).not.toContain('Panel run');
      expect(agents.querySelector('.badge.badge-sm.badge-neutral')).toBeNull();
      // The display surfaces are unaffected.
      expect(dock.tab(TAB).open).toBe(true);
      expect(tab('displays').textContent).toContain('Displays (1)');
      expect(panel().surfaces()).toHaveLength(1);
    });

    it('without the input, the same subagents still show (unchanged)', () => {
      remount();
      expect(monitor().totalCount()).toBe(2);
      expect(monitor().workflowGroups()).toHaveLength(1);
      expect(monitor().sessionSubagentTiles()).toHaveLength(1);
      const agents = tabpanel('agents');
      expect(agents.textContent).not.toContain('No agents in this session');
      expect(
        agents.querySelector('.badge.badge-sm.badge-neutral')?.textContent?.trim(),
      ).toBe('2');
      expect(panel().surfaces()).toHaveLength(1);
    });
  });

  describe('pin and close', () => {
    it('pin is a toggle button with aria-pressed', () => {
      const pin = native().querySelector(
        '[data-testid="display-dock-pin"]',
      ) as HTMLButtonElement;
      expect(pin.getAttribute('aria-label')).toBe('Pin panel');
      expect(pin.getAttribute('aria-pressed')).toBe('false');
      pin.click();
      fixture.detectChanges();
      expect(dock.tab(TAB).pinned).toBe(true);
      expect(pin.getAttribute('aria-pressed')).toBe('true');
      expect(panel().pinned()).toBe(true);
    });

    it('close has a name and reports the close', () => {
      const closed = jest.fn();
      fixture.componentInstance.closed.subscribe(closed);
      const close = native().querySelector(
        '[data-testid="display-dock-close"]',
      ) as HTMLButtonElement;
      expect(close.getAttribute('aria-label')).toBe('Close panel');
      close.click();
      expect(closed).toHaveBeenCalledTimes(1);
    });

    it('is hidden while the tab dock is closed', () => {
      dock.close(TAB);
      fixture.detectChanges();
      expect(native().classList.contains('hidden')).toBe(true);
    });
  });

  describe('Displays tabpanel bindings (decisions #101, #102)', () => {
    it('binds the store surfaces, pin, view states and summary model', () => {
      const surfaces = [surface('id:a')];
      dock.setSurfaces(TAB, { surfaces, statuses: new Map() });
      dock.setSummaries(TAB, new Map([['turn-1', { model: MODEL, changeSet: null }]]));
      fixture.detectChanges();
      expect(panel().surfaces()).toBe(surfaces);
      expect(panel().summary()).toBe(MODEL);
      expect(panel().viewStates()).toBe(dock.tab(TAB).viewStates);
    });

    it('maps the selection to the strip key both ways', () => {
      dock.setSurfaces(TAB, { surfaces: [surface('id:a')], statuses: new Map() });
      fixture.detectChanges();
      expect(panel().selectedKey()).toBeNull();

      dock.select(TAB, { kind: 'surface', surfaceKey: 'id:a' });
      fixture.detectChanges();
      expect(panel().selectedKey()).toBe('id:a');

      dock.select(TAB, { kind: 'summary' });
      fixture.detectChanges();
      expect(panel().selectedKey()).toBe(DISPLAY_PANEL_SUMMARY_KEY);

      panel().selectedKeyChange.emit('id:a');
      expect(dock.tab(TAB).selection).toEqual({ kind: 'surface', surfaceKey: 'id:a' });
      panel().selectedKeyChange.emit(DISPLAY_PANEL_SUMMARY_KEY);
      expect(dock.tab(TAB).selection).toEqual({ kind: 'summary' });
    });

    it('stores a view-state change for its surface', () => {
      dock.setSurfaces(TAB, { surfaces: [surface('id:a')], statuses: new Map() });
      fixture.detectChanges();
      const viewState = { components: {}, drafts: {} } as SurfaceViewState;
      panel().viewStateChange.emit({ surfaceKey: 'id:a', viewState });
      expect(dock.tab(TAB).viewStates.get('id:a')).toBe(viewState);
    });

    it('runs openFile and review on the shown summary change set', async () => {
      const set = changeSet();
      dock.setSummaries(TAB, new Map([['turn-1', { model: MODEL, changeSet: set }]]));
      fixture.detectChanges();
      panel().openFile.emit('src/a.ts');
      panel().review.emit();
      await flush();
      expect(actions.openFile).toHaveBeenCalledWith(set, 'src/a.ts');
      expect(actions.review).toHaveBeenCalledWith(set);
      expect(panel().actionError()).toBeNull();
    });

    it('shows a rejection inline in the summary', async () => {
      dock.setSummaries(
        TAB,
        new Map([['turn-1', { model: MODEL, changeSet: changeSet() }]]),
      );
      actions.review.mockRejectedValueOnce(new Error('Could not open the review.'));
      fixture.detectChanges();
      panel().review.emit();
      await flush();
      expect(panel().actionError()).toBe('Could not open the review.');
    });

    it('sets actionError without calling the service when the turn has no change set', async () => {
      dock.setSummaries(TAB, new Map([['turn-1', { model: MODEL, changeSet: null }]]));
      fixture.detectChanges();
      panel().openFile.emit('src/a.ts');
      await flush();
      expect(actions.openFile).not.toHaveBeenCalled();
      expect(panel().actionError()).toBe(
        'This turn has no recorded file changes to open.',
      );
    });
  });

  it('shows the state of the tab it is bound to (R1.1)', () => {
    dock.setSurfaces(TAB, { surfaces: [surface('id:a')], statuses: new Map() });
    dock.open('tab-2');
    dock.selectTab('tab-2', 'agents');
    fixture.detectChanges();
    expect(tab('displays').textContent).toContain('Displays (1)');

    fixture.componentRef.setInput('tabId', 'tab-2');
    fixture.detectChanges();
    expect(tab('displays').textContent).toContain('Displays (0)');
    expect(tab('agents').getAttribute('aria-selected')).toBe('true');
  });

  it('restores each tab pin and section when the dock host switches tabs', () => {
    const pin = (): HTMLButtonElement =>
      native().querySelector('[data-testid="display-dock-pin"]') as HTMLButtonElement;
    pin().click();
    tab('agents').click();
    fixture.detectChanges();

    dock.open('tab-2');
    fixture.componentRef.setInput('tabId', 'tab-2');
    fixture.detectChanges();
    expect(pin().getAttribute('aria-pressed')).toBe('false');
    expect(tab('displays').getAttribute('aria-selected')).toBe('true');

    fixture.componentRef.setInput('tabId', TAB);
    fixture.detectChanges();
    expect(pin().getAttribute('aria-pressed')).toBe('true');
    expect(tab('agents').getAttribute('aria-selected')).toBe('true');
  });

  describe('focus (R1.2, R1.7)', () => {
    it('focuses close only on a user open in overlay mode', async () => {
      fixture.componentRef.setInput('isOverlay', true);
      await flush();
      const close = native().querySelector(
        '[data-testid="display-dock-close"]',
      ) as HTMLButtonElement;
      expect(document.activeElement).not.toBe(close);

      fixture.componentRef.setInput('focusRequest', 1);
      await flush();
      expect(document.activeElement).toBe(close);
    });

    it('fills the parent as an overlay and takes its width beside the chat', () => {
      fixture.componentRef.setInput('widthPx', 300);
      fixture.detectChanges();
      expect(native().style.width).toBe('300px');
      fixture.componentRef.setInput('isOverlay', true);
      fixture.detectChanges();
      expect(native().classList.contains('absolute')).toBe(true);
      expect(native().style.width).toBe('');
    });
  });

  it('has no axe violations', async () => {
    dock.setSurfaces(TAB, { surfaces: [surface('id:a')], statuses: new Map() });
    fixture.detectChanges();
    const results = await axe.run(native() as Parameters<typeof axe.run>[0], {
      rules: {
        'color-contrast': { enabled: false },
        'target-size': { enabled: false },
      },
    });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
