/**
 * GatewayCommandService — the control plane behind the five Discord commands
 * (`/sessions`, `/session use`, `/new`, `/workspace list`, `/workspace use`).
 *
 * Structural guarantees (TASK_2026_156):
 * - Commands terminate HERE: no `inbound` event, no `MessageStore` access, no
 *   `ConversationQueue` entry — a command can never become an agent turn
 *   (AC-1.3, Data-6; note this class has no MessageStore dependency at all).
 * - Every `pick` is UNTRUSTED: the closed candidate set (sessions via
 *   `IGatewaySessionLister`, workspaces via
 *   `IWorkspaceProvider.getWorkspaceFolders()`) is re-derived at execution
 *   time and the pick resolves by closed-set membership only (SEC-1/SEC-2).
 * - Approval gate first (SEC-5): pending bindings get guidance WITHOUT the
 *   pairing code; rejected/revoked/unknown get a generic refusal; nothing here
 *   calls `upsertPending`.
 * - Sliding-window rate limit 60/min per allowListId (SEC-7) — its own
 *   counter map because commands bypass `GatewayService.handleInbound`.
 * - Mutating commands are refused while a turn is in flight or queued for the
 *   same conversation (`ConversationTurnTracker`, AC-3.6/4.3/6.6).
 */
import { access } from 'node:fs/promises';
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { GATEWAY_TOKENS } from '../di/tokens';
import { BindingStore } from '../binding.store';
import { ConversationStore } from '../conversation.store';
import { AttachedSessionRegistry } from '../attached-session-registry';
import type { ISessionResumabilityChecker } from '../session-resumability';
import type {
  GatewaySessionSummary,
  IGatewaySessionLister,
} from '../session-lister.interface';
import type { ISessionActivityProbe } from '../session-activity.interface';
import { ConversationTurnTracker } from '../turn-activity-tracker';
import {
  normalizeWorkspacePath,
  resolveEffectiveWorkspaceRoot,
  workspaceRootDigest,
  type EffectiveWorkspace,
} from '../workspace-resolution';
import {
  ConversationKey,
  type GatewayBinding,
  type GatewayConversation,
} from '../types';
import type {
  GatewayAutocompleteRequest,
  GatewayCommandInvocation,
  GatewayCommandOutcome,
  IGatewayCommandHandler,
} from './gateway-command.types';
import {
  COMMAND_REPLIES,
  PICKLIST_CAP,
  disambiguateWorkspaceLabels,
  formatSessionsReply,
  formatWorkspaceListReply,
  newSessionAudit,
  newSessionConfirmation,
  sessionChoiceName,
  sessionUseAudit,
  sessionUseConfirmation,
  truncateChoiceText,
  workspaceNoOpReply,
  workspaceUseAudit,
  workspaceUseConfirmation,
} from './command-replies';

/** Mirrors `INBOUND_ABUSE_LIMIT_PER_MIN` in gateway.service.ts (SEC-7). */
const COMMAND_ABUSE_LIMIT_PER_MIN = 60;

type AutocompleteChoice = { name: string; value: string };

