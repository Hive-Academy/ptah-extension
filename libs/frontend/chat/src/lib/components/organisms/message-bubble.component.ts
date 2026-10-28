import { SURFACE_ACTIVE } from '@ptah-extension/core';
import {
  Component,
  input,
  output,
  computed,
  signal,
  ChangeDetectionStrategy,
  inject,
} from '@angular/core';
import { MarkdownModule } from 'ngx-markdown';
import { SurfaceMarkdownPipe } from '@ptah-extension/markdown';
import {
  LucideAngularModule,
  Activity,
  FileText,
  Image,
  Folder,
  Paperclip,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Undo2,
  Users,
} from 'lucide-angular';
import {
  ExecutionNodeComponent,
  samePtahUiContext,
  type PtahUiNodeContext,
} from './execution/execution-node.component';
import { MermaidMessageTextComponent } from '@ptah-extension/chat-ui/mermaid';
import { hasMermaidFenceLine } from './execution/mermaid-fence-line';
import {
  TypingCursorComponent,
  StreamingQuotesComponent,
  CopyButtonComponent,
  formatAgentDuration,
} from '@ptah-extension/chat-ui';
import { formatUsdCost } from '@ptah-extension/shared';
import type {
  ExecutionChatMessage,
  PermissionRequest,
  PermissionResponse,
  TurnSourceSnapshot,
} from '@ptah-extension/shared';
import { VSCodeService } from '@ptah-extension/core';
import { ChatStore } from '../../services/chat.store';
import type { SessionAgent } from '../../services/session-agents/session-agent-roster';
import {
  splitTurnMessage,
  type TurnMessageSplit,
} from '../../utils/turn-answer-split.utils';
import {
  summarizeTurnMetrics,
  turnElapsedLabel,
  type TurnContext,
  type TurnElapsedLabel,
} from '../../utils/turn-facts.utils';
import { toUserMessageMarkdown } from '../../utils/user-message-markdown.utils';
import { TurnDisclosureRowComponent } from '../molecules/turn/turn-disclosure-row.component';
import { TurnActivityPanelComponent } from '../molecules/turn/turn-activity-panel.component';
import { TurnLiveLineComponent } from '../molecules/turn/turn-live-line.component';
import { TurnAgentChipsComponent } from '../molecules/turn/turn-agent-chips.component';

/** The disclosure toggle of a turn, emitted for the transcript's per-turn flag. */
export interface TurnLogToggle {
  readonly turnId: string;
  readonly open: boolean;
}

/**
 * True when the turn's activity panel would show at least one item, under
 * the panel's own rules (`TurnActivityPanelComponent`): the settled turn
 * duration, or any message's duration, tokens, priced cost, tool calls or
 * changed files. The `Show activity` button is hidden otherwise (§3.11).
 */
function turnHasActivityData(turn: TurnContext): boolean {
  const { startTs, settledEndTs } = turn;
  if (
    startTs !== null &&
    settledEndTs !== null &&
    formatAgentDuration(settledEndTs - startTs) !== null
  ) {
    return true;
  }
  return turn.messages.some(
    (m) =>
      m.duration !== undefined ||
      m.tokens !== undefined ||
      formatUsdCost(m.cost) !== null ||
      m.toolCount > 0 ||
      m.filesChanged > 0,
  );
}

/**
 * MessageBubbleComponent - one transcript message.
 *
 * Assistant messages render the clean turn (design-spec §3): disclosure row,
 * collapsible work log, answer, agent chips, action row (copy, `Show
 * activity`), activity panel and live line. Turn-level rows sit on the turn's
 * first (disclosure) or last (chips, actions, panel, live line) assistant
 * message; the transcript supplies the turn facts, the per-turn log flag,
 * the live clock, the needs-you count and the turn's agents. Every log and
 * answer row renders through the unchanged `ptah-execution-node`.
 *
 * User messages keep today's right-aligned bubble inside
 * `<article aria-label="You">`.
 */
