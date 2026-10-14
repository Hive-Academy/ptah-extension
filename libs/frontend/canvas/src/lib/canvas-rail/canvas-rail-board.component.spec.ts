import {
  ChangeDetectionStrategy,
  Component,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RailTranscriptRetentionCoordinator, TabManagerService } from '@ptah-extension/chat';
import {
  COMPACT_RAIL_CARD_HEIGHT,
  type CompactRailDensity,
  type CompactRailState,
} from '@ptah-extension/chat-ui';
import { CanvasStore, type CanvasTile } from '../canvas.store';
import { CanvasLayoutService } from '../canvas-layout.service';
import { CanvasLayoutPersistenceService } from '../canvas-layout-persistence.service';
import { CanvasRenderMetricsService } from '../canvas-render-metrics.service';
import { CanvasDetailService } from '../canvas-detail/canvas-detail.service';
import { RUNNING_CAP_MESSAGE } from '../canvas-running-cap';
import { CanvasRailBoardComponent } from './canvas-rail-board.component';

const sourceState = signal<CompactRailState>('idle');
type TestHost = Omit<HTMLElement, 'querySelector'> & {
  querySelector<T extends Element = Element>(selector: string): T;
};

@Component({
  selector: 'ptah-canvas-rail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="overflow-y-auto" style="height:200px">
    <ul>
      @for (tile of tiles(); track tile.tabId) {
        <li
          data-rail-card
          [attr.data-tab-id]="tile.tabId"
          [style.height.px]="collapsed() ? 56 : heights[density()]"
        >
          <button type="button" class="rc-select">{{ tile.tabId }}</button><span
            data-dot-state
            [attr.data-state]="states().get(tile.tabId) ?? 'idle'"
          ></span>
        </li>
      }
    </ul>
  </div>`,
})
class RailStub {
  readonly heights = COMPACT_RAIL_CARD_HEIGHT;
  readonly tiles = input<readonly CanvasTile[]>([]);
  readonly states = input<ReadonlyMap<string, CompactRailState>>(new Map());
  readonly focusedTabId = input<string | null>(null);
  readonly density = input<CompactRailDensity>('comfortable');
  readonly collapsed = input(false);
  readonly band = input('lg');
  readonly runningCount = input(0);
  readonly canStart = input(true);
  readonly canAdd = input(true);
  readonly holdTabId = input<string | null>(null);
  readonly surfaceActive = input(true);
  readonly splitDisabledReason = input<string | null>(null);
  readonly openBesideRequested = output<string>();
  readonly moveUpRequested = output<string>();
  readonly moveDownRequested = output<string>();
  readonly focusRequested = output<string>();
  readonly collapseToggled = output<void>();
  readonly densityToggled = output<void>();
  readonly jumpTo = output<CompactRailState>();
  readonly newSession = output<void>();
  readonly scrolled = output<number>();
  readonly railState = output<{ tabId: string; state: CompactRailState }>();
  readonly staleAction = output<string>();
  readonly lanesRequested = output<string>();
  constructor() {
    effect(() => {
      const state = sourceState();
      const tile = this.tiles()[0];
      if (tile) this.railState.emit({ tabId: tile.tabId, state });
    });
  }
}
@Component({
  selector: 'ptah-canvas-lane-view',
  standalone: true,
  template: '',
})
class LaneStub {}
@Component({
  selector: 'ptah-canvas-focus-area',
  standalone: true,
  imports: [LaneStub],
  template:
    '@if (focusedTabId()) { <ptah-canvas-lane-view /> }<button role="tab" aria-selected="true">Lane</button>',
})
class FocusStub {
  readonly focusedTabId = input<string | null>(null);
  readonly paneId = input<'left' | 'right'>('left');
  readonly paneLabel = input('Focused session');
  readonly paneFocused = input(true);
  readonly splitDisplayed = input(false);
  readonly state = input<CompactRailState>('idle');
  readonly band = input('lg');
  readonly closeRequested = output<string>();
}
@Component({
  selector: 'ptah-canvas-session-details',
  standalone: true,
  template: '<div>Details</div>',
})
class DetailsStub {
  readonly tabId = input.required<string>();
}

describe('CanvasRailBoardComponent actions', () => {
  const board = () => {
    const instance = Object.create(
      CanvasRailBoardComponent.prototype,
    ) as CanvasRailBoardComponent;
    const focusTile = jest.fn();
    const addTile = jest.fn(() => 'new');
    const removeTile = jest.fn(async () => undefined);
    let focusedId = 'a';
    Object.assign(instance, {
      store: {
        canStartRunningSession: () => true,
        canAddTile: () => true,
        addTile,
        focusTile: (id: string) => { focusedId = id; focusTile(id); },
        focusedTabIdFor: () => focusedId,
        removeTile,
        tiles: () => [],
      },
      workspacePath: () => 'workspace',
      orderedTiles: () => [{ tabId: 'a' }, { tabId: 'b' }],
      otherTabId: signal<string | null>(null),
      activeSide: signal<'left' | 'right'>('left'),
      visualOrder: signal<readonly ('left' | 'right')[]>(['left', 'right']),
      splitDisplayed: () => false,
      anchor: jest.fn(),
      newSessionRequested: { emit: jest.fn() },
    });
    return { instance, focusTile, addTile, removeTile };
  };

  it('asks the host for the named popover instead of adding a session', () => {
    const { instance, addTile } = board();
    instance.newSession();
    expect(instance.newSessionRequested.emit).toHaveBeenCalledTimes(1);
    expect(addTile).not.toHaveBeenCalled();
  });

  it('focuses, anchors and resets the geometry baseline after the host adds a session', () => {
    const { instance, focusTile } = board();
    Object.assign(instance, { geometryBaseline: { key: 'k' } });
    instance.sessionCreated('new');
    expect(focusTile).toHaveBeenCalledWith('new');
    expect(
      (instance as unknown as { anchor: jest.Mock }).anchor,
    ).toHaveBeenCalledTimes(1);
    expect(
      (instance as unknown as { geometryBaseline: unknown }).geometryBaseline,
    ).toBeNull();
  });

  it('focuses the next neighbour after closing a focused session', async () => {
    const { instance, removeTile, focusTile } = board();
    let remaining = [{ tabId: 'a' }, { tabId: 'b' }];
    Object.assign(instance, { orderedTiles: () => remaining });
    removeTile.mockImplementation(async () => {
      remaining = [{ tabId: 'b' }];
    });
    await instance.close('a');
    expect(removeTile).toHaveBeenCalledWith('a');
    expect(focusTile).toHaveBeenCalledWith('b');
  });

  it.each([
    ['running cap', false, true],
    ['tile bound', true, false],
  ])(
    'never adds at the %s; the host owns the refusal and its reason',
    (_label, canStart, canAdd) => {
      const { instance, addTile } = board();
      Object.assign(instance, {
        store: {
          canStartRunningSession: () => canStart,
          canAddTile: () => canAdd,
          addTile,
        },
      });
      instance.newSession();
      expect(addTile).not.toHaveBeenCalled();
      expect(instance.newSessionRequested.emit).toHaveBeenCalledTimes(1);
    },
  );
});

describe('CanvasRailBoardComponent rendering', () => {
  afterEach(() => jest.restoreAllMocks());

  function mount(visible = true, count = 2, initialFocus: string | null = 'a') {
    sourceState.set('idle');
    jest
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        return { height: Number.parseFloat(this.style.height) || 0 } as DOMRect;
      });
    const tiles = signal<readonly CanvasTile[]>(
      Array.from(
        { length: count },
        (_, order) =>
          ({ tabId: String.fromCharCode(97 + order), order }) as CanvasTile,
      ),
    );
    const canStart = signal(true);
    const focused = signal<string | null>(initialFocus);
    const board = signal<{
      mode: 'rail';
      railCollapsed: boolean;
      railDensity: CompactRailDensity;
      railScrollTop: number;
    }>({
      mode: 'rail' as const,
      railCollapsed: false,
      railDensity: 'comfortable' as const,
      railScrollTop: 0,
    });
    const width = signal(1400);
    const writeFailed = signal(false);
    const setRailCollapsed = jest.fn((_: string, value: boolean) =>
      board.update((b) => ({ ...b, railCollapsed: value })),
    );
    const setRailDensity = jest.fn(
      (_: string, density: 'comfortable' | 'dense') =>
        board.update((b) => ({ ...b, railDensity: density })),
    );
    const removeTile = jest.fn(async (id: string) => {
      tiles.update((current) => current.filter((tile) => tile.tabId !== id));
    });
    const store = {
      tilesFor: () => tiles,
      focusedTabIdFor: () => focused(),
      boardFor: () => board(),
      runningSessionCount: () => 0,
      canStartRunningSession: () => canStart(),
      canAddTile: () => true,
      focusTile: jest.fn((id: string) => focused.set(id)),
      setRailCollapsed,
      setRailDensity,
      removeTile,
      reorderTiles: jest.fn(),
      setRailScrollTop: jest.fn(),
      tiles: () => tiles(),
    };
    TestBed.configureTestingModule({
      imports: [CanvasRailBoardComponent],
      providers: [
        CanvasRenderMetricsService,
        { provide: CanvasStore, useValue: store },
        { provide: CanvasLayoutService, useValue: { containerWidth: width } },
        { provide: CanvasLayoutPersistenceService, useValue: { writeFailed } },
        { provide: CanvasDetailService, useValue: {} },
        {
          provide: TabManagerService,
          useValue: {
            findTabByIdAcrossWorkspaces: (id: string) => ({
              tab: { title: id },
            }),
          },
        },
      ],
    });
    TestBed.overrideComponent(CanvasRailBoardComponent, {
      set: { imports: [RailStub, FocusStub, DetailsStub] },
    });
    const fixture = TestBed.createComponent(CanvasRailBoardComponent);
    fixture.componentRef.setInput('workspacePath', 'workspace');
    fixture.componentRef.setInput('visible', visible);
    fixture.detectChanges();
    return {
      fixture: fixture as Omit<typeof fixture, 'nativeElement'> & {
        nativeElement: TestHost;
      },
      tiles,
      focused,
      board,
      width,
      writeFailed,
      store,
      canStart,
      metrics: TestBed.inject(CanvasRenderMetricsService),
    };
  }

  it('mounts no rail cards or focus area when hidden', () => {
    const { fixture } = mount(false);
    expect(
      fixture.nativeElement.querySelectorAll(
        '[data-rail-card], ptah-canvas-focus-area',
      ),
    ).toHaveLength(0);
  });

  it('single focus with null store focus renders one lane after removal and with a valid last focus', () => {
    const { fixture, focused, tiles } = mount(true, 3);
    focused.set('b');
    fixture.detectChanges();
    focused.set(null);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('ptah-canvas-focus-area')).toHaveLength(1);
    expect(fixture.nativeElement.querySelectorAll('ptah-canvas-lane-view')).toHaveLength(1);
    expect(fixture.componentInstance.paneTab(fixture.componentInstance.activeSide())).toBe('b');
    focused.set('b');
    fixture.detectChanges();
    tiles.update((current) => current.filter((tile) => tile.tabId !== 'b'));
    focused.set(null);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('ptah-canvas-focus-area')).toHaveLength(1);
    expect(fixture.nativeElement.querySelectorAll('ptah-canvas-lane-view')).toHaveLength(1);
  });

  it('chooses one visible pane and synchronizes rail focus when hydrated without focus', () => {
    const { fixture, focused, store } = mount(true, 3, null);
    expect(fixture.nativeElement.querySelectorAll('ptah-canvas-focus-area')).toHaveLength(1);
    expect(focused()).toBe('a');
    expect(store.focusTile).toHaveBeenCalledTimes(1);
    const pane = fixture.debugElement.query(By.directive(FocusStub)).componentInstance as FocusStub;
    const rail = fixture.debugElement.query(By.directive(RailStub)).componentInstance as RailStub;
    expect(pane.focusedTabId()).toBe('a');
    expect(rail.focusedTabId()).toBe(pane.focusedTabId());
  });

  it('retains the removed tile neighbour while hidden and focuses it on return', () => {
    const { fixture, focused, tiles, store } = mount(true, 3);
    focused.set('b');
    fixture.detectChanges();
    fixture.componentRef.setInput('visible', false);
    fixture.detectChanges();
    (store.focusTile as jest.Mock).mockClear();
    tiles.update((current) => current.filter((tile) => tile.tabId !== 'b'));
    focused.set(null);
    fixture.detectChanges();
    expect(store.focusTile).not.toHaveBeenCalled();
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('ptah-canvas-focus-area')).toHaveLength(1);
    expect(focused()).toBe('c');
    expect(store.focusTile).toHaveBeenCalledTimes(1);
    expect(fixture.debugElement.query(By.directive(FocusStub)).componentInstance.focusedTabId()).toBe('c');
  });

  it('synchronizes pane, rail and Details after external removal of the focused tile', () => {
    const { fixture, focused, tiles } = mount(true, 3);
    focused.set('b');
    fixture.detectChanges();
    tiles.update((current) => current.filter((tile) => tile.tabId !== 'b'));
    focused.set(null);
    fixture.detectChanges();
    const pane = fixture.debugElement.query(By.directive(FocusStub)).componentInstance as FocusStub;
    const rail = fixture.debugElement.query(By.directive(RailStub)).componentInstance as RailStub;
    const details = fixture.debugElement.query(By.directive(DetailsStub)).componentInstance as DetailsStub;
    expect(focused()).toBe('c');
    expect(pane.focusedTabId()).toBe('c');
    expect(rail.focusedTabId()).toBe(pane.focusedTabId());
    expect(details.tabId()).toBe(pane.focusedTabId());
  });

  it('a hidden board never focuses another workspace after split removal', () => {
    const { fixture, tiles, store } = mount();
    fixture.componentInstance.openBeside('b');
    fixture.detectChanges();
    (store.focusTile as jest.Mock).mockClear();
    fixture.componentRef.setInput('visible', false);
    tiles.update((current) => current.filter((tile) => tile.tabId !== 'b'));
    fixture.detectChanges();
    expect(store.focusTile).not.toHaveBeenCalled();
    expect(fixture.componentInstance.otherTabId()).toBeNull();
  });

  it('keeps card nodes and order when focus changes', () => {
    const { fixture, focused } = mount();
    const cards = [
      ...fixture.nativeElement.querySelectorAll('[data-rail-card]'),
    ];
    focused.set('b');
    fixture.detectChanges();
    expect([
      ...fixture.nativeElement.querySelectorAll('[data-rail-card]'),
    ]).toEqual(cards);
    expect(fixture.nativeElement.getAttribute('data-canvas-live-views')).toBe(
      '1',
    );
  });

  it.each(['comfortable', 'dense'] as const)(
    'keeps fixed %s geometry across state changes',
    (density) => {
      const { fixture, board, tiles, metrics } = mount();
      board.update((b) => ({ ...b, railDensity: density }));
      fixture.detectChanges();
      fixture.componentInstance.onRailState({ tabId: 'a', state: 'needs' });
      fixture.detectChanges();
      tiles.update((current) => [current[0], { ...current[1] }]);
      fixture.detectChanges();
      const cards = [
        ...fixture.nativeElement.querySelectorAll<HTMLElement>(
          '[data-rail-card]',
        ),
      ];
      expect(cards.map((card) => card.dataset['tabId'])).toEqual(['a', 'b']);
      expect(cards.map((card) => card.style.height)).toEqual([
        `${COMPACT_RAIL_CARD_HEIGHT[density]}px`,
        `${COMPACT_RAIL_CARD_HEIGHT[density]}px`,
      ]);
      expect(metrics.snapshot().railShifts).toBe(0);
    },
  );

  it('counts wrong height after baseline, including after a focus change', () => {
    const { fixture, focused, metrics } = mount();
    const card =
      fixture.nativeElement.querySelector<HTMLElement>('[data-rail-card]');
    card.getBoundingClientRect = () => ({ height: 17 }) as DOMRect;
    fixture.componentInstance.onRailState({ tabId: 'a', state: 'running' });
    fixture.detectChanges();
    expect(metrics.snapshot().railShifts).toBe(1);
    focused.set('b');
    fixture.detectChanges();
    fixture.componentInstance.onRailState({ tabId: 'a', state: 'needs' });
    fixture.detectChanges();
    expect(metrics.snapshot().railShifts).toBeGreaterThan(1);
    fixture.detectChanges();
    expect(fixture.nativeElement.getAttribute('data-canvas-rail-shifts')).toBe(
      String(metrics.snapshot().railShifts),
    );
  });

  it('anchors the last focused card after a density toggle', () => {
    const { fixture, focused } = mount();
    focused.set('b');
    fixture.detectChanges();
    const list =
      fixture.nativeElement.querySelector<HTMLElement>('.overflow-y-auto');
    Object.defineProperty(list, 'clientHeight', { value: 100 });
    list.scrollTop = 0;
    fixture.componentInstance.toggleDensity();
    fixture.detectChanges();
    expect(list.scrollTop).toBe(100);
  });

  it('auto-collapses for narrow details without persisting the user collapse', () => {
    const { fixture, width, store } = mount();
    width.set(1000);
    fixture.detectChanges();
    fixture.componentInstance.toggleDetails();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector<HTMLElement>('[data-rail-card]')
        ?.style.height,
    ).toBe('56px');
    expect(store.setRailCollapsed).not.toHaveBeenCalled();
  });

  it('keeps a full details column at the medium width band', () => {
    const { fixture, width } = mount();
    width.set(1200);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('aside.w-\\[296px\\]'),
    ).toBeTruthy();
    expect(
      fixture.nativeElement.querySelector('[aria-label="Open details"]'),
    ).toBeNull();
  });

  it('announces needs and error transitions after the initial state', () => {
    const { fixture } = mount();
    const instance = fixture.componentInstance;
    instance.onRailState({ tabId: 'a', state: 'idle' });
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[aria-live]')?.textContent?.trim(),
    ).toBe('');
    instance.onRailState({ tabId: 'a', state: 'needs' });
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[aria-live]')?.textContent,
    ).toContain('a needs you');
    instance.onRailState({ tabId: 'a', state: 'error' });
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[aria-live]')?.textContent,
    ).toContain('a stopped with an error');
  });

  it('removes document selection listeners when hidden', () => {
    const remove = jest.spyOn(document, 'removeEventListener');
    const { fixture } = mount();
    fixture.componentRef.setInput('visible', false);
    fixture.detectChanges();
    expect(remove).toHaveBeenCalledWith(
      'selectionchange',
      expect.any(Function),
    );
    remove.mockRestore();
  });

  it('focuses the selected lane tab after a lane request', () => {
    const { fixture } = mount();
    fixture.componentInstance.onLanesRequested('b');
    fixture.detectChanges();
    expect(document.activeElement).toBe(
      fixture.nativeElement.querySelector('[role="tab"]'),
    );
  });

  it('updates a collapsed dot and live region when the tab state changes', () => {
    const { fixture, board, width } = mount();
    board.update((value) => ({ ...value, railCollapsed: true }));
    fixture.detectChanges();
    sourceState.set('needs');
    fixture.detectChanges();
    expect(
      fixture.nativeElement
        .querySelector('[data-dot-state]')
        ?.getAttribute('data-state'),
    ).toBe('needs');
    expect(
      fixture.nativeElement.querySelector('[aria-live]')?.textContent,
    ).toContain('a needs you');
    width.set(1000);
    board.update((value) => ({ ...value, railCollapsed: false }));
    fixture.detectChanges();
    fixture.componentInstance.toggleDetails();
    fixture.detectChanges();
    sourceState.set('error');
    fixture.detectChanges();
    expect(
      fixture.nativeElement
        .querySelector('[data-dot-state]')
        ?.getAttribute('data-state'),
    ).toBe('error');
    expect(
      fixture.nativeElement.querySelector('[aria-live]')?.textContent,
    ).toContain('a stopped with an error');
  });

  it('writes density once and clears the text hold', () => {
    const { fixture, store } = mount();
    fixture.componentInstance.holdTabId.set('a');
    fixture.componentInstance.toggleDensity();
    fixture.detectChanges();
    expect(store.setRailDensity).toHaveBeenCalledTimes(1);
    expect(store.setRailDensity).toHaveBeenCalledWith('workspace', 'dense');
    expect(fixture.componentInstance.holdTabId()).toBeNull();
  });

  it('measures one mounted live view through swaps and a close', async () => {
    const { fixture, focused, store } = mount();
    fixture.detectChanges();
    expect(fixture.nativeElement.getAttribute('data-canvas-live-views')).toBe(
      '1',
    );
    focused.set('b');
    fixture.detectChanges();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelectorAll('ptah-canvas-lane-view'),
    ).toHaveLength(1);
    expect(fixture.nativeElement.getAttribute('data-canvas-live-views')).toBe(
      '1',
    );
    await fixture.componentInstance.close('b');
    fixture.detectChanges();
    fixture.detectChanges();
    expect(store.removeTile).toHaveBeenCalledWith('b');
    expect(
      fixture.nativeElement.querySelectorAll('[data-rail-card]'),
    ).toHaveLength(1);
    expect(fixture.nativeElement.getAttribute('data-canvas-live-views')).toBe(
      '1',
    );
    fixture.componentRef.setInput('visible', false);
    fixture.detectChanges();
    fixture.detectChanges();
    expect(fixture.nativeElement.getAttribute('data-canvas-live-views')).toBe(
      '0',
    );
  });

  it.each([1, 3, 9, 12])(
    'Rail with %i sessions has one live view',
    (count) => {
      const { fixture } = mount(true, count);
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelectorAll('[data-rail-card]'),
      ).toHaveLength(count);
      expect(
        fixture.nativeElement.querySelectorAll('ptah-canvas-lane-view'),
      ).toHaveLength(1);
      expect(
        fixture.nativeElement.getAttribute('data-canvas-live-views'),
      ).toBe('1');
    },
  );

  it('0 tiles: the empty-board trigger asks for the named popover', () => {
    const { fixture } = mount(true, 0);
    const requested = jest.fn();
    fixture.componentInstance.newSessionRequested.subscribe(requested);
    expect(fixture.nativeElement.querySelector('ptah-canvas-focus-area')).toBeNull();
    const trigger = fixture.nativeElement.querySelector<HTMLButtonElement>(
      '[data-testid="canvas-rail-empty-board"] button',
    );
    expect(trigger.textContent?.trim()).toBe('New session');
    expect(trigger.getAttribute('aria-disabled')).toBeNull();
    trigger.click();
    expect(requested).toHaveBeenCalledTimes(1);
  });

  it('0 tiles: at the running cap the aria-disabled trigger keeps its reason and does not emit', () => {
    const { fixture, canStart } = mount(true, 0);
    const requested = jest.fn();
    fixture.componentInstance.newSessionRequested.subscribe(requested);
    canStart.set(false);
    fixture.detectChanges();
    const trigger = fixture.nativeElement.querySelector<HTMLButtonElement>(
      '[data-testid="canvas-rail-empty-board"] button',
    );
    expect(trigger.getAttribute('aria-disabled')).toBe('true');
    // Still focusable, so the reason stays reachable by keyboard.
    expect(trigger.disabled).toBe(false);
    expect(trigger.getAttribute('aria-describedby')).toBe(
      'canvas-rail-empty-board-reason',
    );
    expect(
      fixture.nativeElement.querySelector('#canvas-rail-empty-board-reason')
        .textContent,
    ).toContain(RUNNING_CAP_MESSAGE);
    // Pointer activation, and the click a browser makes from Enter or Space.
    trigger.click();
    for (const key of ['Enter', ' ']) {
      trigger.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      );
    }
    expect(requested).not.toHaveBeenCalled();
    // A free running slot enables it again.
    canStart.set(true);
    fixture.detectChanges();
    expect(trigger.getAttribute('aria-disabled')).toBeNull();
    trigger.click();
    expect(requested).toHaveBeenCalledTimes(1);
  });

  it('routes the footer New session to the named popover request', () => {
    const { fixture } = mount();
    const requested = jest.fn();
    fixture.componentInstance.newSessionRequested.subscribe(requested);
    fixture.debugElement
      .query((node) => node.name === 'ptah-canvas-rail')
      .triggerEventHandler('newSession');
    expect(requested).toHaveBeenCalledTimes(1);
  });

  it('board provides one RailTranscriptRetentionCoordinator; both panes share it (distinctRetainedCount counts distinct tabs across panes)', () => {
    const { fixture } = mount(true, 3);
    const coordinator = fixture.debugElement.injector.get(RailTranscriptRetentionCoordinator);
    fixture.componentInstance.openBeside('b');
    fixture.detectChanges();
    const panes = fixture.debugElement.queryAll((node) => node.name === 'ptah-canvas-focus-area');
    expect(panes).toHaveLength(2);
    expect(panes.map((pane) => pane.injector.get(RailTranscriptRetentionCoordinator))).toEqual([coordinator, coordinator]);
    const host = () => ({ retainFromCoordinator: jest.fn(), releaseFromCoordinator: jest.fn() }) as unknown as Parameters<typeof coordinator.touch>[0];
    const left = host();
    const right = host();
    coordinator.register(left, signal('a'));
    coordinator.register(right, signal('b'));
    coordinator.touch(left, 'a');
    coordinator.touch(right, 'b');
    expect(coordinator.distinctRetainedCount()).toBe(2);
  });

  it('below two sessions announces the split reason and refuses stale or same-id Open beside', () => {
    const { fixture } = mount(true, 1);
    const instance = fixture.componentInstance;
    expect(instance.splitDisabledReason()).toBe('Open another session first to split');
    instance.openBeside('a');
    expect(instance.announcement()).toContain('already focused');
    instance.openBeside('foreign');
    expect(instance.announcement()).toContain('no longer on this board');
    expect(instance.otherTabId()).toBeNull();
  });

  it('never a third host on Open beside or jumpTo while split; never the same tab in both panes', () => {
    const { fixture, focused } = mount(true, 3);
    const instance = fixture.componentInstance;
    instance.openBeside('b');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('ptah-canvas-lane-view')).toHaveLength(2);
    instance.openBeside('b');
    instance.openBeside('c');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('ptah-canvas-lane-view')).toHaveLength(2);
    expect([...fixture.nativeElement.querySelectorAll('section[aria-label$="session: b"]')]).toHaveLength(1);
    expect(instance.otherTabId()).toBe('b');
    instance.railStates.set(new Map([['a', 'needs']]));
    instance.jumpTo('needs');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('ptah-canvas-lane-view')).toHaveLength(2);
    focused.set('b');
    fixture.detectChanges();
    expect(instance.otherTabId()).not.toBe(focused());
  });

  it('external main-panel focus and sessionCreated replace only the active pane', () => {
    const { fixture, focused } = mount(true, 3);
    const instance = fixture.componentInstance;
    instance.openBeside('b');
    fixture.detectChanges();
    focused.set('c');
    fixture.detectChanges();
    expect(instance.otherTabId()).toBe('a');
    expect(instance.paneTab(instance.activeSide())).toBe('c');
    instance.sessionCreated('b');
    fixture.detectChanges();
    expect(instance.otherTabId()).toBe('a');
    expect(instance.paneTab(instance.activeSide())).toBe('b');
    focused.set('a');
    fixture.detectChanges();
    expect(instance.otherTabId()).toBe('b');
    expect(instance.paneTab(instance.activeSide())).toBe('a');
  });

  it('focusin activation uses the inactive pane and unique placement labels', () => {
    const { fixture, focused } = mount();
    fixture.componentInstance.openBeside('b');
    fixture.detectChanges();
    const inactive = fixture.nativeElement.querySelector('[data-pane-side="left"]') as HTMLElement;
    expect(inactive.getAttribute('aria-label')).toBe('Top session: a');
    inactive.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    fixture.detectChanges();
    expect(focused()).toBe('a');
    expect(inactive.getAttribute('aria-label')).toBe('Top session: a, active');
    expect(fixture.nativeElement.querySelector('[data-pane-side="right"]').getAttribute('aria-label')).toBe('Bottom session: b');
  });

  it('stacks at 1439 and keeps stable pane hosts when crossing 1440', () => {
    const { fixture, width } = mount();
    fixture.componentInstance.openBeside('b');
    width.set(1439);
    fixture.detectChanges();
    const hosts = [...fixture.nativeElement.querySelectorAll('ptah-canvas-focus-area')];
    expect(fixture.nativeElement.querySelector('[data-testid="rail-pane-container"]').classList.contains('flex-col')).toBe(true);
    width.set(1440);
    fixture.detectChanges();
    expect([...fixture.nativeElement.querySelectorAll('ptah-canvas-focus-area')]).toEqual(hosts);
    expect(fixture.nativeElement.querySelector('[data-testid="rail-pane-container"]').classList.contains('flex-row')).toBe(true);
    expect(fixture.componentInstance.announcement()).toBe('Sessions side by side.');
    fixture.detectChanges();
    expect(fixture.componentInstance.announcement()).toBe('Sessions side by side.');
  });

  it.each([1280, 920])('%i stacked keeps two live hosts with 400 px wrappers and vertical scroll', (pixels) => {
    const { fixture, width } = mount();
    fixture.componentInstance.openBeside('b');
    width.set(pixels);
    fixture.detectChanges();
    const container = fixture.nativeElement.querySelector('[data-testid="rail-pane-container"]');
    expect(container.classList.contains('flex-col')).toBe(true);
    const panes = fixture.nativeElement.querySelectorAll('[data-pane-side]');
    expect(panes).toHaveLength(2);
    for (const pane of panes) {
      expect(pane.classList.contains('min-h-[400px]')).toBe(true);
      expect(pane.classList.contains('overflow-y-auto')).toBe(true);
      expect(pane.classList.contains('min-w-[360px]')).toBe(true);
      expect(pane.querySelector('[aria-label="Open details"]')?.classList.contains('top-[52px]')).toBe(true);
    }
    expect(fixture.nativeElement.querySelector('[aria-label="Close split"]')?.classList.contains('top-[52px]')).toBe(true);
    expect(fixture.nativeElement.querySelectorAll('ptah-canvas-lane-view')).toHaveLength(2);
  });

  it('external removal drops a ghost pane without close(), never duplicates a surviving tab, announces once', () => {
    const { fixture, tiles, focused } = mount();
    const instance = fixture.componentInstance;
    instance.openBeside('b');
    fixture.detectChanges();
    tiles.set([{ tabId: 'a', order: 0 } as CanvasTile]);
    focused.set(null);
    fixture.detectChanges();
    expect(instance.otherTabId()).toBeNull();
    expect(focused()).toBe('a');
    expect(fixture.nativeElement.querySelectorAll('ptah-canvas-focus-area')).toHaveLength(1);
    expect(instance.announcement()).toContain('removed');
    const message = instance.announcement();
    fixture.detectChanges();
    expect(instance.announcement()).toBe(message);
  });

  it('null store focus preserves pane actions and the surviving host on collapse', () => {
    const { fixture, focused } = mount(true, 3);
    const instance = fixture.componentInstance;
    focused.set(null);
    instance.openBeside('b');
    fixture.detectChanges();
    expect(instance.otherTabId()).toBe('a');
    focused.set(null);
    instance.activatePane('left');
    fixture.detectChanges();
    expect(instance.otherTabId()).toBe('b');
    focused.set(null);
    instance.activatePane('right');
    fixture.detectChanges();
    const survivor = fixture.nativeElement.querySelector('[data-pane-side="right"] ptah-canvas-focus-area');
    instance.closeSplit();
    fixture.detectChanges();
    expect(instance.otherTabId()).toBeNull();
    expect(fixture.nativeElement.querySelector('ptah-canvas-focus-area')).toBe(survivor);
    expect(fixture.nativeElement.querySelector('[data-pane-side]')?.classList.contains('min-w-[360px]')).toBe(false);
  });

  it('split Details overlay opens on active pane at all bands, follows active tab, closes on Escape/collapse with focus return; single focus keeps the column', async () => {
    const { fixture, width } = mount();
    const instance = fixture.componentInstance;
    instance.openBeside('b');
    width.set(920);
    fixture.detectChanges();
    const opener = fixture.nativeElement.querySelectorAll<HTMLButtonElement>('[aria-label="Open details"]')[1];
    opener.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('ptah-canvas-rail')).not.toBeNull();
    expect(instance.effectiveCollapsed()).toBe(false);
    instance.focus('a');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).not.toBeNull();
    fixture.nativeElement.querySelector('[role="dialog"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('[data-pane-side="left"] [aria-label="Open details"]'));
    instance.visualOrder.set(['right', 'left']);
    instance.closeSplit();
    fixture.detectChanges();
    expect(instance.visualOrder()).toEqual(['left', 'right']);
    expect(fixture.nativeElement.querySelectorAll('ptah-canvas-focus-area')).toHaveLength(1);
    width.set(1600);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('aside')).not.toBeNull();
  });

  it.each([1440, 1600])('split Details stays an overlay at %i and collapse returns focus to the active card', async (pixels) => {
    const { fixture, width } = mount();
    const instance = fixture.componentInstance;
    instance.openBeside('b');
    width.set(pixels);
    fixture.detectChanges();
    const opener = fixture.nativeElement.querySelector<HTMLButtonElement>('[data-pane-side="right"] [aria-label="Open details"]');
    opener?.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')?.closest('[data-pane-side]')).not.toBeNull();
    instance.closeSplit();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('[data-rail-card][data-tab-id="b"] .rc-select'));
  });

  it('expected reorder permutation with 176/96/56 heights and persistence write failure via the service', async () => {
    const { fixture, tiles, store, writeFailed, board, metrics } = mount(true, 3);
    (store.reorderTiles as jest.Mock).mockImplementation((ids: string[]) => {
      tiles.set(ids.map((tabId, order) => ({ tabId, order }) as CanvasTile));
    });
    const list = fixture.nativeElement.querySelector<HTMLElement>('ptah-canvas-rail .overflow-y-auto');
    list.scrollTop = 200;
    fixture.componentInstance.move('b', -1);
    fixture.detectChanges();
    expect(store.reorderTiles).toHaveBeenCalledWith(['b', 'a', 'c']);
    expect([...fixture.nativeElement.querySelectorAll('[data-rail-card]')].map((node) => node.getAttribute('data-tab-id'))).toEqual(['b', 'a', 'c']);
    await fixture.whenStable();
    const moved = [...fixture.nativeElement.querySelectorAll<HTMLElement>('[data-rail-card]')].find((node) => node.dataset['tabId'] === 'b');
    expect(document.activeElement).toBe(moved?.querySelector('.rc-select'));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(list.scrollTop).toBe(0);
    expect(metrics.snapshot().railShifts).toBe(0);
    const height = () => (fixture.nativeElement.querySelector('[data-rail-card]') as HTMLElement).style.height;
    expect(height()).toBe('176px');
    board.update((value) => ({ ...value, railDensity: 'dense' }));
    fixture.detectChanges();
    expect(height()).toBe('96px');
    board.update((value) => ({ ...value, railCollapsed: true }));
    fixture.detectChanges();
    expect(height()).toBe('56px');
    const count = (store.reorderTiles as jest.Mock).mock.calls.length;
    fixture.componentInstance.move('b', -1);
    expect(store.reorderTiles).toHaveBeenCalledTimes(count);
    expect(fixture.componentInstance.announcement()).toContain('cannot move');
    fixture.componentInstance.move('b', 1);
    writeFailed.set(true);
    fixture.detectChanges();
    expect(fixture.componentInstance.announcement()).toContain('could not be saved');
  });

  it('does not attribute a pre-existing persistence failure to reordering', () => {
    const { fixture, writeFailed } = mount();
    writeFailed.set(true);
    fixture.detectChanges();
    expect(fixture.componentInstance.announcement()).toBe('Layout changes could not be saved.');
  });

  it('does not attribute a later layout write failure to a successful reorder', async () => {
    const { fixture, writeFailed } = mount();
    fixture.componentInstance.move('b', -1);
    await Promise.resolve();
    writeFailed.set(true);
    fixture.detectChanges();
    expect(fixture.componentInstance.announcement()).toBe('Layout changes could not be saved.');
  });

  it('close inactive pane keeps active focus with an ordered neighbour present', async () => {
    const { fixture, focused, store } = mount(true, 3);
    fixture.componentInstance.openBeside('b');
    fixture.detectChanges();
    const spy = jest.spyOn(store, 'focusTile');
    spy.mockClear();
    await fixture.componentInstance.close('a');
    fixture.detectChanges();
    expect(focused()).toBe('b');
    expect(spy).not.toHaveBeenCalled();
    expect(fixture.componentInstance.otherTabId()).toBeNull();
  });

  it('close active pane while the other tab is tiles[0] keeps that survivor despite transient null focus', async () => {
    const { fixture, focused, store } = mount(true, 3);
    fixture.componentInstance.openBeside('b');
    fixture.detectChanges();
    const remove = store.removeTile as jest.Mock;
    const originalRemove = remove.getMockImplementation();
    remove.mockImplementation(async (id: string) => {
      await originalRemove?.(id);
      focused.set(null);
    });
    await fixture.componentInstance.close('b');
    fixture.detectChanges();
    expect(focused()).toBe('a');
    expect(fixture.componentInstance.otherTabId()).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('ptah-canvas-lane-view')).toHaveLength(1);
  });

  it('close uses the last valid focused pane when store focus is null before the action', async () => {
    const { fixture, focused, store } = mount(true, 3);
    const instance = fixture.componentInstance;
    instance.openBeside('b');
    fixture.detectChanges();
    focused.set(null);
    await instance.close('b');
    fixture.detectChanges();
    expect(focused()).toBe('a');
    expect(instance.otherTabId()).toBeNull();
    expect(store.focusTile).toHaveBeenCalledWith('a');
  });

  it('cancelled close keeps both panes and their focus', async () => {
    const { fixture, focused, store } = mount();
    fixture.componentInstance.openBeside('b');
    fixture.detectChanges();
    (store.removeTile as jest.Mock).mockImplementation(async () => undefined);
    await fixture.componentInstance.close('b');
    fixture.detectChanges();
    expect(focused()).toBe('b');
    expect(fixture.componentInstance.otherTabId()).toBe('a');
    expect(fixture.nativeElement.querySelectorAll('ptah-canvas-lane-view')).toHaveLength(2);
  });
});
