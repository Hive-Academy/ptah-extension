import {
  Component,
  inject,
  input,
  output,
  signal,
  computed,
  linkedSignal,
  viewChild,
  ChangeDetectionStrategy,
  afterNextRender,
  type AfterRenderRef,
  effect,
  untracked,
  Injector,
  DestroyRef,
  ElementRef,
  NgZone,
} from '@angular/core';
import { AlertTriangle, LucideAngularModule } from 'lucide-angular';
import {
  MessageBubbleComponent,
  type TurnLogToggle,
} from '../message-bubble.component';
import { ChatEmptyStateComponent } from '../../molecules/setup-plugins/chat-empty-state.component';
import {
  ExecutionTreeBuilderService,
  SubagentExecutionStore,
} from '@ptah-extension/chat-streaming';
import { TabManagerService } from '@ptah-extension/chat-state';
import type { TabViewMode } from '@ptah-extension/chat-types';
import { DOCUMENT } from '@angular/common';
import {
  SESSION_CARD_ACTIONS,
  SESSION_CONTEXT,
  SESSION_FOCUSED,
  type SessionCardActions,
} from '../../../tokens/session-context.token';
import { parseLaneKey } from '../../molecules/compact-session/compact-lane-rows';
import { DisplayDockState } from '../../../services/display-dock/display-dock.state';
import { SingleChatSubagentViewComponent } from './single-chat-subagent-view.component';
import { SURFACE_ACTIVE, VSCodeService } from '@ptah-extension/core';
import {
  createExecutionChatMessage,
  ExecutionChatMessage,
} from '@ptah-extension/shared';
import type { ExecutionNode, TurnChangeSet } from '@ptah-extension/shared';
// Its own declaration from its own entry point: the compiler defers an import
// only when every symbol of the declaration is used inside `@defer` alone,
// and esbuild splits it out only when no eager code imports that file.
import { ChangeSetCardComponent } from '@ptah-extension/chat-ui/change-set-card';
// Same lazy-entry contract as the change-set card above (see
// `libs/frontend/chat-ui/src/turn-recap.ts`); the model builder is loaded
// through `TRANSCRIPT_TURN_RECAP_LOADER`, never imported as a value here.
import { TurnSummaryChipComponent } from '@ptah-extension/chat-ui/turn-recap';
// Same contract (see `libs/frontend/chat-ui/src/display-panel.ts`).
import { DisplaySurfaceSyncComponent } from '@ptah-extension/chat-ui/display-panel';
import {
  PTAH_UI_HOST_SOURCES,
  PtahUiLiveWindow,
} from '@ptah-extension/chat-ui';
import {
  ChangeSetStore,
  type ChangeSetMarks,
} from '../../../services/change-set/change-set.store';
import { ChangeSetActionsService } from '../../../services/change-set/change-set-actions.service';
import {
  anchorChangeSets,
  NO_CHANGE_SET_ANCHORS,
  transcriptOrderKey,
  type ChangeSetAnchors,
} from './transcript-change-set-anchors';
import { TranscriptDisplayFeed } from './transcript-display-feed';
import {
  NO_TURN_SNAPSHOTS,
  TranscriptTurnSnapshots,
  type TurnSnapshots,
} from './transcript-turn-snapshots';
import { filterCompactionNoise } from './transcript-filter.utils';
import { TranscriptOlderHistorySentinelDirective } from './transcript-older-history-sentinel.directive';
import { TranscriptPrependAnchorDirective } from './transcript-prepend-anchor.directive';
import { TranscriptRenderWindow } from './transcript-render-window';
import { TranscriptSlotDirective } from './transcript-slot.directive';
import {
  STREAM_PRESENTATION_RECORDS_ENABLED,
  StreamPresentationStore,
} from '../../../services/stream-presentation-store.service';
import { SessionAgentRosterService } from '../../../services/session-agents/session-agent-roster.service';
import type { SessionAgent } from '../../../services/session-agents/session-agent-roster';
import { SessionInspectorStore } from '../../../services/session-inspector/session-inspector.store';
import type { TurnContext } from '../../../utils/turn-facts.utils';
import {
  liveTurnIdsOf,
  streamingTurnIdsOf,
  NO_SESSION_AGENTS,
  NO_TURN_AGENTS,
  TranscriptTurnContexts,
  turnAgentKeysOf,
  turnAgentsOf,
  turnLogOpenOf,
  type TurnAgentKeys,
  type TurnAgents,
  type TurnContexts,
} from './transcript-turn-contexts';
import { TranscriptLiveClock } from './transcript-live-clock';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import { groupLaneEvents, laneMetricsForRow, newestLaneRowKeys, sameLaneMonitorSnapshot, type LaneMonitorSnapshot } from './transcript-lane-events';
import type { LaneSlot } from '../../molecules/lane-event/lane-event-row.types';
import { LaneEventRowComponent } from '../../molecules/lane-event/lane-event-row.component';

const EMPTY_STRING_SET: ReadonlySet<string> = new Set<string>();
const EMPTY_MESSAGES: readonly ExecutionChatMessage[] = [];
const EMPTY_TREES: readonly ExecutionNode[] = [];
const EMPTY_ORDER_KEYS: ReadonlyMap<string, number> = new Map<string, number>();

/**
 * Merge finalized and streaming messages in TIME order rather than in
 * lifecycle order (TASK_2026_382 D1).
 *
 * Concatenating `[...finalized, ...streaming]` put every finalized message
 * above every live tree — so a user message sent while a stream was still on
 * screen rendered ABOVE the bubble it was answering. Ordering by time is
 * correct whichever dispatch window is open.
 *
 * Both inputs are already ascending in their own key, so this is a linear
 * two-way merge, not a sort: cheaper, and STABLE by construction — equal keys
 * keep finalized-before-streaming, and neither list is reordered internally
 * even if a producer ever hands over an unsorted one.
 */
function mergeByTime(
  finalized: readonly ExecutionChatMessage[],
  streaming: readonly ExecutionChatMessage[],
): readonly ExecutionChatMessage[] {
  const merged: ExecutionChatMessage[] = new Array(
    finalized.length + streaming.length,
  );
  let f = 0;
  let s = 0;
  let out = 0;
  while (f < finalized.length && s < streaming.length) {
    merged[out++] =
      transcriptOrderKey(finalized[f]) <= transcriptOrderKey(streaming[s])
        ? finalized[f++]
        : streaming[s++];
  }
  while (f < finalized.length) merged[out++] = finalized[f++];
  while (s < streaming.length) merged[out++] = streaming[s++];
  return merged;
}

