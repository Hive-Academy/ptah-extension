import {
  Component,
  inject,
  signal,
  computed,
  viewChild,
  ChangeDetectionStrategy,
  afterNextRender,
  effect,
  untracked,
  Injector,
  DestroyRef,
  ElementRef,
} from '@angular/core';
import {
  LucideAngularModule,
  Bell,
  Clock,
  Pencil,
  Trash2,
  ChevronUp,
  ChevronDown,
} from 'lucide-angular';
import {
  ScrollingModule,
  CdkVirtualScrollViewport,
} from '@angular/cdk/scrolling';
import { ScrollingModule as ExperimentalScrollingModule } from '@angular/cdk-experimental/scrolling';
import { MessageBubbleComponent } from '../organisms/message-bubble.component';
import { AgentMonitorPanelComponent } from '../organisms/agent-monitor-panel.component';
import { ChatInputComponent } from '../molecules/chat-input/chat-input.component';
import {
  PermissionBadgeComponent,
  QuestionCardComponent,
  SessionStatsSummaryComponent,
  CompactionNotificationComponent,
  CompactionMarkerComponent,
  SidebarTabComponent,
} from '@ptah-extension/chat-ui';
import { ChatEmptyStateComponent } from '../molecules/setup-plugins/chat-empty-state.component';
import { ResumeNotificationBannerComponent } from '../molecules/notifications/resume-notification-banner.component';
import { AuthRequiredBannerComponent } from '../molecules/notifications/auth-required-banner.component';
import { CompactSessionCardComponent } from '../molecules/compact-session/compact-session-card.component';
import { ChatStore } from '../../services/chat.store';
import { ActionBannerService } from '../../services/action-banner.service';
import { CompactionLifecycleService } from '../../services/chat-store/compaction-lifecycle.service';
import {
  AgentMonitorStore,
  ExecutionTreeBuilderService,
} from '@ptah-extension/chat-streaming';
import { PanelResizeService } from '../../services/panel-resize.service';
import {
  TabManagerService,
  ConversationRegistry,
  TabSessionBinding,
  TabId,
  ConfirmationDialogService,
} from '@ptah-extension/chat-state';
import { SESSION_CONTEXT } from '../../tokens/session-context.token';
import {
  VSCodeService,
  ClaudeRpcService,
  AppStateManager,
  AuthStateService,
  RpcResult,
} from '@ptah-extension/core';
import {
  createExecutionChatMessage,
  ExecutionChatMessage,
  SessionId,
} from '@ptah-extension/shared';
import type { SubagentRecord, MessageAnchorHint } from '@ptah-extension/shared';

const EMPTY_STRING_SET: ReadonlySet<string> = new Set<string>();

/**
 * Compaction noise filter — hides post-compaction user messages that the
 * Claude SDK emits as side-effects of `/compact`:
 *  1. The slash-command echo (`/compact ...`)
 *  2. The ANSI-wrapped hook status (`[2mCompacted PreCompact … completed successfully[22m`)
 * The continuation summary itself ("This session is being continued …") is
 * kept and rendered collapsed by `MessageBubbleComponent`.
 */
function isCompactionNoiseUserMessage(msg: ExecutionChatMessage): boolean {
  if (msg.role !== 'user') return false;
  const raw = (msg.rawContent ?? '').trim();
  if (!raw) return false;
  if (/^\/compact\b/i.test(raw)) return true;
  if (/Compacted\s+\w+\s+\[callback\]\s+completed successfully/i.test(raw)) {
    return true;
  }
  return false;
}

