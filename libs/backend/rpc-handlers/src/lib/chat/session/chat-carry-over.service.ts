/**
 * Provider carry-over (TASK_2026_865): after the workspace switched provider,
 * start a new chat on the active provider whose first turn holds the old
 * conversation's bounded, redacted transcript.
 *
 * The old session is only read: no metadata write, no resume, and `prepare`
 * never receives its stored identity. Every outcome is a result with fixed
 * text; logs carry ids and error class names only, never transcript text.
 */
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { inject, injectable } from 'tsyringe';

import {
  SDK_TOKENS,
  type SessionHistoryRouter,
  type SessionMetadataStore,
} from '@ptah-extension/agent-sdk';
import {
  AUTH_PROVIDERS_TOKENS,
  type ActiveProviderResolver,
  type ICodexAuthService,
  type WorkspaceProviderProfileResolver,
} from '@ptah-extension/auth-providers';
import { SETTINGS_TOKENS, type ModelSettings } from '@ptah-extension/settings-core';
import {
  CARRY_OVER_REQUEST_ID_TTL_MS,
  getAnthropicProvider,
  loggableErrorName,
  type CarryOverResolutionTags,
  type ChatCarryOverCheckParams,
  type ChatCarryOverCheckResult,
  type ChatCarryOverFailureReason,
  type ChatCarryOverParams,
  type ChatCarryOverResult,
  type SessionId,
} from '@ptah-extension/shared';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';

import { CHAT_TOKENS } from '../tokens';
import {
  CARRY_OVER_READ_TAIL_BYTES,
  CARRY_OVER_READ_TIMEOUT_MS,
  renderCarryOverPrompt,
} from './chat-carry-over-transcript';
import type { ChatHistoryReadService } from './chat-history-read.service';
import {
  resolveClaudeExecution,
  storedChatRuntimeIdentity,
  type ChatRuntimeProfileService,
} from './chat-runtime-profile.service';
import {
  CARRY_OVER_PROVIDER_CHANGED,
  type ChatSessionService,
} from './chat-session.service';

/** Fixed result texts. None of them ever holds transcript content. */
const NOT_ELIGIBLE_TEXT =
  "This conversation can't be continued with the current provider.";
const IN_FLIGHT_TEXT = 'This conversation is already being continued.';
const HISTORY_UNREADABLE_TEXT = "Couldn't read this conversation's history.";

/** The only source this host reads; the native Codex read is a later phase. */
const CLAUDE_JSONL_SOURCE = 'claude-jsonl';

interface EligibleCarryOver {
  /** The session's own folder: the read and the new session both use it. */
  readonly folder: string;
  readonly activeId: string;
  readonly providerName: string;
}

type CarryOverFailure = Extract<ChatCarryOverResult, { success: false }>;

/** A launch's request ID, waiting for its tab's next session resolution. */
interface ResolutionTicket {
  readonly requestId: string;
  /** `Date.now()` after which the ticket is dropped unclaimed. */
  readonly until: number;
}

/** `'offer'`: the eligibility check, with no lasting side effect. `'launch'`: the click. */
type ProbePurpose = 'offer' | 'launch';

/**
 * Whether resolving a new Claude session on `providerId` starts or binds a
 * pooled proxy (`WorkspaceProviderProfileResolver.buildProxyProviderProfile`).
 * Codex is excluded: its native path never reaches the pool, and the legacy
 * path is refused before any acquisition.
 */
function acquiresProxyOnProbe(providerId: string): boolean {
  return (
    providerId !== 'openai-codex' &&
    getAnthropicProvider(providerId)?.requiresProxy === true
  );
}

function failure(
  reason: Exclude<ChatCarryOverFailureReason, 'START_FAILED'>,
): CarryOverFailure {
  const error =
    reason === 'IN_FLIGHT'
      ? IN_FLIGHT_TEXT
      : reason === 'HISTORY_UNREADABLE'
        ? HISTORY_UNREADABLE_TEXT
        : NOT_ELIGIBLE_TEXT;
  return { success: false, reason, error };
}

function providerDisplayName(providerId: string): string {
  if (providerId === 'openai-codex') return 'Codex';
  if (providerId === 'anthropic') return 'Claude';
  return getAnthropicProvider(providerId)?.name ?? providerId;
}

