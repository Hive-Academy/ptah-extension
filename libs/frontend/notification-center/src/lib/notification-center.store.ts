import { computed, effect, inject, Injectable, signal } from '@angular/core';
import {
  TabManagerService,
  workspaceLabelFromPath,
  type TerminalTurnPulse,
  type TabLookupResult,
} from '@ptah-extension/chat-state';
import { PermissionHandlerService } from '@ptah-extension/chat-streaming';
import {
  NOTIFICATION_FOCUS_ROUTER,
  type NotificationFocusResult,
  type NotificationFocusTarget,
} from '@ptah-extension/core';
import { generateAgentColor } from '@ptah-extension/chat-ui';
import { assertNever } from '@ptah-extension/shared';
import type {
  AskUserQuestionRequest,
  PermissionRequest,
  SdkTerminalReason,
} from '@ptah-extension/shared';
import { NotificationSoundService } from './notification-sound.service';
import type {
  CompletionNotificationEntry,
  CompletionNotificationGroup,
  PendingNotificationEntry,
} from './notification-center.types';

const LEDGER_LIMIT = 75;
const BURST_MS = 350;

/**
 * Human-readable rendering of `SdkTerminalReason`, exhaustive over the SDK's
 * 19-member union. `assertNever` on the default branch turns a new SDK
 * member into a compile error instead of a silent "Failed" fallback
 * (TASK_2026_512).
 *
 * `phase` breaks the tie when the SDK gave no reason. `terminal_reason` is
 * optional on the result message — older producers and synthetic results omit
 * it — so a turn that a `StopFailure` hook already marked `failed` can still
 * settle with a null reason. Reading the reason alone would then caption a red
 * error row "Finished (unknown outcome)", which is the same class of defect
 * this task exists to fix, one field over.
 */
export function deriveOutcomeLabel(
  reason: SdkTerminalReason | null,
  phase: 'idle' | 'failed',
): string {
  if (reason === null) {
    return phase === 'failed' ? 'Failed' : 'Finished (unknown outcome)';
  }
  switch (reason) {
    case 'completed':
      return 'Finished';
    case 'max_turns':
      return 'Hit the turn limit';
    case 'budget_exhausted':
      return 'Out of budget';
    case 'blocking_limit':
    case 'rapid_refill_breaker':
      return 'Rate limited';
    case 'api_error':
    case 'model_error':
    case 'image_error':
      return 'Provider error';
    case 'prompt_too_long':
      return 'Prompt too long';
    case 'aborted_streaming':
    case 'aborted_tools':
      return 'Stopped';
    case 'stop_hook_prevented':
    case 'hook_stopped':
      return 'Stopped by a hook';
    case 'tool_deferred':
    case 'tool_deferred_unavailable':
      return 'Waiting on a tool';
    case 'background_requested':
      return 'Moved to the background';
    case 'malformed_tool_use_exhausted':
    case 'structured_output_retry_exhausted':
      return 'Gave up retrying';
    case 'turn_setup_failed':
      return 'Could not start';
    default:
      return assertNever(reason);
  }
}

@Injectable()
export class NotificationCenterStore {
  private readonly tabManager = inject(TabManagerService);
  private readonly permissionHandler = inject(PermissionHandlerService);
  private readonly focusRouter = inject(NOTIFICATION_FOCUS_ROUTER, {
    optional: true,
  });
  private readonly sound = inject(NotificationSoundService);
  private readonly _completionEntries = signal<CompletionNotificationEntry[]>(
    [],
  );
  private readonly _announcement = signal('');
  private knownPromptIds = new Set<string>();
  private burstTimer: ReturnType<typeof setTimeout> | null = null;
  private burstCompletionCount = 0;
  private burstAttentionCount = 0;

  readonly completionEntries = this._completionEntries.asReadonly();
  readonly announcement = this._announcement.asReadonly();

  readonly pendingEntries = computed<readonly PendingNotificationEntry[]>(
    () => {
      this.permissionHandler.routingTargetRevision();
      const questions = this.permissionHandler
        .questionRequests()
        .flatMap((request) => this.projectQuestion(request));
      const permissions = this.permissionHandler
        .permissionRequests()
        .flatMap((request) => this.projectPermission(request));
      return [...questions, ...permissions];
    },
  );

  readonly unreadCount = computed(() => {
    const pendingSourceCount = new Set(
      this.pendingEntries().map((entry) => entry.sourceId),
    ).size;
    return (
      pendingSourceCount +
      this._completionEntries().filter(
        (entry) => entry.readAt === null && !entry.dismissed,
      ).length
    );
  });

