import {
  Component,
  ChangeDetectionStrategy,
  OnDestroy,
  inject,
  effect,
  signal,
  viewChild,
  ElementRef,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GridStackOptions } from 'gridstack';
import {
  GridstackComponent,
  GridstackItemComponent,
  nodesCB,
} from 'gridstack/dist/angular';
import { LucideAngularModule, Plus, X, Check } from 'lucide-angular';
import { NativePopoverComponent } from '@ptah-extension/ui';
import { AppStateManager } from '@ptah-extension/core';
import { TabManagerService, ChatStore } from '@ptah-extension/chat';
import { CanvasStore } from './canvas.store';
import { CanvasTileComponent } from './canvas-tile.component';
import { CanvasEmptyStateComponent } from './canvas-empty-state.component';

/**
 * OrchestraCanvasComponent — top-level panel for the Orchestra Canvas view.
 *
 * Each instance owns its own CanvasStore (via providers array), ensuring full
 * isolation between multiple canvas panels opened simultaneously.
 *
 * Layout: Gridstack.js drag-and-resize grid with one CanvasTileComponent per tile.
 *
 * Gridstack API (v12.5.0):
 * - Component selector: <gridstack>
 * - Item selector: <gridstack-item [options]="{ x, y, w, h, id }">
 * - Change event: (changeCB) — fires after drag/resize; nodes carry updated positions
 * - Imports: GridstackComponent + GridstackItemComponent from 'gridstack/dist/angular'
 *
 * TASK_2025_271: Simplified — toolbar removed, session management delegated to shared
 * sidebar in AppShellComponent. Signal bridge effects watch for session requests from
 * AppStateManager and route them to CanvasStore.
 *
 * TASK_2025_265 Batch 3 (original)
 */
@Component({
  selector: 'ptah-orchestra-canvas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [CanvasStore],
  imports: [
    FormsModule,
    GridstackComponent,
    GridstackItemComponent,
    CanvasTileComponent,
    CanvasEmptyStateComponent,
    LucideAngularModule,
    NativePopoverComponent,
  ],
  template: `
    <div class="flex flex-col h-full bg-base-100 relative">
      @if (canvasStore.tiles().length === 0) {
        <!-- Empty state: no tiles yet -->
        <ptah-canvas-empty-state (createSession)="openNewSessionPopover()" />
      } @else {
        <!-- Gridstack drag-and-resize grid -->
        <div class="flex-1 overflow-auto">
          <gridstack [options]="gsOptions" (changeCB)="onGridChange($event)">
            @for (tile of canvasStore.tiles(); track tile.tabId) {
              <gridstack-item
                [options]="{
                  x: tile.position.x,
                  y: tile.position.y,
                  w: tile.position.w,
                  h: tile.position.h,
                  id: tile.tabId,
                }"
              >
                <ptah-canvas-tile
                  [tabId]="tile.tabId"
                  [focused]="canvasStore.focusedTabId() === tile.tabId"
                  (focusRequested)="canvasStore.focusTile($event)"
                  (closeRequested)="canvasStore.removeTile($event)"
                />
              </gridstack-item>
            }
          </gridstack>
        </div>

        <!-- FAB: New tile button (floating bottom-right, hidden at max capacity) -->
        @if (canvasStore.canAddTile()) {
          <ptah-native-popover
            [isOpen]="sessionPopoverOpen()"
            [placement]="'top'"
            [hasBackdrop]="true"
            [backdropClass]="'transparent'"
            (closed)="handleCancelSession()"
          >
            <button
              trigger
              class="absolute bottom-4 right-4 btn btn-primary btn-circle shadow-lg z-10"
              title="Add new session tile"
              aria-label="Add new session tile"
              (click)="openNewSessionPopover()"
            >
              <lucide-angular [img]="PlusIcon" class="w-5 h-5" />
            </button>

            <div
              content
              class="p-4 w-72 bg-base-200 border border-base-content/10 rounded-xl shadow-lg"
            >
              <h3 class="text-sm font-semibold mb-3 text-base-content/90">
                New Session
              </h3>
              <input
                #sessionNameInputRef
                type="text"
                class="input input-sm input-bordered w-full mb-3 bg-base-100 border-base-content/10 focus:border-primary"
                placeholder="Enter session name (optional)"
                [(ngModel)]="sessionNameInput"
                (keydown.enter)="
                  handleCreateSession();
                  $event.preventDefault();
                  $event.stopPropagation()
                "
                (keydown.escape)="handleCancelSession()"
              />
              <div class="flex gap-2">
                <button
                  class="btn btn-sm btn-ghost flex-1 gap-1.5 text-base-content/60"
                  (click)="handleCancelSession()"
                >
                  <lucide-angular [img]="XIcon" class="w-3 h-3" />
                  Cancel
                </button>
                <button
                  class="btn btn-sm btn-primary flex-1 gap-1.5"
                  (click)="handleCreateSession()"
                >
                  <lucide-angular [img]="CheckIcon" class="w-3 h-3" />
                  Create
                </button>
              </div>
            </div>
          </ptah-native-popover>
        }
      }

      <!-- Standalone popover for empty state (no FAB to anchor to) -->
      @if (canvasStore.tiles().length === 0 && sessionPopoverOpen()) {
        <div
          class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50"
        >
          <div
            class="p-4 w-72 bg-base-200 border border-base-content/10 rounded-xl shadow-lg"
          >
            <h3 class="text-sm font-semibold mb-3 text-base-content/90">
              New Session
            </h3>
            <input
              #emptyStateNameInputRef
              type="text"
              class="input input-sm input-bordered w-full mb-3 bg-base-100 border-base-content/10 focus:border-primary"
              placeholder="Enter session name (optional)"
              [(ngModel)]="sessionNameInput"
              (keydown.enter)="
                handleCreateSession();
                $event.preventDefault();
                $event.stopPropagation()
              "
              (keydown.escape)="handleCancelSession()"
            />
            <div class="flex gap-2">
              <button
                class="btn btn-sm btn-ghost flex-1 gap-1.5 text-base-content/60"
                (click)="handleCancelSession()"
              >
                <lucide-angular [img]="XIcon" class="w-3 h-3" />
                Cancel
              </button>
              <button
                class="btn btn-sm btn-primary flex-1 gap-1.5"
                (click)="handleCreateSession()"
              >
                <lucide-angular [img]="CheckIcon" class="w-3 h-3" />
                Create
              </button>
            </div>
          </div>
          <!-- Backdrop -->
          <div
            class="fixed inset-0 -z-10"
            (click)="handleCancelSession()"
          ></div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }

      gridstack {
        min-height: 200px;
      }
    `,
  ],
})
export class OrchestraCanvasComponent implements OnDestroy {
  readonly canvasStore = inject(CanvasStore);
  private readonly appState = inject(AppStateManager);
  private readonly tabManager = inject(TabManagerService);
  private readonly chatStore = inject(ChatStore);

