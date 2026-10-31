/**
 * HostRoutingCoordinator — host-side pre-flight routing for the main
 * conversation (TASK_2026_857, Component 16; Req 4 and 5).
 *
 * Per admitted user turn the coordinator runs one background scope check,
 * moves a per-tab scope revision through the state machine below, runs at
 * most one `route_decide` pre-flight per revision once the scope is agreed,
 * and queues one `Routing:` reminder (or at most one nudge per revision) for
 * the NEXT turn's `UserPromptSubmit` context. Nothing on the reply path waits
 * for it: `admitUserTurn` is synchronous and every stage fails open.
 *
 * Concurrency guards:
 *  - `generation` (bumped per admission): only the newest admission's scope
 *    answer may mutate state.
 *  - `epoch` (bumped by every Disable reset, Gate 2 carry-forward): an
 *    assessment or pre-flight that started before a reset is discarded
 *    before any state, cache or queue mutation, even when the setting is on
 *    again by the time it settles. A write to the host-routing switch (or a
 *    decision model write that leaves routing off) resets every tab and drops
 *    this coordinator's queued reminders at once, so an off->on toggle with
 *    no admitted turn in between still cancels the old work.
 *  - `inFlight` is cleared only by the pre-flight that owns it (promise
 *    identity), so an old settle never clears a newer request.
 *  - The tab state object itself: a tab evicted from the LRU while work is
 *    pending is never recreated by a settle.
 *
 * Privacy: turn, scope, assistant and reminder text live only in memory.
 * Logs carry the tab id, the stage and an error class, never text.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  SDK_TOKENS,
  type NextTurnReminderQueue,
  type SdkAdapterEvents,
  type SdkAdapterTurnEndedEvent,
  type SessionIdResolvedCallbackRegistry,
  type SessionIdResolvedPayload,
} from '@ptah-extension/agent-sdk';
import {
  BUILTIN_SUBAGENT_ROLES,
  LANE_ROUTING_TOKENS,
  buildPreflightScopeSummary,
  type DecisionModelConfig,
  type HostRoutingSetting,
  type HostRoutingSettingChange,
  type PreflightResult,
  type PreflightReuseCache,
  type RouteCandidateSource,
  type RouteDecideService,
  type ScopeAssessment,
  type ScopeCheckService,
  type ScopeConversation,
} from '@ptah-extension/lane-routing';
import { buildRouteCandidateSource } from '@ptah-extension/vscode-lm-tools';
import type { CliDetectionResult } from '@ptah-extension/shared';
import { loggableErrorName } from '@ptah-extension/shared';
import {
  ROUTING_NUDGE_TEXT,
  formatRoutingReminder,
  type RoutingCandidates,
} from './routing-reminder.format';

const MAX_TABS = 200;
const MAX_ALIASES = 200;
const TURN_TEXT_CAP = 2000;
const PREVIOUS_TURN_CAP = 800;
const ASSISTANT_REPLY_CAP = 1500;
const ROUTED_SCOPE_CAP = 1200;
const MAX_CANDIDATE_LABELS = 4;
/** Same budget as lane-routing's `MODEL_LISTING_BUDGET_MS` (not on its barrel). */
const CANDIDATE_LISTING_BUDGET_MS = 2_000;
/** Owner tag of this coordinator's entries in the next-turn reminder queue. */
const REMINDER_OWNER = 'host-routing';

export interface AdmitUserTurnInput {
  readonly tabId: string;
  /** Real SDK session id on continue turns; `null` on a start turn. */
  readonly sessionId: string | null;
  readonly prompt: string;
}

type HostRoutingStage =
  | 'admit'
  | 'scope'
  | 'pre-flight'
  | 'candidates'
  | 'turn-ended'
  | 'session-alias'
  | 'setting-change';

interface InFlightPreflight {
  readonly revision: number;
  readonly promise: Promise<void>;
}

interface TabRoutingState {
  generation: number;
  /** Gate 2 carry-forward: bumped by every Disable reset. */
  epoch: number;
  /** 0 = no engineering scope yet. */
  revision: number;
  pendingScope: string | null;
  routedRevision: number | null;
  routedScope: string | null;
  nudgedRevision: number | null;
  attemptedRevision: number | null;
  inFlight: InFlightPreflight | null;
  previousUserTurn: string | null;
  lastAssistantReply: string | null;
  latestSessionKey: string;
}

