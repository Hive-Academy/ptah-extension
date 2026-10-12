import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideSurfaceActiveTesting } from '@ptah-extension/core/testing';

jest.mock('ngx-markdown', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'markdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: '',
  })
  class MarkdownStub {
    @Input() data = '';
  }
  return {
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
    @Input() options: unknown;
    @Output() changeCB = new EventEmitter<unknown>();
    @Output() dragStartCB = new EventEmitter<unknown>();
    @Output() dragCB = new EventEmitter<unknown>();
    @Output() dragStopCB = new EventEmitter<unknown>();
    @Output() resizeStartCB = new EventEmitter<unknown>();
    @Output() resizeStopCB = new EventEmitter<unknown>();
    grid: unknown;
  }
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'gridstack-item',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: '<ng-content />',
  })
  class GridstackItemStub {
    @Input() options: unknown;
  }
  return {
    GridstackComponent: GridstackStub,
    GridstackItemComponent: GridstackItemStub,
  };
});
jest.mock('gridstack', () => ({ GridStack: class {} }));

import { CanvasWorkspaceGridComponent } from './canvas-workspace-grid.component';
import { CanvasTileComponent } from './canvas-tile.component';
import { CanvasStore } from './canvas.store';
import { CanvasLayoutService } from './canvas-layout.service';
import { CanvasRenderMetricsService } from './canvas-render-metrics.service';
import { CanvasLayoutPersistenceService } from './canvas-layout-persistence.service';
import { TabManagerService } from '@ptah-extension/chat';