  protected readonly PlusIcon = Plus;
  protected readonly XIcon = X;
  protected readonly CheckIcon = Check;

  protected readonly sessionPopoverOpen = signal(false);
  protected readonly sessionNameInput = signal('');
  private readonly sessionNameInputRef = viewChild<
    ElementRef<HTMLInputElement>
  >('sessionNameInputRef');
  private readonly emptyStateNameInputRef = viewChild<
    ElementRef<HTMLInputElement>
  >('emptyStateNameInputRef');

  /**
   * Gridstack grid configuration.
   * - column: 12-column grid (standard dashboard grid)
   * - cellHeight: 80px per row unit
   * - float: true allows free placement without auto-compaction
   * - margin: gap between tiles
   */
  readonly gsOptions: GridStackOptions = {
    column: 12,
    cellHeight: 80,
    float: true,
    margin: 8,
    draggable: { handle: '.tile-header' },
    resizable: { handles: 'e, se, s, sw, w' },
    animate: true,
  };

  constructor() {
    // Auto-focus session name input when popover opens
    effect(() => {
      if (this.sessionPopoverOpen()) {
        setTimeout(() => {
          const ref =
            this.sessionNameInputRef() ?? this.emptyStateNameInputRef();
          ref?.nativeElement.focus();
        }, 0);
      }
    });

    // Restore canvas tiles from tabs that were persisted to localStorage.
    // TabManagerService restores tabs before this component initializes; without
    // this sync, the canvas starts empty while the hidden single-mode ChatView
    // already shows the restored session — causing a session to appear in Chat
    // but not in Canvas despite Canvas being the initial view.
    this.restoreCanvasTilesFromTabs();

    // Signal bridge: watch for session load requests from shared sidebar
    effect(() => {
      const req = this.appState.canvasSessionRequest();
      if (req) {
        const tabId = this.canvasStore.addTileFromSession(
          req.sessionId,
          req.name,
        );
        this.appState.clearCanvasSessionRequest();
        // Load the session's messages into the tab via ChatStore's full load flow
        // (openSessionTab only creates an empty tab — switchSession triggers the RPC)
        if (tabId) {
          this.chatStore.switchSession(req.sessionId);
        }
      }
    });

    // Signal bridge: watch for new session requests from shared header
    effect(() => {
      const name = this.appState.newCanvasSessionRequest();
      if (name !== null) {
        this.canvasStore.addTile(name);
        this.appState.clearNewCanvasSessionRequest();
      }
    });

    // Reactive cleanup: remove orphaned tiles whose backing tab no longer exists.
    // This handles the case where a session is deleted from the sidebar, which
    // closes the tab via TabManagerService but leaves the canvas tile stale.
    // Uses untracked() for tiles read to prevent re-triggering when removeTileOnly
    // updates the _tiles signal.
    effect(() => {
      const tabs = this.tabManager.tabs(); // reactive dependency
      const tabIds = new Set(tabs.map((t) => t.id));
      const tiles = untracked(() => this.canvasStore.tiles());
      for (const tile of tiles) {
        if (!tabIds.has(tile.tabId)) {
          this.canvasStore.removeTileOnly(tile.tabId);
        }
      }
    });
  }

