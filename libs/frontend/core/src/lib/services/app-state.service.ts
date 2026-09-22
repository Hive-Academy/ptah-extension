/**
 * App State Manager
 *
 * Keeping essential navigation and loading state.
 */

import {
  Injectable,
  signal,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import {
  SessionId,
  WorkspaceInfo,
  MESSAGE_TYPES,
  type NewProjectIntake,
} from '@ptah-extension/shared';
import { MessageHandler } from './message-router.types';
import type {
  NotificationFocusResult,
  NotificationFocusTarget,
} from '../tokens/notification-focus-router.token';
import {
  SurfaceRouterService,
  surfaceNavigationLanded,
  type SurfaceNavigationResult,
} from '../routing/surface-router.service';
import {
  DEFAULT_SURFACE_ID,
  isAcceptedInitialView,
  isSurfaceRouteId,
  type ViewType,
} from '../routing/surface-routes';

/**
 * Re-exported from `../routing/surface-routes`, where it now lives beside
 * `SURFACE_ROUTE_IDS` — the one list of route ids it enumerates. Every caller
 * keeps importing it from here (or from the `@ptah-extension/core` barrel).
 */
export type { ViewType };

/**
 * Active tab id within the Thoth hub. Mirrors the union exported from
 * `@ptah-extension/thoth-shell`; declared here so app-state callers
 * (dashboard, app-shell) don't require a cross-library import for the type.
 */
export type ThothActiveTabId = 'memory' | 'skills' | 'cron' | 'gateway';

/** Layout mode for the chat view content area: single tab or canvas grid */
export type LayoutMode = 'single' | 'grid';

/**
 * `localStorage` key used to persist the "Thoth first-run hint dismissed"
 * flag. Same persistence layer as `ptah-layout-mode` — kept as a module
 * constant so tests can reference it without duplicating the literal.
 */
export const THOTH_FIRST_RUN_DISMISSED_KEY = 'ptah-thoth-first-run-dismissed';

/**
 * Legacy `localStorage` key used before the Thoth rename. The
 * migration shim in {@link AppStateManager.initializeState} reads this key
 * once on startup if the new key is missing, copies it forward, and removes
 * the old entry so user state is preserved across the rename upgrade.
 */
export const LEGACY_HERMES_FIRST_RUN_DISMISSED_KEY =
  'ptah-hermes-first-run-dismissed';

/**
 * Request to open the harness-builder surface and run an agent-driven
 * workflow. `new-project` auto-starts the workflow with the seed prompt;
 * `configure-harness` opens the surface and waits for the first user turn.
 */
export interface HarnessWorkflowRequest {
  mode: 'new-project' | 'configure-harness';
  /** Prompt sent to the agent. Not what the transcript renders. */
  seedPrompt?: string;
  /**
   * Setup Hub intake answers behind `seedPrompt`, so the harness surface can
   * show the user's own words as the first bubble rather than the full
   * instruction prompt. `new-project` only.
   */
  intake?: NewProjectIntake;
}

export type SettingsTabId =
  'claude-auth' | 'orchestration' | 'pro-features' | 'tools';

export interface PendingSettingsTab {
  tab: SettingsTabId;
  providerId?: string;
}

/**
 * Request to launch a chat session seeded with an initial prompt — e.g. the
 * standalone Tasks board firing `/orchestrate <TASK_ID>`. Consumed by
 * the chat lib (a root-provided bridge service), which creates/focuses a
 * session, prefills its composer, then settles `resolve`. Kept in `core` so
 * `tasks-ui` never imports `chat` — the same
 * signal-bridge inversion used by {@link CanvasSessionRequest} and
 * {@link HarnessWorkflowRequest} (NFR-11 / D7).
 */
export interface ChatPromptRequest {
  /** Prompt text submitted as the new session's first message. */
  prompt: string;
  /** Optional session/tab display name (e.g. the originating task id). */
  sessionName?: string;
  /**
   * Internal: resolver wired by {@link AppStateManager.requestChatPrompt} so the
   * caller can `await` the launch outcome. The chat consumer resolves
   * `{ success: true }` once the prompt was submitted, or
   * `{ success: false, error }` on failure. Optional so legacy callers / tests
   * that fabricate the request shape still type-check.
   */
  resolve?: (result: { success: boolean; error?: string }) => void;
}

/** Request to prefill one chat surface's composer without sending it. */
export interface ComposerPrefillRequest {
  readonly seq: number;
  readonly text: string;
  readonly tabId: string | null;
}

/**
 * Queued request to open/focus a session in a canvas tile.
 *
 * Requests are consumed in FIFO order by `OrchestraCanvasComponent`. The
 * resolver settles after the session switch completes, or with `false` when
 * the tile cap is hit or the request times out before consumption.
 */
export interface CanvasSessionRequest {
  sessionId: string;
  name?: string;
  /**
   * Internal: resolver wired up by {@link AppStateManager.requestCanvasSession}
   * so the caller can `await` the canvas adoption outcome. The canvas effect
   * in `OrchestraCanvasComponent` resolves this with `true` when a tile is
   * (re-)bound to the requested session, or `false` when the tile cap is hit
   * / the canvas is not mounted. Kept optional so callers / tests that
   * fabricate the request shape still type-check.
   */
  resolve?: (success: boolean) => void;
}

export interface CanvasFocusRequest {
  readonly id: number;
  readonly target: NotificationFocusTarget;
  readonly resolve: (result: NotificationFocusResult) => void;
}

/**
 * Request to adopt an existing chat tab as a canvas tile (F-D3). Fire-and-forget
 * (no resolver): the canvas effect dedups and respects the tile cap, and nothing
 * consumes it in single layout, so it is a harmless no-op there.
 */
export interface CanvasTabRequest {
  tabId: string;
  name?: string;
}

export interface AppState {
  currentView: ViewType;
  isLoading: boolean;
  statusMessage: string;
  workspaceInfo: WorkspaceInfo | null;
  isConnected: boolean;
}

/**
 * Sentinel workspace key holding the view slice created during bootstrap,
 * before any real workspace path has arrived from
 * `WorkspaceCoordinatorService`. `initializeState` writes `window.initialView`
 * here, and the first {@link AppStateManager.switchWorkspace} migrates the
 * slice onto the real path so that view is never orphaned. In the VS Code
 * webview — which is single-root and never switches — every slice read and
 * write stays on this key for the lifetime of the webview.
 *
 * Mirrors `IMPLICIT_WORKSPACE_PATH` in `CanvasStore` and
 * `TribunalStateService`, the two surfaces already partitioned this way.
 */
const IMPLICIT_WORKSPACE_PATH = '';

/**
 * Which surface a single workspace was last looking at, and where inside that
 * surface.
 *
 * `currentView` here is a **memory, not the live truth** — the Router owns the
 * live surface and {@link AppStateManager.currentView} reads it from
 * {@link SurfaceRouterService}. This field records the last surface the
 * workspace settled on so {@link AppStateManager.switchWorkspace} can navigate
 * back to it, which is the per-workspace behaviour TASK_2026_195 added.
 *
 * Every write to it is gated on {@link AppStateManager._settlementOwner}: a
 * settled surface may only be stamped onto the workspace that owns it, never
 * onto whichever workspace happens to be active when the write runs
 * (TASK_2026_524 revision 1, F1).
 *
 * `thothActiveTab` and `marketplaceActiveProvider` are the same kind of
 * pointer one level down — which tab of the `'thoth'` view, which provider of
 * the `'marketplace'` view — so they live in the same slice rather than in
 * parallel maps. That is not just tidiness: retention, lazy seeding, the
 * bootstrap-sentinel migration in {@link AppStateManager.switchWorkspace} and
 * the cleanup in {@link AppStateManager.removeWorkspaceState} are all
 * slice-shaped, and a parallel map would have to re-implement each of them.
 */
interface ViewSlice {
  readonly currentView: ViewType;
  readonly openViews: ReadonlySet<ViewType>;
  /** Active tab of this workspace's Thoth hub. */
  readonly thothActiveTab: ThothActiveTabId;
  /** Selected marketplace provider id, or null when none is selected. */
  readonly marketplaceActiveProvider: string | null;
}

/** Slice a never-visited workspace reads until its first view mutation. */
const DEFAULT_VIEW_SLICE: ViewSlice = {
  currentView: 'chat',
  openViews: new Set<ViewType>(['chat']),
  thothActiveTab: 'memory',
  marketplaceActiveProvider: null,
};

/**
 * App State Manager - Signal-based global state
 * KEEPING: This service is clean and functional
 */
@Injectable({ providedIn: 'root' })
export class AppStateManager implements MessageHandler {
  /**
   * The Router, read and written as a surface id. Declared first because
   * {@link currentView} and the constructor effect both depend on it and
   * Angular initialises class fields top-to-bottom.
   */
  private readonly surfaceRouter = inject(SurfaceRouterService);

  readonly handledMessageTypes = [MESSAGE_TYPES.SWITCH_VIEW] as const;

  /**
   * `MESSAGE_TYPES.SWITCH_VIEW` — the host's way to command a view change from
   * outside Angular (`IPlatformCommands.focusChat()` depends on it). The wire
   * contract is unchanged; only the receiver is, because the Router now owns
   * the surface.
   *
   * The allow-list this used to carry (13 entries, disagreeing with the 8 in
   * `App.handleInitialView`) is gone: the route table is the allow-list, read
   * through {@link isSurfaceRouteId}. `orchestra-canvas` is accepted as well
   * because it is still a legal legacy value that {@link normalizeView} maps
   * onto the chat surface.
   */
  handleMessage(message: { type: string; payload?: unknown }): void {
    const payload = message.payload as { view?: string } | undefined;
    const view = payload?.view;
    if (isAcceptedInitialView(view)) {
      this.handleViewSwitch(view);
    } else {
      console.warn(
        `[AppStateManager] switchView received with invalid or missing view: ${view}`,
      );
    }
  }
  /**
   * Per-workspace view slices, keyed by workspace path (or
   * {@link IMPLICIT_WORKSPACE_PATH} before the first switch). Session state is
   * workspace-partitioned (`TabManagerService`, `SessionLoaderService`, the
   * editor services, `CanvasStore`, `TribunalStateService`); the view pointer
   * has to be too, or a switch lands the user on the previous workspace's
   * surface rendered against the new workspace's — now empty — state.
   */
  private readonly _viewSlices = signal<ReadonlyMap<string, ViewSlice>>(
    new Map([[IMPLICIT_WORKSPACE_PATH, DEFAULT_VIEW_SLICE]]),
  );
  /** The workspace whose slice {@link currentView} / {@link openViews} expose. */
  private readonly _activeWorkspacePath = signal<string>(
    IMPLICIT_WORKSPACE_PATH,
  );
  private readonly activeViewSlice = computed<ViewSlice>(
    () =>
      this._viewSlices().get(this._activeWorkspacePath()) ?? DEFAULT_VIEW_SLICE,
  );
  private readonly _isLoading = signal(false);
  private readonly _statusMessage = signal('Ready');
  private readonly _workspaceInfo = signal<WorkspaceInfo | null>(null);
  private readonly _isConnected = signal(true);
  /**
   * Deliberately NOT workspace-partitioned. Workspace switching only exists in
   * Electron (`ElectronLayoutService` gates every entry point on `isElectron`,
   * and the VS Code webview is single-root), and Electron pins this to `'grid'`
   * unconditionally in `ElectronShellComponent`'s constructor — its single-chat
   * layout was removed, and the toggle that would flip it is inside the
   * `@if (!isElectron)` branch of the app-shell template. So the value cannot
   * differ between two workspaces on any reachable path, and a partition map
   * here would be state that never varies.
   */
  private readonly _layoutMode = signal<LayoutMode>('grid');
  /** FIFO signal bridge for requests to open/focus sessions in canvas tiles. */
  private readonly _canvasSessionRequests = signal<
    readonly CanvasSessionRequest[]
  >([]);
  private readonly _canvasFocusRequests = signal<readonly CanvasFocusRequest[]>(
    [],
  );
  private _canvasFocusRequestId = 0;
  /** Signal bridge: request to create a new session as a canvas tile (from "New Session" in grid mode) */
  private readonly _newCanvasSessionRequest = signal<string | null>(null);
  /**
   * Signal bridge: request to adopt an EXISTING tab as a canvas tile without
   * creating a new tab/session. Fire-and-forget (mirrors
   * {@link _newCanvasSessionRequest}): used by the Tasks-board launch path so an
   * orchestration tab created while the canvas is ALREADY mounted becomes a tile
   * (the one gap `restoreCanvasTilesFromTabs` — which only runs on canvas mount —
   * doesn't cover). Nothing consumes it in single layout, so it's a harmless
   * no-op there; `CanvasStore.adoptTab` dedups and respects the tile cap.
   */
  private readonly _canvasTabRequest = signal<CanvasTabRequest | null>(null);
  /** Signal bridge: request to open the harness surface and run a workflow */
  private readonly _harnessWorkflowRequest =
    signal<HarnessWorkflowRequest | null>(null);
  /** Signal bridge: request to launch a chat session with a seed prompt (Tasks board → orchestrate) */
  private readonly _chatPromptRequest = signal<ChatPromptRequest | null>(null);
  /** Monotonic bridge for prefilling the composer of one chat surface. */
  private readonly _composerPrefillRequest = signal<ComposerPrefillRequest>({
    seq: 0,
    text: '',
    tabId: null,
  });
  /**
   * One-shot request to open the Skills library filtered to diverged clones,
   * holding the workspace path it was raised FOR (`null` when none is pending).
   *
   * Deliberately not part of ViewSlice: navigation pointers are retained per
   * workspace, while this intent must be consumed exactly once on arrival.
   * It is still workspace-BOUND, because the diverged entries it points at are
   * one workspace's — carried into another workspace the deep link would
   * filter that workspace's Library on a divergence the user never saw.
   */
  private readonly _skillsDivergedRequest = signal<string | null>(null);
  private readonly _pendingSettingsTab = signal<PendingSettingsTab | null>(
    null,
  );

  /**
   * Whether the user has dismissed the Thoth first-run hint.
   * Persisted to `localStorage` under {@link THOTH_FIRST_RUN_DISMISSED_KEY}
   * (same pattern as `ptah-layout-mode`) so a reload preserves the dismissed
   * state and the tooltip never reappears after the user closes it once.
   */
  private readonly _thothFirstRunDismissed = signal<boolean>(false);

  /**
   * The workspace whose surface memory the globally settled surface currently
   * belongs to, or `null` when it belongs to nobody.
   *
   * This is the ownership token that {@link recordSettledSurface} checks, and
   * it exists because the displayed surface and the active workspace are not
   * the same fact. It is `null`:
   *
   * - between {@link switchWorkspace} and the settlement of the restore
   *   navigation that switch started — during that window the surface on
   *   screen still belongs to the OUTGOING workspace, so stamping it against
   *   the incoming one made B remember A's surface (revision 1, F1);
   * - after {@link removeWorkspaceState} removed the ACTIVE workspace — a
   *   deleted slice must not be resurrected by a later settlement, and
   *   `updateActiveViewSlice` re-creates a missing slice by design. Revoking
   *   ownership is what makes removal stick, rather than teaching every write
   *   path about removal.
   */
  private _settlementOwner: string | null = IMPLICIT_WORKSPACE_PATH;

  /**
   * Monotonic id of the most recent navigation this service started.
   *
   * A settlement whose generation is no longer the current one has been
   * superseded: a newer request is in flight and will record its own outcome.
   * Without this, A→B→A leaves B's in-flight restore free to record against A
   * when it eventually lands.
   */
  private _navigationGeneration = 0;

  constructor() {
    this.initializeState();

    // Follow the Router, for every surface change this service did NOT start:
    // `App.handleInitialView`'s initial navigation,
    // `HarnessWorkflowMessageHandler`, and `Location.back()` / `.forward()`.
    // Navigations this service starts record through `requestSurface`, which
    // carries its own workspace and generation.
    //
    // The workspace path is read through `untracked` deliberately: tracking it
    // would re-run this effect on a workspace switch and stamp the OUTGOING
    // workspace's surface onto the incoming one.
    effect(() => {
      const surface = this.surfaceRouter.currentSurface();
      untracked(() => {
        const owner = this._activeWorkspacePath();
        // Only the owner may be stamped. While a workspace switch is in
        // flight, or after the active workspace was closed, nobody owns the
        // displayed surface and this settlement is dropped.
        if (this._settlementOwner !== owner) return;
        this.openViewInActiveSlice(surface);
      });
    });
  }

  /**
   * Start a surface navigation that belongs to the active workspace, and
   * record its outcome only if that ownership still holds when it settles.
   *
   * Every write path in this service goes through here, so there is one place
   * that decides what "this workspace reached that surface" means.
   */
  private requestSurface(surface: ViewType): void {
    const generation = ++this._navigationGeneration;
    const workspacePath = this._activeWorkspacePath();

    void this.surfaceRouter
      .navigateToSurface(surface)
      .then((result) =>
        this.recordSettledSurface(generation, workspacePath, surface, result),
      );
  }

  /**
   * Record a settled surface against the workspace that asked for it — or drop
   * the write.
   *
   * Four ways a write is dropped, each of which was a reproduced defect or the
   * hazard behind one:
   *   1. the navigation did not land (cancelled, or a failed lazy chunk);
   *   2. a newer navigation superseded it;
   *   3. the workspace that asked is no longer the active one;
   *   4. that workspace no longer owns the displayed surface — it was closed,
   *      or a switch away from it is still in flight.
   */
  private recordSettledSurface(
    generation: number,
    workspacePath: string,
    surface: ViewType,
    result: SurfaceNavigationResult,
  ): void {
    if (!surfaceNavigationLanded(result)) return;
    if (generation !== this._navigationGeneration) return;
    if (workspacePath !== this._activeWorkspacePath()) return;

    // The requester is the active workspace and its navigation landed, so it
    // owns the displayed surface from here on — including when this is the
    // restore navigation `switchWorkspace` started, which is what re-grants
    // ownership after a switch.
    this._settlementOwner = workspacePath;
    this.openViewInActiveSlice(surface);
  }

  /**
   * Normalize backward-compat view values. 'orchestra-canvas' was previously a view;
   * it's now a layout mode. Map it to 'chat' + grid layout so every entry point
   * behaves consistently (no blank shell).
   */
  private normalizeView(view: ViewType): ViewType {
    if (view === 'orchestra-canvas') {
      this._layoutMode.set('grid');
      return 'chat';
    }
    return view;
  }

  /**
   * The surface currently addressed, read from the Router.
   *
   * Kept as `currentView` because it has many consumers (the Electron navbar's
   * tab-active bindings, `AppShellComponent.isStandaloneView`, every
   * `openX()` guard) and all of them want the same answer. What changed is who
   * decides it: the Router, not a signal write.
   */
  readonly currentView = computed<ViewType>(() =>
    this.surfaceRouter.currentSurface(),
  );
  readonly isLoading = this._isLoading.asReadonly();
  readonly statusMessage = this._statusMessage.asReadonly();
  readonly workspaceInfo = this._workspaceInfo.asReadonly();
  readonly isConnected = this._isConnected.asReadonly();
  /** Open views of the active workspace, as an array for template iteration. */
  readonly openViews = computed(() =>
    Array.from(this.activeViewSlice().openViews),
  );
  /** Current layout mode: 'single' (tab view) or 'grid' (canvas view) */
  readonly layoutMode = this._layoutMode.asReadonly();
  /** Pending requests to open sessions in canvas tiles, in arrival order. */
  readonly canvasSessionRequests = this._canvasSessionRequests.asReadonly();
  readonly canvasFocusRequests = this._canvasFocusRequests.asReadonly();
  /** Pending request to create a new canvas tile (consumed by OrchestraCanvasComponent) */
  readonly newCanvasSessionRequest = this._newCanvasSessionRequest.asReadonly();
  /** Pending request to adopt an existing tab as a canvas tile (consumed by OrchestraCanvasComponent) */
  readonly canvasTabRequest = this._canvasTabRequest.asReadonly();
  /** Pending request to open the harness surface workflow (consumed by HarnessBuilderViewComponent) */
  readonly harnessWorkflowRequest = this._harnessWorkflowRequest.asReadonly();
  /** Pending request to launch a chat session with a seed prompt (consumed by the chat-lib bridge) */
  readonly chatPromptRequest = this._chatPromptRequest.asReadonly();
  /** Latest request to prefill a targeted chat composer without sending. */
  readonly composerPrefillRequest = this._composerPrefillRequest.asReadonly();
  readonly pendingSettingsTab = this._pendingSettingsTab.asReadonly();
  /**
   * Active tab id inside the Thoth hub (memory / skills / cron / gateway),
   * for the active workspace. Partitioned so switching workspaces does not
   * leave the previous workspace's tab selected against the new workspace's
   * memory / skills / cron / gateway state.
   */
  readonly thothActiveTab = computed<ThothActiveTabId>(
    () => this.activeViewSlice().thothActiveTab,
  );
  /**
   * Selected marketplace provider id of the active workspace (null when none
   * selected). Partitioned for the same reason as {@link thothActiveTab}:
   * installed content is per-workspace, so the provider selection is too.
   */
  readonly marketplaceActiveProvider = computed<string | null>(
    () => this.activeViewSlice().marketplaceActiveProvider,
  );
  /** Whether the Thoth first-run hint has been dismissed. */
  readonly thothFirstRunDismissed = this._thothFirstRunDismissed.asReadonly();
  readonly canSwitchViews = computed(() => {
    return !this._isLoading() && this._isConnected();
  });
  readonly appTitle = computed(() => {
    const workspace = this._workspaceInfo();
    return workspace ? `Ptah - ${workspace.name}` : 'Ptah';
  });

  /**
   * Initialize application state from window object augmentation.
   *
   * **Window Augmentation for Debugging:**
   * The extension backend can inject initial state into the webview by augmenting
   * the window object before the Angular app bootstraps. This reads the
   * workspace identity and the persisted UI preferences from it.
   *
   * `initialView` is deliberately NOT read here. It is a *navigation* input, and
   * the Router owns navigation: `App.handleInitialView` reads it once and seeds
   * the first navigation, under `withDisabledInitialNavigation()` so the Router
   * cannot resolve an empty URL before the host deep link is read. Reading it
   * here as well would be a second entry point racing the first.
   *
   * **Production Warning:**
   * This pattern is safe for production as it only reads from window during
   * initialization. However, avoid writing to window after app bootstrap as it
   * bypasses Angular's change detection.
   *
   * @private
   */
  private initializeState(): void {
    const windowWithState = window as Window & {
      ptahConfig?: {
        workspaceRoot?: string;
        workspaceName?: string;
      };
    };
    const workspaceRoot = windowWithState.ptahConfig?.workspaceRoot;
    const workspaceName = windowWithState.ptahConfig?.workspaceName;
    if (
      workspaceRoot &&
      workspaceRoot !== 'undefined' &&
      workspaceRoot !== ''
    ) {
      this._workspaceInfo.set({
        name:
          workspaceName && workspaceName !== 'undefined' ? workspaceName : '',
        path: workspaceRoot,
        type: 'workspace',
      });
    }

    const savedLayoutMode = localStorage.getItem(
      'ptah-layout-mode',
    ) as LayoutMode | null;
    if (savedLayoutMode === 'single' || savedLayoutMode === 'grid') {
      this._layoutMode.set(savedLayoutMode);
    }

    const newValue = localStorage.getItem(THOTH_FIRST_RUN_DISMISSED_KEY);
    if (newValue === null) {
      const legacyValue = localStorage.getItem(
        LEGACY_HERMES_FIRST_RUN_DISMISSED_KEY,
      );
      if (legacyValue !== null) {
        localStorage.setItem(THOTH_FIRST_RUN_DISMISSED_KEY, legacyValue);
        localStorage.removeItem(LEGACY_HERMES_FIRST_RUN_DISMISSED_KEY);
        if (legacyValue === 'true') {
          this._thothFirstRunDismissed.set(true);
        }
      }
    } else if (newValue === 'true') {
      this._thothFirstRunDismissed.set(true);
    }
  }

  /**
   * Resolve a host-supplied `initialView` to a surface that actually has a
   * route. Called once, from `App.handleInitialView`.
   *
   * There is no allow-list here: {@link isSurfaceRouteId} reads the same id
   * list the route table is built from. The only special case is the legacy
   * `orchestra-canvas` value, which {@link normalizeView} maps onto the chat
   * surface AND forces grid layout for — dropping that would land a host that
   * still sends it on single-chat instead of the canvas.
   */
  normalizeInitialView(raw: string | undefined): ViewType {
    const candidate =
      raw === 'orchestra-canvas' ? this.normalizeView('orchestra-canvas') : raw;
    if (isSurfaceRouteId(candidate)) return candidate;
    if (raw !== undefined && raw !== '') {
      console.warn(
        `[AppStateManager] Unknown initialView "${raw}" — falling back to "${DEFAULT_SURFACE_ID}".`,
      );
    }
    return DEFAULT_SURFACE_ID;
  }

  /**
   * Read-modify-write the active workspace's view slice, seeding
   * {@link DEFAULT_VIEW_SLICE} when the workspace is being written to for the
   * first time.
   */
  private updateActiveViewSlice(update: (slice: ViewSlice) => ViewSlice): void {
    const path = this._activeWorkspacePath();
    this._viewSlices.update((slices) => {
      const current = slices.get(path) ?? DEFAULT_VIEW_SLICE;
      const next = update(current);
      return next === current ? slices : new Map(slices).set(path, next);
    });
  }

  /** Make `view` the active workspace's current view and mark it open. */
  private openViewInActiveSlice(view: ViewType): void {
    this.updateActiveViewSlice((slice) => ({
      ...slice,
      currentView: view,
      openViews: slice.openViews.has(view)
        ? slice.openViews
        : new Set(slice.openViews).add(view),
    }));
  }

  /**
   * Point the view state at `newPath`, retaining every visited workspace's
   * slice so returning to a workspace restores the surface it was left on.
   * Called from `WorkspaceCoordinatorService.switchWorkspace`'s synchronous
   * fan-out, alongside the tab, session and picker resets.
   *
   * A never-visited workspace has no entry: {@link activeViewSlice} falls back
   * to {@link DEFAULT_VIEW_SLICE} and the entry is seeded on its first view
   * mutation, so a fresh workspace opens on chat rather than inheriting the
   * previous one's view.
   */
  switchWorkspace(newPath: string): void {
    const previousPath = this._activeWorkspacePath();
    if (previousPath === newPath) return;

    // Stamp the OUTGOING workspace's surface synchronously before switching —
    // but ONLY if that workspace still owns the displayed surface. The
    // constructor effect normally records it, and an effect is coalesced by
    // change detection, so it may not have flushed since the last navigation
    // while this method reads the slice back a few lines later.
    //
    // The ownership test is what makes the stamp correct rather than merely
    // timely (revision 1, F1). Without it:
    //   - A→B→A stamped the surface still on screen (A's) onto B, because B's
    //     own restore had not settled;
    //   - closing the active workspace and then switching away re-created the
    //     slice that was just deleted, so reopening it restored a surface that
    //     was supposed to be gone.
    if (this._settlementOwner === previousPath) {
      this.openViewInActiveSlice(this.currentView());
    }

    // Nobody owns the displayed surface until the restore navigation below
    // lands. `recordSettledSurface` re-grants ownership to `newPath` then.
    this._settlementOwner = null;
    this._activeWorkspacePath.set(newPath);

    if (!this._viewSlices().has(newPath)) {
      // First real workspace after bootstrap: migrate the sentinel slice rather
      // than seed a default one, so the surface the user reached before the
      // initial workspace:switch RPC settled is not discarded.
      const bootstrapSlice =
        previousPath === IMPLICIT_WORKSPACE_PATH
          ? this._viewSlices().get(IMPLICIT_WORKSPACE_PATH)
          : undefined;
      if (bootstrapSlice) {
        this._viewSlices.update((slices) => {
          const next = new Map(slices);
          next.set(newPath, bootstrapSlice);
          next.delete(IMPLICIT_WORKSPACE_PATH);
          return next;
        });
      }
    }

    // The surface is the Router's, so restoring a workspace's surface is a
    // navigation, not a signal write. A never-visited workspace has no slice
    // and lands on chat rather than inheriting the previous workspace's
    // surface rendered against the new workspace's — now empty — state.
    //
    // If this navigation does NOT land, `recordSettledSurface` drops the write
    // and `_settlementOwner` stays `null`: the new workspace is active with
    // the previous workspace's surface still on screen, and a later switch
    // away will refuse to stamp it. That is the honest outcome — the wrong
    // behaviour would be to record a surface this workspace never reached.
    this.requestSurface(
      this._viewSlices().get(newPath)?.currentView ?? DEFAULT_SURFACE_ID,
    );
  }

  /**
   * Drop a closed workspace's view slice. Without this a workspace removed and
   * later re-added would resurrect the view it was closed on. Mirrors the
   * slice cleanup `CanvasStore` and `TribunalStateService` do on
   * `removedWorkspace$`.
   */
  removeWorkspaceState(workspacePath: string): void {
    this._viewSlices.update((slices) => {
      if (!slices.has(workspacePath)) return slices;
      const next = new Map(slices);
      next.delete(workspacePath);
      return next;
    });

    // Revoke ownership when the workspace being closed is the ACTIVE one.
    // `ElectronLayoutService` runs this cleanup BEFORE it switches away
    // (`electron-layout.service.ts:371-374`), so without this the synchronous
    // stamp in `switchWorkspace` — or a late settlement — re-created the slice
    // that was just deleted, and reopening the workspace restored the surface
    // it was closed on (revision 1, F1). `updateActiveViewSlice` seeds a
    // missing slice by design, so removal has to invalidate later writes
    // rather than rely on them noticing the absence.
    if (workspacePath === this._activeWorkspacePath()) {
      this._settlementOwner = null;
    }
  }

  /**
   * Switch surface. Delegates to the Router, which is the owner.
   *
   * Stays `void` on purpose: every one of its ~20 callers is a click handler or
   * an effect that cannot act on a failed navigation. The one caller that can —
   * `App.handleInitialView` — goes through
   * {@link SurfaceRouterService.navigateToSurface} directly and reports it.
   */
  setCurrentView(view: ViewType): void {
    if (this.canSwitchViews()) {
      this.requestSurface(this.normalizeView(view));
    }
  }

  /** Close a view tab pill. Chat can never be closed. Falls back to chat if closing the active view. */
  closeView(view: ViewType): void {
    if (view === 'chat') return;
    this.updateActiveViewSlice((slice) => {
      if (!slice.openViews.has(view)) return slice;
      const openViews = new Set(slice.openViews);
      openViews.delete(view);
      return { ...slice, openViews };
    });
    // Closing the surface you are looking at means leaving it, and leaving is
    // a navigation. The slice's `currentView` memory is not written here — the
    // constructor effect records chat once the navigation settles.
    if (this.currentView() === view) {
      this.requestSurface(DEFAULT_SURFACE_ID);
    }
  }

  setLoading(loading: boolean): void {
    this._isLoading.set(loading);
  }

  setStatusMessage(message: string): void {
    this._statusMessage.set(message);
  }

  setWorkspaceInfo(info: WorkspaceInfo | null): void {
    this._workspaceInfo.set(info);
  }

  setConnected(connected: boolean): void {
    this._isConnected.set(connected);
    if (connected) {
      this.setStatusMessage('Connected to VS Code');
      this.setLoading(false);
    } else {
      this.setStatusMessage('Disconnected from VS Code');
    }
  }

  handleInitialData(data: {
    workspaceInfo?: WorkspaceInfo;
    currentView?: ViewType;
  }): void {
    if (data.workspaceInfo) this.setWorkspaceInfo(data.workspaceInfo);
    if (data.currentView) {
      this.requestSurface(this.normalizeView(data.currentView));
    }
    this.setConnected(true);
  }

  handleViewSwitch(view: ViewType): void {
    if (!this.canSwitchViews()) return;

    this.requestSurface(this.normalizeView(view));
  }

  handleError(error: string): void {
    this.setStatusMessage(`Error: ${error}`);
  }

  /** Update the active workspace's Thoth hub tab. */
  setThothActiveTab(tab: ThothActiveTabId): void {
    this.updateActiveViewSlice((slice) =>
      slice.thothActiveTab === tab ? slice : { ...slice, thothActiveTab: tab },
    );
  }

  /**
   * Open the Skills tab and raise a one-shot request for its diverged filter.
   *
   * Gated on {@link canSwitchViews} — the same guard {@link setCurrentView}
   * applies. Without it the view switch would be dropped while disconnected or
   * loading and the request would survive, so the filter fired later against
   * whatever surface the user reached next.
   */
  openSkillsDivergedClones(): void {
    if (!this.canSwitchViews()) return;
    this.setCurrentView('thoth');
    this.setThothActiveTab('skills');
    this._skillsDivergedRequest.set(this._activeWorkspacePath());
  }

  /**
   * Read and clear the pending diverged-clones navigation request. Answers
   * `true` only for the workspace the request was raised in; a request the
   * user walked away from by switching workspaces is cleared, not honoured.
   */
  consumeSkillsDivergedRequest(): boolean {
    const requestedFor = this._skillsDivergedRequest();
    this._skillsDivergedRequest.set(null);
    return (
      requestedFor !== null && requestedFor === this._activeWorkspacePath()
    );
  }

  /**
   * Update the active workspace's selected marketplace provider id (null to
   * clear the selection).
   */
  setMarketplaceActiveProvider(id: string | null): void {
    this.updateActiveViewSlice((slice) =>
      slice.marketplaceActiveProvider === id
        ? slice
        : { ...slice, marketplaceActiveProvider: id },
    );
  }

  /**
   * Mark the Thoth first-run hint as dismissed and persist the flag to
   * `localStorage` so a reload preserves the dismissed state. Idempotent —
   * calling this when already dismissed is a no-op for state but still
   * re-writes the storage key (cheap, keeps the code branch-free).
   */
  dismissThothFirstRun(): void {
    this._thothFirstRunDismissed.set(true);

    localStorage.setItem(THOTH_FIRST_RUN_DISMISSED_KEY, 'true');
  }

  getStateSnapshot(): AppState {
    return {
      currentView: this.currentView(),
      isLoading: this._isLoading(),
      statusMessage: this._statusMessage(),
      workspaceInfo: this._workspaceInfo(),
      isConnected: this._isConnected(),
    };
  }

  /** Set the layout mode and persist to localStorage */
  setLayoutMode(mode: LayoutMode): void {
    this._layoutMode.set(mode);

    localStorage.setItem('ptah-layout-mode', mode);
  }

  /** Toggle between 'single' and 'grid' layout modes */
  toggleLayoutMode(): void {
    const next = this._layoutMode() === 'grid' ? 'single' : 'grid';
    this.setLayoutMode(next);
  }

  /**
   * Request that the canvas opens/focuses a tile for the given session.
   *
   * Returns a Promise that resolves to `true` when the canvas effect adopts
   * the request and a tile is bound, or `false` when the request is dropped
   * (tile cap reached, canvas not mounted, etc.). Callers that need to gate
   * downstream destructive actions on a successful swap (e.g. "delete the
   * original session after switching to the new one") should `await` this.
   * Legacy fire-and-forget callers can ignore the returned promise.
   *
   * Requests are appended to a FIFO queue so a burst cannot overwrite an
   * earlier request before the canvas effect runs. If the canvas never
   * consumes a request, its 5s safety timeout removes that exact request and
   * settles `false` so it cannot execute later.
   */
  requestCanvasSession(sessionId: string, name?: string): Promise<boolean> {
    const validatedSessionId = SessionId.safeParse(sessionId);
    if (!validatedSessionId) return Promise.resolve(false);

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (success: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(success);
      };
      const request: CanvasSessionRequest = {
        sessionId: validatedSessionId,
        name,
        resolve: settle,
      };
      const timer = setTimeout(() => {
        let removedWhileWaiting = false;
        this._canvasSessionRequests.update((requests) => {
          const remaining = requests.filter(
            (candidate) => candidate !== request,
          );
          removedWhileWaiting = remaining.length !== requests.length;
          return removedWhileWaiting ? remaining : requests;
        });
        if (removedWhileWaiting) settle(false);
      }, 5000);
      this._canvasSessionRequests.update((requests) => [...requests, request]);
    });
  }

  /** Return all pending canvas-session requests in FIFO order and empty the queue. */
  takeCanvasSessionRequests(): readonly CanvasSessionRequest[] {
    const requests = this._canvasSessionRequests();
    if (requests.length > 0) {
      this._canvasSessionRequests.set([]);
    }
    return requests;
  }

  requestCanvasFocus(
    target: NotificationFocusTarget,
  ): Promise<NotificationFocusResult> {
    return new Promise<NotificationFocusResult>((resolve) => {
      let settled = false;
      const requestId = ++this._canvasFocusRequestId;
      const settle = (result: NotificationFocusResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const request: CanvasFocusRequest = {
        id: requestId,
        target,
        resolve: settle,
      };
      const timer = setTimeout(() => {
        let removed = false;
        this._canvasFocusRequests.update((requests) => {
          const remaining = requests.filter(
            (candidate) => candidate.id !== requestId,
          );
          removed = remaining.length !== requests.length;
          return removed ? remaining : requests;
        });
        if (removed) settle({ success: false, outcome: 'missing' });
      }, 5000);
      this._canvasFocusRequests.update((requests) => [...requests, request]);
    });
  }

  takeCanvasFocusRequests(
    workspacePath: string,
  ): readonly CanvasFocusRequest[] {
    const matching = this._canvasFocusRequests().filter(
      (request) => request.target.workspacePath === workspacePath,
    );
    if (matching.length === 0) return [];
    const ids = new Set(matching.map((request) => request.id));
    this._canvasFocusRequests.update((requests) =>
      requests.filter((request) => !ids.has(request.id)),
    );
    return matching;
  }

  /** Request that the canvas creates a new tile with the given name */
  requestNewCanvasSession(name: string): void {
    this._newCanvasSessionRequest.set(name);
  }

  /** Clear the new canvas session request after the canvas has processed it */
  clearNewCanvasSessionRequest(): void {
    this._newCanvasSessionRequest.set(null);
  }

  /**
   * Request that the canvas adopts an already-existing tab as a tile (no new
   * tab/session created). Fire-and-forget: the canvas effect calls
   * `CanvasStore.adoptTab` (dedups, respects `MAX_TILES`) and focuses it. When
   * the canvas isn't mounted (single layout) nothing consumes the signal — a
   * harmless no-op, so callers need not gate on layout themselves.
   */
  requestCanvasTab(tabId: string, name?: string): void {
    this._canvasTabRequest.set({ tabId, ...(name ? { name } : {}) });
  }

  /** Clear the canvas tab-adoption request after the canvas has processed it. */
  clearCanvasTabRequest(): void {
    this._canvasTabRequest.set(null);
  }

  /** Request that the harness surface opens and runs the given workflow. */
  requestHarnessWorkflow(req: HarnessWorkflowRequest): void {
    this._harnessWorkflowRequest.set(req);
  }

  /** Invalidate a request only while it still owns the pending workflow. */
  clearHarnessWorkflowRequest(request: HarnessWorkflowRequest): void {
    if (this._harnessWorkflowRequest() === request) {
      this._harnessWorkflowRequest.set(null);
    }
  }

  /**
   * Request that the chat lib launches a session seeded with `request.prompt`.
   * Mirrors {@link requestCanvasSession}: the chat-lib bridge consumes the
   * signal, creates/focuses a session, publishes a composer prefill, and
   * settles `request.resolve`. Fire-and-forget for callers that don't need the
   * outcome; awaiters wire a `resolve` callback (see the Tasks board Start
   * flow).
   */
  requestChatPrompt(request: ChatPromptRequest): void {
    this._chatPromptRequest.set(request);
  }

  /** Prefill the composer belonging to `tabId` without submitting the text. */
  requestComposerPrefill(text: string, tabId: string | null): void {
    this._composerPrefillRequest.update((request) => ({
      seq: request.seq + 1,
      text,
      tabId,
    }));
  }

  /**
   * Clear the composer-prefill request after the owning surface applied it.
   * Without this the request stays in the signal forever, so a surface
   * recreated for the same tab (a canvas tile removed and re-added) replays
   * the stale prefill over the current draft in its constructor effect.
   */
  clearComposerPrefill(): void {
    this._composerPrefillRequest.set({ seq: 0, text: '', tabId: null });
  }

  /**
   * Clear the chat-prompt request after the bridge has processed it. Callers
   * should invoke `request.resolve(...)` BEFORE calling this so any awaiter
   * unblocks; clearing alone does not settle the promise.
   */
  clearChatPromptRequest(): void {
    this._chatPromptRequest.set(null);
  }

  /**
   * Consume the pending harness workflow request (read-and-clear). Returns
   * the request or null. Mirrors the canvas request consume pattern — the
   * harness view reads this once on init so re-entry doesn't replay a stale
   * workflow.
   */
  consumeHarnessWorkflowRequest(): HarnessWorkflowRequest | null {
    const req = this._harnessWorkflowRequest();
    if (req) {
      this._harnessWorkflowRequest.set(null);
    }
    return req;
  }

  requestSettingsTab(target: PendingSettingsTab): void {
    this._pendingSettingsTab.set(target);
  }

  /**
   * Open Settings already pointed at `tab`.
   *
   * Replaces `WebviewNavigationService.navigateToSettingsTab`, which was the
   * only reason three Tribunal wizard steps injected that service. Guarded
   * before the request is raised — the same shape as
   * {@link openSkillsDivergedClones} — so a switch dropped while disconnected
   * or loading cannot leave a pending tab request that fires later against
   * whatever surface the user reached next.
   */
  openSettingsTab(tab: SettingsTabId, providerId?: string): void {
    if (!this.canSwitchViews()) return;
    this.requestSettingsTab({ tab, providerId });
    this.setCurrentView('settings');
  }

  consumePendingSettingsTab(): PendingSettingsTab | null {
    const target = this._pendingSettingsTab();
    if (target) {
      this._pendingSettingsTab.set(null);
    }
    return target;
  }
}
