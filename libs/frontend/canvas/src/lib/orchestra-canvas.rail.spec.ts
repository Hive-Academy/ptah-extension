import {
  ChangeDetectionStrategy,
  Component,
  Input,
  NgModule,
  OnDestroy,
} from '@angular/core';
jest.mock('ngx-markdown', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'markdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: '<div>{{ data }}</div>',
  })
  class MarkdownStub {
    @Input() data = '';
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
import { input, output, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import {
  AppStateManager,
  BackOfficeActivityService,
  SURFACE_ACTIVE,
} from '@ptah-extension/core';
import { ChatStore, TabManagerService } from '@ptah-extension/chat';
import { DEFAULT_SESSION_NAME_PATTERN } from '@ptah-extension/chat-state';
import type { OrchestraCanvasComponent as OrchestraCanvasType } from './orchestra-canvas.component';
import { CanvasStore } from './canvas.store';
import { CanvasLayoutService } from './canvas-layout.service';
import { CanvasLayoutPersistenceService } from './canvas-layout-persistence.service';
import { CanvasDetailService } from './canvas-detail/canvas-detail.service';
import { CanvasRailComponent } from './canvas-rail/canvas-rail.component';
import { RUNNING_CAP_MESSAGE } from './canvas-running-cap';
import type { CanvasBoardNotice } from './canvas-rail/canvas-rail-board.component';
const { OrchestraCanvasComponent } =
  require('./orchestra-canvas.component') as {
    OrchestraCanvasComponent: typeof OrchestraCanvasType;
  };

const savedDraft = signal('');
const canStart = signal(true);
const tiles = signal<
  {
    tabId: string;
    order: number;
    width: { kind: 'auto'; weight: number };
    rowBreakBefore: boolean;
  }[]
>([]);
const tile = (tabId: string, order: number) => ({
  tabId,
  order,
  width: { kind: 'auto' as const, weight: 1 },
  rowBreakBefore: false,
});

/**
 * Board stub with the real Rail footer. The footer and the zero-tile
 * empty-board trigger both route to `newSessionRequested`, as the real
 * `CanvasRailBoardComponent` does (`canvas-rail-board.component.spec.ts`).
 */
@Component({
  selector: 'ptah-canvas-rail-board',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CanvasRailComponent],
  template: `@if (visible()) {
    <ptah-canvas-rail
      [canStart]="canStart()"
      (newSession)="newSessionRequested.emit($event)"
    />
    @if (orderedTiles().length === 0) {
      <section data-testid="canvas-rail-empty-board">
        <button #hero type="button" (click)="newSessionRequested.emit(hero)">
          New session
        </button>
      </section>
    }
    @if (notice(); as current) {
      <div data-testid="test-board-notice">
        {{ current.text
        }}<button type="button" (click)="noticeDismissed.emit(current.key)">
          Dismiss
        </button>
      </div>
    }
    <div data-rail-card data-tab-id="a">
      <div aria-hidden="true" style="display: none">
        <button class="rc-select">Hidden</button>
      </div>
      <button class="rail-visible">Visible</button
      ><button class="rail-inner">Inner</button>
    </div>
    <div class="rail-draft">
      <input
        aria-label="Rail draft"
        [value]="draft()"
        (input)="onInput($event)"
      />
    </div>
  }`,
})
class RailStub implements OnDestroy {
  readonly workspacePath = input.required<string>();
  readonly visible = input.required<boolean>();
  readonly newSessionRequested = output<HTMLElement>();
  readonly notice = input<CanvasBoardNotice | null>(null);
  readonly noticeDismissed = output<string>();
  readonly draft = signal(savedDraft());
  readonly canStart = canStart;
  readonly orderedTiles = () => tiles();
  readonly focusedId = () => 'a';
  readonly focus = jest.fn();
  readonly sessionCreated = jest.fn();
  onInput(event: Event): void {
    if (event.target instanceof HTMLInputElement)
      this.draft.set(event.target.value);
  }
  ngOnDestroy(): void {
    savedDraft.set(this.draft());
  }
}
@Component({
  selector: 'ptah-canvas-needs-you-queue',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class QueueStub {}
@Component({
  selector: 'ptah-native-popover',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
})
class PopoverStub {
  readonly isOpen = input(false);
  readonly placement = input('');
  readonly hasBackdrop = input(false);
  readonly backdropClass = input('');
  readonly anchor = input<HTMLElement | null>(null);
  readonly closed = output<void>();
}

describe('OrchestraCanvasComponent Rail integration', () => {
  const surfaceActive = signal(true);
  const path = signal<string | null>('/a');
  const paths = signal<readonly string[]>(['/a']);
  const writeFailed = signal(false);
  const readOnlyPaths = signal(new Set<string>());
  const canAddTile = signal(true);
  const newSessionRequest = signal<string | null>(null);
  /** Raw stored board modes; `'grid'` is the legacy value a v3 record may hold. */
  const modes = new Map<string, string>();
  const addTile = jest.fn((_name?: string): string | null => 'new-tab');
  const focusTile = jest.fn();
  const stop = jest.fn();
  const reload = jest.fn();
  const store = {
    tiles,
    activeWorkspacePath: path,
    workspacePaths: paths,
    boardFor: (workspace: string) => ({ mode: modes.get(workspace) ?? 'rail' }),
    canAddTile,
    canStartRunningSession: canStart,
    addTile,
    focusTile,
    hydrateWorkspace: jest.fn(),
    switchWorkspaceTiles: jest.fn(),
    removeWorkspaceTileState: jest.fn(),
    removeTileOnly: jest.fn(),
    removeTileFromAnyWorkspace: jest.fn(),
  };
  const persistence = {
    writeFailed,
    writeFailureCount: signal(0),
    readOnlyPaths,
    flush: jest.fn(),
  };
  let fixture: ReturnType<typeof TestBed.createComponent<OrchestraCanvasType>>;

  beforeEach(() => {
    path.set('/a');
    surfaceActive.set(true);
    paths.set(['/a']);
    modes.clear();
    savedDraft.set('');
    tiles.set([tile('a', 0)]);
    writeFailed.set(false);
    canStart.set(true);
    canAddTile.set(true);
    newSessionRequest.set(null);
    readOnlyPaths.set(new Set());
    addTile.mockReset();
    addTile.mockReturnValue('new-tab');
    focusTile.mockClear();
    stop.mockClear();
    reload.mockClear();
    TestBed.configureTestingModule({
      imports: [OrchestraCanvasComponent],
      providers: [
        { provide: SURFACE_ACTIVE, useValue: surfaceActive },
        {
          provide: TabManagerService,
          useValue: {
            tabs: signal([]),
            activeWorkspacePath$: path,
            removedWorkspace$: signal(null),
            closedTab: signal(null),
            onTabClosed: jest.fn(() => () => undefined),
            forceCloseTab: stop,
            closeTab: stop,
          },
        },
        { provide: ChatStore, useValue: { switchSession: reload } },
        {
          provide: AppStateManager,
          useValue: {
            canvasSessionRequests: signal([]),
            takeCanvasSessionRequests: jest.fn(() => []),
            canvasFocusRequests: signal([]),
            takeCanvasFocusRequests: jest.fn(() => []),
            newCanvasSessionRequest: newSessionRequest,
            clearNewCanvasSessionRequest: jest.fn(),
            canvasTabRequests: signal([]),
            takeCanvasTabRequests: jest.fn(() => []),
          },
        },
        {
          provide: BackOfficeActivityService,
          useValue: { recent: signal([]), isIdle: signal(true) },
        },
      ],
    });
    TestBed.overrideComponent(OrchestraCanvasComponent, {
      set: {
        imports: [
          FormsModule,
          LucideAngularModule,
          RailStub,
          QueueStub,
          PopoverStub,
        ],
        providers: [
          { provide: CanvasStore, useValue: store },
          { provide: CanvasDetailService, useValue: {} },
          { provide: CanvasLayoutService, useValue: { observe: jest.fn() } },
          { provide: CanvasLayoutPersistenceService, useValue: persistence },
        ],
      },
    });
    fixture = TestBed.createComponent(OrchestraCanvasComponent);
    // The host queries `viewChildren(CanvasRailBoardComponent)`; route that
    // query to the board stubs so the post-add focus path is observable.
    Object.defineProperty(fixture.componentInstance, 'activeRailBoards', {
      configurable: true,
      value: () => railBoards(),
    });
    fixture.detectChanges();
  });

  const railBoards = () =>
    fixture.debugElement
      .queryAll(By.directive(RailStub))
      .map((node) => node.componentInstance as RailStub);

  const find = <T extends HTMLElement = HTMLElement>(selector: string) =>
    fixture.nativeElement.querySelector(selector) as T | null;
  const popovers = () =>
    fixture.debugElement
      .queryAll(By.directive(PopoverStub))
      .map((node) => node.componentInstance as PopoverStub);
  const popoverOpen = () => popovers()[0]?.isOpen() ?? false;
  const visibleBoard = () => railBoards().find((board) => board.visible());
  const footerButton = () =>
    find<HTMLButtonElement>('ptah-canvas-rail footer button');
  const createButton = () =>
    [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        '[data-testid="canvas-new-session-popover"] button',
      ),
    ].find((button) => button.textContent?.trim() === 'Create');
  const typeName = async (value: string) => {
    const field = find<HTMLInputElement>('input[aria-label="Session name"]');
    if (!field) throw new Error('Session name input is not rendered');
    field.value = value;
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
  };

  it('stored grid board renders Rail', () => {
    paths.set(['/a', '/b']);
    modes.set('/a', 'grid');
    modes.set('/b', 'grid');
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelectorAll('ptah-canvas-rail-board'),
    ).toHaveLength(2);
    expect(find('ptah-canvas-workspace-grid')).toBeNull();
    expect(find('ptah-canvas-board-toggle')).toBeNull();
    expect(find('ptah-canvas-layout-controls')).toBeNull();
    expect(find('ptah-canvas-empty-state')).toBeNull();
    expect(stop).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('keeps hidden Rail boards without a live draft input', () => {
    paths.set(['/a', '/b']);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelectorAll('ptah-canvas-rail-board'),
    ).toHaveLength(2);
    expect(
      fixture.nativeElement.querySelectorAll('[aria-label="Rail draft"]'),
    ).toHaveLength(1);
  });

  it('Rail new session opens named popover', () => {
    expect(popovers()).toHaveLength(1);
    expect(popoverOpen()).toBe(false);
    footerButton()?.click();
    fixture.detectChanges();
    expect(popoverOpen()).toBe(true);
    expect(popovers()[0]?.anchor()).toBe(footerButton());
    expect(find('input[aria-label="Session name"]')).not.toBeNull();
    expect(addTile).not.toHaveBeenCalled();
    expect(popovers()).toHaveLength(1);
  });

  it('0 tiles: empty-board trigger opens the same popover', () => {
    tiles.set([]);
    fixture.detectChanges();
    const trigger = find<HTMLButtonElement>(
      '[data-testid="canvas-rail-empty-board"] button',
    );
    expect(trigger).not.toBeNull();
    trigger?.click();
    fixture.detectChanges();
    expect(popovers()).toHaveLength(1);
    expect(popoverOpen()).toBe(true);
    expect(popovers()[0]?.anchor()).toBe(trigger);
    expect(addTile).not.toHaveBeenCalled();
  });

  it('keeps a typed name, then focuses and anchors the new Rail tile', async () => {
    footerButton()?.click();
    fixture.detectChanges();
    await typeName('  Alpha  ');
    createButton()?.click();
    fixture.detectChanges();
    expect(addTile).toHaveBeenCalledWith('Alpha');
    expect(visibleBoard()?.sessionCreated).toHaveBeenCalledWith('new-tab');
    expect(popoverOpen()).toBe(false);
  });

  it('empty name uses default and first-prompt rename', async () => {
    footerButton()?.click();
    fixture.detectChanges();
    await typeName('   ');
    createButton()?.click();
    fixture.detectChanges();
    expect(addTile).toHaveBeenCalledTimes(1);
    const name = addTile.mock.calls[0]?.[0] ?? '';
    // Tab manager marks this shape as a default title, so the first prompt
    // renames the session (`tab-manager.service.ts` createTab).
    expect(DEFAULT_SESSION_NAME_PATTERN.test(name)).toBe(true);
    expect(visibleBoard()?.sessionCreated).toHaveBeenCalledWith('new-tab');
  });

  it('running cap blocks create', async () => {
    footerButton()?.click();
    fixture.detectChanges();
    await typeName('Beta');
    canStart.set(false);
    fixture.detectChanges();
    createButton()?.click();
    fixture.detectChanges();
    expect(addTile).not.toHaveBeenCalled();
    expect(visibleBoard()?.sessionCreated).not.toHaveBeenCalled();
    expect(popoverOpen()).toBe(false);
    expect(find('[data-testid="test-board-notice"]')?.textContent).toContain(
      RUNNING_CAP_MESSAGE,
    );
  });

  it('a null add leaves no tile, closes the popover and announces the tile bound', async () => {
    addTile.mockReturnValue(null);
    footerButton()?.click();
    fixture.detectChanges();
    await typeName('Gamma');
    createButton()?.click();
    fixture.detectChanges();
    expect(addTile).toHaveBeenCalledWith('Gamma');
    expect(visibleBoard()?.sessionCreated).not.toHaveBeenCalled();
    expect(focusTile).not.toHaveBeenCalled();
    expect(popoverOpen()).toBe(false);
    expect(find('[data-testid="test-board-notice"]')?.textContent).toContain(
      'Close one to add another',
    );
  });

  it('announces the tile bound when an external new session request cannot add a tile', () => {
    addTile.mockReturnValue(null);
    canAddTile.set(false);
    newSessionRequest.set('Gamma');
    fixture.detectChanges();
    expect(addTile).toHaveBeenCalledWith('Gamma');
    expect(find('[data-testid="test-board-notice"]')?.textContent).toContain(
      'Close one to add another',
    );
  });

  it('leaves the header message empty when an external new session request succeeds', () => {
    newSessionRequest.set('Gamma');
    fixture.detectChanges();
    expect(addTile).toHaveBeenCalledWith('Gamma');
    expect(
      find('[data-testid="test-board-notice"]')?.textContent?.trim() ?? '',
    ).toBe('');
  });

  it.each([
    ['running cap', false, true, RUNNING_CAP_MESSAGE],
    ['tile bound', true, false, 'Close one to add another'],
  ])(
    'a blocked board request at the %s opens nothing, adds nothing and announces',
    (_label, start, canAdd, reason) => {
      canStart.set(start);
      canAddTile.set(canAdd);
      tiles.set([]);
      fixture.detectChanges();
      find<HTMLButtonElement>(
        '[data-testid="canvas-rail-empty-board"] button',
      )?.click();
      fixture.detectChanges();
      expect(popoverOpen()).toBe(false);
      expect(addTile).not.toHaveBeenCalled();
      expect(visibleBoard()?.sessionCreated).not.toHaveBeenCalled();
      expect(find('[data-testid="test-board-notice"]')?.textContent).toContain(
        reason,
      );
    },
  );

  it('cancels without creating and clears the typed name', async () => {
    footerButton()?.click();
    fixture.detectChanges();
    await typeName('Delta');
    popovers()[0]?.closed.emit();
    fixture.detectChanges();
    expect(popoverOpen()).toBe(false);
    expect(addTile).not.toHaveBeenCalled();
    footerButton()?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(
      find<HTMLInputElement>('input[aria-label="Session name"]')?.value,
    ).toBe('');
  });

  it('returns focus to the invoking footer on cancel and failed create', () => {
    const footer = footerButton();
    expect(footer).not.toBeNull();
    footer?.focus();
    footer?.click();
    fixture.detectChanges();
    find<HTMLInputElement>('input[aria-label="Session name"]')?.focus();
    popovers()[0]?.closed.emit();
    fixture.detectChanges();
    expect(document.activeElement).toBe(footer);

    footer?.click();
    fixture.detectChanges();
    find<HTMLInputElement>('input[aria-label="Session name"]')?.focus();
    addTile.mockReturnValue(null);
    createButton()?.click();
    fixture.detectChanges();
    expect(document.activeElement).toBe(footer);
  });

  it('reaching the tile bound closes the open popover; a later tile close does not reopen it', async () => {
    footerButton()?.click();
    fixture.detectChanges();
    await typeName('Epsilon');
    expect(popoverOpen()).toBe(true);
    const statusBefore =
      find('[data-testid="test-board-notice"]')?.textContent ?? null;
    // A queued or adopted session takes the last tile while the popover is open.
    canAddTile.set(false);
    fixture.detectChanges();
    expect(popovers()).toHaveLength(0);
    // Nothing extra is announced for the silent close.
    expect(find('[data-testid="test-board-notice"]')?.textContent ?? null).toBe(
      statusBefore,
    );
    // A tile is closed and the bound frees up again.
    canAddTile.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(popovers()).toHaveLength(1);
    expect(popoverOpen()).toBe(false);
    expect(
      find<HTMLInputElement>('input[aria-label="Session name"]')?.value,
    ).toBe('');
    expect(addTile).not.toHaveBeenCalled();
  });

  it('returns Escape focus to the visible collapsed Rail button', () => {
    Object.defineProperty(fixture.componentInstance, 'activeRailBoards', {
      value: () => [
        {
          visible: () => true,
          orderedTiles: () => tiles(),
          focusedId: () => 'a',
          focus: jest.fn(),
        },
      ],
    });
    const inner = find<HTMLButtonElement>('.rail-inner');
    const visible = find<HTMLButtonElement>('.rail-visible');
    inner?.focus();
    inner?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(visible);
  });

  it('ranks notices and resets dismissal on source refresh and workspace change', () => {
    readOnlyPaths.set(new Set(['/a', '/b']));
    fixture.detectChanges();
    expect(find('[data-testid="test-board-notice"]')?.textContent).toContain(
      'newer Ptah',
    );
    writeFailed.set(true);
    fixture.detectChanges();
    expect(find('[data-testid="test-board-notice"]')?.textContent).toContain(
      'could not be saved',
    );
    find('[data-testid="test-board-notice"] button')?.click();
    fixture.detectChanges();
    expect(find('[data-testid="test-board-notice"]')).toBeNull();
    surfaceActive.set(false);
    fixture.detectChanges();
    surfaceActive.set(true);
    fixture.detectChanges();
    expect(find('[data-testid="test-board-notice"]')?.textContent).toContain(
      'could not be saved',
    );
    writeFailed.set(false);
    fixture.detectChanges();
    expect(find('[data-testid="test-board-notice"]')?.textContent).toContain(
      'newer Ptah',
    );
    writeFailed.set(true);
    fixture.detectChanges();
    expect(find('[data-testid="test-board-notice"]')?.textContent).toContain(
      'could not be saved',
    );
    path.set('/b');
    paths.set(['/a', '/b']);
    fixture.detectChanges();
    expect(find('[data-testid="test-board-notice"]')?.textContent).toContain(
      'could not be saved',
    );
  });

  it('shows the running cap reason in the Rail footer', () => {
    canStart.set(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(RUNNING_CAP_MESSAGE);
    expect(footerButton()?.getAttribute('aria-disabled')).toBe('true');
    footerButton()?.click();
    fixture.detectChanges();
    expect(popoverOpen()).toBe(false);
  });
});
