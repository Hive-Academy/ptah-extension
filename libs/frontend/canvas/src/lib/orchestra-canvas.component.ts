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
  Injector,
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
import { ActivityTickerComponent } from '@ptah-extension/chat-ui';
import {
  AppStateManager,
  BackOfficeActivityService,
  defaultSessionName,
} from '@ptah-extension/core';
import { SessionId } from '@ptah-extension/shared';
import { TabManagerService, ChatStore } from '@ptah-extension/chat';
import { CanvasStore } from './canvas.store';
import { CanvasLayoutService } from './canvas-layout.service';
import { CanvasWorkspaceGridComponent } from './canvas-workspace-grid.component';
import { CanvasEmptyStateComponent } from './canvas-empty-state.component';
import { CanvasLayoutControlsComponent } from './canvas-layout-controls.component';
import { CanvasRenderMetricsService } from './canvas-render-metrics.service';
import { CanvasLayoutPersistenceService } from './canvas-layout-persistence.service';
import type { CanvasLayoutPreset } from './canvas-layout-intent';

/**
 * OrchestraCanvasComponent — top-level panel for the Orchestra Canvas view.
 *
 * Each instance owns its own CanvasStore (via providers array), ensuring full
 * isolation between multiple canvas panels opened simultaneously.
 *
 * Layout: Gridstack.js drag-and-resize grid with one CanvasTileComponent per tile.
 *
 * Gridstack API (v12.6.0):
 * - Component selector: <gridstack>
 * - Item selector: <gridstack-item [options]="{ x, y, w, h, id }">
 * - Change event: (changeCB) — fires after drag/resize; the workspace grid
 *   translates it into tile intent (order / width), never into stored coordinates
 * - Imports: GridstackComponent + GridstackItemComponent from 'gridstack/dist/angular'
 *
 * Toolbar removed; session management delegated to shared sidebar in AppShellComponent.
 * Signal bridge effects watch for session requests from AppStateManager and route them
 * to CanvasStore.
 */
