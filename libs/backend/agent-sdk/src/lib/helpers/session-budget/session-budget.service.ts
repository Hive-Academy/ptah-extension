/**
 * SessionBudgetService (TASK_2026_597 N7, decision 13) — the session budget
 * stage machine.
 *
 * Maps the displayed stats figure (the SAME `SessionStatsEntry` the chat chip
 * renders; no second counter) to a stage. The budget is advisory: it never
 * refuses or holds a send. The UI renders the stage; at `handoff` it offers
 * the user a button that sends an ordinary chat message asking the agent to
 * write its own handoff.
 *
 * The one stage action: at `tighten` the session's auto-compact window is
 * lowered through session control, ONLY when the user set
 * `tightenWindowTokens`; otherwise the stage is advisory and the window
 * reports `reason: 'disabled'`.
 *
 * State is keyed by `snapshot.sessionId` (the real SDK id, F1), held in memory
 * (one entry per live session, released on session end) and never persisted:
 * after a restart the stage is recomputed from the resume snapshot, and
 * compactions start over.
 *
 * `observe` is synchronous because its result rides on the result-stats
 * broadcast. The tighten action runs after it returns, serialised per
 * session; its outcome (window) is carried by the next published state. No
 * timers, no polling.
 *
 * Fails open: no figure → `unknown`; an action failure sets its state field,
 * WARNs once per session and failure kind, and the stage still advances.
 */

