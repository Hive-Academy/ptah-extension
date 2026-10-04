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
import { AlertTriangle, LucideAngularModule } from 'lucide-angular';
import { MessageBubbleComponent } from '../message-bubble.component';
import { ChatEmptyStateComponent } from '../../molecules/setup-plugins/chat-empty-state.component';
import { ExecutionTreeBuilderService } from '@ptah-extension/chat-streaming';
import { TabManagerService } from '@ptah-extension/chat-state';
import { SESSION_CONTEXT } from '../../../tokens/session-context.token';
import { SURFACE_ACTIVE, VSCodeService } from '@ptah-extension/core';
import {
  createExecutionChatMessage,
  buildTurnSourceSnapshot,
  ExecutionChatMessage,
} from '@ptah-extension/shared';
import type {
  ExecutionNode,
  TurnChangeSet,
  TurnSourceSnapshot,
} from '@ptah-extension/shared';
// Its own declaration from its own entry point: the compiler defers an import
// only when every symbol of the declaration is used inside `@defer` alone,
// and esbuild splits it out only when no eager code imports that file.
import { ChangeSetCardComponent } from '@ptah-extension/chat-ui/change-set-card';
import type { ChangeSetCardHost } from '@ptah-extension/chat-ui/change-set-card';
// Same lazy-entry contract as the change-set card above (see
// `libs/frontend/chat-ui/src/turn-recap.ts`).
import { TurnTestsRowComponent } from '@ptah-extension/chat-ui/turn-recap';
import { PtahUiLiveWindow } from '@ptah-extension/chat-ui';
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
import {
  anchorTurnTests,
  NO_TURN_TESTS_ANCHORS,
  type TurnTestsAnchors,
} from './transcript-turns';
import { filterCompactionNoise } from './transcript-filter.utils';
import { TranscriptOlderHistorySentinelDirective } from './transcript-older-history-sentinel.directive';
import { TranscriptPrependAnchorDirective } from './transcript-prepend-anchor.directive';
import { TranscriptRenderWindow } from './transcript-render-window';
import { TranscriptSlotDirective } from './transcript-slot.directive';

const EMPTY_STRING_SET: ReadonlySet<string> = new Set<string>();
const EMPTY_MESSAGES: readonly ExecutionChatMessage[] = [];
const EMPTY_TREES: readonly ExecutionNode[] = [];
const EMPTY_ORDER_KEYS: ReadonlyMap<string, number> = new Map<string, number>();
const NO_PTAH_UI_SNAPSHOTS: ReadonlyMap<string, TurnSourceSnapshot> = new Map<
  string,
  TurnSourceSnapshot
>();

/**
 * The still-open turn's snapshot: every source pending, exactly what
 * `buildTurnSourceSnapshot` returns for an unfinalized turn. One frozen object
 * so a growing turn's blocks keep one snapshot identity and do not re-run
 * their pipeline per streaming delta.
 */
const PENDING_TURN_SNAPSHOT: TurnSourceSnapshot = {
  state: 'pending',
  incomplete: false,
  diff: { kind: 'pending' },
  tests: { kind: 'pending' },
  usage: { kind: 'pending' },
};

/**
 * One transcript turn's assistant messages, with the array index of its last
 * (turn-ending) message. The same walk `groupTurns` performs
 * (`transcript-turns.ts`): a user message starts a turn, roles other than
 * `user`/`assistant` are skipped, and assistant messages before the first
 * user message belong to no turn. Kept in lockstep with it so a run here is a
 * turn there.
 */
interface AssistantRun {
  readonly assistants: readonly ExecutionChatMessage[];
  readonly endIndex: number;
}