type ScopeCheck = Pick<ScopeCheckService, 'assess'>;
type RouteDecide = Pick<RouteDecideService, 'decide'>;
type ReuseCache = Pick<
  PreflightReuseCache,
  'beginTurn' | 'confirmRevision' | 'markUnknown' | 'put' | 'clear'
>;
type ReminderQueue = Pick<
  NextTurnReminderQueue,
  'put' | 'discard' | 'discardOwned'
>;
type TurnEvents = Pick<SdkAdapterEvents, 'onTurnEnded'>;
type SessionIdRegistry = Pick<SessionIdResolvedCallbackRegistry, 'register'>;
/** The slice of `PtahAPIBuilder` the candidate source reads. */
export interface CandidateApiBuilder {
  build(): { readonly agent: Parameters<typeof buildRouteCandidateSource>[0] };
}

@injectable()
export class HostRoutingCoordinator {
  private readonly tabs = new Map<string, TabRoutingState>();
  /** SDK session id → tab id. */
  private readonly aliases = new Map<string, string>();
  private readonly releases: Array<() => void> = [];
  private candidateSource: RouteCandidateSource | null = null;

  constructor(
    @inject(TOKENS.LOGGER)
    private readonly logger: Pick<Logger, 'warn' | 'debug'>,
    @inject(LANE_ROUTING_TOKENS.HOST_ROUTING_SETTING)
    private readonly setting: Pick<
      HostRoutingSetting,
      'isEnabled' | 'onDidChange'
    >,
    @inject(LANE_ROUTING_TOKENS.SCOPE_CHECK_SERVICE)
    private readonly scopeCheck: ScopeCheck,
    @inject(LANE_ROUTING_TOKENS.ROUTE_DECIDE_SERVICE)
    private readonly routeDecide: RouteDecide,
    @inject(LANE_ROUTING_TOKENS.DECISION_MODEL_CONFIG)
    private readonly decisionConfig: Pick<DecisionModelConfig, 'getSelection'>,
    @inject(SDK_TOKENS.SDK_NEXT_TURN_REMINDER_QUEUE)
    private readonly queue: ReminderQueue,
    @inject(TOKENS.PTAH_API_BUILDER)
    private readonly apiBuilder: CandidateApiBuilder,
    @inject(LANE_ROUTING_TOKENS.PREFLIGHT_REUSE_CACHE, { isOptional: true })
    private readonly cache?: ReuseCache,
    @inject(SDK_TOKENS.SDK_ADAPTER_EVENTS, { isOptional: true })
    events?: TurnEvents,
    @inject(SDK_TOKENS.SDK_SESSION_ID_RESOLVED_CALLBACK_REGISTRY, {
      isOptional: true,
    })
    sessionIds?: SessionIdRegistry,
  ) {
    const settingChanges = setting.onDidChange((change) =>
      this.onSettingChanged(change),
    );
    this.releases.push(() => settingChanges.dispose());
    if (events) {
      this.releases.push(
        events.onTurnEnded((event) => this.onTurnEnded(event)),
      );
    }
    if (sessionIds) {
      this.releases.push(
        sessionIds.register((payload) => this.onSessionIdResolved(payload)),
      );
    }
  }

  /**
   * Admit one interactive user turn. Synchronous and never throws; the scope
   * check and any pre-flight run in the background.
   */
  admitUserTurn(input: AdmitUserTurnInput): void {
    try {
      const text = input.prompt.trim();
      if (text.length === 0 || text.startsWith('/')) return;
      if (!this.setting.isEnabled()) {
        this.cache?.clear();
        const existing = this.tabs.get(input.tabId);
        if (existing) this.disableReset(input.tabId, existing);
        return;
      }
      if (input.sessionId) this.setAlias(input.sessionId, input.tabId);
      const state = this.stateFor(input.tabId);
      state.latestSessionKey = input.sessionId ?? input.tabId;
      this.cache?.beginTurn(input.tabId);

      const generation = ++state.generation;
      const epoch = state.epoch;
      const turnText = text.slice(0, TURN_TEXT_CAP);
      const snapshot: ScopeConversation = {
        turnText,
        previousUserTurn: state.previousUserTurn,
        lastAssistantReply: state.lastAssistantReply,
        pendingScope: state.pendingScope,
        lastRoutedScope: state.routedScope,
      };
      state.previousUserTurn = text.slice(0, PREVIOUS_TURN_CAP);

      void this.scopeCheck
        .assess(snapshot)
        .then((answer) =>
          this.applyAssessment(
            input.tabId,
            state,
            generation,
            epoch,
            snapshot,
            answer,
          ),
        )
        .catch((error: unknown) =>
          this.reportFailure(input.tabId, 'scope', error),
        );
    } catch (error: unknown) {
      this.reportFailure(input.tabId, 'admit', error);
    }
  }