  readonly completionGroups = computed<readonly CompletionNotificationGroup[]>(
    () => this.groupCompletions(this._completionEntries()),
  );

  constructor() {
    effect(() => {
      if (this.tabManager.terminalTurnPulses().length === 0) return;
      for (const pulse of this.tabManager.takeTerminalTurnPulses()) {
        if (this.appendCompletion(pulse)) {
          this.queueBurst(1, pulse.classification === 'error' ? 1 : 0);
        }
      }
    });
    effect(() => {
      const pending = this.pendingEntries();
      const currentIds = new Set(
        pending
          .filter((entry) => entry.target !== null)
          .map((entry) => entry.sourceId),
      );
      let newCount = 0;
      for (const id of currentIds) {
        if (!this.knownPromptIds.has(id)) newCount += 1;
      }
      this.knownPromptIds = currentIds;
      if (newCount > 0) this.queueBurst(0, newCount);
    });
  }

  markAllRead(now = Date.now()): void {
    this._completionEntries.update((entries) =>
      entries.map((entry) =>
        entry.readAt === null ? { ...entry, readAt: now } : entry,
      ),
    );
  }

  dismissCompletion(id: string): void {
    this._completionEntries.update((entries) =>
      entries.map((entry) =>
        entry.id === id ? { ...entry, dismissed: true } : entry,
      ),
    );
  }

  async activateCompletion(
    entry: CompletionNotificationEntry,
  ): Promise<NotificationFocusResult> {
    const result = await this.focus(entry.target);
    if (result.success) {
      this._completionEntries.update((entries) =>
        entries.map((candidate) =>
          candidate.id === entry.id && candidate.readAt === null
            ? { ...candidate, readAt: Date.now() }
            : candidate,
        ),
      );
    }
    return result;
  }

  activatePrompt(
    entry: PendingNotificationEntry,
  ): Promise<NotificationFocusResult> {
    return entry.target
      ? this.focus(entry.target)
      : Promise.resolve({ success: false, outcome: 'missing' });
  }

  private focus(
    target: NotificationFocusTarget,
  ): Promise<NotificationFocusResult> {
    return this.focusRouter
      ? this.focusRouter.focus(target)
      : Promise.resolve({ success: false, outcome: 'missing' });
  }

  private appendCompletion(pulse: TerminalTurnPulse): boolean {
    const id = `${pulse.sessionId}:${pulse.revision}`;
    if (this._completionEntries().some((entry) => entry.id === id))
      return false;
    const entry: CompletionNotificationEntry = {
      kind: 'completion',
      id,
      revision: pulse.revision,
      tabId: pulse.tabId,
      sessionId: pulse.sessionId,
      workspacePath: pulse.workspacePath,
      workspaceLabel: workspaceLabelFromPath(pulse.workspacePath),
      title: pulse.title,
      sessionColor: generateAgentColor(pulse.sessionId),
      phase: pulse.phase,
      terminalReason: pulse.terminalReason,
      lastAssistantMessage: pulse.lastAssistantMessage,
      outcomeLabel: deriveOutcomeLabel(pulse.terminalReason, pulse.phase),
      classification: pulse.classification,
      occurredAt: pulse.occurredAt,
      readAt: null,
      dismissed: false,
      target: {
        workspacePath: pulse.workspacePath,
        tabId: pulse.tabId,
        sessionId: pulse.sessionId,
      },
    };
    this._completionEntries.update((entries) =>
      [...entries, entry]
        .sort((a, b) => a.occurredAt - b.occurredAt)
        .slice(-LEDGER_LIMIT),
    );
    return true;
  }

  private projectQuestion(
    request: AskUserQuestionRequest,
  ): readonly PendingNotificationEntry[] {
    return this.projectPrompt(
      request,
      'question',
      request.questions[0]?.question ?? 'Question needs an answer',
      'Needs an answer',
      this.permissionHandler.questionTargetTabsFor(request.id),
    );
  }

  private projectPermission(
    request: PermissionRequest,
  ): readonly PendingNotificationEntry[] {
    return this.projectPrompt(
      request,
      'permission',
      request.description || `${request.toolName} needs permission`,
      'Needs permission',
      this.permissionHandler.targetTabsFor(request.id),
    );
  }

