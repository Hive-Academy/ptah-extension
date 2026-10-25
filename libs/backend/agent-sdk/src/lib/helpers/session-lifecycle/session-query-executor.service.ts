/**
 * SessionQueryExecutor — owner of the SDK-query orchestration body.
 *
 * Extracted `executeQuery` (originally lines 725–961, ~300 LOC) out of
 * `SessionLifecycleManager` into this stateless coordinator. The executor:
 *   - creates the AbortController (the load-bearing identity preserved end-to-
 *     end through registration, queryFn options, and the returned result),
 *   - pre-registers the session via Registry,
 *   - seeds the message queue with the initial prompt,
 *   - calls SdkModuleLoader → SdkQueryOptionsBuilder → SDK queryFn,
 *   - connects streamInput when `isResume`,
 *   - records the resulting SDK Query on the Registry,
 *   - rolls back the orphan registration on init failure (Registry.removeSessionOnly).
 *
 * Plain class — NOT @injectable, NOT registered with tsyringe. Constructed
 * eagerly by the facade.
 *
 * Note: `executeSlashCommandQuery` lives on the facade (NOT here) to avoid a
 * `QueryExecutor → Control` forward dependency. The facade orchestrates the
 * end-then-execute sequence directly.
 */

import type { Logger } from '@ptah-extension/vscode-core';
import { randomUUID } from 'node:crypto';
import type {
  ClaudeAccountNamedRoute, ClaudeAccountRunReservation, ClaudeCertifiedLaunchContext, ClaudeLaunchBoundary,
  ClaudeLaunchBoundaryOutcome, ProviderAccountAdmissionPort, ProviderAccountPortRefusal,
} from '@ptah-extension/auth-providers-tokens';
import type { ProviderAccountBinding, ProviderAccountIdentityEvidence, ProviderAccountSelection } from '@ptah-extension/shared';
import type { AccountInfo, QueryFunction } from '../../types/sdk-types/claude-sdk.types';
import type { SessionMetadata } from '../../session-metadata-store';
import type { NamedAccountQueryHandle } from '../sdk-query-runner.service';
import { buildNamedAccountBootstrapOptions, namedActualLaunch } from '../sdk-query-options-builder';
import { CLAUDE_PERSONAL_SUBSCRIPTIONS, ClaudeCertifiedLaunchRefusal, assertCertifiedLaunch } from '../claude-certified-launch';
import { claudeIdentityReference } from '../claude-identity-reference';
import type {
  ISdkPermissionHandler,
  AuthEnv,
  EffectiveCapabilitySet,
  ICapabilityResolver,
  SubagentPromptCacheTtl,
} from '@ptah-extension/shared';
import {
  isDirectAnthropic,
  getAllAnthropicProviders,
  COPILOT_PROXY_TOKEN_PLACEHOLDER,
  CODEX_PROXY_TOKEN_PLACEHOLDER,
  OPENROUTER_PROXY_TOKEN_PLACEHOLDER,
  type ContextCapacityRoute,
} from '@ptah-extension/shared';
import type { UsageCostSource } from '../../session-stats/session-stats-owner.service';

import {
  SDKUserMessage,
  Options,
  type SDKMessage,
} from '../../types/sdk-types/claude-sdk.types';
import type { CompactionCoordinator } from '../compaction/compaction-coordinator';
import {
  COMPACTION_MAX_DWELL_MS,
  CompactionState,
  type CompactionSessionClass,
} from '../compaction/compaction-state.types';
import type {
  ContextUsageReading,
  IContextUsagePort,
} from '../compaction/context-usage.port';
import type { SubagentBudgetMonitor } from '../compaction/subagent-budget-monitor';
import { MainRequestTracker } from '../compaction/idle/idle-request-tracker';
import type { IdleCompactionSignals } from '../compaction/idle/idle-compaction.types';
import type { SdkModuleLoader } from '../sdk-module-loader';
import {
  resolveSessionCapabilityPolicy,
  type SdkQueryOptionsBuilder,
} from '../sdk-query-options-builder';
import type { SdkMessageFactory } from '../sdk-message-factory';
import type {
  ExecuteQueryConfig,
  ExecuteQueryResult,
  Query,
} from '../session-lifecycle-manager';
import type { SessionRegistry } from './session-registry.service';
import type { SessionStreamPump } from './session-stream-pump.service';
import { PERMISSION_MODE_MAP } from './permission-mode-map';
import type { SdkQueryRunner } from '../sdk-query-runner.service';
import {
  NoActivityWatchdog,
  NO_ACTIVITY_TIMEOUT_MS,
} from '../no-activity-watchdog';
import type { HarnessPolicySync } from '../../harness/harness-policy-sync';

/**
 * Classify who is authoritative for a query's dollars from its effective
 * auth route (TASK_2026_533).
 *
 * The SDK's `total_cost_usd` / `modelUsage[].costUSD` are priced by the CLI
 * for the endpoint it believes it is calling. On the native SDK-priced route
 * (no base URL, or the first-party API host) those figures are the provider's
 * own: `'reported'`. On a translated or custom endpoint the CLI prices a model
 * it does not bill, so its dollars are not authoritative: `'unreported'`, and
 * every model is priced from the rate card by its own id. This classifies
 * cost authority from the route; it never branches on a provider or model
 * name.
 */
export function classifyUsageCostSource(authEnv: AuthEnv): UsageCostSource {
  return isDirectAnthropic(authEnv) ? 'reported' : 'unreported';
}

/** Capacity identity only: never infer authority from a hostname substring. */
export function resolveCapacityRoute(authEnv: AuthEnv): ContextCapacityRoute {
  if (isDirectAnthropic(authEnv)) {
    return Object.freeze({ kind: 'native', providerId: 'anthropic' });
  }
  let providerId: string | null = null;
  try {
    const route = new URL(authEnv.ANTHROPIC_BASE_URL?.trim() ?? '');
    if (
      (route.protocol === 'http:' || route.protocol === 'https:') &&
      !route.username &&
      !route.password
    ) {
      const local = ['127.0.0.1', 'localhost', '[::1]'].includes(
        route.hostname,
      );
      if (local && !route.search && !route.hash && route.pathname === '/') {
        switch (authEnv.ANTHROPIC_AUTH_TOKEN) {
          case COPILOT_PROXY_TOKEN_PLACEHOLDER:
            providerId = 'github-copilot';
            break;
          case CODEX_PROXY_TOKEN_PLACEHOLDER:
            providerId = 'openai-codex';
            break;
          case OPENROUTER_PROXY_TOKEN_PLACEHOLDER:
            providerId = 'openrouter';
            break;
        }
      }
      if (!providerId) {
        const matches = getAllAnthropicProviders().filter((provider) => {
          if (!provider.baseUrl) return false;
          try {
            return new URL(provider.baseUrl).href === route.href;
          } catch {
            // degradation-audit: optional-capability - an invalid user-defined
            // endpoint supplies no capacity evidence.
            return false;
          }
        });
        if (matches.length === 1) providerId = matches[0].id;
      }
    }
  } catch {
    // degradation-audit: optional-capability - an invalid/custom route stays
    // usable by the query; it only leaves capacity unknown.
  }
  return Object.freeze({ kind: 'proxy', providerId });
}

/** The coordinator surface the executor drives (TASK_2026_597 A8). */
export type CompactionCoordinatorSink = Pick<
  CompactionCoordinator,
  | 'register'
  | 'unregister'
  | 'getState'
  | 'onStatusCompacting'
  | 'onCompactBoundary'
  | 'onTurnEnd'
  | 'onContextUsage'
>;

/** The subagent budget monitor surface the executor drives (TASK_2026_597 28b). */
export type SubagentBudgetSink = Pick<
  SubagentBudgetMonitor,
  'observe' | 'recordTaskStarted' | 'release' | 'currentSessionId'
