/**
 * CanvasWorkspaceGridComponent — one-way projection and gesture translation.
 *
 * Gridstack is replaced by a hand-rolled stub faithful on the three points this
 * component depends on: `dragstop`/`resizestop` fire BEFORE `change`
 * (gridstack.js:2635 vs :2639), `batchUpdate(false)` itself emits `change`
 * (gridstack.js:730-739), and `engine.nodes` carries the full post-gesture node
 * set rather than only the dirty ones (gridstack.js:1686).
 */

import {
  Component,
  ChangeDetectionStrategy,
  EventEmitter,
  Input,
  Output,
  NgModule,
} from '@angular/core';

jest.mock('ngx-markdown', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'markdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<div>{{ data }}</div>`,
  })
  class MarkdownStub {
    @Input() data: string | null | undefined = '';
  }
  @NgModule({ imports: [MarkdownStub], exports: [MarkdownStub] })
  class MarkdownModule {}
  return {
    MarkdownModule,
    MarkdownComponent: MarkdownStub,
    provideMarkdown: () => [],
    MARKED_OPTIONS: 'MARKED_OPTIONS',
    CLIPBOARD_OPTIONS: 'CLIPBOARD_OPTIONS',
    MARKED_EXTENSIONS: 'MARKED_EXTENSIONS',
    MERMAID_OPTIONS: 'MERMAID_OPTIONS',
    SANITIZE: 'SANITIZE',
  };
});
jest.mock('gridstack/dist/angular', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'gridstack',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: '<ng-content />',
  })
  class GridstackStub {
    @Input() options: unknown = null;
    @Output() changeCB = new EventEmitter<unknown>();
    @Output() dragStopCB = new EventEmitter<unknown>();
    @Output() resizeStopCB = new EventEmitter<unknown>();
    grid: unknown = null;
  }
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'gridstack-item',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: '<ng-content />',
  })
  class GridstackItemStub {
    @Input() options: unknown = null;
  }
  return {
    GridstackComponent: GridstackStub,
    GridstackItemComponent: GridstackItemStub,
  };
});
jest.mock('gridstack', () => ({ GridStack: class {} }));

import { TestBed } from '@angular/core/testing';
import { ApplicationRef, signal } from '@angular/core';
import { By } from '@angular/platform-browser';

import { CanvasWorkspaceGridComponent } from './canvas-workspace-grid.component';
import { CanvasTileComponent } from './canvas-tile.component';
import { CanvasStore } from './canvas.store';
import { CanvasLayoutService } from './canvas-layout.service';
import { TabManagerService } from '@ptah-extension/chat';

const WORKSPACE = '/ws/a';
/** Container width that derives 3 columns (3 * (480 + 8) - 8). */
const THREE_COLUMN_WIDTH = 1464;
/** Container width that derives 2 columns — the reported editor-open case. */
const TWO_COLUMN_WIDTH = 1180;

interface FakeNode {
  id?: unknown;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  el?: HTMLElement;
}

interface FakeGrid {
  readonly engine: { nodes: FakeNode[] };
  readonly cellHeight: jest.Mock;
  readonly setStatic: jest.Mock;
  readonly onResize: jest.Mock;
  readonly update: jest.Mock;
  readonly batchUpdate: jest.Mock;
  /** Wired by the test to fire the component's `(changeCB)` binding. */
  emitChange: () => void;
  seed(nodes: Array<Omit<FakeNode, 'el'>>): void;
}

/**
 * Stand-in for the GridStack instance. `batchUpdate(false)` emits `change`
 * exactly as the real engine does, which is what makes the feedback-loop test
 * meaningful.
 *
 * Built by a factory rather than a class: `jest.fn()` in a class property
 * initializer defeats ts-jest's `jest.mock` hoisting, which silently leaves the
 * real (ESM) gridstack module loading.
 */
function createFakeGrid(): FakeGrid {
  const engine = { nodes: [] as FakeNode[] };
  const grid: FakeGrid = {
    engine,
    cellHeight: jest.fn(),
    setStatic: jest.fn(),
    onResize: jest.fn(),
    update: jest.fn(
      (
        el: HTMLElement,
        opts: { x: number; y: number; w: number; h: number },
      ) => {
        const node = engine.nodes.find((n) => n.el === el);
        if (node) Object.assign(node, opts);
      },
    ),
    batchUpdate: jest.fn((flag: boolean) => {
      if (flag === false) grid.emitChange();
    }),
    emitChange: () => {
      /* no-op until wired */
    },
    seed(nodes) {
      engine.nodes.length = 0;
      for (const node of nodes) {
        engine.nodes.push({ ...node, el: document.createElement('div') });
      }
    },
  };
  return grid;
}

