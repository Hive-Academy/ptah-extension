import {
  Injectable,
  computed,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import type { SessionStatus } from '@ptah-extension/chat-types';
import {
  ClaudeRpcService,
  VSCodeService,
  pickerWorkspaceScope,
} from '@ptah-extension/core';
import type {
  SessionBudgetStage,
  SessionBudgetState,
} from '@ptah-extension/shared';
import {
  displayBudgetStage,
  formatTokens,
  formatUsd,
  isCostMeasure,
} from '../components/molecules/notifications/session-budget-format';
import { ActionBannerService } from './action-banner.service';
import { ChatStore } from './chat.store';

/** The chat view's resolved tab and session, as the budget banner sees them. */
export interface SessionBudgetView {
  readonly activeTab: Signal<{
    readonly sessionBudget?: SessionBudgetState | null;
    /** The tab's lifecycle status; the live stage counts only while `streaming`. */
    readonly status?: SessionStatus;
    /** Display-only stage from the live feed (TASK_2026_627 D25). */
    readonly liveBudgetStage?: 'handoff' | 'limit' | null;
  } | null>;
  readonly tabId: Signal<string | null>;
  readonly sessionId: Signal<string | null>;
}

/**
 * The message "Wrap up & hand off" sends. `{used}` is replaced with the
 * session's formatted usage (for example `41.2M`).
 */
export const SESSION_WRAP_UP_PROMPT = `This session has used {used} tokens. Please wrap up and prepare a handoff.

1. Do not start new work. Wait until every running subagent and CLI agent lane has finished (check their status and wait for them), then collect their results.
2. Write a handoff document named \`HANDOFF.md\` in the folder of the task you are working on (for example its task-tracking folder). If there is no task folder, write it in the root of the current worktree. Include: the goal, what is done (commits, branches, PRs), what is in progress, open problems and decisions, the key files, and the exact next steps with the verification commands.
3. Finish your reply with one fenced code block that contains a self-contained prompt I can paste into a new session to continue. The prompt must give the absolute path of the handoff document and tell the new session to read it first.`;

/** The wrap-up prompt with the session's usage filled in. */
export function buildWrapUpPrompt(budget: SessionBudgetState | null): string {
  return SESSION_WRAP_UP_PROMPT.replace('{used}', usedFigure(budget));
}

/**
 * The `session-handoff` skill's slash command (TASK_2026_655). Un-namespaced:
 * the SDK resolves `/session-handoff`, not `/ptah-core:session-handoff`.
 */
export const SESSION_HANDOFF_COMMAND = '/session-handoff';

/** The skill's command name as the command discovery lists it. */
const SESSION_HANDOFF_SKILL = SESSION_HANDOFF_COMMAND.slice(1);

/** `/session-handoff` with the session's usage as its argument. */
export function buildHandoffCommand(budget: SessionBudgetState | null): string {
  return `${SESSION_HANDOFF_COMMAND} This session has used ${usedFigure(budget)} tokens.`;
}

/** `41.2M`, or `$8.96 worth of` for a cost budget, so "… {used} tokens" reads. */
function usedFigure(budget: SessionBudgetState | null): string {
  if (!budget || budget.used === null) return 'a large number of';
  if (isCostMeasure(budget)) return `${formatUsd(budget.used)} worth of`;
  return formatTokens(budget.used);
}

const NO_VIEW: SessionBudgetView = {
  activeTab: signal(null),
  tabId: signal(null),
  sessionId: signal(null),
};

/**
 * State behind the session budget banner: the stage to display, the stage the
 * user dismissed per session, and "Wrap up & hand off", which sends one normal
 * chat message to the agent through the composer's send path (so a running
 * turn queues it like any typed message). The agent does the rest.
 *
 * That message is the `/session-handoff` slash command when the workspace has
 * the `session-handoff` skill, which opens the continuation session itself;
 * otherwise it is the inline {@link SESSION_WRAP_UP_PROMPT}.
 *
 * Provided by the chat view, one instance per view. The view calls
 * {@link connect} once with its resolved tab and session.
 */
@Injectable()
export class SessionBudgetActionsService {
  private readonly actionBanner = inject(ActionBannerService);
  private readonly chatStore = inject(ChatStore);
  private readonly rpc = inject(ClaudeRpcService);
  private readonly vscodeService = inject(VSCodeService);

  private readonly view = signal<SessionBudgetView>(NO_VIEW);

  /** Session id → the banner stage the user dismissed in it. */
  private readonly dismissedStages = signal<
    ReadonlyMap<string, SessionBudgetStage>
  >(new Map());

  /** Sessions whose wrap-up prompt was sent from this view. */
  private readonly wrapUpSessions = signal<ReadonlySet<string>>(new Set());

  /** The tab's budget (installed with its stats snapshot), or `null`. */
  readonly budget = computed<SessionBudgetState | null>(
    () => this.view().activeTab()?.sessionBudget ?? null,
  );

  /** True while the shown tab's agent is producing a turn. */
  private readonly turnRunning = computed(
    () => this.view().activeTab()?.status === 'streaming',
  );

  /**
   * The live (estimated) stage, as far as it counts: only while the turn
   * runs and the tab has a budget (D25).
   */
  private readonly liveStage = computed<'handoff' | 'limit' | null>(() => {
    if (!this.turnRunning() || !this.budget()) return null;
    return this.view().activeTab()?.liveBudgetStage ?? null;
  });

  /**
   * The stage the banner shows: the higher of the authoritative budget stage
   * and {@link liveStage}. `null` without a budget.
   */
  readonly displayStage = computed<SessionBudgetStage | null>(() => {
    const budget = this.budget();
    if (!budget) return null;
    return displayBudgetStage(budget.stage, this.liveStage());
  });

  /** The stage the user dismissed in the shown session, or `null`. */
  readonly dismissedStage = computed<SessionBudgetStage | null>(() => {
    const sessionId = this.budget()?.sessionId;
    return sessionId ? (this.dismissedStages().get(sessionId) ?? null) : null;
  });

  /** True once the wrap-up prompt was sent for the shown session. */
  readonly wrapUpSent = computed(() => {
    const sessionId = this.budget()?.sessionId;
    return !!sessionId && this.wrapUpSessions().has(sessionId);
  });

  /** Binds this service to the view's resolved tab and session. */
  connect(view: SessionBudgetView): void {
    this.view.set(view);
  }

  /** Hide the banner for the shown session until its stage rises. */
  dismiss(): void {
    const sessionId = this.budget()?.sessionId;
    const stage = this.displayStage();
    if (!sessionId || !stage) return;
    this.dismissedStages.update((current) => {
      const next = new Map(current);
      next.set(sessionId, stage);
      return next;
    });
  }

  /**
   * "Wrap up & hand off": send {@link buildHandoffCommand} when the
   * `session-handoff` skill is available, else {@link SESSION_WRAP_UP_PROMPT},
   * as a normal message through `ChatStore.sendOrQueueMessage`, the
   * composer's send path. The button is disabled before the skill probe, so a
   * second click during it sends nothing. A failed send re-enables the
   * button; a thrown error is also shown.
   *
   * When the tab already has queued text, the slash command waits behind it
   * as its own turn. The button stays disabled meanwhile; if the command is
   * dropped (Stop, failed turn), it is enabled again with a notice.
   */
  async sendWrapUp(): Promise<void> {
    const tabId = this.view().tabId();
    const budget = this.budget();
    const sessionId = budget?.sessionId;
    if (!tabId || !sessionId || this.wrapUpSessions().has(sessionId)) return;
    this.setWrapUpSent(sessionId, true);
    try {
      const prompt = (await this.handoffSkillAvailable())
        ? buildHandoffCommand(budget)
        : buildWrapUpPrompt(budget);
      const outcome = await this.chatStore.sendOrQueueMessage(prompt, {
        tabId,
      });
      // The send path already shows its own failure notice in the transcript.
      if (!outcome?.success) {
        this.setWrapUpSent(sessionId, false);
        return;
      }
      if (outcome.heldCommand && !(await outcome.heldCommand)) {
        this.setWrapUpSent(sessionId, false);
        this.actionBanner.showError(
          'The wrap-up request was not sent: the queued messages before it were stopped or failed.',
          tabId,
        );
      }
    } catch (error: unknown) {
      this.setWrapUpSent(sessionId, false);
      this.actionBanner.showError(
        `Could not send the wrap-up request: ${error instanceof Error ? error.message : String(error)}`,
        tabId,
      );
    }
  }

  /**
   * Whether this workspace has the `session-handoff` skill: the command
   * discovery lists the workspace `.claude/skills` the SDK resolves slash
   * commands from. Any failure means "not available", so the button falls
   * back to the inline prompt instead of failing.
   */
  private async handoffSkillAvailable(): Promise<boolean> {
    try {
      const result = await this.rpc.call('autocomplete:commands', {
        query: SESSION_HANDOFF_SKILL,
        maxResults: 10,
        ...pickerWorkspaceScope(this.vscodeService.config().workspaceRoot),
      });
      return (
        result.success &&
        (result.data?.commands ?? []).some(
          (command) => command.name === SESSION_HANDOFF_SKILL,
        )
      );
    } catch {
      // degradation-audit: optional-capability - a failed probe sends the
      // inline wrap-up prompt, which does the same job without the skill.
      return false;
    }
  }

  private setWrapUpSent(sessionId: string, sent: boolean): void {
    this.wrapUpSessions.update((current) => {
      const next = new Set(current);
      if (sent) next.add(sessionId);
      else next.delete(sessionId);
      return next;
    });
  }
}
