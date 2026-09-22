import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  OnDestroy,
  inject,
  input,
  output,
  signal,
  computed,
  effect,
  untracked,
  viewChild,
  ElementRef,
  EnvironmentInjector,
  createEnvironmentInjector,
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import {
  ChatViewComponent,
  TabManagerService,
  SESSION_CONTEXT,
  SESSION_VISIBLE,
  SendToMessagingComponent,
} from '@ptah-extension/chat';
import { EffortStateService, ModelStateService } from '@ptah-extension/core';
import { NativePopoverComponent } from '@ptah-extension/ui';
import {
  isCompactViewMode,
  type TabViewMode,
} from '@ptah-extension/chat-types';
import {
  LucideAngularModule,
  Minimize2,
  Maximize2,
  Ellipsis,
  Scan,
  CornerDownLeft,
  Check,
} from 'lucide-angular';
import { TileAgentIndicatorComponent } from './tile-agent-indicator.component';
import { TileAgentMiniPanelComponent } from './tile-agent-mini-panel.component';
import {
  DEFAULT_TILE_WIDTH,
  type TileSpan,
  type TileWidthIntent,
} from './canvas-layout-intent';

const SPAN_OPTIONS: ReadonlyArray<{
  readonly span: TileSpan;
  readonly short: string;
  readonly label: string;
}> = [
  { span: 'third', short: '⅓', label: 'Set tile width to one third' },
  { span: 'half', short: '½', label: 'Set tile width to one half' },
  {
    span: 'two-thirds',
    short: '⅔',
    label: 'Set tile width to two thirds',
  },
  { span: 'full', short: 'Full', label: 'Set tile width to full' },
];

const MENU_NAVIGATION_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

const VIEW_MODE_OPTIONS: ReadonlyArray<{
  readonly mode: TabViewMode;
  readonly short: string;
  readonly label: string;
}> = [
  { mode: 'full', short: 'Full', label: 'Full' },
  { mode: 'compact', short: 'Compact', label: 'Compact' },
  { mode: 'compact-tall', short: 'Tall', label: 'Compact tall' },
];

const NEXT_VIEW_MODE_LABEL: Readonly<Record<TabViewMode, string>> = {
  full: 'Switch to compact view',
  // The one-click affordance is binary: either compact tier returns to full.
  // Picking a specific tier is the menu's job (`VIEW_MODE_OPTIONS`).
  compact: 'Switch to full view',
  'compact-tall': 'Switch to full view',
};

/**
 * CanvasTileComponent — renders a single chat session tile within the Orchestra Canvas.
 *
 * Each tile owns a child EnvironmentInjector that provides SESSION_CONTEXT as
 * Signal<string|null> scoped to this tile's tabId. ChatViewComponent, which injects
 * SESSION_CONTEXT optionally, will use tile-local messages/session data instead of
 * global active-tab state.
 *
 * The header carries a layout menu (span, layout focus, row break). The tile
 * stays presentational: it emits intent requests and the workspace grid
 * commits them to the store.
 *
 * CRITICAL CONTRACTS:
 * 1. childInjector()?.destroy() is called in ngOnDestroy — prevents EnvironmentInjector leak.
 * 2. ChatViewComponent is rendered only when childInjector() is non-null (via @if guard),
 *    guaranteeing SESSION_CONTEXT is already provided before the component bootstraps.
 * 3. onTileClick() emits focusRequested so the parent calls canvasStore.focusTile()
 *    before any message is sent — keeps global activeTabId in sync.
 */