>;

/** True when a message's content carries at least one block of `blockType`. */
function hasContentBlock(
  message: SDKMessage & { type: 'assistant' | 'user' },
  blockType: 'tool_use' | 'tool_result',
): boolean {
  const content: unknown = message.message?.content;
  const blocks: unknown[] = Array.isArray(content) ? content : [];
  return blocks.some(
    (b) => (b as { type?: unknown } | null)?.type === blockType,
  );
}

/**
 * Compaction bookkeeping for one query run (TASK_2026_597 A8).
 *
 * Keyed on the real SDK session id, read from the main-loop messages: that is
 * the id the PreCompact/PostCompact hooks forward to the coordinator and the
 * id `endSession` hands to the session-end registry. It registers the session
 * on the first id it sees, feeds `status:'compacting'` and `compact_boundary`
 * to the coordinator, and at each main-loop `result` closes the turn and asks
 * the context-usage port for one reading. Every call is fail-open: a
 * coordinator or port failure writes one warn line and the turn goes on.
 */
type RouteAwareIdleSignals = IdleCompactionSignals & {
  sessionBound(
    sessionId: string,
    runToken: string,
    codexProxy: boolean,
    nativeAnthropic?: boolean,
  ): void;
};

class CompactionSessionTap {
  private sessionId: string | null = null;
  private readonly trackedIds = new Set<string>();
  private query: Query | null = null;
  private turn = 0;
  private readonly subagentIds = new Set<string>();
  private released = false;
  /** Unset until the options build resolves it; the monitor default applies. */
  private subagentCacheTtl: SubagentPromptCacheTtl | undefined;
  private readonly requestTracker = new MainRequestTracker(Date.now());

  constructor(
    private readonly logger: Logger,
    private readonly coordinator: CompactionCoordinatorSink | null,
    private readonly port: IContextUsagePort | null,
    private readonly sessionClass: CompactionSessionClass,
    /** Unique per query run, so a resumed run never reuses a cached turn read. */
    private readonly runToken: string,
    private readonly runOrder: number,
    /**
     * Session id → creation order of the run that bound it last, shared by
     * every run of the executor. `release` skips an id a newer run has bound.
     */
    private readonly runOwners: Map<string, number>,
    private readonly subagentMonitor: SubagentBudgetSink | null = null,
    private readonly idle: RouteAwareIdleSignals | null = null,
    private readonly nativeAnthropic = false,
  ) {}

  attachQuery(query: Query): void {
    this.query = query;
  }

  /**
   * The session's effective subagent prompt-cache TTL, known only once the
   * options builder has run (the tap exists before it). The monitor prices
   * cache writes with it when a message does not report its TTL split.
   */
  setSubagentCacheTtl(ttl: SubagentPromptCacheTtl | undefined): void {
    this.subagentCacheTtl = ttl;
  }

  observe(message: SDKMessage): void {
    if (this.released) return;
    try {
      this.handle(message);
    } catch (error: unknown) {
      // A malformed message must not break the stream loop that called us.
      this.warn('Compaction tap failed on a stream message', 'observe', error);
    }
  }

  private handle(message: SDKMessage): void {
    if ('parent_tool_use_id' in message && message.parent_tool_use_id) {
      this.feedSubagentMonitor(message);
      return;
    }
    const id =
      'session_id' in message && typeof message.session_id === 'string'
        ? message.session_id
        : '';
    if (id && id !== this.sessionId) this.bind(id);
    const sessionId = this.sessionId;
    if (sessionId === null) return;
    if (
      this.requestTracker.observe(message, Date.now()) === 'request-started'
    ) {
      this.guardIdle('request-started', (idle) =>
        idle.requestStarted(sessionId),
      );
    }
    if (message.type === 'rate_limit_event') {
      const status = message.rate_limit_info?.status;
      if (
        status === 'allowed' ||
        status === 'allowed_warning' ||
        status === 'rejected'
      ) {
        this.guardIdle('rate-limit', (idle) =>
          idle.rateLimit(sessionId, status),
        );
      }
    }
    if (message.type === 'system') {
      if (message.subtype === 'status' && message.status === 'compacting') {
        this.guard('status-compacting', (c) => c.onStatusCompacting(sessionId));
      } else if (message.subtype === 'compact_boundary') {
        const { pre_tokens, post_tokens } = message.compact_metadata;
        this.guard('compact-boundary', (c) =>
          c.onCompactBoundary(sessionId, {
            preTokens: pre_tokens,
            postTokens: post_tokens,
          }),
        );
        this.guardIdle('compact-boundary', (idle) =>
          idle.compactBoundary(
            sessionId,
            Number.isFinite(pre_tokens) ? pre_tokens : null,
          ),
        );
      } else if (message.subtype === 'task_started' && message.tool_use_id) {
        this.recordTaskStarted(
          message,
          message.tool_use_id,
          message.task_id,
          message.subagent_type,
        );
      }
    } else if (message.type === 'result') {
      this.onTurnEnd(sessionId);
    } else if (
      (message.type === 'assistant' && hasContentBlock(message, 'tool_use')) ||
      (message.type === 'user' && hasContentBlock(message, 'tool_result'))
    ) {
      // The monitor reads a subagent's task from its spawning tool_use and
      // whether that call already returned (background) from the tool_result.
      this.feedSubagentMonitor(message);
    }
  }

  /**
   * A subagent message (or a main-loop message that may spawn one) goes to
   * the budget monitor under the session id the dispatcher and registry use,
   * priced with the session's effective subagent prompt-cache TTL (the
   * monitor's default while the build has not set one).
   */
  private feedSubagentMonitor(message: SDKMessage): void {
    const monitor = this.subagentMonitor;
    if (!monitor) return;
    const id = this.monitorSessionId(message);
    if (!id) return;
    const cacheTtl = this.subagentCacheTtl;
    // The executor runs observe() now; a synchronous throw becomes a rejection.
    new Promise<void>((resolve) =>
      resolve(monitor.observe(id, message, cacheTtl)),
    ).catch((error: unknown) =>
      this.warn('Subagent budget monitor failed', 'subagent-budget', error),
    );
  }

  /**
   * The SDK's `task_started` gives the task id a subagent stop needs, keyed
   * by the spawning tool_use id. Recorded under the same session id as the
   * subagent's messages. Non-agent tasks go through too; the monitor never
   * matches their tool_use id to a subagent.
   */
  private recordTaskStarted(
    message: SDKMessage,
    toolUseId: string,
    taskId: string,
    subagentType: string | undefined,
  ): void {
    const monitor = this.subagentMonitor;
    if (!monitor) return;
    const id = this.monitorSessionId(message);
    if (!id) return;
    try {
      monitor.recordTaskStarted(id, toolUseId, taskId, subagentType);
    } catch (error: unknown) {
      this.warn(
        'Subagent budget monitor failed to record a task start',
        'subagent-task-started',
        error,
      );
    }
  }

  /**
   * The session id the dispatcher and registry use for a message: its own
   * `session_id`, else the run's bound id. Tracked for release at session end.
   */
  private monitorSessionId(message: SDKMessage): string | null {
    const id =
      'session_id' in message && typeof message.session_id === 'string'
        ? message.session_id
        : this.sessionId;
    if (!id) return null;
    this.subagentIds.add(id);
    return id;
  }

  /**
   * Whether the coordinator acts on this run's session (any state but
   * OBSERVE_ONLY). Gates the watchdog's compaction dwell bound; an unknown
   * session counts as observe-only, which never cuts a compaction.
   */
  controlsSession(): boolean {
    const sessionId = this.sessionId;
    if (this.released || !this.coordinator || sessionId === null) return false;
    const state = this.coordinator.getState(sessionId);
    return state !== undefined && state !== CompactionState.OBSERVE_ONLY;
  }

