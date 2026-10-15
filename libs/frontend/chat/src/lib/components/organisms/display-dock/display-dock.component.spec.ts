import axe from 'axe-core';
import { Component, input, output, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideSurfaceActiveTesting } from '@ptah-extension/core/testing';
import { VSCodeService } from '@ptah-extension/core';
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
  readonly summaryTurnKey = input('');
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
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    TestBed.resetTestingModule();
  });

  const native = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const panel = (): StubDisplayPanelComponent =>
    fixture.debugElement.query(By.directive(StubDisplayPanelComponent))
      .componentInstance as StubDisplayPanelComponent;
  const flush = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('shows one labelled display region and no Agents tab, badge or monitor', () => {
    expect(native().querySelector('[role="tablist"]')).toBeNull();
    expect(native().querySelector('[data-testid="display-dock-heading"]')?.textContent).toContain('Displays (0)');
    expect(native().querySelector('[data-testid="display-dock-displays"]')?.getAttribute('aria-label')).toBe('Displays');
    expect(native().querySelector('ptah-agent-monitor-panel')).toBeNull();
    expect(native().textContent).not.toContain('Agents (');
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

  describe('Displays panel bindings (decisions #101, #102)', () => {
    it('binds the store surfaces, pin, view states and summary model', () => {
      const surfaces = [surface('id:a')];
      dock.setSurfaces(TAB, { surfaces, statuses: new Map() });
      dock.setSummaries(TAB, new Map([['turn-1', { model: MODEL, changeSet: null }]]));
      fixture.detectChanges();
      expect(panel().surfaces()).toBe(surfaces);
      expect(panel().summary()).toBe(MODEL);
      // The panel keys its disclosure state on the source's turn id.
      expect(panel().summaryTurnKey()).toBe('turn-1');
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

  it('restores the display count and pin state by tab id', () => {
    dock.setSurfaces(TAB, { surfaces: [surface('id:a')], statuses: new Map() });
    native().querySelector<HTMLButtonElement>('[data-testid="display-dock-pin"]')?.click();
    fixture.detectChanges();
    dock.open('tab-2');
    fixture.componentRef.setInput('tabId', 'tab-2');
    fixture.detectChanges();
    expect(native().querySelector('[data-testid="display-dock-heading"]')?.textContent).toContain('Displays (0)');
    expect(panel().pinned()).toBe(false);
    fixture.componentRef.setInput('tabId', TAB);
    fixture.detectChanges();
    expect(native().querySelector('[data-testid="display-dock-heading"]')?.textContent).toContain('Displays (1)');
    expect(panel().pinned()).toBe(true);
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