@Component({
  selector: 'ptah-canvas-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgComponentOutlet,
    LucideAngularModule,
    NativePopoverComponent,
    TileAgentIndicatorComponent,
    TileAgentMiniPanelComponent,
    SendToMessagingComponent,
  ],
  template: `
    <div
      class="canvas-tile flex flex-col border rounded-lg h-full overflow-hidden transition-shadow"
      [attr.data-focused]="focused()"
      [class.border-primary]="focused()"
      [class.ring-2]="focused()"
      [class.ring-primary]="focused()"
      [class.border-base-300]="!focused()"
      (click)="onTileClick()"
    >
      <!-- Tile header: label + agent indicator + layout menu + close button -->
      <div
        class="tile-header flex items-center gap-2 px-2 py-1 bg-base-300 text-xs rounded-t-lg shrink-0"
      >
        <span class="truncate flex-1 font-medium text-base-content">{{
          tabLabel()
        }}</span>
        <ptah-tile-agent-indicator [tabId]="tabId()" />
        <ptah-send-to-messaging
          [tabId]="tabId()"
          (click)="$event.stopPropagation()"
        />
        <!-- Pointer events stop here so menu use never focuses or drags the tile -->
        <ptah-native-popover
          [isOpen]="layoutMenuOpen()"
          [placement]="'bottom-end'"
          [hasBackdrop]="true"
          [backdropClass]="'transparent'"
          (opened)="focusCheckedLayoutItem()"
          (closed)="closeLayoutMenu()"
          (click)="$event.stopPropagation()"
          (mousedown)="$event.stopPropagation()"
          (pointerdown)="$event.stopPropagation()"
          (touchstart)="$event.stopPropagation()"
        >
          <button
            trigger
            type="button"
            class="btn btn-ghost btn-xs px-1 min-h-0 h-5 text-base-content-muted hover:text-base-content"
            aria-haspopup="menu"
            [attr.aria-expanded]="layoutMenuOpen()"
            [attr.aria-label]="'Layout options for ' + tabLabel()"
            title="Layout options"
            data-testid="tile-layout-trigger"
            (click)="toggleLayoutMenu()"
          >
            <lucide-angular [img]="EllipsisIcon" class="w-3 h-3" />
          </button>
          <div
            #layoutMenu
            content
            role="menu"
            class="p-2 flex flex-col gap-1.5 w-56 text-xs"
            [attr.aria-label]="'Layout for ' + tabLabel()"
            (keydown)="onLayoutMenuKeydown($event)"
          >
            <!-- WIDTH: segmented control over the four stored spans -->
            <div
              role="group"
              aria-label="Tile width"
              class="flex flex-col gap-1"
            >
              <span
                class="text-[10px] uppercase tracking-wide text-base-content-muted px-1"
                >Width</span
              >
              @if (layoutLocked()) {
                <span
                  data-testid="layout-locked-hint"
                  class="text-base-content-muted px-1"
                  >Layout locked</span
                >
              }
              <div class="join w-full" data-layout-group="width">
                @for (option of spanOptions; track option.span) {
                  <button
                    type="button"
                    role="menuitemradio"
                    tabindex="-1"
                    data-layout-item
                    class="join-item btn btn-ghost btn-xs flex-1 font-normal px-0"
                    [class.btn-active]="isSpanChecked(option.span)"
                    [class.text-primary]="isSpanChecked(option.span)"
                    [attr.data-span]="option.span"
                    [attr.aria-checked]="isSpanChecked(option.span)"
                    [attr.aria-label]="option.label"
                    [disabled]="layoutLocked()"
                    (click)="requestSpan(option.span)"
                  >
                    {{ option.short }}
                  </button>
                }
              </div>
            </div>
            <!-- HEIGHT: segmented control over the three view modes -->
            <div
              role="group"
              aria-label="Tile height"
              class="flex flex-col gap-1"
            >
              <span
                class="text-[10px] uppercase tracking-wide text-base-content-muted px-1"
                >Height</span
              >
              <div class="join w-full" data-layout-group="height">
                @for (option of viewModeOptions; track option.mode) {
                  <button
                    type="button"
                    role="menuitemradio"
                    tabindex="-1"
                    data-layout-item
                    class="join-item btn btn-ghost btn-xs flex-1 font-normal px-0"
                    [class.btn-active]="viewMode() === option.mode"
                    [class.text-primary]="viewMode() === option.mode"
                    [attr.data-view-mode]="option.mode"
                    [attr.aria-checked]="viewMode() === option.mode"
                    [attr.aria-label]="'Set tile height to ' + option.label"
                    (click)="requestViewMode(option.mode)"
                  >
                    {{ option.short }}
                  </button>
                }
              </div>
            </div>
            <!-- ARRANGE: focus and row placement -->
            <div role="group" aria-label="Arrange" class="flex flex-col gap-1">
              <span
                class="text-[10px] uppercase tracking-wide text-base-content-muted px-1"
                >Arrange</span
              >
              <button
                type="button"
                role="menuitem"
                tabindex="-1"
                data-layout-item
                data-layout-action="focus"
                class="btn btn-ghost btn-xs justify-start font-normal"
                [class.btn-active]="layoutFocused()"
                [attr.aria-label]="
                  layoutFocused()
                    ? 'Exit tile focus'
                    : 'Focus tile at full width'
                "
                [disabled]="layoutLocked()"
                (click)="requestLayoutFocus()"
              >
                <lucide-angular
                  [img]="layoutFocused() ? CheckIcon : ScanIcon"
                  class="w-3 h-3 shrink-0"
                />
                {{ layoutFocused() ? 'Exit focus' : 'Focus' }}
              </button>
              <button
                type="button"
                role="menuitem"
                tabindex="-1"
                data-layout-item
                data-layout-action="row"
                class="btn btn-ghost btn-xs justify-start font-normal"
                [attr.aria-label]="
                  rowBreakBefore()
                    ? 'Join the previous row'
                    : 'Start a new row before this tile'
                "
                [disabled]="layoutLocked() || firstInOrder()"
                (click)="requestRowBreak()"
              >
                <lucide-angular
                  [img]="CornerDownLeftIcon"
                  class="w-3 h-3 shrink-0"
                />
                {{ rowBreakBefore() ? 'Join previous row' : 'Start new row' }}
              </button>
            </div>
          </div>
        </ptah-native-popover>
        <!-- View-mode toggle: header-drag pointer isolation matches the layout
             menu, and the button stays enabled under layout lock because view
             mode is owned by TabManagerService, not by canvas layout intent. -->
        <button
          class="btn btn-ghost btn-xs px-1 min-h-0 h-5 text-base-content-muted hover:text-base-content"
          (click)="onToggleViewMode($event)"
          (mousedown)="$event.stopPropagation()"
          (pointerdown)="$event.stopPropagation()"
          (touchstart)="$event.stopPropagation()"
          [title]="nextViewModeLabel()"
          [attr.aria-label]="nextViewModeLabel()"
          data-testid="tile-view-mode-toggle"
        >
          <lucide-angular
            [img]="isCompactMode() ? MaximizeIcon : MinimizeIcon"
            class="w-3 h-3"
          />
        </button>
        <button
          class="btn btn-ghost btn-xs px-1 min-h-0 h-5 text-base-content-muted hover:text-error"
          (click)="onClose($event)"
          aria-label="Close tile"
          title="Close tile"
        >
          ×
        </button>
      </div>

      <!-- Agent mini-panel (expanded from tile header indicator) -->
      @if (tileAgentIndicator()?.expanded()) {
        <ptah-tile-agent-mini-panel
          [agents]="tileAgentIndicator()?.agents() ?? []"
        />
      }

      <!-- Chat view — only rendered after child injector is ready -->
      @if (childInjector()) {
        <div class="flex-1 min-h-0 overflow-hidden">
          <ng-container
            [ngComponentOutlet]="chatViewComponent"
            [ngComponentOutletInjector]="childInjector()!"
          />
        </div>
      }
    </div>
  `,
})
export class CanvasTileComponent implements OnInit, OnDestroy {
  /** The tabId this tile is scoped to. Required — provided by OrchestraCanvasComponent. */
  readonly tabId = input.required<string>();

