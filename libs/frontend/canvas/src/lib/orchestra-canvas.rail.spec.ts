import { ChangeDetectionStrategy, Component, Input, NgModule, OnDestroy } from '@angular/core';
jest.mock('ngx-markdown', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'markdown', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
    template: '<div>{{ data }}</div>' })
  class MarkdownStub { @Input() data = ''; }
  @NgModule({ imports: [MarkdownStub], exports: [MarkdownStub] })
  class MarkdownModule {}
  return { MarkdownModule, MarkdownComponent: MarkdownStub, provideMarkdown: () => [],
    MARKED_OPTIONS: 'MARKED_OPTIONS', CLIPBOARD_OPTIONS: 'CLIPBOARD_OPTIONS',
    MARKED_EXTENSIONS: 'MARKED_EXTENSIONS', MERMAID_OPTIONS: 'MERMAID_OPTIONS', SANITIZE: 'SANITIZE' };
});
jest.mock('gridstack/dist/angular', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'gridstack', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
    template: '<ng-content />' })
  class GridstackStub { grid: unknown = null; }
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'gridstack-item', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
    template: '<ng-content />' })
  class GridstackItemStub {}
  return { GridstackComponent: GridstackStub, GridstackItemComponent: GridstackItemStub, nodesCB: undefined };
});
jest.mock('gridstack', () => ({ GridStack: class {} }));
import { input, signal, computed } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { AppStateManager, BackOfficeActivityService } from '@ptah-extension/core';
import { ChatStore, TabManagerService } from '@ptah-extension/chat';
import type { OrchestraCanvasComponent as OrchestraCanvasType } from './orchestra-canvas.component';
import { CanvasStore } from './canvas.store';
import { CanvasLayoutService } from './canvas-layout.service';
import { CanvasLayoutPersistenceService } from './canvas-layout-persistence.service';
import { CanvasDetailService } from './canvas-detail/canvas-detail.service';
import { CanvasBoardToggleComponent } from './canvas-board-toggle.component';
import { CanvasLayoutControlsComponent } from './canvas-layout-controls.component';
import { CanvasRailComponent } from './canvas-rail/canvas-rail.component';
import { RUNNING_CAP_MESSAGE } from './canvas-running-cap';
const { OrchestraCanvasComponent } = require('./orchestra-canvas.component') as {
  OrchestraCanvasComponent: typeof OrchestraCanvasType;
};

const savedDraft = signal('');
const canStart = signal(true);
@Component({ selector: 'ptah-canvas-rail-board', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CanvasRailComponent],
  template: '@if (visible()) { <ptah-canvas-rail [canStart]="canStart()" /> <div class="rail-draft"><input aria-label="Rail draft" [value]="draft()" (input)="onInput($event)" /></div> }' })
