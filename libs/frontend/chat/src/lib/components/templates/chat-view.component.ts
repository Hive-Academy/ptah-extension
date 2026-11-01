import {
  Component,
  inject,
  signal,
  computed,
  viewChild,
  ChangeDetectionStrategy,
  DestroyRef,
  effect,
  afterRenderEffect,
  untracked,
  ElementRef,
  NgZone,
  OnDestroy,
  InjectionToken,
  Signal,
} from '@angular/core';
import {
  LucideAngularModule,
  Bell,
  Clock,
  Pencil,
  Trash2,
} from 'lucide-angular';
import { ChatTranscriptComponent } from '../organisms/transcript/chat-transcript.component';
import { ChatEmptyStateComponent } from '../molecules/setup-plugins/chat-empty-state.component';
import { AgentMonitorPanelComponent } from '../organisms/agent-monitor-panel.component';
// Sheet chrome is an allowed eager input. The lazy `chat-ui/display-panel`
// entry stays out of this chunk because the sheet names that panel only
// inside its own `@defer` (decisions #84, #89, #107).
import { DisplaySheetComponent } from '../organisms/display-sheet/display-sheet.component';
import { DisplayDockState } from '../../services/display-dock/display-dock.state';
import {
  connectDisplaySidebar,
  type DisplaySidebarConnection,
} from './display-sidebar-wiring';
import { ChatInputComponent } from '../molecules/chat-input/chat-input.component';
import { BackgroundTaskTilesContainerComponent } from '../molecules/background-task-tiles/background-task-tiles-container.component';
import { ChatSessionLayoutComponent } from './chat-session-layout.component';
import {
  QuestionCardComponent,
  CompactionNotificationComponent,
  CompactionMarkerComponent,
  SidebarTabComponent,
  StatsTileExpansionState,
  PTAH_UI_DISPLAY_DOCK,
  PTAH_UI_DISPLAY_DOCK_SYNC,
} from '@ptah-extension/chat-ui';
import { ResumeNotificationBannerComponent } from '../molecules/notifications/resume-notification-banner.component';
import { AuthRequiredBannerComponent } from '../molecules/notifications/auth-required-banner.component';
import { SessionBudgetBannerComponent } from '../molecules/notifications/session-budget-banner.component';
import {
  InstallScopeMigrationNoticeComponent,
  type InstallScopeMigrationNoticeAction,
} from '../molecules/notifications/install-scope-migration-notice.component';
import { CompactSessionCardComponent } from '../molecules/compact-session/compact-session-card.component';
import { AgentOriginBannerComponent } from '../molecules/agent-origin-banner/agent-origin-banner.component';
import { SessionInspectorStore } from '../../services/session-inspector';
import { injectSessionStatsSource } from '../../services/session-stats/session-stats-source';
import { ChatStore } from '../../services/chat.store';
import {
  ActionBannerService,
  type ActionBannerState,
} from '../../services/action-banner.service';
import { SessionBudgetActionsService } from '../../services/session-budget-actions.service';
import { TranscriptRetentionService } from '../../services/transcript-retention.service';
import { SessionLoaderService } from '../../services/chat-store/session-loader.service';
import { SessionHistoryReplayer } from '../../services/chat-store/session-history-replayer.service';
import { HistoryPagingService } from '../../services/chat-store/history-paging.service';
import {
  AgentMonitorStore,
  agentVisibleInSession,
} from '@ptah-extension/chat-streaming';
import { PanelResizeService } from '../../services/panel-resize.service';
import {
  TabManagerService,
  ConversationRegistry,
  TabSessionBinding,
  TabId,
  ConfirmationDialogService,
  commandCenterPersonaFor,
} from '@ptah-extension/chat-state';
import { StreamRouter } from '@ptah-extension/chat-routing';
import {
  SESSION_CONTEXT,
  SESSION_DISPLAY_DOCK,
  RAIL_TRANSCRIPT_RETENTION,
  SESSION_READ_ONLY,
  HIDE_AGENT_SIDEBAR,
  SESSION_VISIBLE,
  SESSION_FORCED_CARD,
  SESSION_START_GUARD,
  SESSION_FOCUSED,
} from '../../tokens/session-context.token';
import { SESSION_EMBED_CHROME } from '../../tokens/session-embed-chrome.token';
import {
  ClaudeRpcService,
  AppStateManager,
  AuthStateService,
  PlanLimitsStore,
  RpcResult,
  VSCodeService,
} from '@ptah-extension/core';
import { SessionId } from '@ptah-extension/shared';
import type {
  ChatSessionSummary,
  SubagentRecord,
  MessageAnchorHint,
} from '@ptah-extension/shared';

/** Minimum transcript/composer width requested by a Rail pane. */
export const RAIL_MIN_CONTENT_WIDTH = new InjectionToken<Signal<number | null>>(
  'RAIL_MIN_CONTENT_WIDTH',
);

export function shouldOverlayDock(
  hostWidth: number,
  dockWidth: number,
  minContentWidth: number | null,
  panelOpen: boolean,
): boolean {
  if (hostWidth === 0) return panelOpen;
  return (
    hostWidth < AGENT_PANEL_OVERLAY_BREAKPOINT ||
    (minContentWidth !== null && hostWidth - dockWidth < minContentWidth)
  );
}

/**
 * ChatViewComponent - Main chat view with message list and Egyptian themed welcome
 *
 * Complexity Level: 2 (Template with auto-scroll and empty state composition)
 * Patterns: Signal-based state, Auto-scroll behavior, Composition
 *
 * Features:
 * - Scrollable message list with smart auto-scroll
 * - Egyptian themed empty state (ChatEmptyStateComponent)
 * - Permission request handling
 * - Queued content indicator
 *
 * Auto-scroll behavior:
 * - Scrolls to bottom when new messages arrive
 * - Scrolls to bottom when streaming starts
 * - Disables auto-scroll when user scrolls up manually
 * - Re-enables when user scrolls back to bottom
 *
 * SOLID Principles:
 * - Single Responsibility: Chat view display and message orchestration
 * - Composition: Uses MessageBubble, ChatInput, and ChatEmptyState components
 */
/**
 * Width threshold (in px) below which the agent monitor panel renders as a
 * full-surface overlay instead of a side-by-side column.
 */
export const AGENT_PANEL_OVERLAY_BREAKPOINT = 600;

/** The Display dock's default width (design-spec section 2, R1.5). */
export const DISPLAY_DOCK_DEFAULT_WIDTH = 400;

/** `PanelResizeService` bounds: 300 px, at most 75% of the host. */
const DOCK_MIN_WIDTH = 300;
const DOCK_MAX_WIDTH_RATIO = 0.75;
/** Read the current motion preset at each switch; jsdom has no root tokens. */
function motionDurationMs(style: CSSStyleDeclaration | null, token: string, fallbackMs: number): number {
  const value = style?.getPropertyValue(token).trim() ?? '';
  const match = /^(\d+(?:\.\d+)?)(ms|s)$/.exec(value);
  return match ? Number(match[1]) * (match[2] === 's' ? 1000 : 1) : fallbackMs;
}

/** One separator arrow-key step (design-spec section 8, assertion 11). */
const DOCK_KEY_STEP = 16;

/**
 * The panel-state key of a view with no per-tab dock: the VS Code webview
 * (one monitor panel per view, as before) or an Electron view with no tab yet.
 */
const VIEW_PANEL_KEY = '';

@Component({
  selector: 'ptah-chat-view',
  // Scoped to this host, not `document`: a canvas holds up to 20 chat tiles, and
  // a document listener would close the overlay on every narrow tile at once.
  // Resize-drag Escape is handled separately by the temporary document listener below.
  host: {
    '(keydown.escape)': 'onEscapeKey($event)',
    '[class.is-entering]': 'enteringTabId() !== null',
  },
  imports: [
    LucideAngularModule,
    ChatTranscriptComponent,
    ChatEmptyStateComponent,
    AgentMonitorPanelComponent,
    DisplaySheetComponent,
    ChatInputComponent,
    BackgroundTaskTilesContainerComponent,
    ChatSessionLayoutComponent,
    QuestionCardComponent,
    ResumeNotificationBannerComponent,
    AuthRequiredBannerComponent,
    SessionBudgetBannerComponent,
    InstallScopeMigrationNoticeComponent,
    CompactionNotificationComponent,
    CompactionMarkerComponent,
    SidebarTabComponent,
    CompactSessionCardComponent,
    AgentOriginBannerComponent,
  ],
  templateUrl: './chat-view.component.html',
  styleUrl: './chat-view.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    TranscriptRetentionService,
    PanelResizeService,
    // One tile-expansion map per session view, released with the view (A3).
    StatsTileExpansionState,
    // Budget banner state belongs to this view's tab and session.
    SessionBudgetActionsService,
    // The Display dock store, only where the dock mounts: Electron (R1.14,
    // decision #108). In VS Code the token resolves to null, so the
    // transcript's live-turn effect and the chips stay inert. A host that
    // shows the display itself supplies the store (SESSION_DISPLAY_DOCK).
    {
      provide: DisplayDockState,
      useFactory: (): DisplayDockState | null =>
        inject(VSCodeService).isElectron
          ? (inject(SESSION_DISPLAY_DOCK, { optional: true }) ??
            new DisplayDockState())
          : null,
    },
    // The chat-ui ports the chip and the display sync read (decisions #59, #60).
    { provide: PTAH_UI_DISPLAY_DOCK, useExisting: DisplayDockState },
    { provide: PTAH_UI_DISPLAY_DOCK_SYNC, useExisting: DisplayDockState },
  ],
})
export class ChatViewComponent implements OnDestroy {
  readonly chatStore = inject(ChatStore);
  private readonly agentMonitorStore = inject(AgentMonitorStore);
  private readonly panelResizeService = inject(PanelResizeService);
  private readonly railMinContentWidth = inject(RAIL_MIN_CONTENT_WIDTH, {
    optional: true,
  });
  private readonly hostEl = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly ngZone = inject(NgZone);
  private readonly _sessionContext = inject(SESSION_CONTEXT, {
    optional: true,
  });
  private readonly _sessionStartGuard = inject(SESSION_START_GUARD, {
    optional: true,
  });
  /** Tile surfaces provide their on-screen state; absent → always visible. */
  private readonly _sessionVisible = inject(SESSION_VISIBLE, {
    optional: true,
  });
  protected readonly _forcedCard = inject(SESSION_FORCED_CARD, {
    optional: true,
  });
  /** Hides the VS Code Agents sidebar where panelists render elsewhere. */
  protected readonly hideAgentSidebar =
    inject(HIDE_AGENT_SIDEBAR, { optional: true }) ?? false;
  private readonly _tabManager = inject(TabManagerService);
  private readonly _appState = inject(AppStateManager);
  private readonly _conversationRegistry = inject(ConversationRegistry);
  private readonly _tabSessionBinding = inject(TabSessionBinding);
  /**
   * Asked one question only: "does an interactive workflow surface already own
   * this prompt?" — see the fallback ladder in
   * {@link resolvedQuestionRequests}. The verdict lives on the router so this
   * view and the routing itself can never disagree about who owns a prompt.
   */
  private readonly _streamRouter = inject(StreamRouter);
  private readonly sessionLoader = inject(SessionLoaderService);
  private readonly sessionHistoryReplayer = inject(SessionHistoryReplayer);
  private readonly historyPaging = inject(HistoryPagingService);
  private readonly _claudeRpc = inject(ClaudeRpcService);
  private readonly _confirmDialog = inject(ConfirmationDialogService);
  private readonly _authState = inject(AuthStateService);