import { inject, injectable } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type {
  SessionBudgetConfig,
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
import { SessionRotationAdvisor } from '../compaction/session-rotation-advisor';
import { MainThreadNoticeQueue } from '../main-thread-notice-queue';
import {
  acceptsSessionBudgetSnapshot,
  evaluateSessionBudget,
  sessionBudgetStageRank,
  type SessionBudgetFigure,
} from './session-budget-stage';

/** Session-control surface the budget needs (the lifecycle manager). */
export type SessionBudgetSessionControl = Pick<
  SessionLifecycleManager,
  'applySessionAutoCompactWindow'
>;

/** Stats surface the budget reads to tell a late figure from a new run. */
export type SessionBudgetStatsSource = Pick<SessionStatsOwnerService, 'leaseOf'>;

export type SessionBudgetConfigSource = Pick<
  SessionBudgetConfigProvider,
  'getConfig'
>;

export type SessionBudgetRotationAdvisor = Pick<
  SessionRotationAdvisor,
  'evaluate' | 'current' | 'release'
>;

/** Notice-queue surface the budget needs: drop a session's pending notices. */
export type SessionBudgetNoticeQueue = Pick<MainThreadNoticeQueue, 'clear'>;

/**
 * The display-only live stage `observeLive` reports (D25): `undefined` keeps
 * what the webview shows, `null` clears it, a value sets it.
 */
export type SessionBudgetLiveStage = 'handoff' | 'limit' | null | undefined;

/**
 * `window.target` when the tighten stage is advisory only
 * (`tightenWindowTokens` unset): no window was requested.
 */
export const SESSION_BUDGET_NO_WINDOW_TARGET = 0;

/**
 * Released ids remembered so a late result or compaction cannot recreate
 * their entry; the oldest is forgotten past this many.
 */
const RELEASED_IDS_CAP = 1024;

const UNKNOWN_RANK = sessionBudgetStageRank('unknown');
const TIGHTEN_RANK = sessionBudgetStageRank('tighten');
const HANDOFF_RANK = sessionBudgetStageRank('handoff');
const LIMIT_RANK = sessionBudgetStageRank('limit');

interface BudgetEntry {
  readonly sessionId: string;
  /** Last accepted snapshot; re-evaluated on compaction. */
  snapshot: SessionStatsEntry | null;
  /** Figure and stage; `null` before the first figure or while disabled. */
  figure: SessionBudgetFigure | null;
  /**
   * The in-turn estimate's figure (`observeLive`): display only. Cleared at
   * turn end and by a newer authoritative snapshot.
   */
  liveFigure: SessionBudgetFigure | null;
  /** Highest live stage rank already logged in this turn. */
  liveLoggedRank: number;
  /** Settings the figure was computed with (a change resets the stage). */
  configKey: string | null;
  compactions: number;
  /** Highest stage rank whose action already ran (once per stage entry). */
  actedRank: number;
  window?: SessionBudgetWindow;
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

/** Display rank of a stage: `handoff`, `limit`, or none (`unknown`). */
function displayRankOf(stage: SessionBudgetStage | undefined): number {
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
   * the authoritative figure and display only: it never runs a stage action.
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
      const rank = displayRankOf(figure.stage);
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
   * Turn end: drop the in-turn estimate, its log rank and the session's
   * pending main-thread notices (they would land in the next turn).
   */
  onTurnTerminal(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (entry) {
      entry.liveFigure = null;
      entry.liveLoggedRank = UNKNOWN_RANK;
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
    const config = this.configSource.getConfig();
    if (!config.enabled) return;
    this.applyEvaluation(entry, config, true);
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
    const config = this.configSource.getConfig();

    if (!config.enabled) {
      // Disabled: no stage, no budget banner on this figure (the rotation
      // advisory still rides it). The next enabled figure starts the stage
      // over (the settings changed).
      this.evaluateRotation(snapshot);
      entry.snapshot = snapshot;
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
    entry.snapshot = snapshot;
    // A newer authoritative snapshot replaces the in-turn estimate (626).
    if ((snapshot.revision ?? -1) > (entry.liveFigure?.revision ?? -1)) {
      entry.liveFigure = null;
    }
    return this.applyEvaluation(entry, config, source === 'live');
  }

  /** Evaluate the entry's snapshot, store the figure, schedule actions. */
  private applyEvaluation(
    entry: BudgetEntry,
    config: SessionBudgetConfig,
    runActions: boolean,
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
      resetStage: configChanged,
      resetMeasure: configChanged,
    });
    entry.figure = figure;
    entry.configKey = key;
    if (configChanged) {
      // The estimate was measured against the old settings; the next one
      // re-evaluates.
      entry.liveFigure = null;
      entry.liveLoggedRank = UNKNOWN_RANK;
    }

    const rank = sessionBudgetStageRank(figure.stage);
    if (rank < entry.actedRank) {
      // The stage fell (a settings change): re-entering a stage runs its
      // action again.
      entry.actedRank = rank;
    }
    if (previous && previous.stage !== figure.stage) {
      this.logStageChange(entry.sessionId, previous.stage, figure);
    } else if (!previous && figure.stage !== 'unknown') {
      this.logStageChange(entry.sessionId, 'unknown', figure);
    }
    if (runActions && rank > entry.actedRank) {
      if (entry.actedRank < TIGHTEN_RANK && rank >= TIGHTEN_RANK) {
        entry.actions = entry.actions.then(() => this.tighten(entry, config));
      }
      entry.actedRank = rank;
    }
    return this.composeState(entry, figure);
  }

  // ---------------------------------------------------------------------------
  // Stage action
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // State helpers
  // ---------------------------------------------------------------------------

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
    const entry: BudgetEntry = {
      sessionId,
      snapshot: null,
      figure: null,
      liveFigure: null,
      liveLoggedRank: UNKNOWN_RANK,
      configKey: null,
      compactions: 0,
      actedRank: UNKNOWN_RANK,
      warned: new Set<string>(),
      actions: Promise.resolve(),
    };
    this.entries.set(sessionId, entry);
    return entry;
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
      ...this.rotationField(snapshot.sessionId),
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
      },
    );
  }

  /**
   * Log the estimate's first arrival at `handoff`, and again at `limit`,
   * unless the authoritative stage already reached it; once per rank per
   * turn.
   */
  private logLiveStage(
    entry: BudgetEntry,
    from: SessionBudgetStage,
    figure: SessionBudgetFigure,
  ): void {
    const rank = displayRankOf(figure.stage);
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
