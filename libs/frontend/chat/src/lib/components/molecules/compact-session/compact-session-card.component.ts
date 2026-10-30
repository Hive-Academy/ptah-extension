import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import {
  CompactSessionActivityComponent,
  CompactSessionStatsComponent,
  CompactRailCardComponent,
  summarizeTodos,
  sameGitState,
  summarizeFinalized,
  summarizeLive,
  sessionContextCue,
  type CompactCallout,
  type CompactPermissionCallout,
  type CompactPermissionDecision,
  type CompactLaneSummary,
  type CompactRailDensity,
  type CompactRailState,
  type CompactSessionSummary,
  type CompactSummaryContext,
  type CompactSummaryMetrics,
} from '@ptah-extension/chat-ui';
import { injectWallClock, VSCodeService } from '@ptah-extension/core';
import {
  ConversationRegistry,
  TabManagerService,
  TabSessionBinding,
  workspaceLabelFromPath,
} from '@ptah-extension/chat-state';
import {
  AgentMonitorStore,
  PermissionHandlerService,
} from '@ptah-extension/chat-streaming';
import type { StreamingState, TabState } from '@ptah-extension/chat-types';
import {
  contextFillPercent,
  trustedContextWindow,
  type AskUserQuestionRequest,
  type PermissionRequest,
} from '@ptah-extension/shared';
import { AgentPermissionResponder } from '../../../services/agent-permission-responder';
import {
  SessionGitStatsStore,
  sessionWorkingRoot,
} from '../../../services/session-git-stats/session-git-stats.store';
import {
  RAIL_TRANSCRIPT_RETENTION,
  SESSION_CARD_ACTIONS,
  SESSION_CONTEXT,
  SESSION_FORCED_CARD,
} from '../../../tokens/session-context.token';
import { buildLaneSummary, laneKey } from './compact-lane-rows';

/**
 * Minimum interval between two live-stream samples of a card summary. Stream
 * flushes arrive many times per second; the card re-summarises at most once
 * per interval. Questions, permissions, status, terminal reason, compaction
 * and the end of the stream bypass the sampler and render at once.
 */
export const CARD_SUMMARY_SAMPLE_MS = 500;

function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function sameMetrics(a: CompactSummaryMetrics, b: CompactSummaryMetrics) {
  return (
    a.model === b.model &&
    a.tokens === b.tokens &&
    a.cost === b.cost &&
    a.agentCount === b.agentCount &&
    a.compactionCount === b.compactionCount
  );
}

function sameLaneSummary(
  a: CompactLaneSummary,
  b: CompactLaneSummary,
): boolean {
  return (
    a.moreCount === b.moreCount &&
    a.total === b.total &&
    a.counts.waiting === b.counts.waiting &&
    a.counts.error === b.counts.error &&
    a.counts.running === b.counts.running &&
    a.counts.done === b.counts.done &&
    a.counts.stopped === b.counts.stopped &&
    a.kinds.cli === b.kinds.cli &&
    a.kinds.subagent === b.kinds.subagent &&
    a.kinds.background === b.kinds.background &&
    a.rows.length === b.rows.length &&
    a.rows.every((row, index) => {
      const other = b.rows[index];
      return (
        row.id === other.id &&
        row.name === other.name &&
        row.kind === other.kind &&
        row.status === other.status &&
        row.startedAt === other.startedAt &&
        row.endedAt === other.endedAt
      );
    })
  );
}