@injectable()
export class ChatCarryOverService implements CarryOverResolutionTags {
  /** Session ids with a carry-over running; one at a time per session (AC 5.4). */
  private readonly inFlight = new Set<string>();
  /**
   * Per tab: the request ID of the latest launch the adapter was asked to
   * start, until the tab's next resolution claims it (R1). Bounded by the
   * tabs with a carry-over and pruned by {@link CARRY_OVER_REQUEST_ID_TTL_MS}.
   */
  private readonly resolutionTickets = new Map<string, ResolutionTicket>();

  constructor(
    @inject(TOKENS.LOGGER)
    private readonly logger: Pick<Logger, 'info' | 'warn'>,
    @inject(CHAT_TOKENS.SESSION)
    private readonly session: Pick<ChatSessionService, 'startSession'>,
    @inject(CHAT_TOKENS.HISTORY_READ)
    private readonly historyRead: Pick<ChatHistoryReadService, 'resolveSessionFolder'>,
    @inject(SDK_TOKENS.SDK_SESSION_METADATA_STORE)
    private readonly metadataStore: Pick<SessionMetadataStore, 'get'>,
    @inject(SDK_TOKENS.SESSION_HISTORY_ROUTER)
    private readonly historyRouter: Pick<SessionHistoryRouter, 'readCarryOverTranscript'>,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_WORKSPACE_PROVIDER_PROFILE_RESOLVER)
    private readonly profileResolver: Pick<
      WorkspaceProviderProfileResolver,
      'resolveStoredModel' | 'resolveProviderProfileForWorkspace'
    >,
    @inject(SETTINGS_TOKENS.MODEL_SETTINGS)
    private readonly modelSettings: Pick<ModelSettings, 'selectedModel'>,
    /** Absent: the active provider cannot be proved, so nothing is eligible. */
    @inject(AUTH_PROVIDERS_TOKENS.SDK_ACTIVE_PROVIDER_RESOLVER, {
      isOptional: true,
    })
    private readonly activeProvider?: Pick<
      ActiveProviderResolver,
      'resolveActiveAuthForPath'
    >,
    /** Absent: the readiness probe takes the Claude-only branch, as `chat:start` does. */
    @inject(CHAT_TOKENS.RUNTIME_PROFILE, { isOptional: true })
    private readonly runtimeProfile?: Pick<
      ChatRuntimeProfileService,
      'prepare' | 'assertAuthorizedFolder'
    >,
    /** Absent: a Codex target cannot be proved signed in, so it is not eligible. */
    @inject(AUTH_PROVIDERS_TOKENS.SDK_CODEX_AUTH, { isOptional: true })
    private readonly codexAuth?: Pick<ICodexAuthService, 'isAuthenticated'>,
  ) {}

  /**
   * Read-only eligibility for the banner button and the /compact check. It
   * leaves nothing running: a proxy-backed provider is not probed here (see
   * {@link newSessionReady}). Never throws.
   */
  async check(params: ChatCarryOverCheckParams): Promise<ChatCarryOverCheckResult> {
    const eligible = await this.evaluate(
      params.sessionId,
      params.workspacePath,
      // The probe needs a tab id; no tab exists yet, so the session id labels it.
      params.sessionId,
      'offer',
    );
    return eligible
      ? { eligible: true, providerId: eligible.activeId, providerName: eligible.providerName }
      : { eligible: false };
  }

  /**
   * Called by the `SESSION_ID_RESOLVED` broadcaster: the request ID of the
   * launch that last started a session on `tabId`, once. An expired ticket
   * is dropped and the resolution goes out untagged.
   */
  claimResolutionRequestId(tabId: string): string | undefined {
    const ticket = this.resolutionTickets.get(tabId);
    if (!ticket) return undefined;
    this.resolutionTickets.delete(tabId);
    return Date.now() > ticket.until ? undefined : ticket.requestId;
  }

  /** Start the carry-over chat on the active provider. Never throws. */
  async carryOver(params: ChatCarryOverParams): Promise<ChatCarryOverResult> {
    const { sessionId } = params;
    if (this.inFlight.has(sessionId)) return failure('IN_FLIGHT');
    this.inFlight.add(sessionId);
    try {
      return await this.runCarryOver(params);
    } finally {
      this.inFlight.delete(sessionId);
    }
  }

  private async runCarryOver(params: ChatCarryOverParams): Promise<ChatCarryOverResult> {
    const { sessionId, tabId } = params;
    const eligible = await this.evaluate(sessionId, params.workspacePath, tabId, 'launch');
    if (!eligible) return failure('NOT_ELIGIBLE');
    const { folder, activeId: pinnedProviderId, providerName } = eligible;

    let rendered: ReturnType<typeof renderCarryOverPrompt>;
    try {
      const transcript = await this.historyRouter.readCarryOverTranscript(
        sessionId,
        folder,
        {
          tailBytes: CARRY_OVER_READ_TAIL_BYTES,
          signal: AbortSignal.timeout(CARRY_OVER_READ_TIMEOUT_MS),
        },
      );
      rendered = renderCarryOverPrompt(transcript);
    } catch (error: unknown) {
      this.warnStep('history read', sessionId, error);
      return failure('HISTORY_UNREADABLE');
    }
    if (!rendered) return failure('HISTORY_UNREADABLE');

    // The provider may have switched again while the history was read.
    let activeNow: string | undefined;
    try {
      activeNow = this.activeProvider?.resolveActiveAuthForPath(folder).providerId;
    } catch (error: unknown) {
      this.warnStep('provider re-check', sessionId, error);
      return failure('NOT_ELIGIBLE');
    }
    if (activeNow !== pinnedProviderId) return failure('NOT_ELIGIBLE');

    const startFailed = (
      start?: { errorCode?: CarryOverFailure['errorCode']; providerId?: string },
    ): CarryOverFailure => ({
      success: false,
      reason: 'START_FAILED',
      error: `Couldn't start a new chat with ${providerName}.`,
      ...(start?.errorCode ? { errorCode: start.errorCode } : {}),
      ...(start?.providerId ? { providerId: start.providerId } : {}),
    });

    const { requestId } = params;
    const admitted = requestId
      ? (): void => this.issueTicket(tabId, requestId)
      : undefined;
    let start: Awaited<ReturnType<ChatSessionService['startSession']>>;
    try {
      start = await this.session.startSession(
        {
          tabId,
          workspacePath: folder,
          prompt: rendered.prompt,
          ...(params.name !== undefined ? { name: params.name } : {}),
          ...(params.ptahUiFence !== undefined
            ? { ptahUiFence: params.ptahUiFence }
            : {}),
        },
        {
          expectedProviderId: pinnedProviderId,
          ...(admitted ? { onAdmitted: admitted } : {}),
        },
      );
    } catch (error: unknown) {
      // startSession result-shapes its own failures; this is a backstop.
      this.warnStep('start', sessionId, error);
      if (requestId) this.dropTicket(tabId, requestId);
      return startFailed();
    }
    if (!start.success) {
      if (requestId) this.dropTicket(tabId, requestId);
      if (start.error === CARRY_OVER_PROVIDER_CHANGED) return failure('NOT_ELIGIBLE');
      this.logger.warn('[carry-over] start failed', {
        sessionId,
        tabId,
        ...(start.errorCode ? { errorCode: start.errorCode } : {}),
        ...(start.cancelled ? { cancelled: true } : {}),
      });
      return startFailed(start);
    }

    this.logger.info('[carry-over] started', {
      sessionId,
      tabId,
      providerId: pinnedProviderId,
      source: CLAUDE_JSONL_SOURCE,
      keptTurns: rendered.keptTurns,
      omittedTurns: rendered.omittedTurns,
    });
    return { success: true, providerId: pinnedProviderId, providerName };
  }

  /**
   * Shared eligibility, cheapest step first (K22): folder, stored identity,
   * provider comparison, and only then the new-session readiness probe.
   * `null` means not eligible; it never throws.
   */
  private async evaluate(
    sessionId: SessionId,
    workspacePath: string,
    probeTabId: string,
    purpose: ProbePurpose,
  ): Promise<EligibleCarryOver | null> {
    let folder: string;
    try {
      folder = await this.historyRead.resolveSessionFolder(sessionId);
      const [sessionReal, requestedReal] = await Promise.all([
        realpath(folder),
        realpath(resolve(workspacePath)),
      ]);
      // The session's own folder only (AC 2.6).
      if (sessionReal !== requestedReal) return null;
    } catch (error: unknown) {
      // degradation-audit: reported - logged by class name; not eligible is the fail-closed answer.
      this.warnStep('folder', sessionId, error);
      return null;
    }

    let storedProviderId: string;
    try {
      const identity = storedChatRuntimeIdentity(
        sessionId,
        await this.metadataStore.get(sessionId),
        folder,
      );
      // The Claude JSONL source only. A proxy-era Codex Claude session keeps
      // its own refusal, and a native Codex session has no bounded read here.
      if (identity.runtime !== 'claude-sdk' || identity.providerId === 'openai-codex') {
        return null;
      }
      storedProviderId = identity.providerId;
    } catch (error: unknown) {
      // degradation-audit: reported - logged by class name; not eligible is the fail-closed answer.
      this.warnStep('identity', sessionId, error);
      return null;
    }

    if (!this.activeProvider) return null;
    let activeId: string;
    try {
      activeId = this.activeProvider.resolveActiveAuthForPath(folder).providerId;
    } catch (error: unknown) {
      // degradation-audit: reported - logged by class name; not eligible is the fail-closed answer.
      this.warnStep('active provider', sessionId, error);
      return null;
    }
    if (activeId === storedProviderId) return null;

    try {
      if (!(await this.newSessionReady(folder, probeTabId, activeId, purpose))) return null;
    } catch (error: unknown) {
      // degradation-audit: reported - logged by class name; not eligible is the fail-closed answer.
      this.warnStep('readiness probe', sessionId, error);
      return null;
    }
    return { folder, activeId, providerName: providerDisplayName(activeId) };
  }

  /**
   * The readiness check of a NEW session on the active provider: the same
   * resolution `chat:start` runs, with no stored identity (AC 2.3). A throw
   * means the active provider cannot start a chat (AC 1.3).
   *
   * An `'offer'` probe skips a proxy-backed provider: building its profile
   * acquires a pooled proxy, and the pool has no per-acquire release and no
   * idle TTL, so a check without a click would keep a credential-bearing
   * proxy alive. The click (`'launch'`) runs the full resolution and the
   * start refuses an unready provider with its own result.
   */
  private async newSessionReady(
    folder: string,
    probeTabId: string,
    activeId: string,
    purpose: ProbePurpose,
  ): Promise<boolean> {
    if (purpose === 'offer' && acquiresProxyOnProbe(activeId)) {
      // `prepare`'s own open-folder check, without the profile build: a
      // folder the launch would refuse gets no offer (R3). Without the
      // service the check cannot run, so the offer fails closed.
      if (!this.runtimeProfile) return false;
      this.runtimeProfile.assertAuthorizedFolder(folder);
      return true;
    }
    const model = this.modelSettings.selectedModel.get() || 'default';
    const execution = this.runtimeProfile
      ? await this.runtimeProfile.prepare(
          { tabId: probeTabId, workspaceId: folder, projectPath: folder, model },
          undefined,
          true,
        )
      : await resolveClaudeExecution(this.profileResolver, folder, model, true);
    if (execution.runtime !== 'codex-app-server') return true;
    return this.codexAuth ? (await this.codexAuth.isAuthenticated()) === true : false;
  }

  /** The adapter is about to start `tabId`'s session for `requestId`. */
  private issueTicket(tabId: string, requestId: string): void {
    const now = Date.now();
    for (const [tab, ticket] of this.resolutionTickets) {
      if (now > ticket.until) this.resolutionTickets.delete(tab);
    }
    this.resolutionTickets.set(tabId, {
      requestId,
      until: now + CARRY_OVER_REQUEST_ID_TTL_MS,
    });
  }

  /** A refused start announces nothing: drop its ticket, never a newer one. */
  private dropTicket(tabId: string, requestId: string): void {
    if (this.resolutionTickets.get(tabId)?.requestId === requestId) {
      this.resolutionTickets.delete(tabId);
    }
  }

  private warnStep(step: string, sessionId: string, error: unknown): void {
    this.logger.warn(`[carry-over] ${step} failed`, {
      sessionId,
      error: loggableErrorName(error),
    });
  }
}
