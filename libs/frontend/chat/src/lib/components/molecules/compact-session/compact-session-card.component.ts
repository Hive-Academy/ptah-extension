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
  summarizeTodos,
  summarizeFinalized,
  summarizeLive,
  type CompactCallout,
  type CompactPermissionCallout,
  type CompactSessionSummary,
  type CompactSummaryContext,
  type CompactSummaryMetrics,
} from '@ptah-extension/chat-ui';
import { VSCodeService } from '@ptah-extension/core';
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
import type {
  AskUserQuestionRequest,
  PermissionRequest,
} from '@ptah-extension/shared';
import { AgentPermissionResponder } from '../../../services/agent-permission-responder';
import {
  SessionGitStatsStore,
  sessionWorkingRoot,
} from '../../../services/session-git-stats/session-git-stats.store';
import {
  SESSION_CARD_ACTIONS,
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

/** Smart orchestration for the summary-only compact session card. */
@Component({
  selector: 'ptah-compact-session-card',
  standalone: true,
  imports: [CompactSessionActivityComponent],
  host: {
    class: 'block h-full min-h-0 overflow-hidden',
    'data-ptah-file-links': '',
    '[attr.data-ptah-tab-id]': 'tabId()',
  },
  template: `
    <div
      class="h-full min-h-0 overflow-hidden border border-base-content/10 bg-base-200/30"
      data-testid="compact-session-card"
    >
      <ptah-compact-session-activity
        class="h-full"
        [summary]="summary()"
        [lanes]="laneSummary()"
        [callout]="callout()"
        [now]="now()"
        [branch]="branch()"
        [elapsed]="elapsed()"
        [contextPercent]="contextPercent()"
        [todos]="todos()"
        [gitStats]="gitStats()"
        (openFullView)="openFullView()"
        (allow)="respond($event, 'allow')"
        (deny)="respond($event, 'deny')"
        (answer)="openFullView()"
        (openRequest)="openRequest($event)"
        (showOutput)="openFullView()"
        (laneSelected)="openLane($event)"
      />
    </div>
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
  private readonly forcedCard = inject(SESSION_FORCED_CARD, { optional: true });

  readonly tab = input.required<TabState>();
  readonly expandToFull = output<void>();

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
  readonly now = signal(Date.now());
  readonly elapsed = computed(() => {
    const startedAt = this.tab().agentOrigin?.startedAt;
    return startedAt === undefined ? null : Math.max(0, this.now() - startedAt);
  });
  readonly contextPercent = computed(() =>
    this.tab().liveModelStats?.contextKnown
      ? (this.tab().liveModelStats?.contextPercent ?? null)
      : null,
  );
  private readonly sessionAgents = computed(() =>
    this.agentStore.agentsForSession(this.sessionIdentity()),
  );
  readonly laneSummary = computed(() =>
    buildLaneSummary(
      this.sessionAgents(),
      this.agentStore.sessionSubagentsForSession(this.sessionIdentity()),
      this.sessionIdentity(),
    ),
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
    () => summarizeTodos(this.messages(), this.sampledStreaming()),
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
  private elapsedTimer: ReturnType<typeof setInterval> | null = null;

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
  readonly gitStats = computed(() => this.gitStore.stateFor(this.gitRoot()));

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
    return live
      ? summarizeLive(live, context)
      : summarizeFinalized(this.messages(), context);
  });

  constructor() {
    effect((onCleanup) => {
      const root = this.gitRoot();
      const tabId = this.tabId();
      if (root) onCleanup(this.gitStore.track(root, tabId));
    });
    effect(() => this.sampleStream(this.tab()));
    effect(() => {
      if (this.streaming() || this.laneSummary().counts.running > 0) {
        if (this.elapsedTimer === null) {
          this.now.set(Date.now());
          this.elapsedTimer = setInterval(() => this.now.set(Date.now()), 1000);
        }
      } else {
        this.clearElapsedTimer();
      }
    });
    inject(DestroyRef).onDestroy(() => {
      this.cancelPendingSample();
      this.clearElapsedTimer();
    });
  }

  respond(callout: CompactPermissionCallout, decision: 'allow' | 'deny'): void {
    if (callout.source === 'session') {
      const request = this.sessionPermissions().find(
        (candidate) => candidate.id === callout.requestId,
      );
      if (request && callout.tabId) {
        this.responder.respondSession(request, decision, callout.tabId);
      }
    } else if (callout.agentId) {
      this.responder.respondLane(
        callout.agentId,
        callout.requestId,
        decision,
        decision === 'deny' ? 'User denied' : undefined,
      );
    }
  }

  openRequest(callout: CompactPermissionCallout): void {
    if (callout.source === 'cli' && callout.agentId) {
      this.openLane(laneKey('cli', callout.agentId));
    } else {
      this.openFullView();
    }
  }

  openLane(key: string): void {
    if (this.forcedCard?.()) {
      this.cardActions?.openLane(key);
    } else if (this.cardActions) {
      this.cardActions.openLane(key);
    } else {
      this.expandToFull.emit();
    }
  }

  openFullView(): void {
    if (this.forcedCard?.()) {
      this.cardActions?.openSession();
    } else {
      this.expandToFull.emit();
    }
  }

  private clearElapsedTimer(): void {
    if (this.elapsedTimer === null) return;
    clearInterval(this.elapsedTimer);
    this.elapsedTimer = null;
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
