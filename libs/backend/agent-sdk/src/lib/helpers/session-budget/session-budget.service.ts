/**
 * SessionBudgetService (TASK_2026_597 N7, decision 13) — the session budget
 * stage machine.
 *
 * Maps the displayed stats figure (the SAME `SessionStatsEntry` the chat chip
 * renders; no second counter) to a stage and runs each stage's action once:
 *
 * - `tighten`: lower the session's auto-compact window through session
 *   control, ONLY when the user set `tightenWindowTokens`; otherwise the stage
 *   is advisory and the window reports `reason: 'disabled'`.
 * - `handoff`: build and write the deterministic handoff document.
 * - `limit`: a fresh handoff write, and sends are refused while
 *   `blockAtLimit` is on until the user allows 20% more or continues in a new
 *   session.
 *
 * State is keyed by `snapshot.sessionId` (the real SDK id, F1), held in memory
 * (one entry per live session, released on session end) and never persisted:
 * after a restart the stage is recomputed from the resume snapshot, and
 * compactions, extensions and dismissals start over.
 *
 * `observe` is synchronous because its result rides on the result-stats
 * broadcast. Stage actions run after it returns, serialised per session; their
 * outcome (window, handoff) is carried by the next published state and by
 * `act`, which waits for them. No timers, no polling.
 *
 * Fails open: no figure → `unknown`, never blocked; an action failure sets its
 * state field, WARNs once per session and failure kind, and the stage still
 * advances.
 *
 * A terminal handover gate arms before the pump is released, so follow-ups
 * held during the crossing turn transfer rather than starting on the source.
 */

import { inject, injectable } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type {
  SessionBudgetAction,
  SessionBudgetActionResult,
  SessionBudgetConfig,
  SessionBudgetHandoff,
  SessionBudgetHandoffReadStatus,
  SessionBudgetRotation,
  SessionBudgetStage,
  SessionBudgetState,
  SessionBudgetWindow,
  SessionId,
  SessionStatsEntry,
} from '@ptah-extension/shared';
import { SDK_TOKENS } from '../../di/tokens';
import type { SessionLifecycleManager } from '../session-lifecycle-manager';
import type { SessionStatsOwnerService } from '../../session-stats/session-stats-owner.service';
import { SessionBudgetConfigProvider } from './session-budget-config.provider';
import {
  SessionHandoffBuilder,
  assembleSessionHandoff,
  sessionHandoffSeed,
  type SessionHandoffDocument,
} from './session-handoff-builder';
import { SessionHandoffWriter } from './session-handoff-writer';
import { SessionRotationAdvisor } from '../compaction/session-rotation-advisor';
import { MainThreadNoticeQueue } from '../main-thread-notice-queue';
import {
  acceptsSessionBudgetSnapshot,
  evaluateSessionBudget,
  higherSessionBudgetStage,
  sessionBudgetStageRank,
  type SessionBudgetFigure,
} from './session-budget-stage';

/** Session-control surface the budget needs (the lifecycle manager). */
export type SessionBudgetSessionControl = Pick<
  SessionLifecycleManager,
  'applySessionAutoCompactWindow' | 'getSessionWorkspace' | 'find'
>;

/** Stats surface the budget reads when it has no state yet. */
export type SessionBudgetStatsSource = Pick<
  SessionStatsOwnerService,
  'snapshot' | 'leaseOf'
>;

export type SessionBudgetConfigSource = Pick<
  SessionBudgetConfigProvider,
  'getConfig'
>;

export type SessionBudgetHandoffBuilder = Pick<SessionHandoffBuilder, 'build'>;

export type SessionBudgetHandoffWriter = Pick<
  SessionHandoffWriter,
  'write' | 'read'
>;

export type SessionBudgetRotationAdvisor = Pick<
  SessionRotationAdvisor,
  'evaluate' | 'current' | 'release'
>;

/**
 * Notice-queue surface the budget needs: post the user-requested wrap-up,
 * drop pending notices.
 */
export type SessionBudgetNoticeQueue = Pick<
  MainThreadNoticeQueue,
  'post' | 'clear'
>;

/**
 * The display-only live stage `observeLive` reports (D25): `undefined` keeps
 * what the webview shows, `null` clears it, a value sets it.
 */
export type SessionBudgetLiveStage = 'handoff' | 'limit' | null | undefined;

/** `canSend` verdict; a refusal carries the state that refused it. */
export type SessionBudgetSendCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly state: SessionBudgetState };

/**
 * `window.target` when the tighten stage is advisory only
 * (`tightenWindowTokens` unset): no window was requested.
 */
export const SESSION_BUDGET_NO_WINDOW_TARGET = 0;

const SEND_OK: SessionBudgetSendCheck = Object.freeze({ ok: true });

/**
 * Released ids remembered so a late result or compaction cannot recreate
 * their entry; the oldest is forgotten past this many.
 */
const RELEASED_IDS_CAP = 1024;

const UNKNOWN_RANK = sessionBudgetStageRank('unknown');
const TIGHTEN_RANK = sessionBudgetStageRank('tighten');
const HANDOFF_RANK = sessionBudgetStageRank('handoff');
const LIMIT_RANK = sessionBudgetStageRank('limit');

/** In-memory handoff text, kept even when the file write failed. */
interface HandoffCopy {
  readonly content: string;
  readonly seed: string;
  readonly path: string | null;
}