/** The `groupTurns` walk, returning each turn's assistant messages. */
function assistantRuns(
  messages: readonly ExecutionChatMessage[],
): readonly AssistantRun[] {
  const runs: AssistantRun[] = [];
  let assistants: ExecutionChatMessage[] = [];
  let endIndex = -1;
  let started = false;

  const closeRun = (): void => {
    if (assistants.length === 0) return;
    runs.push({ assistants, endIndex });
    assistants = [];
    endIndex = -1;
  };

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === 'user') {
      closeRun();
      started = true;
    } else if (message.role === 'assistant' && started) {
      assistants.push(message);
      endIndex = index;
    }
  }
  closeRun();
  return runs;
}

/**
 * The change set covering one message — the `anchorInTurnWindow` window rule
 * (`transcript-change-set-anchors.ts:47-60`) generalised from "the last
 * assistant message in a change set's `(turnStartedAt, turnEndedAt]` window"
 * to "the change set whose window contains this message's order key" (plan
 * §4, decision 12). `changeSets` is oldest-first, as `changeSetsFor` returns,
 * so the newest covering window wins.
 */
function changeSetForMessage(
  message: ExecutionChatMessage,
  changeSets: readonly TurnChangeSet[],
): TurnChangeSet | null {
  const key = transcriptOrderKey(message);
  for (let index = changeSets.length - 1; index >= 0; index -= 1) {
    const changeSet = changeSets[index];
    if (changeSet.turnStartedAt < key && key <= changeSet.turnEndedAt) {
      return changeSet;
    }
  }
  return null;
}

/**
 * Fallback when no window covers the turn-ending message (a clock the two
 * sides do not share): the newest change set the existing anchor join places
 * after that same message — the same placement the card renders, skew
 * fallback included — so `$diff` and the card never disagree about a turn
 * the join already resolved.
 */
function anchoredChangeSetFor(
  anchors: ChangeSetAnchors,
  message: ExecutionChatMessage,
): TurnChangeSet | null {
  const anchored = anchors.get(message.id);
  if (anchored === undefined || anchored.length === 0) return null;
  return anchored[anchored.length - 1];
}

function sameAssistantList(
  left: readonly ExecutionChatMessage[],
  right: readonly ExecutionChatMessage[],
): boolean {
  return (
    left.length === right.length &&
    left.every((message, index) => message === right[index])
  );
}

/**
 * One turn's snapshot inputs and result, cached by the turn-ending message id
 * so an unchanged turn keeps its snapshot object identity across
 * recomputes — a new but equal object would re-run every live block's
 * pipeline for no source change.
 */