  /**
   * Whether this tile is the currently focused tile.
   * When true, renders a primary-colored ring border.
   */
  readonly focused = input<boolean>(false);

  /**
   * Whether this tile's workspace grid is on-screen. Drives visibility-based
   * streaming registration and the inner transcript's reactivity pause: a
   * hidden-workspace tile deregisters (so BatchedUpdateService keeps deferring
   * its streaming flushes) and its transcript freezes.
   */
  readonly visible = input<boolean>(true);

  /** Stored width preference — not the responsive width it renders at. */
  readonly widthIntent = input<TileWidthIntent>(DEFAULT_TILE_WIDTH);
  /** Whether this tile starts a logical row. */
  readonly rowBreakBefore = input<boolean>(false);
  /** The first tile in reading order can never start a new row. */
  readonly firstInOrder = input<boolean>(false);
  /** Whether this tile is the workspace's transient layout-focus tile. */
  readonly layoutFocused = input<boolean>(false);
  /**
   * Canvas lock: every layout action is disabled. The compact/full toggle is
   * the deliberate exception — view mode is owned by `TabManagerService`, not
   * by canvas layout intent, so it stays enabled and its authoritative
   * reflow is applied by the workspace grid.
   */
  readonly layoutLocked = input<boolean>(false);

  /**
   * Emits tabId when the user clicks anywhere on the tile.
   * Parent must call canvasStore.focusTile(tabId) to update global activeTabId
   * before any message send can occur for this tile.
   */
  readonly focusRequested = output<string>();

  /**
   * Emits tabId when the user clicks the close button.
   * Parent must call canvasStore.removeTile(tabId).
   */
  readonly closeRequested = output<string>();

