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
  summarizeFinalized,
  summarizeLive,
  type CompactSessionSummary,
  type CompactSummaryContext,
  type CompactSummaryMetrics,
} from '@ptah-extension/chat-ui';
import {
  ConversationRegistry,
  TabManagerService,
  TabSessionBinding,
  workspaceLabelFromPath,
} from '@ptah-extension/chat-state';
import { PermissionHandlerService } from '@ptah-extension/chat-streaming';
import type { StreamingState, TabState } from '@ptah-extension/chat-types';
import type {
  AskUserQuestionRequest,
  PermissionRequest,
} from '@ptah-extension/shared';

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
        (openFullView)="expandToFull.emit()"
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
  private readonly messages = computed(() => this.tab().messages);
  private readonly streaming = computed(
    () => this.tab().streamingState !== null,
  );

  /** Last sampled stream state; `null` once the stream has ended. */
  private readonly sampledStreaming = signal<StreamingState | null>(null);
  private sampledTabId: string | null = null;
  private lastSampleAt = 0;
  private pendingSample: ReturnType<typeof setTimeout> | null = null;

  private readonly routingRevision = computed(() =>
    this.permissionHandler.routingTargetRevision(),
  );

  private readonly tabLookup = computed(() =>
    this.tabManager.findTabByIdAcrossWorkspaces(this.tabId()),
  );

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
    effect(() => this.sampleStream(this.tab()));
    inject(DestroyRef).onDestroy(() => this.cancelPendingSample());
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
    this.pendingSample = setTimeout(() => {
      this.pendingSample = null;
      const latest = untracked(this.tab);
      if (latest.streamingState !== null) {
        this.applySample(latest.id, latest.streamingState, Date.now());
      }
    }, this.lastSampleAt + CARD_SUMMARY_SAMPLE_MS - now);
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
