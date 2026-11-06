import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  DestroyRef,
  ElementRef,
  viewChild,
} from '@angular/core';
import { LucideAngularModule, Moon, Square } from 'lucide-angular';
import { injectWallClock } from '@ptah-extension/core';
import {
  AgentMonitorStore,
  SubagentExecutionStore,
  type SubagentRecord,
} from '@ptah-extension/chat-streaming';
import { AgentLaneStatsComponent } from '@ptah-extension/chat-ui';
import { createExecutionNode } from '@ptah-extension/shared';
import type {
  PermissionRequest,
  PermissionResponse,
} from '@ptah-extension/shared';
import { ExecutionHeaderComponent } from '../../molecules/execution-header/execution-header.component';
import { LANE_COLUMN_CLASS } from '../../molecules/execution-header/lane-column';
import { LaneTranscriptComponent } from '../transcript/lane-transcript.component';
import { SessionAgentTrayService } from '../../../services/session-agents/session-agent-tray.service';
import type { TrayAgentContext } from '../../../services/session-agents/session-agent-tray';
import { summarizeExecutionNodes } from '../../../utils/message-summary.utils';
import { subagentProgressText } from '../../../utils/subagent-progress.utils';
import { subagentLaneStats } from '../../../utils/lane-stats.adapters';
import { SubagentLaneComposerComponent } from './subagent-lane-composer.component';
import { findScrollingAncestor } from '../../../utils/scroll-parent.utils';

/**
 * Each refresh re-reads the whole sidechain transcript over paged RPC, so the
 * interval trades freshness against reparsing a long transcript.
 */
const LIVE_HISTORY_REFRESH_MS = 5000;