/** Smart orchestration for the summary-only compact session card. */
@Component({
  selector: 'ptah-compact-session-card',
  standalone: true,
  imports: [CompactSessionActivityComponent, CompactSessionStatsComponent, CompactRailCardComponent],
  host: {
    class: 'block h-full min-h-0 overflow-hidden',
    'data-ptah-file-links': '',
    '[attr.data-ptah-tab-id]': 'tabId()',
  },
  template: `
    @if (variant() === 'rail') {
      <ptah-compact-rail-card
        [title]="tab().title"
        [summary]="summary()"
        [lanes]="laneSummary()"
        [callout]="callout()"
        [branch]="branch()"
        [model]="summary().metrics.model"
        [elapsed]="railElapsed()"
        [contextPercent]="contextPercent()"
        [todos]="todos()"
        [gitStats]="gitStats()"
        [state]="railStateValue()"
        [density]="density()"
        [focused]="focused()"
        [innerTabbable]="focused()"
        [holdText]="holdText()"
        [reserveActionCorner]="reserveActionCorner()"
        (selectRequested)="openFullView()"
        (allow)="respond($event, 'allow')"
        (deny)="respond($event, 'deny')"
        (openRequest)="openRequest($event)"
        (answer)="answerQuestion($event)"
        (showOutput)="openFullView($event)"
        (laneSelected)="openLane($event)"
        (moreLanes)="requestLanes()"
      />
    } @else {
      <div
        class="flex h-full min-h-0 flex-col overflow-hidden border border-base-content/10 bg-base-100"
        data-testid="compact-session-card"
      >
        @if (!canvasHost || needsYouCount() > 0) {
        <div
          class="flex shrink-0 items-center justify-between gap-2 border-b border-base-content/10 px-3 py-2"
        >
          @if (!canvasHost) {
            <span class="min-w-0 truncate text-sm font-semibold text-base-content" data-testid="compact-session-title">{{ tab().title || 'New Chat' }}</span>
          }
          @if (needsYouCount() > 0) {
            <span class="shrink-0 text-xs font-semibold" style="color: var(--state-ink-need)">{{ needsYouCount() }} needs you</span>
          }
          @if (!canvasHost) {
            <button type="button" class="shrink-0 rounded px-2 py-1 text-xs text-base-content-muted hover:bg-base-200 hover:text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-base-content" (click)="openFullView()">Full view</button>
          }
        </div>
        }
        @if (tab().viewMode === 'compact' && activityLanes() === null && summary().marks.length === 0) {
          <div class="flex min-h-0 flex-1 flex-col justify-between" data-testid="compact-session-empty">
            <div class="px-3 py-3">
              <div class="text-xs font-semibold text-base-content">{{ summary().status.text }}</div>
              <p class="mt-2 text-sm text-base-content-muted">{{ summary().content.text }}</p>
            </div>
            <ptah-compact-session-stats [metrics]="summary().metrics" />
          </div>
        } @else {
          <ptah-compact-session-activity
            class="min-h-0 flex-1"
            [summary]="summary()"
            [lanes]="activityLanes()"
            [callout]="callout()"
            [now]="now()"
            [branch]="branch()"
            [elapsed]="elapsed()"
            [contextPercent]="contextPercent()"
            [todos]="todos()"
            [gitStats]="gitStats()"
            (openFullView)="openFullView()"
            (decide)="respond($event.callout, $event.decision, $event.reason)"
            (answer)="openFullView()"
            (openRequest)="openRequest($event)"
            (showOutput)="openFullView()"
            (laneSelected)="openLane($event)"
          />
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompactSessionCardComponent {
  private readonly tabManager = inject(TabManagerService);
  private readonly permissionHandler = inject(PermissionHandlerService);
  private readonly sessionBinding = inject(TabSessionBinding);
  private readonly conversations = inject(ConversationRegistry);
  private readonly agentStore = inject(AgentMonitorStore);
  private readonly responder = inject(AgentPermissionResponder);
  private readonly gitStore = inject(SessionGitStatsStore);
  private readonly vscode = inject(VSCodeService);
  private readonly cardActions = inject(SESSION_CARD_ACTIONS, {
    optional: true,
  });
  private readonly sessionContext = inject(SESSION_CONTEXT, { optional: true });
  private readonly forcedCard = inject(SESSION_FORCED_CARD, { optional: true });
  // Canvas is the only production binder of retainRailTranscript (canvas-detail-transcript.component.ts:29).
  // SESSION_EMBED_CHROME cannot replace it: Canvas focus gets 'full' like any embed, the Rail card none.
  protected readonly canvasHost = inject(RAIL_TRANSCRIPT_RETENTION, { optional: true }) === true;

  readonly tab = input.required<TabState>();
  readonly needsYouCount = input(0);
  readonly variant = input<'tile' | 'rail'>('tile');
  readonly density = input<CompactRailDensity>('comfortable');
  readonly focused = input(false);
  readonly holdText = input(false);
  /** Rail only: the host overlays its actions trigger on the card's top-right corner. */
  readonly reserveActionCorner = input(false);
  readonly expandToFull = output<void>();
  readonly railState = output<CompactRailState>();
  readonly staleAction = output<void>();
  readonly lanesRequested = output<void>();

  /**
   * Every stream flush hands the card a new `tab` object. Each part below
   * reads only the field it needs and compares by value, so a flush that
   * changes nothing but the stream does not re-run the summary.
   */
  protected readonly tabId = computed(() => this.tab().id);
  private readonly sessionStatus = computed(() => this.tab().status);
  private readonly terminalReason = computed(
    () => this.tab().lastTerminalReason,
  );
  private readonly sessionIdentity = computed(
    () => this.tab().claudeSessionId ?? this.tab().id,
  );
  readonly branch = computed(() => this.tab().agentOrigin?.branch ?? null);
  readonly now = injectWallClock(
    'second',
    () => this.streaming() || this.laneSummary().counts.running > 0,
  );
  private readonly mountedAt = Date.now();
  readonly elapsed = computed(() => {
    const startedAt = this.tab().agentOrigin?.startedAt;
    // The shared clock can be idle between mounts; retain the mount-time floor.
    return startedAt === undefined
      ? null
      : Math.max(0, Math.max(this.now(), this.mountedAt) - startedAt);
  });
  readonly railElapsed = computed(() => {
    const elapsed = this.elapsed();
    if (elapsed === null) return '—';
    const seconds = Math.floor(elapsed / 1000);
    return seconds < 60
      ? `${seconds}s`
      : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  });
  readonly contextPercent = computed(() => {
    const stats = this.tab().liveModelStats;
    if (!stats || !sessionContextCue(stats).known) return null;
    const window = trustedContextWindow(stats.contextCapacity, stats.model);
    return stats.contextWindow === window
      ? contextFillPercent(stats.contextUsed, window)
      : null;
  });
  private readonly sessionAgents = computed(() =>
    this.cardActions || this.sessionContext
      ? this.agentStore.agentsOwnedBySession(this.sessionIdentity())
      : this.agentStore.agentsForSession(this.sessionIdentity()),
  );
  readonly laneSummary = computed(
    () =>
      buildLaneSummary(
        this.sessionAgents(),
        [...this.agentStore.subagents().values()].filter(
          (agent) => agent.parentSessionId === this.sessionIdentity(),
        ),
        this.sessionIdentity(),
        3,
        Boolean(this.cardActions || this.sessionContext),
      ),
    { equal: sameLaneSummary },
  );
  /** An empty user-selected compact card uses the recap and recent activity layout. */
  readonly activityLanes = computed(() =>
    this.tab().viewMode === 'compact' &&
    !(this.forcedCard?.() ?? false) &&
    this.laneSummary().total === 0 &&
    !this.callout()
      ? null
      : this.laneSummary(),
  );
  readonly callout = computed<CompactCallout>(() => {
    const pending: {
      timestamp: number;
      callout: Exclude<CompactCallout, null>;
    }[] = [
      ...this.sessionPermissions().map((request) => ({
        timestamp: request.timestamp,
        callout: {
          kind: 'permission' as const,
          source: 'session' as const,
          requestId: request.id,
          tabId: this.tabId(),
          text: request.description || request.toolName,
        },
      })),
      ...this.sessionQuestions().map((request) => ({
        timestamp: request.timestamp,
        callout: {
          kind: 'question' as const,
          requestId: request.id,
          text:
            request.questions.map((item) => item.question).join('; ') ||
            'Question requires an answer',
        },
      })),
      ...this.agentStore
        .agentsOwnedBySession(this.sessionIdentity())
        .flatMap((agent) =>
          agent.permissionQueue.map((request) => ({
            timestamp: request.timestamp,
            callout: {
              kind: 'permission' as const,
              source: 'cli' as const,
              requestId: request.requestId,
              agentId: agent.agentId,
              tabId: null,
              text: request.description || request.toolName,
            },
          })),
        ),
    ];
    if (pending.length > 0) {
      // Permission wins a timestamp tie; otherwise show the oldest request.
      pending.sort(
        (a, b) =>
          a.timestamp - b.timestamp ||
          Number(b.callout.kind === 'permission') -
            Number(a.callout.kind === 'permission'),
      );
      return { ...pending[0].callout, moreCount: pending.length - 1 };
    }
    const reason = this.terminalReason();
    if (reason && this.summary().status.tone === 'error') {
      return {
        kind: 'error',
        requestId: `err:${this.tabId()}:${this.tab().terminalFailureSeq ?? 0}`,
        text: reason.replaceAll('_', ' '),
        canRetry: false,
      };
    }
    return null;
  });
  private readonly messages = computed(() => this.tab().messages);
  private readonly streaming = computed(
    () => this.tab().streamingState !== null,
  );

  /** Last sampled stream state; `null` once the stream has ended. */
  private readonly sampledStreaming = signal<StreamingState | null>(null);
  readonly todos = computed(
    () =>
      summarizeTodos(
        this.messages(),
        this.sampledStreaming(),
        this.tab().lastCompactionAt ?? 0,
      ),
    {
      equal: (a, b) =>
        a.kind === b.kind &&
        (a.kind !== 'known' ||
          (b.kind === 'known' &&
            a.done === b.done &&
            a.total === b.total &&
            a.active === b.active)),
    },
  );
  private sampledTabId: string | null = null;
  private lastSampleAt = 0;
  private pendingSample: ReturnType<typeof setTimeout> | null = null;

  private readonly routingRevision = computed(() =>
    this.permissionHandler.routingTargetRevision(),
  );

  private readonly tabLookup = computed(() =>
    this.tabManager.findTabByIdAcrossWorkspaces(this.tabId()),
  );
  readonly gitRoot = computed(() =>
    sessionWorkingRoot(
      this.tab(),
      this.tabLookup()?.workspacePath ?? null,
      this.vscode.config().workspaceRoot,
    ),
  );
  readonly gitStats = computed(() => this.gitStore.stateFor(this.gitRoot()), {
    equal: sameGitState,
  });

  private readonly workspacePath = computed(
    () => this.tabLookup()?.workspacePath ?? '',
  );

  readonly sessionQuestions = computed<readonly AskUserQuestionRequest[]>(
    () => {
      this.routingRevision();
      return this.permissionHandler
        .questionRequests()
        .filter((request) => this.targetsTab(request, 'question'));
    },
    { equal: sameItems },
  );

  readonly sessionPermissions = computed<readonly PermissionRequest[]>(
    () => {
      this.routingRevision();
      return this.permissionHandler
        .permissionRequests()
        .filter((request) => this.targetsTab(request, 'permission'));
    },
    { equal: sameItems },
  );

  private readonly compaction = computed(() => {
    const conversationId = this.sessionBinding.conversationFor(this.tabId());
    if (!conversationId) return null;
    const state = this.conversations.compactionStateFor(conversationId);
    const marker = this.conversations.compactionMarkerFor(conversationId);
    if (!state && !marker) return null;
    return {
      inFlight: state?.inFlight ?? false,
      summary: marker?.summary ?? null,
      preTokens: marker?.preTokens ?? state?.preTokens ?? null,
      postTokens: marker?.postTokens ?? null,
    };
  });

  /**
   * The same backend session snapshot the full stats panel shows
   * (TASK_2026_533). Missing figures stay unavailable: no message totals and
   * no execution-tree agent counting as a fallback.
   */
  private readonly metrics = computed<CompactSummaryMetrics>(
    () => {
      const tab = this.tab();
      const snapshot = tab.sessionStats ?? null;
      return {
        model: tab.liveModelStats?.model ?? tab.sessionModel ?? null,
        tokens: snapshot?.tokenCount ?? null,
        cost: snapshot?.totalCost ?? null,
        agentCount: snapshot?.agentSessionCount ?? 0,
        compactionCount: tab.compactionCount ?? 0,
      };
    },
    { equal: sameMetrics },
  );

  /** Everything except the stream; changes here render at once. */
  private readonly context = computed<CompactSummaryContext>(() => {
    const workspacePath = this.workspacePath();
    return {
      sessionIdentity: this.sessionIdentity(),
      workspacePath,
      workspaceLabel: workspaceLabelFromPath(workspacePath) || 'Workspace',
      sessionStatus: this.sessionStatus(),
      terminalReason: this.terminalReason(),
      questions: this.sessionQuestions(),
      permissions: this.sessionPermissions(),
      compaction: this.compaction(),
      metrics: this.metrics(),
    };
  });

  readonly summary = computed<CompactSessionSummary>(() => {
    const context = this.context();
    const live = this.streaming() ? this.sampledStreaming() : null;
    const summary = live
      ? summarizeLive(live, context)
      : summarizeFinalized(this.messages(), context);
    if (live || summary.status.text !== 'Idle') return summary;
    if (summary.status.text === 'Idle' && this.messages().length > 0) {
      return { ...summary, status: { ...summary.status, text: 'Done', icon: '✓', tone: 'success' } };
    }
    if (summary.status.text === 'Idle') {
      return { ...summary, status: { ...summary.status, text: 'Waiting' } };
    }
    return summary;
  });

  readonly railStateValue = computed<CompactRailState>(() => {
    const callout = this.callout();
    if (callout?.kind === 'permission' || callout?.kind === 'question')
      return 'needs';
    if (this.summary().status.tone === 'error') return 'error';
    if (
      this.sessionStatus() === 'streaming' ||
      this.sessionStatus() === 'resuming' ||
      this.laneSummary().counts.running > 0
    )
      return 'running';
    return this.messages().length > 0 ? 'done' : 'idle';
  });

  constructor() {
    effect((onCleanup) => {
      const root = this.gitRoot();
      const tabId = this.tabId();
      if (root) onCleanup(this.gitStore.track(root, tabId));
    });
    effect(() => this.sampleStream(this.tab()));
    effect(() => this.railState.emit(this.railStateValue()));
    inject(DestroyRef).onDestroy(() => {
      this.cancelPendingSample();
    });
  }

  respond(callout: CompactPermissionCallout, decision: CompactPermissionDecision['decision'], reason?: string): void {
    if (this.callout()?.requestId !== callout.requestId) {
      this.staleAction.emit();
      return;
    }
    if (callout.source === 'session') {
      const request = this.sessionPermissions().find(
        (candidate) => candidate.id === callout.requestId,
      );
      if (request && callout.tabId) {
        this.responder.respondSession(request, decision, callout.tabId, reason);
      } else {
        this.staleAction.emit();
      }
    } else if (callout.agentId) {
      // A lane accepts only allow and deny; any other decision means the callout is out of date.
      if (decision !== 'allow' && decision !== 'deny') {
        this.staleAction.emit();
        return;
      }
      const stillQueued = this.agentStore
        .agentsOwnedBySession(this.sessionIdentity())
        .some(
          (agent) =>
            agent.agentId === callout.agentId &&
            agent.permissionQueue.some(
              (request) => request.requestId === callout.requestId,
            ),
        );
      if (!stillQueued) {
        this.staleAction.emit();
        return;
      }
      this.responder.respondLane(
        callout.agentId,
        callout.requestId,
        decision,
        decision === 'deny' ? 'User denied' : undefined,
      );
    }
  }

  openRequest(callout: CompactPermissionCallout): void {
    if (this.callout()?.requestId !== callout.requestId) {
      this.staleAction.emit();
      return;
    }
    if (callout.source === 'cli' && callout.agentId) {
      this.openLane(laneKey('cli', callout.agentId));
    } else {
      this.openFullView();
    }
  }

  answerQuestion(shownId: string): void {
    const current = this.callout();
    if (current?.kind !== 'question' || current.requestId !== shownId) {
      this.staleAction.emit();
      return;
    }
    this.openLane('orchestrator');
  }

  requestLanes(): void {
    this.openFullView();
    this.lanesRequested.emit();
  }

  openLane(key: string, shownId?: string): void {
    if (shownId !== undefined && this.callout()?.requestId !== shownId) {
      this.staleAction.emit();
      return;
    }
    if (this.forcedCard?.()) {
      this.cardActions?.openLane(key);
    } else if (this.cardActions) {
      this.cardActions.openLane(key);
    } else {
      this.expandToFull.emit();
    }
  }

  openFullView(shownId?: string): void {
    if (shownId !== undefined && this.callout()?.requestId !== shownId) {
      this.staleAction.emit();
      return;
    }
    if (this.forcedCard?.()) {
      this.cardActions?.openSession();
    } else {
      this.expandToFull.emit();
    }
  }

  /**
   * One sampler per card. The end of a stream, a different tab and the first
   * event after a quiet interval are applied at once; flushes inside the
   * interval collapse into one trailing sample.
   */
  private sampleStream(tab: TabState): void {
    const state = tab.streamingState;
    if (state === null) {
      this.cancelPendingSample();
      this.lastSampleAt = 0;
      this.sampledTabId = tab.id;
      this.sampledStreaming.set(null);
      return;
    }
    const now = Date.now();
    if (
      this.sampledTabId !== tab.id ||
      now - this.lastSampleAt >= CARD_SUMMARY_SAMPLE_MS
    ) {
      this.cancelPendingSample();
      this.applySample(tab.id, state, now);
      return;
    }
    if (this.pendingSample !== null) return;
    this.pendingSample = setTimeout(
      () => {
        this.pendingSample = null;
        const latest = untracked(this.tab);
        if (latest.streamingState !== null) {
          this.applySample(latest.id, latest.streamingState, Date.now());
        }
      },
      this.lastSampleAt + CARD_SUMMARY_SAMPLE_MS - now,
    );
  }

  private applySample(tabId: string, state: StreamingState, now: number) {
    this.sampledTabId = tabId;
    this.lastSampleAt = now;
    this.sampledStreaming.set(state);
  }

  private cancelPendingSample(): void {
    if (this.pendingSample === null) return;
    clearTimeout(this.pendingSample);
    this.pendingSample = null;
  }

  private targetsTab(
    request: AskUserQuestionRequest | PermissionRequest,
    kind: 'question' | 'permission',
  ): boolean {
    const targetIds =
      kind === 'question'
        ? this.permissionHandler.questionTargetTabsFor(request.id)
        : this.permissionHandler.targetTabsFor(request.id);
    if (targetIds.length > 0) {
      return targetIds.some(
        (targetId) =>
          this.tabManager.findTabByIdAcrossWorkspaces(targetId)?.tab.id ===
          this.tabId(),
      );
    }
    if (!request.sessionId) return false;
    return (
      this.tabManager.findTabBySessionIdAcrossWorkspaces(request.sessionId)?.tab
        .id === this.tabId()
    );
  }
}