  private projectPrompt(
    request: PermissionRequest | AskUserQuestionRequest,
    kind: PendingNotificationEntry['kind'],
    title: string,
    statusText: PendingNotificationEntry['statusText'],
    attachedTabIds: readonly string[],
  ): readonly PendingNotificationEntry[] {
    if (attachedTabIds.length > 0) {
      const targets = attachedTabIds
        .map((tabId) => this.tabManager.findTabByIdAcrossWorkspaces(tabId))
        .filter((lookup): lookup is TabLookupResult => lookup !== null);
      if (targets.length === 0) return [];
      return targets.map((lookup) =>
        this.pendingEntry(request, kind, title, statusText, lookup),
      );
    }
    const fallback = request.sessionId
      ? this.tabManager.findTabBySessionIdAcrossWorkspaces(request.sessionId)
      : null;
    if (fallback) {
      return [this.pendingEntry(request, kind, title, statusText, fallback)];
    }
    if (request.surfaceMode) return [];
    return [
      {
        kind,
        id: `${kind}:${request.id}:unavailable`,
        sourceId: request.id,
        sessionId: request.sessionId ?? request.tabId ?? request.id,
        workspacePath: null,
        workspaceLabel: 'Target unavailable',
        title,
        statusText,
        occurredAt: request.timestamp,
        target: null,
        source: request,
      },
    ];
  }

  private pendingEntry(
    request: PermissionRequest | AskUserQuestionRequest,
    kind: PendingNotificationEntry['kind'],
    title: string,
    statusText: PendingNotificationEntry['statusText'],
    lookup: TabLookupResult,
  ): PendingNotificationEntry {
    const sessionId =
      lookup.tab.claudeSessionId ?? request.sessionId ?? lookup.tab.id;
    return {
      kind,
      id: `${kind}:${request.id}:${lookup.tab.id}`,
      sourceId: request.id,
      sessionId,
      workspacePath: lookup.workspacePath,
      workspaceLabel: workspaceLabelFromPath(lookup.workspacePath),
      title,
      statusText,
      occurredAt: request.timestamp,
      target: {
        workspacePath: lookup.workspacePath,
        tabId: lookup.tab.id,
        sessionId,
      },
      source: request,
    };
  }

  private groupCompletions(
    entries: readonly CompletionNotificationEntry[],
  ): readonly CompletionNotificationGroup[] {
    const groups: CompletionNotificationGroup[] = [];
    const byWorkspace = new Map<string, CompletionNotificationEntry[]>();
    for (const entry of entries) {
      if (entry.dismissed) continue;
      const workspaceEntries = byWorkspace.get(entry.workspacePath) ?? [];
      workspaceEntries.push(entry);
      byWorkspace.set(entry.workspacePath, workspaceEntries);
    }
    for (const workspaceEntries of byWorkspace.values()) {
      const sorted = [...workspaceEntries].sort(
        (a, b) => a.occurredAt - b.occurredAt,
      );
      let previous: CompletionNotificationGroup | undefined;
      for (const entry of sorted) {
        if (previous && entry.occurredAt - previous.occurredAt <= BURST_MS) {
          const mergedEntries = [...previous.entries, entry];
          const merged: CompletionNotificationGroup = {
            ...previous,
            classification: mergedEntries.some(
              (item) => item.classification === 'error',
            )
              ? 'error'
              : 'success',
            occurredAt: entry.occurredAt,
            entries: mergedEntries,
          };
          groups[groups.length - 1] = merged;
          previous = merged;
        } else {
          previous = {
            id: `${entry.workspacePath}:${entry.occurredAt}`,
            workspacePath: entry.workspacePath,
            workspaceLabel: entry.workspaceLabel,
            classification: entry.classification,
            occurredAt: entry.occurredAt,
            entries: [entry],
          };
          groups.push(previous);
        }
      }
    }
    return groups.sort((a, b) => {
      if (a.classification !== b.classification) {
        return a.classification === 'error' ? -1 : 1;
      }
      return b.occurredAt - a.occurredAt;
    });
  }

  private queueBurst(completions: number, attention: number): void {
    this.burstCompletionCount += completions;
    this.burstAttentionCount += attention;
    if (this.burstTimer !== null) return;
    this._announcement.set('');
    this.burstTimer = setTimeout(() => {
      const completionCount = this.burstCompletionCount;
      const attentionCount = this.burstAttentionCount;
      this.burstCompletionCount = 0;
      this.burstAttentionCount = 0;
      this.burstTimer = null;
      const completionPhrase =
        completionCount > 0
          ? `${completionCount} ${completionCount === 1 ? 'session' : 'sessions'} finished`
          : '';
      const attentionPhrase =
        attentionCount > 0 ? `${attentionCount} need attention` : '';
      this._announcement.set(
        [completionPhrase, attentionPhrase].filter(Boolean).join('; '),
      );
      this.sound.playBurst();
    }, BURST_MS);
  }
}
