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
import { ChatStore } from '../../services/chat.store';
import {
  AgentMonitorStore,
  ExecutionTreeBuilderService,
} from '@ptah-extension/chat-streaming';
import { PanelResizeService } from '../../services/panel-resize.service';
import { TabManagerService } from '@ptah-extension/chat-state';
import { SESSION_CONTEXT } from '../../tokens/session-context.token';
import { VSCodeService } from '@ptah-extension/core';
import {
  createExecutionChatMessage,
  ExecutionChatMessage,
} from '@ptah-extension/shared';
import type { SubagentRecord } from '@ptah-extension/shared';

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
  private readonly _treeBuilder = inject(ExecutionTreeBuilderService);

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
   * Guard active during the streamingâ†’finalized DOM transition.
   * Suppresses onScroll events and forces scheduleScroll to scroll regardless
   * of userScrolledUp. Prevents layout-driven scroll events from blocking
   * auto-scroll during the dramatic DOM swap (streaming elements destroyed,
   * finalized elements created).
   */
  private isFinalizingTransition = false;
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
   */
  readonly resolvedIsCompacting = computed(() => {
    const tab = this.resolvedTab();
    return tab !== null
      ? (tab.isCompacting ?? false)
      : this.chatStore.isCompacting();
  });

  /**
   * Resolved question requests: scoped to this tile's session in canvas mode.
   * Prevents question cards from appearing in ALL tiles â€” only the session that
   * triggered the question shows the card.
   *
   * Matches against BOTH the frontend tab UUID (resolvedTabId) AND the real SDK
   * session UUID (resolvedSessionId / claudeSessionId). The backend may embed either
   * identifier depending on whether the session is new or resumed, so checking both
   * handles all cases without relying on backend routing correctness.
   */
  readonly resolvedQuestionRequests = computed(() => {
    const allQuestions = this.chatStore.questionRequests();
    if (allQuestions.length === 0) return [];

    const tabId = this.resolvedTabId(); // frontend UUID (e.g. "tab-abc123")
    const sessionId = this.resolvedSessionId(); // real SDK UUID (e.g. "session-xyz")

    if (!tabId && !sessionId) {
      if (this._sessionContext) return [];
      return allQuestions;
    }

    return allQuestions.filter(
      (q) =>
        (tabId && (q.tabId === tabId || q.sessionId === tabId)) ||
        (sessionId && (q.tabId === sessionId || q.sessionId === sessionId)),
    );
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
          this.isFinalizingTransition = true;
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
            this.isFinalizingTransition = false;
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
    if (this.isProgrammaticScrolling || this.isFinalizingTransition) return;

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
      // During finalization transition, always scroll regardless of userScrolledUp.
      // Layout-driven scroll events from the DOM swap may have falsely set it.
      if (
        this.isFinalizingTransition ||
        (!this.userScrolledUp() && !this.isRestoringScroll)
      ) {
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
  }
}