interface BudgetEntry {
  readonly sessionId: string;
  /** Last accepted snapshot; re-evaluated on compaction and extend. */
  snapshot: SessionStatsEntry | null;
  /**
   * Bumped whenever a different snapshot is stored or the limit is extended:
   * the usage the handoff's budget section describes changed.
   */
  usageSeq: number;
  /** Figure and stage; `null` before the first figure or while disabled. */
  figure: SessionBudgetFigure | null;
  /**
   * The in-turn estimate's figure (`observeLive`): raises `stageFor` only,
   * never refuses a send. Cleared at turn end and by a newer authoritative
   * snapshot.
   */
  liveFigure: SessionBudgetFigure | null;
  /** Highest live stage rank already logged in this turn. */
  liveLoggedRank: number;
  /**
   * Highest stage rank the user asked the agent to wrap up at in this turn.
   * Reset at turn end, on extend and on a settings change.
   */
  wrapUpRequestedRank: number;
  /** Settings the figure was computed with (a change resets the stage). */
  configKey: string | null;
  compactions: number;
  extensions: number;
  /** Highest stage rank whose action already ran (once per stage entry). */
  actedRank: number;
  window?: SessionBudgetWindow;
  handoff?: SessionBudgetHandoff;
  handoffCopy: HandoffCopy | null;
  /** `usageSeq` the kept `handoffCopy` was built at. */
  handoffCopySeq: number;
  dismissedStage?: SessionBudgetStage;
  /**
   * Session workspace, remembered the first time session control knows it, so
   * a handoff built after the lifecycle forgot the session (disposal) still
   * reads the transcript.
   */
  workspacePath?: string;
  /** Failure kinds already WARNed for this session. */
  readonly warned: Set<string>;
  /** Tail of the serialised stage-action chain; never rejects. */
  actions: Promise<void>;
}

type ObserveSource = 'live' | 'loaded';