  /** Parent commits the named span to the store. */
  readonly spanRequested = output<TileSpan>();
  /** Parent enters or exits transient layout focus. */
  readonly layoutFocusToggled = output<void>();
  /** Parent starts a new row before this tile or joins the previous row. */
  readonly rowBreakToggled = output<void>();

  /** Reference to the agent indicator for reading expanded() and agents() signals. */
  readonly tileAgentIndicator = viewChild(TileAgentIndicatorComponent);

  private readonly layoutMenu =
    viewChild<ElementRef<HTMLElement>>('layoutMenu');
  readonly layoutMenuOpen = signal(false);
  protected readonly spanOptions = SPAN_OPTIONS;
  protected readonly viewModeOptions = VIEW_MODE_OPTIONS;

  private readonly tabManager = inject(TabManagerService);
  private readonly effortState = inject(EffortStateService);
  private readonly modelState = inject(ModelStateService);
  private readonly parentEnvInjector = inject(EnvironmentInjector);

  private readonly _freezeEffort = effect(() => {
    if (!this.effortState.isLoaded()) return;
    untracked(() => {
      const id = this.tabId();
      const tab = this.tabManager.tabs().find((t) => t.id === id);
      if (tab && tab.overrideEffort === undefined) {
        this.tabManager.setOverrideEffort(
          id,
          this.effortState.currentEffort() ?? null,
        );
      }
    });
  });

  private readonly _freezeModel = effect(() => {
    if (!this.modelState.isLoaded()) return;
    untracked(() => {
      const id = this.tabId();
      const tab = this.tabManager.tabs().find((t) => t.id === id);
      if (tab && tab.overrideModel === undefined) {
        const current = this.modelState.currentModel();
        if (current) {
          this.tabManager.setOverrideModel(id, current);
        }
      }
    });
  });

  /**
   * Register this tile's tab as visible only while its workspace grid is
   * on-screen. Driven by the `visible` input (not the lifecycle) so a tile that
   * stays mounted in a hidden background workspace deregisters — keeping
   * BatchedUpdateService's streaming-flush deferral in effect and preserving the
   * cross-workspace streaming isolation from commit 571227a8a. Unregistered
   * again in ngOnDestroy.
   */
  private readonly _visibilityRegistration = effect(() => {
    const id = this.tabId();
    if (this.visible()) {
      this.tabManager.registerVisibleTab(id);
    } else {
      this.tabManager.unregisterVisibleTab(id);
    }
  });

  /**
   * Child EnvironmentInjector providing SESSION_CONTEXT for this tile's ChatViewComponent.
   * Starts null; set in ngOnInit; destroyed in ngOnDestroy.
   * Private mutable signal; exposed as readonly via childInjector.
   */
  private readonly _childInjector = signal<EnvironmentInjector | null>(null);
  readonly childInjector = this._childInjector.asReadonly();

  /**
   * Expose ChatViewComponent class reference for NgComponentOutlet.
   * Using a readonly property keeps the template clean and avoids repeated
   * class references in the template expression.
   */
  readonly chatViewComponent = ChatViewComponent;

  readonly MinimizeIcon = Minimize2;
  readonly MaximizeIcon = Maximize2;
  readonly EllipsisIcon = Ellipsis;
  readonly ScanIcon = Scan;
  readonly CornerDownLeftIcon = CornerDownLeft;
  readonly CheckIcon = Check;

  /**
   * Display label for the tile header.
   * Prefers TabState.title (UI-derived label), then falls back to TabState.name
   * (user-provided session name), then truncates tabId as last resort.
   */
  readonly tabLabel = computed(() => {
    const tab = this.tabManager.tabs().find((t) => t.id === this.tabId());
    return tab?.title || tab?.name || `Tab ${this.tabId().slice(0, 8)}`;
  });

  readonly viewMode = computed(() =>
    this.tabManager.getTabViewMode(this.tabId()),
  );
  /** Both compact tiers use the condensed card. */
  readonly isCompactMode = computed(() => isCompactViewMode(this.viewMode()));
  protected readonly nextViewModeLabel = computed(
    () => NEXT_VIEW_MODE_LABEL[this.viewMode()],
  );

  ngOnInit(): void {
    const tabIdSignal = computed<string | null>(() => this.tabId());

    this._childInjector.set(
      createEnvironmentInjector(
        [
          { provide: SESSION_CONTEXT, useValue: tabIdSignal },
          { provide: SESSION_VISIBLE, useValue: this.visible },
        ],
        this.parentEnvInjector,
      ),
    );
  }