@Component({
  selector: 'ptah-orchestra-canvas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    CanvasStore,
    CanvasLayoutService,
    CanvasLayoutPersistenceService,
    CanvasRenderMetricsService,
  ],
  imports: [
    FormsModule,
    CanvasWorkspaceGridComponent,
    CanvasEmptyStateComponent,
    CanvasLayoutControlsComponent,
    ActivityTickerComponent,
    LucideAngularModule,
    NativePopoverComponent,
  ],
  template: `
    <div
      class="flex flex-col h-full bg-base-100 relative"
      data-testid="canvas-grid"
    >
      @if (canvasStore.tiles().length > 0) {
        <!-- Reserved canvas control dock outside measured session viewport -->
        <div
          class="canvas-dock flex items-center gap-2 px-3 py-1.5 border-b border-base-content/10 shrink-0 bg-base-200/50 backdrop-blur-sm z-20"
          data-testid="canvas-dock"
        >
          <!--
            Back-office activity ticker (TASK_2026_405 follow-up).

            It sits in this row's free left edge, in normal flow — not in a
            fixed overlay, and not in the navbar row, where its width would
            shift the tab strip. This cell takes every spare pixel
            (flex-1 min-w-0), so the controls after it stay pinned to the
            right edge and never move when a message arrives or changes
            length. The ticker's own button carries max-w + truncate, so a
            long summary is clipped rather than pushed into the controls.
          -->
          <div class="flex items-center min-w-0 flex-1">
            @if (!activity.isIdle()) {
              <ptah-activity-ticker
                data-testid="activity-ticker-host"
                [items]="activity.recent()"
                [idle]="activity.isIdle()"
                (activate)="openThoth()"
              />
            }
          </div>

          <ptah-canvas-layout-controls
            [locked]="locked()"
            [tileCount]="canvasStore.tiles().length"
            (lockToggled)="toggleLock()"
            (presetRequested)="applyPreset($event)"
          />

          @if (canvasStore.canAddTile()) {
            <ptah-native-popover
              [isOpen]="sessionPopoverOpen()"
              [placement]="'bottom-end'"
              [hasBackdrop]="true"
              [backdropClass]="'transparent'"
              (closed)="handleCancelSession()"
            >
              <button
                trigger
                type="button"
                class="btn btn-xs btn-primary gap-1 shadow-sm"
                title="Add new session tile"
                aria-label="Add new session tile"
                (click)="openNewSessionPopover()"
              >
                <lucide-angular [img]="PlusIcon" class="w-3.5 h-3.5" />
                <span class="text-xs font-medium">New Session</span>
              </button>

              <div
                content
                class="p-4 w-72 bg-base-200 border border-base-content/10 rounded-xl shadow-lg"
              >
                <h3 class="text-sm font-semibold mb-3 text-base-content-muted">
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
                    type="button"
                    class="btn btn-sm btn-ghost flex-1 gap-1.5 text-base-content-muted"
                    (click)="handleCancelSession()"
                  >
                    <lucide-angular [img]="XIcon" class="w-3 h-3" />
                    Cancel
                  </button>
                  <button
                    type="button"
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
        </div>
      }

      <!-- Usable session viewport -->
      <div
        #sessionViewport
        class="session-viewport flex-1 min-h-0 w-full relative overflow-hidden"
        data-testid="session-viewport"
      >
        @for (path of canvasStore.workspacePaths(); track path) {
          <ptah-canvas-workspace-grid
            class="h-full overflow-auto w-full"
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
        }
      </div>

      <!-- Standalone popover for empty state (no FAB to anchor to) -->
      @if (canvasStore.tiles().length === 0 && sessionPopoverOpen()) {
        <div
          class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50"
        >
          <div
            class="p-4 w-72 bg-base-200 border border-base-content/10 rounded-xl shadow-lg"
          >
            <h3 class="text-sm font-semibold mb-3 text-base-content-muted">
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
                type="button"
                class="btn btn-sm btn-ghost flex-1 gap-1.5 text-base-content-muted"
                (click)="handleCancelSession()"
              >
                <lucide-angular [img]="XIcon" class="w-3 h-3" />
                Cancel
              </button>
              <button
                type="button"
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

      /* The grid host measures the full container width (the layout service
         derives its column count from that measurement, so a 97% child would
         over-report by ~3% and move the 2->3 column boundary by ~45 px).
         Reserving the scrollbar gutter up front keeps the measured width from
         oscillating as the overflow-auto host gains and loses its scrollbar. */
      ptah-canvas-workspace-grid {
        scrollbar-gutter: stable;
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
  /** The dock ticker's only source of items (TASK_2026_380). */
  protected readonly activity = inject(BackOfficeActivityService);
  private readonly tabManager = inject(TabManagerService);
  private readonly chatStore = inject(ChatStore);
  private readonly layoutService = inject(CanvasLayoutService);
  private readonly layoutPersistence = inject(CanvasLayoutPersistenceService);
  private readonly injector = inject(Injector);
  private focusRequestChain = Promise.resolve();

  protected readonly PlusIcon = Plus;
  protected readonly XIcon = X;
  protected readonly CheckIcon = Check;
  protected readonly LockIcon = Lock;
  protected readonly UnlockIcon = Unlock;

  /** When locked, drag/resize is disabled and the auto-layout is frozen. */
  protected readonly locked = signal(false);

  /** Last workspace-removal `seq` this component has processed (see
   *  `removedWorkspace$`). Guarantees each removal is handled exactly once
   *  without depending on effect-flush order across independent consumers. */
  private _lastRemovedWorkspaceSeq = 0;

  protected readonly sessionPopoverOpen = signal(false);
  protected readonly sessionNameInput = signal('');
  private readonly sessionNameInputRef = viewChild<
    ElementRef<HTMLInputElement>
  >('sessionNameInputRef');
  private readonly emptyStateNameInputRef = viewChild<
    ElementRef<HTMLInputElement>
  >('emptyStateNameInputRef');
  private readonly sessionViewport =
    viewChild<ElementRef<HTMLElement>>('sessionViewport');

  constructor() {
    afterNextRender(() => {
      const el = this.sessionViewport()?.nativeElement;
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

    const initialTabs = this.tabManager.tabs();
    this.canvasStore.hydrateWorkspace(
      this.tabManager.activeWorkspacePath$(),
      initialTabs.map((tab) => tab.id),
    );
    effect(() => {
      const pendingRequests = this.appState.canvasSessionRequests();
      if (pendingRequests.length > 0) {
        const requests = untracked(() =>
          this.appState.takeCanvasSessionRequests(),
        );
        for (const req of requests) {
          const sessionId = SessionId.from(req.sessionId);
          const tabId = this.canvasStore.addTileFromSession(
            sessionId,
            req.name,
          );
          if (tabId) {
            this.chatStore
              .switchSession(sessionId)
              .then(() => req.resolve?.(true))
              .catch((error: unknown) => {
                console.error(
                  '[OrchestraCanvas] Failed to open queued session tile',
                  error,
                );
                req.resolve?.(false);
              });
          } else {
            req.resolve?.(false);
          }
        }
      }
    });
    effect(() => {
      const pendingRequests = this.appState.canvasFocusRequests();
      const workspacePath = this.canvasStore.activeWorkspacePath();
      if (
        pendingRequests.length === 0 ||
        workspacePath === null ||
        !pendingRequests.some(
          (request) => request.target.workspacePath === workspacePath,
        )
      ) {
        return;
      }
      const requests = untracked(() =>
        this.appState.takeCanvasFocusRequests(workspacePath),
      );
      for (const request of requests) {
        this.focusRequestChain = this.focusRequestChain
          .then(() => this.processFocusRequest(request))
          .catch((error: unknown) => {
            console.error(
              '[OrchestraCanvas] Failed notification focus request',
              error instanceof Error ? error.message : error,
            );
            request.resolve({ success: false, outcome: 'missing' });
          });
      }
    });
    effect(() => {
      const name = this.appState.newCanvasSessionRequest();
      if (name !== null) {
        this.canvasStore.addTile(name);
        this.appState.clearNewCanvasSessionRequest();
      }
    });
    // Adopt an already-existing tab as a tile (F-D3). The Tasks-board launch
    // creates a tab then navigates to chat; when the canvas is ALREADY mounted
    // (no remount / no workspace switch), `restoreCanvasTilesFromTabs` — which
    // only runs on mount — never sees that new tab, so it would linger as a bare
    // tab. This closes exactly that gap. `adoptTab` dedups (safe if a fresh
    // hydration already tiled it) and returns null at the 9-tile cap, in which case
    // the tab simply stays in the tab list as the graceful fallback.
    effect(() => {
      const req = this.appState.canvasTabRequest();
      if (req) {
        const adopted = this.canvasStore.adoptTab(req.tabId);
        if (adopted) {
          this.canvasStore.focusTile(req.tabId);
        }
        this.appState.clearCanvasTabRequest();
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
      if (!removed || removed.seq <= this._lastRemovedWorkspaceSeq) return;
      this._lastRemovedWorkspaceSeq = removed.seq;
      this.canvasStore.removeWorkspaceTileState(removed.path);
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

  private async processFocusRequest(
    request: import('@ptah-extension/core').CanvasFocusRequest,
  ): Promise<void> {
    const { target } = request;
    if (this.canvasStore.activeWorkspacePath() !== target.workspacePath) {
      request.resolve({ success: false, outcome: 'missing' });
      return;
    }

    const lookup = target.tabId
      ? this.tabManager.findTabByIdAcrossWorkspaces(target.tabId)
      : this.tabManager.findTabBySessionIdAcrossWorkspaces(target.sessionId);
    const existingTab =
      lookup?.workspacePath === target.workspacePath ? lookup.tab : null;
    const existingTile = existingTab
      ? this.canvasStore.tiles().some((tile) => tile.tabId === existingTab.id)
      : false;

    if (existingTab && existingTile) {
      this.canvasStore.focusTile(existingTab.id);
      await this.afterTileRender();
      request.resolve({ success: true, outcome: 'focused' });
      return;
    }

    if (existingTab) {
      const adopted = this.canvasStore.adoptTab(existingTab.id);
      if (!adopted) {
        request.resolve({ success: false, outcome: 'cap-reached' });
        return;
      }
      this.canvasStore.focusTile(existingTab.id);
      await this.afterTileRender();
      request.resolve({ success: true, outcome: 'adopted' });
      return;
    }

    const sessionExists = this.chatStore
      .sessions()
      .some((session) => session.id === target.sessionId);
    if (!sessionExists) {
      request.resolve({ success: false, outcome: 'missing' });
      return;
    }
    const tabId = this.canvasStore.addTileFromSession(
      SessionId.from(target.sessionId),
    );
    if (!tabId) {
      request.resolve({ success: false, outcome: 'cap-reached' });
      return;
    }
    try {
      await this.chatStore.switchSession(SessionId.from(target.sessionId));
      this.canvasStore.focusTile(tabId);
      await this.afterTileRender();
      request.resolve({ success: true, outcome: 'opened' });
    } catch (error: unknown) {
      console.error(
        '[OrchestraCanvas] Failed to open notification target',
        error instanceof Error ? error.message : error,
      );
      request.resolve({ success: false, outcome: 'missing' });
    }
  }

  private afterTileRender(): Promise<void> {
    return new Promise<void>((resolve) => {
      afterNextRender(resolve, { injector: this.injector });
    });
  }

  /** Open the session name popover. */
  protected openNewSessionPopover(): void {
    this.sessionNameInput.set('');
    this.sessionPopoverOpen.set(true);
  }

  /** Create session with the entered (or default) name. */
  protected handleCreateSession(): void {
    const name = this.sessionNameInput().trim();
    const sessionName = name || defaultSessionName();
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
   * across container resizes. `onGridChange` also refuses to write intent while
   * locked, so locked means *no layout writes at all* — not merely no layout
   * recomputation. Unlocking restores managed drag/resize behaviour.
   */
  protected toggleLock(): void {
    const locked = !this.locked();
    this.locked.set(locked);
    this.canvasStore.setLayoutLocked(locked);
  }

  protected applyPreset(preset: CanvasLayoutPreset): void {
    this.canvasStore.applyPreset(preset);
  }

  /**
   * The dock ticker's click target. It mirrors `ElectronShellComponent`'s
   * handler so the ticker opens the same destination from either host.
   */
  protected openThoth(): void {
    if (!this.appState.thothFirstRunDismissed()) {
      this.appState.dismissThothFirstRun();
    }
    this.appState.setCurrentView('thoth');
  }

  ngOnDestroy(): void {
    this.layoutPersistence.flush();
  }
}