function configKeyOf(config: SessionBudgetConfig): string {
  return JSON.stringify(config);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function budgetAmount(value: number, figure: SessionBudgetFigure): string {
  if (figure.measure === 'cost' || figure.measure === 'cost-lower-bound') {
    return `$${value.toFixed(2)}`;
  }
  const unit =
    figure.measure === 'weighted-fallback' ? 'weighted tokens' : 'tokens';
  return `${Math.round(value).toLocaleString('en-US')} ${unit}`;
}

/**
 * The host-authored wrap-up notice, posted only when the user asks for it
 * (`request-wrap-up`). It tells the agent the user continues in a new session
 * and, at a blocking limit, that the user does so with "New session"
 * (627-L19). Ptah starts nothing on its own.
 */
function wrapUpNotice(
  figure: SessionBudgetFigure,
  atLimit: boolean,
  blocking: boolean,
): string {
  const usage =
    figure.used === null || figure.percent === null
      ? ''
      : ` (about ${budgetAmount(figure.used, figure)} of ${budgetAmount(figure.limit, figure)}, ${Math.floor(figure.percent)}%)`;
  const ending =
    'then end the turn with a short summary of where the work stands. ' +
    'The user will continue in a new session.';
  if (!atLimit) {
    return (
      `[Ptah] The user asked you to wrap up: this session is near its budget${usage}. ` +
      'Finish the step in progress. Do not start new tasks, subagents or CLI ' +
      'lanes. Wait for running subagents to return and for running CLI lanes ' +
      `(ptah_agent_wait / ptah_agent_status), ${ending}`
    );
  }
  const click = blocking
    ? ' New messages to this session are refused at the limit; the user ' +
      'will click "New session" to continue.'
    : '';
  return (
    `[Ptah] The user asked you to wrap up: this session reached its budget limit${usage}. ` +
    `Stop now: do not start or wait for anything new, ${ending}${click}`
  );
}

/** Wrap-up rank of a stage: `handoff`, `limit`, or none (`unknown`). */
function wrapUpRankOf(stage: SessionBudgetStage | undefined): number {
  if (!stage) return UNKNOWN_RANK;
  const rank = sessionBudgetStageRank(stage);
  if (rank >= LIMIT_RANK) return LIMIT_RANK;
  return rank >= HANDOFF_RANK ? HANDOFF_RANK : UNKNOWN_RANK;
}

@injectable()
export class SessionBudgetService {
  private readonly entries = new Map<string, BudgetEntry>();
  /**
   * Ids released in this process (insertion order, capped). A figure or
   * compaction for one of them is dropped until a new run owns the session
   * again (its stats owner exists) or the user loads it.
   */
  private readonly released = new Set<string>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SessionBudgetConfigProvider)
    private readonly configSource: SessionBudgetConfigSource,
    @inject(SDK_TOKENS.SDK_SESSION_STATS_OWNER)
    private readonly statsOwner: SessionBudgetStatsSource,
    @inject(SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER)
    private readonly sessionControl: SessionBudgetSessionControl,
    @inject(SessionHandoffBuilder)
    private readonly handoffBuilder: SessionBudgetHandoffBuilder,
    @inject(SessionHandoffWriter)
    private readonly handoffWriter: SessionBudgetHandoffWriter,
    @inject(SessionRotationAdvisor)
    private readonly rotationAdvisor: SessionBudgetRotationAdvisor,
    /** Absent in callers that construct the service without one: nothing to clear. */
    @inject(MainThreadNoticeQueue)
    private readonly noticeQueue?: SessionBudgetNoticeQueue,
  ) {}

  /**
   * Live result snapshot. `undefined` (no snapshot this result) returns
   * `undefined`: the consumer keeps the last state it has (F5).
   */
  observe(
    snapshot: SessionStatsEntry | undefined,
  ): SessionBudgetState | null | undefined {
    if (!snapshot) return undefined;
    return this.accept(snapshot, 'live');
  }

  /**
   * Resume snapshot. `null` (no stats on resume) keeps the state. A snapshot
   * without `revision` is accepted only when the session has no state yet.
   * Stage actions are not run here; the first live figure runs them.
   */
  observeLoaded(
    snapshot: SessionStatsEntry | null,
  ): SessionBudgetState | null | undefined {
    if (!snapshot) return undefined;
    return this.accept(snapshot, 'loaded');
  }

  /**
   * In-turn estimate (`provisional: true`, TASK_2026_626). Kept apart from
   * the authoritative figure: it raises `stageFor` for display only. It never
   * refuses a send, runs a stage action, posts a notice or arms a handover.
   * Never throws.
   *
   * Returns the display stage (D25): `undefined` when the estimate is ignored
   * (not provisional, untracked or released, older than the authoritative
   * figure, another measure, or a failure; the retained estimate is
   * untouched); `null` when the budget is disabled or the accepted estimate
   * is below `handoff`; otherwise `handoff` or `limit`.
   */
  observeLive(snapshot: SessionStatsEntry): SessionBudgetLiveStage {
    if (snapshot.provisional !== true) return undefined;
    const sessionId = snapshot.sessionId;
    try {
      const config = this.configSource.getConfig();
      if (!config.enabled) {
        const stale = this.entries.get(sessionId);
        if (stale) stale.liveFigure = null;
        return null;
      }
      const entry = this.trackedEntry(sessionId, 'live');
      if (!entry) return undefined;
      this.rememberWorkspace(entry);
      const authoritative = entry.figure?.revision ?? null;
      if (authoritative !== null && (snapshot.revision ?? -1) < authoritative) {
        return undefined;
      }
      const key = configKeyOf(config);
      const configChanged = entry.configKey !== null && entry.configKey !== key;
      const previous = entry.figure
        ? this.composeState(entry, entry.figure)
        : null;
      const figure = evaluateSessionBudget({
        snapshot,
        config,
        previous,
        compactions: entry.compactions,
        extensions: entry.extensions,
        resetStage: configChanged,
        resetMeasure: configChanged,
      });
      if (previous && figure.measure !== previous.measure) {
        // Risk A3: an unpriced estimate can move a cost budget to another
        // measure; comparing it with the authoritative figure would mislead.
        this.logger.debug(
          `[SessionBudget] Ignored a live estimate measured as ${figure.measure} (authoritative ${previous.measure}) for ${sessionId}`,
        );
        return undefined;
      }
      const from =
        entry.liveFigure?.stage ?? previous?.stage ?? ('unknown' as const);
      entry.liveFigure = figure;
      this.logLiveStage(entry, from, figure);
      const rank = wrapUpRankOf(figure.stage);
      if (rank === LIMIT_RANK) return 'limit';
      return rank === HANDOFF_RANK ? 'handoff' : null;
    } catch (error: unknown) {
      // degradation-audit: reported - an estimate failure leaves the
      // authoritative path untouched (fail-open) and the display unchanged.
      this.warnOnce(
        this.entries.get(sessionId),
        sessionId,
        'observe-live',
        error,
      );
      return undefined;
    }
  }

  /**
   * Turn end: drop the in-turn estimate, its log and wrap-up ranks and the
   * session's pending main-thread notices (they would land in the next turn).
   */
  onTurnTerminal(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (entry) {
      entry.liveFigure = null;
      entry.liveLoggedRank = UNKNOWN_RANK;
      entry.wrapUpRequestedRank = UNKNOWN_RANK;
    }
    this.noticeQueue?.clear(sessionId);
  }

  /**
   * One main-loop `compact_boundary` (F8). Counts toward the
   * `handoffAfterCompactions` trigger; in memory only.
   */
  recordCompaction(sessionId: string): void {
    const entry = this.trackedEntry(sessionId, 'live');
    if (!entry) return;
    entry.compactions += 1;
    if (!entry.snapshot || !entry.figure) return;
    this.reevaluate(entry, { resetStage: false, runActions: true });
  }

  /**
   * Whether a new turn may be sent, decided against the CURRENT settings: a
   * blocked session stops being blocked as soon as the user disables the
   * budget, turns `blockAtLimit` off or raises the limit, with no result
   * needed (no result arrives while sends are refused). The session's stored
   * figure decides, re-evaluated when the settings changed; with no figure the
   * current snapshot is evaluated and, when it blocks, installed on the entry
   * so the refusal's state is the one `act` (extend, dismiss) works on. With
   * neither the answer is ok (fail-open, F2).
   */
  canSend(sessionId: string): SessionBudgetSendCheck {
    const entry = this.entries.get(sessionId);
    try {
      const config = this.configSource.getConfig();
      if (!config.enabled) return SEND_OK;
      if (entry?.figure) return this.checkStored(entry, config);
      return this.checkSnapshot(sessionId, entry, config);
    } catch (error: unknown) {
      // Fail-open by design (F2): an unreadable budget never blocks a send;
      // the failure is WARNed once for the session.
      this.warnOnce(entry, sessionId, 'can-send', error);
      return SEND_OK;
    }
  }

  /**
   * Current stage without turning an advisory handoff stage into a refusal:
   * the higher of the authoritative and the in-turn estimate's stage.
   */
  stageFor(sessionId: string): SessionBudgetStage | undefined {
    const entry = this.entries.get(sessionId);
    const stage = entry?.figure?.stage;
    const live = entry?.liveFigure?.stage;
    if (!live) return stage;
    return stage ? higherSessionBudgetStage(stage, live) : live;
  }

  /** A user action from the budget banner. Never throws. */
  async act(
    sessionId: string,
    action: SessionBudgetAction,
  ): Promise<SessionBudgetActionResult> {
    const entry = this.entries.get(sessionId);
    if (entry) await entry.actions;
    try {
      switch (action) {
        case 'dismiss':
          return this.dismiss(entry);
        case 'extend':
          return this.extend(sessionId, entry);
        case 'restore-window':
          return await this.restoreWindow(sessionId, entry);
        case 'write-handoff':
          return await this.writeHandoffAction(sessionId, entry);
        case 'preview-handoff':
          return await this.previewHandoff(sessionId, entry);
        case 'request-wrap-up':
          return this.requestWrapUp(sessionId, entry);
      }
    } catch (error: unknown) {
      this.logger.error(
        `[SessionBudget] Action ${action} failed for ${sessionId}`,
        error instanceof Error ? error : new Error(String(error)),
      );
      return {
        success: false,
        ...this.stateField(entry),
        error: `The ${action} action failed`,
      };
    }
  }

  /**
   * Session end: drop its state, rotation advisory and pending main-thread
   * notices included, and remember the id so a late result or compaction does
   * not bring the entry back.
   */
  release(sessionId: string): void {
    this.entries.delete(sessionId);
    this.rotationAdvisor.release(sessionId);
    this.noticeQueue?.clear(sessionId);
    this.released.delete(sessionId);
    this.released.add(sessionId);
    if (this.released.size > RELEASED_IDS_CAP) {
      const oldest = this.released.values().next();
      if (!oldest.done) this.released.delete(oldest.value);
    }
  }

  /** Disposal: drop every session's state and pending notices. */
  clearAll(): void {
    for (const sessionId of this.entries.keys()) {
      this.rotationAdvisor.release(sessionId);
      this.noticeQueue?.clear(sessionId);
    }
    this.entries.clear();
    this.released.clear();
  }

  // ---------------------------------------------------------------------------
  // Evaluation
  // ---------------------------------------------------------------------------

  private accept(
    snapshot: SessionStatsEntry,
    source: ObserveSource,
  ): SessionBudgetState | null | undefined {
    try {
      return this.acceptOrThrow(snapshot, source);
    } catch (error: unknown) {
      // degradation-audit: reported - an observe failure must never break the
      // result-stats broadcast; the consumer keeps its last state (F5).
      this.warnOnce(
        this.entries.get(snapshot.sessionId),
        snapshot.sessionId,
        'observe',
        error,
      );
      return undefined;
    }
  }

  private acceptOrThrow(
    snapshot: SessionStatsEntry,
    source: ObserveSource,
  ): SessionBudgetState | null | undefined {
    // The entry first: a throwing config read below is then WARNed once per
    // session (the catch in `accept` finds the entry).
    const entry = this.trackedEntry(snapshot.sessionId, source);
    // A released session without a new owner is a known absence, unlike an
    // observation fault (which `accept` reports as `undefined`).
    if (!entry) return null;
    this.rememberWorkspace(entry);
    const config = this.configSource.getConfig();

    if (!config.enabled) {
      // Disabled: no stage, no block, no budget banner on this figure (the
      // rotation advisory still rides it). The next enabled figure starts the
      // stage over (the settings changed).
      this.evaluateRotation(snapshot);
      this.storeSnapshot(entry, snapshot);
      entry.figure = null;
      entry.liveFigure = null;
      entry.configKey = null;
      return this.disabledState(snapshot, config, entry);
    }

    if (
      !acceptsSessionBudgetSnapshot(entry.figure, snapshot.revision, source)
    ) {
      return entry.figure ? this.composeState(entry, entry.figure) : undefined;
    }

    this.evaluateRotation(snapshot);
    this.storeSnapshot(entry, snapshot);
    // A newer authoritative snapshot replaces the in-turn estimate (626).
    if ((snapshot.revision ?? -1) > (entry.liveFigure?.revision ?? -1)) {
      entry.liveFigure = null;
    }
    return this.applyEvaluation(entry, config, {
      resetStage: false,
      runActions: source === 'live',
    });
  }

  private reevaluate(
    entry: BudgetEntry,
    options: { readonly resetStage: boolean; readonly runActions: boolean },
  ): SessionBudgetState | undefined {
    const config = this.configSource.getConfig();
    if (!config.enabled) return undefined;
    return this.applyEvaluation(entry, config, options);
  }

  /** Evaluate the entry's snapshot, store the figure, schedule actions. */
  private applyEvaluation(
    entry: BudgetEntry,
    config: SessionBudgetConfig,
    options: { readonly resetStage: boolean; readonly runActions: boolean },
  ): SessionBudgetState | undefined {
    const snapshot = entry.snapshot;
    if (!snapshot) return undefined;
    const key = configKeyOf(config);
    const configChanged = entry.configKey !== null && entry.configKey !== key;
    const previous = entry.figure
      ? this.composeState(entry, entry.figure)
      : null;

    const figure = evaluateSessionBudget({
      snapshot,
      config,
      previous,
      compactions: entry.compactions,
      extensions: entry.extensions,
      resetStage: options.resetStage || configChanged,
      resetMeasure: configChanged,
    });
    entry.figure = figure;
    entry.configKey = key;
    if (options.resetStage || configChanged) {
      // Extend or new settings: the estimate was measured against the old
      // limit; the next one re-evaluates, and the user may ask for a wrap-up
      // again at the new stage.
      entry.liveFigure = null;
      entry.liveLoggedRank = UNKNOWN_RANK;
      entry.wrapUpRequestedRank = UNKNOWN_RANK;
    }

    const rank = sessionBudgetStageRank(figure.stage);
    if (rank < entry.actedRank) {
      // The stage fell (extend or a settings change): re-entering a stage
      // runs its action again.
      entry.actedRank = rank;
    }
    if (previous && previous.stage !== figure.stage) {
      this.logStageChange(entry.sessionId, previous.stage, figure);
    } else if (!previous && figure.stage !== 'unknown') {
      this.logStageChange(entry.sessionId, 'unknown', figure);
    }
    if (options.runActions && rank > entry.actedRank) {
      this.scheduleStageActions(entry, entry.actedRank, rank, config);
      entry.actedRank = rank;
    }
    return this.composeState(entry, figure);
  }

  /**
   * The stored figure's verdict. Settings changed since it was computed
   * (limit, `blockAtLimit`, unit, ...): re-evaluate the stored snapshot first,
   * exactly as the next result would (stage reset, actions of a newly entered
   * stage scheduled).
   */
  private checkStored(
    entry: BudgetEntry,
    config: SessionBudgetConfig,
  ): SessionBudgetSendCheck {
    let state: SessionBudgetState | undefined;
    if (entry.configKey !== configKeyOf(config)) {
      state = this.applyEvaluation(entry, config, {
        resetStage: false,
        runActions: true,
      });
    }
    const figure = entry.figure;
    if (!figure?.blocked) return SEND_OK;
    return { ok: false, state: state ?? this.composeState(entry, figure) };
  }

  /**
   * No stored figure (no result observed yet, or the figure was dropped while
   * the budget was disabled): evaluate the owner's current snapshot, else the
   * last one the entry kept. A blocking figure is installed on the entry, so
   * the refusal is backed by state that `extend` and `dismiss` act on.
   */
  private checkSnapshot(
    sessionId: string,
    entry: BudgetEntry | undefined,
    config: SessionBudgetConfig,
  ): SessionBudgetSendCheck {
    const snapshot = this.statsOwner.snapshot(sessionId) ?? entry?.snapshot;
    if (!snapshot) return SEND_OK;
    const figure = evaluateSessionBudget({
      snapshot,
      config,
      previous: null,
      compactions: entry?.compactions ?? 0,
      extensions: entry?.extensions ?? 0,
      resetStage: false,
      resetMeasure: false,
    });
    if (!figure.blocked) return SEND_OK;
    const state = this.installFigure(sessionId, snapshot, config);
    return {
      ok: false,
      state: state ?? { sessionId, ...figure },
    };
  }

  /**
   * Store `snapshot` as the session's figure (creating the entry), as a live
   * result would. Used when the gate or "Allow 20% more" needs a figure the
   * session never received a result for.
   */
  private installFigure(
    sessionId: string,
    snapshot: SessionStatsEntry,
    config: SessionBudgetConfig,
  ): SessionBudgetState | undefined {
    const entry = this.entryFor(sessionId);
    this.storeSnapshot(entry, snapshot);
    return this.applyEvaluation(entry, config, {
      resetStage: false,
      runActions: true,
    });
  }

  // ---------------------------------------------------------------------------
  // Stage actions
  // ---------------------------------------------------------------------------

  /**
   * Run the actions of every stage entered in `(fromRank, toRank]`, once:
   * the window at `tighten`, one handoff write for `handoff` and/or `limit`
   * (a jump straight to `limit` writes once, fresh).
   */
  private scheduleStageActions(
    entry: BudgetEntry,
    fromRank: number,
    toRank: number,
    config: SessionBudgetConfig,
  ): void {
    const tighten = fromRank < TIGHTEN_RANK && toRank >= TIGHTEN_RANK;
    const write =
      (fromRank < HANDOFF_RANK && toRank >= HANDOFF_RANK) ||
      (fromRank < LIMIT_RANK && toRank >= LIMIT_RANK);
    entry.actions = entry.actions.then(() =>
      this.runStageActions(entry, { tighten, write }, config),
    );
  }

  private async runStageActions(
    entry: BudgetEntry,
    run: { readonly tighten: boolean; readonly write: boolean },
    config: SessionBudgetConfig,
  ): Promise<void> {
    if (run.tighten) await this.tighten(entry, config);
    if (run.write) {
      try {
        await this.writeHandoff(entry.sessionId, entry);
      } catch (error: unknown) {
        // A failed handoff never stops the stage; WARNed once per session.
        this.warnOnce(entry, entry.sessionId, 'handoff', error);
      }
    }
  }

  private async tighten(
    entry: BudgetEntry,
    config: SessionBudgetConfig,
  ): Promise<void> {
    const target = config.tightenWindowTokens;
    if (target === null) {
      // Advisory only (A1 defaults stay null): nothing is sent.
      entry.window = {
        target: SESSION_BUDGET_NO_WINDOW_TARGET,
        applied: false,
        reason: 'disabled',
      };
      return;
    }
    try {
      const window = await this.sessionControl.applySessionAutoCompactWindow(
        entry.sessionId as SessionId,
        target,
      );
      if (!this.isCurrent(entry)) return;
      entry.window = window;
      if (window && !window.applied) {
        this.logger.info(
          `[SessionBudget] Tighten window not applied for ${entry.sessionId}`,
          { target, reason: window.reason },
        );
        if (window.reason === 'not-honoured' || window.reason === 'failed') {
          this.warnOnce(
            entry,
            entry.sessionId,
            `tighten:${window.reason}`,
            new Error(`window ${window.reason}`),
          );
        }
      } else if (window) {
        this.logger.info(
          `[SessionBudget] Tighten window applied for ${entry.sessionId}`,
          { target },
        );
      }
    } catch (error: unknown) {
      // The stage still advances; the window reports `failed` and the
      // failure is WARNed once for the session.
      entry.window = { target, applied: false, reason: 'failed' };
      this.warnOnce(entry, entry.sessionId, 'tighten:failed', error);
    }
  }

  /** Build the handoff from the transcript tail and write it. */
  private async writeHandoff(
    sessionId: string,
    entry: BudgetEntry | undefined,
  ): Promise<HandoffCopy> {
    // Stamped before the build: usage observed while it runs makes it stale.
    const builtAtSeq = entry?.usageSeq ?? 0;
    const { document, readStatus } = await this.buildHandoff(sessionId, entry);
    const written = await this.handoffWriter.write(sessionId, document.content);
    const copy: HandoffCopy = {
      content: document.content,
      seed: document.seed,
      path: written.path,
    };
    if (entry && this.isCurrent(entry)) {
      entry.handoffCopy = copy;
      entry.handoffCopySeq = builtAtSeq;
      entry.handoff = {
        path: written.path,
        chars: document.chars,
        truncated: document.truncated,
        writtenAt: document.builtAt,
        ...(written.writeError !== undefined
          ? { writeError: written.writeError }
          : {}),
        ...(readStatus !== undefined ? { readStatus } : {}),
      };
    }
    if (written.writeError !== undefined) {
      this.warnOnce(
        entry,
        sessionId,
        'handoff-write',
        new Error(written.writeError),
      );
    }
    return copy;
  }

  /**
   * Build the handoff document. `readStatus` is set when the transcript was
   * not read (unknown workspace or a read error), so the published handoff
   * says it may be incomplete; the read error itself stays in the WARN.
   */
  private async buildHandoff(
    sessionId: string,
    entry: BudgetEntry | undefined,
  ): Promise<{
    document: SessionHandoffDocument;
    readStatus?: SessionBudgetHandoffReadStatus;
  }> {
    const budget = entry?.figure
      ? this.composeState(entry, entry.figure)
      : undefined;
    // The live lookup first; after disposal the lifecycle no longer knows the
    // session, so the workspace remembered on the entry is the fallback.
    const workspacePath =
      this.sessionControl.getSessionWorkspace(sessionId) ??
      entry?.workspacePath;
    if (workspacePath === undefined) {
      this.warnOnce(
        entry,
        sessionId,
        'handoff-read',
        new Error(
          'session workspace unknown; handoff built without the transcript',
        ),
      );
      return {
        document: assembleSessionHandoff([], {
          sessionId,
          builtAt: Date.now(),
          ...(budget ? { budget } : {}),
        }),
        readStatus: 'workspace-unknown',
      };
    }
    const result = await this.handoffBuilder.build({
      sessionId,
      workspacePath,
      ...(budget ? { budget } : {}),
    });
    if (result.readError === undefined) {
      return { document: result.document };
    }
    this.warnOnce(
      entry,
      sessionId,
      'handoff-read',
      new Error(result.readError),
    );
    return { document: result.document, readStatus: 'read-failed' };
  }

  // ---------------------------------------------------------------------------
  // User actions
  // ---------------------------------------------------------------------------

  /**
   * "Ask agent to wrap up" (plan v2 Decision 1): post the wrap-up notice to
   * the running turn, only at the `handoff` or `limit` display stage. Once
   * per stage rank per turn: a repeat succeeds and posts nothing. Refused
   * with `WRAP_UP_UNAVAILABLE` without a budget entry, below `handoff`, while
   * no turn runs (the notice would land in the next turn), with the budget
   * disabled, or when the host has no notice queue.
   */
  private requestWrapUp(
    sessionId: string,
    entry: BudgetEntry | undefined,
  ): SessionBudgetActionResult {
    const figure =
      entry && this.configSource.getConfig().enabled
        ? this.displayFigure(entry)
        : null;
    const rank = wrapUpRankOf(figure?.stage);
    if (
      !entry ||
      !figure ||
      rank === UNKNOWN_RANK ||
      !this.noticeQueue ||
      this.sessionControl.find(sessionId)?.turnInFlight !== true
    ) {
      return {
        success: false,
        ...this.stateField(entry),
        error:
          'The agent is not working on a turn at the handoff or limit stage',
        errorCode: 'WRAP_UP_UNAVAILABLE',
      };
    }
    if (rank > entry.wrapUpRequestedRank) {
      entry.wrapUpRequestedRank = rank;
      this.logger.info(
        `[SessionBudget] Wrap-up requested by the user for ${sessionId} at ${figure.stage}`,
      );
      this.noticeQueue.post(
        sessionId,
        wrapUpNotice(figure, rank === LIMIT_RANK, figure.blocked),
      );
    }
    return { success: true, ...this.stateField(entry) };
  }

  /** The figure behind `stageFor`: the higher of authoritative and live. */
  private displayFigure(entry: BudgetEntry): SessionBudgetFigure | null {
    const { figure, liveFigure } = entry;
    if (!liveFigure) return figure;
    if (!figure) return liveFigure;
    return sessionBudgetStageRank(liveFigure.stage) >
      sessionBudgetStageRank(figure.stage)
      ? liveFigure
      : figure;
  }

  private dismiss(entry: BudgetEntry | undefined): SessionBudgetActionResult {
    if (!entry?.figure) return this.noState();
    entry.dismissedStage = entry.figure.stage;
    return { success: true, state: this.composeState(entry, entry.figure) };
  }

  /**
   * "Allow 20% more": at `limit` only; each extension adds 20% of the limit.
   * A session with no stored figure gets one from its current snapshot first
   * (the figure the gate refuses on), so a refused session can always extend;
   * with no snapshot either there is nothing to extend and it says so.
   */
  private extend(
    sessionId: string,
    current: BudgetEntry | undefined,
  ): SessionBudgetActionResult {
    const entry = current?.figure
      ? current
      : this.entryWithCurrentFigure(sessionId, current);
    if (!entry?.figure) return this.noState();
    if (entry.figure.stage !== 'limit') {
      return {
        success: false,
        state: this.composeState(entry, entry.figure),
        error: 'Allow 20% more is only available at the limit',
      };
    }
    entry.extensions += 1;
    entry.usageSeq += 1;
    const state = this.reevaluate(entry, {
      resetStage: true,
      runActions: true,
    });
    const after = state ?? this.composeState(entry, entry.figure);
    this.logger.info(
      `[SessionBudget] Limit extended by 20% for ${entry.sessionId}`,
      {
        extensions: entry.extensions,
        limit: after.limit,
        used: after.used,
        stage: after.stage,
      },
    );
    return { success: true, state: after };
  }

  private async restoreWindow(
    sessionId: string,
    entry: BudgetEntry | undefined,
  ): Promise<SessionBudgetActionResult> {
    if (!entry?.figure) return this.noState();
    const window = await this.sessionControl.applySessionAutoCompactWindow(
      sessionId as SessionId,
      null,
    );
    if (!this.isCurrent(entry) || !entry.figure) return this.noState();
    entry.window = window;
    const state = this.composeState(entry, entry.figure);
    if (window?.reason === 'restore-failed') {
      return {
        success: false,
        state,
        error: 'Could not restore the auto-compact window',
      };
    }
    return { success: true, state };
  }

  private async writeHandoffAction(
    sessionId: string,
    entry: BudgetEntry | undefined,
  ): Promise<SessionBudgetActionResult> {
    // No entry: an unknown or released session. Nothing is written, so a
    // stray id never creates a handoff file (or runs its prune).
    if (!entry) return this.noState();
    const copy = await this.writeHandoff(sessionId, entry);
    return { success: true, ...this.stateField(entry), handoff: copy };
  }

  /**
   * The kept handoff when no newer usage (snapshot or extend) was observed
   * since it was built, else one built now (not written). Rotation seeds the
   * new session from this, so a copy older than the usage is never reused.
   * With no entry (an unknown or released session) only the handoff file on
   * disk can answer.
   */
  private async previewHandoff(
    sessionId: string,
    entry: BudgetEntry | undefined,
  ): Promise<SessionBudgetActionResult> {
    if (!entry) return this.persistedHandoff(sessionId);
    if (entry.handoffCopy && entry.handoffCopySeq === entry.usageSeq) {
      return {
        success: true,
        ...this.stateField(entry),
        handoff: entry.handoffCopy,
      };
    }
    const { document } = await this.buildHandoff(sessionId, entry);
    const built: HandoffCopy = {
      content: document.content,
      seed: document.seed,
      path: null,
    };
    return { success: true, ...this.stateField(entry), handoff: built };
  }

  /**
   * The handoff file written at the handoff or limit stage. It outlives the
   * entry `release` drops when the session ends, so the webview's rotate
   * fallback for an ended source still gets a seed (TASK_2026_627 6F S1). No
   * transcript is read and nothing is written; with no file the answer stays
   * "no state". No `state` field: the session has no budget any more.
   */
  private async persistedHandoff(
    sessionId: string,
  ): Promise<SessionBudgetActionResult> {
    const persisted = await this.handoffWriter.read(sessionId);
    if (!persisted) return this.noState();
    return {
      success: true,
      handoff: {
        content: persisted.content,
        seed: sessionHandoffSeed(persisted.content),
        path: persisted.path,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // State helpers
  // ---------------------------------------------------------------------------

  /**
   * The entry with a figure built from the session's current snapshot (the
   * owner's, else the one the entry kept), or `undefined` when the budget is
   * disabled or there is no snapshot.
   */
  private entryWithCurrentFigure(
    sessionId: string,
    entry: BudgetEntry | undefined,
  ): BudgetEntry | undefined {
    const config = this.configSource.getConfig();
    if (!config.enabled) return undefined;
    const snapshot = this.statsOwner.snapshot(sessionId) ?? entry?.snapshot;
    if (!snapshot) return undefined;
    this.installFigure(sessionId, snapshot, config);
    return this.entries.get(sessionId);
  }

  /**
   * The entry an observed figure or compaction updates, created on first use.
   * `undefined` for an id released in this process that no new run owns yet:
   * a result or compaction arriving after `release` is late and must not
   * bring the entry back. A new run (its stats owner exists) or a user load
   * tracks the id again.
   */
  private trackedEntry(
    sessionId: string,
    source: ObserveSource,
  ): BudgetEntry | undefined {
    const existing = this.entries.get(sessionId);
    if (existing) return existing;
    if (this.released.has(sessionId)) {
      if (source === 'live' && this.statsOwner.leaseOf(sessionId) === null) {
        this.logger.debug(
          `[SessionBudget] Ignored a late figure for released session ${sessionId}`,
        );
        return undefined;
      }
      this.released.delete(sessionId);
    }
    return this.entryFor(sessionId);
  }

  private entryFor(sessionId: string): BudgetEntry {
    let entry = this.entries.get(sessionId);
    if (!entry) {
      entry = {
        sessionId,
        snapshot: null,
        usageSeq: 0,
        figure: null,
        liveFigure: null,
        liveLoggedRank: UNKNOWN_RANK,
        wrapUpRequestedRank: UNKNOWN_RANK,
        configKey: null,
        compactions: 0,
        extensions: 0,
        actedRank: UNKNOWN_RANK,
        handoffCopy: null,
        handoffCopySeq: 0,
        warned: new Set<string>(),
        actions: Promise.resolve(),
      };
      this.entries.set(sessionId, entry);
    }
    return entry;
  }

  /** Remember the session workspace the first time session control knows it. */
  private rememberWorkspace(entry: BudgetEntry): void {
    if (entry.workspacePath !== undefined) return;
    const workspacePath = this.sessionControl.getSessionWorkspace(
      entry.sessionId,
    );
    if (workspacePath !== undefined) entry.workspacePath = workspacePath;
  }

  /** Store `snapshot`; a different snapshot is newer usage (`usageSeq`). */
  private storeSnapshot(entry: BudgetEntry, snapshot: SessionStatsEntry): void {
    if (entry.snapshot !== snapshot) entry.usageSeq += 1;
    entry.snapshot = snapshot;
  }

  /** False once the session was released (or released and re-created). */
  private isCurrent(entry: BudgetEntry): boolean {
    return this.entries.get(entry.sessionId) === entry;
  }

  private composeState(
    entry: BudgetEntry,
    figure: SessionBudgetFigure,
  ): SessionBudgetState {
    return {
      sessionId: entry.sessionId,
      ...figure,
      ...(entry.window ? { window: entry.window } : {}),
      ...(entry.handoff ? { handoff: entry.handoff } : {}),
      ...(entry.dismissedStage ? { dismissedStage: entry.dismissedStage } : {}),
      ...this.rotationField(entry.sessionId),
    };
  }

  /**
   * Re-read the rotation advisory for an accepted snapshot: the port's last
   * context reading, else the snapshot's last-turn context.
   */
  private evaluateRotation(snapshot: SessionStatsEntry): void {
    this.rotationAdvisor.evaluate(
      snapshot.sessionId,
      snapshot.contextSnapshot?.contextTokens,
    );
  }

  private rotationField(sessionId: string): {
    readonly rotation?: SessionBudgetRotation;
  } {
    const rotation = this.rotationAdvisor.current(sessionId);
    return rotation ? { rotation } : {};
  }

  /** The state published while `sessionBudget.enabled` is off. */
  private disabledState(
    snapshot: SessionStatsEntry,
    config: SessionBudgetConfig,
    entry: BudgetEntry,
  ): SessionBudgetState {
    const tokens = config.unit === 'tokens';
    return {
      sessionId: snapshot.sessionId,
      stage: 'unknown',
      unit: config.unit,
      measure: tokens ? 'tokens' : 'cost',
      used: null,
      limit: tokens ? config.tokens : config.usd,
      percent: null,
      lowerBound: false,
      revision: snapshot.revision ?? null,
      compactions: entry.compactions,
      extensions: entry.extensions,
      blocked: false,
      ...this.rotationField(snapshot.sessionId),
    };
  }

  private stateField(entry: BudgetEntry | undefined): {
    readonly state?: SessionBudgetState;
  } {
    return entry?.figure
      ? { state: this.composeState(entry, entry.figure) }
      : {};
  }

  private noState(): SessionBudgetActionResult {
    return {
      success: false,
      error: 'No budget state for this session',
      errorCode: 'NO_SESSION_BUDGET_STATE',
    };
  }

  private logStageChange(
    sessionId: string,
    from: SessionBudgetStage,
    figure: SessionBudgetFigure,
  ): void {
    this.logger.info(
      `[SessionBudget] Stage ${from} -> ${figure.stage} for ${sessionId}`,
      {
        measure: figure.measure,
        used: figure.used,
        limit: figure.limit,
        percent: figure.percent,
        compactions: figure.compactions,
        blocked: figure.blocked,
      },
    );
  }

  /**
   * Log the estimate's first arrival at `handoff`, and again at `limit`,
   * unless the authoritative stage already reached it; once per rank per
   * turn. Log only: the wrap-up notice is posted on the user's request.
   */
  private logLiveStage(
    entry: BudgetEntry,
    from: SessionBudgetStage,
    figure: SessionBudgetFigure,
  ): void {
    const rank = wrapUpRankOf(figure.stage);
    if (rank <= Math.max(entry.liveLoggedRank, entry.actedRank)) return;
    entry.liveLoggedRank = rank;
    this.logger.info(
      `[SessionBudget] Live stage ${from} -> ${figure.stage} for ${entry.sessionId}`,
      { measure: figure.measure, used: figure.used, percent: figure.percent },
    );
  }

  /** WARN once per session and failure kind. */
  private warnOnce(
    entry: BudgetEntry | undefined,
    sessionId: string,
    kind: string,
    error: unknown,
  ): void {
    if (entry) {
      if (entry.warned.has(kind)) return;
      entry.warned.add(kind);
    }
    this.logger.warn(`[SessionBudget] ${kind} failed for ${sessionId}`, {
      error: errorMessage(error),
    });
  }
}