type ObserverCallback = (entries: ResizeObserverEntry[]) => void;

describe('CanvasWorkspaceGridComponent', () => {
  let capturedObserver: ObserverCallback | null;
  let originalResizeObserver: typeof ResizeObserver | undefined;
  let originalRaf: typeof requestAnimationFrame;
  let originalCancelRaf: typeof cancelAnimationFrame;

  let store: CanvasStore;
  let layoutService: CanvasLayoutService;
  let reorderSpy: jest.SpyInstance;
  let weightsSpy: jest.SpyInstance;
  let fixture: ReturnType<
    typeof TestBed.createComponent<CanvasWorkspaceGridComponent>
  >;
  let grid: FakeGrid;

  const flush = (): void => {
    TestBed.inject(ApplicationRef).tick();
    fixture.detectChanges();
  };

  const measure = (width: number, height = 900): void => {
    capturedObserver?.([
      { contentRect: { width, height } } as unknown as ResizeObserverEntry,
    ]);
  };

  /** The mocked `<gridstack>` instance, addressed by selector so the spec never
   *  imports the (ESM-only, `.d.ts`-fronted) real `gridstack/dist/angular`. */
  const gridStub = (): {
    grid: unknown;
    options: unknown;
    changeCB: EventEmitter<unknown>;
    dragStopCB: EventEmitter<unknown>;
    resizeStopCB: EventEmitter<unknown>;
  } => fixture.debugElement.query(By.css('gridstack')).componentInstance;

  beforeEach(() => {
    capturedObserver = null;
    originalResizeObserver = globalThis.ResizeObserver;
    originalRaf = globalThis.requestAnimationFrame;
    originalCancelRaf = globalThis.cancelAnimationFrame;

    globalThis.ResizeObserver = class {
      constructor(cb: ObserverCallback) {
        capturedObserver = cb;
      }
      observe(): void {
        /* no-op */
      }
      unobserve(): void {
        /* no-op */
      }
      disconnect(): void {
        /* no-op */
      }
    } as unknown as typeof ResizeObserver;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => {
      /* no-op */
    }) as typeof cancelAnimationFrame;

    const tabManagerMock = {
      tabs: signal([]),
      activeTabId: signal<string | null>(null),
      activeWorkspacePath$: signal<string | null>(WORKSPACE),
      switchTab: jest.fn(),
      createTab: jest.fn(),
      openSessionTab: jest.fn(),
      closeTab: jest.fn().mockResolvedValue(undefined),
      forceCloseTab: jest.fn(),
    } as unknown as TabManagerService;

    TestBed.configureTestingModule({
      imports: [CanvasWorkspaceGridComponent],
      providers: [
        CanvasStore,
        CanvasLayoutService,
        { provide: TabManagerService, useValue: tabManagerMock },
      ],
    });
    TestBed.overrideComponent(CanvasWorkspaceGridComponent, {
      remove: { imports: [CanvasTileComponent] },
      add: { imports: [CanvasTileStub] },
    });

    store = TestBed.inject(CanvasStore);
    layoutService = TestBed.inject(CanvasLayoutService);
    layoutService.observe(document.createElement('div'));
    reorderSpy = jest.spyOn(store, 'reorderTiles');
    weightsSpy = jest.spyOn(store, 'setTileWeights');
  });

  afterEach(() => {
    globalThis.ResizeObserver =
      originalResizeObserver as typeof globalThis.ResizeObserver;
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancelRaf;
  });

  /** Mount with `tabIds` tiled, the fake grid attached and one apply pass done. */
  function mount(
    tabIds: readonly string[],
    options: { locked?: boolean; width?: number } = {},
  ): void {
    store.switchWorkspaceTiles(
      WORKSPACE,
      tabIds.map((id) => ({ id, claudeSessionId: null, name: id })),
    );

    fixture = TestBed.createComponent(CanvasWorkspaceGridComponent);
    fixture.componentRef.setInput('workspacePath', WORKSPACE);
    fixture.componentRef.setInput('visible', true);
    // Always mount unlocked: the lock effect reads the grid instance, which the
    // fake only supplies below. Locking after the grid is attached mirrors the
    // real order (the user toggles the button on a live grid).
    fixture.componentRef.setInput('locked', false);
    fixture.detectChanges();

    grid = createFakeGrid();
    grid.seed(tabIds.map((id, i) => ({ id, x: i * 4, y: 0, w: 4, h: 6 })));
    gridStub().grid = grid;
    grid.emitChange = () =>
      gridStub().changeCB.emit({ event: new Event('change'), nodes: [] });

    measure(options.width ?? THREE_COLUMN_WIDTH);
    flush();

    if (options.locked) {
      fixture.componentRef.setInput('locked', true);
      flush();
    }
  }

  const fireDragStop = (): void =>
    gridStub().dragStopCB.emit({ event: new Event('dragstop') });

  const fireResizeStop = (): void =>
    gridStub().resizeStopCB.emit({ event: new Event('resizestop') });

  describe('grid options', () => {
    it('runs with gravity on, horizontal-only resize and a header drag handle', () => {
      mount(['t1']);

      const options = fixture.componentInstance.gsOptions;
      expect(options.float).toBe(false);
      expect(options.column).toBe(12);
      expect(options.margin).toBe(8);
      expect(options.animate).toBe(true);
      expect(options.resizable).toEqual({ handles: 'e, w' });
      expect(options.draggable).toEqual({ handle: '.tile-header' });
    });
  });

  describe('projection', () => {
    it('writes derived geometry keyed by tabId into the grid', () => {
      mount(['t1', 't2', 't3']);

      expect(grid.cellHeight).toHaveBeenCalled();
      const applied = grid.engine.nodes.map((n) => [n.id, n.x, n.y, n.w]);
      expect(applied).toEqual([
        ['t1', 0, 0, 4],
        ['t2', 4, 0, 4],
        ['t3', 8, 0, 4],
      ]);
    });

    it('skips a node whose tabId has no derived entry instead of zeroing it', () => {
      mount(['t1']);
      grid.update.mockClear();

      grid.engine.nodes.push({
        id: 'ghost',
        x: 9,
        y: 9,
        w: 3,
        h: 6,
        el: document.createElement('div'),
      });
      measure(TWO_COLUMN_WIDTH);
      flush();

      const ghost = grid.engine.nodes.find((n) => n.id === 'ghost');
      expect(ghost).toEqual(expect.objectContaining({ x: 9, y: 9, w: 3 }));
    });
  });

  describe('gesture translation', () => {
    it('a finished drag reorders by (y, x) and never touches weights', () => {
      mount(['t1', 't2', 't3']);
      reorderSpy.mockClear();
      weightsSpy.mockClear();

      // Post-push engine state: t3 dragged to the front, the rest shifted right.
      grid.engine.nodes[0].x = 4;
      grid.engine.nodes[1].x = 8;
      grid.engine.nodes[2].x = 0;

      fireDragStop();
      grid.emitChange();

      expect(reorderSpy).toHaveBeenCalledWith(['t3', 't1', 't2']);
      expect(weightsSpy).not.toHaveBeenCalled();
      expect(store.tiles().map((t) => t.tabId)).toEqual(['t3', 't1', 't2']);
    });

    it('sorts a multi-row drag by row first', () => {
      mount(['t1', 't2', 't3']);
      reorderSpy.mockClear();

      grid.engine.nodes[0].y = 6;
      grid.engine.nodes[0].x = 0;
      grid.engine.nodes[1].y = 0;
      grid.engine.nodes[1].x = 6;
      grid.engine.nodes[2].y = 0;
      grid.engine.nodes[2].x = 0;

      fireDragStop();
      grid.emitChange();

      expect(reorderSpy).toHaveBeenCalledWith(['t3', 't2', 't1']);
    });

    it('a finished resize writes widths as weights and never touches order', () => {
      mount(['t1', 't2', 't3']);
      reorderSpy.mockClear();
      weightsSpy.mockClear();

      grid.engine.nodes[0].w = 5;
      grid.engine.nodes[1].w = 4;
      grid.engine.nodes[2].w = 3;

      fireResizeStop();
      grid.emitChange();

      expect(weightsSpy).toHaveBeenCalledWith(
        new Map([
          ['t1', 5],
          ['t2', 4],
          ['t3', 3],
        ]),
      );
      expect(reorderSpy).not.toHaveBeenCalled();
      expect(store.tiles().map((t) => t.weight)).toEqual([5, 4, 3]);
    });

    it('re-derives the resized widths unchanged — no snap-back', () => {
      mount(['t1', 't2', 't3']);

      grid.engine.nodes[0].w = 5;
      grid.engine.nodes[1].w = 4;
      grid.engine.nodes[2].w = 3;
      fireResizeStop();
      grid.emitChange();
      flush();

      expect(grid.engine.nodes.map((n) => [n.id, n.x, n.w])).toEqual([
        ['t1', 0, 5],
        ['t2', 5, 4],
        ['t3', 9, 3],
      ]);
    });

    it('ignores a change with no latched gesture', () => {
      mount(['t1', 't2']);
      reorderSpy.mockClear();
      weightsSpy.mockClear();

      grid.emitChange();

      expect(reorderSpy).not.toHaveBeenCalled();
      expect(weightsSpy).not.toHaveBeenCalled();
    });

    it('does not reuse a latch across two changes', () => {
      mount(['t1', 't2']);
      fireDragStop();
      grid.emitChange();
      reorderSpy.mockClear();

      grid.emitChange();

      expect(reorderSpy).not.toHaveBeenCalled();
    });

    it('skips nodes with a non-string id', () => {
      mount(['t1', 't2']);
      reorderSpy.mockClear();
      grid.engine.nodes.push({
        id: 42,
        x: 8,
        y: 0,
        w: 4,
        h: 6,
        el: document.createElement('div'),
      });

      fireDragStop();
      grid.emitChange();

      expect(reorderSpy).toHaveBeenCalledWith(['t1', 't2']);
    });
  });

  describe('manual intent survives a container resize', () => {
    it('keeps order and weight byte-identical while columns change', () => {
      mount(['t1', 't2', 't3'], { width: THREE_COLUMN_WIDTH });

      grid.engine.nodes[0].w = 6;
      grid.engine.nodes[1].w = 4;
      grid.engine.nodes[2].w = 2;
      fireResizeStop();
      grid.emitChange();
      fireDragStop();
      grid.engine.nodes[2].x = 0;
      grid.engine.nodes[0].x = 2;
      grid.engine.nodes[1].x = 8;
      grid.emitChange();
      flush();

      const before = store.tiles().map((t) => ({ ...t }));
      expect(before.map((t) => t.tabId)).toEqual(['t3', 't1', 't2']);

      measure(TWO_COLUMN_WIDTH);
      flush();

      expect(store.tiles().map((t) => ({ ...t }))).toEqual(before);
      // Two columns now: the first row holds t3 and t1, t2 wraps below.
      expect(grid.engine.nodes.map((n) => [n.id, n.y])).toEqual([
        ['t1', 0],
        ['t2', 6],
        ['t3', 0],
      ]);
    });
  });

  describe('lock', () => {
    it('sets the grid static and writes nothing on resize or gesture', () => {
      mount(['t1', 't2', 't3'], { locked: true });

      expect(grid.setStatic).toHaveBeenCalledWith(true);
      grid.update.mockClear();
      reorderSpy.mockClear();
      weightsSpy.mockClear();

      measure(TWO_COLUMN_WIDTH);
      flush();
      expect(grid.update).not.toHaveBeenCalled();

      fireDragStop();
      grid.emitChange();
      fireResizeStop();
      grid.emitChange();

      expect(reorderSpy).not.toHaveBeenCalled();
      expect(weightsSpy).not.toHaveBeenCalled();
    });
  });

  describe('feedback loop', () => {
    it('drops the change its own apply pass provokes', () => {
      mount(['t1', 't2', 't3']);
      // batchUpdate(false) fired changeCB during the apply above.
      expect(grid.batchUpdate).toHaveBeenCalledWith(false);
      expect(reorderSpy).not.toHaveBeenCalled();
      expect(weightsSpy).not.toHaveBeenCalled();
    });

    it('settles a single gesture after exactly one apply pass', () => {
      mount(['t1', 't2', 't3']);
      grid.batchUpdate.mockClear();

      grid.engine.nodes[0].w = 6;
      grid.engine.nodes[1].w = 4;
      grid.engine.nodes[2].w = 2;
      fireResizeStop();
      grid.emitChange();
      flush();
      flush();

      const applies = grid.batchUpdate.mock.calls.filter(
        ([flag]) => flag === true,
      );
      expect(applies).toHaveLength(1);
    });

    it('drops the change the visibility re-measure provokes', () => {
      mount(['t1', 't2']);
      fixture.componentRef.setInput('visible', false);
      flush();
      reorderSpy.mockClear();
      weightsSpy.mockClear();

      grid.onResize.mockImplementation(() => grid.emitChange());
      fixture.componentRef.setInput('visible', true);
      flush();

      expect(grid.onResize).toHaveBeenCalled();
      expect(reorderSpy).not.toHaveBeenCalled();
      expect(weightsSpy).not.toHaveBeenCalled();
    });
  });
});

/**
 * Stand-in for the real chat tile: same selector and same input/output surface,
 * so the component's own template is exercised unchanged while the chat stack
 * stays out of the fixture. Swapped in with `remove`/`add` rather than `set`,
 * which would replace the template this spec is here to test.
 */
@Component({
  selector: 'ptah-canvas-tile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class CanvasTileStub {
  @Input() tabId = '';
  @Input() focused = false;
  @Input() visible = true;
  @Output() focusRequested = new EventEmitter<string>();
  @Output() closeRequested = new EventEmitter<string>();
}