  /** Inline re-auth banner state (set when a send fails needing auth). */
  protected readonly authRequiredBanner = this._authState.authRequiredBanner;

  private readonly staleOlderHistory = signal<{
    tabId: string;
    sessionId: string | null;
    /** Live events append; a reopen or reload replaces the loaded history. */
    firstMessage: unknown;
    message: string;
  } | null>(null);
  /** A reopened or closed tab no longer owns the stale paging snapshot. */
  protected readonly olderHistoryAlert = computed(() => {
    const stale = this.staleOlderHistory();
    if (!stale) return null;
    const tab = this._tabManager.findTabByIdAcrossWorkspaces(stale.tabId)?.tab;
    return tab?.claudeSessionId === stale.sessionId &&
      tab?.olderHistoryCursor === null &&
      tab?.messages[0] === stale.firstMessage
      ? { tabId: stale.tabId, message: stale.message }
      : null;
  });

  protected isHistoryReplaying(tabId: string): boolean {
    return this.sessionHistoryReplayer.isReplaying(tabId);
  }

  protected hasOlderHistory(tabId: string): boolean {
    const tab = this._tabManager.findTabByIdAcrossWorkspaces(tabId)?.tab;
    return typeof tab?.olderHistoryCursor === 'string';
  }

  protected isOlderHistoryLoading(tabId: string): boolean {
    return this.historyPaging.loadingTabIds().has(tabId);
  }

  protected async onOlderHistoryRequested(tabId: string): Promise<void> {
    this.staleOlderHistory.set(null);
    const outcome = await this.historyPaging.loadOlder(tabId);
    if (outcome === 'stale') {
      const message =
        'Earlier history changed. Reopen the session to load it again.';
      const tab = this._tabManager.findTabByIdAcrossWorkspaces(tabId)?.tab;
      if (tab) {
        this.staleOlderHistory.set({
          tabId,
          sessionId: tab.claudeSessionId,
          firstMessage: tab.messages[0],
          message,
        });
      }
      this.showActionError(message, tabId);
    } else if (outcome === 'failed') {
      this.showActionError(
        'Could not load earlier messages. Please try again.',
        tabId,
      );
    }
  }

  /**
   * Handle the banner's re-authenticate action. For Codex this opens a terminal
   * running `codex login`; the auth-file watcher then re-inits the adapter and
   * the banner clears on the next auth-status refresh. Other providers route to
   * Settings.
   */
  protected async onAuthReauth(): Promise<void> {
    const banner = this.authRequiredBanner();
    if (banner?.providerId === 'openai-codex') {
      await this._authState.codexLogin();
      return;
    }
    this._appState.setCurrentView('settings');
    this._authState.clearAuthRequiredBanner();
  }

  /** Dismiss the re-auth banner. */
  protected onAuthBannerDismiss(): void {
    this._authState.clearAuthRequiredBanner();
  }

  /**
   * The install-scope migration notice shows in one chat view at a time: the
   * main panel (no SESSION_CONTEXT, VS Code) or, where every view is a
   * session embed (Electron canvas), the focused full-chrome pane. Bare
   * hosts (harness builder, setup wizard, Command Center) and read-only
   * views never mount it, and an unfocused split pane or hidden workspace
   * does not either, so one card shows however many session views exist.
   */
  private readonly _sessionFocused = inject(SESSION_FOCUSED, {
    optional: true,
  });
  private readonly _embedChrome = inject(SESSION_EMBED_CHROME, {
    optional: true,
  });
  private readonly _installNoticeReadOnly =
    inject(SESSION_READ_ONLY, { optional: true }) ?? false;
  protected readonly showInstallMigrationNotice = computed(() => {
    if (this._installNoticeReadOnly) return false;
    if (!this._sessionContext) return true;
    return this._embedChrome !== 'bare' && (this._sessionFocused?.() ?? true);
  });

  /**
   * After "Got it" the notice is gone, so focus moves to the chat input
   * instead of falling back to the document body. "Open Marketplace" hides
   * this view; the marketplace view takes over and focus is not forced into
   * a hidden textarea.
   */
  protected onInstallMigrationNoticeDismissed(
    action: InstallScopeMigrationNoticeAction,
  ): void {
    if (action !== 'got-it') return;
    this.hostEl.nativeElement
      .querySelector<HTMLTextAreaElement>('[sessionComposer] textarea')
      ?.focus();
  }

  /**
   * Inline banner for branch/rewind actions. Sourced from the shared
   * `ActionBannerService` (S3); each banner carries a `tabId` and this view
   * only surfaces banners scoped to its own tab (or global `tabId: null`
   * ones), so a rewind fired on session A no longer toasts on session B's
   * surface when both are mounted in canvas/tile mode. The service owns its
   * own auto-clear timer.
   */
  private readonly actionBanner = inject(ActionBannerService);
  readonly actionInfo = computed(() => {
    const b = this.actionBanner.banner();
    if (!b || b.kind !== 'info') return null;
    return b.tabId === null || b.tabId === this.resolvedTabId()
      ? b.message
      : null;
  });

  /**
   * Bumped by every action banner this view shows, so a late outcome (a
   * branch tile that finishes loading after its timeout) can tell whether a
   * newer action has spoken since and stay quiet instead of replacing it.
   */
  private _actionBannerGeneration = 0;

  private showActionError(message: string, tabId: string | null = null): void {
    this._actionBannerGeneration++;
    this.actionBanner.showError(message, tabId);
  }

  private showActionInfo(message: string, tabId: string | null = null): void {
    this._actionBannerGeneration++;
    this.actionBanner.showInfo(message, tabId);
  }

  private showActionWarning(
    message: string,
    tabId: string | null = null,
  ): void {
    this._actionBannerGeneration++;
    this.actionBanner.showWarning(message, tabId);
  }

  /**
   * Per-message in-flight guard for branch/rewind actions. Prevents the user
   * from double-firing an action by clicking the same button twice while the
   * RPC round-trip is still pending. Keyed by messageId so independent
   * messages can run in parallel.
   */
  private readonly _actionInFlight = signal<Set<string>>(new Set());

  /** Lucide icon references for template binding */
  protected readonly BellIcon = Bell;
  protected readonly ClockIcon = Clock;
  protected readonly PencilIcon = Pencil;
  protected readonly TrashIcon = Trash2;

  private resizeObserver: ResizeObserver | null = null;

  /** Host width in pixels tracked by ResizeObserver */
  private readonly _hostWidth = signal<number>(0);
  protected readonly hostWidth = this._hostWidth.asReadonly();

  /**
   * Whether the chat view host is narrower than the overlay breakpoint.
   * When true and the agent panel is open, the panel renders as a full-surface overlay.
   *
   * A width of 0 means "not measured yet" and fails toward the overlay while the
   * panel is open, so a tile that mounts narrow with the panel already open never
   * shows the squeezed column. That branch assumes the width becomes known almost
   * at once — `observeHostWidth` guarantees it by seeding a width even where
   * `ResizeObserver` is missing, so 0 is transient and never a resting state.
   */
  protected readonly isOverlay = computed(() => {
    return shouldOverlayDock(
      this.hostWidth(),
      this.dockWidth(),
      this.railMinContentWidth?.() ?? null,
      this.panelOpen(),
    );
  });