@Component({
  selector: 'ptah-message-bubble',
  standalone: true,
  imports: [
    SurfaceMarkdownPipe,
    MarkdownModule,
    ExecutionNodeComponent,
    MermaidMessageTextComponent,
    TypingCursorComponent,
    StreamingQuotesComponent,
    CopyButtonComponent,
    TurnDisclosureRowComponent,
    TurnActivityPanelComponent,
    TurnLiveLineComponent,
    TurnAgentChipsComponent,
    LucideAngularModule,
  ],
  templateUrl: './message-bubble.component.html',
  // Two sheets, ONE stylesheet split in two — the combined rules exceeded the
  // 10 kB `anyComponentStyle` budget (TASK_2026_187 Unit 7). ORDER IS
  // LOAD-BEARING: `-prose` was physically the tail of the original file and
  // contains rules that intentionally override earlier ones by source order
  // (`.code-block-container pre` over `markdown pre`, the `markdown table`
  // `border-top`). Both keep `:host`/`::ng-deep` encapsulation, so the emitted
  // CSS is identical to the single-file version. Do not reorder or merge.
  styleUrls: [
    './message-bubble.component.css',
    './message-bubble-prose.component.css',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.is-streaming]': 'isStreaming()',
    '[attr.data-finalized]': '!isStreaming()',
  },
})
export class MessageBubbleComponent {
  protected readonly surfaceActive = inject(SURFACE_ACTIVE);

  /**
   * VS Code service for webview utilities
   */
  private readonly vscode = inject(VSCodeService);
  private readonly chatStore = inject(ChatStore);

  readonly message = input.required<ExecutionChatMessage>();
  /** Lane hosts route permissions to their owning session. Main chat keeps its store path. */
  readonly permissionLookup = input<
    ((id: string) => PermissionRequest | null) | undefined
  >();
  readonly permissionResponded = output<PermissionResponse>();
  /** Branch/rewind require main-session message IDs, which lane events do not have. */
  readonly userActions = input(true);
  /** Main transcript opts into compact agent tiles; other hosts stay inline. */
  readonly agentTileMode = input<boolean>(false);

  /** Indicates if this message is currently streaming */
  readonly isStreaming = input<boolean>(false);

  /**
   * True while the chat is in the streaming → finalized handoff window
   * (~300ms). Forwarded down to ExecutionNodeComponent so it can suppress
   * fade keyframes that would otherwise stack on top of the layout settle.
   */
  readonly isFinalizing = input<boolean>(false);

  /** Raw-message fallback has no execution node, but follows the same final-only rule. */
  protected readonly mermaidFallbackText = computed(() => {
    const text = this.message().rawContent || '';
    return !this.isStreaming() &&
      !this.isFinalizing() &&
      hasMermaidFenceLine(text)
      ? text
      : null;
  });

  /**
   * This assistant message's place in its turn (from the transcript's
   * `buildTurnContexts`). `null` for a user message and for a host that
   * renders a message on its own: it then shows as a single-message turn
   * without a disclosure row or `Show activity`.
   */
  readonly turn = input<TurnContext | null>(null);

  /** The tab's density preference (design-spec §3.8). */
  readonly viewMode = input<'full' | 'compact'>('full');

  /**
   * The user's open choice for this turn's work log; `null` until the user
   * toggles it, which leaves the auto rule (open only while streaming, in
   * `full` mode; §3.1, §3.8).
   */
  readonly logOpen = input<boolean | null>(null);

  /** The turn is streaming or an agent it owns is still running. */
  readonly turnLive = input<boolean>(false);

  /** The transcript's one live clock (Unix ms); a constant for settled turns. */
  readonly now = input<number>(0);

  /** The session's needs-you aggregate, fed to the live turn only. */
  readonly needsYouCount = input<number>(0);

  /** The roster entries of the agents this turn spawned, in dock order. */
  readonly agents = input<readonly SessionAgent[]>([]);