  /**
   * Session end: drop every id this run tracked, plus the id a PostCompact
   * rekey moved each one to (FM-5: the stream can end before any message
   * carries the new id). An id a newer run has bound since is left to that
   * run (FM-9). Idempotent: the abort listener and the stream's `onStreamEnd`
   * (every stream teardown, normal end included — TASK_2026_614 D.2) both
   * call it.
   */
  release(): void {
    if (this.released) return;
    this.released = true;
    // Resolve before releasing: the monitor drops its aliases on release.
    const ids = new Set<string>();
    for (const id of [...this.trackedIds, ...this.subagentIds]) {
      ids.add(id);
      ids.add(this.currentId(id));
    }
    this.trackedIds.clear();
    this.subagentIds.clear();
    for (const id of ids) {
      const owner = this.runOwners.get(id);
      if (owner !== undefined && owner !== this.runOrder) continue;
      this.runOwners.delete(id);
      try {
        this.subagentMonitor?.release(id);
      } catch (error: unknown) {
        this.warn(
          'Subagent budget monitor failed on release',
          'release',
          error,
        );
      }
      this.guard('release', (c) => c.unregister(id));
      this.guardIdle('release', (idle) => idle.sessionReleased(id));
      try {
        this.port?.release(id);
      } catch (error: unknown) {
        this.warn('Context-usage port failed on release', 'release', error);
      }
    }
  }

  /**
   * The id `id` lives on as after the PostCompact rekeys so far. The monitor
   * records every rekey the hook handler reports; without a monitor, or when
   * it fails, the id is taken as current.
   */
  private currentId(id: string): string {
    const monitor = this.subagentMonitor;
    if (!monitor) return id;
    try {
      return monitor.currentSessionId(id);
    } catch (error: unknown) {
      this.warn('Subagent budget monitor failed on id lookup', 'rekey', error);
      return id;
    }
  }

  /**
   * A new id (first `init`, a fork, or a PostCompact rebind). When the hook
   * already moved the record to this id the coordinator knows it and the tap
   * only follows. The previous id stays tracked until release, so a rebind
   * that lands after this message still finds its source record.
   */
  private bind(id: string): void {
    this.sessionId = id;
    this.trackedIds.add(id);
    const owner = this.runOwners.get(id);
    if (owner === undefined || owner <= this.runOrder) {
      this.runOwners.set(id, this.runOrder);
    }
    this.guard('register', (c) => {
      if (c.getState(id) !== undefined) return;
      const state = c.register(id, this.sessionClass);
      this.logger.info(
        '[SessionLifecycle] Compaction coordinator tracking session',
        { sessionId: id, state, codexProxy: this.sessionClass.codexProxy },
      );
    });
    this.guardIdle('session-bound', (idle) =>
      idle.sessionBound(
        id,
        this.runToken,
        this.sessionClass.codexProxy,
        this.nativeAnthropic,
      ),
    );
  }

  private onTurnEnd(sessionId: string): void {
    this.guard('turn-end', (c) => c.onTurnEnd(sessionId));
    this.turn += 1;
    const turnId = `${this.runToken}:${this.turn}`;
    this.guardIdle('turn-end', (idle) =>
      idle.turnEnded(
        sessionId,
        turnId,
        this.requestTracker.endTurn(Date.now()),
      ),
    );
    const port = this.port;
    const query = this.query;
    if (!port || !query) return;
    // The executor reads now; a synchronous throw becomes a rejection.
    new Promise<ContextUsageReading | undefined>((resolve) =>
      resolve(port.readAtTurnEnd(sessionId, turnId, query)),
    )
      .then((reading) => {
        const current = this.currentId(this.sessionId ?? sessionId);
        this.guardIdle('turn-context', (idle) =>
          idle.turnContext(current, turnId, reading?.totalTokens ?? null),
        );
        if (!reading || this.released) return;
        // A PostCompact during the read moved the record (and the port's
        // reading) to a new id: feed the id the session has now (FM-4).
        this.guard('context-usage', (c) => c.onContextUsage(current, reading));
      })
      .catch((error: unknown) =>
        this.warn('Context-usage port failed at turn end', 'turn-end', error),
      );
  }

  private guard(
    event: string,
    fn: (coordinator: CompactionCoordinatorSink) => unknown,
  ): void {
    if (!this.coordinator) return;
    try {
      fn(this.coordinator);
    } catch (error: unknown) {
      this.warn('Compaction coordinator failed', event, error);
    }
  }

  private guardIdle(
    event: string,
    fn: (idle: RouteAwareIdleSignals) => void,
  ): void {
    if (!this.idle) return;
    try {
      fn(this.idle);
    } catch (error: unknown) {
      this.warn('Idle compaction signal failed', event, error);
    }
  }

  private warn(text: string, event: string, error: unknown): void {
    this.logger.warn(`[SessionLifecycle] ${text}; the turn continues`, {
      event,
      sessionId: this.sessionId,
      error: error instanceof Error ? error.name : typeof error,
    });
  }
}

/** Token-only host boundary. No auth-providers implementation may be imported here.
 * resolveAccountBinding must require BOTH the authoritative SDK link and matching
 * metadata for a named session; an incomplete checkpoint is never resumable.
 */
export interface NamedAccountPersistencePort {
  resolveAccountBinding(sdkSessionId: string): Promise<ProviderAccountBinding | null>;
  commitRunBinding(route: ClaudeAccountNamedRoute, reservation: ClaudeAccountRunReservation,
    identity: ProviderAccountIdentityEvidence): Promise<ProviderAccountBinding>;
  attachSdkSession(request: { provider: string; sdkSessionId: string; runId: string; attachedAt: number }):
    Promise<{ status: 'attached' | 'binding-absent' | 'session-linked-elsewhere' | 'run-linked-elsewhere' }>;
  saveAccountBound(metadata: SessionMetadata, binding: ProviderAccountBinding): Promise<void>;
  assertRouteCurrent(route: ClaudeAccountNamedRoute): Promise<void>;
  onAuthEpochChanged(listener: (route: ClaudeAccountNamedRoute) => void): () => void;
  /** Route revalidation and policy re-scan right before one SDK child starts. */
  checkLaunchBoundary(route: ClaudeAccountNamedRoute, launch: ClaudeCertifiedLaunchContext,
    boundary: ClaudeLaunchBoundary, signal: AbortSignal): Promise<ClaudeLaunchBoundaryOutcome>;
}

const NAMED_REFUSAL_SUMMARY = 'Named account admission could not be completed.';
const issuedRefusals = new WeakSet<object>();

/** Fixed, path-free typed refusal. A refusal with no stated code is `identity-unproved`. */
export function namedAccountRefusal(code: ProviderAccountPortRefusal['code'] = 'identity-unproved'): ProviderAccountPortRefusal {
  const refusal: ProviderAccountPortRefusal = { code, summary: NAMED_REFUSAL_SUMMARY };
  issuedRefusals.add(refusal);
  return refusal;
}

function isNamedRefusal(error: unknown): error is ProviderAccountPortRefusal {
  return typeof error === 'object' && error !== null && issuedRefusals.has(error);
}

/**
 * The refusal code an error carries: a named refusal's or a certified-launch
 * refusal's own code. Any other error is `release-held`, so no foreign error
 * field reaches a caller.
 */
function namedRefusalCode(error: unknown): ProviderAccountPortRefusal['code'] {
  if (isNamedRefusal(error) || error instanceof ClaudeCertifiedLaunchRefusal) return error.code;
  return 'release-held';
}

/** Init key sources a certified named child may report. */
const CERTIFIED_INIT_KEY_SOURCES: ReadonlySet<string> = new Set(['none', 'oauth']);

/**
 * Post-init tripwire and identity: the running child must use a personal
 * claude.ai login (no API key source, first-party provider, a personal
 * subscription word) and be the account its launch was certified for. Any
 * mismatch, an unknown identity included, refuses `identity-unproved`.
 */
