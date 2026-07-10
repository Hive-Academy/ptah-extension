import {
  Component,
  inject,
  signal,
  computed,
  viewChild,
  ChangeDetectionStrategy,
  effect,
  untracked,
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
import { ChatTranscriptComponent } from '../organisms/transcript/chat-transcript.component';
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
import { ResumeNotificationBannerComponent } from '../molecules/notifications/resume-notification-banner.component';
import { AuthRequiredBannerComponent } from '../molecules/notifications/auth-required-banner.component';
import { CompactSessionCardComponent } from '../molecules/compact-session/compact-session-card.component';
import { ChatStore } from '../../services/chat.store';
import { ActionBannerService } from '../../services/action-banner.service';
import { TranscriptRetentionService } from '../../services/transcript-retention.service';
import { CompactionLifecycleService } from '../../services/chat-store/compaction-lifecycle.service';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import { PanelResizeService } from '../../services/panel-resize.service';
import {
  TabManagerService,
  ConversationRegistry,
  TabSessionBinding,
  TabId,
  ConfirmationDialogService,
} from '@ptah-extension/chat-state';
import {
  SESSION_CONTEXT,
  HIDE_AGENT_SIDEBAR,
} from '../../tokens/session-context.token';
import {
  ClaudeRpcService,
  AppStateManager,
  AuthStateService,
  RpcResult,
} from '@ptah-extension/core';
import { SessionId } from '@ptah-extension/shared';
import type {
  ChatSessionSummary,
  SubagentRecord,
  MessageAnchorHint,
} from '@ptah-extension/shared';

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
    ChatTranscriptComponent,
    AgentMonitorPanelComponent,
    ChatInputComponent,
    PermissionBadgeComponent,
    QuestionCardComponent,
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
  providers: [TranscriptRetentionService],
})
export class ChatViewComponent {
  readonly chatStore = inject(ChatStore);
  private readonly agentMonitorStore = inject(AgentMonitorStore);
  private readonly panelResizeService = inject(PanelResizeService);
  private readonly _sessionContext = inject(SESSION_CONTEXT, {
    optional: true,
  });
  /** When true, the per-session Agents right sidebar is hidden (e.g. Tribunal
   * conductor — panelists render as their own tiles). */
  protected readonly hideAgentSidebar =
    inject(HIDE_AGENT_SIDEBAR, { optional: true }) ?? false;
  private readonly _tabManager = inject(TabManagerService);
  private readonly _appState = inject(AppStateManager);
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
   * `ActionBannerService` (S3); each banner carries a `tabId` and this view
   * only surfaces banners scoped to its own tab (or global `tabId: null`
   * ones), so a rewind fired on session A no longer toasts on session B's
   * surface when both are mounted in canvas/tile mode. The service owns its
   * own auto-clear timer.
   */
  private readonly actionBanner = inject(ActionBannerService);
  readonly actionError = computed(() => {
    const b = this.actionBanner.banner();
    if (!b || b.kind !== 'error') return null;
    return b.tabId === null || b.tabId === this.resolvedTabId()
      ? b.message
      : null;
  });
  readonly actionInfo = computed(() => {
    const b = this.actionBanner.banner();
    if (!b || b.kind !== 'info') return null;
    return b.tabId === null || b.tabId === this.resolvedTabId()
      ? b.message
      : null;
  });
  readonly actionWarning = computed(() => {
    const b = this.actionBanner.banner();
    if (!b || b.kind !== 'warning') return null;
    return b.tabId === null || b.tabId === this.resolvedTabId()
      ? b.message
      : null;
  });

  private showActionError(message: string, tabId: string | null = null): void {
    this.actionBanner.showError(message, tabId);
  }

  private showActionInfo(message: string, tabId: string | null = null): void {
    this.actionBanner.showInfo(message, tabId);
  }

  private showActionWarning(
    message: string,
    tabId: string | null = null,
  ): void {
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
   * Component-scoped LRU of tab ids whose transcript stays mounted (keep-alive).
   * One instance per ChatViewComponent (declared in `providers`).
   */
  private readonly _retention = inject(TranscriptRetentionService);

  /**
   * Tab ids to render as `<ptah-chat-transcript>` instances. Tile mode
   * (SESSION_CONTEXT present) renders exactly its one tab; the main panel
   * renders the retained set so switching tabs/workspaces reuses built DOM
   * instead of rebuilding it.
   */
  protected readonly transcriptTabIds = computed<readonly string[]>(() => {
    const ctx = this._sessionContext;
    if (ctx) {
      const id = ctx();
      return id ? [id] : [];
    }
    // The active tab always renders (appended once if the retention effect has
    // not registered it yet), so the transcript never blinks on the frame
    // between an active-tab change and the effect touch. Appending at the end
    // matches where `touch` inserts it, so `@for track tabId` never reorders.
    const retained = this._retention.retainedTabIds();
    const active = this._tabManager.activeTabId();
    if (active && !retained.includes(active)) {
      return [...retained, active];
    }
    return retained;
  });

  /**
   * The main panel renders a transcript LIVE only outside grid layout — in grid
   * mode the canvas tiles own the live render, so the hidden main panel must not
   * double-render the same tab (plan risk 5). Tile mode is always "showing"
   * (its single tab is on-screen); Batch 3 wires tile visibility to the
   * workspace grid.
   *
   * NOTE: compact view mode (`resolvedViewMode() === 'compact'`) destroys the
   * keep-alive region via the template `@if/@else`; a main-panel compact toggle
   * is rare and simply rebuilds on return. Accepted, not fixed (plan risk 6).
   */
  protected readonly mainPanelShowing = computed(() =>
    this._sessionContext ? true : this._appState.layoutMode() !== 'grid',
  );

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
    const prompt = `Resume agent ${agent.agentId} (the interrupted ${agent.agentType} agent) and have it continue its previous work from where it was interrupted.`;
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
      const result = await this.deleteOriginalSession(sessionId);
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
}
