import {
  Component,
  ChangeDetectionStrategy,
  OnDestroy,
  inject,
  effect,
  computed,
  signal,
  viewChild,
  viewChildren,
  ElementRef,
  untracked,
  afterNextRender,
  Injector,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, X, Check } from 'lucide-angular';
import { NativePopoverComponent } from '@ptah-extension/ui';
import {
  AppStateManager,
  defaultSessionName,
  SURFACE_ACTIVE,
} from '@ptah-extension/core';
import { SessionId } from '@ptah-extension/shared';
import { TabManagerService, ChatStore } from '@ptah-extension/chat';
import { CanvasStore } from './canvas.store';
import { CanvasLayoutService } from './canvas-layout.service';
// Deferred (`@defer` only, never a value here): its own declaration, and no
// eager file imports it, so the compiler and esbuild move it to a lazy chunk.
import { CanvasNeedsYouQueueComponent } from './canvas-needs-you-queue.component';
import { CanvasRenderMetricsService } from './canvas-render-metrics.service';
import { CanvasLayoutPersistenceService } from './canvas-layout-persistence.service';
import { MAX_CANVAS_TILES } from './canvas-layout-intent';
import { RUNNING_CAP_MESSAGE } from './canvas-running-cap';
import { CanvasDetailService } from './canvas-detail/canvas-detail.service';
import {
  CanvasRailBoardComponent,
  type CanvasBoardNotice,
} from './canvas-rail/canvas-rail-board.component';
import {
  focusRailSelectButton,
  handleCanvasRailKeydown,
} from './canvas-rail/canvas-rail-keyboard';

/** Same wording as the Rail footer's disabled reason (`canvas-rail.component.ts`). */
const TILE_BOUND_MESSAGE = `The board holds ${MAX_CANVAS_TILES} sessions. Close one to add another.`;

/**
 * OrchestraCanvasComponent — top-level panel for the Orchestra Canvas view.
 *
 * Each instance owns its own CanvasStore (via providers array), ensuring full
 * isolation between multiple canvas panels opened simultaneously.
 *
 * Layout: the Rail board (`ptah-canvas-rail-board`) is the only board, one per
 * workspace path; only the active workspace's board is visible. A stored
 * legacy Grid board renders as Rail.
 *
 * New session: one named popover anchored to the invoking board button.
 *
 * Toolbar removed; the Rail footer opens Previous sessions in canvas mode.
 * Signal bridge effects watch for session requests from AppStateManager and route them
 * to CanvasStore.
 */
@Component({
  selector: 'ptah-orchestra-canvas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:keydown)': 'onRailKeydown($event)' },
  providers: [
    CanvasStore,
    CanvasLayoutService,
    CanvasLayoutPersistenceService,
    CanvasRenderMetricsService,
    CanvasDetailService,
  ],
  imports: [
    FormsModule,
    CanvasNeedsYouQueueComponent,
    CanvasRailBoardComponent,
    LucideAngularModule,
    NativePopoverComponent,
  ],
  template: `
    <div
      class="flex flex-col h-full bg-base-100 relative"
      data-testid="canvas-grid"
    >
      <div
        #sessionViewport
        class="session-viewport flex-1 min-h-0 w-full relative overflow-hidden flex flex-col"
        data-testid="session-viewport"
      >
        <div class="shrink-0 flex justify-end px-3 pt-2">
          @defer (on idle) {
            <ptah-canvas-needs-you-queue />
          } @placeholder {
            <span
              class="btn btn-xs btn-ghost invisible border border-base-300"
              aria-hidden="true"
              >All clear</span
            >
          }
        </div>
        <div class="flex-1 min-h-0" data-testid="canvas-interactive">
          @for (path of canvasStore.workspacePaths(); track path) {
            <ptah-canvas-rail-board
              [workspacePath]="path"
              [visible]="path === canvasStore.activeWorkspacePath()"
              [notice]="
                path === canvasStore.activeWorkspacePath()
                  ? boardNotice()
                  : null
              "
              (noticeDismissed)="dismissNotice($event)"
              (newSessionRequested)="openNewSessionPopover($event)"
            />
          }
        </div>
      </div>
      @if (canvasStore.canAddTile()) {
        <!-- Keep the panel outside viewport layout while Floating UI positions it. -->
        <div class="absolute top-0 left-0 z-20">
          <ptah-native-popover
            [isOpen]="sessionPopoverOpen()"
            [anchor]="sessionPopoverAnchor()"
            [placement]="'bottom-end'"
            [hasBackdrop]="true"
            [backdropClass]="'transparent'"
            (closed)="handleCancelSession()"
          >
            <div
              content
              class="surface-3 p-4 w-72 rounded-xl"
              data-testid="canvas-new-session-popover"
            >
              <h3 class="text-sm font-semibold mb-3 text-base-content-muted">
                New Session
              </h3>
              <input
                #sessionNameInputRef
                type="text"
                class="input input-sm input-bordered w-full mb-3 bg-base-100 border-base-content/10 focus:border-primary"
                placeholder="Enter session name (optional)"
                aria-label="Session name"
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
    `,
  ],
})
export class OrchestraCanvasComponent implements OnDestroy {
  readonly canvasStore = inject(CanvasStore);
  private readonly activeRailBoards = viewChildren(CanvasRailBoardComponent);

