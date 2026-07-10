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
  afterNextRender,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  Plus,
  X,
  Check,
  Lock,
  Unlock,
} from 'lucide-angular';
import { NativePopoverComponent } from '@ptah-extension/ui';
import { AppStateManager } from '@ptah-extension/core';
import { SessionId } from '@ptah-extension/shared';
import { TabManagerService, ChatStore } from '@ptah-extension/chat';
import { CanvasStore } from './canvas.store';
import { CanvasLayoutService } from './canvas-layout.service';
import { CanvasWorkspaceGridComponent } from './canvas-workspace-grid.component';
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
 * Toolbar removed; session management delegated to shared sidebar in AppShellComponent.
 * Signal bridge effects watch for session requests from AppStateManager and route them
 * to CanvasStore.
 */
@Component({
  selector: 'ptah-orchestra-canvas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [CanvasStore, CanvasLayoutService],
  imports: [
    FormsModule,
    CanvasWorkspaceGridComponent,
    CanvasEmptyStateComponent,
    LucideAngularModule,
    NativePopoverComponent,
  ],
  template: `
    <div
      #canvasContainer
      class="flex flex-col h-full bg-base-100 relative"
      data-testid="canvas-grid"
    >
      <!-- One Gridstack container per retained workspace; only the active
           workspace's grid is visible, the rest stay mounted (keep-alive).
           Rendered unconditionally so switching through an empty workspace
           never tears down another workspace's tiles. -->
      @for (path of canvasStore.workspacePaths(); track path) {
        <ptah-canvas-workspace-grid
          class="flex-1 overflow-auto w-[97%]"
          [class.hidden]="path !== canvasStore.activeWorkspacePath()"
          [workspacePath]="path"
          [visible]="path === canvasStore.activeWorkspacePath()"
          [locked]="locked()"
        />
      }

      @if (canvasStore.tiles().length === 0) {
        <!-- Empty state overlay: the active workspace has no tiles -->
        <ptah-canvas-empty-state
          class="absolute inset-0 z-10"
          (createSession)="openNewSessionPopover()"
        />
      } @else {
        <!-- Lock toggle: freezes the layout and disables drag/resize -->
        <button
          class="absolute bottom-20 right-4 z-20 btn btn-circle shadow-lg"
          [title]="
            locked()
              ? 'Unlock tiles (enable drag & resize)'
              : 'Lock tiles (freeze layout)'
          "
          [attr.aria-label]="locked() ? 'Unlock tiles' : 'Lock tiles'"
          [attr.aria-pressed]="locked()"
          (click)="toggleLock()"
        >
          <lucide-angular
            [img]="locked() ? LockIcon : UnlockIcon"
            class="w-5 h-5"
          />
        </button>

        <!-- FAB: New tile button (floating bottom-right, hidden at max capacity) -->
        @if (canvasStore.canAddTile()) {
          <ptah-native-popover
            class="absolute bottom-4 right-4 z-10"
            [isOpen]="sessionPopoverOpen()"
            [placement]="'top-end'"
            [hasBackdrop]="true"
            [backdropClass]="'transparent'"
            (closed)="handleCancelSession()"
          >
            <button
              trigger
              class="btn btn-primary btn-circle shadow-lg"
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
  private readonly layoutService = inject(CanvasLayoutService);

  protected readonly PlusIcon = Plus;
  protected readonly XIcon = X;
  protected readonly CheckIcon = Check;
  protected readonly LockIcon = Lock;
  protected readonly UnlockIcon = Unlock;

  /** When locked, drag/resize is disabled and the auto-layout is frozen. */
  protected readonly locked = signal(false);

  protected readonly sessionPopoverOpen = signal(false);
  protected readonly sessionNameInput = signal('');
  private readonly sessionNameInputRef = viewChild<
    ElementRef<HTMLInputElement>
  >('sessionNameInputRef');
  private readonly emptyStateNameInputRef = viewChild<
    ElementRef<HTMLInputElement>
  >('emptyStateNameInputRef');
  private readonly canvasContainer =
    viewChild<ElementRef<HTMLElement>>('canvasContainer');

  constructor() {
    afterNextRender(() => {
      const el = this.canvasContainer()?.nativeElement;
      if (el) {
        this.layoutService.observe(el);
      }
    });
    effect(() => {
      if (this.sessionPopoverOpen()) {
        setTimeout(() => {
          const ref =
            this.sessionNameInputRef() ?? this.emptyStateNameInputRef();
          ref?.nativeElement.focus();
        }, 0);
      }
    });

    this.restoreCanvasTilesFromTabs();
    effect(() => {
      const req = this.appState.canvasSessionRequest();
      if (req) {
        const sessionId = SessionId.from(req.sessionId);
        const tabId = this.canvasStore.addTileFromSession(sessionId, req.name);
        this.appState.clearCanvasSessionRequest();
        if (tabId) {
          this.chatStore
            .switchSession(sessionId)
            .then(() => req.resolve?.(true))
            .catch(() => req.resolve?.(false));
        } else {
          req.resolve?.(false);
        }
      }
    });
    effect(() => {
      const name = this.appState.newCanvasSessionRequest();
      if (name !== null) {
        this.canvasStore.addTile(name);
        this.appState.clearNewCanvasSessionRequest();
      }
    });
    effect(() => {
      const newPath = this.tabManager.activeWorkspacePath$();
      if (!newPath) return;
      const currentTabs = untracked(() => this.tabManager.tabs());
      this.canvasStore.switchWorkspaceTiles(newPath, currentTabs);
    });
    effect(() => {
      const removed = this.tabManager.removedWorkspace$();
      if (!removed) return;
      this.canvasStore.removeWorkspaceTileState(removed);
      this.tabManager.clearRemovedWorkspace();
    });
    // Active-workspace prune: drop tiles whose tab was removed from the active
    // workspace externally (e.g. session deleted from the sidebar). Both
    // `tabs()` and `tiles()` are active-workspace-scoped, so this never touches
    // background workspaces' tiles — the workspace-swap effect (created above)
    // flips the active path first, keeping the two sides consistent on switch.
    effect(() => {
      const tabs = this.tabManager.tabs();
      const tabIds = new Set<string>(tabs.map((t) => t.id));
      const tiles = untracked(() => this.canvasStore.tiles());
      for (const tile of tiles) {
        if (!tabIds.has(tile.tabId)) {
          this.canvasStore.removeTileOnly(tile.tabId);
        }
      }
    });

    // Cross-workspace prune: a tab closed in a BACKGROUND workspace never
    // appears in the active `tabs()` signal, so the effect above can't see it.
    // React to the structured close event and drop the tile from whichever
    // workspace partition holds it.
    effect(() => {
      const closed = this.tabManager.closedTab();
      // `reset` (/clear) re-empties the tab in place — it survives, so its tile
      // must stay. Only real removals (`close`, pop-out `forceClose`) drop it.
      if (!closed || closed.kind === 'reset') return;
      untracked(() =>
        this.canvasStore.removeTileFromAnyWorkspace(closed.tabId),
      );
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
    const originalActiveTabId = this.tabManager.activeTabId();

    for (const tab of existingTabs) {
      if (tab.claudeSessionId) {
        this.canvasStore.addTileFromSession(tab.claudeSessionId, tab.name);
      } else {
        this.canvasStore.adoptTab(tab.id);
      }
    }
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
   * Toggle the locked state of the canvas.
   *
   * Locking calls Gridstack's setStatic() to disable drag/resize on every tile
   * and freezes the auto-layout effect so the current arrangement is preserved
   * across container resizes. Unlocking restores managed drag/resize behaviour.
   */
  protected toggleLock(): void {
    this.locked.set(!this.locked());
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
    // Iterate every retained workspace's tiles, not just the active one —
    // background workspaces keep their tabs open (keep-alive) and would leak
    // into the root TabManagerService otherwise.
    for (const tabId of this.canvasStore.allTabIds()) {
      this.tabManager.forceCloseTab(tabId);
    }
  }
}