  /**
   * Whether the parent tab's session is currently active in the SDK
   * (has a live `Query` handle). When false, the rewind button is
   * disabled because backend `rewindFiles` would throw
   * `SessionNotActiveError` — see Sentry NODE-NESTJS-2Y / 2N / 2X.
   * Defaults to true so existing call sites that don't pass it (tests,
   * unrelated views) keep current behaviour.
   */
  readonly isSessionActive = input<boolean>(true);

  /**
   * Transcript order of this message for the tab's `ptah-ui` live window
   * (higher is newer). Supplied by the transcript; the default only ranks
   * blocks by registration order.
   */
  readonly ptahUiOrderKey = input<number>(0);

  /**
   * The turn's host data (TASK_2026_610 PR C): the transcript's per-turn
   * `TurnSourceSnapshot`, threaded into the `ptah-ui` context so the block's
   * `$diff`/`$tests`/`$usage` bindings resolve. `null` — the default, and
   * always in VS Code, where the transcript computes no map — resolves every
   * binding to `unavailable`.
   */
  readonly ptahUiSnapshot = input<TurnSourceSnapshot | null>(null);
  readonly ActivityIcon = Activity;
  readonly FileTextIcon = FileText;
  readonly ImageIcon = Image;
  readonly FolderIcon = Folder;
  readonly PaperclipIcon = Paperclip;
  readonly ChevronDownIcon = ChevronDown;
  readonly ChevronRightIcon = ChevronRight;
  readonly GitBranchIcon = GitBranch;
  readonly Undo2Icon = Undo2;
  readonly UsersIcon = Users;

  /**
   * Emits the user message UUID when the user clicks "Branch from here".
   * Wired in chat-view to fork the session at this message into a new tab.
   */
  readonly branchRequested = output<string>();

  /**
   * Emits the user message UUID when the user clicks "Rewind to here".
   * Wired in chat-view to dry-run + confirm + commit a file rewind.
   */
  readonly rewindRequested = output<string>();

  /** The user opened or closed this turn's work log (disclosure row). */
  readonly logToggled = output<TurnLogToggle>();

  /** An agent chip asked to open its lane; emits the `SessionAgent.key`. */
  readonly laneRequested = output<string>();

  /** Local, per bubble: the activity panel is closed by default (§3.11). */
  protected readonly activityOpen = signal(false);

  /** Without a turn the message stands alone, so it is its turn's last. */
  private readonly isLastOfTurn = computed(
    () => this.turn()?.isLastAssistant ?? true,
  );

  /**
   * Work log and answer of this message's tree (`splitTurnMessage`); `null`
   * without a tree (raw, system or error text), which renders as the answer.
   */
  protected readonly split = computed((): TurnMessageSplit | null => {
    const root = this.message().streamingState;
    if (!root) return null;
    return splitTurnMessage(root, {
      isLastAssistant: this.isLastOfTurn(),
      streaming: this.isStreaming(),
    });
  });

  /**
   * Id of the root's last child. A text child with a later sibling is
   * complete (`textClosed`), the rule of the root `'message'` case of
   * `ptah-execution-node`, which the log and answer rows replicate.
   */
  protected readonly lastChildId = computed((): string | null => {
    const children = this.message().streamingState?.children ?? [];
    return children.length > 0 ? children[children.length - 1].id : null;
  });

  protected readonly hasLog = computed(
    () => (this.split()?.log.length ?? 0) > 0,
  );

  /** `aria-controls` target of the disclosure row: the first message's log. */
  protected readonly logDomId = computed((): string | null => {
    const turn = this.turn();
    if (!turn) return null;
    return turn.isFirstAssistant
      ? `turn-log-${turn.turnId}`
      : `turn-log-${turn.turnId}-${turn.index}`;
  });

  /** `aria-controls` target of `Show activity`. */
  protected readonly panelId = computed(
    () => `turn-activity-${this.turn()?.turnId ?? this.message().id}`,
  );

  /** The user's per-turn choice, else open only while streaming in `full`. */
  protected readonly logExpanded = computed(
    () => this.logOpen() ?? (this.isStreaming() && this.viewMode() === 'full'),
  );