  /** The Electron dock store; `null` in VS Code. */
  private readonly displayDock = inject(DisplayDockState, { optional: true });
  /** Electron: the right-side panel is the display dock. */
  protected readonly dockEnabled = this.displayDock !== null;
  /** A host-supplied dock: the host shows the display, so no sheet here. */
  protected readonly displaySheetEnabled =
    this.dockEnabled &&
    inject(SESSION_DISPLAY_DOCK, { optional: true }) === null;
  /**
   * Auto-open, persisted width and the separate window (set in the
   * constructor, once `resolvedTabId` exists); `null` without a dock.
   */
  private readonly displaySidebar: DisplaySidebarConnection | null;
  /** The main chat view in Electron: the sidebar offers Detach. */
  protected readonly displayDetachable = computed(
    () => (this.displaySidebar?.window ?? null) !== null,
  );
  /** The panel lives in the separate window: the main view shows the rail. */
  protected readonly displayDetached = computed(
    () => this.displaySidebar?.window?.detached() ?? false,
  );
  protected readonly displayWindowError = computed(
    () => this.displaySidebar?.window?.error() ?? null,
  );
  protected readonly displayWindowCount = computed(
    () => this.displaySidebar?.window?.count() ?? 0,
  );
  /**
   * Open state and the agent user-close rule of the right-side panel. The
   * dock store when there is one (per tab); otherwise a view-private instance
   * that no child can inject, so the VS Code monitor keeps one state per view.
   */
  private readonly panelState = this.displayDock ?? new DisplayDockState();
  /** The panel-state key: the dock's chat tab, or the view key. */
  protected readonly panelKey = computed(() =>
    this.displayDock !== null
      ? (this.resolvedTabId() ?? VIEW_PANEL_KEY)
      : VIEW_PANEL_KEY,
  );
  protected readonly panelTab = computed(() =>
    this.panelState.tab(this.panelKey()),
  );
  /** The right-side panel (dock or monitor) is open. */
  readonly panelOpen = computed(() => this.panelTab().open);
  /** Raised when the user opens the dock as an overlay: it focuses its close. */

  /** The dock width beside the chat: the user's width or 400 px, clamped. */
  protected readonly dockWidth = computed(() => {
    const custom = this.panelResizeService.customWidth();
    const width = clampDockWidth(
      custom ?? DISPLAY_DOCK_DEFAULT_WIDTH,
      this.hostWidth(),
    );
    return custom === null
      ? width
      : Math.min(width, this.dockMaxWidth() ?? Infinity);
  });
  protected readonly dockMaxWidth = computed(() => {
    const host = this.hostWidth();
    if (host <= 0) return null;
    const proportionalMax = Math.round(host * DOCK_MAX_WIDTH_RATIO);
    const minimum = this.railMinContentWidth?.() ?? null;
    return minimum === null
      ? proportionalMax
      : Math.max(DOCK_MIN_WIDTH, Math.min(proportionalMax, host - minimum));
  });
  protected readonly dockMinWidth = computed(() =>
    Math.min(DOCK_MIN_WIDTH, this.dockMaxWidth() ?? DOCK_MIN_WIDTH),
  );

  private readonly agentSidebarTab = viewChild(SidebarTabComponent);
  private restoreAgentSidebarTabFocus = false;