  /** Keeps the assistant's last reply for the next scope check. */
  onTurnEnded(event: SdkAdapterTurnEndedEvent): void {
    try {
      if (event.lastAssistantMessage === null) return;
      const tabId = this.aliases.get(event.sessionId);
      const state = tabId === undefined ? undefined : this.tabs.get(tabId);
      if (!state) return;
      state.lastAssistantReply = event.lastAssistantMessage.slice(
        0,
        ASSISTANT_REPLY_CAP,
      );
    } catch (error: unknown) {
      this.reportFailure(null, 'turn-ended', error);
    }
  }

  dispose(): void {
    for (const release of this.releases.splice(0)) release();
    this.tabs.clear();
    this.aliases.clear();
    this.candidateSource = null;
  }

  private applyAssessment(
    tabId: string,
    state: TabRoutingState,
    generation: number,
    epoch: number,
    snapshot: ScopeConversation,
    answer: ScopeAssessment,
  ): void {
    // Guards come before any mutation (r3 N2, Gate 2 carry-forward).
    if (this.tabs.get(tabId) !== state) {
      this.discarded(tabId, 'scope', 'evicted');
      return;
    }
    if (state.epoch !== epoch) {
      this.discarded(tabId, 'scope', 'cancelled');
      return;
    }
    if (generation !== state.generation) {
      this.discarded(tabId, 'scope', 'superseded');
      return;
    }
    if (!this.setting.isEnabled()) {
      this.disableReset(tabId, state);
      return;
    }

    // Rule 1: unavailable or unknown engineering answer.
    if (answer.kind === 'unavailable' || answer.engineering === null) {
      this.cache?.markUnknown(tabId);
      if (answer.kind === 'unavailable') {
        this.logger.warn('Host routing step failed', {
          tabId,
          stage: 'scope',
          code: 'unavailable',
        });
      }
      return;
    }
    // Rule 2: a non-engineering turn leaves the scope as it is.
    if (answer.engineering.value === 'no') {
      this.cache?.confirmRevision(tabId, state.revision);
      return;
    }

    const relation = answer.relation?.value ?? null;
    const material = answer.materialChange?.value ?? null;
    if (state.revision === 0) {
      // Rule 3: first engineering scope initialises revision 1.
      state.revision = 1;
      state.pendingScope = snapshot.turnText;
    } else if (relation === 'new-task' || material === 'yes') {
      // Rule 4: new or materially changed scope. A reminder or nudge for the
      // old revision is stale and must not reach the next turn (Req 5).
      state.revision += 1;
      state.pendingScope = snapshot.turnText;
      this.discardQueued(tabId, state);
    } else if (relation !== 'continuation' || material !== 'no') {
      // Rule 6: unknown relation or change; never increment on unknown.
      this.cache?.markUnknown(tabId);
      return;
    }
    // Rules 3-5 confirm the current revision.
    this.cache?.confirmRevision(tabId, state.revision);
    this.actOnRevision(
      tabId,
      state,
      epoch,
      { ...snapshot, pendingScope: state.pendingScope },
      answer.settled?.value === 'yes',
    );
  }

  private actOnRevision(
    tabId: string,
    state: TabRoutingState,
    epoch: number,
    conversation: ScopeConversation,
    settled: boolean,
  ): void {
    const revision = state.revision;
    if (revision === state.routedRevision) return;
    if (settled) {
      this.startPreflight(tabId, state, epoch, revision, conversation);
      return;
    }
    if (state.nudgedRevision === revision) return;
    this.queue.put(state.latestSessionKey, ROUTING_NUDGE_TEXT, REMINDER_OWNER);
    state.nudgedRevision = revision;
  }

