import {
  Component,
  inject,
  signal,
  computed,
  viewChild,
  ElementRef,
  ChangeDetectionStrategy,
  afterNextRender,
  effect,
  untracked,
  Injector,
  DestroyRef,
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
import { MessageBubbleComponent } from '../organisms/message-bubble.component';
import { AgentMonitorPanelComponent } from '../organisms/agent-monitor-panel.component';
import { ChatInputComponent } from '../molecules/chat-input/chat-input.component';
import {
  PermissionBadgeComponent,
  QuestionCardComponent,
  SessionStatsSummaryComponent,
  CompactionNotificationComponent,
  SidebarTabComponent,
} from '@ptah-extension/chat-ui';
import { ChatEmptyStateComponent } from '../molecules/setup-plugins/chat-empty-state.component';
import { ResumeNotificationBannerComponent } from '../molecules/notifications/resume-notification-banner.component';
import { CompactSessionCardComponent } from '../molecules/compact-session/compact-session-card.component';
import { AutoAnimateDirective } from '../../directives/auto-animate.directive';
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
} from '@ptah-extension/core';
import {
  createExecutionChatMessage,
  ExecutionChatMessage,
  SessionId,
} from '@ptah-extension/shared';
import type { SubagentRecord } from '@ptah-extension/shared';