  protected onRailKeydown(event: KeyboardEvent): void {
    const board = this.visibleRailBoard();
    if (!board) return;
    handleCanvasRailKeydown(event, {
      surfaceActive: this.surfaceActive(),
      host: this.sessionViewport()?.nativeElement ?? null,
      orderedIds: board.orderedTiles().map((tile) => tile.tabId),
      focusedId: board.focusedId(),
      focus: (id) => board.focus(id),
      focusSelectButton: (id) => {
        const card = [
          ...(this.sessionViewport()?.nativeElement.querySelectorAll<HTMLElement>(
            '[data-rail-card]',
          ) ?? []),
        ].find((item) => item.dataset['tabId'] === id);
        focusRailSelectButton(card);
      },
      focusInnerButtons: true,
    });
  }

  private visibleRailBoard(): CanvasRailBoardComponent | undefined {
    return this.activeRailBoards?.().find((candidate) => candidate.visible());
  }

  private readonly appState = inject(AppStateManager);
  private readonly surfaceActive =
    inject(SURFACE_ACTIVE, { optional: true }) ?? signal(false);
  private readonly tabManager = inject(TabManagerService);
  private readonly chatStore = inject(ChatStore);
  private readonly layoutService = inject(CanvasLayoutService);
  protected readonly layoutPersistence = inject(CanvasLayoutPersistenceService);
  private readonly injector = inject(Injector);
  private unsubscribeTabClosed: (() => void) | null = null;
  private focusRequestChain = Promise.resolve();

  protected readonly XIcon = X;
  protected readonly CheckIcon = Check;

  /** Last workspace-removal `seq` this component has processed (see
   *  `removedWorkspace$`). Guarantees each removal is handled exactly once
   *  without depending on effect-flush order across independent consumers. */
  private _lastRemovedWorkspaceSeq = 0;

  protected readonly sessionPopoverOpen = signal(false);
  protected readonly sessionPopoverAnchor = signal<HTMLElement | null>(null);
  private readonly dismissedNoticeKey = signal<string | null>(null);
  private readonly noticeRevision = signal(0);
  protected readonly boardNotice = computed<CanvasBoardNotice | null>(() => {
    const path = this.canvasStore.activeWorkspacePath() ?? '';
    const revision = this.noticeRevision();
    let notice: CanvasBoardNotice | null = null;
    if (this.layoutPersistence.writeFailed()) {
      notice = {
        kind: 'write-failure',
        text: 'Board layout could not be saved. Changes stay for this session.',
        key: `write-failure:${path}:${revision}`,
      };
    } else if (this.layoutPersistence.readOnlyPaths().has(path)) {
      notice = {
        kind: 'read-only',
        text: 'This board layout was saved by a newer Ptah version. Changes here are not saved.',
        key: `read-only:${path}:${revision}`,
      };
    } else if (this.headerMessage()) {
      notice = {
        kind: 'cap',
        text: this.headerMessage()!,
        key: `cap:${path}:${this.headerMessage()}:${revision}`,
      };
    }
    return notice?.key === this.dismissedNoticeKey() ? null : notice;
  });
  protected readonly sessionNameInput = signal('');
  protected readonly runningCapMessage = RUNNING_CAP_MESSAGE;
  protected readonly headerMessage = signal<string | null>(null);
  private readonly sessionNameInputRef = viewChild<
    ElementRef<HTMLInputElement>
  >('sessionNameInputRef');
  private readonly sessionViewport =
    viewChild<ElementRef<HTMLElement>>('sessionViewport');