function namedIdentity(account: AccountInfo, launch: ClaudeCertifiedLaunchContext): ProviderAccountIdentityEvidence {
  const personal: readonly string[] = CLAUDE_PERSONAL_SUBSCRIPTIONS;
  if (account.tokenSource !== 'claude.ai' ||
      (account.apiKeySource !== undefined && account.apiKeySource !== 'none') ||
      (account.apiProvider !== undefined && account.apiProvider !== 'firstParty') ||
      account.subscriptionType === undefined || !personal.includes(account.subscriptionType)) {
    throw namedAccountRefusal('identity-unproved');
  }
  const ownerKey = claudeIdentityReference(account.email, account.organization);
  if (ownerKey === null || ownerKey !== launch.identityReference) throw namedAccountRefusal('identity-unproved');
  return { kind: 'known', ownerKey };
}

function sameNamedIdentity(left: ProviderAccountIdentityEvidence, right: ProviderAccountIdentityEvidence): boolean {
  return left.kind === 'known' && right.kind === 'known'
    ? left.ownerKey === right.ownerKey : left.kind === right.kind;
}

/** An empty gate that does not even pull caller-owned conversation until commit. */
class NamedQueryGate {
  private open = false;
  private closed = false;
  private wake!: () => void;
  private readonly ready = new Promise<void>((resolve) => { this.wake = resolve; });
  commit(): void { if (!this.closed) { this.open = true; this.wake(); } }
  close(): void { this.closed = true; this.wake(); }
  async *stream(source?: AsyncIterable<SDKUserMessage>, approve?: () => Promise<void>): AsyncIterable<SDKUserMessage> {
    await this.ready;
    if (!this.open || this.closed || !source) return;
    for await (const message of source) {
      if (this.closed) return;
      await approve?.();
      if (this.closed) return;
      yield message;
    }
  }
}

/** Named-only lifecycle. The ambient executor never constructs this object. */
export class NamedAccountQueryAdmission {
  route!: ClaudeAccountNamedRoute;
  certifiedLaunch?: ClaudeCertifiedLaunchContext;
  /** True while a boundary check's own children are not proved closed. */
  private boundaryUnproved = false;
  private reservation?: ClaudeAccountRunReservation;
  private baseline?: ProviderAccountIdentityEvidence;
  private storedBinding?: ProviderAccountBinding;
  private resumeSdkSessionId?: string;
  private child?: NamedAccountQueryHandle;
  private termination?: Promise<void>;
  private readonly gates: NamedQueryGate[] = [];
  private stopEpoch?: () => void;
  private settlement?: Promise<void>;
  private readonly onAbort = (): void => {
    for (const gate of this.gates) gate.close();
    this.closeChild();
    void this.dispose().catch(() => this.logger.warn('[SessionLifecycle] Account reservation settlement failed.'));
  };

  constructor(
    private readonly runner: Pick<SdkQueryRunner, 'invokeNamedQuery'>,
    private readonly admission: ProviderAccountAdmissionPort,
    private readonly persistence: NamedAccountPersistencePort,
    private readonly registry: Pick<SessionRegistry, 'bindAccountRoute' | 'invalidateAccountRoute'>,
    private readonly logger: Pick<Logger, 'warn'>,
    private readonly abortController: AbortController,
    private readonly deadlineMs = 15_000,
  ) {
    abortController.signal.addEventListener('abort', this.onAbort, { once: true });
    if (abortController.signal.aborted) this.onAbort();
  }