/** Shared empty Set instance to keep `streamingMessageIds()` referentially
 *  stable when no message is streaming (avoids unnecessary template re-evals). */
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
    CompactionNotificationComponent,
    SidebarTabComponent,
    CompactSessionCardComponent,
    AutoAnimateDirective,
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

  // CANVAS: Optional per-tile session context. When provided, all signals
  // derive from this tabId instead of the global activeTabId.
  private readonly _sessionContext = inject(SESSION_CONTEXT, {
    optional: true,
  });
  private readonly _tabManager = inject(TabManagerService);
  private readonly _appState = inject(AppStateManager);
  private readonly _treeBuilder = inject(ExecutionTreeBuilderService);

  // TASK_2026_106 Phase 4c — compaction banner is now sourced from the
  // ConversationRegistry so all tabs bound to a compacting conversation
  // see the banner simultaneously (canvas-grid scenario). Falls back to
  // legacy per-tab `isCompacting` flag for tabs not yet registered.
  private readonly _conversationRegistry = inject(ConversationRegistry);
  private readonly _tabSessionBinding = inject(TabSessionBinding);
  /**
   * TASK_2026_109 B4 — read the one-tick auto-animate suppression flag set
   * by `CompactionLifecycleService.handleCompactionComplete`. Combined with
   * `resolvedIsStreaming()` and `isFinalizingTransition()` in the
   * `[autoAnimateDisabled]` binding so the FLIP directive skips the
   * stale→empty diff that produced bubble overlap with sticky headers.
   */
  private readonly _compactionLifecycle = inject(CompactionLifecycleService);
  protected readonly suppressAnimateOnce =
    this._compactionLifecycle.suppressAnimateOnce;
  private readonly _claudeRpc = inject(ClaudeRpcService);
  private readonly _confirmDialog = inject(ConfirmationDialogService);

  /**
   * Inline banner for branch/rewind actions. Sourced from the shared
   * `ActionBannerService` (S3) so canvas/tile mode renders the banner on the
   * surface the user is looking at, not on the originating tile. The service
   * owns its own auto-clear timer.
   */
  private readonly actionBanner = inject(ActionBannerService);
  readonly actionError = this.actionBanner.error;
  readonly actionInfo = this.actionBanner.info;

  private showActionError(message: string): void {
    this.actionBanner.showError(message);
  }

  private showActionInfo(message: string): void {
    this.actionBanner.showInfo(message);
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

  // ============================================================================
  // AGENT PANEL (per-session, embedded)
  // Replaces the global agent sidebar. Each ChatView instance manages its own
  // agent panel state. Canvas tiles skip this (they use TileAgentIndicator).
  // ============================================================================

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

  // ============================================================================
  // PANEL RESIZE (drag handle between chat and agent panel)
  // ============================================================================

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
   * MutationObserver for auto-scroll behavior.
   * Watches DOM mutations to trigger scroll after recursive ExecutionNode tree completes.
   */
  private observer: MutationObserver | null = null;
  private scrollTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private userMessageScrollTimeoutId: ReturnType<typeof setTimeout> | null =
    null;
  private readonly SCROLL_DEBOUNCE_MS = 50;

  /**
   * Signal-based viewChild (Angular 20+ pattern)
   * Replaces @ViewChild decorator for better reactivity
   */
  private readonly messageContainerRef =
    viewChild<ElementRef<HTMLElement>>('messageContainer');

  /** Signal-based viewChild for chat input (TASK_2025_174: prompt suggestion fill) */
  private readonly chatInputRef = viewChild(ChatInputComponent);

  /**
   * Auto-scroll state as signal for reactive tracking.
   * Disabled when user scrolls up, re-enabled when user scrolls to bottom.
   */
  private readonly userScrolledUp = signal(false);

  /** Track message count to detect new user messages */
  private lastMessageCount = 0;

  /**
   * Tracks previous streaming state to detect the streamingâ†’idle transition.
   * When streaming ends (agent finishes), we force scroll-to-bottom regardless
   * of userScrolledUp â€” the dramatic DOM change during finalization (streaming
   * DOM replaced with finalized DOM) can trigger layout-driven scroll events
   * that falsely set userScrolledUp=true.
   */
  private wasStreaming = false;

  /**
   * Flag to suppress onScroll during programmatic scrollToBottom().
   * Smooth scroll animations generate intermediate scroll events at positions
   * that aren't near the bottom, which falsely set userScrolledUp=true.
   * This guard prevents that race condition.
   */
  private isProgrammaticScrolling = false;

  private readonly scrollPositionCache = new Map<string, number>();
  private previousTabId: string | null = null;
  private isRestoringScroll = false;

  /**
   * Guard active during the streaming→finalized DOM transition.
   * Suppresses onScroll events and forces scheduleScroll to scroll regardless
   * of userScrolledUp. Prevents layout-driven scroll events from blocking
   * auto-scroll during the dramatic DOM swap (streaming elements destroyed,
   * finalized elements created).
   *
   * TASK_2026_TREE_STABILITY Fix 5/8: Promoted to a signal so it can flow
   * reactively into <ptah-message-bubble> and onward to ExecutionNodeComponent
   * + InlineAgentBubbleComponent — those use it to suppress fade keyframes
   * during the finalize burst.
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
   * TASK_2025_265
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
   * TASK_2025_265
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
   * TASK_2025_265
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

  /**
   * Resolved "session is active in the SDK this run" — tile-scoped when
   * SESSION_CONTEXT is provided, otherwise reads from the active tab.
   *
   * Sticky-true once the tab has streamed/resumed at least once. Used to
   * gate the rewind action: rewind requires a live `Query` handle on the
   * backend (`SessionLifecycleManager.getActiveSession`), which sessions
   * loaded purely from disk via `session:load` do NOT have. Without this
   * guard the user can click rewind on a historical session and the SDK
   * throws `SessionNotActiveError` (Sentry NODE-NESTJS-2Y / 2N / 2X).
   */
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
   * TASK_2026_106 Phase 4c — sourced from `ConversationRegistry` via
   * `TabSessionBinding`. Compaction is conversation-scoped, so every tab
   * bound to the conversation sees the banner together (canvas-grid).
   *
   * TASK_2026_109 C1 — reads ONLY from the conversation registry. The
   * previous fallback to `tab.isCompacting` / `chatStore.isCompacting()`
   * created a second source of truth: when StreamRouter had not yet
   * registered the conversation by `compaction_complete` time, the registry
   * stayed `inFlight=true` while the tab cleared (or vice versa) and the
   * banner stuck on the 120s safety timeout. The lifecycle service now
   * writes through the registry on every transition, so unresolved
   * conversations simply render no banner — which is the correct state
   * for an unrouted tab.
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
    // TASK_2026_109_FOLLOWUP_QUESTIONS Q3 — main-panel suppression when
    // canvas tiles are present. The main chat-view (no SESSION_CONTEXT)
    // uses `activeTabId` as its `resolvedTabId`, which means the active
    // tile's `tabId` matches step 1's `targets.includes(tabId)` — both
    // the main panel AND the active tile would render the same question.
    // When tiles exist (`layoutMode === 'grid'`), defer to the tile and
    // suppress the main panel rendering entirely.
    const isMainPanel = !this._sessionContext;
    const tilesPresent = this._appState.layoutMode() === 'grid';
    if (isMainPanel && tilesPresent) {
      return [];
    }

    // TASK_2026_109_FOLLOWUP_QUESTIONS Q5 — strict active-tile narrowing.
    // The previous `!this._sessionContext || ...` made the main panel
    // ALWAYS qualify; combined with Q3 above the main panel is now
    // already suppressed when tiles exist, so this can be the strict
    // tab-id match. When there are no tiles, the main panel's
    // `resolvedTabId()` IS `activeTabId` — same condition holds.
    const isActiveTile = tabId !== null && tabId === activeTabId;

    return allQuestions.filter((q) => {
      // 1. Authoritative routing — router-resolved target tabs.
      const targets = this.chatStore.questionTargetTabsFor(q.id);
      if (targets.length > 0) {
        return tabId !== null && targets.includes(tabId);
      }

      // 2. TASK_2026_109_FOLLOWUP_QUESTIONS Q4 — strict tab-id-only legacy
      //    match. The previous expression matched on `q.sessionId === sessionId`
      //    too, which double-rendered when two tabs share a `resolvedSessionId`
      //    (rewind/fork pointing at the same session) and the router didn't
      //    attach targets in time. Tab-id equality is the only safe legacy
      //    correlation now that the router owns conversation ↔ tab routing.
      const legacyMatch =
        tabId !== null && (q.tabId === tabId || q.sessionId === tabId);
      if (legacyMatch) return true;

      // 3. Last-resort visibility — show on active tile when nothing matched
      //    above. Better than a silent hang. Combined with Q3+Q5 the main
      //    panel never lands here when tiles exist.
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
   * TASK_2025_096 FIX: Computed signal that creates ExecutionChatMessages
   * from ALL currentExecutionTrees (not just the first one).
   *
   * When Claude uses tools, the SDK sends multiple assistant messages in one turn:
   * - Message 1: Contains tool calls (e.g., Glob)
   * - Message 2: Contains follow-up text and more tools after tool results
   *
   * Previously, only the first tree was rendered, causing subsequent messages to be LOST!
   * Now we return ALL trees as messages so they can all be rendered.
   *
   * TASK_2025_100 FIX: Include pendingStats from streamingState so stats display
   * during/after streaming before finalization. Stats may arrive before finalization
   * and should be shown immediately.
   *
   * DEDUPLICATION FIX: Finalized messages use tree.id (event id) NOT messageId,
   * so we can properly match and filter out already-finalized trees.
   */
  readonly streamingMessages = computed((): ExecutionChatMessage[] => {
    const trees = this.resolvedExecutionTrees();
    if (trees.length === 0) return [];

    const streamingState = this.resolvedStreamingState();
    const pendingStats = streamingState?.pendingStats;

    const finalizedMessageIds = new Set(
      this.resolvedMessages().map((msg) => msg.id),
    );
    const nonFinalizedTrees = trees.filter(
      (tree) => !finalizedMessageIds.has(tree.id),
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
  readonly allMessages = computed((): readonly ExecutionChatMessage[] => {
    const finalized = this.resolvedMessages();
    const streaming = this.streamingMessages();
    const combined =
      streaming.length === 0 ? finalized : [...finalized, ...streaming];
    return filterCompactionNoise(combined);
  });

  /**
   * Set of message ids that are currently being streamed (live trees, not yet
   * finalized). Used by the template to flip `isStreaming` per-bubble inside
   * the unified `@for` loop.
   */
  readonly streamingMessageIds = computed((): ReadonlySet<string> => {
    const streaming = this.streamingMessages();
    if (streaming.length === 0) return EMPTY_STRING_SET;
    return new Set(streaming.map((m) => m.id));
  });

  constructor() {
    // Auto-open agent panel when agents spawn or request permissions.
    // Uses untracked() for agentPanelOpen read to avoid bidirectional signal dependency.
    // Respects _userExplicitlyClosed to prevent fighting user intent.
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

      // Reset explicit-close flag when all agents finish â€” next spawn will auto-open
      if (!hasRunning && !hasPendingPermission && agents.length > 0) {
        this._userExplicitlyClosed = false;
      }
    });

    // Reset auto-scroll when a new user message is sent.
    // This ensures the view scrolls to show the user's message even if
    // they had scrolled up to read earlier content before sending.
    // TASK_2025_265 FIX 3: Use resolvedMessages() so canvas tiles track their own
    // tab's messages rather than the global active-tab messages.
    effect(() => {
      const messages = this.resolvedMessages();
      const count = messages.length;
      if (count > this.lastMessageCount) {
        const lastMsg = messages[count - 1];
        if (lastMsg?.role === 'user') {
          this.userScrolledUp.set(false);
          this.userMessageScrollTimeoutId = setTimeout(() => {
            this.scrollToBottom();
            this.userMessageScrollTimeoutId = null;
          }, 0);
        }
      }
      this.lastMessageCount = count;
    });

    // Restore scroll position when switching between tabs
    effect(() => {
      const currentTabId = this.resolvedTabId();
      if (currentTabId === this.previousTabId) return;

      this.previousTabId = currentTabId ?? null;

      if (currentTabId && this.scrollPositionCache.has(currentTabId)) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const savedPosition = this.scrollPositionCache.get(currentTabId)!;
        this.isRestoringScroll = true;
        setTimeout(() => {
          const container = this.messageContainerRef()?.nativeElement;
          if (container) {
            container.scrollTo({ top: savedPosition, behavior: 'instant' });
          }
          setTimeout(() => {
            this.isRestoringScroll = false;
          }, this.SCROLL_DEBOUNCE_MS + 10);
        }, 0);
      }
    });

    // Force scroll to bottom when streaming ends (agent finished work).
    // During finalization, streaming DOM is destroyed and finalized DOM is created.
    // This dramatic DOM change can cause scroll position disruption:
    // 1. Browser scroll anchoring resets scrollTop when anchor elements are destroyed
    //    (mitigated by overflow-anchor: none in CSS)
    // 2. Layout-driven scroll events falsely set userScrolledUp=true
    // 3. setTimeout(0) may fire before Angular renders finalized content in zoneless mode
    //
    // Fix: Enter a "finalization transition" guard that suppresses onScroll and forces
    // scheduleScroll to always scroll. Use afterNextRender for the first scroll attempt
    // (guaranteed post-render), plus a 300ms safety net for late DOM changes.
    effect(() => {
      const isStreaming = this.resolvedIsStreaming();
      if (this.wasStreaming && !isStreaming) {
        untracked(() => {
          this.isFinalizingTransition.set(true);
          this.userScrolledUp.set(false);

          // Clear any previous finalization timeout (rapid transitions)
          if (this.finalizingTimeoutId) {
            clearTimeout(this.finalizingTimeoutId);
          }

          // First scroll attempt: afterNextRender guarantees the callback fires
          // AFTER Angular change detection + DOM rendering completes. This is more
          // reliable than setTimeout(0) which races with zoneless CD microtasks.
          afterNextRender(
            () => {
              this.scrollToBottom('instant');
            },
            { injector: this.injector },
          );

          // End transition after generous window. Covers MutationObserver debounce
          // (50ms), async layout adjustments, and any late component rendering
          // (markdown, code highlighting). Final scrollToBottom catches everything.
          this.finalizingTimeoutId = setTimeout(() => {
            this.isFinalizingTransition.set(false);
            this.finalizingTimeoutId = null;
            this.scrollToBottom('instant');
          }, 300);
        });
      }
      this.wasStreaming = isStreaming;
    });

    // Setup MutationObserver after initial render to watch for DOM changes
    // This replaces the effect-based approach for more reliable scroll timing
    afterNextRender(
      () => {
        this.setupMutationObserver();
      },
      { injector: this.injector },
    );

    // Cleanup on component destruction
    this.destroyRef.onDestroy(() => {
      this.cleanup();
    });
  }

  /**
   * Handle scroll events on message container.
   * Detects if user has scrolled up to disable auto-scroll.
   * Ignores scroll events fired during programmatic scrollToBottom() to prevent
   * smooth scroll animation intermediates from falsely setting userScrolledUp.
   */
  onScroll(event: Event): void {
    if (this.isProgrammaticScrolling || this.isFinalizingTransition()) return;

    const container = event.target as HTMLElement;
    if (!container) return;

    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      100;

    this.userScrolledUp.set(!isNearBottom);

    const tabId = this.resolvedTabId();
    if (tabId) {
      this.scrollPositionCache.set(tabId, container.scrollTop);
    }
  }

  /**
   * Handle prompt selection from empty state - fill chat input (TASK_2025_174)
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

    // Double-fire guard — early return if this messageId already has a
    // branch/rewind action in flight. Click handler will fire again when
    // the user moves the cursor over the menu and re-clicks; without this
    // we'd issue parallel forkSession RPC calls, each producing a tab.
    const inFlight = this._actionInFlight();
    if (inFlight.has(messageId)) return;
    this._actionInFlight.set(new Set([...inFlight, messageId]));

    try {
      const result = await this._claudeRpc.forkSession(
        sessionId,
        messageId,
        undefined,
      );

      if (result.isSuccess()) {
        const newSessionId = result.data.newSessionId;

        // Layout-aware tab/tile creation. In canvas (grid) mode, tiles are
        // tracked separately from tabs in `CanvasStore` — calling
        // `openSessionTab` directly would create an invisible tab with no
        // backing tile. Use the `appState.requestCanvasSession` signal
        // bridge so `OrchestraCanvasComponent` adds the tile AND opens the
        // tab AND switches session in one place. In single mode, fall back
        // to opening a tab directly.
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

        // S4 — sidebar refresh is driven by `session:metadataChanged`
        // (forked) emitted by the backend on forkSession success and
        // handled by ChatMessageHandler with a 250ms debounce.
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

  /**
   * "Rewind to here" — revert tracked file changes back to the checkpoint
   * captured at the given user message. Performs a dry-run preview first,
   * confirms with the user, then commits. If the backend reports the session
   * is not active (`session-not-active:*` error code prefix from the SDK),
   * offers a "Resume & retry" affordance that loads the session into the
   * active tab and re-runs the rewind.
   */
  async onRewindRequested(messageId: string): Promise<void> {
    const sessionId = this.resolvedSessionId();
    if (!sessionId) {
      this.showActionError('No active session to rewind.');
      return;
    }

    // UI guard mirroring the backend `SessionLifecycleManager.getActiveSession`
    // contract. Rewind requires a live SDK `Query` handle; sessions loaded
    // purely from disk via `session:load` do not have one and the SDK throws
    // `SessionNotActiveError`. The button is also disabled in the template
    // when this signal is false, but we re-check here so programmatic /
    // keyboard-driven invocations don't bypass the gate. See Sentry
    // NODE-NESTJS-2Y / 2N / 2X.
    if (!this.resolvedSessionIsActive()) {
      this.showActionError(
        'Rewind is only available during an active conversation. Send a message or resume the session first.',
      );
      return;
    }

    // Double-fire guard — early return if a branch/rewind action for this
    // messageId is already running. The dialog round-trip plus dry-run/commit
    // cycle is long enough that an impatient user can easily double-click
    // before the first call resolves; without the guard this would issue
    // parallel rewinds (one of which might land mid-revert of the other).
    const inFlight = this._actionInFlight();
    if (inFlight.has(messageId)) return;
    this._actionInFlight.set(new Set([...inFlight, messageId]));

    try {
      await this.attemptRewind(sessionId, messageId);
    } finally {
      const next = new Set(this._actionInFlight());
      next.delete(messageId);
      this._actionInFlight.set(next);
    }
  }

  private async attemptRewind(
    sessionId: SessionId,
    messageId: string,
    retryCount = 0,
  ): Promise<void> {
    const dryRun = await this._claudeRpc.rewindFiles(
      sessionId,
      messageId,
      true,
    );

    if (!dryRun.isSuccess()) {
      await this.handleRewindError(
        dryRun.error,
        sessionId,
        messageId,
        retryCount,
      );
      return;
    }

    const dryData = dryRun.data;
    if (!dryData.canRewind) {
      // SDK reports canRewind=false with a friendly error when checkpointing
      // is disabled or the checkpoint is missing.
      this.showActionError(dryData.error ?? 'Cannot rewind to this message.');
      return;
    }

    const files = dryData.filesChanged ?? [];
    const ins = dryData.insertions ?? 0;
    const del = dryData.deletions ?? 0;

    const fileList =
      files.length === 0
        ? 'No files will be modified.'
        : files
            .slice(0, 10)
            .map((p) => `• ${p}`)
            .join('\n') +
          (files.length > 10 ? `\n…and ${files.length - 10} more` : '');

    const confirmed = await this._confirmDialog.confirm({
      title: 'Rewind file changes?',
      message: `${files.length} file(s) will be reverted (${ins} insertions, ${del} deletions removed):\n\n${fileList}`,
      confirmLabel: 'Rewind',
      cancelLabel: 'Cancel',
      confirmStyle: 'warning',
    });

    if (!confirmed) return;

    const commit = await this._claudeRpc.rewindFiles(
      sessionId,
      messageId,
      false,
    );

    if (!commit.isSuccess()) {
      await this.handleRewindError(
        commit.error,
        sessionId,
        messageId,
        retryCount,
      );
    } else if (!commit.data.canRewind) {
      this.showActionError(
        commit.data.error ?? 'Rewind failed without an error message.',
      );
    } else {
      // M3 — refresh any open editor tabs/diffs so they reflect the
      // reverted on-disk content. Failures are non-fatal: the rewind itself
      // succeeded, so we still show success but note the editor refresh
      // failure rather than swallowing it silently.
      let editorRefreshFailed = false;
      const filesChanged = commit.data.filesChanged ?? [];
      if (filesChanged.length > 0) {
        try {
          const revert = await this._claudeRpc.call('editor:revertFiles', {
            files: filesChanged,
          });
          if (!revert.isSuccess()) {
            editorRefreshFailed = true;
          }
        } catch {
          editorRefreshFailed = true;
        }
      }

      const changedCount = filesChanged.length;
      const baseMsg =
        changedCount === 0
          ? 'Rewind complete — no files changed.'
          : `Rewind complete — ${changedCount} file(s) reverted.`;
      this.showActionInfo(
        editorRefreshFailed ? `${baseMsg} (editor refresh failed)` : baseMsg,
      );
    }
  }

  private async handleRewindError(
    errorMessage: string | undefined,
    sessionId: SessionId,
    messageId: string,
    retryCount: number,
  ): Promise<void> {
    const msg = errorMessage ?? 'Unknown error';
    // Backend convention: rewind error codes prefixed `session-not-active:*`
    // mean the session must be resumed (loaded back into the active SDK
    // process) before rewind can read its checkpoint metadata.
    if (msg.startsWith('session-not-active')) {
      // Capped retry: only auto-retry on the first attempt. If a second
      // session-not-active surfaces it indicates the load succeeded but the
      // SDK still can't see the session — looping forever would be useless
      // and would spam the confirm dialog. Surface the error instead.
      if (retryCount > 0) {
        this.showActionError(
          `Rewind failed after resume retry: ${msg}. Please reopen the session manually.`,
        );
        return;
      }

      const retry = await this._confirmDialog.confirm({
        title: 'Session not active',
        message:
          'This session must be resumed before its files can be rewound. Resume the session and retry the rewind?',
        confirmLabel: 'Resume & retry',
        cancelLabel: 'Cancel',
        confirmStyle: 'primary',
      });
      if (!retry) return;

      // Use chat:resume (not session:load) to load history.
      // Pass activate:true so the backend also starts a live SDK Query via
      // autoResumeIfInactive — that is what rewindFiles needs to read file
      // checkpoint state from SessionLifecycleManager.  Without activate:true,
      // chat:resume is history-load only and does NOT start an SDK Query,
      // which would cause the retry to fail with the same session-not-active
      // error.  The activated flag in the response confirms the Query started.
      //
      // Use resolvedTabId() to honour the SESSION_CONTEXT for canvas tiles.
      // Looking up by `claudeSessionId` would resolve the wrong tab (or none)
      // when the rewind originates from a non-active tile, and falling back
      // to `tabId ?? ''` would silently send an empty tabId — losing the
      // resume stream entirely.
      const tabId = this.resolvedTabId();
      if (!tabId) {
        this.showActionError('Cannot resume — no active tab.');
        return;
      }
      const workspacePath = this.vscodeService.config().workspaceRoot;
      const resumed = await this._claudeRpc.call('chat:resume', {
        sessionId,
        tabId,
        workspacePath,
        activate: true,
      });
      if (!resumed.isSuccess()) {
        this.showActionError(`Resume failed: ${resumed.error ?? 'Unknown'}`);
        return;
      }
      if (!resumed.data.activated) {
        this.showActionError(
          'Session could not be activated for rewind. Please send a message first.',
        );
        return;
      }
      await this.attemptRewind(sessionId, messageId, retryCount + 1);
      return;
    }
    this.showActionError(`Rewind failed: ${msg}`);
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

  private scrollToBottom(behavior: ScrollBehavior = 'smooth'): void {
    const containerRef = this.messageContainerRef();
    if (!containerRef) return;

    const container = containerRef.nativeElement;

    // Guard: suppress onScroll during programmatic scrolling.
    // Smooth scroll generates intermediate scroll events at positions that
    // aren't near the bottom, which would falsely set userScrolledUp=true.
    this.isProgrammaticScrolling = true;
    container.scrollTo({
      top: container.scrollHeight,
      behavior,
    });

    if (behavior === 'instant') {
      // Instant scroll completes synchronously; clear after next frame
      // to catch any same-frame scroll events the browser fires.
      requestAnimationFrame(() => {
        this.isProgrammaticScrolling = false;
      });
    } else {
      // Smooth scroll animation takes multiple frames.
      // Clear after a generous window to cover the animation duration.
      setTimeout(() => {
        this.isProgrammaticScrolling = false;
      }, 400);
    }
  }

  /**
   * Setup MutationObserver to watch for DOM changes in message container.
   * This ensures scroll happens after recursive ExecutionNode tree completes rendering.
   */
  private setupMutationObserver(): void {
    const container = this.messageContainerRef()?.nativeElement;
    if (!container || this.observer) return;

    this.observer = new MutationObserver(() => {
      this.scheduleScroll();
    });

    // Watch for any DOM changes in the container subtree
    // TASK_2025_264 P5: Removed characterData (fired on every text node change during
    // streaming, causing excessive scroll callbacks). childList + subtree is sufficient
    // because Angular's change detection adds new DOM elements for streaming content.
    this.observer.observe(container, {
      childList: true, // New nodes added/removed
      subtree: true, // Watch entire subtree (recursive components)
    });
  }

  /**
   * Schedule a scroll to bottom with debouncing.
   * Debouncing coalesces rapid DOM mutations during streaming into single scroll.
   */
  private scheduleScroll(): void {
    if (this.scrollTimeoutId) {
      clearTimeout(this.scrollTimeoutId);
    }

    this.scrollTimeoutId = setTimeout(() => {
      // Skip MO-driven scroll during the finalize window: the streaming-end
      // effect already queues an authoritative afterNextRender scroll plus
      // a 300ms safety scroll. Firing here would land mid-DOM-swap and
      // produce a visible jump.
      if (this.isFinalizingTransition()) {
        this.scrollTimeoutId = null;
        return;
      }
      if (!this.userScrolledUp() && !this.isRestoringScroll) {
        const behavior = this.resolvedIsStreaming() ? 'smooth' : 'instant';
        this.scrollToBottom(behavior);
      }
      this.scrollTimeoutId = null;
    }, this.SCROLL_DEBOUNCE_MS);
  }

  /**
   * Cleanup observer and timeout on component destruction.
   */
  private cleanup(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.scrollTimeoutId) {
      clearTimeout(this.scrollTimeoutId);
      this.scrollTimeoutId = null;
    }
    if (this.userMessageScrollTimeoutId) {
      clearTimeout(this.userMessageScrollTimeoutId);
      this.userMessageScrollTimeoutId = null;
    }
    if (this.finalizingTimeoutId) {
      clearTimeout(this.finalizingTimeoutId);
      this.finalizingTimeoutId = null;
    }
    // ActionBannerService owns its own timer lifecycle (S3) — nothing to do here.
  }
}