@Component({
  selector: 'ptah-canvas-tile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class TileStub {
  @Input() tabId = '';
  @Input() focused = false;
  @Input() autoCard = false;
  @Input() visible = true;
  @Input() widthIntent: unknown;
  @Input() rowBreakBefore = false;
  @Input() firstInOrder = false;
  @Input() layoutFocused = false;
  @Input() layoutLocked = false;
  @Output() focusRequested = new EventEmitter<string>();
  @Output() closeRequested = new EventEmitter<string>();
  @Output() spanRequested = new EventEmitter<string>();
  @Output() layoutFocusToggled = new EventEmitter<void>();
  @Output() rowBreakToggled = new EventEmitter<void>();
}

interface NodeGeometry {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  maxH?: number;
  el: HTMLElement;
}

describe('CanvasWorkspaceGridComponent detail row', () => {
  it('keeps every engine node while opening, applying and closing the overlay', () => {
    let measure: ((entries: ResizeObserverEntry[]) => void) | undefined;
    const originalObserver = globalThis.ResizeObserver;
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancelRaf = globalThis.cancelAnimationFrame;
    globalThis.ResizeObserver = class {
      constructor(callback: (entries: ResizeObserverEntry[]) => void) {
        measure = callback;
      }
      observe(): void {
        /* measured explicitly */
      }
      unobserve(): void {
        /* measured explicitly */
      }
      disconnect(): void {
        /* no resources */
      }
    } as unknown as typeof ResizeObserver;
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() =>
      undefined) as typeof cancelAnimationFrame;

    try {
      const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
      TestBed.configureTestingModule({
        imports: [CanvasWorkspaceGridComponent],
        providers: [
          CanvasStore,
          CanvasLayoutService,
          CanvasRenderMetricsService,
          provideSurfaceActiveTesting(signal(true)),
          {
            provide: CanvasLayoutPersistenceService,
            useValue: {
              load: () => ({ tiles: null, writable: true, needsWrite: false }),
              markHydrated: jest.fn(),
              schedule: jest.fn(),
              remove: jest.fn(),
            },
          },
          {
            provide: TabManagerService,
            useValue: {
              tabs: signal(ids.map((id) => ({ id }))),
              activeTabId: signal<string | null>(null),
              activeWorkspacePath$: signal<string | null>('/ws/a'),
              onTabClosed: jest.fn(() => () => undefined),
              getWorkspaceTabs: jest.fn(() => []),
            },
          },
        ],
      });
      TestBed.overrideComponent(CanvasWorkspaceGridComponent, {
        remove: { imports: [CanvasTileComponent] },
        add: { imports: [TileStub] },
      });
      const store = TestBed.inject(CanvasStore);
      const layout = TestBed.inject(CanvasLayoutService);
      layout.observe(document.createElement('div'));
      store.switchWorkspaceTiles(
        '/ws/a',
        ids.map((id) => ({ id, claudeSessionId: null, name: id })),
      );
      const fixture = TestBed.createComponent(CanvasWorkspaceGridComponent);
      fixture.componentRef.setInput('workspacePath', '/ws/a');
      fixture.componentRef.setInput('visible', true);
      fixture.componentRef.setInput('locked', false);
      fixture.detectChanges();

      const gridStub = fixture.debugElement.query(By.css('gridstack'))
        .componentInstance as {
        grid: unknown;
        changeCB: EventEmitter<unknown>;
      };
      const nodes: NodeGeometry[] = ids.map((id, i) => ({
        id,
        x: i * 4,
        y: 0,
        w: 4,
        h: 6,
        el: document.createElement('div'),
      }));
      const grid = {
        engine: { nodes },
        cellHeight: jest.fn(),
        getCellHeight: jest.fn(() => 120),
        setStatic: jest.fn(),
        onResize: jest.fn(),
        movable: jest.fn(),
        resizable: jest.fn(),
        load: jest.fn((items: NodeGeometry[]) => {
          for (const item of items)
            Object.assign(
              nodes.find((node) => node.id === item.id)!,
              item,
            );
          gridStub.changeCB.emit({ event: new Event('change'), nodes: [] });
        }),
      };
      for (const node of nodes)
        (
          node.el as HTMLElement & { gridstackNode?: NodeGeometry }
        ).gridstackNode = node;
      gridStub.grid = grid;
      const flush = () => {
        TestBed.inject(ApplicationRef).tick();
        fixture.detectChanges();
      };
      const resize = (width: number) => {
        measure?.([
          { contentRect: { width, height: 900 } } as ResizeObserverEntry,
        ]);
        flush();
      };
      const geometry = () =>
        nodes.map(({ id, x, y, w, h }) => ({ id, x, y, w, h }));
      resize(1180);

      // 1. Two columns and three rows, with all engine geometry captured.
      expect(
        fixture.nativeElement.querySelectorAll('gridstack-item'),
      ).toHaveLength(6);
      const before = geometry();
      expect(before).toHaveLength(6);
      expect(new Set(before.map((node) => node.y)).size).toBe(3);

      // 2-3. Opening the detail locks the grid but adds no engine node.
      fixture.componentRef.setInput('detailTabId', 'c');
      fixture.componentRef.setInput('locked', true);
      flush();
      const assertOverlay = () => {
        expect(geometry()).toEqual(before);
        const host = fixture.nativeElement.querySelector(
          '.ptah-detail-slot',
        ) as HTMLElement;
        expect(host).not.toBeNull();
        expect(host.parentElement).toBe(fixture.nativeElement);
        expect(host.previousElementSibling?.tagName.toLowerCase()).toBe(
          'gridstack',
        );
        const tiles = fixture.nativeElement.querySelectorAll('gridstack-item');
        before.forEach((node, index) => {
          expect(tiles[index].classList.contains('ptah-below-detail')).toBe(
            node.y >= 12,
          );
        });
      };
      assertOverlay();

      // 4. Width changes while locked; a forced authoritative pass keeps the overlay.
      resize(1181);
      (
        fixture.componentInstance as unknown as {
          applyAuthoritativeGeometry: (force: boolean) => void;
        }
      ).applyAuthoritativeGeometry(true);
      flush();
      assertOverlay();

      // 5. Closing removes the host and every displacement class.
      fixture.componentRef.setInput('detailTabId', null);
      flush();
      expect(
        fixture.nativeElement.querySelector('.ptah-detail-slot'),
      ).toBeNull();
      expect(
        fixture.nativeElement.querySelector('.ptah-below-detail'),
      ).toBeNull();
      expect(geometry()).toEqual(before);
    } finally {
      globalThis.ResizeObserver = originalObserver;
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCancelRaf;
    }
  });
});
