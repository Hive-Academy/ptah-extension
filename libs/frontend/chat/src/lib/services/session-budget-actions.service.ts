import {
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
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
import { SessionAutoHandoffService } from './session-auto-handoff.service';
import { SESSION_START_GUARD } from '../tokens/session-context.token';

/** The chat view's resolved tab and session, as the budget banner sees them. */
export interface SessionBudgetView {
  readonly activeTab: Signal<{
    readonly sessionBudget?: SessionBudgetState | null;
    /** The tab's lifecycle status; the live stage counts only while `streaming`. */
    readonly status?: SessionStatus;
    /** Display-only stage from the live feed (TASK_2026_627 D25). */
    readonly liveBudgetStage?: 'handoff' | 'limit' | null;
    /** The tab's queued message, to tell a queued automatic hand-off. */
    readonly queuedContent?: string | null;
  } | null>;
  readonly tabId: Signal<string | null>;
  readonly sessionId: Signal<string | null>;
}

/**
 * The message "Wrap up & hand off" sends. `{used}` is replaced with the
 * session's formatted usage (for example `41.2M`).
 */
export const SESSION_WRAP_UP_PROMPT = `This session has used {used} tokens. Please wrap up and prepare a handoff.

1. Do not start new work. Collect the results of subagents and CLI agent lanes that already reported. Do not poll or call wait tools for the ones still running: each one pushes its report and a completion signal with its final status into this session when it ends. List each running one in the handoff (its id, its task, how to read its result) and continue.
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
 * With `sessionBudget.autoHandoffAtLimit` on (`budget.autoHandoff`), the
 * same request goes out by itself once per session when the display stage
 * reaches `limit` and the skill is available (never the inline prompt). A
 * running turn queues it like the button does. It waits while the tab has a
 * pending permission prompt, which a queued message would deny, and fires once
 * the prompt is answered. {@link SessionAutoHandoffService} keeps it to one
 * run per session across views (claimed when it is sent); a failed send does
 * not re-arm it, and {@link cancelAutoHandoff} withdraws it while queued.
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
  private readonly autoHandoff = inject(SessionAutoHandoffService);
  private readonly sessionStartGuard = inject(SESSION_START_GUARD, {
    optional: true,
  });

  private readonly view = signal<SessionBudgetView>(NO_VIEW);

  /** Session id → the banner stage the user dismissed in it. */
  private readonly dismissedStages = signal<
    ReadonlyMap<string, SessionBudgetStage>
  >(new Map());

  /**
   * Sessions this view found without the `session-handoff` skill: the
   * automatic hand-off does not probe them again (no RPC loop).
   */
  private readonly autoSkillMissing = new Set<string>();

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

  /**
   * True while the shown session's automatic hand-off is queued and not yet
   * sent: held behind other queued text, or the start of the tab's queued
   * message.
   */
  readonly autoHandoffQueued = computed(() => {
    const sessionId = this.budget()?.sessionId;
    const entry = sessionId ? this.autoHandoff.entry(sessionId) : null;
    if (entry?.state !== 'fired' || !entry.command) return false;
    if (entry.held) return true;
    const queued = this.view().activeTab()?.queuedContent?.trim() ?? '';
    return queued === entry.command || queued.startsWith(`${entry.command}\n`);
  });

  /** True once the wrap-up prompt was sent (or auto-queued) for the shown session. */
  readonly wrapUpSent = computed(() => {
    const sessionId = this.budget()?.sessionId;
    return (
      (!!sessionId && this.wrapUpSessions().has(sessionId)) ||
      this.autoHandoffQueued()
    );
  });

  constructor() {
    // The automatic hand-off: armed by the setting, fired once per session.
    effect(() => {
      const budget = this.budget();
      const tabId = this.view().tabId();
      if (
        budget?.autoHandoff !== true ||
        this.displayStage() !== 'limit' ||
        !tabId ||
        this.wrapUpSent() ||
        this.autoHandoff.entry(budget.sessionId) !== null ||
        this.autoSkillMissing.has(budget.sessionId) ||
        this.sessionStartGuard?.() ||
        // A queued message would deny the prompt; re-run once it is answered.
        this.chatStore.hasPendingPermissionForTab(tabId)
      ) {
        return;
      }
      untracked(() => void this.requestWrapUp(true));
    });
  }

  /** Binds this service to the view's resolved tab and session. */
  connect(view: SessionBudgetView): void {
    this.view.set(view);
  }

  /**
   * Cancel the shown session's queued automatic hand-off: withdraw the
   * command from the tab's queue (the rest of the queue stays) and never fire
   * it again for the session. The button becomes available again.
   */
  cancelAutoHandoff(): void {
    const sessionId = this.budget()?.sessionId;
    if (!sessionId || !this.autoHandoffQueued()) return;
    const entry = this.autoHandoff.entry(sessionId);
    this.autoHandoff.cancel(sessionId);
    this.setWrapUpSent(sessionId, false);
    if (entry?.tabId && entry.command) {
      this.chatStore.withdrawQueuedCommand(entry.tabId, entry.command);
    }
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
  sendWrapUp(): Promise<void> {
    return this.requestWrapUp(false);
  }

  /**
   * The button's send, or with `auto` the automatic hand-off's: that one
   * sends only the slash command, records what it queued for
   * {@link autoHandoffQueued}, and stays silent when the user cancelled it.
   */
  private async requestWrapUp(auto: boolean): Promise<void> {
    const tabId = this.view().tabId();
    const budget = this.budget();
    const sessionId = budget?.sessionId;
    if (!tabId || !sessionId || this.wrapUpSent()) return;
    this.setWrapUpSent(sessionId, true);
    try {
      const skill = await this.handoffSkillAvailable();
      const prompt = skill
        ? buildHandoffCommand(budget)
        : buildWrapUpPrompt(budget);
      if (auto && !this.claimAutoHandoff(sessionId, tabId, prompt, skill)) {
        this.setWrapUpSent(sessionId, false);
        return;
      }
      const outcome = await this.chatStore.sendOrQueueMessage(prompt, {
        tabId,
      });
      // The send path already shows its own failure notice in the transcript.
      if (!outcome?.success) {
        this.setWrapUpSent(sessionId, false);
        return;
      }
      if (!outcome.heldCommand) return;
      if (auto) this.autoHandoff.recordCommand(sessionId, tabId, prompt, true);
      const queued = await outcome.heldCommand;
      if (auto) this.autoHandoff.recordCommand(sessionId, tabId, prompt, false);
      if (queued) return;
      this.setWrapUpSent(sessionId, false);
      if (auto && this.autoHandoff.entry(sessionId)?.state === 'cancelled') {
        return;
      }
      this.actionBanner.showError(
        'The wrap-up request was not sent: the queued messages before it were stopped or failed.',
        tabId,
      );
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

  /**
   * The automatic hand-off's last checks before it sends, then the claim:
   * the skill is there, no permission prompt arrived during the probe, and no
   * other view claimed the session meanwhile. False means do not send.
   */
  private claimAutoHandoff(
    sessionId: string,
    tabId: string,
    command: string,
    skill: boolean,
  ): boolean {
    if (!skill) {
      this.autoSkillMissing.add(sessionId);
      return false;
    }
    if (this.chatStore.hasPendingPermissionForTab(tabId)) return false;
    if (!this.autoHandoff.claim(sessionId)) return false;
    this.autoHandoff.recordCommand(sessionId, tabId, command, false);
    return true;
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
