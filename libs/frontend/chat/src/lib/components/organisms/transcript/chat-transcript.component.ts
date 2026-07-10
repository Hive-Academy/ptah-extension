import {
  Component,
  inject,
  input,
  output,
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
import { MessageBubbleComponent } from '../message-bubble.component';
import { ChatEmptyStateComponent } from '../../molecules/setup-plugins/chat-empty-state.component';
import { ExecutionTreeBuilderService } from '@ptah-extension/chat-streaming';
import { TabManagerService } from '@ptah-extension/chat-state';
import { SESSION_CONTEXT } from '../../../tokens/session-context.token';
import { VSCodeService } from '@ptah-extension/core';
import {
  createExecutionChatMessage,
  ExecutionChatMessage,
} from '@ptah-extension/shared';
import type { ExecutionNode } from '@ptah-extension/shared';
import { filterCompactionNoise } from './transcript-filter.utils';

const EMPTY_STRING_SET: ReadonlySet<string> = new Set<string>();
const EMPTY_MESSAGES: readonly ExecutionChatMessage[] = [];
const EMPTY_TREES: readonly ExecutionNode[] = [];

/**
 * ChatTranscriptComponent - Per-tab message list (scroll container + `@for` +
 * streaming skeleton + empty state + scroll/pin/resize-observer logic).
 *
 * Extracted from `ChatViewComponent` (TASK_2026_155 Batch 1) as the per-tab
 * seam for workspace-switch keep-alive. The parent keeps its singletons (input
 * area, header/stats, permission badge, question cards, banners, agent panel);
 * this organism owns only the transcript.
 *
 * Auto-scroll behavior:
 * - Scrolls to bottom when new messages arrive
 * - Scrolls to bottom when streaming starts
 * - Disables auto-scroll when user scrolls up manually
 * - Re-enables when user scrolls back to bottom
 */
@Component({
  selector: 'ptah-chat-transcript',
  imports: [MessageBubbleComponent, ChatEmptyStateComponent],
  templateUrl: './chat-transcript.component.html',
  styleUrl: './chat-transcript.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.hidden]': '!active()',
    class: 'flex-1 flex flex-col min-h-0 relative',
  },
})
export class ChatTranscriptComponent {
  private readonly vscodeService = inject(VSCodeService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly _tabManager = inject(TabManagerService);
  private readonly _treeBuilder = inject(ExecutionTreeBuilderService);
  private readonly _sessionContext = inject(SESSION_CONTEXT, {
    optional: true,
  });

  /** Frontend UUID of the tab whose transcript is rendered. */
  readonly tabId = input.required<string>();

  /**
   * Drives the reactivity pause (Batch 2). In Batch 1 the parent always passes
   * `true`, so behavior is identical to the inline transcript. The host is
   * `display:none` when false.
   */
  readonly active = input.required<boolean>();

  /** Whether this tab's session has a live SDK `Query` (gates rewind action). */
  readonly isSessionActive = input<boolean>(false);

  readonly branchRequested = output<string>();
  readonly rewindRequested = output<string>();
  /** Empty-state prompt selection → parent fills the chat input. */
  readonly promptSelected = output<string>();

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
   * (see chat-transcript.component.css), so this gives virtual-scroll-class
   * performance without the experimental autosize estimator — scroll
   * positions are the element's real `scrollTop`/`scrollHeight`.
   */
  private readonly scrollContainer =
    viewChild<ElementRef<HTMLElement>>('messageContainer');
  /** Inner content wrapper observed for height changes (streaming growth). */
  private readonly contentWrapper =
    viewChild<ElementRef<HTMLElement>>('messageContent');

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

  /** The tab this transcript renders (resolved per-tab from the tabId input). */
  private readonly _tab = computed(
    () => this._tabManager.tabs().find((t) => t.id === this.tabId()) ?? null,
  );

  /** Per-tab finalized messages. */
  readonly messages = computed<readonly ExecutionChatMessage[]>(
    () => this._tab()?.messages ?? EMPTY_MESSAGES,
  );

  /** Per-tab streaming state (this tab's SDK session). */
  readonly isStreaming = computed(() => {
    const status = this._tab()?.status;
    return status === 'streaming' || status === 'resuming';
  });

  private readonly _sessionId = computed(
    () => this._tab()?.claudeSessionId ?? null,
  );

  private readonly _streamingState = computed(
    () => this._tab()?.streamingState ?? null,
  );

  private readonly _executionTrees = computed<readonly ExecutionNode[]>(() => {
    const state = this._streamingState();
    if (!state) return EMPTY_TREES;
    // Preserve the tile-vs-tab tree cache key format so `clearForTab` /
    // `clearForSession` and main-panel-vs-tile cache isolation keep working.
    const cacheKey = this._sessionContext
      ? `tile-${this.tabId()}`
      : `tab-${this.tabId()}`;
    return this._treeBuilder.buildTree(state, cacheKey);
  });

  private readonly finalizedMessageIds = computed((): ReadonlySet<string> => {
    const msgs = this.messages();
    if (msgs.length === 0) return EMPTY_STRING_SET;
    const ids = new Set<string>();
    for (const m of msgs) ids.add(m.id);
    return ids;
  });

  protected readonly finalizedFiltered = computed(
    (): readonly ExecutionChatMessage[] => {
      return filterCompactionNoise(this.messages());
    },
  );

  readonly streamingMessages = computed((): ExecutionChatMessage[] => {
    const trees = this._executionTrees();
    if (trees.length === 0) return [];

    const streamingState = this._streamingState();
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
        sessionId: this._sessionId() ?? undefined,
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
    // Unified content-follow controller. Reacts to BOTH tab switches (tabId)
    // and content changes (allMessages — which transitively tracks
    // streaming-tree growth). One effect, one source of truth.
    effect(() => {
      const tabId = this.tabId();
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
      const isStreaming = this.isStreaming();
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

    const tabId = this.tabId();
    if (tabId) {
      this.scrollPositionCache.set(tabId, el.scrollTop);
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
   * On tab switch, restore the saved scroll offset (don't auto-follow),
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