/**
 * Frozen view snapshot consumed by the template. When the transcript is hidden
 * (`!workActive()`), the gated `vm` computed returns the last snapshot taken while
 * active, so streaming writes to `TabManagerService.tabs()` neither rebuild the
 * execution tree nor refresh the DOM — and the built bubbles survive a
 * workspace switch that drops the tab from `tabs()` entirely.
 */
interface TranscriptViewModel {
  readonly messages: readonly ExecutionChatMessage[];
  readonly slots: readonly TranscriptMessageSlot[];
  /**
   * Render-window and per-bubble streaming boundary. During history replay it
   * equals `totalCount`, so replayed trees are windowed and publish settled
   * execution nodes synchronously without a per-node rAF. Otherwise it equals
   * the finalized message count, preserving the live typing throttle. This
   * reads raw `historyReplaying()`, never the replay motion hold.
   */
  readonly streamingBoundary: number;
  readonly streamingCount: number;
  readonly totalCount: number;
  readonly isStreaming: boolean;
  readonly hasMessages: boolean;
  readonly hasOlderHistory: boolean;
  readonly isSessionActive: boolean;
}

const EMPTY_VIEW_MODEL: TranscriptViewModel = {
  messages: EMPTY_MESSAGES,
  slots: [],
  streamingBoundary: 0,
  streamingCount: 0,
  totalCount: 0,
  isStreaming: false,
  hasMessages: false,
  hasOlderHistory: false,
  isSessionActive: false,
};

interface TranscriptMessageSlot {
  readonly id: string;
  readonly record: () => ExecutionChatMessage;
}

/** The sub-agent opened in place, resolved live from this tab's trees. */
interface OpenSubagent {
  readonly node: ExecutionNode;
  readonly streaming: boolean;
}

/** What Back restores: the transcript scroll state and the opener's focus. */
interface SubagentReturn {
  readonly scrollTop: number;
  readonly pinned: boolean;
  readonly opener: HTMLElement | null;
}

/**
 * The conversation an open sub-agent belongs to. A null session id is a
 * conversation that has not been assigned one yet; the first id it gets is
 * the same conversation, any later change is a switch.
 */
interface SubagentOwner {
  readonly tabId: string;
  sessionId: string | null;
}

