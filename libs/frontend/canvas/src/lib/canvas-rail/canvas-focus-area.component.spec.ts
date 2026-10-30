import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  StreamPresentationStore,
} from '@ptah-extension/chat';
import { ExecutionTreeBuilderService } from '@ptah-extension/chat-streaming';
import type { StreamingState, TabState } from '@ptah-extension/chat-types';
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
    '<div role="group" aria-label="Pane controls"></div>',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class HeaderStub {
  readonly closeSplitRequested = output<void>();
  readonly closePaneRequested = output<void>();
  readonly swapPanesRequested = output<void>();
}
@Component({
  selector: 'ptah-canvas-lane-tabs',
  standalone: true,
  template: '<button role="tab" aria-selected="true">Orchestrator</button>',
})
class TabsStub {
  readonly panelId = input('canvas-lane-panel');
  readonly tabId = input<string | null>(null);
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
        {
          provide: TabManagerService,
          useValue: {
            tabs: signal([]),
            findTabByIdAcrossWorkspaces: (id: string) => ({
              tab: tabs().get(id),
            }),
          },
        },
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

  it.each([false, true])('shows the agent dock above the chat, no identity row (split=%s)', split => {
    const { fixture, selectLaneFor } = mountWithLanes();
    fixture.componentRef.setInput('splitDisplayed', split);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('header')).toBeNull();
    const dock = fixture.debugElement.queryAll(By.directive(TabsStub));
    expect(dock).toHaveLength(1);
    const stub = dock[0].componentInstance as TabsStub;
    expect(stub.tabId()).toBe('a');
    stub.laneSelected.emit('cli:1');
    expect(selectLaneFor).toHaveBeenCalledWith('a', 'cli:1');
    expect(fixture.debugElement.queryAll(By.directive(HeaderStub))).toHaveLength(split ? 1 : 0);
    expect(fixture.nativeElement.textContent).not.toContain('feature/a');
  });

  it('sets the common chat and lane width to 1100px', () => {
    expect(
      readFileSync(join(__dirname, 'canvas-focus-area.component.ts'), 'utf8'),
    ).toMatch(/:host\s*\{\s*--chat-content-max-width: 1100px;/);
  });

  it('row 113: keeps the split header instance when pane activity changes', () => {
    const { fixture } = mountWithLanes();
    fixture.componentRef.setInput('splitDisplayed', true);
    fixture.detectChanges();
    const header = () =>
      fixture.debugElement.query(By.directive(HeaderStub))
        .componentInstance as HeaderStub;
    const first = header();
    fixture.componentRef.setInput('paneFocused', false);
    fixture.detectChanges();
    expect(header()).toBe(first);
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
        {
          provide: TabManagerService,
          useValue: {
            findTabByIdAcrossWorkspaces: (id: string) => ({
              tab: { title: id, viewMode: 'full', claudeSessionId: null },
            }),
          },
        },
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
    const view = fixture.debugElement.query(
      By.directive(ViewStub),
    ).componentInstance;
    expect(
      fixture.nativeElement.querySelectorAll('ptah-canvas-lane-view'),
    ).toHaveLength(1);
    expect(
      fixture.nativeElement.querySelector('ptah-canvas-lane-view')?.textContent,
    ).toContain('a:cli:agent-a');
    fixture.componentRef.setInput('focusedTabId', 'b');
    fixture.detectChanges();
    expect(destroyed).toEqual([]);
    expect(
      fixture.debugElement.query(By.directive(ViewStub)).componentInstance,
    ).toBe(view);
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
    const view = fixture.debugElement.query(
      By.directive(ViewStub),
    ).componentInstance;
    expect(view.panelId()).toBe('rail-right-lane-panel');
    expect(view.paneFocused()).toBe(false);
    expect(view.splitDisplayed()).toBe(true);
    expect(
      fixture.nativeElement.querySelector('section').hasAttribute('aria-label'),
    ).toBe(false);
  });

  it.each(['left', 'right'] as const)(
    'forwards every pane action with the stable %s pane id',
    (paneId) => {
      const { fixture } = mountWithLanes();
      fixture.componentRef.setInput('paneId', paneId);
      fixture.componentRef.setInput('splitDisplayed', true);
      fixture.detectChanges();
      const area = fixture.componentInstance;
      const header = fixture.debugElement.query(By.directive(HeaderStub))
        .componentInstance as HeaderStub;
      expect(area.panelId()).toBe(`rail-${paneId}-lane-panel`);
      const received: Array<[string, string]> = [];
      area.closeSplitRequested.subscribe((id) =>
        received.push(['closeSplit', id]),
      );
      area.closePaneRequested.subscribe((id) =>
        received.push(['closePane', id]),
      );
      area.swapPanesRequested.subscribe((id) =>
        received.push(['swapPanes', id]),
      );
      header.closeSplitRequested.emit();
      header.closePaneRequested.emit();
      header.swapPanesRequested.emit();
      expect(received).toEqual([
        ['closeSplit', paneId],
        ['closePane', paneId],
        ['swapPanes', paneId],
      ]);
      fixture.componentRef.setInput('focusedTabId', 'b');
      fixture.detectChanges();
      header.closePaneRequested.emit();
      expect(received.at(-1)).toEqual(['closePane', paneId]);
    },
  );

  it('keeps the focused tab branch out of chat', () => {
    const { fixture } = mountWithLanes();
    expect(
      fixture.nativeElement.querySelector('.branch-chip')?.textContent,
    ).toBeUndefined();
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
    expect(selectLaneFor).not.toHaveBeenCalled();
  });
});
