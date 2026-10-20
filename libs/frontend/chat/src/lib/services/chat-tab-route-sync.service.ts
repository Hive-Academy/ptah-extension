import {
  DestroyRef,
  Injectable,
  Injector,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart, PRIMARY_OUTLET, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import {
  SurfaceRouterService,
  SurfaceTransitionTracker,
  VSCodeService,
} from '@ptah-extension/core';
import { TabId, TabManagerService } from '@ptah-extension/chat-state';
import type { ViewType } from '@ptah-extension/shared';

/** The surface whose URL carries the active tab: `/chat/:tabId`. */
const CHAT_SURFACE: ViewType = 'chat';

/**
 * A well-formed URL tab id that is not in the loaded tab set yet, kept until
 * the workspace's tabs are loaded.
 */
interface HeldUrlTab {
  readonly tabId: string;
  /** `activeTabId()` when the id was held; a change means the user chose. */
  readonly activeAtHold: string | null;
}

/** A replace this service started, identified by the tab and the URL it names. */
interface Correction {
  readonly tabId: string | null;
  /**
   * Serialized target of {@link ChatTabRouteSync.issueCorrection}. Compared
   * with a later `NavigationStart` so the same tab with a different query,
   * fragment or matrix parameter still counts as a different navigation.
   */
  readonly url: string;
}

/**
 * Keeps `/chat/:tabId` in step with the active chat tab (TASK_2026_524,
 * Batch 4c), so a reload or a restored panel can address the tab it showed.
 *
 * `TabManagerService` stays the owner of the active tab (L7). The URL is a
 * projection of it: a `:tabId` is honoured only when it names a tab that
 * exists, and anything else corrects the URL, never the tabs. This service
 * never creates, closes or reorders a tab.
 *
 * Two reactions, installed once by {@link start}:
 * 1. **URL → tab**, on `NavigationEnd`. A settled `/chat/<id>` naming another
 *    existing tab switches to it; an unknown, invalid or missing id is
 *    replaced with the active tab's URL.
 * 2. **Tab → URL**, an effect on `activeTabId()` and tab-set readiness. When
 *    chat is showing and the Router is idle, the URL is replaced to name the
 *    active tab.
 *
 * Every correction uses `replaceUrl` (D6): a tab switch never adds a history
 * entry. In the settled case there is no loop: after either reaction runs, the
 * other one's guard — URL tab equals `activeTabId()` — already holds.
 *
 * Two orderings need more than that (review round 1):
 * - **Boot.** On Electron the workspace's tabs load only on the first
 *   `switchWorkspace`, which can come after the restored `/chat/<id>` has
 *   settled. A well-formed id is HELD, with the URL left as it is, until the
 *   tab set is ready — also when the pre-load tab set already has it, since
 *   the load can still change the active tab. It is then switched to if it
 *   exists and corrected if not. A malformed id is corrected at once.
 * - **A tab change during a navigation.** A URL that lands after the user (or
 *   a workspace switch) changed the active tab is stale. It never switches the
 *   tab back; it is corrected toward the current active tab instead.
 */
@Injectable({ providedIn: 'root' })
export class ChatTabRouteSync {
  private readonly router = inject(Router);
  private readonly surfaceRouter = inject(SurfaceRouterService);
  private readonly transitionTracker = inject(SurfaceTransitionTracker);
  private readonly tabManager = inject(TabManagerService);
  private readonly isElectron = inject(VSCodeService).isElectron;
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private started = false;

  /**
   * Whether `tabs()` is the final tab set a URL tab id can be checked against.
   *
   * On VS Code, `TabManagerService` loads the panel's tabs synchronously in its
   * constructor and no workspace switch ever follows, so the set is final from
   * the start. On Electron the workspace's tabs replace them on the first
   * `switchWorkspace` (`TabWorkspacePartitionService.switchWorkspace`), which
   * sets `activeWorkspacePath$` in the same synchronous call that the new
   * `tabs` / `activeTabId` are applied in.
   */
  private readonly tabsReady = computed(
    () => !this.isElectron || this.tabManager.activeWorkspacePath$() !== null,
  );

  private held: HeldUrlTab | null = null;
  private correction: Correction | null = null;
  /** Invalidates a deferred correction when navigation or another correction starts. */
  private routeGeneration = 0;
  private deferredCorrectionGeneration: number | null = null;
  private correctionDropped = false;
  /** The active tab changed while a navigation was in flight. */
  private activeChangedInFlight = false;
  private lastActive: string | null = null;
  private lastReady = false;

  /**
   * Install both reactions for the application's lifetime. Idempotent; called
   * once from bootstrap. One `Router.events` subscription and one root effect
   * — no timer, no per-tab work.
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.lastActive = this.tabManager.activeTabId();
    this.lastReady = this.tabsReady();

    const subscription = this.router.events
      .pipe(
        filter(
          (event): event is NavigationStart | NavigationEnd | NavigationCancel | NavigationError =>
            event instanceof NavigationStart || event instanceof NavigationEnd ||
            event instanceof NavigationCancel || event instanceof NavigationError,
        ),
      )
      .subscribe((event) => {
        if (event instanceof NavigationStart) {
          this.routeGeneration++;
          if (
            this.deferredCorrectionGeneration !== null ||
            this.supersedesCorrection(event.url)
          ) {
            this.correctionDropped = true;
          }
        } else if (event instanceof NavigationEnd) {
          this.correctionDropped = false;
          this.followUrl(event.urlAfterRedirects);
        } else if (this.correctionDropped) {
          // The Router clears currentNavigation after emitting the terminal event.
          queueMicrotask(() => this.reconcileDroppedCorrection());
        }
      });
    this.destroyRef.onDestroy(() => subscription.unsubscribe());

    effect(
      () => {
        // Only the active tab id and readiness are tracked. Tab contents
        // stream constantly; tracking `tabs()` would re-run this per token.
        const activeTabId = this.tabManager.activeTabId();
        const ready = this.tabsReady();
        untracked(() => this.followActiveTab(activeTabId, ready));
      },
      { injector: this.injector },
    );
  }

  /** Reaction 1: a settled chat URL selects its tab, or is corrected. */
  private followUrl(url: string): void {
    const urlTab = this.chatTabOf(url);
    const stale =
      this.activeChangedInFlight ||
      (this.correction !== null && this.correction.tabId === urlTab);
    this.activeChangedInFlight = false;
    if (urlTab === undefined) {
      // Leaving chat abandons a held deep link: the user has moved on.
      this.held = null;
      return;
    }

    const activeTabId = this.tabManager.activeTabId();
    // `stale`: this URL was chosen before the active tab last changed — it is
    // our own correction landing late, or a navigation that was in flight
    // across a tab switch. Selecting its tab would undo the newer choice.
    const selectable =
      !stale && urlTab !== null && TabId.validate(urlTab) ? urlTab : null;

    if (selectable !== null && !this.tabsReady()) {
      // Held even when the pre-load tab set has it, or it is already active:
      // the workspace load can still replace the active tab, and the URL must
      // win over that. A tab that exists now is shown meanwhile.
      if (selectable !== activeTabId && this.isExistingTab(selectable)) {
        this.tabManager.switchTab(selectable);
      }
      this.held = {
        tabId: selectable,
        activeAtHold: this.tabManager.activeTabId(),
      };
      return;
    }

    if (urlTab === activeTabId) {
      this.held = null;
      return;
    }

    if (selectable !== null && this.isExistingTab(selectable)) {
      this.held = null;
      // The effect below then sees the URL already naming this tab.
      this.tabManager.switchTab(selectable);
      return;
    }

    this.held = null;
    // A bare `/chat` with no active tab is already correct.
    if (urlTab === null && activeTabId === null) return;
    this.replaceChatUrl();
  }

  /** Reaction 2: a new active tab, or a newly ready tab set, reaches the URL. */
  private followActiveTab(activeTabId: string | null, ready: boolean): void {
    const activeChanged = activeTabId !== this.lastActive;
    // ASSUMPTION: on the run where the tab set becomes ready, the active tab
    // is the one the workspace load applied. A `switchTab` in the same turn as
    // that load would be read as the load's own change: it would not mark a
    // pending landing stale (below), and a held URL tab would override it.
    // No production path does that: the boot load is
    // `WorkspaceCoordinatorService.switchWorkspace`'s synchronous fan-out
    // (workspace-coordinator.service.ts:177-183), none of whose callees
    // touches the active tab, and every other `switchTab` caller runs after
    // an RPC or user event. Neither TabManagerService nor the partition
    // exposes the loaded active id, so this cannot be checked here instead.
    const becameReady = ready && !this.lastReady;
    this.lastActive = activeTabId;
    this.lastReady = ready;

    if (this.surfaceRouter.pendingSurface() !== null) {
      // The navigation in flight decides the URL; reaction 1 reconciles when
      // it lands. A tab change made meanwhile — other than the one the first
      // workspace load applies — makes that landing stale.
      if (activeChanged && !becameReady) this.activeChangedInFlight = true;
      return;
    }

    const urlTab = this.chatTabOf(this.router.url);
    if (urlTab === undefined) return;

    if (this.resolveHeldUrlTab(urlTab, activeTabId, ready)) return;

    if (urlTab === activeTabId) return;
    this.replaceChatUrl();
  }

  /**
   * Settle a held URL tab id for reaction 2. Returns `true` when the held id
   * decided this run (the URL is kept while waiting, or its tab is switched
   * to), and `false` when the URL should be reconciled with the active tab.
   */
  private resolveHeldUrlTab(
    urlTab: string | null,
    activeTabId: string | null,
    ready: boolean,
  ): boolean {
    const held = this.held;
    if (held === null) return false;
    if (!ready) {
      // Still waiting for the tab set; keep the URL unless the user chose.
      if (activeTabId === held.activeAtHold) return true;
      this.held = null;
      return false;
    }
    this.held = null;
    if (urlTab === held.tabId && this.isExistingTab(held.tabId)) {
      this.tabManager.switchTab(held.tabId);
      return true;
    }
    return false;
  }

  /**
   * The tab segment of a chat URL: the id, `null` for a bare `/chat`, or
   * `undefined` when the URL is not on chat at all.
   *
   * Read from the URL's own first segment rather than
   * `SurfaceRouterService.currentSurface()`, which falls back to `chat` for
   * the pre-boot `/`. Under `withDisabledInitialNavigation()` that fallback
   * would let reaction 2 navigate to `/chat/<id>` before
   * `App.handleInitialView` has consumed the host's deep link.
   */
  private chatTabOf(url: string): string | null | undefined {
    const tree = this.router.parseUrl(url);
    const segments = tree.root.children[PRIMARY_OUTLET]?.segments ?? [];
    if (segments[0]?.path !== CHAT_SURFACE) return undefined;
    return segments[1]?.path ?? null;
  }

  private isExistingTab(id: string): boolean {
    return (
      TabId.validate(id) && this.tabManager.tabs().some((tab) => tab.id === id)
    );
  }

  /**
   * Replace the URL with `/chat/<id>`, or `/chat` when there is no active tab.
   *
   * A page transition defers the replace until its animation settles. A later
   * navigation or correction invalidates the queued work. Idle corrections
   * still start during NavigationEnd, before Router clears its pending intent.
   */
  private replaceChatUrl(): void {
    const deferred = this.transitionTracker.busy();
    const generation = ++this.routeGeneration;
    this.deferredCorrectionGeneration = deferred ? generation : null;
    this.correctionDropped = false;
    this.transitionTracker.afterTransition(() => {
      if (deferred) {
        if (generation !== this.routeGeneration || this.surfaceRouter.pendingSurface() !== null) {
          if (this.deferredCorrectionGeneration === generation) {
            this.deferredCorrectionGeneration = null;
            this.correctionDropped = true;
            this.reconcileDroppedCorrection();
          }
          return;
        }
        this.deferredCorrectionGeneration = null;
        const currentTab = this.chatTabOf(this.router.url);
        if (currentTab === undefined) return;
        if (currentTab === this.tabManager.activeTabId()) return;
      }
      void this.issueCorrection(this.tabManager.activeTabId());
    });
  }

  private reconcileDroppedCorrection(retryIfPending = true): void {
    if (!this.correctionDropped) return;
    if (this.surfaceRouter.pendingSurface() !== null) {
      if (retryIfPending) queueMicrotask(() => this.reconcileDroppedCorrection(false));
      return;
    }
    const currentTab = this.chatTabOf(this.router.url);
    this.correctionDropped = false;
    if (currentTab !== undefined && currentTab !== this.tabManager.activeTabId()) {
      this.followActiveTab(this.tabManager.activeTabId(), this.tabsReady());
    }
  }

  /**
   * Whether a navigation starting at `url` is another one than the correction
   * in flight. Its own start serializes to {@link Correction.url}; any other
   * URL supersedes it, including the same `/chat/<tab>` with a different
   * query, fragment or matrix parameter. The correction is then marked
   * dropped: should that newer navigation be cancelled or fail, nothing
   * settles to call reaction 1, and {@link reconcileDroppedCorrection}
   * restores the URL instead. A second start of the identical URL does not
   * supersede, so a guard that refuses the correction itself is not retried.
   */
  private supersedesCorrection(url: string): boolean {
    const correction = this.correction;
    if (correction === null) return false;
    return this.normalizedUrl(url) !== correction.url;
  }

  /** Canonical form of a navigation URL, so both sides of a comparison match. */
  private normalizedUrl(url: string): string {
    return this.router.serializeUrl(this.router.parseUrl(url));
  }

  /**
   * The replace is remembered until it finishes, so its landing is recognised
   * as ours: `NavigationEnd` is emitted before `navigateByUrl` resolves, and a
   * different navigation starting meanwhile marks it dropped
   * ({@link supersedesCorrection}). The outcome is otherwise ignored: the tab
   * state is already correct whatever the navigation does. A superseded
   * replace is reconciled when the superseding navigation is cancelled or
   * fails; one cancelled or failed on its own (a guard) is left as it is, so a
   * guard that always refuses cannot re-issue it forever. `navigateToSurface`
   * never rejects and logs a failure.
   */
  private async issueCorrection(activeTabId: string | null): Promise<void> {
    const correction: Correction = {
      tabId: activeTabId,
      url: this.normalizedUrl(this.router.serializeUrl(this.router.createUrlTree([
        '/',
        CHAT_SURFACE,
        ...(activeTabId === null ? [] : [activeTabId]),
      ]))),
    };
    this.correction = correction;
    try {
      await this.surfaceRouter.navigateToSurface(
        CHAT_SURFACE,
        activeTabId === null ? [] : [activeTabId],
        { replaceUrl: true },
      );
    } finally {
      if (this.correction === correction) this.correction = null;
    }
  }
}