  private startPreflight(
    tabId: string,
    state: TabRoutingState,
    epoch: number,
    revision: number,
    conversation: ScopeConversation,
  ): void {
    if (state.inFlight?.revision === revision) return;
    if (state.attemptedRevision === revision) return;
    state.attemptedRevision = revision;

    const request = buildPreflightScopeSummary(conversation);
    const fingerprint = JSON.stringify(this.decisionConfig.getSelection());
    const source = this.routeCandidateSource();
    const settle = (outcome: PreflightOutcome, own: Promise<void>): void =>
      this.settlePreflight(tabId, state, epoch, revision, own, {
        ...outcome,
        request,
        fingerprint,
      });
    const promise: Promise<void> = Promise.all([
      this.requestPreflight(request, source),
      this.listCandidates(tabId, source),
    ]).then(
      ([result, candidates]) => settle({ result, candidates }, promise),
      (error: unknown) => settle({ error }, promise),
    );
    state.inFlight = { revision, promise };
  }

  private async requestPreflight(
    request: string,
    source: RouteCandidateSource | null,
  ): Promise<PreflightResult | null> {
    const decided = await this.routeDecide.decide(
      { stage: 'pre-flight', request },
      source ?? EMPTY_CANDIDATE_SOURCE,
    );
    return decided.stage === 'pre-flight' ? decided : null;
  }

  private settlePreflight(
    tabId: string,
    state: TabRoutingState,
    epoch: number,
    revision: number,
    own: Promise<void>,
    outcome: SettledPreflight,
  ): void {
    try {
      // Gate 2 carry-forward: a request started before a Disable reset (or
      // for an evicted tab) changes nothing at all.
      if (this.tabs.get(tabId) !== state || state.epoch !== epoch) {
        this.discarded(tabId, 'pre-flight', 'cancelled');
        return;
      }
      if (state.inFlight?.promise === own) state.inFlight = null;
      if (!this.setting.isEnabled()) {
        this.disableReset(tabId, state);
        return;
      }
      if (state.revision !== revision) {
        this.discarded(tabId, 'pre-flight', 'superseded');
        return;
      }
      if ('error' in outcome) {
        this.reportFailure(tabId, 'pre-flight', outcome.error);
        return;
      }
      if (outcome.result === null) {
        this.logger.warn('Host routing step failed', {
          tabId,
          stage: 'pre-flight',
          code: 'unexpected-stage',
        });
        return;
      }
      const reminder = formatRoutingReminder(
        outcome.result,
        outcome.candidates,
      );
      if (reminder === null) {
        this.discarded(tabId, 'pre-flight', 'fallback-only');
        return;
      }
      state.routedRevision = revision;
      state.routedScope = outcome.request.slice(0, ROUTED_SCOPE_CAP);
      this.cache?.put(tabId, {
        revision,
        modelFingerprint: outcome.fingerprint,
        result: outcome.result,
      });
      this.queue.put(state.latestSessionKey, reminder, REMINDER_OWNER);
    } catch (error: unknown) {
      this.reportFailure(tabId, 'pre-flight', error);
    }
  }

  /**
   * Lanes and subagent roles available right now. Each part has its own
   * budget; a timeout or failure drops only that part.
   */
  private async listCandidates(
    tabId: string,
    source: RouteCandidateSource | null,
  ): Promise<RoutingCandidates> {
    if (source === null) return { lanes: null, subagents: null };
    const [lanes, subagents] = await Promise.all([
      this.withinBudget(tabId, () => availableLanes(source)),
      this.withinBudget(tabId, () => availableSubagents(source)),
    ]);
    return { lanes, subagents };
  }