  ngOnDestroy(): void {
    this.tabManager.unregisterVisibleTab(this.tabId());
    this.childInjector()?.destroy();
  }

  /**
   * Emits focusRequested so the parent OrchestraCanvasComponent can call
   * canvasStore.focusTile(tabId), which in turn calls tabManager.switchTab(tabId).
   * This keeps global activeTabId in sync before any message is sent.
   */
  onTileClick(): void {
    this.focusRequested.emit(this.tabId());
  }

  /**
   * Cycles the three view modes for this tile. View mode stays owned by
   * `TabManagerService`; canvas only projects it. Stops propagation to avoid
   * triggering onTileClick / Gridstack drag, and stays available under layout
   * lock because it is not a layout-intent mutation.
   */
  onToggleViewMode(event: Event): void {
    event.stopPropagation();
    this.tabManager.toggleTabViewMode(this.tabId());
  }

  /**
   * Stops event propagation (so onTileClick does not also fire) and emits
   * closeRequested so the parent can call canvasStore.removeTile(tabId).
   */
  onClose(event: Event): void {
    event.stopPropagation();
    this.closeRequested.emit(this.tabId());
  }

  protected isSpanChecked(span: TileSpan): boolean {
    const width = this.widthIntent();
    return width.kind === 'span' && width.span === span;
  }

  protected toggleLayoutMenu(): void {
    this.layoutMenuOpen.update((open) => !open);
  }

  protected closeLayoutMenu(): void {
    this.layoutMenuOpen.set(false);
  }

  /** View mode remains available while layout intent is locked. */
  protected requestViewMode(mode: TabViewMode): void {
    this.tabManager.setViewMode(this.tabId(), mode);
    this.closeLayoutMenu();
  }

  /** Selection closes the menu; the popover restores focus to the trigger. */
  protected requestSpan(span: TileSpan): void {
    if (this.layoutLocked()) return;
    this.spanRequested.emit(span);
    this.closeLayoutMenu();
  }

  protected requestLayoutFocus(): void {
    if (this.layoutLocked()) return;
    this.layoutFocusToggled.emit();
    this.closeLayoutMenu();
  }

  protected requestRowBreak(): void {
    if (this.layoutLocked() || this.firstInOrder()) return;
    this.rowBreakToggled.emit();
    this.closeLayoutMenu();
  }

  /** On open, move focus to the checked span, else the first enabled item. */
  protected focusCheckedLayoutItem(): void {
    const items = this.enabledLayoutItems();
    const checked = items.find(
      (item) => item.getAttribute('aria-checked') === 'true',
    );
    (checked ?? items[0])?.focus();
  }

  /** Up/Down cycle through enabled items; Home/End jump to first/last. */
  protected onLayoutMenuKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      this.moveWithinSegmentedGroup(event);
      return;
    }
    if (!MENU_NAVIGATION_KEYS.has(event.key)) return;
    const items = this.enabledLayoutItems();
    if (items.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const last = items.length - 1;
    const current = items.findIndex((item) => item === document.activeElement);
    let next: number;
    switch (event.key) {
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      case 'ArrowDown':
        next = current >= last ? 0 : current + 1;
        break;
      default:
        next = current <= 0 ? last : current - 1;
    }
    items[next].focus();
  }

  /**
   * Left/Right move within the segmented group the focused item belongs to,
   * wrapping at the group edges. Items outside a segmented group (Arrange)
   * ignore the horizontal arrows.
   */
  private moveWithinSegmentedGroup(event: KeyboardEvent): void {
    const active = document.activeElement as HTMLElement | null;
    const group = active?.closest('[data-layout-group]');
    if (!group) return;
    const items = Array.from(
      group.querySelectorAll<HTMLButtonElement>('button[data-layout-item]'),
    ).filter((item) => !item.disabled);
    if (items.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const current = items.findIndex((item) => item === document.activeElement);
    const offset = event.key === 'ArrowRight' ? 1 : -1;
    const next = (current + offset + items.length) % items.length;
    items[next].focus();
  }

  private enabledLayoutItems(): HTMLButtonElement[] {
    const menu = this.layoutMenu()?.nativeElement;
    if (!menu) return [];
    return Array.from(
      menu.querySelectorAll<HTMLButtonElement>('button[data-layout-item]'),
    ).filter((item) => !item.disabled);
  }
}