  /** Disclosure row: first message of a turn with any non-text row. */
  protected readonly disclosureLabel = computed((): TurnElapsedLabel | null => {
    const turn = this.turn();
    if (!turn || !turn.isFirstAssistant || !turn.hasActivity) return null;
    return turnElapsedLabel(turn, this.turnLive(), this.now());
  });

  /** Count meta of the disclosure row, summed over the turn (B-4). */
  protected readonly turnCounts = computed(() => {
    const turn = this.turn();
    if (!turn) return { tools: 0, files: 0 };
    const totals = summarizeTurnMetrics(turn);
    return { tools: totals.toolCount.value, files: totals.filesChanged.value };
  });

  /** Compact mode, live turn: the newest log row as a one-line peek (§3.8). */
  protected readonly disclosurePeek = computed((): string | null =>
    this.viewMode() === 'compact' && this.turnLive()
      ? (this.split()?.peek ?? null)
      : null,
  );

  /** Chips: last message of the turn, once it stops streaming (§3.1). */
  protected readonly showChips = computed(
    () =>
      this.isLastOfTurn() && this.agents().length > 0 && !this.isStreaming(),
  );

  /** Action row: last message of a settled turn (§3.6). */
  protected readonly showActions = computed(
    () => this.isLastOfTurn() && !this.turnLive() && !this.isStreaming(),
  );

  /** `Show activity` is hidden when every panel item is unknown (§3.11). */
  protected readonly canShowActivity = computed(() => {
    const turn = this.turn();
    return turn !== null && turnHasActivityData(turn);
  });

  /** Live line: last message of a live turn (§3.7). */
  protected readonly showLiveLine = computed(
    () => this.turn() !== null && this.isLastOfTurn() && this.turnLive(),
  );

  /** Streaming quotes (B-13): while streaming and the log has no row yet. */
  protected readonly showStreamingQuotes = computed(
    () => this.isStreaming() && !this.hasLog(),
  );

  /**
   * `ptah-ui` fence rendering context for the execution tree: built only for
   * an assistant message on Electron (the same `isElectron` source of truth
   * as `electronOnlySurface`). `null` in VS Code and for every other role, so
   * the tree renders fences as ordinary code blocks. Carries the turn's
   * source snapshot (PR C) for the block's `$diff`/`$tests`/`$usage` sources.
   */
  protected readonly ptahUiContext = computed(
    (): PtahUiNodeContext | null => {
      if (!this.vscode.isElectron) return null;
      const msg = this.message();
      if (msg.role !== 'assistant') return null;
      return {
        messageId: msg.id,
        orderKey: this.ptahUiOrderKey(),
        snapshot: this.ptahUiSnapshot(),
      };
    },
    { equal: samePtahUiContext },
  );

  /**
   * True for the user message the Claude SDK injects after `/compact`:
   *   "This session is being continued from a previous conversation …"
   * Rendered inside a collapsible wrapper that defaults to collapsed so the
   * multi-screen continuation summary doesn't dominate the scrollback.
   */
  readonly isCompactionContinuation = computed((): boolean => {
    const msg = this.message();
    if (msg.role !== 'user') return false;
    const raw = (msg.rawContent ?? '').trimStart();
    return raw.startsWith(
      'This session is being continued from a previous conversation',
    );
  });

  /** Collapse state for the compaction continuation user bubble. Defaults to collapsed. */
  readonly isContinuationCollapsed = signal(true);

  /**
   * User message display content with <system-reminder> tags stripped.
   * The backend wraps attachment instructions in <system-reminder> XML
   * so the frontend can hide them from the user bubble while keeping
   * them visible to the LLM. Matches the stripping pattern used in
   * CodeOutputComponent and ToolInputDisplayComponent. The rest is typed
   * text, so `toUserMessageMarkdown` keeps its tags, backslashes and line
   * breaks literal before it reaches the markdown renderer.
   */
  readonly userDisplayContent = computed(() => {
    const raw = this.message().rawContent || '';
    return toUserMessageMarkdown(
      raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim(),
    );
  });