  /** Every admission await is cancellable; late resolutions never advance the flow. */
  async wait<T>(pending: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    try {
      const value = await Promise.race([
        pending,
        new Promise<never>((_resolve, reject) => {
          cancel = () => reject(namedAccountRefusal('release-held'));
          this.abortController.signal.addEventListener('abort', cancel, { once: true });
          if (this.abortController.signal.aborted) cancel();
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => { this.abortController.abort(); reject(namedAccountRefusal('release-held')); }, this.deadlineMs);
        }),
      ]);
      if (this.abortController.signal.aborted) throw namedAccountRefusal('release-held');
      return value;
    } finally {
      clearTimeout(timer);
      if (cancel) this.abortController.signal.removeEventListener('abort', cancel);
    }
  }

  async bootstrap(queryFn: QueryFunction, selection: ProviderAccountSelection,
    resumeSessionId?: string, forkSession = false): Promise<void> {
    try {
      // Resolve authoritative evidence before constructing ANY conversation options.
      const stored = resumeSessionId
        ? await this.wait(this.persistence.resolveAccountBinding(resumeSessionId)) : null;
      if (resumeSessionId && (!stored || stored.identity.kind === 'unknown')) throw namedAccountRefusal();
      this.storedBinding = forkSession ? undefined : stored ?? undefined;
      this.resumeSdkSessionId = forkSession ? undefined : resumeSessionId;
      const pending = this.admission.admitClaudeRoute({ provider: 'claude', scope: 'main',
        selection, operationId: randomUUID(), runId: this.storedBinding?.runId ?? randomUUID() }).then(async (result) => {
        if (result.code === 'ok') {
          this.reservation = result.reservation;
          if (this.abortController.signal.aborted) await this.dispose();
        }
        return result;
      });
      const admitted = await this.wait(pending);
      if (admitted.code !== 'ok') throw namedAccountRefusal(admitted.code);
      if (admitted.resources.kind !== 'named') throw namedAccountRefusal();
      this.route = admitted.resources.route;
      // No certified launch: refuse before any bootstrap options or child exist.
      const launch = admitted.resources.launch;
      if (!launch) throw namedAccountRefusal('identity-unproved');
      this.certifiedLaunch = launch;
      if (stored && (stored.provider !== this.route.provider || stored.profileId !== this.route.profileId ||
          stored.routeFingerprint !== this.route.routeFingerprint || stored.routeRevision !== this.route.routeRevision)) {
        throw namedAccountRefusal();
      }
      this.stopEpoch = this.persistence.onAuthEpochChanged((changed) => {
        this.registry.invalidateAccountRoute(changed);
        if (changed.routeFingerprint === this.route.routeFingerprint && changed.authEpoch > this.route.authEpoch) {
          this.abortController.abort();
          void this.dispose().catch(() => this.logger.warn('[SessionLifecycle] Account reservation settlement failed.'));
        }
      });
      await this.wait(this.persistence.assertRouteCurrent(this.route));
      const bootstrapOptions = buildNamedAccountBootstrapOptions(this.route, new AbortController(), launch);
      await this.checkBoundary(bootstrapOptions, 'bootstrap');
      const gate = new NamedQueryGate();
      this.gates.push(gate);
      this.child = this.runner.invokeNamedQuery(queryFn, gate.stream(), bootstrapOptions,
        (termination) => { this.termination = termination; });
      const identity = namedIdentity(await this.wait(this.child.sdkQuery.accountInfo()), launch);
      if (stored && !sameNamedIdentity(stored.identity, identity)) throw namedAccountRefusal();
      this.baseline = stored?.identity ?? identity;
      gate.close();
      this.child.sdkQuery.close();
      await this.wait(this.child.terminated);
      this.child = undefined;
      this.termination = undefined;
    } catch (error: unknown) {
      await this.dispose();
      throw namedAccountRefusal(namedRefusalCode(error));
    }
  }

  /**
   * Both checks that must pass right before one SDK child starts: the options
   * against the certified launch (no I/O), then the host boundary check (route
   * revalidation and policy re-scan). The query factory is never reached on a
   * refusal.
   */
  private async checkBoundary(options: Options, boundary: ClaudeLaunchBoundary): Promise<void> {
    const launch = this.certifiedLaunch;
    if (!launch) throw namedAccountRefusal('identity-unproved');
    assertCertifiedLaunch(launch, namedActualLaunch(options), boundary);
    // Unproved until an outcome proves the check's children closed: an abort
    // or deadline during the check settles by retaining the reservation.
    this.boundaryUnproved = true;
    const outcome = await this.wait(this.persistence.checkLaunchBoundary(this.route, launch, boundary,
      this.abortController.signal));
    if (outcome.ok) {
      this.boundaryUnproved = false;
      return;
    }
    this.boundaryUnproved = !outcome.terminated;
    throw namedAccountRefusal(outcome.code);
  }

  async launch(queryFn: QueryFunction, source: AsyncIterable<SDKUserMessage>, options: Options,
    registerKey: string, metadata: Omit<SessionMetadata, 'sessionId'>): Promise<Query> {
    const gate = new NamedQueryGate();
    this.gates.push(gate);
    let admitted = false;
    const canUseTool = options.canUseTool;
    try {
      if (this.abortController.signal.aborted) throw namedAccountRefusal('release-held');
      const launch = this.certifiedLaunch;
      if (!launch) throw namedAccountRefusal('identity-unproved');
      await this.checkBoundary(options, 'final');
      this.child = this.runner.invokeNamedQuery(queryFn, gate.stream(source, async () => {
        try { await this.verifyIdentity(); }
        catch (error: unknown) { await this.dispose(); throw namedAccountRefusal(namedRefusalCode(error)); }
      }), { ...options, canUseTool: (tool, input, context) => admitted && !this.abortController.signal.aborted && canUseTool
        ? canUseTool(tool, input, context)
        : Promise.resolve({ behavior: 'deny', message: 'Account admission pending.' }) },
        (termination) => { this.termination = termination; });
      await this.verifyIdentity();
      const query = this.child.sdkQuery;
      const buffered: SDKMessage[] = [];
      let sdkSessionId: string | undefined;
      while (!sdkSessionId) {
        const next = await this.wait(query.next());
        if (next.done) throw namedAccountRefusal('release-held');
        buffered.push(next.value);
        if (next.value.type === 'system' && next.value.subtype === 'init') {
          // The running CLI must be the certified version on a login key source.
          if (next.value.claude_code_version !== launch.executable.version ||
              !CERTIFIED_INIT_KEY_SOURCES.has(next.value.apiKeySource)) throw namedAccountRefusal('identity-unproved');
          sdkSessionId = next.value.session_id;
        }
        if (buffered.length > 64) throw namedAccountRefusal('release-held');
      }
      if (!this.registry.bindAccountRoute(registerKey, this.route) || !this.reservation || !this.baseline) {
        throw namedAccountRefusal('release-held');
      }
      if (this.resumeSdkSessionId && this.resumeSdkSessionId !== sdkSessionId) throw namedAccountRefusal('release-held');
      // An ordinary resume keeps the immutable SDK attachment and binding.
      // Forks create a new run/link, while checking the original owner's baseline.
      const binding = this.storedBinding ?? await this.wait(
        this.persistence.commitRunBinding(this.route, this.reservation, this.baseline));
      if (binding.provider !== this.route.provider || binding.profileId !== this.route.profileId ||
          binding.runId !== this.route.runId || binding.routeFingerprint !== this.route.routeFingerprint ||
          binding.routeRevision !== this.route.routeRevision ||
          (this.storedBinding ? binding.authEpoch > this.route.authEpoch : binding.authEpoch !== this.route.authEpoch) ||
          !sameNamedIdentity(binding.identity, this.baseline)) throw namedAccountRefusal();
      const attached = await this.wait(this.persistence.attachSdkSession({ provider: 'claude', sdkSessionId,
        runId: binding.runId, attachedAt: Date.now() }));
      if (attached.status !== 'attached') throw namedAccountRefusal('release-held');
      await this.wait(this.persistence.saveAccountBound({ ...metadata, sessionId: sdkSessionId }, binding));
      await this.verifyIdentity();
      admitted = true;
      gate.commit();
      void this.child.terminated.then(() => this.dispose()).catch(() =>
        this.logger.warn('[SessionLifecycle] Account reservation settlement failed.'));
      // Replay init exactly once to the normal transformer; it remains the owner
      // of stats/session-id callbacks. No control-stage message escapes on failure.
      const next = async (): Promise<IteratorResult<SDKMessage, void>> => {
        const value = buffered.shift();
        return value ? { done: false, value } : query.next();
      };
      return new Proxy(query, { get(target, key) {
        if (key === 'next') return next;
        if (key === Symbol.asyncIterator) return () => ({ next });
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    } catch (error: unknown) {
      await this.dispose();
      throw namedAccountRefusal(namedRefusalCode(error));
    }
  }

  private async verifyIdentity(): Promise<void> {
    const launch = this.certifiedLaunch;
    if (!this.child || !this.baseline || !launch) throw namedAccountRefusal('release-held');
    await this.wait(this.persistence.assertRouteCurrent(this.route));
    const identity = namedIdentity(await this.wait(this.child.sdkQuery.accountInfo()), launch);
    if (!sameNamedIdentity(this.baseline, identity)) throw namedAccountRefusal();
  }

  private closeChild(): void {
    try { this.child?.sdkQuery.close(); }
    catch { this.logger.warn('[SessionLifecycle] Named account child close was not confirmed.'); }
  }

  async dispose(): Promise<void> {
    for (const gate of this.gates) gate.close();
    this.closeChild();
    this.stopEpoch?.();
    this.abortController.signal.removeEventListener('abort', this.onAbort);
    if (!this.reservation) return;
    if (this.settlement) return this.settlement;
    const reservation = this.reservation;
    this.settlement = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let terminated = !this.termination;
      try {
        if (this.termination) terminated = await Promise.race([
          this.termination.then(() => true),
          new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), this.deadlineMs); }),
        ]);
      } finally { clearTimeout(timer); }
      const command = { reservationId: reservation.reservationId, operationId: reservation.operationId,
        authEpoch: reservation.authEpoch };
      // Release only when every owned child, boundary probes included, is proved closed.
      const result = terminated && !this.boundaryUnproved
        ? await this.admission.releaseReservation({ ...command, reason: 'child-closed' })
        : await this.admission.retainUnresolvedReservation(command);
      if (result.code !== 'ok') this.logger.warn('[SessionLifecycle] Named account reservation remains held.');
    })();
    return this.settlement;
  }
}

export class SessionQueryExecutor {
  /** Latest run order for each real session id; see `CompactionSessionTap.release`. */
  private readonly runOwners = new Map<string, number>();
  private nextRunOrder = 0;

  constructor(
    private readonly logger: Logger,
    private readonly registry: SessionRegistry,
    private readonly streamPump: SessionStreamPump,
    private readonly permissionHandler: ISdkPermissionHandler,
    private readonly moduleLoader: SdkModuleLoader,
    private readonly queryOptionsBuilder: SdkQueryOptionsBuilder,
    private readonly messageFactory: SdkMessageFactory,
    private readonly authEnv: AuthEnv,
    private readonly queryRunner: SdkQueryRunner,
    /**
     * The capability policy (TASK_2026_560, C5). Missing means unverified: the
     * session runs fail-closed — strict MCP with ptah only, no skills, and no
     * harness sync.
     */
    private readonly capabilityResolver: ICapabilityResolver | null = null,
    /**
     * Brings the harness in line with the policy fingerprint before the query
     * is built. Optional: a host with no harness has nothing to sync.
     */
    private readonly harnessPolicySync: Pick<
      HarnessPolicySync,
      'apply'
    > | null = null,
    /**
     * A8 compaction coordinator and per-turn context reader (TASK_2026_597).
     * Optional: without them the run keeps no compaction bookkeeping.
     */
    private readonly compactionCoordinator: CompactionCoordinatorSink | null = null,
    private readonly contextUsagePort: IContextUsagePort | null = null,
    private readonly subagentBudgetMonitor: SubagentBudgetSink | null = null,
    private readonly idle: IdleCompactionSignals | null = null,
  ) {}