class RailStub implements OnDestroy {
  readonly workspacePath = input.required<string>();
  readonly visible = input.required<boolean>();
  readonly draft = signal(savedDraft());
  readonly canStart = canStart;
  onInput(event: Event): void { if (event.target instanceof HTMLInputElement) this.draft.set(event.target.value); }
  ngOnDestroy(): void { savedDraft.set(this.draft()); }
}
@Component({ selector: 'ptah-canvas-workspace-grid', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />' })
class GridStub {
  readonly workspacePath = input.required<string>();
  readonly visible = input.required<boolean>();
  readonly locked = input.required<boolean>();
  readonly detailTabId = input<string | null>(null);
}
@Component({ selector: 'ptah-canvas-empty-state', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: '' })
class EmptyStub {}
@Component({ selector: 'ptah-canvas-needs-you-queue', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: '' })
class QueueStub {}
@Component({ selector: 'ptah-canvas-detail-panel', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: '' })
class DetailStub { readonly tabId = input.required<string>(); }
@Component({ selector: 'ptah-native-popover', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />' })
class PopoverStub {
  readonly isOpen = input(false);
  readonly placement = input('');
  readonly hasBackdrop = input(false);
  readonly backdropClass = input('');
}

describe('OrchestraCanvasComponent Rail integration', () => {
  const board = signal<'rail' | 'grid'>('rail');
  const path = signal<string | null>('/a');
  const paths = signal<readonly string[]>(['/a']);
  const tiles = signal([{ tabId: 'a', order: 0, width: { kind: 'auto' as const, weight: 1 }, rowBreakBefore: false }]);
  const detailId = signal<string | null>(null);
  const writeFailed = signal(false);
  const readOnlyPaths = signal(new Set<string>());
  const modes = new Map<string, 'rail' | 'grid'>();
  const setBoardMode = jest.fn((workspace: string, mode: 'rail' | 'grid') => {
    modes.set(workspace, mode);
    if (workspace === path()) board.set(mode);
  });
  const close = jest.fn(() => detailId.set(null));
  const stop = jest.fn();
  const reload = jest.fn();
  const store = {
    tiles, activeWorkspacePath: path, workspacePaths: paths,
    activeBoard: computed(() => ({ mode: board() })),
    boardFor: (workspace: string) => ({ mode: modes.get(workspace) ?? 'rail' }),
    setBoardMode, canAddTile: signal(false), canStartRunningSession: signal(true),
    hydrateWorkspace: jest.fn(), switchWorkspaceTiles: jest.fn(), removeWorkspaceTileState: jest.fn(),
    removeTileOnly: jest.fn(), removeTileFromAnyWorkspace: jest.fn(),
  };
  const persistence = { writeFailed, readOnlyPaths, flush: jest.fn() };
  const detail = { detailTabId: detailId, close, next: jest.fn(), prev: jest.fn() };
  let fixture: ReturnType<typeof TestBed.createComponent<OrchestraCanvasType>>;

  beforeEach(() => {
    board.set('rail'); path.set('/a'); paths.set(['/a']); modes.clear(); savedDraft.set('');
    tiles.set([{ tabId: 'a', order: 0, width: { kind: 'auto', weight: 1 }, rowBreakBefore: false }]);
    detailId.set(null); writeFailed.set(false); canStart.set(true); readOnlyPaths.set(new Set());
    setBoardMode.mockClear(); close.mockClear(); stop.mockClear(); reload.mockClear();
    TestBed.configureTestingModule({
      imports: [OrchestraCanvasComponent],
      providers: [
        { provide: TabManagerService, useValue: { tabs: signal([]), activeWorkspacePath$: path,
          removedWorkspace$: signal(null), closedTab: signal(null), onTabClosed: jest.fn(() => () => undefined),
          forceCloseTab: stop, closeTab: stop } },
        { provide: ChatStore, useValue: { switchSession: reload } },
        { provide: AppStateManager, useValue: {
          canvasSessionRequests: signal([]), takeCanvasSessionRequests: jest.fn(() => []),
          canvasFocusRequests: signal([]), takeCanvasFocusRequests: jest.fn(() => []),
          newCanvasSessionRequest: signal(null), clearNewCanvasSessionRequest: jest.fn(),
          canvasTabRequests: signal([]), takeCanvasTabRequests: jest.fn(() => []),
        } },
        { provide: BackOfficeActivityService, useValue: { recent: signal([]), isIdle: signal(true) } },
      ],
    });
    TestBed.overrideComponent(OrchestraCanvasComponent, { set: {
      imports: [FormsModule, LucideAngularModule, RailStub, GridStub, EmptyStub, QueueStub,
        DetailStub, PopoverStub, CanvasBoardToggleComponent, CanvasLayoutControlsComponent],
      providers: [
        { provide: CanvasStore, useValue: store },
        { provide: CanvasDetailService, useValue: detail },
        { provide: CanvasLayoutService, useValue: { observe: jest.fn() } },
        { provide: CanvasLayoutPersistenceService, useValue: persistence },
      ],
    } });
    fixture = TestBed.createComponent(OrchestraCanvasComponent);
    fixture.detectChanges();
  });

  const find = (selector: string) => fixture.nativeElement.querySelector(selector) as HTMLElement | null;
  const switchMode = (mode: 'rail' | 'grid') => {
    (find(`[data-testid="canvas-board-toggle"] button:last-child`) as HTMLButtonElement | null)?.click();
    if (mode === 'rail') (find('[data-testid="canvas-board-toggle"] button:first-child') as HTMLButtonElement)?.click();
    fixture.detectChanges();
  };

  it('starts in Rail and toggles to Grid and back without session actions', () => {
    expect(find('ptah-canvas-rail-board')).not.toBeNull();
    switchMode('grid'); expect(find('ptah-canvas-workspace-grid')).not.toBeNull();
    switchMode('rail'); expect(find('ptah-canvas-rail-board')).not.toBeNull();
    expect(stop).not.toHaveBeenCalled(); expect(reload).not.toHaveBeenCalled();
  });
  it('keeps a different mode per workspace and mounts one branch per path', () => {
    paths.set(['/a', '/b']); modes.set('/b', 'grid'); fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('ptah-canvas-rail-board')).toHaveLength(1);
    expect(fixture.nativeElement.querySelectorAll('ptah-canvas-workspace-grid')).toHaveLength(1);
    path.set('/b'); board.set('grid'); fixture.detectChanges();
    expect(find('[data-testid="canvas-board-toggle"] button:last-child')?.getAttribute('aria-pressed')).toBe('true');
  });
  it('keeps hidden Rail boards without a live draft input', () => {
    paths.set(['/a', '/b']); fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('ptah-canvas-rail-board')).toHaveLength(2);
    expect(fixture.nativeElement.querySelectorAll('[aria-label="Rail draft"]')).toHaveLength(1);
  });
  it('keeps the Board toggle available in an empty Rail and shows the Grid overlay only in Grid', () => {
    tiles.set([]); fixture.detectChanges();
    expect(find('[data-testid="canvas-board-toggle"]')).not.toBeNull();
    expect(find('ptah-canvas-empty-state')).toBeNull();
    switchMode('grid');
    expect(find('ptah-canvas-empty-state')).not.toBeNull();
  });
  it('places the toggle before Grid controls and queue', () => {
    switchMode('grid');
    const dock = find('[data-testid="canvas-dock"]') as HTMLElement;
    const children = [...dock.children];
    expect(children.indexOf(find('ptah-canvas-board-toggle') as HTMLElement)).toBeLessThan(children.indexOf(find('ptah-canvas-layout-controls') as HTMLElement));
    expect(children.indexOf(find('ptah-canvas-board-toggle') as HTMLElement)).toBeLessThan(children.indexOf(find('ptah-canvas-needs-you-queue') as HTMLElement));
  });
  it('closes Grid detail when switching to Rail', () => {
    switchMode('grid'); detailId.set('a'); fixture.detectChanges();
    switchMode('rail'); expect(close).toHaveBeenCalled();
  });
  it('keeps the Grid detail open when queue Escape is consumed', () => {
    switchMode('grid'); detailId.set('a'); fixture.detectChanges(); close.mockClear();
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    event.preventDefault();
    find('ptah-canvas-needs-you-queue')?.dispatchEvent(event);
    expect(close).not.toHaveBeenCalled();
  });
  it('shows persistence notes without blocking an in-memory switch', () => {
    writeFailed.set(true); readOnlyPaths.set(new Set(['/a'])); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Board layout could not be saved');
    expect(fixture.nativeElement.textContent).toContain('saved by a newer Ptah version');
    switchMode('grid'); expect(setBoardMode).toHaveBeenCalledWith('/a', 'grid');
  });
  it('shows the running cap reason in the Rail footer', () => {
    canStart.set(false); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(RUNNING_CAP_MESSAGE);
    expect(find('ptah-canvas-rail footer button')?.getAttribute('aria-disabled')).toBe('true');
  });
  it('restores a draft after the mode branch is destroyed and remounted', () => {
    const draft = find('[aria-label="Rail draft"]') as HTMLInputElement;
    draft.value = 'A draft'; draft.dispatchEvent(new Event('input')); fixture.detectChanges();
    switchMode('grid'); expect(find('[aria-label="Rail draft"]')).toBeNull();
    switchMode('rail');
    expect(find('[aria-label="Rail draft"]')).not.toBe(draft);
    expect((find('[aria-label="Rail draft"]') as HTMLInputElement).value).toBe('A draft');
  });
});