  constructor() {
    let priorSource = '';
    effect(() => {
      const source = [
        this.canvasStore.activeWorkspacePath() ?? '',
        this.surfaceActive(),
        this.layoutPersistence.writeFailed(),
        this.layoutPersistence.writeFailureCount(),
        this.layoutPersistence
          .readOnlyPaths()
          .has(this.canvasStore.activeWorkspacePath() ?? ''),
        this.headerMessage() ?? '',
      ].join('|');
      if (priorSource && priorSource !== source)
        this.noticeRevision.update((value) => value + 1);
      priorSource = source;
    });
    afterNextRender(() => {
      const el = this.sessionViewport()?.nativeElement;
      if (el) {
        this.layoutService.observe(el);
      }
    });
    effect(() => {
      if (this.sessionPopoverOpen()) {
        setTimeout(() => {
          this.sessionNameInputRef()?.nativeElement.focus();
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
        if (this.canvasStore.canStartRunningSession()) {
          if (!this.canvasStore.addTile(name))
            this.headerMessage.set(TILE_BOUND_MESSAGE);
        } else {
          this.headerMessage.set(this.runningCapMessage);
        }
        this.appState.clearNewCanvasSessionRequest();
      }
    });
    // A refused create stays announced until both the running slot and the
    // tile bound allow a new session again.
    effect(() => {
      if (
        this.canvasStore.canStartRunningSession() &&
        this.canvasStore.canAddTile()
      ) {
        this.headerMessage.set(null);
      }
    });
    // Reaching the tile bound unmounts the popover (`@if (canAddTile())`)
    // without a `closed` event. Drop its open state and typed name here so a
    // later tile close mounts it closed and empty, never re-opened.
    effect(() => {
      if (!this.canvasStore.canAddTile()) {
        untracked(() => this.closeSessionPopover());
      }
    });
    // Adopt already-existing tabs as tiles (F-D3). The Tasks-board launch and
    // agent-child adoption create tabs outside the canvas; when the canvas is
    // ALREADY mounted (no remount / no workspace switch), first-visit
    // hydration never sees those new tabs, so they would linger as bare tabs.
    // This closes exactly that gap. The queue is drained in one pass, so a
    // burst — e.g. late adoption of several agent children — tiles every
    // child. A request whose `workspacePath` is no longer the workspace this
    // canvas is showing (queued while the canvas wasn't mounted, with a
    // workspace switch in between) is DROPPED, never tiled into the wrong
    // board; `null` (single tab set, VS Code panel) normalizes to the implicit
    // partition, matching `ensureActivePath`'s `?? IMPLICIT_WORKSPACE_PATH`.
    // `adoptTab` dedups (safe if a fresh hydration already tiled it, and
    // re-adoption never doubles a tile) and returns null at `MAX_CANVAS_TILES`,
    // in which case the tab simply stays in the tab list as the graceful
    // fallback. `focus: false` (agent children) appends the tile without
    // switching the active tab.
    // KNOWN GAP (TASK_2026_471): the refusal is not reported back, so a caller
    // that also prefills the composer for this tab prefills a surface nobody
    // mounted. Raising the cap makes it rarer; it does not close it.
    effect(() => {
      const pending = this.appState.canvasTabRequests();
      if (pending.length === 0) return;
      const requests = untracked(() => this.appState.takeCanvasTabRequests());
      const activeWorkspacePath = this.canvasStore.activeWorkspacePath() ?? '';
      for (const req of requests) {
        if ((req.workspacePath ?? '') !== activeWorkspacePath) continue;
        const adopted = this.canvasStore.adoptTab(req.tabId);
        if (adopted && req.focus !== false) {
          this.canvasStore.focusTile(req.tabId);
        }
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
    this.unsubscribeTabClosed = this.tabManager.onTabClosed((closed) => {
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

  /**
   * Open the shared session popover from the actual board button.
   */
  protected dismissNotice(key: string): void {
    this.dismissedNoticeKey.set(key);
  }

  protected openNewSessionPopover(anchor: HTMLElement): void {
    const blocked = this.createBlockReason();
    if (blocked) {
      this.noticeRevision.update((value) => value + 1);
      this.headerMessage.set(blocked);
      return;
    }
    this.sessionPopoverAnchor.set(anchor);
    this.sessionNameInput.set('');
    this.sessionPopoverOpen.set(true);
  }

  /**
   * Create a session with the entered name. An empty name uses
   * `defaultSessionName()`, which keeps the first-prompt auto-rename. After a
   * successful add the visible Rail board resets its geometry baseline,
   * focuses the new tile and anchors the rail scroll on it.
   */
  protected handleCreateSession(): void {
    const blocked = this.createBlockReason();
    const tabId = blocked
      ? null
      : this.canvasStore.addTile(
          this.sessionNameInput().trim() || defaultSessionName(),
        );
    this.sessionPopoverOpen.set(false);
    this.sessionNameInput.set('');
    this.sessionPopoverAnchor()?.focus();
    if (!tabId) {
      this.headerMessage.set(blocked ?? TILE_BOUND_MESSAGE);
      return;
    }
    const board = this.visibleRailBoard();
    if (board) board.sessionCreated(tabId);
    else this.canvasStore.focusTile(tabId);
  }

  /** Cancel session creation. */
  protected handleCancelSession(): void {
    const wasOpen = this.sessionPopoverOpen();
    this.closeSessionPopover();
    if (wasOpen) this.sessionPopoverAnchor()?.focus();
  }

  private closeSessionPopover(): void {
    this.sessionPopoverOpen.set(false);
    this.sessionNameInput.set('');
  }

  private createBlockReason(): string | null {
    if (!this.canvasStore.canStartRunningSession())
      return this.runningCapMessage;
    if (!this.canvasStore.canAddTile()) return TILE_BOUND_MESSAGE;
    return null;
  }

  ngOnDestroy(): void {
    this.unsubscribeTabClosed?.();
    this.unsubscribeTabClosed = null;
    this.layoutPersistence.flush();
  }
}