interface TurnSnapshotEntry {
  readonly changeSet: TurnChangeSet | null | 'pending';
  readonly assistants: readonly ExecutionChatMessage[];
  readonly snapshot: TurnSourceSnapshot;
}

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
  streamingBoundary: 0,
  streamingCount: 0,
  totalCount: 0,
  isStreaming: false,
  hasMessages: false,
  hasOlderHistory: false,
  isSessionActive: false,
};

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
    ChatEmptyStateComponent,
    TranscriptSlotDirective,
    TranscriptOlderHistorySentinelDirective,
    TranscriptPrependAnchorDirective,
    // Used only inside `@defer`, so the compiler loads it lazily.
    ChangeSetCardComponent,
    // Used only inside `@defer`, so the compiler loads it lazily.
    TurnTestsRowComponent,
  ],
  // `PtahUiLiveWindow` is per tab: one transcript per tab owns it, so each
  // tab caps its own live `ptah-ui` blocks (TASK_2026_610, decision 10).
  providers: [TranscriptRenderWindow, PtahUiLiveWindow],
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
  private readonly _sessionContext = inject(SESSION_CONTEXT, {
    optional: true,
  });
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

  /**
   * ResizeObserver on the content wrapper. Fires whenever the content's height
   * changes — streaming text growth, agent sub-output, markdown image load, or
   * the streaming→finalized swap — which is exactly when a pinned transcript
   * must re-stick to the bottom. Fires on real size change only, so it can't
   * storm.
   */
  private resizeObserver: ResizeObserver | null = null;
  private scrollRafId: number | null = null;
  private scrollGeneration = 0;
  private retentionReleasePending = false;
  private retentionReleaseGeneration = 0;
  private retentionReleaseRafId: number | null = null;
  private retentionReleaseTimeoutId: number | null = null;
  private lastContentHeight = 0;
  /** Distance from bottom (px) within which the user is considered "pinned". */
  private readonly NEAR_BOTTOM_PX = 120;

  /**
   * The plain scroll container (`#messageContainer`). Off-screen message
   * bubbles are unmounted by `TranscriptRenderWindow`, and native scroll
   * anchoring absorbs their height changes — scroll positions are the
   * element's real `scrollTop`/`scrollHeight`.
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
  /** Previous replay input value, used only to detect its falling edge. */
  private wasHistoryReplaying = false;
  private wasRenderWindowReplaying = false;

  /**
   * `scrollTop` seen by the previous scroll event. An upward move away from the
   * bottom is always the user: the stick-to-bottom only moves down, and a
   * clamp or an anchoring adjustment keeps the bottom distance unchanged. So no
   * scroll event is ever ignored — ignoring them is what let a pinned stream
   * yank the user back while they tried to scroll up.
   */
  private lastScrollTop = 0;

  /**
   * Saved scroll offset for THIS tab. Each instance owns exactly one tab, so the
   * per-tab cache Map collapses to a single field. Written eagerly on every
   * scroll (before the `display:none` hide can reset `scrollTop`) and restored
   * on the activation edge.
   */
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
        sessionId: this.sessionId() ?? undefined,
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
    const finalized = this.finalizedFiltered();
    const streaming = this.streamingMessages();
    const totalCount = finalized.length + streaming.length;
    const next: TranscriptViewModel = {
      messages: this.allMessages(),
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

  private _frozenTurnTestsAnchors: TurnTestsAnchors = NO_TURN_TESTS_ANCHORS;

  /**
   * Tests rows per message: each finalized turn's collected test runs render
   * after the turn's last assistant message (see `anchorTurnTests`), next to
   * the change-set card. Electron only [user scope] — the VS Code webview
   * computes nothing and renders no row. Gated like `vm`, so a hidden
   * transcript keeps its last placement and does no grouping work.
   */
  protected readonly turnTestsAnchors = computed<TurnTestsAnchors>(() => {
    if (!this.vscodeService.isElectron) return NO_TURN_TESTS_ANCHORS;
    const view = this.vm();
    if (!this.workActive()) return this._frozenTurnTestsAnchors;
    const next = anchorTurnTests(view.messages, view.streamingBoundary);
    this._frozenTurnTestsAnchors = next;
    return next;
  });

  private _frozenPtahUiSnapshots: ReadonlyMap<string, TurnSourceSnapshot> =
    NO_PTAH_UI_SNAPSHOTS;

  /** Per-turn snapshot cache, keyed by the turn-ending message id. */
  private readonly _turnSnapshotEntries = new Map<string, TurnSnapshotEntry>();

  /** Session the cache was built for; a different session's turns start fresh. */
  private _turnSnapshotSessionId: string | null = null;

  /**
   * Turn-source snapshots per message: every assistant message of a turn
   * maps to the turn's ONE snapshot (TASK_2026_610 PR C, component 4), built
   * with the turn's change set — `changeSetForMessage`'s window rule over the
   * session's sets, falling back to the existing anchor join's placement of
   * the same turn's card — the turn's assistant trees, and the turn-ENDING
   * message's tokens/cost/duration (`$usage`). The newest turn keeps `$diff`
   * `pending` until its late `git:turnChangeSet` push (A-6); an older turn
   * nothing covers is `unavailable`.
   *
   * Electron only [user scope] — the VS Code webview computes no map and every
   * bubble keeps the input's `null` default, which its `ptah-ui` context
   * (always `null` there) never reads. Frozen while the tab is hidden like
   * `vm`; each turn's snapshot keeps its object identity across recomputes,
   * so a source change (finalization, a late push) updates blocks in place
   * rather than remounting them (Req 3.2).
   */
  protected readonly ptahUiSnapshots = computed<
    ReadonlyMap<string, TurnSourceSnapshot>
  >(() => {
    if (!this.vscodeService.isElectron) return NO_PTAH_UI_SNAPSHOTS;
    const view = this.vm();
    if (!this.workActive()) return this._frozenPtahUiSnapshots;
    const sessionId = this.sessionId();
    if (sessionId !== this._turnSnapshotSessionId) {
      this._turnSnapshotEntries.clear();
      this._turnSnapshotSessionId = sessionId;
    }
    const changeSets = this.changeSetStore.changeSetsFor(sessionId);
    const anchors = this.changeSetAnchors();
    const runs = assistantRuns(view.messages);
    const snapshots = new Map<string, TurnSourceSnapshot>();
    for (let index = 0; index < runs.length; index += 1) {
      const run = runs[index];
      const endMessage = run.assistants[run.assistants.length - 1];
      const finalized = run.endIndex < view.streamingBoundary;
      const changeSet: TurnChangeSet | null | 'pending' = finalized
        ? (changeSetForMessage(endMessage, changeSets) ??
          anchoredChangeSetFor(anchors, endMessage) ??
          (index === runs.length - 1 ? 'pending' : null))
        : 'pending';
      const entry = this._turnSnapshotEntries.get(endMessage.id);
      const snapshot =
        entry !== undefined &&
        entry.changeSet === changeSet &&
        sameAssistantList(entry.assistants, run.assistants)
          ? entry.snapshot
          : this.buildTurnSnapshot(run, endMessage, changeSet, finalized);
      for (const assistant of run.assistants) {
        snapshots.set(assistant.id, snapshot);
      }
    }
    this._frozenPtahUiSnapshots = snapshots;
    return snapshots;
  });

  /**
   * Build (and cache) one turn's snapshot. An unfinalized turn gets the
   * shared {@link PENDING_TURN_SNAPSHOT} — its inputs churn per streaming
   * delta, so the constant is what keeps the blocks' inputs stable.
   */
  private buildTurnSnapshot(
    run: AssistantRun,
    endMessage: ExecutionChatMessage,
    changeSet: TurnChangeSet | null | 'pending',
    finalized: boolean,
  ): TurnSourceSnapshot {
    const snapshot = finalized
      ? buildTurnSourceSnapshot({
          turnMessages: run.assistants,
          blockMessage: endMessage,
          changeSet,
          finalized: true,
        })
      : PENDING_TURN_SNAPSHOT;
    this._turnSnapshotEntries.set(endMessage.id, {
      changeSet,
      assistants: run.assistants,
      snapshot,
    });
    return snapshot;
  }

  protected readonly changeSetHost = computed<ChangeSetCardHost>(() =>
    this.vscodeService.isElectron ? 'electron' : 'vscode',
  );

  protected readonly ChangeSetErrorIcon = AlertTriangle;

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

  protected trackByMessageId(
    _index: number,
    msg: ExecutionChatMessage,
  ): string {
    return msg.id;
  }

  constructor() {
    // The store loads the ACTIVE tab's change sets itself; a canvas tile or a
    // background tab renders another session, so a visible transcript asks
    // for its own. A load already in flight is joined, not repeated.
    effect(() => {
      const sessionId = this.workActive() ? this.sessionId() : null;
      if (sessionId) {
        untracked(() => void this.changeSetStore.ensureLoaded(sessionId));
      }
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
    // Activation edge (hidden→visible): restore the saved scroll offset, or
    // stick to bottom when pinned. `display:none` resets `scrollTop`, so the
    // restore runs on re-show via rAF (once the block layout is back).
    effect(() => {
      const isActive = this.workActive();
      untracked(() => {
        if (isActive && !this.wasActive) {
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
    // Content-follow controller. Reads the GATED `vm` so streaming into a hidden
    // transcript schedules no work; on activation `vm` catches up once and this
    // re-sticks a pinned transcript to the bottom.
    effect(() => {
      const messages = this.vm().messages;
      const count = messages.length;
      untracked(() => {
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
      const isStreaming = this.vm().isStreaming;
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
          view.messages.map((m) => m.id),
          view.streamingBoundary,
        );
      });
    });
    afterNextRender(
      () => {
        // Attach FIRST: an unattached render window mounts only its tail, and
        // that is indistinguishable from data loss. The resize observer only
        // costs a pinned transcript its auto-follow.
        this.renderWindow.attach(this.scrollContainer()?.nativeElement ?? null);
        this.setupResizeObserver();
      },
      { injector: this.injector },
    );
    this.destroyRef.onDestroy(() => {
      this.cleanup();
    });
  }

  /**
   * Handle viewport scroll events and cache the offset per tab. Any upward
   * move that leaves the bottom unpins at once — one wheel tick is enough, and
   * a pending stick-to-bottom is dropped. Moving back within NEAR_BOTTOM_PX
   * re-pins.
   */
  onScroll(_event: Event): void {
    if (!this.workActive()) return;
    const el = this.scrollContainer()?.nativeElement;
    if (!el) return;

    const top = el.scrollTop;
    const distanceFromBottom = el.scrollHeight - top - el.clientHeight;
    const movedUp = top < this.lastScrollTop - 1;
    this.lastScrollTop = top;
    this.savedScrollTop = top;

    if (movedUp && distanceFromBottom > 1) {
      this.pinnedToBottom = false;
      this.cancelScrollFrame();
      return;
    }
    if (distanceFromBottom < this.NEAR_BOTTOM_PX) {
      this.pinnedToBottom = true;
    }
  }
  /** Current pin state; read-only directive wiring. */
  protected isPinnedToBottom(): boolean {
    return this.pinnedToBottom;
  }
  /**
   * Stick the container to the bottom on the next frame. rAF-coalesced so a
   * burst of streaming chunks collapses to a single adjustment per frame.
   * Re-checks the pin inside the frame: scroll events run before rAF
   * callbacks, so a user who scrolled up in this frame is not pulled back.
   */
  private scheduleStickToBottom(): void {
    if (!this.workActive()) return;
    this.cancelScrollFrame();
    const generation = this.scrollGeneration;
    this.scrollRafId = requestAnimationFrame(() => {
      if (generation !== this.scrollGeneration || !this.workActive()) return;
      this.scrollRafId = null;
      const el = this.scrollContainer()?.nativeElement;
      if (!el || !this.pinnedToBottom) return;
      const bottom = el.scrollHeight - el.clientHeight;
      if (el.scrollTop < bottom) {
        el.scrollTop = el.scrollHeight;
      }
    });
  }

  /**
   * On the activation edge, restore the saved scroll offset — or stick to the
   * bottom when pinned (or when there is no saved offset yet, e.g. first show).
   */
  private restoreScrollOnActivation(): void {
    if (!this.workActive()) return;
    this.cancelScrollFrame();
    const generation = this.scrollGeneration;
    this.scrollRafId = requestAnimationFrame(() => {
      if (generation !== this.scrollGeneration || !this.workActive()) return;
      this.scrollRafId = null;
      const el = this.scrollContainer()?.nativeElement;
      if (!el) return;
      if (this.pinnedToBottom || this.savedScrollTop === null) {
        el.scrollTop = el.scrollHeight;
      } else {
        el.scrollTop = this.savedScrollTop;
      }
      this.lastScrollTop = el.scrollTop;
    });
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
      if (this.pinnedToBottom) {
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
  }

  /** Cleanup observer, animation frames, and timeouts on destroy. */
  private cleanup(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
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