  /**
   * Execute an SDK query with all the orchestration steps
   * Consolidates the common flow between startChatSession and resumeSession
   *
   * @param config - Query execution configuration
   * @returns Query instance, model, and abort controller
   *
   * @example
   * ```typescript
   * const result = await sessionLifecycle.executeQuery({
   *   sessionId: trackingId,
   *   sessionConfig: config,
   *   initialPrompt: { content: 'Hello', files: [] },
   * });
   * return streamTransformer.transform({ sdkQuery: result.sdkQuery, ... });
   * ```
   */
  async executeQuery(config: ExecuteQueryConfig): Promise<ExecuteQueryResult> {
    const {
      sessionId,
      sessionConfig,
      resumeSessionId,
      initialPrompt,
      onCompactionStart,
      onWorktreeCreated,
      onWorktreeRemoved,
      mcpServerRunning = true,
      enhancedPromptsContent,
      permissionLevel,
      pathToClaudeCodeExecutable,
      forkSession,
      enableFileCheckpointing,
      includePartialMessages,
      mcpServersOverride,
      initialUserQuery,
      authEnvOverride,
    } = config;

    this.logger.info(
      `[SessionLifecycle] Executing query for session: ${sessionId}`,
      {
        isResume: !!resumeSessionId,
        hasInitialPrompt: !!initialPrompt,
      },
    );

    const abortController = new AbortController();

    // The route this query will actually talk to, honouring a per-session
    // provider profile. Snapshotted once, here: the global env object is
    // mutated in place on auth changes, and the async initialisation below
    // must build the SDK query from the same route that classified its cost
    // authority and context-capacity provider.
    const effectiveAuthEnv: Readonly<AuthEnv> = Object.freeze({
      ...(authEnvOverride ?? this.authEnv),
    });
    const registerKey = sessionConfig?.tabId ?? (sessionId as string);
    const knownRealSessionId = resumeSessionId
      ? (sessionId as string)
      : undefined;
    const rec = this.registry.register(
      registerKey,
      sessionConfig || {},
      abortController,
      knownRealSessionId,
      {
        usageCostSource: classifyUsageCostSource(effectiveAuthEnv),
        authEnv: effectiveAuthEnv,
      },
      resolveCapacityRoute(effectiveAuthEnv),
    );
    const selection = (sessionConfig as { accountSelection?: ProviderAccountSelection } | undefined)?.accountSelection;
    let named: NamedAccountQueryAdmission | undefined;
    let namedQueryFn: QueryFunction | undefined;
    if (selection?.kind === 'named') {
      try {
        if (authEnvOverride && (authEnvOverride.ANTHROPIC_API_KEY || authEnvOverride.ANTHROPIC_AUTH_TOKEN ||
            authEnvOverride.ANTHROPIC_BASE_URL)) throw namedAccountRefusal('wrong-provider');
        const admission = this.queryRunner.accountAdmission;
        const persistence = this.queryRunner.accountPersistence;
        if (!admission || !persistence) throw namedAccountRefusal('release-held');
        named = new NamedAccountQueryAdmission(this.queryRunner, admission, persistence,
          this.registry, this.logger, abortController);
        namedQueryFn = await named.wait(this.moduleLoader.getQueryFunction());
        await named.bootstrap(namedQueryFn, selection, resumeSessionId, forkSession);
      } catch (error) {
        await named?.dispose();
        this.registry.remove(rec);
        abortController.abort();
        throw error;
      }
    }
    const initialContent = initialPrompt?.content.trim() || '';
    // Every prompt is queued the same way — a slash command is NOT special-
    // cased, and attachments ride this same queue. A raw string prompt is what
    // sets the SDK's `isSingleUserTurn` and closes the input on the first
    // `result`; see the `slash-command-interceptor.ts` header for why that was
    // believed to be required and why it is not (TASK_2026_472).
    if (initialContent) {
      const createMessage = this.messageFactory.createUserMessage({
        content: initialPrompt!.content, // eslint-disable-line @typescript-eslint/no-non-null-assertion
        sessionId,
        files: initialPrompt!.files, // eslint-disable-line @typescript-eslint/no-non-null-assertion
        images: initialPrompt!.images, // eslint-disable-line @typescript-eslint/no-non-null-assertion
      });
      let sdkUserMessage: SDKUserMessage;
      try { sdkUserMessage = await (named ? named.wait(createMessage) : createMessage); }
      catch (error) {
        if (named) { await named.dispose(); this.registry.remove(rec); abortController.abort(); }
        throw error;
      }
      rec.messageQueue.push(sdkUserMessage);
      this.logger.info(
        `[SessionLifecycle] Queued initial prompt for session ${sessionId}`,
      );
    }
    // No-stream-activity watchdog. Replaces the old stderr-pattern
    // `onProviderError` abort: rather than guessing "stuck" from stderr text
    // (brittle in both directions), we surface a stuck session when the SDK
    // query produces no stream activity for the window. The watchdog is
    // started/kicked/stopped by the StreamTransformer as it consumes the
    // stream (kick on every event → reset), so a long-but-alive turn (long
    // tool call, extended thinking, slow stream) never trips it. Declared
    // before the try so the init-failure rollback can stop() it.
    const providerBaseUrl =
      effectiveAuthEnv.ANTHROPIC_BASE_URL?.trim() || 'default';
    const providerModel = sessionConfig?.model ?? 'unknown';
    // The Codex proxy path and every class whose E2 has not passed (all of
    // them today: `e2Passed` is null) register OBSERVE_ONLY.
    const compactionTap = new CompactionSessionTap(
      this.logger,
      this.compactionCoordinator,
      this.contextUsagePort,
      {
        codexProxy: rec.capacityRoute?.providerId === 'openai-codex',
        e2Passed: null,
      },
      rec.token,
      ++this.nextRunOrder,
      this.runOwners,
      this.subagentBudgetMonitor,
      this.idle,
      rec.capacityRoute?.kind === 'native',
    );
    abortController.signal.addEventListener(
      'abort',
      () => compactionTap.release(),
      { once: true },
    );
    const activityWatchdog = new NoActivityWatchdog(
      NO_ACTIVITY_TIMEOUT_MS,
      (cause) => {
        if (abortController.signal.aborted) {
          return;
        }
        const seconds = Math.round(NO_ACTIVITY_TIMEOUT_MS / 1000);
        const dwellSeconds = Math.round(COMPACTION_MAX_DWELL_MS / 1000);
        this.logger.error(
          cause === 'compaction-dwell'
            ? `[SessionLifecycle] Session ${sessionId} compaction did not finish within ${dwellSeconds}s — ` +
                `stopping for recovery (requestedModel=${providerModel}, resolvedModel=${rec.currentModel})`
            : `[SessionLifecycle] Session ${sessionId} produced no stream activity for ${seconds}s — ` +
                `recovering unaccounted silence; liveness unknown (requestedModel=${providerModel}, resolvedModel=${rec.currentModel})`,
        );
        // Invariant (session-lifecycle-abort / stream-closed-abort): resolve
        // pending permissions BEFORE the abort tears down the CLI stream, so
        // an in-flight can_use_tool cannot wedge the UI, and the CLI-internal
        // "Stream closed" rejection stays benign teardown rather than a real
        // error. Mirrors endSession()'s cleanup-first ordering.
        try {
          this.permissionHandler.cleanupPendingPermissions(rec.tabId);
        } catch (cleanupErr) {
          this.logger.warn(
            '[SessionLifecycle] Failed to clean up pending permissions on no-activity timeout',
            cleanupErr instanceof Error
              ? cleanupErr
              : new Error(String(cleanupErr)),
          );
        }
        // Descriptive, non-"abort" wording on purpose: the StreamTransformer
        // catch classifies messages containing "abort"/"cancel" as benign
        // user aborts (debug-level, suppressed). A stuck-session timeout must
        // surface to the UI as a real error instead.
        try {
          abortController.abort(
            new Error(
              cause === 'compaction-dwell'
                ? `Compaction did not finish within ${dwellSeconds}s ` +
                    `(baseUrl="${providerBaseUrl}", model="${providerModel}"). ` +
                    `Stopping for recovery; retry the turn.`
                : `No stream activity for ${seconds}s — no response from provider ` +
                    `(baseUrl="${providerBaseUrl}", model="${providerModel}"). ` +
                    `Unaccounted root inactivity; liveness is unknown. Stopping for recovery. The provider may be ` +
                    `unreachable or overloaded — check configuration or retry.`,
            ),
          );
        } catch (abortErr) {
          this.logger.warn(
            '[SessionLifecycle] Failed to abort on no-activity timeout',
            abortErr instanceof Error ? abortErr : new Error(String(abortErr)),
          );
        }
      },
      (operations) =>
        this.logger.warn(
          '[SessionLifecycle] Operation overdue; liveness unknown, continuing',
          {
            sessionId,
            operations,
            requestedModel: providerModel,
            resolvedModel: rec.currentModel,
          },
        ),
      // The dwell bound applies only where the coordinator acts (TASK_2026_597
      // S1); an OBSERVE_ONLY session keeps B8's "report overdue, keep waiting".
      () => compactionTap.controlsSession(),
    );
    abortController.signal.addEventListener(
      'abort',
      () => activityWatchdog.stop(),
      { once: true },
    );
    // The turn state owns one hold on this watchdog: taken while no turn is in
    // flight, released by `markTurnStarted`, re-taken by `markTurnEnded`. A
    // fresh record has `turnInFlight === false`, so the initial idle hold is
    // taken here and the pump's first yield releases it. Without it the
    // watchdog fired exactly 180 s after every `result` and marked every
    // running subagent interrupted (2026-08-31 log, session 314c9c90: result
    // 00:37:02Z → kill 00:40:02Z; TASK_2026_363).
    rec.activityHold = activityWatchdog;
    // A queued initial prompt is startup work, NOT between-turn idle. Bound
    // even a CLI that never pulls its input iterator. Empty resumes may idle.
    //
    // A slash-command prompt is queued content like any other since
    // TASK_2026_472, so it takes no idle hold here and the watchdog still arms
    // on `start()`. What moved is the OTHER end of the accounting: the pump now
    // yields the command, so `markTurnStarted` runs and `markTurnEnded` re-takes
    // the idle hold on the `result`. Before the change the slash string never
    // reached the pump, `turnInFlight` stayed false, and `markTurnEnded` skipped
    // the re-hold — harmless only because the query was already closing. A
    // persistent slash session without that re-hold would be aborted after 180 s
    // of healthy idle time.
    if (!initialContent) {
      activityWatchdog.endTurn();
      activityWatchdog.hold();
    }
    try {
      // ONE policy snapshot for both the harness sync and the options build,
      // so the skill copies the harness writes and the flags the builder emits
      // describe the same decisions (TASK_2026_560, C5).
      const resolvePolicy = this.resolveCapabilityPolicy(sessionConfig?.projectPath);
      const capabilityPolicy = await (named ? named.wait(resolvePolicy) : resolvePolicy);
      // Before the SDK is even loaded: this is the one funnel every
      // interactive, gateway and resumed session passes through, and it is the
      // last moment at which a missing `.claude/skills` can still be repaired
      // without the model having already been told it has none. Bounded and
      // non-throwing, so nothing here can delay or fail a session for long
      // (TASK_2026_278 Batch 3).
      const syncPolicy = this.syncHarnessToPolicy(capabilityPolicy);
      await (named ? named.wait(syncPolicy) : syncPolicy);
      const queryFn = namedQueryFn ?? await this.moduleLoader.getQueryFunction();
      const userMessageStream = this.streamPump.createUserMessageStream(
        sessionId,
        abortController,
      );
      const currentLevel =
        permissionLevel ?? this.permissionHandler.getPermissionLevel();
      // Seed this session's level on its record and bind the canUseTool
      // resolver to it. A caller-supplied `permissionLevel` (e.g. the gateway
      // bridge passing `'yolo'`) wins over the global default so the first tool
      // call already runs at the right level. Reading `rec.permissionLevel`
      // live keeps mid-session toggles working while scoping the level per
      // session — a tool call here never sees the level of a session running in
      // another workspace.
      rec.permissionLevel = currentLevel;
      const permissionLevelResolver = () => rec.permissionLevel;
      // YOLO maps to 'default' (not 'bypassPermissions') so the canUseTool
      // callback always runs — it auto-approves every tool for yolo while still
      // routing AskUserQuestion/ExitPlanMode to the UI. The only SDK modes the
      // interactive path can produce are 'default' | 'acceptEdits' | 'plan'.
      const initialPermissionMode =
        currentLevel === 'ask'
          ? 'default'
          : (PERMISSION_MODE_MAP[currentLevel] as
              'default' | 'acceptEdits' | 'plan');
      const buildOptions = this.queryOptionsBuilder.build({
        ...(named ? { accountRoute: named.route, accountLaunch: named.certifiedLaunch } : {}),
        userMessageStream,
        abortController,
        sessionConfig,
        resumeSessionId,
        sessionId: sessionId as string,
        onCompactionStart,
        onWorktreeCreated,
        onWorktreeRemoved,
        mcpServerRunning,
        enhancedPromptsContent,
        permissionMode: initialPermissionMode,
        permissionLevelResolver,
        pathToClaudeCodeExecutable,
        forkSession,
        enableFileCheckpointing: enableFileCheckpointing ?? true,
        includePartialMessages,
        mcpServersOverride,
        initialUserQuery: initialUserQuery ?? initialPrompt?.content,
        // Always the snapshot, never the live global object. The builder's
        // cross-provider check compares it with the live global route, so an
        // unprofiled session only reads as cross-provider if auth changed
        // mid-initialisation — exactly when the global model cache no longer
        // describes this query's provider.
        authEnvOverride: effectiveAuthEnv,
        // A turn parked on a permission prompt or an AskUserQuestion card emits
        // no stream events by construction. Without this the watchdog below
        // reads the user's own deliberation as a wedged provider and aborts the
        // session — which is what killed New Project runs mid-question, three
        // minutes into a prompt the UI advertises as untimed (TASK_2026_317).
        activityHold: activityWatchdog,
        // The routing ids the builder computes are pinned at build time, when a
        // new session has no SDK UUID yet — so they fall back to the caller's
        // tabId, which for a surface workflow is a correlation id no frontend
        // registry knows. Reading the record live means a prompt raised after
        // the SDK `init` message carries the id the UI actually routes on.
        sessionIdResolver: () => rec.realSessionId ?? undefined,
        capabilityPolicy,
      });
      const queryOptions = await (named ? named.wait(buildOptions) : buildOptions);
      compactionTap.setSubagentCacheTtl(queryOptions.subagentPromptCacheTtl);
      const isResume = !!resumeSessionId;
      // Never a raw string. A string prompt is what sets the SDK's
      // `isSingleUserTurn`, and that flag closes the transport input on the
      // first `result` — see the TASK_2026_472 note above.
      const effectivePrompt: AsyncIterable<SDKUserMessage> = isResume
        ? this.streamPump.createIdlePromptStream(abortController)
        : queryOptions.prompt;
      const promptMode = isResume ? 'idle+streamInput' : 'iterable';

      this.logger.info('[SessionLifecycle] Starting SDK query with options', {
        model: queryOptions.options.model,
        cwd: queryOptions.options.cwd,
        permissionMode: queryOptions.options.permissionMode,
        maxTurns: queryOptions.options.maxTurns,
        isResume,
        promptMode,
      });
      const runResult = named ? { sdkQuery: await named.launch(
        namedQueryFn ?? queryFn,
        userMessageStream,
        queryOptions.options as Options,
        registerKey,
        { name: sessionConfig?.sessionName ?? 'Session', workspaceId: sessionConfig?.projectPath ?? '',
          createdAt: Date.now(), lastActiveAt: Date.now(), totalCost: 0, totalTokens: { input: 0, output: 0 } },
      ) } : this.queryRunner.invokeWithLoadedQuery(
        queryFn,
        effectivePrompt,
        queryOptions.options as Options,
      );
      const sdkQuery: Query = runResult.sdkQuery;
      compactionTap.attachQuery(sdkQuery);
      const initialModel = queryOptions.options.model ?? '';
      rec.currentModel = initialModel;
      if (isResume && !named) {
        sdkQuery.streamInput(userMessageStream).catch((err: unknown) => {
          this.onInputChannelFailed(
            err,
            sessionId as string,
            rec.tabId,
            abortController,
          );
        });
        this.logger.info(
          `[SessionLifecycle] Connected streamInput for session: ${sessionId} (${promptMode})`,
        );
      }
      this.registry.setSessionQuery(sessionId, sdkQuery);

      this.logger.info(
        `[SessionLifecycle] Query started for session: ${sessionId}`,
      );

      return {
        sdkQuery,
        initialModel,
        abortController,
        activityWatchdog,
        // The stream feeds the tap explicitly (TASK_2026_614 D.11). The abort
        // listener above stays for a run whose stream never reached the
        // transformer; release() is idempotent, so both paths are safe.
        onMessage: (message: SDKMessage) => compactionTap.observe(message),
        beforeLiveStatsDispose: () => compactionTap.release(),
        onStreamEnd: () => compactionTap.release(),
        sessionToken: rec.token,
        usageCostSource: rec.usageCostSource,
        accountingAuthEnv: rec.accountingAuthEnv,
        capacityRoute: rec.capacityRoute,
      };
    } catch (err) {
      await named?.dispose();
      if (rec) {
        this.registry.remove(rec);
      }

      // The watchdog is only armed once StreamTransformer calls start(); it is
      // never started on this init-failure path, but stop() defensively
      // guarantees the timer can never fire after rollback.
      activityWatchdog.stop();
      abortController.abort();
      this.logger.error(
        `[SessionLifecycle] Query init failed for session ${sessionId}; rolling back pre-registration`,
        named ? new Error('Named account query initialization refused.')
          : err instanceof Error ? err : new Error(String(err)),
      );
      throw named ? namedAccountRefusal(namedRefusalCode(err)) : err;
    }
  }