  /**
   * Restore canvas tiles from tabs that were persisted in localStorage.
   * Runs once at construction — creates a canvas tile for each pre-existing
   * tab so the canvas reflects sessions the user had open in their last session.
   */
  private restoreCanvasTilesFromTabs(): void {
    const existingTabs = this.tabManager.tabs();
    if (existingTabs.length === 0) return;

    // Capture the user's previously active tab BEFORE the loop, because
    // addTileFromSession → openSessionTab → switchTab overwrites activeTabId.
    const originalActiveTabId = this.tabManager.activeTabId();

    for (const tab of existingTabs) {
      if (tab.claudeSessionId) {
        // Tab has a session — add as session tile (deduplicates internally)
        this.canvasStore.addTileFromSession(tab.claudeSessionId, tab.name);
      } else {
        // Tab without a session (blank/new) — adopt existing tab as tile
        this.canvasStore.adoptTab(tab.id);
      }
    }

    // Restore focus to the user's previously active tab
    if (
      originalActiveTabId &&
      this.canvasStore.tiles().some((t) => t.tabId === originalActiveTabId)
    ) {
      this.canvasStore.focusTile(originalActiveTabId);
    }
  }

  /**
   * Generate slugified default session name from current timestamp.
   * Format: session-MM-DD-HH-mm (e.g., "session-04-14-09-30")
   */
  private generateDefaultSessionName(): string {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `session-${month}-${day}-${hours}-${minutes}`;
  }

  /** Open the session name popover. */
  protected openNewSessionPopover(): void {
    this.sessionNameInput.set('');
    this.sessionPopoverOpen.set(true);
  }

  /** Create session with the entered (or default) name. */
  protected handleCreateSession(): void {
    const name = this.sessionNameInput().trim();
    const sessionName = name || this.generateDefaultSessionName();
    this.canvasStore.addTile(sessionName);
    this.sessionPopoverOpen.set(false);
  }

  /** Cancel session creation. */
  protected handleCancelSession(): void {
    this.sessionPopoverOpen.set(false);
    this.sessionNameInput.set('');
  }

  /**
   * Close all tiles on destroy to prevent orphaned tabs in the root TabManagerService.
   * CanvasStore is scoped per component instance, so its tabs must be cleaned up here.
   *
   * Uses forceCloseTab (no confirmation dialog) since the component is being destroyed
   * — either the app is shutting down or the canvas is being fully removed from the DOM.
   * The async removeTile() would show spurious confirmation dialogs during teardown.
   */
  ngOnDestroy(): void {
    const tiles = this.canvasStore.tiles();
    for (const tile of tiles) {
      this.tabManager.forceCloseTab(tile.tabId);
    }
  }

  /**
   * Called by Gridstack whenever tiles are moved or resized.
   * Persists the new position into CanvasStore so positions survive re-renders.
   *
   * GridStackNode.id is set to tile.tabId in the item options above, so we can
   * correlate each changed node back to the correct CanvasTile.
   */
  onGridChange(data: nodesCB): void {
    for (const node of data.nodes) {
      if (node.id == null) continue;
      this.canvasStore.updateTilePosition(node.id, {
        x: node.x ?? 0,
        y: node.y ?? 0,
        w: node.w ?? 4,
        h: node.h ?? 6,
      });
    }
  }
}