function filterCompactionNoise(
  msgs: readonly ExecutionChatMessage[],
): readonly ExecutionChatMessage[] {
  if (!msgs.some(isCompactionNoiseUserMessage)) return msgs;
  return msgs.filter((m) => !isCompactionNoiseUserMessage(m));
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
 * - Session stats summary (cost, tokens, duration, agents)
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
@Component({
  selector: 'ptah-chat-view',
  imports: [
    LucideAngularModule,
    MessageBubbleComponent,
    AgentMonitorPanelComponent,
    ChatInputComponent,
    PermissionBadgeComponent,
    QuestionCardComponent,
    ChatEmptyStateComponent,
    SessionStatsSummaryComponent,
    ResumeNotificationBannerComponent,
    AuthRequiredBannerComponent,
    CompactionNotificationComponent,
    CompactionMarkerComponent,
    SidebarTabComponent,
    CompactSessionCardComponent,
  ],
  templateUrl: './chat-view.component.html',
  styleUrl: './chat-view.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatViewComponent {
  readonly chatStore = inject(ChatStore);
  private readonly vscodeService = inject(VSCodeService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly agentMonitorStore = inject(AgentMonitorStore);
  private readonly panelResizeService = inject(PanelResizeService);
  private readonly _sessionContext = inject(SESSION_CONTEXT, {
    optional: true,
  });
  private readonly _tabManager = inject(TabManagerService);
  private readonly _appState = inject(AppStateManager);
  private readonly _treeBuilder = inject(ExecutionTreeBuilderService);
  private readonly _conversationRegistry = inject(ConversationRegistry);
  private readonly _tabSessionBinding = inject(TabSessionBinding);
  /**
   * Read the one-tick auto-animate suppression flag set by
   * `CompactionLifecycleService.handleCompactionComplete`. Combined with
   * `resolvedIsStreaming()` and `isFinalizingTransition()` in the
   * `[autoAnimateDisabled]` binding so the FLIP directive skips the
   * stale→empty diff that produced bubble overlap with sticky headers.
   */
  private readonly _compactionLifecycle = inject(CompactionLifecycleService);
  protected readonly suppressAnimateOnce =
    this._compactionLifecycle.suppressAnimateOnce;
  private readonly _claudeRpc = inject(ClaudeRpcService);
  private readonly _confirmDialog = inject(ConfirmationDialogService);
  private readonly _authState = inject(AuthStateService);

  /** Inline re-auth banner state (set when a send fails needing auth). */
  protected readonly authRequiredBanner = this._authState.authRequiredBanner;

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
   * Inline banner for branch/rewind actions. Sourced from the shared
   * `ActionBannerService` (S3) so canvas/tile mode renders the banner on the
   * surface the user is looking at, not on the originating tile. The service
   * owns its own auto-clear timer.
   */
  private readonly actionBanner = inject(ActionBannerService);
  readonly actionError = this.actionBanner.error;
  readonly actionInfo = this.actionBanner.info;
  readonly actionWarning = this.actionBanner.warning;

  private showActionError(message: string): void {
    this.actionBanner.showError(message);
  }

  private showActionInfo(message: string): void {
    this.actionBanner.showInfo(message);
  }

  private showActionWarning(message: string): void {
    this.actionBanner.showWarning(message);
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
  protected readonly ChevronUpIcon = ChevronUp;
  protected readonly ChevronDownIcon = ChevronDown;

  /** Whether the input area is collapsed to give more room to chat */
  readonly inputCollapsed = signal(false);

  /** Toggle the input area collapse state */
  toggleInputCollapse(): void {
    this.inputCollapsed.update((v) => !v);
  }

  /** Local panel open/close state */
  readonly agentPanelOpen = signal(false);

  /** Session-scoped agents for the embedded panel */
  readonly sessionAgents = computed(() => {
    const sid = this.resolvedSessionId();
    if (!sid) {
      if (this._sessionContext) return [];
      return this.agentMonitorStore.agents();
    }
    return this.agentMonitorStore.agentsForSession(sid);
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

  /** Tracks whether the user explicitly closed the panel this session.
   *  Prevents auto-open from fighting user intent. Reset when all agents complete. */
  private _userExplicitlyClosed = false;

  toggleAgentPanel(): void {
    const wasOpen = this.agentPanelOpen();
    this.agentPanelOpen.update((v) => !v);
    if (wasOpen) {
      this._userExplicitlyClosed = true;
    }
  }

  private resizeMouseMove: ((e: MouseEvent) => void) | null = null;
  private resizeMouseUp: (() => void) | null = null;

  /** Start drag-resize: capture mouse and update panel width on move. */
  onResizeStart(event: MouseEvent): void {
    event.preventDefault();
    this.panelResizeService.setDragging(true);

    this.resizeMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX;
      this.panelResizeService.setCustomWidth(newWidth);
    };

    this.resizeMouseUp = () => {
      this.panelResizeService.setDragging(false);
      if (this.resizeMouseMove) {
        document.removeEventListener('mousemove', this.resizeMouseMove);
      }
      if (this.resizeMouseUp) {
        document.removeEventListener('mouseup', this.resizeMouseUp);
      }
      this.resizeMouseMove = null;
      this.resizeMouseUp = null;
    };

    document.addEventListener('mousemove', this.resizeMouseMove);
    document.addEventListener('mouseup', this.resizeMouseUp);
  }

  /**
   * ResizeObserver on the content wrapper. Fires whenever the content's height
   * changes — streaming text growth, agent sub-output, markdown image load, or
   * the streaming→finalized swap — which is exactly when a pinned transcript
   * must re-stick to the bottom. Fires on real size change only, so it can't
   * storm.
   */
  private resizeObserver: ResizeObserver | null = null;
  private scrollRafId: number | null = null;
  private lastContentHeight = 0;
  /** Distance from bottom (px) within which the user is considered "pinned". */
  private readonly NEAR_BOTTOM_PX = 120;

  /**
   * The plain scroll container (`#messageContainer`). Off-screen message
   * bubbles are skipped by the browser via `content-visibility: auto`
   * (see chat-view.component.css), so this gives virtual-scroll-class
   * performance without the experimental autosize estimator — scroll
   * positions are the element's real `scrollTop`/`scrollHeight`.
   */
  private readonly scrollContainer =
    viewChild<ElementRef<HTMLElement>>('messageContainer');
  /** Inner content wrapper observed for height changes (streaming growth). */
  private readonly contentWrapper =
    viewChild<ElementRef<HTMLElement>>('messageContent');

  /** Signal-based viewChild for chat input (used for prompt-suggestion fill) */
  private readonly chatInputRef = viewChild(ChatInputComponent);

  /**
   * Whether the transcript is pinned to the bottom (auto-follows new content).
   * Set false when the user scrolls up past NEAR_BOTTOM_PX, true when they
   * scroll back down or send a new message.
   */
  private pinnedToBottom = true;

  /** Track message count to detect new user messages */
  private lastMessageCount = 0;

  /**
   * Tracks previous streaming state to detect the streaming→idle transition,
   * which drives `isFinalizingTransition` (animation suppression) and a
   * stick-to-bottom when the user is pinned.
   */
  private wasStreaming = false;

  /**
   * Suppresses onScroll bookkeeping while WE drive the scroll position. The
   * programmatic scroll emits scroll events that must not flip `pinnedToBottom`.
   */
  private isAdjusting = false;

  private readonly scrollPositionCache = new Map<string, number>();
  private previousTabId: string | null = null;

  /**
   * Active during the streaming→finalized DOM transition. Suppresses onScroll
   * bookkeeping so the swap can't flip `pinnedToBottom`.
   *
   * A signal so it flows reactively into <ptah-message-bubble> and onward to
   * ExecutionNodeComponent + InlineAgentBubbleComponent — those use it to
   * suppress fade keyframes during the finalize burst.
   */
  protected readonly isFinalizingTransition = signal(false);
  private finalizingTimeoutId: ReturnType<typeof setTimeout> | null = null;

  /**
   * Ptah icon URI for skeleton avatar placeholder
   */
  readonly ptahIconUri = computed(() => this.vscodeService.getPtahIconUri());

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

  private readonly resolvedTabId = computed(() => {
    const ctx = this._sessionContext;
    return ctx ? ctx() : this._tabManager.activeTabId();
  });

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
   * Resolved view mode: 'full' or 'compact', scoped to tile or active tab.
   * When compact, the chat view renders a CompactSessionCard instead of the full message list.
   */
  readonly resolvedViewMode = computed(() => {
    const ctx = this._sessionContext;
    if (ctx) {
      const tabId = ctx();
      if (!tabId) return 'full' as const;
      return (
        this._tabManager.tabs().find((t) => t.id === tabId)?.viewMode ?? 'full'
      );
    }
    return this._tabManager.activeTabViewMode();
  });

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

  readonly resolvedPreloadedStats = computed(() => {
    const tab = this.resolvedTab();
    return tab !== null
      ? (tab.preloadedStats ?? null)
      : this.chatStore.preloadedStats();
  });

  readonly resolvedLiveModelStats = computed(() => {
    const tab = this.resolvedTab();
    return tab !== null
      ? (tab.liveModelStats ?? null)
      : this.chatStore.liveModelStats();
  });

  readonly resolvedModelUsageList = computed(() => {
    const tab = this.resolvedTab();
    return tab !== null
      ? (tab.modelUsageList ?? null)
      : this.chatStore.modelUsageList();
  });

  readonly resolvedCompactionCount = computed(() => {
    const tab = this.resolvedTab();
    return tab !== null
      ? (tab.compactionCount ?? 0)
      : this.chatStore.compactionCount();
  });

  /**
   * Resolved isCompacting: tile-scoped when SESSION_CONTEXT is provided, otherwise global.
   * Prevents compaction banner from showing on ALL canvas tiles when only one session compacts.
   *
   * Sourced from `ConversationRegistry` via `TabSessionBinding`. Compaction
   * is conversation-scoped, so every tab bound to the conversation sees the
   * banner together (canvas-grid).
   *
   * Reads ONLY from the conversation registry. The previous fallback to
   * `tab.isCompacting` / `chatStore.isCompacting()` created a second source
   * of truth: when StreamRouter had not yet registered the conversation by
   * `compaction_complete` time, the registry stayed `inFlight=true` while
   * the tab cleared (or vice versa) and the banner stuck on the 120s safety
   * timeout. The lifecycle service now writes through the registry on every
   * transition, so unresolved conversations simply render no banner — which
   * is the correct state for an unrouted tab.
   */
  readonly resolvedIsCompacting = computed(() => {
    const tab = this.resolvedTab();
    const rawTabId = tab?.id ?? this._tabManager.activeTabId();
    if (!rawTabId) return false;
    const tabId = TabId.safeParse(rawTabId);
    if (!tabId) return false;
    const convId = this._tabSessionBinding.conversationFor(tabId);
    if (!convId) return false;
    return (
      this._conversationRegistry.compactionStateFor(convId)?.inFlight ?? false
    );
  });

  readonly resolvedCompactionMarker = computed(() => {
    const tab = this.resolvedTab();
    const rawTabId = tab?.id ?? this._tabManager.activeTabId();
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
   */
  readonly resolvedQuestionRequests = computed(() => {
    const allQuestions = this.chatStore.questionRequests();
    if (allQuestions.length === 0) return [];

    const tabId = this.resolvedTabId(); // frontend UUID (e.g. "tab-abc123")
    const activeTabId = this._tabManager.activeTabId();
    const isMainPanel = !this._sessionContext;
    const tilesPresent = this._appState.layoutMode() === 'grid';
    if (isMainPanel && tilesPresent) {
      return [];
    }
    const isActiveTile = tabId !== null && tabId === activeTabId;

    return allQuestions.filter((q) => {
      const targets = this.chatStore.questionTargetTabsFor(q.id);
      if (targets.length > 0) {
        return tabId !== null && targets.includes(tabId);
      }
      const legacyMatch =
        tabId !== null && (q.tabId === tabId || q.sessionId === tabId);
      if (legacyMatch) return true;
      return isActiveTile;
    });
  });

  readonly resolvedQueuedContent = computed(() => {
    const tab = this.resolvedTab();
    return tab !== null
      ? (tab.queuedContent ?? null)
      : this.chatStore.queuedContent();
  });

  readonly resolvedStreamingState = computed(() => {
    const tab = this.resolvedTab();
    return tab !== null
      ? (tab.streamingState ?? null)
      : this.chatStore.activeStreamingState();
  });

  readonly resolvedExecutionTrees = computed(() => {
    const state = this.resolvedStreamingState();
    if (!state) return [];
    const ctx = this._sessionContext;
    const cacheKey = ctx
      ? `tile-${ctx()}`
      : `tab-${this._tabManager.activeTabId()}`;
    return this._treeBuilder.buildTree(state, cacheKey);
  });

  /**
   * Computed signal that creates ExecutionChatMessages from ALL
   * currentExecutionTrees (not just the first one).
   *
   * When Claude uses tools, the SDK sends multiple assistant messages in one turn:
   * - Message 1: Contains tool calls (e.g., Glob)
   * - Message 2: Contains follow-up text and more tools after tool results
   *
   * Previously, only the first tree was rendered, causing subsequent messages to be LOST!
   * Now we return ALL trees as messages so they can all be rendered.
   *
   * Includes pendingStats from streamingState so stats display during/after
   * streaming before finalization. Stats may arrive before finalization and
   * should be shown immediately.
   *
   * DEDUPLICATION: Finalized messages use tree.id (event id) NOT messageId,
   * so we can properly match and filter out already-finalized trees.
   */
  private readonly finalizedMessageIds = computed((): ReadonlySet<string> => {
    const msgs = this.resolvedMessages();
    if (msgs.length === 0) return EMPTY_STRING_SET;
    const ids = new Set<string>();
    for (const m of msgs) ids.add(m.id);
    return ids;
  });

  protected readonly finalizedFiltered = computed(
    (): readonly ExecutionChatMessage[] => {
      return filterCompactionNoise(this.resolvedMessages());
    },
  );

  readonly streamingMessages = computed((): ExecutionChatMessage[] => {
    const trees = this.resolvedExecutionTrees();
    if (trees.length === 0) return [];

    const streamingState = this.resolvedStreamingState();
    const pendingStats = streamingState?.pendingStats;

    const finalizedIds = this.finalizedMessageIds();
    const nonFinalizedTrees = trees.filter(
      (tree) => !finalizedIds.has(tree.id),
    );
    if (nonFinalizedTrees.length === 0) return [];

    return nonFinalizedTrees.map((tree) =>
      createExecutionChatMessage({
        id: tree.id,
        role: 'assistant',
        streamingState: tree,
        sessionId: this.resolvedSessionId() ?? undefined,
        ...(pendingStats && {
          tokens: pendingStats.tokens,
          cost: pendingStats.cost,
          duration: pendingStats.duration,
        }),
      }),
    );
  });

  /**
   * Unified message list: resolved (finalized) messages + currently-streaming
   * trees, rendered through a SINGLE `@for` block in the template.
   *
   * Why unified: the streaming-tree id and the eventual finalized-message id
   * are the same value (`MessageFinalizationService` sets
   * `treeNodeId = finalTree[0]?.id`). When the finalization handler swaps the
   * streaming tree for a finalized message, the id is preserved — Angular's
   * `track msg.id` reuses the same `<ptah-message-bubble>` instance across the
   * transition, so streaming → finalized is an in-place mutation rather than a
   * remove-from-list + add-to-list remount. This eliminates the dramatic DOM
   * destroy/create that previously caused layout shift, scroll-anchor
   * disruption, and content-visibility flashes.
   *
   * Streaming entries are tagged via the `isStreaming` flag derived from
   * `resolvedIsStreaming()` AND identity (only the live trees are streaming;
   * historical messages are not).
   */
  readonly totalMessageCount = computed((): number => {
    return this.finalizedFiltered().length + this.streamingMessages().length;
  });

  private _allMessagesCache: readonly ExecutionChatMessage[] = [];
  private _allMessagesFinalizedRef: readonly ExecutionChatMessage[] | null =
    null;
  private _allMessagesStreamingRef: readonly ExecutionChatMessage[] | null =
    null;

  readonly allMessages = computed((): readonly ExecutionChatMessage[] => {
    const finalized = this.finalizedFiltered();
    const streaming = this.streamingMessages();
    if (
      finalized === this._allMessagesFinalizedRef &&
      streaming === this._allMessagesStreamingRef
    ) {
      return this._allMessagesCache;
    }
    const next =
      streaming.length === 0 ? finalized : [...finalized, ...streaming];
    this._allMessagesFinalizedRef = finalized;
    this._allMessagesStreamingRef = streaming;
    this._allMessagesCache = next;
    return next;
  });

  protected trackByMessageId(
    _index: number,
    msg: ExecutionChatMessage,
  ): string {
    return msg.id;
  }

  constructor() {
    effect(() => {
      const agents = this.sessionAgents();
      const hasRunning = agents.some((a) => a.status === 'running');
      const hasPendingPermission = agents.some(
        (a) => a.permissionQueue.length > 0,
      );
      const isOpen = untracked(() => this.agentPanelOpen());

      if (
        (hasRunning || hasPendingPermission) &&
        !isOpen &&
        !this._userExplicitlyClosed
      ) {
        this.agentPanelOpen.set(true);
      }
      if (!hasRunning && !hasPendingPermission && agents.length > 0) {
        this._userExplicitlyClosed = false;
      }
    });
    // Unified content-follow controller. Reacts to BOTH tab/session switches
    // (resolvedTabId) and content changes (allMessages — which transitively
    // tracks streaming-tree growth). One effect, one source of truth.
    effect(() => {
      const tabId = this.resolvedTabId();
      const messages = this.allMessages();
      const count = messages.length;
      untracked(() => {
        if (tabId !== this.previousTabId) {
          this.previousTabId = tabId ?? null;
          this.lastMessageCount = count;
          this.restoreScrollForTab(tabId);
          return;
        }
        const last = messages[count - 1];
        const isNewUserMessage =
          count > this.lastMessageCount && last?.role === 'user';
        this.lastMessageCount = count;
        if (isNewUserMessage) {
          this.pinnedToBottom = true;
        }
        if (this.pinnedToBottom) {
          this.scheduleStickToBottom();
        }
      });
    });
    effect(() => {
      const isStreaming = this.resolvedIsStreaming();
      untracked(() => {
        if (this.wasStreaming && !isStreaming) {
          this.isFinalizingTransition.set(true);
          if (this.pinnedToBottom) {
            this.scheduleStickToBottom();
          }
          if (this.finalizingTimeoutId) {
            clearTimeout(this.finalizingTimeoutId);
          }
          this.finalizingTimeoutId = setTimeout(() => {
            this.isFinalizingTransition.set(false);
            this.finalizingTimeoutId = null;
            if (this.pinnedToBottom) {
              this.scheduleStickToBottom();
            }
          }, 300);
        }
        this.wasStreaming = isStreaming;
      });
    });
    afterNextRender(
      () => {
        this.setupResizeObserver();
      },
      { injector: this.injector },
    );
    this.destroyRef.onDestroy(() => {
      this.cleanup();
    });
  }

  /**
   * Handle viewport scroll events. Updates `pinnedToBottom` from the user's
   * position and caches the offset per tab. Ignored while WE drive the scroll
   * (isAdjusting) or during the finalize transition, so neither can falsely
   * unpin.
   */
  onScroll(_event: Event): void {
    if (this.isAdjusting || this.isFinalizingTransition()) return;

    const el = this.scrollContainer()?.nativeElement;
    if (!el) return;

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    this.pinnedToBottom = distanceFromBottom < this.NEAR_BOTTOM_PX;

    const tabId = this.resolvedTabId();
    if (tabId) {
      this.scrollPositionCache.set(tabId, el.scrollTop);
    }
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
   * Edit queued message â€” pushes content back to the input and clears the queue.
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
   * Uses resolvedTabId to target the correct tab in both single and canvas modes.
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
    const prompt = `Resume the interrupted ${agent.agentType} agent (agentId: ${agent.agentId}) using the Task tool with resume parameter set to "${agent.agentId}".`;
    const tabId = this._sessionContext?.() ?? undefined;
    this.chatStore.sendOrQueueMessage(prompt, { tabId });
    this.chatStore.removeResumableSubagent(agent.toolCallId);
  }

  /**
   * Handle "Resume All" â€” builds a single combined prompt for all interrupted agents
   * and sends it as one message to the existing session.
   */
  handleResumeAllAgents(agents: SubagentRecord[]): void {
    if (agents.length === 0) return;

    if (agents.length === 1) {
      this.handleResumeAgent(agents[0]);
      return;
    }

    const agentList = agents
      .map((a) => `- ${a.agentType} (agentId: ${a.agentId})`)
      .join('\n');
    const prompt = `Resume all ${agents.length} interrupted agents using the Task tool with resume parameter for each:\n${agentList}`;
    const tabId = this._sessionContext?.() ?? undefined;
    this.chatStore.sendOrQueueMessage(prompt, { tabId });
    for (const agent of agents) {
      this.chatStore.removeResumableSubagent(agent.toolCallId);
    }
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
    return { text, occurrence };
  }

  /**
   * "Branch from here" — fork the current session at the given user message
   * into a new tab. The backend slices the JSONL transcript up to and
   * including `messageId` and returns a fresh session UUID, which we then
   * bind to a new tab via `TabManagerService.openSessionTab()`.
   */
  async onBranchRequested(messageId: string): Promise<void> {
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
        if (this._appState.layoutMode() === 'grid') {
          this._appState.requestCanvasSession(newSessionId, 'Branch');
          this.showActionInfo('Branch created.');
        } else {
          this._tabManager.openSessionTab(newSessionId, 'Branch');
          try {
            await this.chatStore.switchSession(newSessionId);
            this.showActionInfo('Branch created.');
          } catch (err) {
            this.showActionError(
              `Branch tab opened, but loading history failed: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
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
    const anchorId = this.resolveAnchorId(messageId);
    const anchorHint = this.buildAnchorHint(messageId);
    const dryRun = await this._claudeRpc.rewindFiles(
      sessionId,
      anchorId,
      true,
      anchorHint,
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
      ? 'A new session will be forked from this message.'
      : `${files.length} file(s) will be reverted (${ins} insertions, ${del} deletions removed). A new session will be forked from this message.`;

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
    let swapFailed = false;

    if (this._appState.layoutMode() === 'grid') {
      const adopted = await this._appState.requestCanvasSession(
        newSessionId,
        'Rewind',
      );
      if (!adopted) {
        swapFailed = true;
        this.showActionError(
          'Rewind canvas tile could not be opened (tile cap reached or canvas not mounted).',
        );
      }
    } else {
      this._tabManager.openSessionTab(newSessionId, 'Rewind');
      try {
        await this.chatStore.switchSession(newSessionId);
      } catch (err: unknown) {
        swapFailed = true;
        this.showActionError(
          `Rewind tab opened, but loading history failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    let deleteSuffix: string | null = null;
    if (deleteOriginal && !swapFailed) {
      const result = await this.deleteOriginalSession(sessionId);
      if (!result.allTabsClosed) {
        deleteSuffix =
          'original session left in place — close the streaming tab first';
      } else if (!result.deletedOk) {
        deleteSuffix = `original session delete failed: ${
          result.deleteError ?? 'unknown error'
        }`;
      }
    }

    if (swapFailed) return;

    const baseMsg = 'Rewind complete — switched to new session';
    const suffixes = [rollbackSuffix, deleteSuffix].filter(
      (s): s is string => s !== null,
    );

    if (suffixes.length > 0) {
      this.showActionWarning(`${baseMsg} (${suffixes.join('; ')})`);
    } else {
      this.showActionInfo(baseMsg);
    }
  }

  private static readonly MESSAGE_ID_NOT_FOUND_FALLBACK_PHRASE =
    'not found in session history';

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

  private async deleteOriginalSession(originalId: SessionId): Promise<{
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
      return { allTabsClosed: true, deletedOk: true };
    } catch (err: unknown) {
      return {
        allTabsClosed: true,
        deletedOk: false,
        deleteError: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Handle "New Session" request from context warning bar */
  onNewSessionFromContextWarning(): void {
    this._tabManager.createTab('New Session');
  }

  /** Switch the current tab from compact back to full view */
  expandToFullView(): void {
    const tabId = this.resolvedTabId();
    if (tabId) {
      this._tabManager.toggleTabViewMode(tabId);
    }
  }

  /**
   * Stick the container to the bottom on the next frame. rAF-coalesced so a
   * burst of streaming chunks collapses to a single adjustment per frame.
   *
   * Uses the element's real `scrollHeight` — there is no estimator to go
   * stale, so the streamed content is always reachable without a manual
   * scroll, and the position can't oscillate as it did with the autosize
   * strategy.
   */
  private scheduleStickToBottom(): void {
    if (this.scrollRafId !== null) {
      cancelAnimationFrame(this.scrollRafId);
    }
    this.scrollRafId = requestAnimationFrame(() => {
      this.scrollRafId = null;
      const el = this.scrollContainer()?.nativeElement;
      if (!el) return;
      this.isAdjusting = true;
      el.scrollTop = el.scrollHeight;
      requestAnimationFrame(() => {
        this.isAdjusting = false;
      });
    });
  }

  /**
   * On tab/session switch, restore the saved scroll offset (don't auto-follow),
   * or pin to the bottom for a freshly-opened tab.
   */
  private restoreScrollForTab(tabId: string | null): void {
    const saved =
      tabId !== null ? this.scrollPositionCache.get(tabId) : undefined;
    if (this.scrollRafId !== null) {
      cancelAnimationFrame(this.scrollRafId);
    }
    this.scrollRafId = requestAnimationFrame(() => {
      this.scrollRafId = null;
      const el = this.scrollContainer()?.nativeElement;
      if (!el) return;
      this.isAdjusting = true;
      if (saved !== undefined) {
        el.scrollTop = saved;
        this.pinnedToBottom = false;
      } else {
        el.scrollTop = el.scrollHeight;
        this.pinnedToBottom = true;
      }
      requestAnimationFrame(() => {
        this.isAdjusting = false;
      });
    });
  }

  /**
   * Observe the content wrapper's height. Fires on real size changes only
   * (streaming growth, agent output, image load, finalize swap), so a pinned
   * transcript follows the stream without any per-frame re-measure loop.
   */
  private setupResizeObserver(): void {
    const wrapper = this.contentWrapper()?.nativeElement;
    if (!wrapper || this.resizeObserver) return;

    this.resizeObserver = new ResizeObserver((entries) => {
      if (this.isAdjusting) return;
      const height = entries[0]?.contentRect.height ?? 0;
      if (Math.abs(height - this.lastContentHeight) < 1) return;
      this.lastContentHeight = height;
      if (this.pinnedToBottom) {
        this.scheduleStickToBottom();
      }
    });
    this.resizeObserver.observe(wrapper);
  }

  /**
   * Cleanup observer, animation frame, and timeout on component destruction.
   */
  private cleanup(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.scrollRafId !== null) {
      cancelAnimationFrame(this.scrollRafId);
      this.scrollRafId = null;
    }
    if (this.finalizingTimeoutId) {
      clearTimeout(this.finalizingTimeoutId);
      this.finalizingTimeoutId = null;
    }
  }
}