@Component({
  selector: 'ptah-subagent-lane',
  standalone: true,
  imports: [
    LucideAngularModule,
    AgentLaneStatsComponent,
    ExecutionHeaderComponent,
    LaneTranscriptComponent,
    SubagentLaneComposerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Card mode keeps a bounded transcript; flat mode flows through its host scroller.
  host: {
    class: 'flex min-h-0 flex-col',
    '[class.!min-h-fit]': "presentation() === 'flat'",
  },
  template: `
    @if (presentation() === 'card') {
    <ptah-execution-header
      class="shrink-0"
      kind="subagent"
      [showStats]="showStats()"
      [live]="live()"
      [peek]="progress()"
      [toolCount]="headerToolCount()"
      [extraMeta]="meta()"
    >
      @if (showStats()) {
        <ptah-agent-lane-stats
          executionHeaderStats
          class="block min-w-0"
          [stats]="stats()"
        />
      }
      @if (context(); as ctx) {
        <div executionHeaderActions class="flex shrink-0 items-center gap-0.5">
          @if (ctx.entry.canBackground) {
            <button
              type="button"
              class="btn btn-ghost btn-xs btn-square"
              [attr.aria-label]="'Send ' + name() + ' to background'"
              [disabled]="backgroundPending()"
              (click)="onBackground(ctx)"
            >
              <lucide-angular
                [img]="MoonIcon"
                class="h-3 w-3"
                aria-hidden="true"
              />
            </button>
          }
          @if (ctx.entry.stoppable) {
            <button
              type="button"
              class="btn btn-ghost btn-xs btn-square"
              [attr.aria-label]="'Stop ' + name()"
              [disabled]="stopPending()"
              (click)="onStop(ctx)"
            >
              <lucide-angular
                [img]="SquareIcon"
                class="h-3 w-3 text-error"
                aria-hidden="true"
              />
            </button>
          }
        </div>
      }
    </ptah-execution-header>
    }
    @if (commandError(); as err) {
      <p
        role="alert"
        [class]="columnClass + ' shrink-0 py-1 text-xs text-error'"
        data-testid="subagent-command-error"
      >
        {{ err.message }}
      </p>
    }
    <div
      #laneBody
      [class]="presentation() === 'card' ? 'relative min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable_both-edges]' : 'relative flex-none'"
      data-testid="lane-scroll"
    >
      <div [class]="columnClass + ' space-y-2 pt-2'">
        @if (entry()?.truncated || entry()?.spilled) {
          <p class="text-xs text-base-content-muted">
            Earlier output trimmed
            <!-- A loaded history that is still truncated stays truncated — the
             same capped history comes back on every fetch — so the button
             must go away once the load settles (PR #751 review 4309313437). -->
            @if (
              entry()?.history !== 'loaded' && entry()?.history !== 'loading'
            ) {
              —
              <button
                type="button"
                class="btn btn-link btn-xs p-0"
                (click)="loadFullOutput()"
              >
                Load full output
              </button>
            }
          </p>
        }
        @if ((entry()?.clipped ?? 0) > 0) {
          <p class="text-xs text-base-content-muted">
            Some long outputs were shortened
          </p>
        }
        @if (entry()?.history === 'loading') {
          <p class="text-xs text-base-content-muted">Loading saved output</p>
        } @else if (entry()?.history === 'error') {
          <p class="text-xs text-error">
            Could not load saved output.
            <button
              type="button"
              class="btn btn-link btn-xs p-0"
              (click)="retryHistory()"
            >
              Retry
            </button>
          </p>
        } @else if (entry()?.history === 'unresolved') {
          <p class="text-xs text-base-content-muted">
            Saved output for this agent could not be linked.
            <button
              type="button"
              class="btn btn-link btn-xs p-0"
              (click)="retryHistory()"
            >
              Retry
            </button>
          </p>
        } @else if (entry()?.history === 'not-found') {
          <p class="text-xs text-base-content-muted">
            No saved output for this agent
          </p>
        }
      </div>
      <ptah-lane-transcript
        [laneId]="key()"
        [nodes]="messageNodes()"
        [events]="events()"
        [isStreaming]="live()"
        [getPermissionForTool]="getPermissionForTool()"
        (permissionResponded)="permissionResponded.emit($event)"
      />
      @if (nodes().length === 0) {
        <div [class]="columnClass">
          @if (
            !finishedSummary() &&
            (!entry() ||
              entry()?.history === 'idle' ||
              entry()?.history === 'loaded')
          ) {
            <p class="text-xs text-base-content-muted">
              {{ live() ? 'Starting agent' : 'No output recorded' }}
            </p>
          }
        </div>
      }
    </div>
    <ptah-subagent-lane-composer
      [class]="columnClass + ' shrink-0 pt-2 pb-2' + (presentation() === 'flat' ? ' mt-auto sticky bottom-0 z-10 bg-base-100' : '')"
      [record]="record()"
      [context]="context()"
      [sessionId]="sessionId()"
      [stopPending]="stopPending()"
      [backgroundPending]="backgroundPending()"
      (stopRequested)="onStop($event)"
      (backgroundRequested)="onBackground($event)"
    />
  `,
})
export class SubagentLaneComponent {
  readonly showStats = input(true);
  readonly presentation = input<'card' | 'flat'>('card');
  readonly record = input.required<SubagentRecord>();
  readonly sessionId = input<string | null>(null);
  readonly getPermissionForTool = input<
    ((toolCallId: string) => PermissionRequest | null) | undefined
  >();
  readonly permissionResponded = output<PermissionResponse>();

  protected readonly columnClass = LANE_COLUMN_CLASS;
  protected readonly tray = inject(SessionAgentTrayService);
  private readonly monitor = inject(AgentMonitorStore);
  private readonly store = inject(SubagentExecutionStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly laneBody = viewChild<ElementRef<HTMLDivElement>>('laneBody');
  private flatScroller: HTMLElement | null = null;
  private flatPinned = true;
  protected readonly MoonIcon = Moon;
  protected readonly SquareIcon = Square;
  protected readonly stopPending = signal(false);
  protected readonly backgroundPending = signal(false);
  protected readonly context = computed(
    () =>
      this.tray
        .contextsFor(this.sessionId())
        .get(this.record().parentToolUseId) ?? null,
  );
  protected readonly key = computed(() => this.record().parentToolUseId);
  protected readonly entry = computed(() => this.store.entryFor(this.key()));
  protected readonly nodes = computed(() => {
    this.store.revisionFor(this.key());
    return this.store.treeFor(this.record().parentToolUseId);
  });
  protected readonly events = computed(() => {
    this.store.revisionFor(this.key());
    return [...(this.entry()?.state?.events.values() ?? [])];
  });
  protected readonly name = computed(
    () =>
      this.record().teammateName ||
      this.record().agentType ||
      this.record().agentId ||
      'Sub-agent',
  );
  protected readonly live = computed(() =>
    ['running', 'pending', 'background'].includes(this.record().status),
  );
  protected readonly now = injectWallClock('second', () => this.live());
  protected readonly finishedSummary = computed(() =>
    this.nodes().length > 0 || this.live()
      ? null
      : (this.record().latestSummary ?? null),
  );
  protected readonly messageNodes = computed(() => {
    const summary = this.finishedSummary();
    return summary
      ? [
          createExecutionNode({
            id: `${this.key()}:summary`,
            type: 'text',
            status: 'complete',
            content: summary,
            startTime: this.record().completedAt ?? this.record().startedAt,
          }),
        ]
      : this.nodes();
  });
  protected readonly progress = computed(() =>
    subagentProgressText(this.record()),
  );
  /**
   * The transcript's message bubbles carry the per-turn tool and file counts,
   * so the header repeats none. When the tree has no tool node (no history
   * yet, or only text so far) no bubble shows a count, and the header keeps
   * the record's count.
   */
  protected readonly headerToolCount = computed(() =>
    summarizeExecutionNodes(this.nodes()).toolCount > 0
      ? 0
      : (this.record().toolUses ?? 0),
  );
  /** Tokens live in the stats bar; the header meta keeps the run mode only. */
  protected readonly meta = computed(() =>
    this.record().status === 'background' ? ['Background'] : [],
  );
  protected readonly stats = computed(() => {
    const record = this.record();
    // An idle shared clock holds its last tick, so a finished lane reads the
    // current time for its warm/cold cache state.
    return subagentLaneStats(record, this.live() ? this.now() : Date.now());
  });
  protected readonly commandError = computed(() => {
    const error = this.monitor.subagentRpcError();
    return error?.parentToolUseId === this.record().parentToolUseId
      ? error
      : null;
  });

  constructor() {
    afterNextRender(() => {
      if (this.presentation() !== 'flat') return;
      const body = this.laneBody()?.nativeElement;
      if (!body) return;
      const scroller = findScrollingAncestor(body);
      if (!scroller) return;
      this.flatScroller = scroller;
      const onScroll = (): void => {
        this.flatPinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 48;
      };
      scroller.addEventListener('scroll', onScroll, { passive: true });
      this.destroyRef.onDestroy(() => scroller.removeEventListener('scroll', onScroll));
      scroller.scrollTop = scroller.scrollHeight;
    });
    effect(() => {
      if (this.presentation() !== 'flat') return;
      this.messageNodes();
      this.events();
      requestAnimationFrame(() => {
        if (this.flatPinned && this.flatScroller)
          this.flatScroller.scrollTop = this.flatScroller.scrollHeight;
      });
    });
    effect((onCleanup) => {
      const key = this.key();
      this.store.retain(
        key,
        untracked(
          () => this.record().parentSessionId ?? this.sessionId() ?? undefined,
        ),
      );
      onCleanup(() => this.store.release(key));
    });
    effect(() => this.store.syncRecord(this.record()));
    effect(() => {
      const key = this.key();
      untracked(() => {
        // A lane reused for another agent must not carry its pending flags.
        this.stopPending.set(false);
        this.backgroundPending.set(false);
        void this.loadCacheInfo(key);
      });
    });
    effect(() => {
      const key = this.record().parentToolUseId;
      const entry = this.entry();
      if (entry && !entry.live && entry.history === 'idle')
        void this.store.ensureHistory(key);
    });
    // A running (often background) agent may stream only progress summaries,
    // so its tree is backfilled from the sidechain transcript while this lane
    // shows it. The store coalesces overlapping reads; the timer ends when
    // the agent stops or the lane is destroyed.
    effect((onCleanup) => {
      const key = this.key();
      if (!this.live()) return;
      untracked(() => void this.store.refreshLiveHistory(key));
      const timer = setInterval(
        () => void this.store.refreshLiveHistory(key),
        LIVE_HISTORY_REFRESH_MS,
      );
      onCleanup(() => clearInterval(timer));
    });
  }

  protected retryHistory(): void {
    void this.store.ensureHistory(this.record().parentToolUseId);
  }

  protected loadFullOutput(): void {
    void this.store.ensureHistory(this.record().parentToolUseId);
  }

  /** The prompt-cache TTL comes only from `chat:subagent-query`, once per key. */
  private async loadCacheInfo(key: string): Promise<void> {
    try {
      await this.monitor.loadSubagentCacheInfo(key);
    } catch (err: unknown) {
      // The store already reports an RPC failure result; a thrown transport
      // error lands here. Either way the cache chip stays hidden.
      console.warn(
        '[SubagentLane] cache info load failed:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  protected async onStop(ctx: TrayAgentContext): Promise<void> {
    if (this.stopPending() || !ctx.taskId || !ctx.sessionId) return;
    this.stopPending.set(true);
    try {
      await this.monitor.stopAgent(ctx.taskId, ctx.sessionId);
    } finally {
      this.stopPending.set(false);
    }
  }

  protected async onBackground(ctx: TrayAgentContext): Promise<void> {
    if (this.backgroundPending() || !ctx.sessionId) return;
    this.backgroundPending.set(true);
    try {
      await this.monitor.backgroundAgent(ctx.sessionId, ctx.entry.id);
    } finally {
      this.backgroundPending.set(false);
    }
  }
}