  /**
   * End a session whose SDK input channel died.
   *
   * On the resumed path `streamInput(userMessageStream)` is the session's ONLY
   * delivery channel — the query itself was started with an idle iterable that
   * never yields. If that promise rejects, nothing the user types, and no slash
   * command, can ever reach the CLI again.
   *
   * This used to be a `logger.warn` and nothing else, so `executeQuery` still
   * returned a query and the RPC layer still reported the session as started.
   * The session then sat inert until the no-activity watchdog aborted it 180 s
   * later — a real failure reported as a timeout, three minutes late
   * (TASK_2026_472, codex logic review F1).
   *
   * A rejection here is always abnormal, never teardown. The SDK's own
   * `streamInput` catch rethrows only NON-abort errors (`catch(Q){if(!(Q
   * instanceof W6))throw Q}`, sdk.mjs 0.3.150, where `W6` is its abort error
   * class), so an aborted session resolves instead of rejecting. The two
   * reachable rejections are `ProcessTransport is not ready for writing` and
   * `Cannot write to terminated process` — the second fires when the CLI child
   * dies mid-session, which is exactly the case that must not be swallowed.
   *
   * Ordering and wording copy the watchdog's abort policy above, for the same
   * two reasons: resolve pending permissions BEFORE the abort tears the stream
   * down so an in-flight `can_use_tool` cannot wedge the UI, and keep the words
   * "abort" and "cancel" out of the message, because `StreamTransformer`
   * classifies those as benign user aborts and suppresses them. The underlying
   * error goes to the log, never into the abort reason, so a provider message
   * that happens to contain "abort" cannot silence a real failure.
   */
  private onInputChannelFailed(
    err: unknown,
    sessionId: string,
    tabId: string,
    abortController: AbortController,
  ): void {
    if (abortController.signal.aborted) {
      return;
    }
    this.logger.error(
      `[SessionLifecycle] Session ${sessionId} lost its SDK input channel; ` +
        `no further message can be delivered`,
      err instanceof Error ? err : new Error(String(err)),
    );
    try {
      this.permissionHandler.cleanupPendingPermissions(tabId);
    } catch (cleanupErr: unknown) {
      this.logger.warn(
        '[SessionLifecycle] Failed to clean up pending permissions on input-channel failure',
        cleanupErr instanceof Error
          ? cleanupErr
          : new Error(String(cleanupErr)),
      );
    }
    try {
      abortController.abort(
        new Error(
          'The session lost its connection to the provider and can no longer ' +
            'receive messages. Stopping for recovery — start a new message to retry.',
        ),
      );
    } catch (abortErr: unknown) {
      this.logger.warn(
        '[SessionLifecycle] Failed to stop session on input-channel failure',
        abortErr instanceof Error ? abortErr : new Error(String(abortErr)),
      );
    }
  }