  /**
   * The sender label for a turn injected by another session, or `null` when
   * this is an ordinary turn the person watching typed.
   *
   * `null` is returned ONLY when the field is absent. An empty or
   * whitespace-only label still renders the peer bubble, under the neutral
   * wording — an unnamed sender must never suppress the message or disguise it
   * as the user's own words. The neutral text matches the backend's
   * `NEUTRAL_PEER_LABEL` (`agent-sdk/src/lib/sdk-message-transformer.ts`),
   * restated here because a frontend lib may not import a backend one and the
   * constant does not live in `libs/shared`.
   */
  readonly inboundPeerLabel = computed((): string | null => {
    const peer = this.message().inboundPeer;
    if (!peer) return null;
    const trimmed = peer.label.trim();
    return trimmed.length > 0 ? trimmed : 'peer session';
  });

  /** Pre-computed image count label to avoid triple signal reads in template */
  readonly imageCountLabel = computed(() => {
    const count = this.message().imageCount;
    if (!count) return '';
    return `${count} ${count === 1 ? 'image' : 'images'}`;
  });

  /**
   * Permission lookup function to pass to execution tree
   * Enables tool cards to check if they have pending permissions
   */
  protected getPermissionForTool = (
    toolCallId: string,
  ): PermissionRequest | null => {
    const lookup = this.permissionLookup();
    return lookup
      ? lookup(toolCallId)
      : this.chatStore.getPermissionForTool(toolCallId);
  };

  /**
   * Handle permission response from execution tree
   * Delegates to ChatStore for state management
   */
  protected onPermissionResponse(response: PermissionResponse): void {
    if (this.permissionLookup()) this.permissionResponded.emit(response);
    else this.chatStore.handlePermissionResponse(response);
  }

  /** Click handler for the "Branch from here" action on user bubbles. */
  protected onBranchClick(): void {
    this.branchRequested.emit(this.message().id);
  }

  /** Click handler for the "Rewind to here" action on user bubbles. */
  protected onRewindClick(): void {
    if (!this.isSessionActive()) return;
    this.rewindRequested.emit(this.message().id);
  }

  /** Disclosure row: report the requested open state for this turn. */
  protected onLogToggled(open: boolean): void {
    const turn = this.turn();
    if (turn) this.logToggled.emit({ turnId: turn.turnId, open });
  }

  /** `Show activity`: toggle the panel; focus stays on the button (§3.6). */
  protected toggleActivity(): void {
    this.activityOpen.update((open) => !open);
  }

  /** Toggle the collapsed state of the compaction-continuation user bubble. */
  protected toggleContinuationCollapse(): void {
    this.isContinuationCollapsed.update((v) => !v);
  }

  protected formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  protected formatDateTime(timestamp: number): string {
    return new Date(timestamp).toISOString();
  }

  /**
   * Extract file name from a full path
   */
  protected getFileName(filePath: string): string {
    const parts = filePath.split(/[/\\]/);
    return parts[parts.length - 1] || filePath;
  }

  /**
   * Determine the appropriate icon for a file based on its extension
   * Returns the icon reference for lucide-angular
   */
  protected getFileIcon(
    filePath: string,
  ): typeof FileText | typeof Image | typeof Folder {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const imageExts = [
      'jpg',
      'jpeg',
      'png',
      'gif',
      'svg',
      'webp',
      'bmp',
      'ico',
    ];
    const isDirectory =
      !filePath.includes('.') ||
      filePath.endsWith('/') ||
      filePath.endsWith('\\');

    if (isDirectory) return Folder;
    if (imageExts.includes(ext)) return Image;
    return FileText;
  }

  /**
   * Check if the file path represents a folder
   */
  protected isFolder(filePath: string): boolean {
    return (
      !filePath.includes('.') ||
      filePath.endsWith('/') ||
      filePath.endsWith('\\')
    );
  }
}
