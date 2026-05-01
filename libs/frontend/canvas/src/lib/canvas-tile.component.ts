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
  viewChild,
  EnvironmentInjector,
  createEnvironmentInjector,
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import {
  ChatViewComponent,
  TabManagerService,
  SESSION_CONTEXT,
} from '@ptah-extension/chat';
import { LucideAngularModule, Minimize2, Maximize2 } from 'lucide-angular';
import { TileAgentIndicatorComponent } from './tile-agent-indicator.component';
import { TileAgentMiniPanelComponent } from './tile-agent-mini-panel.component';

/**
 * CanvasTileComponent — renders a single chat session tile within the Orchestra Canvas.
 *
 * Each tile owns a child EnvironmentInjector that provides SESSION_CONTEXT as
 * Signal<string|null> scoped to this tile's tabId. ChatViewComponent, which injects
 * SESSION_CONTEXT optionally, will use tile-local messages/session data instead of
 * global active-tab state.
 *
 * CRITICAL CONTRACTS:
 * 1. childInjector()?.destroy() is called in ngOnDestroy — prevents EnvironmentInjector leak.
 * 2. ChatViewComponent is rendered only when childInjector() is non-null (via @if guard),
 *    guaranteeing SESSION_CONTEXT is already provided before the component bootstraps.
 * 3. onTileClick() emits focusRequested so the parent calls canvasStore.focusTile()
 *    before any message is sent — keeps global activeTabId in sync (Risk 1 mitigation).
 *
 * TASK_2025_265 Batch 3
 */
@Component({
  selector: 'ptah-canvas-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgComponentOutlet,
    LucideAngularModule,
    TileAgentIndicatorComponent,
    TileAgentMiniPanelComponent,
  ],
  template: `
    <div
      class="canvas-tile flex flex-col border rounded-lg h-full overflow-hidden transition-shadow"
      [class.border-primary]="focused()"
      [class.ring-2]="focused()"
      [class.ring-primary]="focused()"
      [class.border-base-300]="!focused()"
      (click)="onTileClick()"
    >
      <!-- Tile header: label + agent indicator + close button -->
      <div
        class="tile-header flex items-center gap-2 px-2 py-1 bg-base-300 text-xs rounded-t-lg shrink-0"
      >
        <span class="truncate flex-1 font-medium text-base-content">{{
          tabLabel()
        }}</span>
        <ptah-tile-agent-indicator [tabId]="tabId()" />
        <button
          class="btn btn-ghost btn-xs px-1 min-h-0 h-5 text-base-content/60 hover:text-base-content"
          (click)="onToggleViewMode($event)"
          [title]="
            isCompactMode() ? 'Switch to full view' : 'Switch to compact view'
          "
        >
          <lucide-angular
            [img]="isCompactMode() ? MaximizeIcon : MinimizeIcon"
            class="w-3 h-3"
          />
        </button>
        <button
          class="btn btn-ghost btn-xs px-1 min-h-0 h-5 text-base-content/60 hover:text-error"
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
  // ============================================================================
  // INPUTS / OUTPUTS
  // ============================================================================

  /** The tabId this tile is scoped to. Required — provided by OrchestraCanvasComponent. */
  readonly tabId = input.required<string>();

  /**
   * Whether this tile is the currently focused tile.
   * When true, renders a primary-colored ring border.
   */
  readonly focused = input<boolean>(false);

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

  // ============================================================================
  // VIEW CHILDREN
  // ============================================================================

  /** Reference to the agent indicator for reading expanded() and agents() signals. */
  readonly tileAgentIndicator = viewChild(TileAgentIndicatorComponent);

  // ============================================================================
  // DEPENDENCIES
  // ============================================================================

  private readonly tabManager = inject(TabManagerService);
  private readonly parentEnvInjector = inject(EnvironmentInjector);

  // ============================================================================
  // STATE
  // ============================================================================

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

  // ============================================================================
  // COMPUTED SIGNALS
  // ============================================================================

  readonly MinimizeIcon = Minimize2;
  readonly MaximizeIcon = Maximize2;

  /**
   * Display label for the tile header.
   * Prefers TabState.title (UI-derived label), then falls back to TabState.name
   * (user-provided session name), then truncates tabId as last resort.
   */
  readonly tabLabel = computed(() => {
    const tab = this.tabManager.tabs().find((t) => t.id === this.tabId());
    return tab?.title || tab?.name || `Tab ${this.tabId().slice(0, 8)}`;
  });

  /** Whether this tile is in compact view mode. */
  readonly isCompactMode = computed(
    () => this.tabManager.getTabViewMode(this.tabId()) === 'compact',
  );

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  ngOnInit(): void {
    // Create a scoped signal that returns this tile's tabId.
    // Wrapped in computed() so it satisfies Signal<string | null> contract
    // and stays reactive if tabId ever changes (signal inputs are reactive).
    const tabIdSignal = computed<string | null>(() => this.tabId());

    this._childInjector.set(
      createEnvironmentInjector(
        [{ provide: SESSION_CONTEXT, useValue: tabIdSignal }],
        this.parentEnvInjector,
      ),
    );
  }

  ngOnDestroy(): void {
    // CRITICAL: destroy child injector to free memory.
    // Skipping this causes EnvironmentInjector memory leak per Angular docs.
    this.childInjector()?.destroy();
  }

  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================

  /**
   * Emits focusRequested so the parent OrchestraCanvasComponent can call
   * canvasStore.focusTile(tabId), which in turn calls tabManager.switchTab(tabId).
   * This keeps global activeTabId in sync before any message is sent.
   */
  onTileClick(): void {
    this.focusRequested.emit(this.tabId());
  }

  /**
   * Toggles compact/full view mode for this tile.
   * Stops propagation to avoid triggering onTileClick / Gridstack drag.
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
}
