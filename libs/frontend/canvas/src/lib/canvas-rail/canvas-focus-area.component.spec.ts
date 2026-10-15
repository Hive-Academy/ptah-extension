import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  OnDestroy,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  TabManagerService,
  ChatStore,
  StreamPresentationStore,
} from '@ptah-extension/chat';
import { ExecutionTreeBuilderService } from '@ptah-extension/chat-streaming';
import type { StreamingState, TabState } from '@ptah-extension/chat-types';
import { CanvasStore } from '../canvas.store';
import { CanvasDetailService } from '../canvas-detail/canvas-detail.service';
import { CanvasRenderMetricsService } from '../canvas-render-metrics.service';
import { CanvasFocusAreaComponent } from './canvas-focus-area.component';

const destroyed: string[] = [];
const snapshots = signal(new Map<string, TabState>());
const buildTree = jest.fn(() => []);

@Component({
  selector: 'ptah-canvas-focus-header',
  standalone: true,
  template:
    '<header>{{ title() }}<span class="branch-chip">{{ branch() }}</span><span class="model-chip">{{ model() }}</span></header>',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class HeaderStub {
  readonly tabId = input.required<string>();
  readonly title = input('');
  readonly state = input('idle');
  readonly branch = input<string | null>(null);
  readonly model = input<string | null>(null);
  readonly running = input(false);
  readonly viewMode = input('full');
  readonly band = input('lg');
  readonly splitDisplayed = input(false);
  readonly detailsOpen = input(false);
  readonly paneFocused = input(true);
  readonly paneNumber = input<1 | 2 | null>(null);
  readonly panePlace = input('');
  readonly stop = output<void>();
  readonly toggleViewMode = output<void>();
  readonly closeRequested = output<void>();
  readonly closeSplitRequested = output<void>();
  readonly closePaneRequested = output<void>();
  readonly swapPanesRequested = output<void>();
  readonly detailsRequested = output<void>();
}
@Component({
  selector: 'ptah-canvas-lane-tabs',
  standalone: true,
  template: '<button role="tab" aria-selected="true">Orchestrator</button>',
})
class TabsStub {
  readonly panelId = input('canvas-lane-panel');
  readonly sessionId = input<string | null>(null);
  readonly laneKey = input('orchestrator');
  readonly laneSelected = output<string>();
}
@Component({
  selector: 'ptah-canvas-lane-view',
  standalone: true,
  template: '<div class="transcript">{{ tabId() }}:{{ laneKey() }}</div>',
})
class ViewStub implements OnDestroy {
  private readonly injector = inject(Injector);
  readonly tabId = input.required<string>();
  readonly panelId = input('canvas-lane-panel');
  readonly paneFocused = input(true);
  readonly splitDisplayed = input(false);
  readonly sessionId = input<string | null>(null);
  readonly laneKey = input('orchestrator');
  constructor() {
    effect(() => {
      const tab = snapshots().get(this.tabId());
      if (tab) this.injector.get(StreamPresentationStore).sync(tab);
    });
  }
  ngOnDestroy(): void {
    destroyed.push(this.tabId());
  }
}

describe('CanvasFocusAreaComponent', () => {
  beforeEach(() => {
    snapshots.set(new Map());
    buildTree.mockClear();
    TestBed.configureTestingModule({
      providers: [
        { provide: ExecutionTreeBuilderService, useValue: { buildTree } },
      ],
    });
  });
  function mountWithLanes() {
    const lanes = new Map([
      ['a', 'cli:agent-a'],
      ['b', 'orchestrator'],
    ]);
    const selectLaneFor = jest.fn((id: string, key: string) =>
      lanes.set(id, key),
    );
    const tabs = signal(
      new Map([
        [
          'a',
          {
            title: 'A',
            viewMode: 'full',
            claudeSessionId: null,
            agentOrigin: { branch: 'feature/a' },
            liveModelStats: { model: 'model-a' },
          },
        ],
        [
          'b',
          {
            title: 'B',
            viewMode: 'full',
            claudeSessionId: null,
            agentOrigin: { branch: 'feature/b' },
            liveModelStats: { model: 'model-b' },
          },
        ],
      ]),
    );
    TestBed.configureTestingModule({
      imports: [CanvasFocusAreaComponent],
      providers: [
        CanvasRenderMetricsService,
        { provide: CanvasStore, useValue: { isSessionRunning: () => false } },
        {
          provide: TabManagerService,
          useValue: {
            tabs: signal([]),
            findTabByIdAcrossWorkspaces: (id: string) => ({
              tab: tabs().get(id),
            }),
            toggleTabViewMode: jest.fn(),
          },
        },
        { provide: ChatStore, useValue: { abortWithConfirmation: jest.fn() } },
        {
          provide: CanvasDetailService,
          useValue: {
            laneKeyFor: (id: string) => lanes.get(id) ?? 'orchestrator',
            selectLaneFor,
          },
        },
      ],
    });
    TestBed.overrideComponent(CanvasFocusAreaComponent, {
      set: { imports: [HeaderStub, TabsStub, ViewStub] },
    });
    const fixture = TestBed.createComponent(CanvasFocusAreaComponent);
    fixture.componentRef.setInput('focusedTabId', 'a');
    fixture.detectChanges();
    return { fixture, lanes, tabs, selectLaneFor };
  }

  it('row 113: forwards pane activity, visual number and place to the header without remounting it', () => {
    const { fixture } = mountWithLanes();
    const header = () => fixture.debugElement.query(By.directive(HeaderStub)).componentInstance as HeaderStub;
    const first = header();
    expect([first.paneFocused(), first.paneNumber(), first.panePlace()]).toEqual([true, null, '']);
    fixture.componentRef.setInput('splitDisplayed', true);
    fixture.componentRef.setInput('paneFocused', false);
    fixture.componentRef.setInput('paneNumber', 2);
    fixture.componentRef.setInput('panePlace', 'Bottom');
    fixture.detectChanges();
    expect(header()).toBe(first);
    expect([first.splitDisplayed(), first.paneFocused(), first.paneNumber(), first.panePlace()]).toEqual([true, false, 2, 'Bottom']);
  });

  it('activates an inactive tab before stopping its session', async () => {
    const focus = jest.fn();
    const abort = jest.fn().mockResolvedValue(undefined);
    const area = Object.create(
      CanvasFocusAreaComponent.prototype,
    ) as CanvasFocusAreaComponent;
    Object.assign(area, {
      tabs: { activeTabId: () => 'other' },
      canvasStore: { focusTile: focus },
      chatStore: { abortWithConfirmation: abort },
    });
    await area.stop('selected');
    expect(focus).toHaveBeenCalledWith('selected');
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('keeps one transcript host and header instance across focus swaps', () => {
    destroyed.length = 0;
    const lanes = new Map([
      ['a', 'cli:agent-a'],
      ['b', 'orchestrator'],
    ]);
    TestBed.configureTestingModule({
      imports: [CanvasFocusAreaComponent],
      providers: [
        CanvasRenderMetricsService,
        { provide: CanvasStore, useValue: { isSessionRunning: () => false } },
        {
          provide: TabManagerService,
          useValue: {
            findTabByIdAcrossWorkspaces: (id: string) => ({
              tab: { title: id, viewMode: 'full', claudeSessionId: null },
            }),
          },
        },
        { provide: ChatStore, useValue: { abortWithConfirmation: jest.fn() } },
        {
          provide: CanvasDetailService,
          useValue: {
            laneKeyFor: (id: string) => lanes.get(id) ?? 'orchestrator',
            selectLaneFor: jest.fn(),
          },
        },
      ],
    });
    TestBed.overrideComponent(CanvasFocusAreaComponent, {
      set: { imports: [HeaderStub, TabsStub, ViewStub] },
    });
    const fixture = TestBed.createComponent(CanvasFocusAreaComponent);
    fixture.componentRef.setInput('focusedTabId', 'a');
    fixture.detectChanges();
    const header = fixture.nativeElement.querySelector('header');
    const view = fixture.debugElement.query(By.directive(ViewStub)).componentInstance;
    expect(
      fixture.nativeElement.querySelectorAll('ptah-canvas-lane-view'),
    ).toHaveLength(1);
    expect(
      fixture.nativeElement.querySelector('ptah-canvas-lane-view')?.textContent,
    ).toContain('a:cli:agent-a');
    fixture.componentRef.setInput('focusedTabId', 'b');
    fixture.detectChanges();
    expect(destroyed).toEqual([]);
    expect(fixture.debugElement.query(By.directive(ViewStub)).componentInstance).toBe(view);
    expect(fixture.nativeElement.querySelector('header')).toBe(header);
    expect(
      fixture.nativeElement.querySelectorAll('ptah-canvas-lane-view'),
    ).toHaveLength(1);
    fixture.componentRef.setInput('focusedTabId', 'a');
    fixture.detectChanges();
    expect(destroyed).toEqual([]);
    expect(
      fixture.nativeElement.querySelector('ptah-canvas-lane-view')?.textContent,
    ).toContain('a:cli:agent-a');
    const metrics = fixture.debugElement.injector
      .get(CanvasRenderMetricsService)
      .snapshot();
    expect(metrics.focusSwaps).toBe(2);
    expect(metrics.liveViewMounts).toBe(3);
  });

  it('passes a unique panel id and pane focus state to each lane view', () => {
    const { fixture } = mountWithLanes();
    fixture.componentRef.setInput('paneId', 'right');
    fixture.componentRef.setInput('paneFocused', false);
    fixture.componentRef.setInput('splitDisplayed', true);
    fixture.detectChanges();
    const tabs = fixture.debugElement.query(By.directive(TabsStub)).componentInstance;
    const view = fixture.debugElement.query(By.directive(ViewStub)).componentInstance;
    expect(tabs.panelId()).toBe('rail-right-lane-panel');
    expect(view.panelId()).toBe('rail-right-lane-panel');
    expect(view.paneFocused()).toBe(false);
    expect(view.splitDisplayed()).toBe(true);
    expect(fixture.nativeElement.querySelector('section').hasAttribute('aria-label')).toBe(false);
  });

  it.each(['left', 'right'] as const)(
    'forwards every header split action with the stable %s pane id and passes split state to the header',
    (paneId) => {
      const { fixture } = mountWithLanes();
      fixture.componentRef.setInput('paneId', paneId);
      fixture.componentRef.setInput('splitDisplayed', true);
      fixture.componentRef.setInput('detailsOpen', true);
      fixture.detectChanges();
      const area = fixture.componentInstance;
      const header = fixture.debugElement.query(By.directive(HeaderStub)).componentInstance as HeaderStub;
      expect(header.splitDisplayed()).toBe(true);
      expect(header.detailsOpen()).toBe(true);
      expect(area.panelId()).toBe(`rail-${paneId}-lane-panel`);
      const received: Array<[string, string]> = [];
      area.closeSplitRequested.subscribe((id) => received.push(['closeSplit', id]));
      area.closePaneRequested.subscribe((id) => received.push(['closePane', id]));
      area.swapPanesRequested.subscribe((id) => received.push(['swapPanes', id]));
      area.detailsRequested.subscribe((id) => received.push(['details', id]));
      area.closeRequested.subscribe((id) => received.push(['closeSession', id]));
      header.closeSplitRequested.emit();
      header.closePaneRequested.emit();
      header.swapPanesRequested.emit();
      header.detailsRequested.emit();
      expect(received).toEqual([
        ['closeSplit', paneId],
        ['closePane', paneId],
        ['swapPanes', paneId],
        ['details', paneId],
      ]);
      fixture.componentRef.setInput('focusedTabId', 'b');
      fixture.detectChanges();
      header.closePaneRequested.emit();
      expect(received.at(-1)).toEqual(['closePane', paneId]);
    },
  );

  it('passes the focused tab branch and live model into header chips', () => {
    const { fixture } = mountWithLanes();
    expect(
      fixture.nativeElement.querySelector('.branch-chip')?.textContent,
    ).toBe('feature/a');
    expect(
      fixture.nativeElement.querySelector('.model-chip')?.textContent,
    ).toBe('model-a');
  });

  it('processes one snapshot for the focused view and none for an unfocused tab', () => {
    const { fixture } = mountWithLanes();
    const snapshot = (id: string) =>
      ({
        id,
        claudeSessionId: `session-${id}`,
        status: 'streaming',
        messages: [],
        streamingState: { pendingStats: null } as StreamingState,
      }) as unknown as TabState;
    snapshots.set(
      new Map([
        ['a', snapshot('a')],
        ['b', snapshot('b')],
      ]),
    );
    fixture.detectChanges();
    expect(buildTree).toHaveBeenCalledTimes(1);
    expect(buildTree).toHaveBeenCalledWith(expect.anything(), 'tab-a');
    snapshots.set(
      new Map([
        ['a', snapshot('a')],
        ['b', snapshot('b')],
      ]),
    );
    fixture.detectChanges();
    expect(buildTree).toHaveBeenCalledTimes(2);
  });

  it('restores the lane selected for each tab after a focus swap', () => {
    const { fixture } = mountWithLanes();
    fixture.componentRef.setInput('focusedTabId', 'b');
    fixture.detectChanges();
    fixture.componentRef.setInput('focusedTabId', 'a');
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('ptah-canvas-lane-view')?.textContent,
    ).toContain('a:cli:agent-a');
  });

  it('falls back to Orchestrator when the selected lane is removed', () => {
    const { fixture, lanes, selectLaneFor } = mountWithLanes();
    lanes.delete('a');
    fixture.componentRef.setInput('focusedTabId', 'b');
    fixture.detectChanges();
    fixture.componentRef.setInput('focusedTabId', 'a');
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('ptah-canvas-lane-view')?.textContent,
    ).toContain('a:orchestrator');
    (
      fixture.debugElement.query(By.directive(TabsStub))
        .componentInstance as TabsStub
    ).laneSelected.emit('orchestrator');
    expect(selectLaneFor).toHaveBeenCalledWith('a', 'orchestrator');
  });
});
