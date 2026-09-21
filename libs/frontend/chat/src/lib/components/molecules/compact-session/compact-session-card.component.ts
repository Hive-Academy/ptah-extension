import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import {
  CompactSessionActivityComponent,
  summarizeFinalized,
  summarizeLive,
  type CompactActivityTier,
  type CompactSessionSummary,
  type CompactSummaryContext,
} from '@ptah-extension/chat-ui';
import {
  ConversationRegistry,
  TabManagerService,
  TabSessionBinding,
  workspaceLabelFromPath,
} from '@ptah-extension/chat-state';
import { PermissionHandlerService } from '@ptah-extension/chat-streaming';
import type { TabState } from '@ptah-extension/chat-types';
import {
  calculateSessionCostSummary,
  type AskUserQuestionRequest,
  type PermissionRequest,
} from '@ptah-extension/shared';

/** Smart orchestration for the summary-only compact session card. */
@Component({
  selector: 'ptah-compact-session-card',
  standalone: true,
  imports: [CompactSessionActivityComponent],
  host: {
    class: 'block h-full min-h-0 overflow-hidden',
    'data-ptah-file-links': '',
    '[attr.data-ptah-tab-id]': 'tab().id',
  },
  template: `
    <div
      class="h-full min-h-0 overflow-hidden border border-base-content/10 bg-base-200/30"
      data-testid="compact-session-card"
    >
      <ptah-compact-session-activity
        class="h-full"
        [summary]="summary()"
        [tier]="tier()"
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

  /** The card has one height tier for every non-compact-tall mode: 'compact'. */
  readonly tier = computed<CompactActivityTier>(() =>
    this.tab().viewMode === 'compact-tall' ? 'compact-tall' : 'compact',
  );

  private readonly routingRevision = computed(() =>
    this.permissionHandler.routingTargetRevision(),
  );

  private readonly tabLookup = computed(() =>
    this.tabManager.findTabByIdAcrossWorkspaces(this.tab().id),
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
  );

  readonly sessionPermissions = computed<readonly PermissionRequest[]>(() => {
    this.routingRevision();
    return this.permissionHandler
      .permissionRequests()
      .filter((request) => this.targetsTab(request, 'permission'));
  });

  private readonly compaction = computed(() => {
    const conversationId = this.sessionBinding.conversationFor(this.tab().id);
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

  private readonly messages = computed(() => this.tab().messages);

  private readonly calculatedMetrics = computed(() =>
    calculateSessionCostSummary([...this.messages()]),
  );

  private readonly metrics = computed(() => {
    const tab = this.tab();
    const calculated = this.calculatedMetrics();
    const tokens = tab.preloadedStats?.tokens ?? calculated.totalTokens;
    return {
      model: tab.liveModelStats?.model ?? tab.sessionModel ?? null,
      tokens:
        tokens.input +
        tokens.output +
        (tokens.cacheRead ?? 0) +
        (tokens.cacheCreation ?? 0),
      cost: tab.preloadedStats?.totalCost ?? calculated.totalCost,
      agentCount: calculated.agentCount,
      compactionCount: tab.compactionCount ?? 0,
    };
  });

  readonly summary = computed<CompactSessionSummary>(() => {
    const tab = this.tab();
    const context: CompactSummaryContext = {
      sessionIdentity: tab.claudeSessionId ?? tab.id,
      workspacePath: this.workspacePath(),
      workspaceLabel:
        workspaceLabelFromPath(this.workspacePath()) || 'Workspace',
      sessionStatus: tab.status,
      terminalReason: tab.lastTerminalReason,
      questions: this.sessionQuestions(),
      permissions: this.sessionPermissions(),
      compaction: this.compaction(),
      metrics: this.metrics(),
    };
    return tab.streamingState
      ? summarizeLive(tab.streamingState, context)
      : summarizeFinalized(tab.messages, context);
  });

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
          this.tab().id,
      );
    }
    if (!request.sessionId) return false;
    return (
      this.tabManager.findTabBySessionIdAcrossWorkspaces(request.sessionId)?.tab
        .id === this.tab().id
    );
  }
}
