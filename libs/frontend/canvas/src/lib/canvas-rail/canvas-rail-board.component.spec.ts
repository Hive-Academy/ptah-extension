import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat';
import { COMPACT_RAIL_CARD_HEIGHT, type CompactRailDensity, type CompactRailState } from '@ptah-extension/chat-ui';
import { CanvasStore, type CanvasTile } from '../canvas.store';
import { CanvasLayoutService } from '../canvas-layout.service';
import { CanvasRenderMetricsService } from '../canvas-render-metrics.service';
import { CanvasDetailService } from '../canvas-detail/canvas-detail.service';
import { CanvasRailBoardComponent } from './canvas-rail-board.component';

@Component({
  selector: 'ptah-canvas-rail', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="overflow-y-auto" style="height:200px"><ul>
    @for (tile of tiles(); track tile.tabId) {
      <li data-rail-card [attr.data-tab-id]="tile.tabId" [style.height.px]="collapsed() ? 56 : heights[density()]">{{ tile.tabId }}</li>
    }
  </ul></div>`,
})
class RailStub {
  readonly heights = COMPACT_RAIL_CARD_HEIGHT;
  readonly tiles = input<readonly CanvasTile[]>([]); readonly states = input<ReadonlyMap<string, CompactRailState>>(new Map());
  readonly focusedTabId = input<string | null>(null); readonly density = input<CompactRailDensity>('comfortable');
  readonly collapsed = input(false); readonly band = input('lg'); readonly runningCount = input(0);
  readonly canStart = input(true); readonly canAdd = input(true); readonly holdTabId = input<string | null>(null);
  readonly surfaceActive = input(true);
  readonly focusRequested = output<string>(); readonly collapseToggled = output<void>(); readonly densityToggled = output<void>();
  readonly jumpTo = output<CompactRailState>(); readonly newSession = output<void>(); readonly scrolled = output<number>();
  readonly railState = output<{ tabId: string; state: CompactRailState }>(); readonly staleAction = output<string>();
  readonly lanesRequested = output<string>();
}
@Component({ selector: 'ptah-canvas-focus-area', standalone: true, template: '<button role="tab" aria-selected="true">Lane</button>' })
class FocusStub {
  readonly focusedTabId = input<string | null>(null); readonly state = input<CompactRailState>('idle');
  readonly band = input('lg'); readonly closeRequested = output<string>();
}
@Component({ selector: 'ptah-canvas-session-details', standalone: true, template: '<div>Details</div>' })
class DetailsStub { readonly tabId = input.required<string>(); }

describe('CanvasRailBoardComponent actions', () => {
  const board = () => {
    const instance = Object.create(CanvasRailBoardComponent.prototype) as CanvasRailBoardComponent;
    const focusTile = jest.fn();
    const addTile = jest.fn(() => 'new');
    const removeTile = jest.fn(async () => undefined);
    Object.assign(instance, {
      store: {
        canStartRunningSession: () => true, canAddTile: () => true, addTile,
        focusTile, removeTile, tiles: () => [],
      },
      workspacePath: () => 'workspace',
      orderedTiles: () => [{ tabId: 'a' }, { tabId: 'b' }],
      anchor: jest.fn(),
    });
    return { instance, focusTile, addTile, removeTile };
  };

  it('adds a named session and focuses it', () => {
    const { instance, addTile, focusTile } = board();
    instance.newSession();
    expect(addTile).toHaveBeenCalledWith(expect.any(String));
    expect(focusTile).toHaveBeenCalledWith('new');
  });

  it('focuses the next neighbour after closing a focused session', async () => {
    const { instance, removeTile, focusTile } = board();
    let remaining = [{ tabId: 'a' }, { tabId: 'b' }];
    Object.assign(instance, { orderedTiles: () => remaining });
    removeTile.mockImplementation(async () => { remaining = [{ tabId: 'b' }]; });
    await instance.close('a');
    expect(removeTile).toHaveBeenCalledWith('a');
    expect(focusTile).toHaveBeenCalledWith('b');
  });

  it('refuses an add at the running cap', () => {
    const { instance, addTile } = board();
    Object.assign(instance, { store: { canStartRunningSession: () => false, canAddTile: () => true } });
    instance.newSession();
    expect(addTile).not.toHaveBeenCalled();
  });
});

describe('CanvasRailBoardComponent rendering', () => {
  afterEach(() => jest.restoreAllMocks());

  function mount(visible = true) {
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { height: Number.parseFloat(this.style.height) || 0 } as DOMRect;
    });
    const tiles = signal<readonly CanvasTile[]>([
      { tabId: 'a', order: 0 } as CanvasTile, { tabId: 'b', order: 1 } as CanvasTile,
    ]);
    const focused = signal<string | null>('a');
    const board = signal({ mode: 'rail' as const, railCollapsed: false, railDensity: 'comfortable' as const, railScrollTop: 0 });
    const width = signal(1400);
    const setRailCollapsed = jest.fn((_: string, value: boolean) => board.update((b) => ({ ...b, railCollapsed: value })));
    const store = {
      tilesFor: () => tiles, focusedTabIdFor: () => focused(), boardFor: () => board(),
      runningSessionCount: () => 0, canStartRunningSession: () => true, canAddTile: () => true,
      focusTile: (id: string) => focused.set(id), setRailCollapsed,
      setRailDensity: (_: string, density: 'comfortable' | 'dense') => board.update((b) => ({ ...b, railDensity: density })),
      setRailScrollTop: jest.fn(), tiles: () => tiles(),
    };
    TestBed.configureTestingModule({
      imports: [CanvasRailBoardComponent],
      providers: [
        CanvasRenderMetricsService,
        { provide: CanvasStore, useValue: store },
        { provide: CanvasLayoutService, useValue: { containerWidth: width } },
        { provide: CanvasDetailService, useValue: {} },
        { provide: TabManagerService, useValue: { findTabByIdAcrossWorkspaces: (id: string) => ({ tab: { title: id } }) } },
      ],
    });
    TestBed.overrideComponent(CanvasRailBoardComponent, { set: { imports: [RailStub, FocusStub, DetailsStub] } });
    const fixture = TestBed.createComponent(CanvasRailBoardComponent);
    fixture.componentRef.setInput('workspacePath', 'workspace');
    fixture.componentRef.setInput('visible', visible);
    fixture.detectChanges();
    return { fixture, tiles, focused, board, width, store, metrics: TestBed.inject(CanvasRenderMetricsService) };
  }

  it('mounts no rail cards or focus area when hidden', () => {
    const { fixture } = mount(false);
    expect(fixture.nativeElement.querySelectorAll('[data-rail-card], ptah-canvas-focus-area')).toHaveLength(0);
  });

  it('keeps card nodes and order when focus changes', () => {
    const { fixture, focused } = mount();
    const cards = [...fixture.nativeElement.querySelectorAll('[data-rail-card]')];
    focused.set('b'); fixture.detectChanges();
    expect([...fixture.nativeElement.querySelectorAll('[data-rail-card]')]).toEqual(cards);
    expect(fixture.nativeElement.getAttribute('data-canvas-live-views')).toBe('1');
  });

  it.each(['comfortable', 'dense'] as const)('keeps fixed %s geometry across state changes', (density) => {
    const { fixture, board, tiles, metrics } = mount();
    board.update((b) => ({ ...b, railDensity: density })); fixture.detectChanges();
    fixture.componentInstance.onRailState({ tabId: 'a', state: 'needs' }); fixture.detectChanges();
    tiles.update((current) => [current[0], { ...current[1] }]); fixture.detectChanges();
    const cards = [...fixture.nativeElement.querySelectorAll<HTMLElement>('[data-rail-card]')];
    expect(cards.map((card) => card.dataset['tabId'])).toEqual(['a', 'b']);
    expect(cards.map((card) => card.style.height)).toEqual([`${COMPACT_RAIL_CARD_HEIGHT[density]}px`, `${COMPACT_RAIL_CARD_HEIGHT[density]}px`]);
    expect(metrics.snapshot().railShifts).toBe(0);
  });

  it('counts wrong height after baseline, including after a focus change', () => {
    const { fixture, focused, metrics } = mount();
    const card = fixture.nativeElement.querySelector<HTMLElement>('[data-rail-card]');
    card.getBoundingClientRect = () => ({ height: 17 }) as DOMRect;
    fixture.componentInstance.onRailState({ tabId: 'a', state: 'running' }); fixture.detectChanges();
    expect(metrics.snapshot().railShifts).toBe(1);
    focused.set('b'); fixture.detectChanges();
    fixture.componentInstance.onRailState({ tabId: 'a', state: 'needs' }); fixture.detectChanges();
    expect(metrics.snapshot().railShifts).toBeGreaterThan(1);
    fixture.detectChanges();
    expect(fixture.nativeElement.getAttribute('data-canvas-rail-shifts')).toBe(String(metrics.snapshot().railShifts));
  });

  it('anchors the last focused card after a density toggle', () => {
    const { fixture, focused } = mount();
    focused.set('b'); fixture.detectChanges();
    const list = fixture.nativeElement.querySelector<HTMLElement>('.overflow-y-auto');
    Object.defineProperty(list, 'clientHeight', { value: 100 });
    list.scrollTop = 0;
    fixture.componentInstance.toggleDensity(); fixture.detectChanges();
    expect(list.scrollTop).toBe(100);
  });

  it('auto-collapses for narrow details without persisting the user collapse', () => {
    const { fixture, width, store } = mount();
    width.set(1000); fixture.detectChanges();
    fixture.componentInstance.toggleDetails(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector<HTMLElement>('[data-rail-card]')?.style.height).toBe('56px');
    expect(store.setRailCollapsed).not.toHaveBeenCalled();
  });

  it('keeps a full details column at the medium width band', () => {
    const { fixture, width } = mount();
    width.set(1200); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('aside.w-\\[296px\\]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[aria-label="Open details"]')).toBeNull();
  });

  it('announces needs and error transitions after the initial state', () => {
    const { fixture } = mount();
    const instance = fixture.componentInstance;
    instance.onRailState({ tabId: 'a', state: 'idle' }); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[aria-live]')?.textContent?.trim()).toBe('');
    instance.onRailState({ tabId: 'a', state: 'needs' }); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[aria-live]')?.textContent).toContain('a needs you');
    instance.onRailState({ tabId: 'a', state: 'error' }); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[aria-live]')?.textContent).toContain('a stopped with an error');
  });

  it('removes document selection listeners when hidden', () => {
    const remove = jest.spyOn(document, 'removeEventListener');
    const { fixture } = mount();
    fixture.componentRef.setInput('visible', false); fixture.detectChanges();
    expect(remove).toHaveBeenCalledWith('selectionchange', expect.any(Function));
    remove.mockRestore();
  });

  it('focuses the selected lane tab after a lane request', () => {
    const { fixture } = mount();
    fixture.componentInstance.onLanesRequested('b'); fixture.detectChanges();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('[role="tab"]'));
  });
});
