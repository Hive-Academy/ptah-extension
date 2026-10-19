import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  input,
  NO_ERRORS_SCHEMA,
  type OnDestroy,
  output,
  signal,
  type WritableSignal,
} from '@angular/core';
import { DeferBlockState, TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { LucideAngularModule } from 'lucide-angular';
import { ChatStore, CompactSessionCardComponent, PreviousSessionsDialogService, RailTranscriptRetentionCoordinator, RecentSessionsStore, SessionInspectorStore, SessionOrganizerService, SessionRowActionsService, TabManagerService } from '@ptah-extension/chat';
import { SessionInspectorComponent } from '@ptah-extension/chat/inspector';
import { PlanLimitsStore, SURFACE_ACTIVE } from '@ptah-extension/core';
import { AgentMonitorStore, BackgroundAgentStore } from '@ptah-extension/chat-streaming';
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
import { CanvasRailCardComponent } from './canvas-rail-card.component';
import { CanvasFocusAreaComponent } from './canvas-focus-area.component';

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
  readonly autoCollapsed = input(false);
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
  readonly previousSessionsOpen = input(false);
  readonly previousSessionsRequested = output<void>();
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
  selector: 'ptah-compact-session-card',
  standalone: true,
  template: `<button type="button" class="rc-select"
    (click)="expandToFull.emit()"
    (keydown.enter)="expandToFull.emit()"
    (keydown.space)="expandToFull.emit()">Select</button>`,
})
class SelectCardStub {
  readonly tab = input.required<unknown>();
  readonly variant = input('rail');
  readonly density = input<CompactRailDensity>('comfortable');
  readonly focused = input(false);
  readonly holdText = input(false);
  readonly reserveActionCorner = input(false);
  readonly expandToFull = output<void>();
  readonly railState = output<CompactRailState>();
  readonly staleAction = output<void>();
  readonly lanesRequested = output<void>();
}
@Component({
  selector: 'ptah-canvas-lane-view',
  standalone: true,
  template: '',
})
class LaneStub {}
/** Stand-in for the lane's live ChatView: owns a composer draft and its dock state (R9x-fix finding 3). */
const life = { lane: 0, laneDestroyed: 0, chat: 0, chatDestroyed: 0 };
@Component({
  selector: 'ptah-chat-view',
  standalone: true,
  template: `<textarea data-draft aria-label="Message draft" [value]="draft()" (input)="draft.set($any($event.target).value)"></textarea>
    <aside data-dock [attr.data-open]="dockOpen()"></aside>`,
})
class StatefulChatViewStub implements OnDestroy {
  readonly draft = signal('');
  readonly dockOpen = signal(false);
  constructor() { life.chat++; }
  ngOnDestroy(): void { life.chatDestroyed++; }
}
@Component({
  selector: 'ptah-canvas-lane-view',
  standalone: true,
  imports: [StatefulChatViewStub],
  template: '<ptah-chat-view />',
})
class StatefulLaneStub implements OnDestroy {
  constructor() { life.lane++; }
  ngOnDestroy(): void { life.laneDestroyed++; }
}
@Component({
  selector: 'ptah-canvas-focus-area',
  standalone: true,
  imports: [LaneStub],
  template: `<header>
      <button type="button" data-header-menu aria-label="More session actions">⋯</button>
      @if (splitDisplayed()) {
        <button type="button" data-details aria-label="Open details" (click)="detailsRequested.emit(paneId())">i</button>
      }
    </header>
    @if (focusedTabId()) { <ptah-canvas-lane-view /> }<button role="tab" aria-selected="true">Lane</button>`,
})
class FocusStub {
  readonly focusedTabId = input<string | null>(null);
  readonly limitCue = input<unknown>(null);
  readonly contextRingPercent = input<number | null>(null);
  readonly toggleDescription = input('');
  readonly paneId = input<'left' | 'right'>('left');
  readonly paneFocused = input(true);
  readonly splitDisplayed = input(false);
  readonly paneNumber = input<1 | 2 | null>(null);
  readonly panePlace = input('');
  readonly detailsOpen = input(false);
  readonly state = input<CompactRailState>('idle');
  readonly band = input('lg');
  readonly closeRequested = output<string>();
  readonly closeSplitRequested = output<'left' | 'right'>();
  readonly closePaneRequested = output<'left' | 'right'>();
  readonly swapPanesRequested = output<'left' | 'right'>();
  readonly detailsRequested = output<'left' | 'right'>();
}
@Component({
  selector: 'ptah-session-inspector',
  standalone: true,
  template: '<div [attr.role]="presentation() === \'sheet\' ? \'dialog\' : null"><button type="button" data-inspector-close aria-label="Close session details" (click)="closeRequested.emit()">Close</button><button type="button" data-lane (click)="laneRequested.emit(\'agent-1\')">Open lane</button></div>',
})
class InspectorStub {
  readonly tabId = input.required<string>();
  readonly presentation = input('embedded');
  readonly hasLaneSurface = input(false);
  readonly stats = input<unknown>(null);
  readonly laneRequested = output<string>();
  readonly closeRequested = output<void>();
}

/** Session details load in a lazy `@defer (on idle)` chunk; render them now. */
async function completeDeferBlocks(fixture: Pick<ComponentFixture<unknown>, 'getDeferBlocks'>): Promise<void> {
  for (const block of await fixture.getDeferBlocks()) {
    await block.render(DeferBlockState.Complete);
  }
}
@Component({
  selector: 'ptah-project-setup-card',
  standalone: true,
  template: '<button type="button">Open Library</button>',
})
class ProjectSetupStub {}

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
    const button = document.createElement('button');
    instance.newSession(button);
    expect(instance.newSessionRequested.emit).toHaveBeenCalledWith(button);
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
      instance.newSession(document.createElement('button'));
      expect(addTile).not.toHaveBeenCalled();
      expect(instance.newSessionRequested.emit).toHaveBeenCalledTimes(1);
    },
  );
});