  /**
   * Track the host width so {@link isOverlay} can flip the agent panel between
   * the side-by-side column and the full-surface overlay. A CSS media query
   * would measure the window; a canvas tile is a sub-region of it.
   */
  private observeHostWidth(): void {
    const initialWidth = this.hostEl.nativeElement?.clientWidth;
    if (initialWidth && initialWidth > 0) {
      this._hostWidth.set(initialWidth);
    }

    // Without ResizeObserver the width would stay 0 forever, and `isOverlay`
    // would then track only the open state — a wide host would overlay. Seed the
    // window width instead: the tile may be narrower, but the layout degrades to
    // the pre-existing column rather than to a permanent overlay.
    if (typeof ResizeObserver === 'undefined') {
      if (this._hostWidth() === 0) {
        this._hostWidth.set(window.innerWidth);
      }
      return;
    }

    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width =
          entry.contentRect && entry.contentRect.width > 0
            ? entry.contentRect.width
            : (entry.target as HTMLElement).clientWidth;
        if (width > 0) {
          this.ngZone.run(() => {
            this._hostWidth.set(width);
          });
        }
      }
    });
    this.resizeObserver.observe(this.hostEl.nativeElement);
  }

  /**
   * Keyboard handler for Escape: closes the overlay when in narrow overlay mode.
   * Unlike resize-drag Escape (`_onKeydown`), this stays host-scoped so only the
   * focused tile closes. Focus is kept inside the tile when the overlay opens;
   * Escape is only a no-op if focus is moved outside the tile by another surface.
   */
  protected onEscapeKey(event: Event): void {
    if (event.defaultPrevented) return;
    if (this.isOverlay() && this.panelOpen()) {
      event.preventDefault();
      this.closeAgentPanel();
    }
  }

  /**
   * Session-scoped agents for the embedded panel. Empty when the host hides
   * the Agents list, so the badge and the agent auto-open stay inert.
   */
  readonly sessionAgents = computed(() => {
    if (this.hideAgentSidebar) return [];
    const sid = this.resolvedSessionId();
    if (!sid) {
      if (this._sessionContext) return [];
      return this.agentMonitorStore.agents();
    }
    return this._sessionContext
      ? this.agentMonitorStore.agentsOwnedBySession(sid)
      : this.agentMonitorStore.agentsForSession(sid);
  });

  /** Badge type for the Agents sidebar tab */
  readonly agentBadgeType = computed<'warning' | 'info' | 'neutral' | null>(
    () => {
      const agents = this.sessionAgents();
      if (agents.length === 0) return null;
      if (agents.some((a) => a.permissionQueue.length > 0)) return 'warning';
      if (agents.some((a) => a.status === 'running')) return 'info';
      return 'neutral';
    },
  );

  /**
   * The sidebar toggle. A user close holds agent auto-open until the agents
   * settle or a chip asks for them; the store owns that rule (decision #100).
   */
  toggleAgentPanel(): void {
    const key = this.panelKey();
    this.panelState.toggle(key);
  }

  closeAgentPanel(): void {
    this.restoreAgentSidebarTabFocus = this.isOverlay();
    this.panelState.close(this.panelKey());
  }

  /**
   * The dock separator's keys (R1.5, design-spec section 8 assertion 11): the
   * separator sits on the dock's left edge, so ArrowLeft widens and
   * ArrowRight narrows by 16 px; Home and End go to the bounds; Enter resets
   * to the default width. `PanelResizeService` clamps every value.
   */
  protected onDockSeparatorKeydown(event: KeyboardEvent): void {
    const host = this.hostWidth() || window.innerWidth;
    const width = this.dockWidth();
    let next: number | null;
    switch (event.key) {
      case 'ArrowLeft':
        next = width + DOCK_KEY_STEP;
        break;
      case 'ArrowRight':
        next = width - DOCK_KEY_STEP;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = Number.POSITIVE_INFINITY;
        break;
      case 'Enter':
        next = null;
        break;
      default:
        return;
    }
    event.preventDefault();
    if (next === null) {
      this.panelResizeService.resetWidth();
    } else {
      this.panelResizeService.setCustomWidth(next, host);
    }
    this.commitDockWidth();
  }

  /** Persists the current dock width (drag end, key step, reset only). */
  private commitDockWidth(): void {
    this.displaySidebar?.commitWidth(this.panelResizeService.customWidth());
  }

  protected detachDisplay(): void {
    void this.displaySidebar?.window?.detach();
  }

  protected focusDisplayWindow(): void {
    void this.displaySidebar?.window?.focus();
  }

  protected attachDisplayWindow(): void {
    void this.displaySidebar?.window?.attach();
  }

  private resizeHandleEl: HTMLElement | null = null;
  private resizePointerId: number | null = null;
  private _resizeFrame: number | null = null;
  private _latestResizeEvent: PointerEvent | null = null;
  private _startWidth: number | null = null;
  private _hostRight: number | null = null;

  private readonly onResizeMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.resizePointerId) return;
    this._latestResizeEvent = event;
    if (this._resizeFrame === null) {
      this._resizeFrame = requestAnimationFrame(this._applyResize);
    }
  };

  private readonly _applyResize = (): void => {
    this._resizeFrame = null;
    const event = this._latestResizeEvent;
    this._latestResizeEvent = null;
    if (!event || this._hostRight === null) return;
    const newWidth = this._hostRight - event.clientX;
    this.ngZone.run(() => {
      this.panelResizeService.setCustomWidth(
        newWidth,
        this.hostEl.nativeElement.clientWidth,
      );
    });
  };

  private readonly onResizeEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.resizePointerId) return;
    this._endResize(false);
  };

  private readonly _onBlur = (): void => this._endResize(true);

  private readonly _onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      this._endResize(true);
    }
  };

  /**
   * Start drag-resize.
   *
   * Uses pointer capture rather than document-level mouse listeners: the pointer
   * routinely leaves the window while dragging the agent panel edge, and a
   * `mouseup` fired outside the window never reaches the document — leaving the
   * drag stuck on forever. Capture guarantees the matching up/cancel event.
   */
  onResizeStart(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    this.endResize();

    const handle = event.currentTarget as HTMLElement;
    this.resizeHandleEl = handle;
    this.resizePointerId = event.pointerId;
    this._startWidth = this.panelResizeService.customWidth();
    this._hostRight = this.hostEl.nativeElement.getBoundingClientRect().right;

    handle.setPointerCapture(event.pointerId);

    this.ngZone.runOutsideAngular(() => {
      handle.addEventListener('pointermove', this.onResizeMove);
      handle.addEventListener('pointerup', this.onResizeEnd);
      handle.addEventListener('pointercancel', this.onResizeEnd);
      // Fires if the handle is torn out of the DOM mid-drag (panel auto-closes).
      handle.addEventListener('lostpointercapture', this.onResizeEnd);
      window.addEventListener('blur', this._onBlur);
      // Separate from host-scoped overlay Escape; this exists only during a resize drag.
      document.addEventListener('keydown', this._onKeydown);
    });

    this.panelResizeService.setDragging(true);
  }

  /** Double-click the handle to fall back to the responsive default width. */
  onResizeReset(): void {
    this.panelResizeService.resetWidth();
    this.commitDockWidth();
  }

  ngOnDestroy(): void {
    if (this.enteringTimer !== null) clearTimeout(this.enteringTimer);
    if (this.leavingTimer !== null) clearTimeout(this.leavingTimer);
    this._cancelResizeFrame();
    this._cleanupResizeListeners();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  private endResize(): void {
    this._endResize(false);
  }

  private _endResize(cancel: boolean): void {
    const startWidth = this._startWidth;
    const dragging = this.resizeHandleEl !== null;
    this._cancelResizeFrame();
    if (cancel && startWidth !== null) {
      this.ngZone.run(() => {
        this.panelResizeService.setCustomWidth(
          startWidth,
          this.hostEl.nativeElement.clientWidth,
        );
      });
    } else {
      this._applyResize();
    }
    this._cleanupResizeListeners();
    if (dragging && !cancel) this.ngZone.run(() => this.commitDockWidth());
  }

  private _cleanupResizeListeners(): void {
    const handle = this.resizeHandleEl;
    const pointerId = this.resizePointerId;
    this.resizeHandleEl = null;
    this.resizePointerId = null;
    this._latestResizeEvent = null;
    this._startWidth = null;
    this._hostRight = null;
    if (handle) {
      handle.removeEventListener('pointermove', this.onResizeMove);
      handle.removeEventListener('pointerup', this.onResizeEnd);
      handle.removeEventListener('pointercancel', this.onResizeEnd);
      handle.removeEventListener('lostpointercapture', this.onResizeEnd);
      if (pointerId !== null && handle.hasPointerCapture(pointerId)) {
        handle.releasePointerCapture(pointerId);
      }
    }
    window.removeEventListener('blur', this._onBlur);
    document.removeEventListener('keydown', this._onKeydown);
    this.ngZone.run(() => this.panelResizeService.setDragging(false));
  }

  private _cancelResizeFrame(): void {
    if (this._resizeFrame !== null) {
      cancelAnimationFrame(this._resizeFrame);
      this._resizeFrame = null;
    }
  }

  /** Signal-based viewChild for chat input (used for prompt-suggestion fill) */
  private readonly chatInputRef = viewChild(ChatInputComponent);

  /**
   * Resolved session ID: tile-scoped when SESSION_CONTEXT is provided, otherwise global.
   * Used by canvas tiles to scope streaming messages to their per-tile session.
   */
  readonly resolvedSessionId = computed(() => {
    const ctx = this._sessionContext;
    if (ctx) {
      const tabId = ctx();
      if (!tabId) return null;
      const tab = this._tabManager.tabs().find((t) => t.id === tabId);
      return tab?.claudeSessionId ?? null;
    }
    return this.chatStore.currentSessionId();
  });

  protected readonly resolvedTabId = computed(() => {
    const ctx = this._sessionContext;
    return ctx ? ctx() : this._tabManager.activeTabId();
  });

  /**
   * Resumable interrupted subagents scoped to THIS surface's session. The
   * backing `chatStore.resumableSubagents()` is a single root-scoped signal, so
   * in canvas/tile mode every tile would otherwise render the same list. Tile
   * mode (SESSION_CONTEXT present) filters by the tile's own resolved session
   * via `parentSessionId`; the main panel keeps the global list unchanged.
   *
   * Scoping goes through `agentVisibleInSession`, not a strict `===`: an
   * interrupted subagent whose owning session was never resolved would
   * otherwise match no tile at all, so the "N interrupted agents — Resume"
   * banner never appeared for the agents most likely to need it. That helper
   * also answers the other half — a tile whose OWN session has not resolved
   * renders nothing — so there is no pre-check here to disagree with it.
   */
  protected readonly resolvedResumableSubagents = computed<SubagentRecord[]>(
    () => {
      const all = this.chatStore.resumableSubagents();
      if (!this._sessionContext) return all;
      const sid = this.resolvedSessionId();
      return all.filter((s) => agentVisibleInSession(s.parentSessionId, sid));
    },
  );

  /**
   * Component-scoped LRU of tab ids whose transcript stays mounted (keep-alive).
   * One instance per ChatViewComponent (declared in `providers`).
   */
  private readonly _retention = inject(TranscriptRetentionService);

  private readonly _railRetention =
    inject(RAIL_TRANSCRIPT_RETENTION, { optional: true }) ?? false;

  /** A read-only host (e.g. the Command Center rail) renders no composer. */
  protected readonly readOnly =
    inject(SESSION_READ_ONLY, { optional: true }) ?? false;

  /**
   * Tab ids to render as `<ptah-chat-transcript>` instances. Tile mode
   * (SESSION_CONTEXT present) renders one tab unless Rail retention is opted in;
   * retained hosts keep their previous tabs mounted across switches
   * instead of rebuilding it.
   */
  protected readonly transcriptTabIds = computed<readonly string[]>(() => {
    const ctx = this._sessionContext;
    if (ctx && !this._railRetention) {
      const id = ctx();
      return id ? [id] : [];
    }
    // The active tab always renders (appended once if the retention effect has
    // not registered it yet), so the transcript never blinks on the frame
    // between an active-tab change and the effect touch. Appending at the end
    // matches where `touch` inserts it, so `@for track tabId` never reorders.
    const retained = this._retention.retainedTabIds();
    // A Rail context can briefly point at a tab the user has just closed.
    // Reading tabs keeps this list reactive when that happens.
    if (ctx && this._railRetention) {
      this._tabManager.tabs();
      const existing = retained.filter(
        (id) =>
          this._tabManager.findTabByIdAcrossWorkspaces(id) &&
          !this._retention.liveElsewhere(id),
      );
      const active = this.resolvedTabId();
      return active &&
        !existing.includes(active) &&
        this._tabManager.findTabByIdAcrossWorkspaces(active)
        ? [...existing, active]
        : existing;
    }
    const active = this.resolvedTabId();
    if (active && !retained.includes(active)) {
      return [...retained, active];
    }
    return retained;
  });

  /**
   * A tile surface reports its own on-screen state via SESSION_VISIBLE, so a
   * hidden-workspace tile's transcript freezes; when the token is absent
   * (tribunal conductor, tests) the view is treated as always showing.
   *
   * A user-chosen compact tab keeps the main transcript region mounted but
   * hidden. A forced Rail card tears it down and rebuilds it on return
   * (plan risk 6).
   */
  readonly mainPanelShowing = computed(() => this._sessionVisible?.() ?? true);

  /**
   * Resolved messages: tile-scoped when SESSION_CONTEXT is provided, otherwise global.
   */
  readonly resolvedMessages = computed(() => {
    const ctx = this._sessionContext;
    if (ctx) {
      const tabId = ctx();
      if (!tabId) return [];
      return (
        this._tabManager.tabs().find((t) => t.id === tabId)?.messages ?? []
      );
    }
    return this.chatStore.messages();
  });

  /**
   * Resolved streaming state: tile-scoped when SESSION_CONTEXT is provided, otherwise global.
   */
  readonly resolvedIsStreaming = computed(() => {
    const ctx = this._sessionContext;
    if (ctx) {
      const tabId = ctx();
      if (!tabId) return false;
      const status = this._tabManager
        .tabs()
        .find((t) => t.id === tabId)?.status;
      return status === 'streaming' || status === 'resuming';
    }
    return this.chatStore.isStreaming();
  });

  readonly resolvedSessionIsActive = computed(() => {
    const ctx = this._sessionContext;
    if (ctx) {
      const tabId = ctx();
      if (!tabId) return false;
      return (
        this._tabManager.tabs().find((t) => t.id === tabId)?.hasLiveSession ??
        false
      );
    }
    return this.chatStore.sessionIsActive();
  });

  private resolvedTab = computed(() => {
    const ctx = this._sessionContext;
    if (!ctx) return null;
    const tabId = ctx();
    if (!tabId) return null;
    return this._tabManager.tabs().find((t) => t.id === tabId) ?? null;
  });

  /**
   * Show the condensed card for a user-chosen compact tab or when its host
   * forces the card (Rail card, A-5).
   */
  protected readonly forcedCard = computed(() => this._forcedCard?.() ?? false);
  protected readonly userCompact = computed(
    () =>
      !this.forcedCard() && this.resolvedActiveTab()?.viewMode === 'compact',
  );
  protected readonly showCompactCard = computed(
    () => this.forcedCard() || this.userCompact(),
  );

  /**
   * The full TabState for the active tab (for compact card rendering).
   * Returns the active tab or tile-scoped tab.
   */
  readonly resolvedActiveTab = computed(() => {
    const ctx = this._sessionContext;
    if (ctx) {
      const tabId = ctx();
      if (!tabId) return null;
      return this._tabManager.tabs().find((t) => t.id === tabId) ?? null;
    }
    return this._tabManager.activeTab();
  });

  /**
   * Agent origin of the shown tab (TASK_2026_584), or null for a tab the user
   * opened. Reference-equal so the banner does not re-render on every
   * streaming tick that replaces the tab object.
   */
  protected readonly resolvedAgentOrigin = computed(
    () => this.resolvedActiveTab()?.agentOrigin ?? null,
    { equal: (a, b) => a === b },
  );

  /**
   * Title of the agent-started tab's parent while it is open in this
   * workspace's tab set, or null when it is gone (the banner says so and
   * offers no "Open parent").
   */
  protected readonly agentParentTitle = computed(() => {
    const origin = this.resolvedAgentOrigin();
    if (!origin) return null;
    const parent = this._tabManager
      .tabs()
      .find((t) => t.id === origin.parentTabId);
    return parent ? parent.title || 'New Chat' : null;
  });

  protected onOpenAgentParent(parentTabId: string): void {
    this._tabManager.switchTab(parentTabId);
  }

  private readonly _planLimits = inject(PlanLimitsStore);
  /** This surface's share of the plan-limits request; released on destroy. */
  private readonly _planLimitsScope = this._planLimits.registerScope(
    inject(DestroyRef),
  );

  /** Budget banner state, scoped to this view's tab and session. */
  private readonly _budgetActions = inject(SessionBudgetActionsService);

  /** The tab's budget state. */
  readonly resolvedSessionBudget = this._budgetActions.budget;
  /** Authoritative or live budget stage, whichever is higher. */
  protected readonly budgetDisplayStage = this._budgetActions.displayStage;
  protected readonly budgetDismissedStage = this._budgetActions.dismissedStage;
  protected readonly budgetWrapUpSent = this._budgetActions.wrapUpSent;
  protected readonly budgetAutoHandoffQueued =
    this._budgetActions.autoHandoffQueued;

  /**
   * The one stats source of this view (Delta 3). It names the run owners of
   * this view's session for the plan-limits scope below. A view with no tab
   * context reads the ChatStore, the active session id and this view's
   * budget; `null` until the view has messages.
   */
  protected readonly stats = injectSessionStatsSource({
    tab: () => this.resolvedTab(),
    sessionId: () => this.resolvedSessionId(),
    budget: () => this.resolvedSessionBudget(),
    available: () => this.resolvedMessages().length > 0,
  });

  private readonly _inspectorStore = inject(SessionInspectorStore);

  /** Unique pending requests of the shown tab (the inspector's one count). */
  protected readonly needsYouCount = computed(() => {
    const tabId = this.resolvedTabId();
    return tabId ? this._inspectorStore.modelFor(tabId)().needsYouCount : 0;
  });

  protected readonly enteringTabId = signal<string | null>(null);
  protected readonly pendingEntranceTabId = signal<string | null>(null);
  /** The previous tab, kept on screen over the new one while it fades out. */
  protected readonly leavingTabId = signal<string | null>(null);
  private enteringTimer: ReturnType<typeof setTimeout> | null = null;
  private leavingTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * A tab edge owns one entrance window; changing its session or mode does not.
   * The previous transcript stays visible while history loads. Once the new
   * one has content, their glass-free slots crossfade and the new pane rises.
   */
  private wireSessionEntrance(): void {
    let lastTabId: string | null = null;
    effect(() => {
      const tabId = this.resolvedTabId();
      if (tabId === null) {
        lastTabId = null;
        this.pendingEntranceTabId.set(null);
        untracked(() => this.startLeave(null));
        return;
      }
      if (tabId !== lastTabId) {
        const previous = lastTabId;
        lastTabId = tabId;
        this.pendingEntranceTabId.set(tabId);
        untracked(() => this.startLeave(previous));
      }
      if (this.pendingEntranceTabId() !== tabId || !this.entranceContentReady()) return;
      this.pendingEntranceTabId.set(null);
      untracked(() => this.startEnter(tabId));
    });
  }

  /** True when the shown tab has messages or is not waiting for history. */
  private entranceContentReady(): boolean {
    const tab = this.resolvedActiveTab();
    if (!tab || tab.messages?.length) return true;
    return (
      tab.status !== 'resuming' &&
      tab.status !== 'switching' &&
      !this.isHistoryReplaying(tab.id)
    );
  }

  private startEnter(tabId: string): void {
    if (this.enteringTimer !== null) clearTimeout(this.enteringTimer);
    if (this.leavingTimer !== null) clearTimeout(this.leavingTimer);
    const style = typeof getComputedStyle === 'function'
      ? getComputedStyle(this.hostEl.nativeElement) : null;
    const stagger = motionDurationMs(style, '--ptah-stagger-step', 36);
    const entrance = motionDurationMs(style, '--ptah-motion-in', 320);
    const paneSwitch = motionDurationMs(style, '--ptah-motion-switch', 380);
    // Last staggered row: 60 ms lead + six steps + its own entrance.
    const enterWindowMs = Math.max(60 + 6 * stagger + entrance, paneSwitch) + 44;
    this.enteringTabId.set(tabId);
    this.ngZone.runOutsideAngular(() => {
      this.enteringTimer = setTimeout(() => {
        this.enteringTimer = null;
        this.enteringTabId.set(null);
      }, enterWindowMs);
    });
    if (this.leavingTabId() !== null) {
      const leaveWindowMs = motionDurationMs(style, '--ptah-motion-out', 180) + 40;
      this.ngZone.runOutsideAngular(() => {
        this.leavingTimer = setTimeout(() => {
          this.leavingTimer = null;
          this.leavingTabId.set(null);
        }, leaveWindowMs);
      });
    }
  }

  private startLeave(previous: string | null): void {
    if (this.leavingTimer !== null) {
      clearTimeout(this.leavingTimer);
      this.leavingTimer = null;
    }
    const shown =
      previous !== null &&
      this.mainPanelShowing() &&
      this.transcriptTabIds().includes(previous);
    this.leavingTabId.set(shown ? previous : null);
    if (!shown) return;
    const style = typeof getComputedStyle === 'function'
      ? getComputedStyle(this.hostEl.nativeElement) : null;
    const switchMs = motionDurationMs(style, '--ptah-motion-switch', 380);
    const leaveMs = motionDurationMs(style, '--ptah-motion-out', 180);
    // Show the new tab's loading state even if history never becomes ready.
    const safetyWindowMs = Math.min(2000, Math.max(1000, switchMs + leaveMs + 40));
    this.ngZone.runOutsideAngular(() => {
      this.leavingTimer = setTimeout(() => {
        this.leavingTimer = null;
        this.leavingTabId.set(null);
      }, safetyWindowMs);
    });
  }

  /**
   * The budget banner shows on the active tab of the main panel, idle or
   * streaming: the wrap-up message queues like any typed one while a turn runs.
   * The banner itself decides the stage (handoff or limit, not dismissed).
   */
  protected readonly showSessionBudgetBanner = computed(() => {
    const tab = this.resolvedActiveTab();
    const tabId = this.resolvedTabId();
    return (
      this.resolvedSessionBudget() !== null &&
      this.mainPanelShowing() &&
      (tab?.status === 'loaded' || tab?.status === 'streaming') &&
      tabId !== null &&
      tabId === this._tabManager.activeTabId()
    );
  });

  /**
   * Resolved isCompacting: tile-scoped when SESSION_CONTEXT is provided, otherwise global.
   * Prevents compaction banner from showing on ALL canvas tiles when only one session compacts.
   *
   * Sourced from `ConversationRegistry` via `TabSessionBinding`. Compaction
   * is conversation-scoped, so every tab bound to the conversation sees the
   * banner together (canvas-grid).
   *
   * Reads ONLY from the conversation registry, through
   * `ChatStore.isCompactingForTab` — the same derivation the chat-input
   * overlay uses, so banner and overlay cannot disagree. Unresolved
   * conversations simply render no banner, which is the correct state for an
   * unrouted tab.
   *
   * Scoped by `resolvedTabId()`, the same derivation
   * `ChatInputComponent.resolvedIsCompacting` uses. Deriving the id from
   * `resolvedTab()` instead fell back to the GLOBAL active tab whenever
   * SESSION_CONTEXT held a tab id absent from `tabs()` — a tile still
   * resolving, or one whose tab had just closed — so the banner reported the
   * active tab's compaction while the overlay reported the tile's
   * (PR #493 review C).
   */
  readonly resolvedIsCompacting = computed(() =>
    this.chatStore.isCompactingForTab(this.resolvedTabId()),
  );

  /**
   * The finished-compaction chip: hidden while a run is in flight (the
   * notice card shows then) and once the user sent a message after it.
   */
  protected readonly visibleCompactionMarker = computed(() => {
    if (this.resolvedIsCompacting()) return null;
    const marker = this.resolvedCompactionMarker();
    if (!marker) return null;
    const answered = this.resolvedMessages().some(
      (m) => m.role === 'user' && m.timestamp > marker.completedAt,
    );
    return answered ? null : marker;
  });

  /** Same tab scope as the banner above — the two must never disagree. */
  readonly resolvedCompactionMarker = computed(() => {
    const rawTabId = this.resolvedTabId();
    if (!rawTabId) return null;
    const tabId = TabId.safeParse(rawTabId);
    if (!tabId) return null;
    const convId = this._tabSessionBinding.conversationFor(tabId);
    if (!convId) return null;
    return this._conversationRegistry.compactionMarkerFor(convId);
  });

  /**
   * Resolved question requests: scoped to this tile's session in canvas mode.
   *
   * Routing source-of-truth: per-question target tab ids resolved by
   * `StreamRouter.routeQuestionPrompt` (mirrors permission prompt routing).
   * The router resolves the question's `sessionId` against the live
   * conversation/binding registries — robust to compaction-driven session id
   * rotation, late `SESSION_ID_RESOLVED`, and idle re-binding (the cases
   * that previously caused silent hangs because the payload's raw ids no
   * longer matched any tile).
   *
   * Fallback ladder (only when the router did NOT resolve any target tabs
   * for the question — e.g. payload arrived before the binding was visible
   * to the router):
   *   1. Legacy id-equality match against the tile's `resolvedTabId` /
   *      `resolvedSessionId`. Same as before — covers the happy path before
   *      any rotation/late resolution.
   *   2. If that yields nothing AND this tile is the active tab (or no
   *      canvas context is in play), still show the question. This prevents
   *      silent drops; the backend's `awaitQuestionResponse` has
   *      `timeoutAt: 0` (block indefinitely) so a dropped question hangs
   *      the tool call forever.
   *
   * Rung 2 is a safety net for questions NOBODY owns, and it must stay that
   * way. A workflow surface (New Project, harness builder) raises questions
   * whose `tabId`/`sessionId` is its own correlation id, which resolves to a
   * `SurfaceId` rather than a tab — so rung 1 misses by construction and the
   * net used to fire, painting the workflow's question onto whichever canvas
   * tile happened to be focused while the workflow's own panel stayed empty.
   * A claimed correlation id means the prompt HAS an owner and this tile is
   * not it; showing it here is a mis-route, not a rescue (TASK_2026_317).
   */
  readonly resolvedQuestionRequests = computed(() => {
    const allQuestions = this.chatStore.questionRequests();
    if (allQuestions.length === 0) return [];

    const tabId = this.resolvedTabId(); // frontend UUID (e.g. "tab-abc123")
    const activeTabId = this._tabManager.activeTabId();
    const isActiveTile = tabId !== null && tabId === activeTabId;

    return allQuestions.filter((q) => {
      const targets = this.chatStore.questionTargetTabsFor(q.id);
      if (targets.length > 0) {
        return tabId !== null && targets.includes(tabId);
      }
      const legacyMatch =
        tabId !== null && (q.tabId === tabId || q.sessionId === tabId);
      if (legacyMatch) return true;
      if (this.isClaimedByWorkflowSurface(q)) return false;
      return isActiveTile;
    });
  });

  /**
   * True when an INTERACTIVE workflow surface owns this question — it has a
   * panel of its own to render the card on, so the active-tile safety net in
   * {@link resolvedQuestionRequests} must stand down rather than adopt it.
   *
   * Delegated to the router rather than reading the claim map directly. A raw
   * claim lookup is not the same question: Tribunal claims its CONDUCTOR TAB's
   * id against a surface it never registers, and treating that as "owned
   * elsewhere" would have hidden the conductor's own prompts from every tile
   * but the one already matching by id.
   */
  private isClaimedByWorkflowSurface(q: {
    readonly tabId?: string;
    readonly sessionId?: string;
  }): boolean {
    return this._streamRouter.interactiveSurfaceOwning(q) !== null;
  }

  readonly resolvedQueuedContent = computed(() => {
    const tab = this.resolvedTab();
    return tab !== null
      ? (tab.queuedContent ?? null)
      : this.chatStore.queuedContent();
  });

  constructor() {
    this._budgetActions.connect({
      activeTab: this.resolvedActiveTab,
      tabId: this.resolvedTabId,
      sessionId: this.resolvedSessionId,
      bannerVisible: this.showSessionBudgetBanner,
    });
    this.observeHostWidth();
    this.wireSessionEntrance();

    // A closed chat tab's dock state is released, whichever path closed it
    // (shortcut, canvas, tribunal); the view's own key is never a tab.
    // `tabs()` lists only the active workspace, so a tab that left it is
    // forgotten only when no workspace still holds it.
    const dock = this.displayDock;
    this.displaySidebar =
      dock === null
        ? null
        : connectDisplaySidebar({
            dock,
            tabId: this.resolvedTabId,
            main: this.displaySheetEnabled && !this._sessionContext,
            resize: this.panelResizeService,
          });
    if (dock !== null) {
      const openIds = (): ReadonlySet<TabId> =>
        new Set(this._tabManager.tabs().map((tab) => tab.id));
      let openTabIds = untracked(openIds);
      effect(() => {
        const current = openIds();
        for (const tabId of openTabIds)
          if (!current.has(tabId))
            untracked(() => {
              if (!this._tabManager.findTabByIdAcrossWorkspaces(tabId))
                dock.forgetTab(tabId);
            });
        openTabIds = current;
      });
    }

    afterRenderEffect(() => {
      const panelOpen = this.panelOpen();
      const sidebarTab = this.agentSidebarTab();
      if (this.restoreAgentSidebarTabFocus && !panelOpen && sidebarTab) {
        const button =
          this.hostEl.nativeElement.querySelector<HTMLButtonElement>(
            'ptah-sidebar-tab button',
          );
        if (!button) return;
        button.focus();
        this.restoreAgentSidebarTabFocus = false;
      }
    });

    // Hydrate this surface's CLI agent cards from persisted metadata. Each
    // surface asks for its OWN session — a canvas tile is rarely the active
    // tab, and the bootstrap-time active-tab restore only ever covered one of
    // them, so agents spawned in a prior run never came back on the others.
    // SessionLoaderService dedupes per session, so the extra calls from the
    // main panel and sibling tiles cost nothing.
    effect(() => {
      const sessionId = this.resolvedSessionId();
      if (!sessionId) return;
      untracked(() => {
        this.sessionLoader
          .restoreCliSessionsForSession(sessionId)
          .catch((err) => {
            console.warn(
              '[ChatView] Failed to restore CLI sessions for surface:',
              err,
            );
          });
      });
    });

    // Name this surface's session and the owners its runs recorded in its own
    // plan-limits scope. The store asks the host for the union of every live
    // surface's scope, so a sibling grid pane (or this pane with no session,
    // `[]`) never erases another pane's sessions.
    effect(() => {
      const sessionId = this.resolvedSessionId();
      const ownerKeys = this.stats.runOwnerKeys();
      untracked(() => {
        void this._planLimitsScope.update({
          sessionIds: sessionId ? [sessionId] : [],
          ownerKeys: [...ownerKeys],
        });
      });
    });

    // Force the embedded agent panel open when a deep-tree caller (the
    // "Workflow launched" chip) requests it via AgentMonitorStore. The store's
    // monotonic sequence re-triggers even after the user manually closed the
    // panel. Sequence starts at 0 (initial effect run is a no-op).
    //
    // The request names the tab it came from. Only the surface rendering that
    // tab reacts — with several canvas tiles live, an unscoped request opened
    // the panel in every one of them (the chip is inside one tile, the effect
    // runs in all). A request with no tab id came from the main panel, which
    // has no SESSION_CONTEXT, so only main-panel surfaces honour it.
    effect(() => {
      if (this.dockEnabled) return;
      const request = this.agentMonitorStore.panelOpenRequest();
      if (request.seq === 0) return;
      untracked(() => {
        const mine = this._sessionContext
          ? request.tabId === this._sessionContext()
          : request.tabId === null;
        if (!mine) return;
        const key = this.panelKey();
        this.panelState.selectTab(key, 'agents');
        this.panelState.open(key);
        this.panelState.releaseAgentsUserClose(key);
      });
    });

    effect(() => {
      const request = this._appState.composerPrefillRequest();
      if (request.seq === 0) return;
      const chatInput = this.chatInputRef();
      untracked(() => {
        const mine = this._sessionContext
          ? request.tabId === this._sessionContext()
          : request.tabId === null;
        if (!mine || !chatInput) return;
        chatInput.restoreContentToInput(request.text);
        // Consume the request: a surface recreated for the same tab (a canvas
        // tile removed and re-added) must not replay this prefill over the
        // current draft in its own constructor effect.
        this._appState.clearComposerPrefill();
      });
    });

    // VS Code sidebar auto-open: running agents or a pending permission
    // ask for the Agents view, which the store ignores while
    // the panel is open or after a user close; settled agents release it.
    effect(() => {
      if (this.dockEnabled) return;
      const key = this.panelKey();
      const agents = this.sessionAgents();
      const hasRunning = agents.some((a) => a.status === 'running');
      const hasPendingPermission = agents.some(
        (a) => a.permissionQueue.length > 0,
      );
      untracked(() => {
        if (hasRunning || hasPendingPermission) {
          this.panelState.requestAgentsOpen(key);
        } else if (agents.length > 0) {
          this.panelState.releaseAgentsUserClose(key);
        }
      });
    });
  }

  /** Uses the same canvas open/focus path as SessionRowActionsService.openSession. */
  async handleResumeRequested(sessionId: string): Promise<void> {
    try {
      if (await this._appState.requestCanvasSession(sessionId)) return;
    } catch {
      // Rejected requests use the same fixed-copy error as unsuccessful opens.
    }
    this.showActionError(
      'Could not open the previous session. Please try again.',
      this.resolvedTabId(),
    );
  }

  /**
   * Handle prompt selection from empty state - fill chat input.
   * Uses ChatInputComponent.restoreContentToInput which handles focus and auto-resize.
   */
  handlePromptSelected(promptText: string): void {
    const chatInput = this.chatInputRef();
    if (chatInput) {
      chatInput.restoreContentToInput(promptText);
    }
  }

  /**
   * Edit queued message — pushes content back to the input and clears the queue.
   * Uses restoreContentToInput so the user can modify and re-send.
   */
  editQueue(): void {
    const content = this.resolvedQueuedContent();
    if (!content) return;

    const tabId = this.resolvedTabId() ?? undefined;
    this.chatStore.clearQueuedContent(tabId);

    const chatInput = this.chatInputRef();
    if (chatInput) {
      chatInput.restoreContentToInput(content);
    }
  }

  /**
   * Cancel queued message (user-requested cancellation).
   * Uses resolvedTabId to target the tab this view renders.
   */
  cancelQueue(): void {
    const tabId = this.resolvedTabId() ?? undefined;
    this.chatStore.clearQueuedContent(tabId);
  }

  /**
   * Handle per-agent resume action from the resume notification banner.
   * Builds a structured resume prompt and sends it via ChatStore,
   * then clears the resumable subagents to dismiss the banner.
   *
   * Uses sendOrQueueMessage instead of sendMessage so that:
   * - If streaming: message is queued and auto-sent when the turn completes
   * - If not streaming: message is sent immediately to the existing session
   * This prevents creating a new session when the tab is in streaming status.
   */
  handleResumeAgent(agent: SubagentRecord): void {
    const reason = this._sessionStartGuard?.();
    if (reason) {
      this.showActionError(reason, this._sessionContext?.() ?? null);
      return;
    }
    const prompt = `Resume agent ${agent.agentId} (the interrupted ${agent.agentType} agent) and have it continue its previous work from where it was interrupted.`;
    const tabId = this._sessionContext?.() ?? undefined;
    this.chatStore.sendOrQueueMessage(prompt, { tabId });
    this.chatStore.removeResumableSubagent(agent.toolCallId);
  }

  /**
   * Handle "Resume All" — builds a single combined prompt for all interrupted agents
   * and sends it as one message to the existing session.
   */
  handleResumeAllAgents(agents: SubagentRecord[]): void {
    if (agents.length === 0) return;

    if (agents.length === 1) {
      this.handleResumeAgent(agents[0]);
      return;
    }

    const reason = this._sessionStartGuard?.();
    if (reason) {
      this.showActionError(reason, this._sessionContext?.() ?? null);
      return;
    }

    const agentList = agents
      .map((a) => `- Resume agent ${a.agentId} (${a.agentType})`)
      .join('\n');
    const prompt = `Resume all ${agents.length} interrupted agents and have each continue its previous work from where it was interrupted:\n${agentList}`;
    const tabId = this._sessionContext?.() ?? undefined;
    this.chatStore.sendOrQueueMessage(prompt, { tabId });
    for (const agent of agents) {
      this.chatStore.removeResumableSubagent(agent.toolCallId);
    }
  }

  /**
   * Handle Dismiss (X) on the resume banner: drop the agents from the store
   * and the backend registry so a later session switch does not bring the
   * banner back. The backend tells the model about them on the next turn.
   */
  handleDismissResumableAgents(agents: SubagentRecord[]): void {
    void this.chatStore.dismissResumableSubagents(agents);
  }

  /** Budget banner "Wrap up & hand off": one normal message to the agent. */
  protected onBudgetWrapUp(): Promise<void> {
    const reason = this._sessionStartGuard?.();
    if (reason) {
      this.showActionError(reason, this._sessionContext?.() ?? null);
      return Promise.resolve();
    }
    return this._budgetActions.sendWrapUp();
  }

  protected onBudgetDismiss(): void {
    this._budgetActions.dismiss();
  }

  /** Budget banner "Cancel" on a queued automatic hand-off. */
  protected onBudgetCancelAutoHandoff(): void {
    this._budgetActions.cancelAutoHandoff();
  }

  /**
   * Build the fork/rewind anchor hint for a clicked message.
   *
   * A live user bubble carries a client-only optimistic id that was never
   * written to the session transcript, so the backend cannot map it to the
   * SDK line UUID that `forkSession`/`rewindFiles` require. The hint lets the
   * backend recover that UUID by matching the prompt's verbatim text.
   * `occurrence` disambiguates identical repeated prompts (e.g. two "commit"
   * messages) by counting how many earlier user messages share the same text.
   *
   * Returns `undefined` for non-user messages or empty text — history-loaded
   * messages already carry the real UUID as their id, so the hint is unused.
   */
  /**
   * Resolve the fork/rewind anchor for a clicked message to the SDK's real
   * transcript line UUID. A live user bubble renders under an optimistic
   * client-only id, but `StreamingHandlerService` stamps the real uuid (from
   * the SDK user `message_start`) onto `nativeUuid` during the turn. Prefer
   * that; fall back to the message id (already the real uuid for
   * history-loaded messages). This is the documented checkpoint/fork id — no
   * reconstruction needed.
   */
  private resolveAnchorId(messageId: string): string {
    const message = this.resolvedMessages().find((m) => m.id === messageId);
    return message?.nativeUuid ?? messageId;
  }

  private buildAnchorHint(messageId: string): MessageAnchorHint | undefined {
    const messages = this.resolvedMessages();
    const index = messages.findIndex((m) => m.id === messageId);
    if (index === -1) return undefined;
    const message = messages[index];
    if (message.role !== 'user') return undefined;
    const text = (message.rawContent ?? '').trim();
    if (!text) return undefined;
    let occurrence = 0;
    for (let i = 0; i < index; i++) {
      const earlier = messages[i];
      if (
        earlier.role === 'user' &&
        (earlier.rawContent ?? '').trim() === text
      ) {
        occurrence++;
      }
    }
    let occurrenceFromEnd = 0;
    for (let i = index + 1; i < messages.length; i++) {
      const later = messages[i];
      if (later.role === 'user' && (later.rawContent ?? '').trim() === text) {
        occurrenceFromEnd++;
      }
    }
    return { text, occurrence, occurrenceFromEnd };
  }

  /**
   * "Branch from here" — fork the current session at the given user message
   * into a new tab. The backend slices the JSONL transcript up to and
   * including `messageId` and returns a fresh session UUID, which opens as a
   * new canvas tile via `AppStateManager.requestCanvasSession()`.
   */
  async onBranchRequested(messageId: string): Promise<void> {
    // The tab this branch was started from; a late failure is scoped to it.
    const originTabId = this.resolvedTabId();
    const sessionId = this.resolvedSessionId();
    if (!sessionId) {
      this.showActionError('No active session to branch from.');
      return;
    }
    const inFlight = this._actionInFlight();
    if (inFlight.has(messageId)) return;
    this._actionInFlight.set(new Set([...inFlight, messageId]));

    try {
      const result = await this._claudeRpc.forkSession(
        sessionId,
        this.resolveAnchorId(messageId),
        undefined,
        undefined,
        this.buildAnchorHint(messageId),
      );

      if (result.isSuccess()) {
        const newSessionId = result.data.newSessionId;
        // `false` covers the tile cap, the canvas not draining in time, and a
        // failed load: the fork exists on disk either way.
        // The canvas drains the request BEFORE it awaits the session load, so
        // app-state's 5 s timer cannot settle a hung load. Bound the wait so
        // `_actionInFlight` always clears. On a timeout the load is still
        // running and can still fail, so report the branch as still opening
        // and let the original promise report a late failure.
        const opening = this._appState.requestCanvasSession(
          newSessionId,
          'Branch',
        );
        let timer: ReturnType<typeof setTimeout> | undefined;
        const opened = await Promise.race([
          opening,
          new Promise<'timeout'>((resolve) => {
            timer = setTimeout(
              () => resolve('timeout'),
              ChatViewComponent.BRANCH_OPEN_TIMEOUT_MS,
            );
          }),
        ]).finally(() => clearTimeout(timer));
        if (opened === 'timeout') {
          this.showActionInfo('Branch created. It is still opening.');
          // A late `true` needs no notice. A late `false` or rejection means
          // the tile never opened: report it on the originating tab, unless a
          // newer banner has been shown since. The trailing catch keeps a
          // throwing handler from becoming an unhandled rejection.
          const pending = {
            generation: this._actionBannerGeneration,
            banner: this.actionBanner.banner(),
          };
          opening
            .then(
              (lateOpened) => {
                if (!lateOpened) this.showLateBranchError(originTabId, pending);
              },
              () => this.showLateBranchError(originTabId, pending),
            )
            .catch((error: unknown) => {
              console.warn(
                '[ChatView] Failed to report a late branch outcome:',
                error,
              );
            });
        } else if (opened) {
          this.showActionInfo('Branch created.');
        } else {
          this.showBranchNotOpenedError();
        }
      } else {
        this.showActionError(
          `Branch failed: ${result.error ?? 'Unknown error'}`,
        );
      }
    } finally {
      const next = new Set(this._actionInFlight());
      next.delete(messageId);
      this._actionInFlight.set(next);
    }
  }

  private showBranchNotOpenedError(tabId: string | null = null): void {
    this.showActionError(
      'Branch created, but it did not open. Open it from Previous sessions.',
      tabId,
    );
  }

  /**
   * Late branch failure (after the open timeout). Suppressed when this view
   * has shown a newer banner, or when the shared banner slot now holds a
   * banner from another action (another tile), so it never replaces it.
   */
  private showLateBranchError(
    tabId: string | null,
    pending: { generation: number; banner: ActionBannerState | null },
  ): void {
    if (this._actionBannerGeneration !== pending.generation) return;
    const current = this.actionBanner.banner();
    if (current !== null && current !== pending.banner) return;
    this.showBranchNotOpenedError(tabId);
  }

  async onRewindRequested(messageId: string): Promise<void> {
    const sessionId = this.resolvedSessionId();
    if (!sessionId) {
      this.showActionError('No active session to rewind.');
      return;
    }
    const inFlight = this._actionInFlight();
    if (inFlight.has(messageId)) return;
    this._actionInFlight.set(new Set([...inFlight, messageId]));

    try {
      await this.attemptRewindV2(sessionId, messageId);
    } finally {
      const next = new Set(this._actionInFlight());
      next.delete(messageId);
      this._actionInFlight.set(next);
    }
  }

  private async attemptRewindV2(
    sessionId: SessionId,
    messageId: string,
  ): Promise<void> {
    const originalTab = this._tabManager.findTabBySessionId(sessionId);
    const originWorkspacePath = originalTab
      ? (this._tabManager.findTabByIdAcrossWorkspaces(originalTab.id)
          ?.workspacePath ??
        this._tabManager.activeWorkspacePath ??
        '')
      : (this._tabManager.activeWorkspacePath ?? '');
    const anchorId = this.resolveAnchorId(messageId);
    const anchorHint = this.buildAnchorHint(messageId);
    const rewindTab = this._tabManager.findTabBySessionId(sessionId);
    const systemPrompt = rewindTab
      ? commandCenterPersonaFor(rewindTab)
      : undefined;
    const dryRun = await this._claudeRpc.rewindFiles(
      sessionId,
      anchorId,
      true,
      anchorHint,
      systemPrompt,
    );

    if (!dryRun.isSuccess()) {
      this.showActionError(`Rewind failed: ${dryRun.error ?? 'Unknown error'}`);
      return;
    }

    const dryData = dryRun.data;
    const cannotRewind = !dryData.canRewind;
    const files = dryData.filesChanged ?? [];
    const ins = dryData.insertions ?? 0;
    const del = dryData.deletions ?? 0;
    const checkpointsLost =
      cannotRewind || (files.length === 0 && ins === 0 && del === 0);

    const fileList = checkpointsLost
      ? cannotRewind
        ? `No file changes can be reverted (${
            dryData.error ?? 'no checkpoints available'
          }). The conversation will still be truncated to this point.`
        : 'No file changes can be reverted — checkpoints were lost when the session was previously closed. The conversation will still be truncated to this point.'
      : files.length === 0
        ? 'No files will be modified.'
        : files
            .slice(0, 10)
            .map((p) => `• ${p}`)
            .join('\n') +
          (files.length > 10 ? `\n…and ${files.length - 10} more` : '');

    const header = checkpointsLost
      ? 'The conversation will be rewound to this message in place.'
      : `${files.length} file(s) will be reverted (${ins} insertions, ${del} deletions removed). The conversation will be rewound to this message in place.`;

    const dialogResult = await this._confirmDialog.confirmWithCheckboxes({
      title: 'Rewind to this message?',
      message: `${header}\n\n${fileList}`,
      confirmLabel: 'Rewind',
      cancelLabel: 'Cancel',
      confirmStyle: 'warning',
      checkboxes: [
        {
          id: 'deleteOriginal',
          label: 'Also delete original session',
          defaultChecked: false,
        },
      ],
    });

    if (!dialogResult.confirmed) return;
    const deleteOriginal = dialogResult.checkboxes['deleteOriginal'] === true;

    // Resolve the originating tab BEFORE any irreversible operation (file
    // rollback + fork). The rewind does a transparent in-place swap of the
    // tile's session, so if there is no tile to swap into we must abort *now* —
    // before reverting files or creating a fork on disk. Aborting after the
    // fork would leave an orphaned session the user can only see after a reload
    // (the wrong-session-rewind bug). `sessionId` is stable across the dialog
    // await, so this lookup is the same one the post-fork swap relies on.
    const originTab = this._tabManager.findTabBySessionId(sessionId);
    if (!originTab) {
      this.showActionError(
        'Rewind failed: originating tab could not be found (it may have been closed).',
      );
      return;
    }
    const originName = originTab.name ?? 'Session';
    const replacementTitle = `${originName} (rewind)`;
    const targetTabId = originTab.id;

    let rollbackSuffix: string | null = null;
    if (checkpointsLost) {
      rollbackSuffix = cannotRewind
        ? `file rollback skipped: ${dryData.error ?? 'no checkpoints'}`
        : null;
    } else {
      const commit = await this._claudeRpc.rewindFiles(
        sessionId,
        anchorId,
        false,
        anchorHint,
        systemPrompt,
      );
      if (!commit.isSuccess()) {
        const errMsg = commit.error ?? 'unknown error';
        if (this.isHardRewindFailure(errMsg)) {
          this.showActionError(`Rewind failed: ${errMsg}`);
          return;
        }
        rollbackSuffix = `file rollback skipped: ${errMsg}`;
      } else if (!commit.data.canRewind) {
        rollbackSuffix = `file rollback skipped: ${
          commit.data.error ?? 'unknown reason'
        }`;
      }
    }

    const forkResult = await this._claudeRpc.forkSession(
      sessionId,
      anchorId,
      undefined,
      'rewind',
      anchorHint,
    );

    if (!forkResult.isSuccess()) {
      if (this.isMessageIdNotFoundError(forkResult)) {
        this.showActionError(
          'Cannot rewind to this point — no assistant reply exists yet.',
        );
        return;
      }
      this.showActionError(
        `Rewind failed: ${forkResult.error ?? 'Unknown error'}`,
      );
      return;
    }

    const newSessionId = forkResult.data.newSessionId;

    // The SDK forked to a NEW session id (it has no in-place conversation
    // rewind — `Query` only exposes `rewindFiles`). Make that fork transparent:
    // keep the SAME tab/canvas tile and swap the session it points at, instead
    // of opening a second tab/tile and leaving the original behind. Then load
    // the truncated transcript and activate the forked session so it is live
    // and ready for the next turn. (`originTab`/`targetTabId`/`replacementTitle`
    // were resolved before the fork, so a missing tile already aborted without
    // orphaning a fork.)

    // Optimistically surface the fork in the sidebar immediately. The backend
    // broadcasts `session:metadataChanged` (created) after the fork, but the
    // debounced `loadSessions()` it triggers can race and run before the fork
    // is listable by `session:list`, leaving the sidebar empty until a restart.
    // The subsequent broadcast reconciles counts with the persisted truth.
    const now = Date.now();
    this.chatStore.upsertSessionSummary({
      id: newSessionId,
      name: replacementTitle,
      messageCount: 0,
      createdAt: now,
      lastActivityAt: now,
      isActive: true,
    } as ChatSessionSummary);

    let swapFailed = false;
    this._tabManager.rebindTabSession(
      targetTabId,
      newSessionId,
      replacementTitle,
    );
    try {
      await this.chatStore.switchSession(newSessionId, { activate: true });
    } catch (err: unknown) {
      swapFailed = true;
      this.showActionError(
        `Rewind loaded the forked session, but activating it failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
        targetTabId,
      );
    }

    let deleteSuffix: string | null = null;
    if (deleteOriginal && !swapFailed) {
      const result = await this.deleteOriginalSession(
        sessionId,
        originWorkspacePath,
      );
      if (!result.allTabsClosed) {
        deleteSuffix =
          'original session left in place — close the streaming tab first';
      } else if (!result.deletedOk) {
        deleteSuffix = `original session delete failed: ${
          result.deleteError ?? 'unknown error'
        }`;
      } else {
        // Drop the original from the sidebar immediately rather than waiting
        // for the debounced `session:metadataChanged` (deleted) broadcast.
        this.chatStore.removeSessionFromList(sessionId);
      }
    }

    if (swapFailed) return;

    const baseMsg = 'Rewind complete — conversation rewound to this message';
    const suffixes = [rollbackSuffix, deleteSuffix].filter(
      (s): s is string => s !== null,
    );

    if (suffixes.length > 0) {
      this.showActionWarning(
        `${baseMsg} (${suffixes.join('; ')})`,
        targetTabId,
      );
    } else {
      this.showActionInfo(baseMsg, targetTabId);
    }
  }

  private static readonly MESSAGE_ID_NOT_FOUND_FALLBACK_PHRASE =
    'not found in session history';

  /** Upper bound on waiting for a branch's canvas tile to report its load. */
  private static readonly BRANCH_OPEN_TIMEOUT_MS = 10_000;

  private isHardRewindFailure(errMsg: string): boolean {
    return (
      errMsg.startsWith('session-not-active:') ||
      errMsg.startsWith('unauthorized-path-rewrite:')
    );
  }

  private isMessageIdNotFoundError<T>(result: RpcResult<T>): boolean {
    if (result.errorCode === 'MESSAGE_ID_NOT_FOUND') return true;
    const msg = result.error ?? '';
    return msg.includes(ChatViewComponent.MESSAGE_ID_NOT_FOUND_FALLBACK_PHRASE);
  }

  private async deleteOriginalSession(
    originalId: SessionId,
    originWorkspacePath: string,
  ): Promise<{
    allTabsClosed: boolean;
    deletedOk: boolean;
    deleteError?: string;
  }> {
    const tabs = this._tabManager.findTabsBySessionId(originalId);
    for (const tab of tabs) {
      try {
        await this._tabManager.closeTab(tab.id);
      } catch (err: unknown) {
        console.warn(
          '[chat-view] failed to close tab during delete-original',
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    const survivors = this._tabManager.findTabsBySessionId(originalId);
    if (survivors.length > 0) {
      return { allTabsClosed: false, deletedOk: false };
    }

    try {
      const del = await this._claudeRpc.deleteSession(originalId);
      if (!del.isSuccess()) {
        return {
          allTabsClosed: true,
          deletedOk: false,
          deleteError: del.error ?? undefined,
        };
      }
      this._tabManager.forgetWorkflowSession(originalId, originWorkspacePath);
      return { allTabsClosed: true, deletedOk: true };
    } catch (err: unknown) {
      return {
        allTabsClosed: true,
        deletedOk: false,
        deleteError: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Switch the current tab from compact back to full view */
  expandToFullView(): void {
    const tabId = this.resolvedTabId();
    if (tabId && this.resolvedActiveTab()?.viewMode === 'compact') {
      this._tabManager.toggleTabViewMode(tabId);
    }
  }
}

/** A dock width within `PanelResizeService`'s bounds; unmeasured host: as is. */
function clampDockWidth(width: number, hostWidth: number): number {
  if (hostWidth <= 0) return width;
  const max = hostWidth * DOCK_MAX_WIDTH_RATIO;
  const min = Math.min(DOCK_MIN_WIDTH, max);
  return Math.round(Math.min(Math.max(width, min), max));
}