  private async withinBudget<T>(
    tabId: string,
    read: () => Promise<T>,
  ): Promise<T | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), CANDIDATE_LISTING_BUDGET_MS);
    });
    try {
      return await Promise.race([read(), timeout]);
    } catch (error: unknown) {
      // degradation-audit: reported - advisory candidate list; the part is omitted from the reminder.
      this.reportFailure(tabId, 'candidates', error);
      return null;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** Built once; a failed build is not kept, so the next pre-flight retries. */
  private routeCandidateSource(): RouteCandidateSource | null {
    if (this.candidateSource) return this.candidateSource;
    try {
      this.candidateSource = buildRouteCandidateSource(
        this.apiBuilder.build().agent,
      );
    } catch (error: unknown) {
      this.reportFailure(null, 'candidates', error);
    }
    return this.candidateSource;
  }

  /**
   * Disable reset (r3 N3 + Gate 2 carry-forward). Keeps `revision`,
   * `pendingScope` and the conversation window; drops everything reusable.
   */
  private disableReset(tabId: string, state: TabRoutingState): void {
    state.epoch += 1;
    this.cache?.markUnknown(tabId);
    this.discardQueued(tabId, state);
    state.inFlight = null;
    state.attemptedRevision = null;
    state.routedRevision = null;
    state.nudgedRevision = null;
  }

  /**
   * A write to the switch is treated as a possible off->on toggle and resets
   * every tab whatever it reads now; a decision model write resets only when
   * it leaves routing off.
   */
  private onSettingChanged(change: HostRoutingSettingChange): void {
    try {
      if (!change.switchChanged && this.setting.isEnabled()) return;
      this.cache?.clear();
      for (const [tabId, state] of this.tabs) this.disableReset(tabId, state);
      this.queue.discardOwned(REMINDER_OWNER);
    } catch (error: unknown) {
      this.reportFailure(null, 'setting-change', error);
    }
  }

  private discardQueued(tabId: string, state: TabRoutingState): void {
    this.queue.discard(state.latestSessionKey);
    if (state.latestSessionKey !== tabId) this.queue.discard(tabId);
  }

  private onSessionIdResolved(payload: SessionIdResolvedPayload): void {
    try {
      const tabId =
        payload.tabId ??
        (payload.previousSessionId === undefined
          ? undefined
          : this.aliases.get(payload.previousSessionId));
      if (tabId !== undefined) this.setAlias(payload.realSessionId, tabId);
    } catch (error: unknown) {
      this.reportFailure(null, 'session-alias', error);
    }
  }

  private stateFor(tabId: string): TabRoutingState {
    const state = this.tabs.get(tabId) ?? {
      generation: 0,
      epoch: 0,
      revision: 0,
      pendingScope: null,
      routedRevision: null,
      routedScope: null,
      nudgedRevision: null,
      attemptedRevision: null,
      inFlight: null,
      previousUserTurn: null,
      lastAssistantReply: null,
      latestSessionKey: tabId,
    };
    touch(this.tabs, tabId, state, MAX_TABS);
    return state;
  }

  private setAlias(sessionId: string, tabId: string): void {
    touch(this.aliases, sessionId, tabId, MAX_ALIASES);
  }

  private discarded(
    tabId: string,
    stage: HostRoutingStage,
    reason: string,
  ): void {
    this.logger.debug('Host routing result discarded', {
      tabId,
      stage,
      reason,
    });
  }

  private reportFailure(
    tabId: string | null,
    stage: HostRoutingStage,
    error: unknown,
  ): void {
    // Host routing is advisory; chat continues. Only the error class is logged.
    this.logger.warn('Host routing step failed', {
      tabId,
      stage,
      code: loggableErrorName(error),
    });
  }
}

type PreflightOutcome =
  | {
      readonly result: PreflightResult | null;
      readonly candidates: RoutingCandidates;
    }
  | { readonly error: unknown };

type SettledPreflight = PreflightOutcome & {
  readonly request: string;
  readonly fingerprint: string;
};

/** Used only if the API cannot be built; pre-flight never reads candidates. */
const EMPTY_CANDIDATE_SOURCE: RouteCandidateSource = {
  rows: async () => [],
  limits: async () => null,
  roles: async () => [],
};

async function availableLanes(
  source: RouteCandidateSource,
): Promise<readonly string[]> {
  const rows = await source.rows();
  const limits = await source.limits(rows);
  return rows
    .filter(
      (row) =>
        row.installed &&
        row.disabled !== true &&
        limits?.get(laneId(row)) !== 'at-limit',
    )
    .sort((a, b) => rankOf(a) - rankOf(b) || laneId(a).localeCompare(laneId(b)))
    .map(laneId)
    .slice(0, MAX_CANDIDATE_LABELS);
}

async function availableSubagents(
  source: RouteCandidateSource,
): Promise<readonly string[]> {
  const roles = await source.roles();
  return [...new Set(roles)]
    .filter((role) => BUILTIN_SUBAGENT_ROLES.has(role))
    .slice(0, MAX_CANDIDATE_LABELS);
}

/** Same id rule as the route namespace's limit key. */
function laneId(row: Pick<CliDetectionResult, 'cli' | 'ptahCliId'>): string {
  if (row.cli === 'ptah-cli' && row.ptahCliId) return row.ptahCliId;
  return row.cli;
}

function rankOf(row: Pick<CliDetectionResult, 'preferredRank'>): number {
  const rank = row.preferredRank;
  return rank !== undefined && rank > 0 ? rank : Number.MAX_SAFE_INTEGER;
}

function touch<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}