describe('CanvasRailBoardComponent rendering', () => {
  afterEach(() => jest.restoreAllMocks());

  function mount(
    visible = true,
    count = 2,
    initialFocus: string | null = 'a',
    surface?: WritableSignal<boolean>,
    realCard = false,
    realFocus = false,
  ) {
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
    const needsYou = signal<Record<string, number>>({});
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
    const dialogOpen = signal(false);
    const laneKeys = signal<ReadonlyMap<string, string>>(new Map());
    const agents = signal<{ agentId: string; parentSessionId: string }[]>([]);
    const subagents = signal(new Map<string, { parentToolUseId: string; parentSessionId: string }>());
    const backgroundAgents = signal<{ toolCallId: string; sessionId: string }[]>([]);
    const recent = signal<readonly { id: string; name: string; lastActivityAt: number }[]>([]);
    const openSession = jest.fn().mockResolvedValue('opened');
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
      isSessionRunning: () => false,
      tiles: () => tiles(),
    };
    TestBed.configureTestingModule({
      imports: [CanvasRailBoardComponent],
      providers: [
        CanvasRenderMetricsService,
        { provide: CanvasStore, useValue: store },
        { provide: CanvasLayoutService, useValue: { containerWidth: width } },
        { provide: CanvasLayoutPersistenceService, useValue: { writeFailed } },
        { provide: PlanLimitsStore, useValue: { snapshot: () => null } },
        { provide: AgentMonitorStore, useValue: { agentsOwnedBySession: () => [], agents, subagents } },
        { provide: BackgroundAgentStore, useValue: { agents: backgroundAgents } },
        {
          provide: CanvasDetailService,
          useValue: realFocus
            ? { laneKeyFor: () => 'orchestrator', selectLaneFor: jest.fn() }
            : { laneKeyFor: (id: string) => laneKeys().get(id) ?? 'orchestrator' },
        },
        { provide: ChatStore, useValue: {} },
        { provide: PreviousSessionsDialogService, useValue: { isOpen: dialogOpen, open: jest.fn() } },
        { provide: SessionOrganizerService, useValue: { available: () => false } },
        { provide: SessionRowActionsService, useValue: { rename: jest.fn(), openSession } },
        { provide: RecentSessionsStore, useValue: { load: jest.fn().mockResolvedValue(undefined), sessions: recent, confirmed: () => true } },
        { provide: SessionInspectorStore, useValue: { modelFor: (id: string) => () => ({ needsYouCount: needsYou()[id] ?? 0 }) } },
        ...(surface ? [{ provide: SURFACE_ACTIVE, useValue: surface }] : []),
        {
          provide: TabManagerService,
          useValue: {
            activeTabId: () => focused(),
            findTabByIdAcrossWorkspaces: (id: string) => ({
              tab: { title: id, claudeSessionId: 'owner' },
            }),
          },
        },
      ],
    });
    TestBed.overrideComponent(CanvasRailBoardComponent, {
      set: {
        imports: [
          RailStub,
          realFocus ? CanvasFocusAreaComponent : FocusStub,
          InspectorStub,
          ProjectSetupStub,
          NgTemplateOutlet,
          DatePipe,
          LucideAngularModule,
        ],
        schemas: [NO_ERRORS_SCHEMA],
      },
    });
    if (realFocus) {
      // The real focus area renders its own markup; its header, lane tabs and lane view stay inert.
      TestBed.overrideComponent(CanvasFocusAreaComponent, {
        set: { imports: [], schemas: [NO_ERRORS_SCHEMA] },
      });
    }
    if (realCard) {
      TestBed.overrideComponent(CanvasRailCardComponent, {
        remove: { imports: [CompactSessionCardComponent] },
        add: { imports: [SelectCardStub] },
      });
    }
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
      needsYou,
      board,
      width,
      laneKeys,
      recent,
      openSession,
      agents,
      subagents,
      backgroundAgents,
      writeFailed,
      store,
      canStart,
      dialogOpen,
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
  it('passes dialog state to the Rail and opens Previous sessions on request', () => {
    const { fixture, dialogOpen } = mount();
    const dialog = TestBed.inject(PreviousSessionsDialogService);
    const rail = fixture.debugElement.query(By.directive(RailStub)).componentInstance as RailStub;
    expect(rail.previousSessionsOpen()).toBe(false);
    dialogOpen.set(true);
    fixture.detectChanges();
    expect(rail.previousSessionsOpen()).toBe(true);
    rail.previousSessionsRequested.emit();
    expect(dialog.open).toHaveBeenCalledTimes(1);
  });

  it('includes the focused session needs-you count in the closed details description', () => {
    const { fixture, focused, needsYou } = mount();
    needsYou.set({ a: 2, b: 3 });
    fixture.detectChanges();
    const focusArea = () => fixture.debugElement.query(By.directive(FocusStub)).componentInstance as FocusStub;
    expect(focusArea().toggleDescription()).toContain('2 need you.');
    focused.set('b');
    fixture.detectChanges();
    expect(focusArea().toggleDescription()).toContain('3 need you.');
  });

  it('renders one canvas tile per visible session pane', () => {
    const { fixture } = mount(true, 3);
    expect(fixture.nativeElement.querySelectorAll('[data-testid="canvas-tile"]')).toHaveLength(1);
    fixture.componentInstance.openBeside('b');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[data-testid="canvas-tile"]')).toHaveLength(2);
  });

  it.each([1600, 760])('%i split clips the orchestrator tile while another lane keeps pane scrolling', (pixels) => {
    const { fixture, width, laneKeys, agents, backgroundAgents } = mount();
    width.set(pixels);
    laneKeys.set(new Map([['b', 'cli:agent']]));
    agents.set([{ agentId: 'agent', parentSessionId: 'owner' }]);
    fixture.componentInstance.openBeside('b');
    fixture.detectChanges();

    const container = fixture.nativeElement.querySelector('[data-testid="rail-pane-container"]');
    const orchestrator = fixture.nativeElement.querySelector('[data-pane-side="left"]');
    const cli = fixture.nativeElement.querySelector('[data-pane-side="right"]');
    expect(container.classList).toContain(pixels === 1600 ? 'overflow-y-hidden' : 'overflow-y-auto');
    expect(container.classList).toContain(pixels === 1600 ? 'flex-row' : 'flex-col');
    expect(orchestrator.classList).toContain('overflow-hidden');
    expect(orchestrator.classList).not.toContain('overflow-y-auto');
    expect(orchestrator.classList).toContain(pixels === 1600 ? 'min-h-0' : 'min-h-[240px]');
    expect(cli.classList).toContain('overflow-y-auto');
    expect(cli.classList).not.toContain('overflow-hidden');
    expect(orchestrator.querySelector('ptah-canvas-focus-area')?.classList).toContain('min-h-0');

    laneKeys.set(new Map([['a', 'bg:agent']]));
    backgroundAgents.set([{ toolCallId: 'agent', sessionId: 'owner' }]);
    fixture.detectChanges();
    expect(orchestrator.classList).toContain('overflow-y-auto');
    expect(cli.classList).toContain('overflow-hidden');

    backgroundAgents.set([]);
    fixture.detectChanges();
    expect(orchestrator.classList).toContain('overflow-hidden');
    expect(orchestrator.classList).not.toContain('overflow-y-auto');
  });

  it('binds the pane entrance only when a split is displayed', () => {
    const { fixture } = mount(true, 2);
    expect(fixture.componentInstance.splitDisplayed()).toBe(false);
    // jsdom does not run Angular enter animations, so verify the binding in the template.
    const source = readFileSync(join(__dirname, 'canvas-rail-board.component.ts'), 'utf8');
    expect(source).toMatch(/<section[^>]*data-testid="canvas-tile"[^>]*\[animate\.enter\]="splitDisplayed\(\) \? 'rail-pane-enter' : ''"/);
    expect(source).toMatch(/\[data-testid="rail-pane-container"\]:has\(> \.rail-pane-enter\) \{ overflow: clip; \}/);
    fixture.componentInstance.openBeside('b');
    fixture.detectChanges();
    expect(fixture.componentInstance.splitDisplayed()).toBe(true);
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

  it('renders the focused session in the wide Details aside once its deferred block completes', async () => {
    const { fixture } = mount(true, 2);
    const aside = fixture.nativeElement.querySelector('aside:not([data-dock])');
    expect(aside).not.toBeNull();
    expect(fixture.debugElement.query(By.directive(InspectorStub))).toBeNull();
    await completeDeferBlocks(fixture);
    const inspector = fixture.debugElement.query(By.directive(InspectorStub));
    expect(inspector).not.toBeNull();
    expect(inspector.componentInstance.tabId()).toBe('a');
  });

  it('synchronizes pane, rail and Details after external removal of the focused tile', async () => {
    const { fixture, focused, tiles } = mount(true, 3);
    focused.set('b');
    fixture.detectChanges();
    tiles.update((current) => current.filter((tile) => tile.tabId !== 'b'));
    focused.set(null);
    fixture.detectChanges();
    await completeDeferBlocks(fixture);
    const pane = fixture.debugElement.query(By.directive(FocusStub)).componentInstance as FocusStub;
    const rail = fixture.debugElement.query(By.directive(RailStub)).componentInstance as RailStub;
    const details = fixture.debugElement.query(By.directive(InspectorStub)).componentInstance as InspectorStub;
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

  it('uses a labelled lucide button for the small-band details strip', () => {
    const { fixture, width } = mount();
    width.set(760);
    fixture.detectChanges();
    const opener: HTMLButtonElement | null = fixture.nativeElement.querySelector('button.w-11[aria-label="Open details"]');
    expect(opener).not.toBeNull();
    expect(opener?.title).toBe('Session details');
    expect(opener?.getAttribute('aria-expanded')).toBe('false');
    expect(opener?.querySelector('svg.lucide')).not.toBeNull();
    expect(opener?.classList).toContain('focus-visible:outline-base-content');
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
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-tab-id="a"] .rc-select',
    )!.dispatchEvent(Object.assign(new Event('pointerdown', { bubbles: true }), { pointerId: 1 }));
    fixture.componentRef.setInput('visible', false);
    fixture.detectChanges();
    expect(remove).toHaveBeenCalledWith(
      'selectionchange',
      expect.any(Function),
    );
    expect(remove).toHaveBeenCalledWith('pointerup', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('pointercancel', expect.any(Function));
    remove.mockRestore();
  });

  it('holds card text for a text selection or a press, never for a caret (V1 serious 1)', () => {
    const { fixture } = mount();
    const instance = fixture.componentInstance;
    const host = fixture.nativeElement as HTMLElement;
    const label = host.querySelector('[data-tab-id="a"] .rc-select')!
      .firstChild as Text;
    const selection = document.getSelection()!;
    const selectionChanged = () =>
      document.dispatchEvent(new Event('selectionchange'));

    // A caret left in the card (a click, or the Rename input) must not latch
    // the title: a rename has to show on the card at once.
    selection.collapse(label, 0);
    selectionChanged();
    expect(instance.holdTabId()).toBeNull();

    // Selected text in the card still holds it.
    selection.setBaseAndExtent(label, 0, label, 1);
    selectionChanged();
    expect(instance.holdTabId()).toBe('a');
    selection.collapse(label, 0);
    selectionChanged();
    expect(instance.holdTabId()).toBeNull();

    // A press holds only while the pointer is down.
    label.parentElement!.dispatchEvent(
      Object.assign(new Event('pointerdown', { bubbles: true }), { pointerId: 1 }),
    );
    expect(instance.holdTabId()).toBe('a');
    document.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: 1 }));
    expect(instance.holdTabId()).toBeNull();
    selection.removeAllRanges();
  });

  it('keeps the press hold through the caret the press places (V1.2 rework)', () => {
    const { fixture } = mount();
    const instance = fixture.componentInstance;
    const host = fixture.nativeElement as HTMLElement;
    const label = host.querySelector('[data-tab-id="a"] .rc-select')!
      .firstChild as Text;
    const selection = document.getSelection()!;
    const selectionChanged = () =>
      document.dispatchEvent(new Event('selectionchange'));
    const press = () =>
      label.parentElement!.dispatchEvent(
        Object.assign(new Event('pointerdown', { bubbles: true }), { pointerId: 1 }),
      );

    // The browser fires `selectionchange` for the press caret before
    // `pointerup`; the hold must survive it so a drag keeps its anchor.
    press();
    selection.collapse(label, 0);
    selectionChanged();
    expect(instance.holdTabId()).toBe('a');

    // Releasing with only a caret drops the hold.
    document.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: 1 }));
    expect(instance.holdTabId()).toBeNull();

    // A press that ends with selected text keeps the card held.
    press();
    selection.collapse(label, 0);
    selectionChanged();
    selection.setBaseAndExtent(label, 0, label, 1);
    selectionChanged();
    document.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: 1 }));
    expect(instance.holdTabId()).toBe('a');

    // A cancelled press ends the press too: later selection changes apply.
    selection.removeAllRanges();
    selectionChanged();
    expect(instance.holdTabId()).toBeNull();
    press();
    document.dispatchEvent(Object.assign(new Event('pointercancel'), { pointerId: 1 }));
    expect(instance.holdTabId()).toBeNull();
    selection.setBaseAndExtent(label, 0, label, 1);
    selectionChanged();
    expect(instance.holdTabId()).toBe('a');
    selection.removeAllRanges();
    selectionChanged();
    expect(instance.holdTabId()).toBeNull();
  });

  it('keeps the hold until the last active pointer ends', () => {
    const { fixture } = mount();
    const instance = fixture.componentInstance;
    const card = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-tab-id="a"] .rc-select',
    )!;
    const pointer = (type: string, pointerId: number) =>
      Object.assign(new Event(type, { bubbles: true }), { pointerId });
    const selection = document.getSelection()!;
    selection.removeAllRanges();

    card.dispatchEvent(pointer('pointerdown', 1));
    card.dispatchEvent(pointer('pointerdown', 2));
    expect(instance.holdTabId()).toBe('a');
    document.dispatchEvent(pointer('pointerup', 1));
    document.dispatchEvent(new Event('selectionchange'));
    expect(instance.holdTabId()).toBe('a');
    document.dispatchEvent(pointer('pointerup', 2));
    expect(instance.holdTabId()).toBeNull();
  });

  it('releases a stuck pointer and its listeners on window blur', () => {
    const { fixture } = mount();
    const instance = fixture.componentInstance;
    const card = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-tab-id="a"] .rc-select',
    )!;
    const removeDocument = jest.spyOn(document, 'removeEventListener');
    const removeWindow = jest.spyOn(window, 'removeEventListener');
    const removeHost = jest.spyOn(fixture.nativeElement as HTMLElement, 'removeEventListener');
    document.getSelection()?.removeAllRanges();

    card.dispatchEvent(Object.assign(new Event('pointerdown', { bubbles: true }), { pointerId: 17 }));
    expect(instance.holdTabId()).toBe('a');
    window.dispatchEvent(new Event('blur'));
    expect(instance.holdTabId()).toBeNull();
    expect(removeDocument).toHaveBeenCalledWith('pointerup', expect.any(Function));
    expect(removeDocument).toHaveBeenCalledWith('pointercancel', expect.any(Function));
    expect(removeDocument).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(removeWindow).toHaveBeenCalledWith('blur', expect.any(Function));
    expect(removeHost).toHaveBeenCalledWith('lostpointercapture', expect.any(Function));
    removeDocument.mockRestore();
    removeWindow.mockRestore();
    removeHost.mockRestore();
  });

  it('releases the press hold and its listeners when the page becomes hidden', () => {
    const { fixture } = mount();
    const instance = fixture.componentInstance;
    const card = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-tab-id="a"] .rc-select',
    )!;
    const removeDocument = jest.spyOn(document, 'removeEventListener');
    const removeWindow = jest.spyOn(window, 'removeEventListener');
    const removeHost = jest.spyOn(fixture.nativeElement as HTMLElement, 'removeEventListener');
    let hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    document.getSelection()?.removeAllRanges();
    try {
      card.dispatchEvent(Object.assign(new Event('pointerdown', { bubbles: true }), { pointerId: 3 }));
      // A visible page keeps the press.
      document.dispatchEvent(new Event('visibilitychange'));
      expect(instance.holdTabId()).toBe('a');
      expect(removeDocument).not.toHaveBeenCalledWith('pointerup', expect.any(Function));
      hidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
      expect(instance.holdTabId()).toBeNull();
      expect(removeDocument).toHaveBeenCalledWith('pointerup', expect.any(Function));
      expect(removeDocument).toHaveBeenCalledWith('pointercancel', expect.any(Function));
      expect(removeDocument).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
      expect(removeWindow).toHaveBeenCalledWith('blur', expect.any(Function));
      expect(removeHost).toHaveBeenCalledWith('lostpointercapture', expect.any(Function));
      // The released pointer is forgotten: a later press starts a fresh hold.
      hidden = false;
      card.dispatchEvent(Object.assign(new Event('pointerdown', { bubbles: true }), { pointerId: 4 }));
      expect(instance.holdTabId()).toBe('a');
      document.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: 4 }));
      expect(instance.holdTabId()).toBeNull();
    } finally {
      delete (document as { hidden?: boolean }).hidden;
    }
  });

  it('ends the hold only when the last tracked pointer loses capture (FU-14)', () => {
    const { fixture } = mount();
    const instance = fixture.componentInstance;
    const host = fixture.nativeElement as HTMLElement;
    const card = host.querySelector<HTMLElement>('[data-tab-id="a"] .rc-select')!;
    const pointer = (type: string, pointerId: number) =>
      Object.assign(new Event(type, { bubbles: true }), { pointerId });
    const removeDocument = jest.spyOn(document, 'removeEventListener');
    document.getSelection()?.removeAllRanges();

    card.dispatchEvent(pointer('pointerdown', 1));
    card.dispatchEvent(pointer('pointerdown', 2));
    card.dispatchEvent(pointer('lostpointercapture', 1));
    expect(instance.holdTabId()).toBe('a');
    expect(removeDocument).not.toHaveBeenCalledWith('pointerup', expect.any(Function));
    // An untracked pointer losing capture changes nothing.
    card.dispatchEvent(pointer('lostpointercapture', 9));
    expect(instance.holdTabId()).toBe('a');
    // Pointer 1 is no longer tracked, so its late `pointerup` keeps pointer 2's hold.
    document.dispatchEvent(pointer('pointerup', 1));
    expect(instance.holdTabId()).toBe('a');
    card.dispatchEvent(pointer('lostpointercapture', 2));
    expect(instance.holdTabId()).toBeNull();
    expect(removeDocument).toHaveBeenCalledWith('pointerup', expect.any(Function));
    expect(removeDocument).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    removeDocument.mockRestore();
  });

  it('clears a press hold when the board is hidden and shown again mid-press', () => {
    const { fixture } = mount();
    const instance = fixture.componentInstance;
    const pointer = (type: string, pointerId: number) =>
      Object.assign(new Event(type, { bubbles: true }), { pointerId });
    const card = () =>
      (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-tab-id="a"] .rc-select')!;
    document.getSelection()?.removeAllRanges();

    card().dispatchEvent(pointer('pointerdown', 6));
    expect(instance.holdTabId()).toBe('a');
    fixture.componentRef.setInput('visible', false);
    fixture.detectChanges();
    expect(instance.holdTabId()).toBeNull();
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    expect(instance.holdTabId()).toBeNull();
    // The old press is forgotten: its late pointerup changes nothing, and a
    // new press holds and releases normally.
    document.dispatchEvent(pointer('pointerup', 6));
    expect(instance.holdTabId()).toBeNull();
    card().dispatchEvent(pointer('pointerdown', 7));
    expect(instance.holdTabId()).toBe('a');
    document.dispatchEvent(pointer('pointerup', 7));
    expect(instance.holdTabId()).toBeNull();
  });

  it('removes document and host listeners and clears the press on destroy', () => {
    const { fixture } = mount();
    const instance = fixture.componentInstance;
    const host = fixture.nativeElement as HTMLElement;
    const card = host.querySelector<HTMLElement>('[data-tab-id="a"] .rc-select')!;
    const removeDocument = jest.spyOn(document, 'removeEventListener');
    const removeWindow = jest.spyOn(window, 'removeEventListener');
    const removeHost = jest.spyOn(host, 'removeEventListener');
    document.getSelection()?.removeAllRanges();

    card.dispatchEvent(Object.assign(new Event('pointerdown', { bubbles: true }), { pointerId: 5 }));
    expect(instance.holdTabId()).toBe('a');
    fixture.destroy();
    for (const type of ['selectionchange', 'pointerup', 'pointercancel', 'visibilitychange']) {
      expect(removeDocument).toHaveBeenCalledWith(type, expect.any(Function));
    }
    expect(removeWindow).toHaveBeenCalledWith('blur', expect.any(Function));
    expect(removeHost).toHaveBeenCalledWith('pointerdown', expect.any(Function));
    expect(removeHost).toHaveBeenCalledWith('lostpointercapture', expect.any(Function));
    // The press ends with the board: no card stays held.
    expect(instance.holdTabId()).toBeNull();
    removeDocument.mockRestore();
    removeWindow.mockRestore();
    removeHost.mockRestore();
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
    expect(trigger.getAttribute('data-testid')).toBe('canvas-hero-new-session');
    expect(fixture.nativeElement.querySelector('main')!.classList).toContain('order-first');
    expect(trigger.getAttribute('aria-disabled')).toBeNull();
    trigger.click();
    expect(requested).toHaveBeenCalledWith(trigger);
  });

  it('0 tiles: renders project setup on the canvas landing screen', () => {
    const { fixture } = mount(true, 0);
    const emptyBoard = fixture.nativeElement.querySelector('[data-testid="canvas-rail-empty-board"]');
    expect(emptyBoard?.querySelector('ptah-project-setup-card')).not.toBeNull();
    expect(emptyBoard?.textContent).toContain('Open Library');
  });

  it('reloads recent sessions on each entry into the empty board and keeps the rail instance', () => {
    const { fixture, tiles } = mount(true, 1);
    const load = jest.spyOn(TestBed.inject(RecentSessionsStore), 'load');
    const rail = fixture.nativeElement.querySelector('ptah-canvas-rail');
    expect(load).not.toHaveBeenCalled();
    tiles.set([]);
    fixture.detectChanges();
    expect(load).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('ptah-canvas-rail')).toBe(rail);
    tiles.set([{ tabId: 'a', order: 0 } as CanvasTile]);
    fixture.detectChanges();
    tiles.set([]);
    fixture.detectChanges();
    expect(load).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.querySelector('ptah-canvas-rail')).toBe(rail);
  });

  it('does not reload recent sessions when empty tiles change array identity', () => {
    const { fixture, tiles } = mount(true, 0);
    const load = jest.spyOn(TestBed.inject(RecentSessionsStore), 'load');
    load.mockClear();
    tiles.set([]);
    fixture.detectChanges();
    expect(load).not.toHaveBeenCalled();
  });

  it('renders one in-flow notice, announces its severity, and emits its source key', () => {
    const { fixture } = mount(true, 0);
    const dismissed = jest.fn();
    fixture.componentInstance.noticeDismissed.subscribe(dismissed);
    fixture.componentRef.setInput('notice', { kind: 'write-failure', text: 'Layout could not be saved.', key: 'save:1' });
    fixture.detectChanges();
    const notice = fixture.nativeElement.querySelector<HTMLElement>('[data-testid="canvas-board-notice"]')!;
    expect(notice.getAttribute('role')).toBe('alert');
    expect(notice.textContent).toContain('Layout could not be saved.');
    expect(notice.compareDocumentPosition(fixture.nativeElement.querySelector('#canvas-rail-empty-board-title')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    notice.querySelector<HTMLButtonElement>('button')!.click();
    expect(dismissed).toHaveBeenCalledWith('save:1');
    fixture.componentRef.setInput('notice', { kind: 'cap', text: RUNNING_CAP_MESSAGE, key: 'cap:2' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[data-testid="canvas-board-notice"]')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('[data-testid="canvas-board-notice"]')?.getAttribute('role')).toBe('status');
  });

  it('shows at most three recent cards and announces a failed open', async () => {
    const { fixture, recent, openSession } = mount(true, 0);
    recent.set(Array.from({ length: 4 }, (_, i) => ({ id: String(i), name: `Session ${i}`, lastActivityAt: i })));
    fixture.detectChanges();
    const cards = fixture.nativeElement.querySelectorAll<HTMLButtonElement>('[aria-label^="Open Session"]');
    expect(cards).toHaveLength(3);
    openSession.mockResolvedValueOnce('failed');
    cards[0].click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(openSession).toHaveBeenCalledWith(expect.objectContaining({ id: '0' }));
    expect(fixture.nativeElement.querySelector('[aria-live="polite"]')?.textContent).toContain('Unable to open session');
    expect(fixture.nativeElement.querySelectorAll('[aria-label^="Open Session"]')).toHaveLength(3);
  });

  it('keeps the populated rail before the pane in keyboard order and notice in flow', () => {
    const { fixture } = mount(true, 2);
    fixture.componentRef.setInput('notice', { kind: 'read-only', text: 'This layout is read only.', key: 'read:1' });
    fixture.detectChanges();
    const rail = fixture.nativeElement.querySelector('ptah-canvas-rail')!;
    const notice = fixture.nativeElement.querySelector('[data-testid="canvas-board-notice"]')!;
    const pane = fixture.nativeElement.querySelector('[data-testid="rail-pane-container"]')!;
    expect(rail.compareDocumentPosition(pane) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notice.compareDocumentPosition(pane) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notice.parentElement?.className).not.toContain('absolute');
  });

  it.each([
    [0, false],
    [639, true],
    [640, false],
  ])('width %i gives display collapse %s without persisting it', (pixels, collapsed) => {
    const { fixture, width, board, store } = mount();
    width.set(pixels);
    fixture.detectChanges();
    expect(fixture.componentInstance.effectiveCollapsed()).toBe(collapsed);
    expect(fixture.debugElement.query(By.directive(RailStub)).componentInstance.collapsed()).toBe(collapsed);
    expect(board().railCollapsed).toBe(false);
    expect(store.setRailCollapsed).not.toHaveBeenCalled();
  });

  it('width 639: the Rail toggle is auto-disabled and a click never writes the persisted collapse', () => {
    const { fixture, width, board, store } = mount();
    width.set(639);
    fixture.detectChanges();
    const rail = fixture.debugElement.query(By.directive(RailStub)).componentInstance as RailStub;
    expect(rail.autoCollapsed()).toBe(true);
    rail.collapseToggled.emit();
    fixture.detectChanges();
    expect(store.setRailCollapsed).not.toHaveBeenCalled();
    expect(board().railCollapsed).toBe(false);
    expect(rail.collapsed()).toBe(true);
  });

  it('width 640: the Rail toggle persists the collapse as before', () => {
    const { fixture, width, board, store } = mount();
    width.set(640);
    fixture.detectChanges();
    const rail = fixture.debugElement.query(By.directive(RailStub)).componentInstance as RailStub;
    expect(rail.autoCollapsed()).toBe(false);
    rail.collapseToggled.emit();
    fixture.detectChanges();
    expect(store.setRailCollapsed).toHaveBeenCalledWith('workspace', true);
    expect(board().railCollapsed).toBe(true);
    expect(rail.collapsed()).toBe(true);
  });

  it('sm band with details open: the toggle is auto-disabled and does not persist', () => {
    const { fixture, width, store } = mount();
    width.set(1000);
    fixture.detectChanges();
    fixture.componentInstance.toggleDetails();
    fixture.detectChanges();
    const rail = fixture.debugElement.query(By.directive(RailStub)).componentInstance as RailStub;
    expect(rail.autoCollapsed()).toBe(true);
    fixture.componentInstance.toggleCollapse();
    expect(store.setRailCollapsed).not.toHaveBeenCalled();
  });

  it('0 tiles: the empty board scrolls inside the viewport', () => {
    const { fixture } = mount(true, 0);
    const emptyBoard = fixture.nativeElement.querySelector<HTMLElement>('[data-testid="canvas-rail-empty-board"]');
    expect(emptyBoard.classList).toContain('overflow-y-auto');
    expect(emptyBoard.classList).toContain('min-h-0');
    expect(emptyBoard.classList).not.toContain('justify-center');
    const content = emptyBoard.querySelector<HTMLElement>('[data-testid="canvas-rail-empty-board-content"]');
    expect(content?.parentElement).toBe(emptyBoard);
    expect(content?.classList).toContain('max-w-[780px]');
    expect(content?.querySelector('ptah-project-setup-card')).not.toBeNull();
    expect(content?.querySelector('#canvas-rail-empty-board-title')).not.toBeNull();
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

  it.each([
    ['click', null],
    ['Enter', 'Enter'],
    ['Space', ' '],
  ])('real card %s selects the inactive split pane without losing either host', (_gesture, key) => {
    // The board harness substitutes RailStub, so mount the real card separately
    // and wire its output to the real board handler, as CanvasRail does.
    const { fixture, focused, store } = mount(true, 2, 'a', undefined, true);
    const board = fixture.componentInstance;
    board.openBeside('b');
    board.activatePane('left');
    fixture.detectChanges();
    expect(board.paneTab('left')).toBe('a');
    expect(board.paneTab('right')).toBe('b');

    const card = TestBed.createComponent(CanvasRailCardComponent);
    card.componentRef.setInput('tabId', 'b');
    card.componentInstance.focusRequested.subscribe((id) => board.focus(id));
    card.detectChanges();
    const select = card.nativeElement.querySelector('.rc-select') as HTMLButtonElement;
    (store.focusTile as jest.Mock).mockClear();
    if (key) select.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    else select.click();
    fixture.detectChanges();

    expect(board.activeSide()).toBe('right');
    expect(board.paneTab('right')).toBe('b');
    expect(board.paneTab('left')).toBe('a');
    expect(board.otherTabId()).toBe('a');
    expect(focused()).toBe('b');
    expect(fixture.nativeElement.querySelectorAll('ptah-canvas-lane-view')).toHaveLength(2);
    expect(store.focusTile).toHaveBeenCalledWith('b');
    card.destroy();
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

  it.each([1280, 920])('%i stacked gives each pane a floor and scrolls the container when needed', (pixels) => {
    const { fixture, width } = mount();
    fixture.componentInstance.openBeside('b');
    width.set(pixels);
    fixture.detectChanges();
    const container = fixture.nativeElement.querySelector('[data-testid="rail-pane-container"]');
    expect(container.classList.contains('flex-col')).toBe(true);
    expect(container.classList).toContain('min-h-0');
    expect(container.classList).toContain('overflow-x-auto');
    expect(container.classList).toContain('overflow-y-auto');
    expect(container.classList).not.toContain('overflow-y-hidden');
    const panes = fixture.nativeElement.querySelectorAll('[data-pane-side]');
    expect(panes).toHaveLength(2);
    for (const pane of panes) {
      expect(pane.classList).not.toContain('min-h-0');
      expect(pane.classList).toContain('flex-1');
      expect(pane.classList).toContain('overflow-hidden');
      expect(pane.classList).not.toContain('overflow-y-auto');
      expect(pane.classList).toContain('min-h-[240px]');
      expect(pane.classList).not.toContain('min-h-[400px]');
      expect(pane.classList.contains('min-w-[360px]')).toBe(true);
      // NEW-3: Details lives in the pane header; the wrapper adds no control over header or lane tabs.
      expect(pane.querySelector('ptah-canvas-focus-area [aria-label="Open details"]')).not.toBeNull();
      expect(pane.querySelectorAll(':scope > button, :scope > .absolute')).toHaveLength(0);
    }
    expect(fixture.nativeElement.querySelector('[aria-label="Close split"]')).toBeNull();
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

  it('focuses the split dialog before deferred content exists so Escape closes it', async () => {
    const { fixture } = mount();
    fixture.componentInstance.openBeside('b');
    fixture.detectChanges();
    fixture.componentInstance.openSplitDetails('right');
    fixture.detectChanges();
    await fixture.whenStable();
    const dialog = fixture.nativeElement.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(document.activeElement).toBe(dialog);
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
  });

  it('focuses the compact sheet, lets Tab wrap, and reveals a selected lane', async () => {
    const { fixture, width } = mount();
    width.set(390);
    fixture.detectChanges();
    fixture.componentInstance.openSplitDetails('left');
    fixture.detectChanges();
    await fixture.whenStable();
    const wrapper = fixture.nativeElement.querySelector<HTMLElement>('[data-compact-sheet]')!;
    expect(document.activeElement).toBe(wrapper);
    expect(wrapper.classList).toContain('fixed');
    expect(wrapper.getAttribute('aria-modal')).toBe('true');
    await completeDeferBlocks(fixture);
    fixture.detectChanges();
    const close = wrapper.querySelector<HTMLButtonElement>('[data-inspector-close]')!;
    const lane = wrapper.querySelector<HTMLButtonElement>('[data-lane]')!;
    await fixture.whenStable();
    // MutationObserver focus handoff runs after the deferred view is inserted.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(document.activeElement).toBe(close);
    close.focus();
    close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(lane);
    lane.focus();
    lane.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(close);
    const selectLaneFor = jest.fn();
    Object.assign(TestBed.inject(CanvasDetailService), { selectLaneFor });
    lane.click();
    fixture.detectChanges();
    expect(selectLaneFor).toHaveBeenCalledWith('a', 'agent-1');
    expect(fixture.componentInstance.detailsOpen()).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-compact-sheet]')).toBeNull();
  });

  it('traps Tab at the sheet boundary when the inspector contains another dialog', async () => {
    const { fixture, width } = mount();
    width.set(390);
    fixture.detectChanges();
    fixture.componentInstance.openSplitDetails('left');
    fixture.detectChanges();
    await completeDeferBlocks(fixture);
    fixture.detectChanges();
    const sheet = fixture.nativeElement.querySelector<HTMLElement>('[data-compact-sheet]')!;
    const inspector = sheet.querySelector('ptah-session-inspector [role="dialog"]')!;
    const nested = document.createElement('div');
    nested.setAttribute('role', 'dialog');
    nested.innerHTML = '<button type="button">Nested action</button>';
    inspector.appendChild(nested);
    const last = document.createElement('button');
    last.type = 'button';
    last.textContent = 'Sheet action';
    sheet.appendChild(last);
    const first = sheet.querySelector<HTMLButtonElement>('[data-inspector-close]')!;
    last.focus();
    const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    last.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    const backward = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    first.dispatchEvent(backward);
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it('closes the compact sheet on Escape even when focus has moved outside it', () => {
    const { fixture, width } = mount();
    width.set(390);
    fixture.detectChanges();
    fixture.componentInstance.openSplitDetails('left');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-compact-sheet]')).not.toBeNull();
    document.body.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-compact-sheet]')).toBeNull();
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

  it('announces a pre-existing persistence failure with the neutral layout message', () => {
    const { fixture, writeFailed } = mount();
    writeFailed.set(true);
    fixture.detectChanges();
    expect(fixture.componentInstance.announcement()).toBe('Layout changes could not be saved.');
  });

  it('C3: a write failure after a reorder reads the neutral layout message on a visible board, nothing while hidden', () => {
    const { fixture, writeFailed } = mount();
    fixture.componentInstance.move('b', -1);
    writeFailed.set(true);
    fixture.detectChanges();
    expect(fixture.componentInstance.announcement()).toBe('Layout changes could not be saved.');
    expect('reorderPending' in fixture.componentInstance).toBe(false);
    writeFailed.set(false);
    fixture.componentInstance.announcement.set('');
    fixture.componentRef.setInput('visible', false);
    fixture.detectChanges();
    writeFailed.set(true);
    fixture.detectChanges();
    expect(fixture.componentInstance.announcement()).toBe('');
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

  // ---- R9x: header split actions, swap, stacked Tab order; R9w C1-C3, NEW-3, NEW-6 ----

  type Fixture = ReturnType<typeof mount>['fixture'];
  const paneOf = (fixture: Fixture, side: 'left' | 'right') =>
    fixture.nativeElement.querySelector<HTMLElement>(
      `[data-testid="rail-pane-container"] > [data-pane-side="${side}"]`,
    ) as HTMLElement | null;
  const stubOf = (fixture: Fixture, side: 'left' | 'right') =>
    fixture.debugElement
      .queryAll(By.directive(FocusStub))
      .map((node) => node.componentInstance as FocusStub)
      .find((stub) => stub.paneId() === side) as FocusStub;
  const buttons = (root: Element | null) => [...(root?.querySelectorAll<HTMLElement>('button') ?? [])];
  const railButtons = (fixture: Fixture) => buttons(fixture.nativeElement.querySelector('ptah-canvas-rail'));
  const tab = (target: HTMLElement, shiftKey = false) => {
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };

  it('C1: with SURFACE_ACTIVE false a removed focused tile writes no focusTile; activation repairs once', () => {
    const surface = signal(false);
    const { fixture, focused, tiles, store } = mount(true, 3, 'b', surface);
    const instance = fixture.componentInstance;
    (store.focusTile as jest.Mock).mockClear();
    tiles.update((current) => current.filter((tile) => tile.tabId !== 'b'));
    focused.set(null);
    fixture.detectChanges();
    expect(store.focusTile).not.toHaveBeenCalled();
    expect(instance.paneTab(instance.activeSide())).toBe('c');
    surface.set(true);
    fixture.detectChanges();
    expect(store.focusTile).toHaveBeenCalledTimes(1);
    expect(store.focusTile).toHaveBeenCalledWith('c');
    fixture.detectChanges();
    expect(store.focusTile).toHaveBeenCalledTimes(1);
    expect(focused()).toBe('c');
  });

  it('C1: hydration with null focus while SURFACE_ACTIVE is false waits for activation', () => {
    const surface = signal(false);
    const { fixture, focused, store } = mount(true, 3, null, surface);
    expect(store.focusTile).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelectorAll('ptah-canvas-focus-area')).toHaveLength(1);
    surface.set(true);
    fixture.detectChanges();
    expect(store.focusTile).toHaveBeenCalledTimes(1);
    expect(focused()).toBe('a');
  });

  it('C1: split survivor repair waits for SURFACE_ACTIVE and runs once on activation', () => {
    const surface = signal(true);
    const { fixture, focused, tiles, store } = mount(true, 3, 'c', surface);
    const instance = fixture.componentInstance;
    instance.openBeside('b');
    fixture.detectChanges();
    surface.set(false);
    fixture.detectChanges();
    (store.focusTile as jest.Mock).mockClear();
    tiles.update((current) => current.filter((tile) => tile.tabId !== 'b'));
    focused.set(null);
    fixture.detectChanges();
    expect(store.focusTile).not.toHaveBeenCalled();
    expect(instance.otherTabId()).toBeNull();
    surface.set(true);
    fixture.detectChanges();
    fixture.detectChanges();
    expect(store.focusTile).toHaveBeenCalledTimes(1);
    expect(focused()).toBe('c');
  });

  it('C2: hidden removal during split keeps the survivor and the board shows it on return', () => {
    const { fixture, focused, tiles, store } = mount(true, 4, 'c');
    const instance = fixture.componentInstance;
    instance.openBeside('d');
    fixture.detectChanges();
    expect(instance.otherTabId()).toBe('c');
    (store.focusTile as jest.Mock).mockClear();
    fixture.componentRef.setInput('visible', false);
    tiles.update((current) => current.filter((tile) => tile.tabId !== 'd'));
    focused.set(null);
    fixture.detectChanges();
    expect(store.focusTile).not.toHaveBeenCalled();
    expect(instance.otherTabId()).toBeNull();
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    expect(focused()).toBe('c');
    expect(store.focusTile).toHaveBeenCalledTimes(1);
    const pane = fixture.debugElement.query(By.directive(FocusStub)).componentInstance as FocusStub;
    const rail = fixture.debugElement.query(By.directive(RailStub)).componentInstance as RailStub;
    expect(pane.focusedTabId()).toBe('c');
    expect(rail.focusedTabId()).toBe('c');
  });

  it('each header output reaches board state through the pane focus area', () => {
    const { fixture, focused } = mount(true, 3);
    const instance = fixture.componentInstance;
    instance.openBeside('b');
    fixture.detectChanges();
    stubOf(fixture, 'right').swapPanesRequested.emit('right');
    fixture.detectChanges();
    expect(instance.visualOrder()).toEqual(['right', 'left']);
    stubOf(fixture, 'left').detailsRequested.emit('left');
    fixture.detectChanges();
    expect(instance.detailsOpen()).toBe(true);
    expect(instance.activeSide()).toBe('left');
    expect(focused()).toBe('a');
    expect(paneOf(fixture, 'left')?.querySelector('[role="dialog"]')).not.toBeNull();
    expect(stubOf(fixture, 'left').detailsOpen()).toBe(true);
    expect(stubOf(fixture, 'right').detailsOpen()).toBe(false);
    stubOf(fixture, 'left').closeSplitRequested.emit('left');
    fixture.detectChanges();
    expect(instance.otherTabId()).toBeNull();
    expect(instance.detailsOpen()).toBe(false);
    expect(focused()).toBe('a');
    instance.openBeside('c');
    fixture.detectChanges();
    const side = instance.activeSide();
    stubOf(fixture, side).closePaneRequested.emit(side);
    fixture.detectChanges();
    expect(instance.otherTabId()).toBeNull();
    expect(focused()).toBe('a');
  });

  it('close active pane releases that host, focuses the survivor in its own host and header', async () => {
    const { fixture, focused, store } = mount(true, 3);
    const instance = fixture.componentInstance;
    instance.openBeside('b');
    fixture.detectChanges();
    instance.swapPanes();
    fixture.detectChanges();
    const survivorHost = paneOf(fixture, 'left')?.querySelector('ptah-canvas-focus-area');
    paneOf(fixture, 'right')?.querySelector<HTMLElement>('[data-header-menu]')?.focus();
    stubOf(fixture, 'right').closePaneRequested.emit('right');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(instance.otherTabId()).toBeNull();
    expect(focused()).toBe('a');
    expect(instance.activeSide()).toBe('left');
    expect(instance.visualOrder()).toEqual(['left', 'right']);
    expect(paneOf(fixture, 'right')).toBeNull();
    expect(paneOf(fixture, 'left')?.querySelector('ptah-canvas-focus-area')).toBe(survivorHost);
    expect(fixture.nativeElement.querySelectorAll('ptah-canvas-lane-view')).toHaveLength(1);
    expect(document.activeElement).toBe(paneOf(fixture, 'left')?.querySelector('[data-header-menu]'));
    expect(instance.announcement()).toBe('Pane closed. a stays open.');
    expect(store.removeTile).not.toHaveBeenCalled();
  });

  it('close inactive pane keeps store focus and the active host; NEW-6 single focus on the right side works', async () => {
    const { fixture, focused, store } = mount(true, 3);
    const instance = fixture.componentInstance;
    instance.openBeside('b');
    fixture.detectChanges();
    const activeHost = paneOf(fixture, 'right')?.querySelector('ptah-canvas-focus-area');
    (store.focusTile as jest.Mock).mockClear();
    stubOf(fixture, 'left').closePaneRequested.emit('left');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(store.focusTile).not.toHaveBeenCalled();
    expect(focused()).toBe('b');
    expect(instance.otherTabId()).toBeNull();
    expect(paneOf(fixture, 'left')).toBeNull();
    expect(paneOf(fixture, 'right')?.querySelector('ptah-canvas-focus-area')).toBe(activeHost);
    expect(document.activeElement).toBe(paneOf(fixture, 'right')?.querySelector('[data-header-menu]'));
    const panes = fixture.nativeElement.querySelectorAll('[data-pane-side]');
    expect(panes).toHaveLength(1);
    expect(panes[0].getAttribute('data-pane-side')).toBe('right');
    expect(panes[0].getAttribute('aria-label')).toBe('Focused session: b');
    instance.onLanesRequested('b');
    fixture.detectChanges();
    expect(document.activeElement).toBe(paneOf(fixture, 'right')?.querySelector('[role="tab"]'));
  });

  it('each labelled pane holds the real focus area, whose inner section is no second landmark', () => {
    const { fixture } = mount(true, 2, 'a', undefined, false, true);
    const innerSections = () => {
      const panes = [...fixture.nativeElement.querySelectorAll<HTMLElement>('[data-pane-side]')];
      return panes.map((pane) => {
        expect(pane.getAttribute('aria-label')).toMatch(/session: [ab]/);
        const inner = pane.querySelector<HTMLElement>('ptah-canvas-focus-area section');
        expect(inner).not.toBeNull();
        expect(pane.querySelectorAll('[aria-label]')).toHaveLength(0);
        return inner as HTMLElement;
      });
    };
    const single = innerSections();
    expect(single).toHaveLength(1);
    expect(single[0].hasAttribute('aria-label')).toBe(false);
    expect(single[0].hasAttribute('aria-labelledby')).toBe(false);
    fixture.componentInstance.openBeside('b');
    fixture.detectChanges();
    const split = innerSections();
    expect(split).toHaveLength(2);
    for (const inner of split) {
      expect(inner.hasAttribute('aria-label')).toBe(false);
      expect(inner.hasAttribute('aria-labelledby')).toBe(false);
    }
  });

  it('close split from the active header keeps the active tab and the focus on that header', async () => {
    const { fixture, focused } = mount(true, 3);
    const instance = fixture.componentInstance;
    instance.openBeside('b');
    fixture.detectChanges();
    const host = paneOf(fixture, 'right')?.querySelector('ptah-canvas-focus-area');
    const trigger = paneOf(fixture, 'right')?.querySelector<HTMLElement>('[data-header-menu]');
    trigger?.focus();
    stubOf(fixture, 'right').closeSplitRequested.emit('right');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(focused()).toBe('b');
    expect(instance.otherTabId()).toBeNull();
    expect(paneOf(fixture, 'right')?.querySelector('ptah-canvas-focus-area')).toBe(host);
    expect(document.activeElement).toBe(trigger);
    expect(instance.announcement()).toBe('Split closed.');
  });

  it('Escape inside a split pane never closes a pane', () => {
    const { fixture } = mount(true, 3);
    const instance = fixture.componentInstance;
    instance.openBeside('b');
    fixture.detectChanges();
    for (const side of ['left', 'right'] as const) {
      paneOf(fixture, side)
        ?.querySelector('[data-header-menu]')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    }
    fixture.detectChanges();
    expect(instance.otherTabId()).toBe('a');
    expect(fixture.nativeElement.querySelectorAll('ptah-canvas-lane-view')).toHaveLength(2);
  });

  it.each([
    ['Close split', (board: CanvasRailBoardComponent) => board.closeSplit()],
    ['Close pane', (board: CanvasRailBoardComponent) => board.closePane(board.activeSide())],
  ])('collapse resets visualOrder (%s) and a new split starts in the default order', (_label, collapse) => {
    const { fixture } = mount(true, 3);
    const instance = fixture.componentInstance;
    instance.openBeside('b');
    fixture.detectChanges();
    instance.swapPanes();
    fixture.detectChanges();
    expect(instance.visualOrder()).toEqual(['right', 'left']);
    collapse(instance);
    fixture.detectChanges();
    expect(instance.visualOrder()).toEqual(['left', 'right']);
    instance.openBeside('c');
    fixture.detectChanges();
    expect(instance.visualOrder()).toEqual(['left', 'right']);
  });

  it('collapse resets visualOrder after external removal', () => {
    const { fixture, tiles } = mount(true, 3);
    const instance = fixture.componentInstance;
    instance.openBeside('b');
    fixture.detectChanges();
    instance.swapPanes();
    tiles.update((current) => current.filter((tile) => tile.tabId !== 'a'));
    fixture.detectChanges();
    expect(instance.otherTabId()).toBeNull();
    expect(instance.visualOrder()).toEqual(['left', 'right']);
  });

  it('stacked swap keeps hosts and top-before-bottom Tab order', () => {
    const { fixture, focused } = mount(true, 3);
    const instance = fixture.componentInstance;
    expect(instance.splitStacked()).toBe(true);
    instance.openBeside('b');
    fixture.detectChanges();
    const left = paneOf(fixture, 'left') as HTMLElement;
    const right = paneOf(fixture, 'right') as HTMLElement;
    const views = [left, right].map((pane) => pane.querySelector('ptah-canvas-lane-view'));
    const areas = [left, right].map((pane) => pane.querySelector('ptah-canvas-focus-area'));
    const stubs = [stubOf(fixture, 'left'), stubOf(fixture, 'right')];
    stubOf(fixture, 'right').swapPanesRequested.emit('right');
    fixture.detectChanges();
    fixture.detectChanges();
    // Only the CSS order changed: same wrappers, hosts, stand-in ChatView subtrees, pane ids and tabs.
    expect(instance.visualOrder()).toEqual(['right', 'left']);
    expect(paneOf(fixture, 'left')).toBe(left);
    expect(paneOf(fixture, 'right')).toBe(right);
    [left, right].forEach((pane, index) => {
      expect(pane.querySelector('ptah-canvas-lane-view')).toBe(views[index]);
      expect(pane.querySelector('ptah-canvas-focus-area')).toBe(areas[index]);
    });
    expect(stubOf(fixture, 'left')).toBe(stubs[0]);
    expect(stubOf(fixture, 'right')).toBe(stubs[1]);
    expect(stubs.map((stub) => [stub.paneId(), stub.focusedTabId()])).toEqual([['left', 'a'], ['right', 'b']]);
    expect(fixture.nativeElement.querySelectorAll('ptah-canvas-lane-view')).toHaveLength(2);
    expect(fixture.nativeElement.getAttribute('data-canvas-live-views')).toBe('2');
    expect(right.style.order).toBe('0');
    expect(left.style.order).toBe('1');
    expect(right.getAttribute('aria-label')).toBe('Top session: b, active');
    expect(left.getAttribute('aria-label')).toBe('Bottom session: a');
    expect(focused()).toBe('b');
    expect(instance.otherTabId()).toBe('a');
    expect((fixture.debugElement.query(By.directive(RailStub)).componentInstance as RailStub).focusedTabId()).toBe('b');
    expect(instance.announcement()).toBe('Panes swapped. Top session: b, active; Bottom session: a.');
    // Tab order: Rail, visual top pane, visual bottom pane (jsdom moves no focus; the handler does).
    const rail = railButtons(fixture);
    const top = buttons(right);
    const bottom = buttons(left);
    let event = tab(rail[rail.length - 1]);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(top[0]);
    expect(tab(top[0]).defaultPrevented).toBe(false);
    event = tab(top[top.length - 1]);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(bottom[0]);
    event = tab(bottom[0], true);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(top[top.length - 1]);
    event = tab(top[0], true);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(rail[rail.length - 1]);
    event = tab(bottom[bottom.length - 1]);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(rail[0]);
  });

  it('stacked Tab handler skips hidden elements, leaves open overlays alone and is inert in the default order', async () => {
    const { fixture } = mount(true, 3);
    const instance = fixture.componentInstance;
    instance.openBeside('b');
    fixture.detectChanges();
    const left = paneOf(fixture, 'left') as HTMLElement;
    const right = paneOf(fixture, 'right') as HTMLElement;
    expect(tab(buttons(left)[buttons(left).length - 1]).defaultPrevented).toBe(false);
    instance.swapPanes();
    fixture.detectChanges();
    const hidden = document.createElement('button');
    hidden.style.display = 'none';
    right.appendChild(hidden);
    const visibleTop = buttons(right).filter((button) => button !== hidden);
    expect(tab(visibleTop[visibleTop.length - 1]).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons(left)[0]);
    hidden.remove();
    stubOf(fixture, 'right').detailsRequested.emit('right');
    fixture.detectChanges();
    await completeDeferBlocks(fixture);
    const dialogButton = right.querySelector<HTMLElement>('[role="dialog"] button') as HTMLElement;
    expect(dialogButton).not.toBeNull();
    expect(tab(dialogButton).defaultPrevented).toBe(false);
    const topOutside = buttons(right).filter((button) => !button.closest('[role="dialog"]'));
    expect(tab(topOutside[topOutside.length - 1]).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons(left)[0]);
  });

  it('Tab focus arriving from outside the board activates the pane it lands in', () => {
    const { fixture, focused } = mount(true, 3);
    const instance = fixture.componentInstance;
    instance.openBeside('b');
    fixture.detectChanges();
    instance.swapPanes();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const before = document.createElement('button');
    before.textContent = 'Before board';
    host.parentElement!.insertBefore(before, host);
    try {
      expect(instance.activeSide()).toBe('right');
      before.focus();
      // The board's Tab handler listens on its host only: a Tab pressed outside
      // the board keeps the browser's own move.
      expect(tab(before).defaultPrevented).toBe(false);
      // The browser then moves focus into the board; landing in the inactive
      // pane activates it through that pane's focusin.
      const inactive = paneOf(fixture, 'left') as HTMLElement;
      buttons(inactive)[0].focus();
      fixture.detectChanges();
      expect(document.activeElement).toBe(buttons(inactive)[0]);
      expect(instance.activeSide()).toBe('left');
      expect(focused()).toBe('a');
      expect(instance.otherTabId()).toBe('b');
      expect(inactive.getAttribute('aria-label')).toBe('Bottom session: a, active');
      // Focus arriving in the already active pane changes nothing.
      before.focus();
      buttons(inactive)[0].focus();
      fixture.detectChanges();
      expect(instance.activeSide()).toBe('left');
      expect(focused()).toBe('a');
    } finally {
      before.remove();
    }
  });

  it('side-by-side swap keeps DOM Tab order (B3)', () => {
    const { fixture, width } = mount(true, 3);
    const instance = fixture.componentInstance;
    width.set(1600);
    instance.openBeside('b');
    fixture.detectChanges();
    stubOf(fixture, 'right').swapPanesRequested.emit('right');
    fixture.detectChanges();
    const left = paneOf(fixture, 'left') as HTMLElement;
    const right = paneOf(fixture, 'right') as HTMLElement;
    expect(right.getAttribute('aria-label')).toBe('Left session: b, active');
    expect(left.getAttribute('aria-label')).toBe('Right session: a');
    const rail = railButtons(fixture);
    const cases: Array<[HTMLElement, boolean]> = [
      [rail[rail.length - 1], false],
      [buttons(left)[buttons(left).length - 1], false],
      [buttons(right)[0], true],
      [buttons(left)[0], true],
    ];
    for (const [target, shift] of cases) {
      const before = document.activeElement;
      expect(tab(target, shift).defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(before);
    }
  });

  it('R9x-fix: swap keeps each pane lane, ChatView, typed draft and dock state (stateful child)', () => {
    TestBed.overrideComponent(FocusStub, { set: { imports: [StatefulLaneStub] } });
    const { fixture } = mount(true, 3);
    const instance = fixture.componentInstance;
    instance.openBeside('b');
    fixture.detectChanges();
    Object.assign(life, { lane: 0, laneDestroyed: 0, chat: 0, chatDestroyed: 0 });
    const chatOf = (side: 'left' | 'right') =>
      fixture.debugElement
        .queryAll(By.directive(StatefulChatViewStub))
        .find((node) => (node.nativeElement as HTMLElement).closest('[data-pane-side]')?.getAttribute('data-pane-side') === side)!;
    const laneOf = (side: 'left' | 'right') =>
      fixture.debugElement
        .queryAll(By.directive(StatefulLaneStub))
        .find((node) => (node.nativeElement as HTMLElement).closest('[data-pane-side]')?.getAttribute('data-pane-side') === side)!
        .componentInstance as StatefulLaneStub;
    const sides = ['left', 'right'] as const;
    // The user types a draft in each composer (through the DOM) and opens the dock in the right pane.
    sides.forEach((side) => {
      const textarea = (chatOf(side).nativeElement as HTMLElement).querySelector<HTMLTextAreaElement>('[data-draft]')!;
      textarea.value = `draft ${side}`;
      textarea.dispatchEvent(new Event('input'));
    });
    (chatOf('right').componentInstance as StatefulChatViewStub).dockOpen.set(true);
    fixture.detectChanges();
    const lanes = sides.map(laneOf);
    const chats = sides.map((side) => chatOf(side).componentInstance as StatefulChatViewStub);
    const chatNodes = sides.map((side) => chatOf(side).nativeElement as HTMLElement);
    const textareas = chatNodes.map((node) => node.querySelector<HTMLTextAreaElement>('[data-draft]')!);

    instance.swapPanes();
    fixture.detectChanges();
    fixture.detectChanges();

    expect(instance.visualOrder()).toEqual(['right', 'left']);
    expect(life).toEqual({ lane: 0, laneDestroyed: 0, chat: 0, chatDestroyed: 0 });
    sides.forEach((side, index) => {
      expect(laneOf(side)).toBe(lanes[index]);
      expect(chatOf(side).componentInstance).toBe(chats[index]);
      expect(chatOf(side).nativeElement).toBe(chatNodes[index]);
      expect(chatNodes[index].querySelector('[data-draft]')).toBe(textareas[index]);
      expect(textareas[index].value).toBe(`draft ${side}`);
      expect(chats[index].draft()).toBe(`draft ${side}`);
    });
    expect(chats.map((chat) => chat.dockOpen())).toEqual([false, true]);
    expect(chatNodes.map((node) => node.querySelector('[data-dock]')?.getAttribute('data-open'))).toEqual(['false', 'true']);
    expect(fixture.nativeElement.querySelectorAll('ptah-chat-view')).toHaveLength(2);
  });

  // ---- Row 113: split pane separation, active accent and 1/2 markers ----

  const container = (fixture: Fixture) =>
    fixture.nativeElement.querySelector<HTMLElement>('[data-testid="rail-pane-container"]') as HTMLElement;
  const identity = (fixture: Fixture) =>
    (['left', 'right'] as const).map((side) => {
      const stub = stubOf(fixture, side);
      return [side, stub.paneNumber(), stub.panePlace(), stub.paneFocused()];
    });

  it('row 113: side by side shows a vertical divider and markers 1/2 that follow visualOrder on swap', () => {
    const { fixture, width } = mount(true, 3);
    width.set(1600);
    const instance = fixture.componentInstance;
    instance.openBeside('b');
    fixture.detectChanges();
    expect(instance.splitStacked()).toBe(false);
    expect(container(fixture).classList).toContain('gap-1');
    const left = paneOf(fixture, 'left') as HTMLElement;
    const right = paneOf(fixture, 'right') as HTMLElement;
    expect(identity(fixture)).toEqual([['left', 1, 'Left', false], ['right', 2, 'Right', true]]);
    expect(right.getAttribute('data-pane-divider')).toBe('vertical');
    expect(right.classList).toContain('border-l');
    expect(right.classList).toContain('border-base-content-muted');
    expect(right.classList).not.toContain('border-t');
    expect(left.hasAttribute('data-pane-divider')).toBe(false);
    expect(left.classList).not.toContain('border-l');
    instance.swapPanes();
    fixture.detectChanges();
    // Same wrappers; the marker and the divider follow the visual order.
    expect(paneOf(fixture, 'left')).toBe(left);
    expect(paneOf(fixture, 'right')).toBe(right);
    expect(identity(fixture)).toEqual([['left', 2, 'Right', false], ['right', 1, 'Left', true]]);
    expect(left.getAttribute('data-pane-divider')).toBe('vertical');
    expect(left.classList).toContain('border-l');
    expect(right.hasAttribute('data-pane-divider')).toBe(false);
    expect(right.classList).not.toContain('border-l');
    for (const pane of [left, right]) {
      expect(pane.classList).toContain('min-w-[360px]');
      expect(pane.classList).toContain('min-h-0');
      expect(pane.classList).not.toContain('min-h-[400px]');
    }
  });

  it('row 113: stacked panes use a horizontal divider on the bottom pane and Top/Bottom markers', () => {
    const { fixture } = mount(true, 3);
    const instance = fixture.componentInstance;
    instance.openBeside('b');
    fixture.detectChanges();
    expect(instance.splitStacked()).toBe(true);
    expect(container(fixture).classList).toContain('gap-1');
    const right = paneOf(fixture, 'right') as HTMLElement;
    expect(identity(fixture)).toEqual([['left', 1, 'Top', false], ['right', 2, 'Bottom', true]]);
    expect(right.getAttribute('data-pane-divider')).toBe('horizontal');
    expect(right.classList).toContain('border-t');
    expect(right.classList).not.toContain('border-l');
    expect(paneOf(fixture, 'left')?.classList).not.toContain('border-t');
  });

  it('row 113: only the active pane is marked active, and activating the other pane moves it without remount', () => {
    const { fixture, focused } = mount(true, 3);
    const instance = fixture.componentInstance;
    instance.openBeside('b');
    fixture.detectChanges();
    const hosts = (['left', 'right'] as const).map((side) => paneOf(fixture, side)?.querySelector('ptah-canvas-focus-area'));
    expect([stubOf(fixture, 'left').paneFocused(), stubOf(fixture, 'right').paneFocused()]).toEqual([false, true]);
    paneOf(fixture, 'left')?.click();
    fixture.detectChanges();
    expect(focused()).toBe('a');
    expect([stubOf(fixture, 'left').paneFocused(), stubOf(fixture, 'right').paneFocused()]).toEqual([true, false]);
    expect((['left', 'right'] as const).map((side) => paneOf(fixture, side)?.querySelector('ptah-canvas-focus-area'))).toEqual(hosts);
    // Activation changes neither the visual numbers nor the divider.
    expect(identity(fixture).map(([side, number]) => [side, number])).toEqual([['left', 1], ['right', 2]]);
  });

  it('row 113: single focus has no divider, gap or marker', () => {
    const { fixture, width } = mount(true, 3);
    width.set(1600);
    fixture.detectChanges();
    expect(container(fixture).classList).not.toContain('gap-1');
    const panes = [...container(fixture).querySelectorAll<HTMLElement>(':scope > [data-pane-side]')];
    expect(panes).toHaveLength(1);
    expect(panes[0].hasAttribute('data-pane-divider')).toBe(false);
    for (const name of ['border-l', 'border-t', 'border-base-content-muted', 'min-w-[360px]', 'min-h-[400px]'])
      expect(panes[0].classList).not.toContain(name);
    const stub = fixture.debugElement.query(By.directive(FocusStub)).componentInstance as FocusStub;
    expect([stub.splitDisplayed(), stub.paneNumber(), stub.panePlace()]).toEqual([false, null, '']);
  });
});