/** The agent node spawned by tool call `toolCallId`, at any depth. */
function findAgentNode(
  node: ExecutionNode | null | undefined,
  toolCallId: string,
): ExecutionNode | null {
  if (!node) return null;
  if (node.type === 'agent' && node.toolCallId === toolCallId) return node;
  for (const child of node.children) {
    const found = findAgentNode(child, toolCallId);
    if (found) return found;
  }
  return null;
}

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
  imports: [
    LucideAngularModule,
    MessageBubbleComponent,
    LaneEventRowComponent,
    ChatEmptyStateComponent,
    TranscriptSlotDirective,
    TranscriptOlderHistorySentinelDirective,
    TranscriptPrependAnchorDirective,
    // Used only inside `@defer`, so the compiler loads it lazily.
    ChangeSetCardComponent,
    // Used only inside `@defer`, so the compiler loads it lazily.
    TurnSummaryChipComponent,
    // Used only inside `@defer`, so the compiler loads it lazily.
    DisplaySurfaceSyncComponent,
    SingleChatSubagentViewComponent,
  ],
  providers: [
    TranscriptRenderWindow,
    // `PtahUiLiveWindow` is per tab: one transcript per tab owns it, so each
    // tab caps its own live `ptah-ui` blocks (TASK_2026_610, decision 10).
    PtahUiLiveWindow,
    // Per tab as well: this transcript's own host sources, so its blocks and
    // its display sync never read another tab's facts (decisions #81, #102).
    // Resolved after construction (the transcript itself never injects it).
    {
      provide: PTAH_UI_HOST_SOURCES,
      useFactory: () => inject(ChatTranscriptComponent).display.hostSources,
    },
    // Sub-agent tiles (this transcript renders bubbles in tile mode) route
    // through SESSION_CARD_ACTIONS. A host that provides it (the Rail) wins;
    // otherwise the single chat view opens the agent in place. Provided here,
    // on the transcript, so siblings such as ChatView's compact card never
    // see it and keep their tolerant (non-strict) ownership rule.
    {
      provide: SESSION_CARD_ACTIONS,
      useFactory: (): SessionCardActions =>
        inject(SESSION_CARD_ACTIONS, { skipSelf: true, optional: true }) ??
        inject(ChatTranscriptComponent).singleChatCardActions(),
    },
  ],
  templateUrl: './chat-transcript.component.html',
  styleUrl: './chat-transcript.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.hidden]': '!active()',
    class: 'flex-1 flex flex-col min-h-0 relative',
    // Agent-output surface: file links in rendered markdown route into Ptah's
    // viewer, and `data-ptah-tab-id` tells the router which workspace a
    // relative path belongs to (this transcript may render a BACKGROUND
    // workspace's tab). Both are host bindings by contract — never written on
    // a `<markdown>` element and never inside rendered content, so agent HTML
    // cannot opt a surface in or redirect one (TASK_2026_413 R2/R8).
    'data-ptah-file-links': '',
    '[attr.data-ptah-tab-id]': 'tabId()',
  },
})
export class ChatTranscriptComponent {
  private readonly vscodeService = inject(VSCodeService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly _tabManager = inject(TabManagerService);
  private readonly _treeBuilder = inject(ExecutionTreeBuilderService);
  private readonly laneMonitor = inject(AgentMonitorStore, { optional: true });
  private readonly sessionContext = inject(SESSION_CONTEXT, { optional: true });
  private readonly displayDock = inject(DisplayDockState, { optional: true });
  private readonly presentationRecordsEnabled = inject(
    STREAM_PRESENTATION_RECORDS_ENABLED,
  );
  private readonly presentationStore = this.presentationRecordsEnabled
    ? inject(StreamPresentationStore)
    : null;
  /** Tile surfaces provide their focus state; absent → always focused. */
  private readonly _sessionFocused = inject(SESSION_FOCUSED, {
    optional: true,
  });
  private readonly ngZone = inject(NgZone);
  private readonly changeSetStore = inject(ChangeSetStore);
  private readonly changeSetActions = inject(ChangeSetActionsService);

  /**
   * Mount decision for each message. Component-scoped (see `providers`), fed
   * from the gated `vm()` so the freeze discipline extends to it. Template
   * reads `isMounted()` / `placeholderHeight()`.
   */
  protected readonly renderWindow = inject(TranscriptRenderWindow);

  /** Frontend UUID of the tab whose transcript is rendered. */
  readonly tabId = input.required<string>();

  /**
   * Drives the reactivity pause (Batch 2). In Batch 1 the parent always passes
   * `true`, so behavior is identical to the inline transcript. The host is
   * `display:none` when false.
   */
  readonly active = input.required<boolean>();
  /** True for one session-switch entrance window. */
  readonly entering = input(false);
  private readonly surfaceActive = inject(SURFACE_ACTIVE);
  protected readonly workActive = computed(
    () => this.active() && this.surfaceActive(),
  );

  /** Whether this tab's session has a live SDK `Query` (gates rewind action). */
  readonly isSessionActive = input<boolean>(false);

  /** True only while this tab is replaying persisted history. */
  readonly historyReplaying = input<boolean>(false);

  /** Whether this tab has another persisted-history page available. */
  readonly hasOlderHistory = input<boolean>(false);
  /** Whether this tab is currently requesting an older-history page. */
  readonly olderHistoryLoading = input<boolean>(false);
  /** Requests the next older-history page for this tab. */
  readonly olderHistoryRequested = output<void>();

  readonly branchRequested = output<string>();
  readonly rewindRequested = output<string>();
  /** Empty-state prompt selection → parent fills the chat input. */
  readonly promptSelected = output<string>();
  readonly resumeRequested = output<string>();

  /**
   * ResizeObserver on the content wrapper. Fires whenever the content's height
   * changes — streaming text growth, agent sub-output, markdown image load, or
   * the streaming→finalized swap — which is exactly when a pinned transcript
   * must re-stick to the bottom. Fires on real size change only, so it can't
   * storm.
   */
  private resizeObserver: ResizeObserver | null = null;
  private scrollRafId: number | null = null;
  private scrollRestoreRef: AfterRenderRef | null = null;
  private scrollGeneration = 0;
  private retentionReleasePending = false;
  private retentionReleaseGeneration = 0;
  private retentionReleaseRafId: number | null = null;
  private retentionReleaseTimeoutId: number | null = null;
  private lastContentHeight = 0;
  /** Distance from bottom (px) within which the user is considered "pinned". */
  private readonly NEAR_BOTTOM_PX = 120;

  /** Bound native scroll listener body; registered outside the zone. */
  private readonly scrollHandler = (): void => this.onScroll();

  /** Kept for cleanup after viewChild signals become unavailable on destroy. */
  private scrollElement: HTMLElement | null = null;

  /** Native scroll container; rendered slots may be windowed. */
  private readonly scrollContainer =
    viewChild<ElementRef<HTMLElement>>('messageContainer');
  /** Inner content wrapper observed for height changes (streaming growth). */
  private readonly contentWrapper =
    viewChild<ElementRef<HTMLElement>>('messageContent');

  /** Signal so outside-zone scroll changes refresh the pinned binding. */
  private readonly pinnedToBottom = signal(true);

  /** Track message count to detect new user messages */
  private lastMessageCount = 0;

  /** Detects streaming completion for motion suppression and bottom stick. */
  private wasStreaming = false;
  /** Previous replay input value, used only to detect its falling edge. */
  private wasHistoryReplaying = false;
  private wasRenderWindowReplaying = false;

  /** Previous scrollTop distinguishes an upward user scroll from bottom stick. */
  private lastScrollTop = 0;

  /** Last user offset, saved before a hidden tab loses its native scrollTop. */
  private savedScrollTop: number | null = null;
  /** Previous combined activity value — detects the hidden→visible activation edge. */
  private wasActive = false;

  /**
   * Active during the streaming→finalized DOM transition.
   *
   * A signal so it flows reactively into <ptah-message-bubble> and onward to
   * ExecutionNodeComponent + InlineAgentBubbleComponent — those use it to
   * suppress fade keyframes during the finalize burst.
   */
  protected readonly isFinalizingTransition = signal(false);
  private readonly replayMotionHold = signal(false);
  protected readonly motionSuppressed = computed(
    () =>
      this.historyReplaying() ||
      this.replayMotionHold() ||
      this.isFinalizingTransition(),
  );
  private finalizingTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private replayMotionHoldTimeoutId: ReturnType<typeof setTimeout> | null =
    null;

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

  protected readonly sessionId = computed(
    () => this._tab()?.claudeSessionId ?? null,
  );

  private readonly _streamingState = computed(
    () => this._tab()?.streamingState ?? null,
  );

  private readonly presentation = computed(() => {
    if (!this.presentationStore) return null;
    return this.presentationStore.structureFor(this.tabId())();
  });

  private readonly _executionTrees = computed<readonly ExecutionNode[]>(() => {
    const state = this._streamingState();
    if (!state) return EMPTY_TREES;
    // One key per tab for every surface (main panel, canvas tile, detail
    // row): a tab has one streamingState, so all surfaces share one build.
    return this._treeBuilder.buildTree(state, `tab-${this.tabId()}`);
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
        sessionId: this.sessionId() ?? undefined,
        ...(pendingStats && {
          tokens: pendingStats.tokens,
          cost: pendingStats.cost,
          duration: pendingStats.duration,
        }),
      }),
    );
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
      streaming.length === 0 ? finalized : mergeByTime(finalized, streaming);
    this._allMessagesFinalizedRef = finalized;
    this._allMessagesStreamingRef = streaming;
    this._allMessagesCache = next;
    return next;
  });

  /**
   * Frozen snapshot backing the gated `vm` computed. Same
   * mutable-field-inside-computed precedent as the `allMessages` memo above.
   */
  private _frozenView: TranscriptViewModel = EMPTY_VIEW_MODEL;

  /**
   * Single template-facing view model, gated on surface and tab activity. While
   * hidden it returns `_frozenView` and reads only `workActive` — streaming
   * chunks (`tabs()` identity churn, `buildTree`, markdown re-parse) become
   * invisible. Reactivation re-evaluates it exactly once, producing a
   * one-shot catch-up render over the diffed `@for` (`track msg.id` reuses every
   * existing bubble).
   */
  protected readonly vm = computed<TranscriptViewModel>(() => {
    if (!this.workActive()) {
      return this._frozenView;
    }
    const presentation = this.presentation();
    if (presentation) {
      const next: TranscriptViewModel = {
        messages: presentation.messages,
        slots: presentation.slots,
        streamingBoundary: this.historyReplaying()
          ? presentation.totalCount
          : presentation.streamingBoundary,
        streamingCount: presentation.streamingCount,
        totalCount: presentation.totalCount,
        isStreaming: presentation.isStreaming,
        hasMessages: presentation.hasMessages,
        hasOlderHistory: this.hasOlderHistory(),
        isSessionActive: this.isSessionActive(),
      };
      this._frozenView = next;
      return next;
    }
    const finalized = this.finalizedFiltered();
    const streaming = this.streamingMessages();
    const totalCount = finalized.length + streaming.length;
    const messages = this.allMessages();
    const next: TranscriptViewModel = {
      messages,
      slots: messages.map((message) => ({
        id: message.id,
        record: () => message,
      })),
      streamingBoundary: this.historyReplaying()
        ? totalCount
        : finalized.length,
      streamingCount: streaming.length,
      totalCount,
      isStreaming: this.isStreaming(),
      hasMessages: this.messages().length > 0,
      hasOlderHistory: this.hasOlderHistory(),
      isSessionActive: this.isSessionActive(),
    };
    this._frozenView = next;
    return next;
  });

  /**
   * Transcript order key per message id, fed to each bubble's
   * `ptahUiOrderKey` input so the tab's `PtahUiLiveWindow` ranks its
   * `ptah-ui` blocks by transcript order (higher is newer — see
   * `transcriptOrderKey`, which keeps streaming and finalized assistant
   * messages on one stable clock).
   *
   * Electron only [user scope]: the live window exists only there, so the
   * VS Code webview computes no map and its bubbles keep the input's `0`
   * default — which their `ptah-ui` context (always `null` on VS Code)
   * never reads. Derived from the gated `vm`, so a hidden transcript
   * builds no map and reactivation recomputes it exactly once.
   */
  protected readonly ptahUiOrderKeys = computed<ReadonlyMap<string, number>>(
    () => {
      if (!this.vscodeService.isElectron) return EMPTY_ORDER_KEYS;
      const presentation = this.presentation();
      if (presentation) return presentation.orderKeys;
      const messages = this.vm().messages;
      if (messages.length === 0) return EMPTY_ORDER_KEYS;
      const keys = new Map<string, number>();
      for (const msg of messages) keys.set(msg.id, transcriptOrderKey(msg));
      return keys;
    },
  );

  private _frozenAnchors: ChangeSetAnchors = NO_CHANGE_SET_ANCHORS;

  /**
   * Change-set cards per message: each turn's card renders after the turn's
   * last assistant message (see `anchorChangeSets`). Gated like `vm`, so a
   * hidden transcript keeps its last placement and does no join work.
   */
  protected readonly changeSetAnchors = computed<ChangeSetAnchors>(() => {
    const view = this.vm();
    if (!this.workActive()) return this._frozenAnchors;
    const next = anchorChangeSets(
      view.messages,
      this.changeSetStore.changeSetsFor(this.sessionId()),
    );
    this._frozenAnchors = next;
    return next;
  });

  private _frozenPtahUiSnapshots: TurnSnapshots = NO_TURN_SNAPSHOTS;

  /** Per-turn snapshot builder and its identity-stable cache. */
  private readonly turnSnapshots = new TranscriptTurnSnapshots();

  /**
   * Turn-source snapshots per message (TASK_2026_610 PR C, component 4); see
   * `TranscriptTurnSnapshots` for the rules. Electron only [user scope] — the
   * VS Code webview computes no map and every bubble keeps the input's `null`
   * default. Frozen while the tab is hidden like `vm`; unchanged turns keep
   * their snapshot identity, so a source change (finalization, a late push,
   * the store settling a no-op turn) updates blocks in place (Req 3.2).
   */
  protected readonly ptahUiSnapshots = computed<TurnSnapshots>(() => {
    if (!this.vscodeService.isElectron) return NO_TURN_SNAPSHOTS;
    const view = this.vm();
    if (!this.workActive()) return this._frozenPtahUiSnapshots;
    const sessionId = this.sessionId();
    // Each slot's CURRENT record, not `view.messages`: on the presentation
    // path `messages` changes only on a structural change, while a tree that
    // grows under the same id updates its record alone (the display feed's
    // rule). The snapshot cache keys on message identity, so only the live
    // turn rebuilds.
    const next = this.turnSnapshots.compute(sessionId, {
      messages: view.slots.map((slot) => slot.record()),
      streamingBoundary: view.streamingBoundary,
      changeSets: this.changeSetStore.changeSetsFor(sessionId),
      anchors: this.changeSetAnchors(),
      settledThrough: this.changeSetStore.settledThrough(sessionId),
    });
    this._frozenPtahUiSnapshots = next;
    return next;
  });

  private _frozenTurnMessages: readonly ExecutionChatMessage[] = EMPTY_MESSAGES;

  /**
   * Each slot's CURRENT record, gated like `vm`: on the presentation path a
   * tree that grows under the same id updates its record alone, so turn facts
   * (activity, counts) read the records, not `vm().messages`.
   */
  private readonly turnMessages = computed<readonly ExecutionChatMessage[]>(
    () => {
      const view = this.vm();
      if (!this.workActive()) return this._frozenTurnMessages;
      const next =
        view.slots.length === 0
          ? EMPTY_MESSAGES
          : view.slots.map((slot) => slot.record());
      this._frozenTurnMessages = next;
      return next;
    },
  );

  /** Keep the rendered rows stable while this tab is inactive. */
  private readonly liveLaneIds = computed(() => new Set(
    (this.laneMonitor?.agents?.() ?? [])
      .filter(agent => agent.status === 'running')
      .map(agent => agent.agentId),
  ), { equal: (a, b) => a.size === b.size && [...a].every(id => b.has(id)) });

  protected readonly laneSlots = linkedSignal({
    source: () => ({
      active: this.workActive(),
      messages: this.turnMessages(),
      liveIds: this.liveLaneIds(),
    }),
    computation: (source, previous): ReadonlyMap<string, LaneSlot> => {
      if (!source.active) return previous?.value ?? new Map();
      return groupLaneEvents(source.messages, source.liveIds);
    },
  });

  protected readonly newestLaneRows = computed(() => newestLaneRowKeys(this.laneSlots()));
  private monitorSnapshots = new Map<string, LaneMonitorSnapshot>();
  protected readonly laneMetricsForRow = laneMetricsForRow;

  /** Reuse each agent's small metrics object while stream-only fields change. */
  protected readonly monitoredLaneAgents = computed(() => {
    const previous = this.monitorSnapshots;
    const next = new Map<string, LaneMonitorSnapshot>();
    for (const agent of this.laneMonitor?.agents?.() ?? []) {
      const usage = agent.usageTotals;
      const snapshot: LaneMonitorSnapshot = {
        agentId: agent.agentId,
        model: agent.model, usageTotals: usage ? {
          model: usage.model, totalTokens: usage.totalTokens,
          inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: usage.costUsd,
        } : null,
        status: agent.status, startedAt: agent.startedAt, completedAt: agent.completedAt,
      };
      const old = previous.get(agent.agentId);
      next.set(agent.agentId, old && sameLaneMonitorSnapshot(old, snapshot) ? old : snapshot);
    }
    this.monitorSnapshots = next;
    return next;
  });

  private readonly turnContextBuilder = new TranscriptTurnContexts();

  /**
   * Turn facts per assistant message id (A1 §2): the bubble's `turn` input.
   * Unchanged turns keep their context objects while another turn streams.
   */
  protected readonly turnContexts = computed<TurnContexts>(() =>
    this.turnContextBuilder.compute(this.turnMessages()),
  );

  /** The tab's density preference (design-spec §3.8); `full` when unset. */
  protected readonly viewMode = computed<TabViewMode>(
    () => this._tab()?.viewMode ?? 'full',
  );

  /**
   * The user's open choice per turn (§3.1): set by the disclosure row, never
   * reset by the auto-collapse, kept in memory only.
   */
  protected readonly turnLogOpen = signal<ReadonlyMap<string, boolean>>(
    new Map(),
  );

  /** Shared empty `agents` binding (one identity for every bubble). */
  protected readonly noAgents = NO_SESSION_AGENTS;

  private get subagentExecutions(): SubagentExecutionStore {
    return this.injector.get(SubagentExecutionStore);
  }

  /** Roster keys of agents in the turn and in their own execution trees. */
  private readonly turnAgentKeys = computed<TurnAgentKeys>(() =>
    turnAgentKeysOf(this.turnMessages(), this.turnContexts(), (key) => {
      const store = this.subagentExecutions;
      store.revisionFor(key);
      return store.treeFor(key);
    }),
  );

  private _frozenRoster: readonly SessionAgent[] = NO_SESSION_AGENTS;
  private _previousTurnAgents: TurnAgents = NO_TURN_AGENTS;

  /**
   * The session's agent roster, read once for the whole transcript and only
   * when some turn spawned an agent. Resolved lazily: a transcript without
   * agents never builds the roster. Gated like `vm`.
   */
  private readonly roster = computed<readonly SessionAgent[]>(() => {
    if (this.turnAgentKeys().size === 0) return NO_SESSION_AGENTS;
    if (!this.workActive()) return this._frozenRoster;
    const next = this.injector
      .get(SessionAgentRosterService)
      .roster(this.tabId());
    this._frozenRoster = next;
    return next;
  });

  /** Turn id → the roster entries of its agents (the bubble's chips). */
  protected readonly turnAgents = computed<TurnAgents>(() => {
    const next = turnAgentsOf(
      this.turnAgentKeys(),
      this.roster(),
      this._previousTurnAgents,
    );
    this._previousTurnAgents = next;
    return next;
  });

  /** Turns with a message still streaming. */
  private readonly streamingTurnIds = computed<ReadonlySet<string>>(() =>
    streamingTurnIdsOf(
      this.turnMessages(),
      this.vm().streamingBoundary,
      this.turnContexts(),
    ),
  );

  /** Turns still streaming, or with an agent still running. */
  protected readonly liveTurnIds = computed<ReadonlySet<string>>(() =>
    liveTurnIdsOf(this.streamingTurnIds(), this.turnAgents()),
  );

  private readonly hasLiveTurn = computed(() => this.liveTurnIds().size > 0);

  /** ONE clock for the transcript; ticks only while a turn is live and shown. */
  private readonly liveClock = new TranscriptLiveClock(
    () => this.hasLiveTurn() && this.workActive(),
  );
  protected readonly liveNow = this.liveClock.now;

  /**
   * The session's needs-you aggregate for the live turn's line (§3.7, B2),
   * the same source as the header chip; `0` without a live turn or a tab.
   * The inspector store is resolved only when a turn is live.
   */
  protected readonly needsYouCount = computed(() => {
    if (!this.hasLiveTurn() || !this._tab()) return 0;
    return this.injector.get(SessionInspectorStore).modelFor(this.tabId())()
      .needsYouCount;
  });

  /**
   * The display-panel feed (TASK_2026_623, component 7): host sources,
   * display candidates, turn summaries and the live turn. Electron only, but
   * the host sources serve any `ptah-ui` block. See `TranscriptDisplayFeed`.
   */
  readonly display = new TranscriptDisplayFeed({
    enabled: this.vscodeService.isElectron,
    tabId: this.tabId,
    tab: this._tab,
    view: this.vm,
    snapshots: this.ptahUiSnapshots,
    activeTrees: this._executionTrees,
    streaming: this.isStreaming,
    finalized: this.finalizedFiltered,
    marksFor: (changeSet) => this.changeSetStore.marksFor(changeSet),
  });

  protected readonly ChangeSetErrorIcon = AlertTriangle;

  private readonly document = inject(DOCUMENT);

  /** Tool call id of the sub-agent opened in place; null shows the transcript. */
  private readonly openSubagentId = signal<string | null>(null);
  /** Polite announcement for a tile whose agent cannot be opened here. */
  protected readonly subagentNotice = signal('');
  private subagentReturn: SubagentReturn | null = null;
  private subagentOwner: SubagentOwner | null = null;
  /** Last resolution while active; same freeze rule as `vm`. */
  private _frozenOpenSubagent: OpenSubagent | null = null;

  /**
   * The opened agent, re-resolved from the gated `vm` on every update, so the
   * full view shows the live node (streaming, finalized, nested agents) and
   * follows it from the streaming tree into its finalized message. Null once
   * the agent is gone; the close effect in the constructor then leaves.
   */
  protected readonly openSubagent = computed<OpenSubagent | null>(() => {
    const toolCallId = this.openSubagentId();
    if (toolCallId === null) return null;
    if (!this.workActive()) return this._frozenOpenSubagent;
    const next = this.findSubagent(toolCallId);
    this._frozenOpenSubagent = next;
    return next;
  });

  /**
   * Covers and inerts the transcript only while an agent is actually shown,
   * so a vanished agent can never leave an inert transcript behind.
   */
  protected readonly subagentOpen = computed(
    () => this.openSubagent() !== null,
  );

  /**
   * SESSION_CARD_ACTIONS for the single chat view, built only when no host
   * provides its own (see `providers`). Public for that provider factory.
   */
  singleChatCardActions(): SessionCardActions {
    return {
      openLane: (key) => this.openSubagentLane(key),
      openSession: () => this.closeSubagent(),
      canOpenLane: (key) => this.canOpenLaneHere(key),
    };
  }

  /**
   * The Electron display dock has no agent-card view, so a CLI lane has no
   * surface in a single chat view there: its chip and "Open lane" button
   * show status only. The canvas Rail provides its own actions and opens it.
   */
  private canOpenLaneHere(key: string): boolean {
    return parseLaneKey(key)?.kind !== 'cli' || this.displayDock === null;
  }

  /**
   * Back (or the open agent vanished from this conversation): show the
   * transcript again with its scroll position, and return focus to the opener
   * when the closing view took focus with it.
   */
  protected closeSubagent(): void {
    if (this.openSubagentId() === null) return;
    const saved = this.subagentReturn;
    this.discardSubagent();
    if (saved) {
      this.pinnedToBottom.set(saved.pinned);
      this.savedScrollTop = saved.scrollTop;
    }
    this.restoreScrollOnActivation();
    afterNextRender(
      () => {
        const active = this.document.activeElement;
        const focusLost = active === null || active === this.document.body;
        if (focusLost && saved?.opener?.isConnected) saved.opener.focus();
      },
      { injector: this.injector },
    );
  }

  /**
   * Leave without restoring: used when the conversation itself changed, so
   * the saved scroll position and opener belong to the previous one.
   */
  private discardSubagent(): void {
    this.subagentReturn = null;
    this.subagentOwner = null;
    this._frozenOpenSubagent = null;
    this.openSubagentId.set(null);
  }

  /**
   * A turn's work-log open state for its bubbles: the user's choice, else
   * open while any message of the turn streams in `full` mode (§3.1, §3.8),
   * so every message of a streaming turn agrees with its disclosure row.
   * `null` leaves the bubble's own auto rule (closed once settled).
   */
  protected logOpenFor(turn: TurnContext | null): boolean | null {
    if (!turn) return null;
    return turnLogOpenOf(
      this.turnLogOpen().get(turn.turnId),
      this.viewMode(),
      this.streamingTurnIds().has(turn.turnId),
    );
  }

  /** Disclosure row of a turn toggled: record the user's choice (§3.1). */
  protected onLogToggled(toggle: TurnLogToggle): void {
    this.turnLogOpen.update((open) =>
      new Map(open).set(toggle.turnId, toggle.open),
    );
  }

  /**
   * An agent chip asked for its lane. Routed like the sub-agent tiles,
   * through `SESSION_CARD_ACTIONS`: a host that provides it (the Rail) wins,
   * otherwise `openSubagentLane` opens the agent in place. Resolved at click
   * time because this component provides the token itself.
   */
  protected onLaneRequested(key: string): void {
    this.injector.get(SESSION_CARD_ACTIONS).openLane(key);
  }

  private openSubagentLane(key: string): void {
    const lane = parseLaneKey(key);
    if (lane?.kind === 'cli') {
      // No surface here (see canOpenLaneHere): the UI offers no action.
      if (!this.canOpenLaneHere(key)) return;
      const agent = this.laneMonitor?.agents().find((item) =>
        item.agentId === lane.id && item.parentSessionId === this.sessionId());
      if (!agent) {
        this.subagentNotice.set(
          'This agent is not available in this conversation.',
        );
        return;
      }
      this.subagentNotice.set('');
      if (!agent.expanded) this.laneMonitor?.toggleAgentExpanded(lane.id);
      this.laneMonitor?.requestPanelOpen(this.sessionContext?.() ?? null);
      return;
    }
    const target =
      lane ? this.findSubagent(lane.id) : null;
    if (!lane || !target) {
      // Never route to another session: keep the transcript, say why.
      this.subagentNotice.set(
        'This agent is not available in this conversation.',
      );
      return;
    }
    this.subagentNotice.set('');
    if (this.openSubagentId() === null) {
      const el = this.scrollElement ?? this.scrollContainer()?.nativeElement;
      const active = this.document.activeElement;
      this.subagentReturn = {
        scrollTop: el?.scrollTop ?? this.savedScrollTop ?? 0,
        pinned: this.pinnedToBottom(),
        opener: active instanceof HTMLElement ? active : null,
      };
    }
    this.subagentOwner = { tabId: this.tabId(), sessionId: this.sessionId() };
    this._frozenOpenSubagent = target;
    this.openSubagentId.set(lane.id);
  }

  /**
   * Keeps the open agent tied to its conversation (codex-review-R9n finding
   * 2). A tab or session switch drops it without restoring the previous
   * conversation's scroll; an agent gone from an active, unchanged
   * conversation closes like Back and is announced. A hidden transcript keeps
   * its frozen view and re-checks on reactivation.
   */
  private syncOpenSubagent(
    tabId: string,
    sessionId: string | null,
    resolved: OpenSubagent | null,
  ): void {
    const owner = this.subagentOwner;
    if (this.openSubagentId() === null || !owner) return;
    const switched =
      owner.tabId !== tabId ||
      (owner.sessionId !== null && owner.sessionId !== sessionId);
    if (switched) {
      this.discardSubagent();
      return;
    }
    owner.sessionId = sessionId;
    if (resolved === null && this.workActive()) {
      this.subagentNotice.set(
        'This agent is no longer available in this conversation.',
      );
      this.closeSubagent();
    }
  }

  /** Newest message first: an opened agent is usually in a recent turn. */
  private findSubagent(toolCallId: string): OpenSubagent | null {
    const view = this.vm();
    for (let index = view.slots.length - 1; index >= 0; index -= 1) {
      const node = findAgentNode(
        view.slots[index].record().streamingState,
        toolCallId,
      );
      if (node) return { node, streaming: index >= view.streamingBoundary };
    }
    if (this.turnAgentKeys().size === 0) return null;
    for (const keys of this.turnAgentKeys().values()) {
      for (const key of keys) {
        const lane = parseLaneKey(key);
        if (lane?.kind !== 'subagent') continue;
        for (const root of this.subagentExecutions.treeFor(lane.id)) {
          const node = findAgentNode(root, toolCallId);
          if (node) return { node, streaming: node.status === 'streaming' };
        }
      }
    }
    return null;
  }

  /** The last failed action per card (by turn), shown inline under it. */
  private readonly changeSetErrors = signal<ReadonlyMap<string, string>>(
    new Map(),
  );

  protected changeSetKey(changeSet: TurnChangeSet): string {
    return `${changeSet.turnStartedAt}:${changeSet.turnEndedAt}`;
  }

  protected changeSetMarks(changeSet: TurnChangeSet): ChangeSetMarks {
    return this.changeSetStore.marksFor(changeSet);
  }

  protected changeSetError(changeSet: TurnChangeSet): string | null {
    return this.changeSetErrors().get(this.changeSetKey(changeSet)) ?? null;
  }

  protected onChangeSetReview(changeSet: TurnChangeSet): void {
    void this.runChangeSetAction(changeSet, () =>
      this.changeSetActions.review(changeSet),
    );
  }

  protected onChangeSetOpenFile(changeSet: TurnChangeSet, path: string): void {
    void this.runChangeSetAction(changeSet, () =>
      this.changeSetActions.openFile(changeSet, path),
    );
  }

  protected onChangeSetOpenScm(changeSet: TurnChangeSet): void {
    void this.runChangeSetAction(changeSet, () =>
      this.changeSetActions.openScm(),
    );
  }

  /**
   * The actions service rejects with a user-facing `Error` by contract, so its
   * message is shown as-is; anything else gets a generic line.
   */
  private async runChangeSetAction(
    changeSet: TurnChangeSet,
    action: () => Promise<void>,
  ): Promise<void> {
    const key = this.changeSetKey(changeSet);
    this.setChangeSetError(key, null);
    try {
      await action();
    } catch (error: unknown) {
      this.setChangeSetError(
        key,
        error instanceof Error && error.message
          ? error.message
          : 'The review action failed.',
      );
    }
  }

  private setChangeSetError(key: string, message: string | null): void {
    this.changeSetErrors.update((current) => {
      if (message === null && !current.has(key)) return current;
      const next = new Map(current);
      if (message === null) next.delete(key);
      else next.set(key, message);
      return next;
    });
  }

  constructor() {
    effect(() => {
      const entering = this.entering();
      untracked(() => {
        if (entering && this.workActive() && this.pinnedToBottom()) {
          const el = this.scrollContainer()?.nativeElement;
          if (el) {
            this.lastScrollTop = 0;
            el.scrollTop = 0;
          }
          this.restoreScrollOnActivation();
        }
      });
    });
    effect(() => {
      if (!this.presentationStore || !this.workActive()) return;
      const tab = this._tab();
      if (tab) this.presentationStore.sync(tab);
    });

    // The store loads the ACTIVE tab's change sets itself; a canvas tile or a
    // background tab renders another session, so a visible transcript asks
    // for its own. A load already in flight is joined, not repeated.
    effect(() => {
      const sessionId = this.workActive() ? this.sessionId() : null;
      if (sessionId) {
        untracked(() => void this.changeSetStore.ensureLoaded(sessionId));
      }
    });
    // An open sub-agent follows its conversation: see `syncOpenSubagent`.
    effect(() => {
      const tabId = this.tabId();
      const sessionId = this.sessionId();
      const resolved = this.openSubagent();
      untracked(() => this.syncOpenSubagent(tabId, sessionId, resolved));
    });
    // The replayer clears its flag before SessionLoaderService's await
    // continuation marks the tab loaded. Hold the falling edge locally so a
    // zoneless change-detection pass cannot expose motion in that gap; the
    // normal streaming→idle transition then takes over.
    effect(() => {
      const historyReplaying = this.historyReplaying();
      untracked(() => {
        if (historyReplaying) {
          this.wasHistoryReplaying = true;
          this.clearReplayMotionHold();
          return;
        }
        if (!this.wasHistoryReplaying) return;
        this.wasHistoryReplaying = false;
        this.clearReplayMotionHold();
        this.replayMotionHold.set(true);
        this.replayMotionHoldTimeoutId = setTimeout(() => {
          this.replayMotionHold.set(false);
          this.replayMotionHoldTimeoutId = null;
        }, 300);
      });
    });
    effect(() => {
      const isActive = this.workActive();
      untracked(() => {
        if (isActive && !this.wasActive) {
          if (this.entering() && this.pinnedToBottom()) {
            const el = this.scrollContainer()?.nativeElement;
            if (el) {
              this.lastScrollTop = 0;
              el.scrollTop = 0;
            }
          }
          this.restoreScrollOnActivation();
          this.setupResizeObserver();
        } else if (!isActive) {
          this.cancelScrollFrame();
          this.resizeObserver?.disconnect();
          this.resizeObserver = null;
          this.cancelReplayRetentionRelease();
        }
        this.wasActive = isActive;
      });
    });
    effect(() => {
      const messages = this.vm().messages;
      const count = messages.length;
      untracked(() => {
        const last = messages[count - 1];
        const isNewUserMessage =
          count > this.lastMessageCount && last?.role === 'user';
        this.lastMessageCount = count;
        if (isNewUserMessage) {
          this.pinnedToBottom.set(true);
        }
        if (this.pinnedToBottom()) {
          this.scheduleStickToBottom();
        }
      });
    });
    effect(() => {
      const isStreaming = this.vm().isStreaming;
      untracked(() => {
        if (this.wasStreaming && !isStreaming) {
          this.isFinalizingTransition.set(true);
          if (this.pinnedToBottom()) {
            this.scheduleStickToBottom();
          }
          if (this.finalizingTimeoutId) {
            clearTimeout(this.finalizingTimeoutId);
          }
          this.finalizingTimeoutId = setTimeout(() => {
            this.isFinalizingTransition.set(false);
            this.finalizingTimeoutId = null;
            if (this.pinnedToBottom()) {
              this.scheduleStickToBottom();
            }
          }, 300);
        }
        this.wasStreaming = isStreaming;
      });
    });
    // Read replay raw across hides; vm/active keep hidden content work gated.
    effect(() => {
      const historyReplaying = this.historyReplaying();
      const view = this.vm();
      const isActive = this.workActive();
      untracked(() => {
        if (historyReplaying && !this.wasRenderWindowReplaying) {
          this.cancelReplayRetentionRelease();
          this.retentionReleasePending = false;
          this.renderWindow.setReplayRetention(true);
        } else if (!historyReplaying && this.wasRenderWindowReplaying) {
          this.retentionReleasePending = true;
        }
        if (isActive && this.retentionReleasePending)
          this.scheduleReplayRetentionRelease();
        this.wasRenderWindowReplaying = historyReplaying;
        this.renderWindow.setActive(isActive);
        this.renderWindow.syncMessages(
          view.slots.map((slot) => slot.id),
          view.streamingBoundary,
        );
      });
    });
    // Focus-driven render margin: an unfocused tile's window shrinks (fewer
    // mounted bubbles); refocus re-creates the observer with the wide margin.
    effect(() => {
      const focused = this._sessionFocused ? this._sessionFocused() : true;
      untracked(() => this.renderWindow.setFocused(focused));
    });
    afterNextRender(
      () => {
        // Attach the render window before binding scroll and resize observers.
        this.renderWindow.attach(this.scrollContainer()?.nativeElement ?? null);
        this.setupScrollListener();
        this.setupResizeObserver();
      },
      { injector: this.injector },
    );
    this.destroyRef.onDestroy(() => {
      this.cleanup();
    });
  }

  /**
   * Handle viewport scroll events and cache the offset per tab. Runs OUTSIDE
   * the zone (see `setupScrollListener`): it only rAF-scrolls and writes the
   * `pinnedToBottom` SIGNAL — whose writes refresh the prepend-anchor's
   * `[pinnedToBottom]` binding without a zone tick — plus plain fields no
   * binding reads.
   *
   * Any upward move that leaves the bottom unpins at once — one wheel tick is
   * enough, and a pending stick-to-bottom is dropped. Moving back within
   * NEAR_BOTTOM_PX re-pins.
   */
  onScroll(): void {
    if (!this.workActive()) return;
    const el = this.scrollElement;
    if (!el) return;
    const restorePending = this.scrollRestoreRef !== null;

    const top = el.scrollTop;
    const distanceFromBottom = el.scrollHeight - top - el.clientHeight;
    const movedUp = top < this.lastScrollTop - 1;
    this.lastScrollTop = top;
    this.savedScrollTop = top;

    if (movedUp && distanceFromBottom > 1) {
      this.pinnedToBottom.set(false);
      this.cancelScrollFrame();
      return;
    }
    if (distanceFromBottom < this.NEAR_BOTTOM_PX) {
      this.pinnedToBottom.set(true);
    }
    if (restorePending) {
      this.cancelScrollFrame();
      if (this.pinnedToBottom()) this.scheduleStickToBottom();
    }
  }

  /** Bind a passive scroll listener outside the zone. */
  private setupScrollListener(): void {
    const el = this.scrollContainer()?.nativeElement;
    if (!el || this.scrollElement) return;
    this.scrollElement = el;
    this.ngZone.runOutsideAngular(() => {
      el.addEventListener('scroll', this.scrollHandler, { passive: true });
    });
  }
  /** Current pin state; reads the signal so the binding stays reactive. */
  protected isPinnedToBottom(): boolean {
    return this.pinnedToBottom();
  }
  /** Coalesce pinned follow work into a frame and re-check the pin there. */
  private scheduleStickToBottom(): void {
    if (!this.workActive()) return;
    if (this.scrollRestoreRef) return;
    this.cancelScrollFrame();
    const generation = this.scrollGeneration;
    this.scrollRafId = requestAnimationFrame(() => {
      if (generation !== this.scrollGeneration || !this.workActive()) return;
      this.scrollRafId = null;
      const el = this.scrollContainer()?.nativeElement;
      if (!el || !this.pinnedToBottom()) return;
      const bottom = el.scrollHeight - el.clientHeight;
      if (el.scrollTop < bottom) {
        el.scrollTop = el.scrollHeight;
      }
    });
  }

  /** Restore the saved offset, or bottom when pinned or first shown. */
  private restoreScrollOnActivation(): void {
    if (!this.workActive()) return;
    this.cancelScrollFrame();
    const generation = this.scrollGeneration;
    this.scrollRestoreRef = afterNextRender(
      {
        write: () => {
          if (generation !== this.scrollGeneration) return;
          this.scrollRestoreRef = null;
          if (!this.workActive()) return;
          const el = this.scrollContainer()?.nativeElement;
          if (!el) return;
          if (this.pinnedToBottom() || this.savedScrollTop === null) {
            el.scrollTop = el.scrollHeight;
          } else {
            el.scrollTop = this.savedScrollTop;
          }
          this.lastScrollTop = el.scrollTop;
        },
      },
      { injector: this.injector },
    );
  }

  /**
   * Observe the content wrapper's height. Fires on real size changes only
   * (streaming growth, agent output, image load, finalize swap), so a pinned
   * transcript follows the stream without any per-frame re-measure loop.
   */
  private setupResizeObserver(): void {
    if (!this.workActive() || typeof ResizeObserver === 'undefined') return;
    const wrapper = this.contentWrapper()?.nativeElement;
    if (!wrapper || this.resizeObserver) return;

    const observer = new ResizeObserver((entries) => {
      if (!this.workActive() || this.resizeObserver !== observer) return;
      const height = entries[0]?.contentRect.height ?? 0;
      if (Math.abs(height - this.lastContentHeight) < 1) return;
      this.lastContentHeight = height;
      if (this.pinnedToBottom()) {
        this.scheduleStickToBottom();
      }
    });
    this.resizeObserver = observer;
    observer.observe(wrapper);
  }

  private cancelScrollFrame(): void {
    this.scrollGeneration++;
    if (this.scrollRafId !== null) cancelAnimationFrame(this.scrollRafId);
    this.scrollRafId = null;
    this.scrollRestoreRef?.destroy();
    this.scrollRestoreRef = null;
  }

  /** Cleanup observer, animation frames, and timeouts on destroy. */
  private cleanup(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.scrollElement) {
      this.scrollElement.removeEventListener('scroll', this.scrollHandler);
      this.scrollElement = null;
    }
    this.cancelScrollFrame();
    this.cancelReplayRetentionRelease();
    if (this.finalizingTimeoutId) {
      clearTimeout(this.finalizingTimeoutId);
      this.finalizingTimeoutId = null;
    }
    this.clearReplayMotionHold();
  }

  private scheduleReplayRetentionRelease(): void {
    if (!this.workActive() || this.retentionReleaseRafId !== null) return;
    this.cancelReplayRetentionRelease();
    const generation = this.retentionReleaseGeneration;
    const release = () => {
      if (!this.workActive() || generation !== this.retentionReleaseGeneration)
        return;
      this.retentionReleasePending = false;
      this.cancelReplayRetentionRelease();
      this.renderWindow.setReplayRetention(false);
    };
    this.retentionReleaseTimeoutId = window.setTimeout(release, 50);
    this.retentionReleaseRafId = requestAnimationFrame(release);
  }

  private cancelReplayRetentionRelease(): void {
    this.retentionReleaseGeneration++;
    if (this.retentionReleaseRafId !== null)
      cancelAnimationFrame(this.retentionReleaseRafId);
    this.retentionReleaseRafId = null;
    if (this.retentionReleaseTimeoutId !== null)
      clearTimeout(this.retentionReleaseTimeoutId);
    this.retentionReleaseTimeoutId = null;
  }

  private clearReplayMotionHold(): void {
    if (this.replayMotionHoldTimeoutId) {
      clearTimeout(this.replayMotionHoldTimeoutId);
      this.replayMotionHoldTimeoutId = null;
    }
    this.replayMotionHold.set(false);
  }
}