@injectable()
export class GatewayCommandService implements IGatewayCommandHandler {
  /** allowListId → recent command/autocomplete timestamps (sliding window). */
  private readonly commandCounters = new Map<string, number[]>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(GATEWAY_TOKENS.GATEWAY_BINDING_STORE)
    private readonly bindings: BindingStore,
    @inject(GATEWAY_TOKENS.GATEWAY_CONVERSATION_STORE)
    private readonly conversations: ConversationStore,
    @inject(GATEWAY_TOKENS.GATEWAY_ATTACHED_SESSION_REGISTRY)
    private readonly attachedSessionRegistry: AttachedSessionRegistry,
    @inject(GATEWAY_TOKENS.GATEWAY_SESSION_RESUMABILITY_CHECKER)
    private readonly resumability: ISessionResumabilityChecker,
    @inject(GATEWAY_TOKENS.GATEWAY_TURN_TRACKER)
    private readonly turnTracker: ConversationTurnTracker,
    @inject(GATEWAY_TOKENS.GATEWAY_SESSION_LISTER)
    private readonly sessionLister: IGatewaySessionLister,
    @inject(GATEWAY_TOKENS.GATEWAY_SESSION_ACTIVITY_PROBE)
    private readonly activityProbe: ISessionActivityProbe,
  ) {}

  async handleCommand(
    inv: GatewayCommandInvocation,
  ): Promise<GatewayCommandOutcome> {
    try {
      if (this.isRateLimited(inv.allowListId)) {
        return { ephemeralText: COMMAND_REPLIES.rateLimited };
      }

      const binding = this.bindings.findByExternal(
        inv.platform,
        inv.externalChatId,
      );
      if (!binding) {
        return { ephemeralText: COMMAND_REPLIES.notPaired };
      }
      if (binding.approvalStatus === 'pending') {
        // SEC-5: guidance only — never re-send the pairing code, never
        // upsertPending (the code flows only through handleInbound).
        return { ephemeralText: COMMAND_REPLIES.pendingApproval };
      }
      if (binding.approvalStatus !== 'approved') {
        return { ephemeralText: COMMAND_REPLIES.notPaired };
      }

      switch (inv.command.kind) {
        case 'sessions':
          return await this.handleSessions(inv, binding);
        case 'session-use':
          return await this.handleSessionUse(inv, binding, inv.command.pick);
        case 'new':
          return this.handleNew(inv, binding);
        case 'workspace-list':
          return this.handleWorkspaceList(inv, binding);
        case 'workspace-use':
          return await this.handleWorkspaceUse(inv, binding, inv.command.pick);
      }
    } catch (error: unknown) {
      this.logger.warn('[gateway] command handling failed', {
        kind: inv.command.kind,
        platform: inv.platform,
        error: error instanceof Error ? error.message : String(error),
      });
      return { ephemeralText: COMMAND_REPLIES.commandFailed };
    }
  }

  async handleAutocomplete(
    req: GatewayAutocompleteRequest,
  ): Promise<ReadonlyArray<AutocompleteChoice>> {
    try {
      if (this.isRateLimited(req.allowListId)) return [];

      const binding = this.bindings.findByExternal(
        req.platform,
        req.externalChatId,
      );
      if (!binding || binding.approvalStatus !== 'approved') return [];

      if (req.target === 'workspace-pick') {
        return this.workspaceChoices(req.query);
      }
      return await this.sessionChoices(req, binding);
    } catch (error: unknown) {
      this.logger.warn('[gateway] command autocomplete failed', {
        target: req.target,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  // ── /sessions ────────────────────────────────────────────────────────────

  private async handleSessions(
    inv: GatewayCommandInvocation,
    binding: GatewayBinding,
  ): Promise<GatewayCommandOutcome> {
    const conversation = this.findConversation(inv, binding);
    const resolved = this.resolveWorkspace(binding, conversation);
    if (!resolved.ok) {
      return { ephemeralText: this.workspaceFailureReply(resolved.reason) };
    }
    const { sessions, truncated } = await this.sessionLister.listForWorkspace(
      resolved.root,
    );
    return {
      ephemeralText: formatSessionsReply({
        sessions,
        truncated,
        workspaceRoot: resolved.root,
        currentSessionId: conversation?.ptahSessionId ?? null,
        inThread: inv.threadId !== undefined,
      }),
    };
  }

  // ── /session use <pick> ──────────────────────────────────────────────────

  private async handleSessionUse(
    inv: GatewayCommandInvocation,
    binding: GatewayBinding,
    pick: string,
  ): Promise<GatewayCommandOutcome> {
    const gate = this.mutatingGate(inv);
    if ('refusal' in gate) return gate.refusal;

    const conversation = this.conversations.resolveOrAdopt(
      binding.id,
      gate.threadId,
    );
    const resolved = this.resolveWorkspace(binding, conversation);
    if (!resolved.ok) {
      return { ephemeralText: this.workspaceFailureReply(resolved.reason) };
    }

    // SEC-1: re-derive the closed session set at execution time; the pick can
    // only resolve to a member of it.
    const { sessions } = await this.sessionLister.listForWorkspace(
      resolved.root,
    );
    const picked = this.resolveSessionPick(pick, sessions);
    if (!picked) {
      return { ephemeralText: COMMAND_REPLIES.sessionPickUnresolved };
    }

    const resumable = await this.resumability.isResumable(
      picked.sessionId,
      resolved.root,
    );
    if (!resumable) {
      return { ephemeralText: COMMAND_REPLIES.sessionNotResumable };
    }

    const owner = this.attachedSessionRegistry.bindingFor(picked.sessionId);
    if (owner !== null && owner !== String(binding.id)) {
      return { ephemeralText: COMMAND_REPLIES.sessionInUseElsewhere };
    }
    const owningRows = this.conversations.findBySessionId(picked.sessionId);
    if (owningRows.some((row) => row.id !== conversation.id)) {
      return { ephemeralText: COMMAND_REPLIES.sessionInUseElsewhere };
    }
    if (this.activityProbe.isActive(picked.sessionId)) {
      return { ephemeralText: COMMAND_REPLIES.sessionCurrentlyRunning };
    }

    // AC-3.9: never touches workspace_root.
    const previousUuid = conversation.ptahSessionId;
    this.conversations.setPtahSessionId(conversation.id, picked.sessionId);
    if (previousUuid && previousUuid !== picked.sessionId) {
      this.attachedSessionRegistry.detach(previousUuid);
    }
    this.attachedSessionRegistry.attach(picked.sessionId, String(binding.id));

    this.logger.info('[gateway] /session use attached session to thread', {
      bindingId: String(binding.id),
      platform: inv.platform,
    });
    return {
      ephemeralText: sessionUseConfirmation(picked),
      publicText: sessionUseAudit(picked),
    };
  }

  // ── /new ─────────────────────────────────────────────────────────────────

  private handleNew(
    inv: GatewayCommandInvocation,
    binding: GatewayBinding,
  ): GatewayCommandOutcome {
    const gate = this.mutatingGate(inv);
    if ('refusal' in gate) return gate.refusal;

    const conversation = this.conversations.resolveOrAdopt(
      binding.id,
      gate.threadId,
    );
    if (!conversation.ptahSessionId) {
      return { ephemeralText: COMMAND_REPLIES.alreadyFresh };
    }

    // AC-4.5: conversation-scoped — only this row's link is cleared.
    this.conversations.clearPtahSessionId(conversation.id);
    this.attachedSessionRegistry.detach(conversation.ptahSessionId);

    this.logger.info('[gateway] /new cleared thread session link', {
      bindingId: String(binding.id),
      platform: inv.platform,
    });
    return {
      ephemeralText: newSessionConfirmation(),
      publicText: newSessionAudit(),
    };
  }

  // ── /workspace list ──────────────────────────────────────────────────────

  private handleWorkspaceList(
    inv: GatewayCommandInvocation,
    binding: GatewayBinding,
  ): GatewayCommandOutcome {
    // SEC-2/AC-5.2: the provider list verbatim — no other source, no parsing.
    const folders = this.workspace.getWorkspaceFolders();
    const conversation = this.findConversation(inv, binding);
    const resolved = this.resolveWorkspace(binding, conversation);
    return {
      ephemeralText: formatWorkspaceListReply({
        folders,
        currentRoot: resolved.ok ? resolved.root : null,
        normalize: normalizeWorkspacePath,
      }),
    };
  }

  // ── /workspace use <pick> ────────────────────────────────────────────────

  private async handleWorkspaceUse(
    inv: GatewayCommandInvocation,
    binding: GatewayBinding,
    pick: string,
  ): Promise<GatewayCommandOutcome> {
    const gate = this.mutatingGate(inv);
    if ('refusal' in gate) return gate.refusal;

    const conversation = this.conversations.resolveOrAdopt(
      binding.id,
      gate.threadId,
    );

    // SEC-1/SEC-2: fresh provider read, closed-set membership only.
    const folders = this.workspace.getWorkspaceFolders();
    const picked = this.resolveWorkspacePick(pick, folders);
    if (picked === null) {
      return { ephemeralText: COMMAND_REPLIES.workspacePickUnresolved };
    }

    try {
      await access(picked);
    } catch {
      return { ephemeralText: COMMAND_REPLIES.workspaceNoLongerAvailable };
    }

    const label = this.workspaceLabel(picked, folders);

    // AC-6.5: no-op when the pick equals the current effective root — the
    // session link is kept.
    const resolved = this.resolveWorkspace(binding, conversation);
    if (
      resolved.ok &&
      normalizeWorkspacePath(resolved.root) === normalizeWorkspacePath(picked)
    ) {
      return { ephemeralText: workspaceNoOpReply(label) };
    }

    // SEC-4/AC-6.4: root switch + session clear in ONE transaction. Writes
    // ONLY this conversation row — never the binding root, never the desktop
    // active folder, never another conversation (AC-6.7).
    const previousUuid = conversation.ptahSessionId;
    this.conversations.setWorkspaceRootAndClearSession(conversation.id, picked);
    if (previousUuid) {
      this.attachedSessionRegistry.detach(previousUuid);
    }

    this.logger.info('[gateway] /workspace use repointed thread', {
      bindingId: String(binding.id),
      platform: inv.platform,
      hadSession: previousUuid !== null,
    });
    return {
      ephemeralText: workspaceUseConfirmation(label),
      publicText: workspaceUseAudit(label),
    };
  }

  // ── Autocomplete providers ───────────────────────────────────────────────

  private workspaceChoices(query: string): AutocompleteChoice[] {
    const folders = this.workspace.getWorkspaceFolders();
    const labels = disambiguateWorkspaceLabels(folders);
    const q = query.trim().toLowerCase();
    const choices: AutocompleteChoice[] = [];
    for (let i = 0; i < folders.length; i++) {
      if (
        q.length > 0 &&
        !labels[i].toLowerCase().includes(q) &&
        !folders[i].toLowerCase().includes(q)
      ) {
        continue;
      }
      choices.push({
        name: truncateChoiceText(labels[i]),
        value:
          folders[i].length <= 100
            ? folders[i]
            : workspaceRootDigest(folders[i]),
      });
      if (choices.length >= PICKLIST_CAP) break;
    }
    return choices;
  }

  private async sessionChoices(
    req: GatewayAutocompleteRequest,
    binding: GatewayBinding,
  ): Promise<AutocompleteChoice[]> {
    const conversation = req.threadId
      ? this.conversations.findByExternal(binding.id, req.threadId)
      : null;
    const resolved = this.resolveWorkspace(binding, conversation);
    if (!resolved.ok) return [];
    const { sessions } = await this.sessionLister.listForWorkspace(
      resolved.root,
    );
    const q = req.query.trim().toLowerCase();
    const now = Date.now();
    return sessions
      .filter(
        (s) =>
          q.length === 0 ||
          s.name.toLowerCase().includes(q) ||
          s.sessionId.toLowerCase().startsWith(q),
      )
      .slice(0, PICKLIST_CAP)
      .map((s) => ({ name: sessionChoiceName(s, now), value: s.sessionId }));
  }

  // ── Shared gates / helpers ───────────────────────────────────────────────

  /**
   * Thread-only + mid-turn gate shared by every mutating command
   * (AC-3.6/3.8, AC-4.3/4.6, AC-6.6/6.8).
   */
  private mutatingGate(
    inv: GatewayCommandInvocation,
  ): { refusal: GatewayCommandOutcome } | { threadId: string } {
    if (inv.threadId === undefined) {
      return { refusal: { ephemeralText: COMMAND_REPLIES.threadOnly } };
    }
    const key = ConversationKey.for(
      inv.platform,
      inv.externalChatId,
      inv.threadId,
    );
    if (this.turnTracker.isBusy(key)) {
      return { refusal: { ephemeralText: COMMAND_REPLIES.turnInProgress } };
    }
    return { threadId: inv.threadId };
  }

  private findConversation(
    inv: GatewayCommandInvocation,
    binding: GatewayBinding,
  ): GatewayConversation | null {
    return inv.threadId !== undefined
      ? this.conversations.findByExternal(binding.id, inv.threadId)
      : null;
  }

  private resolveWorkspace(
    binding: GatewayBinding,
    conversation: GatewayConversation | null,
  ): EffectiveWorkspace {
    return resolveEffectiveWorkspaceRoot({
      conversationRoot: conversation?.workspaceRoot,
      bindingRoot: binding.workspaceRoot,
      workspace: this.workspace,
    });
  }

  private workspaceFailureReply(
    reason: 'conversation-root-revoked' | 'no-workspace-open',
  ): string {
    return reason === 'conversation-root-revoked'
      ? COMMAND_REPLIES.conversationRootRevoked
      : COMMAND_REPLIES.noWorkspaceOpen;
  }

  /**
   * Resolve an untrusted session pick against the freshly derived closed set:
   * exact uuid → unique uuid-prefix / name / name-prefix; anything else
   * (miss or ambiguity) is refused (AC-3.3, SEC-1).
   */
  private resolveSessionPick(
    pick: string,
    sessions: GatewaySessionSummary[],
  ): GatewaySessionSummary | null {
    const trimmed = pick.trim();
    if (trimmed.length === 0) return null;
    const lower = trimmed.toLowerCase();

    const exact = sessions.find((s) => s.sessionId.toLowerCase() === lower);
    if (exact) return exact;

    const candidates = sessions.filter(
      (s) =>
        s.sessionId.toLowerCase().startsWith(lower) ||
        s.name.toLowerCase() === lower ||
        s.name.toLowerCase().startsWith(lower),
    );
    return candidates.length === 1 ? candidates[0] : null;
  }

  /**
   * Resolve an untrusted workspace pick against the provider's folder list:
   * exact normalized path → digest of an allowlisted entry → unique
   * case-insensitive basename / basename-prefix. All three are closed-set
   * membership tests; no raw path can be conjured (SEC-1/SEC-2, AC-6.2).
   */
  private resolveWorkspacePick(pick: string, folders: string[]): string | null {
    const trimmed = pick.trim();
    if (trimmed.length === 0) return null;

    const normalizedPick = normalizeWorkspacePath(trimmed);
    const exact = folders.find(
      (f) => normalizeWorkspacePath(f) === normalizedPick,
    );
    if (exact !== undefined) return exact;

    const byDigest = folders.filter((f) => workspaceRootDigest(f) === trimmed);
    if (byDigest.length === 1) return byDigest[0];

    const lower = trimmed.toLowerCase();
    const labels = disambiguateWorkspaceLabels(folders);
    const byLabel = folders.filter((f, i) => {
      const label = labels[i].toLowerCase();
      return label === lower || label.startsWith(lower);
    });
    return byLabel.length === 1 ? byLabel[0] : null;
  }

  private workspaceLabel(picked: string, folders: string[]): string {
    const labels = disambiguateWorkspaceLabels(folders);
    const index = folders.indexOf(picked);
    return index >= 0 ? labels[index] : picked;
  }

  /**
   * Sliding-window abuse guard (SEC-7) — same 60/min shape as
   * `GatewayService.handleInbound`, separate counters because commands bypass
   * the inbound path. Shared between commands and autocomplete.
   */
  private isRateLimited(allowListId: string | undefined): boolean {
    if (!allowListId) return false;
    const now = Date.now();
    const recent = (this.commandCounters.get(allowListId) ?? []).filter(
      (ts) => ts > now - 60_000,
    );
    if (recent.length >= COMMAND_ABUSE_LIMIT_PER_MIN) {
      this.commandCounters.set(allowListId, recent);
      this.logger.warn('[gateway] dropping command — abuse cap', {
        allowListId,
      });
      return true;
    }
    recent.push(now);
    this.commandCounters.set(allowListId, recent);
    return false;
  }
}