  /**
   * The capability policy for this session's own cwd. `undefined` only when
   * no workspace path is known — the builder rejects that session anyway.
   * Never throws: a missing or failing resolver yields an unverified policy.
   */
  private async resolveCapabilityPolicy(
    projectPath: string | undefined,
  ): Promise<EffectiveCapabilitySet | undefined> {
    if (typeof projectPath !== 'string' || projectPath.trim() === '') {
      return undefined;
    }
    return resolveSessionCapabilityPolicy(
      this.capabilityResolver,
      projectPath,
      this.logger,
    );
  }

  /**
   * Bring the harness in line with `policy`, bounded, before the query starts.
   *
   * Skipped for an unverified policy: the reconciler freezes on an unknown
   * policy, and the session already runs with `skills: []`, so a pass could
   * only write or remove copies against a policy nobody could read.
   *
   * An unacknowledged pass is logged and the session continues. For a Claude
   * session that is safe, because `skillOverrides` already denies every
   * disabled skill natively whatever the copies on disk say.
   *
   * The catch is belt-and-braces. `HarnessPolicySync.apply` is built on a port
   * that never throws, but this call sits INSIDE `executeQuery`'s try block,
   * whose catch tears the session registration down and rethrows — so a broken
   * contract would turn a harness hiccup into a failed chat message.
   */
  private async syncHarnessToPolicy(
    policy: EffectiveCapabilitySet | undefined,
  ): Promise<void> {
    if (policy === undefined || this.harnessPolicySync === null) return;
    if (policy.status !== 'verified') {
      this.logger.warn(
        '[SessionLifecycle] Capability policy is unverified — harness sync skipped',
        { physicalRoot: policy.physicalRoot, reasons: policy.reasons },
      );
      return;
    }
    try {
      const { acknowledged } = await this.harnessPolicySync.apply(
        policy.physicalRoot,
        policy.harnessFingerprint,
      );
      if (!acknowledged) {
        this.logger.warn(
          '[SessionLifecycle] Harness did not acknowledge the capability policy (session continues; skillOverrides still denies disabled skills)',
          {
            physicalRoot: policy.physicalRoot,
            fingerprint: policy.harnessFingerprint,
          },
        );
      }
    } catch (error: unknown) {
      this.logger.warn(
        '[SessionLifecycle] Harness policy sync threw (ignored; session continues)',
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
}
