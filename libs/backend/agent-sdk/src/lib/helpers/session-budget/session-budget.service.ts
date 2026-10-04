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
 * Bounded overshoot (F7, accepted): the result that crosses 100% is the first
 * to block, and a follow-up the user queued during that turn is released by
 * `onTurnEnd` before the crossing figure reaches `observe`. So at most the
 * crossing turn plus one held follow-up run past the limit.
 */

import { inject, injectable } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type {
  SessionBudgetAction,
  SessionBudgetActionResult,
  SessionBudgetConfig,
  SessionBudgetHandoff,
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
  type SessionHandoffDocument,
} from './session-handoff-builder';
import { SessionHandoffWriter } from './session-handoff-writer';
import {
  acceptsSessionBudgetSnapshot,
  evaluateSessionBudget,
  sessionBudgetStageRank,
  type SessionBudgetFigure,
} from './session-budget-stage';

/** Session-control surface the budget needs (the lifecycle manager). */
export type SessionBudgetSessionControl = Pick<
  SessionLifecycleManager,
  'applySessionAutoCompactWindow' | 'getSessionWorkspace'
>;

/** Stats surface the budget reads when it has no state yet. */
export type SessionBudgetStatsSource = Pick<
  SessionStatsOwnerService,
  'snapshot'
>;

export type SessionBudgetConfigSource = Pick<
  SessionBudgetConfigProvider,
  'getConfig'
>;

export type SessionBudgetHandoffBuilder = Pick<SessionHandoffBuilder, 'build'>;

export type SessionBudgetHandoffWriter = Pick<SessionHandoffWriter, 'write'>;

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
  /** Figure and stage; `null` before the first figure or while disabled. */
  figure: SessionBudgetFigure | null;
  /** Settings the figure was computed with (a change resets the stage). */
  configKey: string | null;
  compactions: number;
  extensions: number;
  /** Highest stage rank whose action already ran (once per stage entry). */
  actedRank: number;
  window?: SessionBudgetWindow;
  handoff?: SessionBudgetHandoff;
  handoffCopy: HandoffCopy | null;
  dismissedStage?: SessionBudgetStage;
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

@injectable()
export class SessionBudgetService {
  private readonly entries = new Map<string, BudgetEntry>();

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
  ) {}

  /**
   * Live result snapshot. `undefined` (no snapshot this result) returns
   * `undefined`: the consumer keeps the last state it has (F5).
   */
  observe(
    snapshot: SessionStatsEntry | undefined,
  ): SessionBudgetState | undefined {
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
  ): SessionBudgetState | undefined {
    if (!snapshot) return undefined;
    return this.accept(snapshot, 'loaded');
  }

  /**
   * One main-loop `compact_boundary` (F8). Counts toward the
   * `handoffAfterCompactions` trigger; in memory only.
   */
  recordCompaction(sessionId: string): void {
    const entry = this.entryFor(sessionId);
    entry.compactions += 1;
    if (!entry.snapshot || !entry.figure) return;
    this.reevaluate(entry, { resetStage: false, runActions: true });
  }

  /**
   * Whether a new turn may be sent. The session's state decides; with no
   * state the owner's current snapshot is evaluated on the fly; with neither
   * the answer is ok (fail-open, F2).
   */
  canSend(sessionId: string): SessionBudgetSendCheck {
    const entry = this.entries.get(sessionId);
    if (entry?.figure) {
      return entry.figure.blocked
        ? { ok: false, state: this.composeState(entry, entry.figure) }
        : SEND_OK;
    }
    try {
      return this.checkSnapshot(sessionId, entry);
    } catch (error: unknown) {
      // Fail-open by design (F2): an unreadable budget never blocks a send;
      // the failure is WARNed once for the session.
      this.warnOnce(entry, sessionId, 'can-send', error);
      return SEND_OK;
    }
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
          return this.extend(entry);
        case 'restore-window':
          return await this.restoreWindow(sessionId, entry);
        case 'write-handoff':
          return await this.writeHandoffAction(sessionId, entry);
        case 'preview-handoff':
          return await this.previewHandoff(sessionId, entry);
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

  /** Session end: drop its state. */
  release(sessionId: string): void {
    this.entries.delete(sessionId);
  }

  /** Disposal: drop every session's state. */
  clearAll(): void {
    this.entries.clear();
  }

  // ---------------------------------------------------------------------------
  // Evaluation
  // ---------------------------------------------------------------------------

  private accept(
    snapshot: SessionStatsEntry,
    source: ObserveSource,
  ): SessionBudgetState | undefined {
    try {
      return this.acceptOrThrow(snapshot, source);
    } catch (error: unknown) {
      // degradation-audit: reported - an observe failure must never break the
      // result-stats broadcast; the consumer keeps its last state (F5).
      this.warnOnce(
        this.entryFor(snapshot.sessionId),
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
  ): SessionBudgetState | undefined {
    const config = this.configSource.getConfig();
    const entry = this.entryFor(snapshot.sessionId);

    if (!config.enabled) {
      // Disabled: no stage, no block, no banner on this figure. The next
      // enabled figure starts the stage over (the settings changed).
      entry.snapshot = snapshot;
      entry.figure = null;
      entry.configKey = null;
      return this.disabledState(snapshot, config, entry);
    }

    if (
      !acceptsSessionBudgetSnapshot(entry.figure, snapshot.revision, source)
    ) {
      return entry.figure ? this.composeState(entry, entry.figure) : undefined;
    }

    entry.snapshot = snapshot;
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

  private checkSnapshot(
    sessionId: string,
    entry: BudgetEntry | undefined,
  ): SessionBudgetSendCheck {
    const snapshot = this.statsOwner.snapshot(sessionId);
    if (!snapshot) return SEND_OK;
    const config = this.configSource.getConfig();
    if (!config.enabled) return SEND_OK;
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
    return {
      ok: false,
      state: { sessionId, ...figure },
    };
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
    const document = await this.buildHandoff(sessionId, entry);
    const written = await this.handoffWriter.write(sessionId, document.content);
    const copy: HandoffCopy = {
      content: document.content,
      seed: document.seed,
      path: written.path,
    };
    if (entry && this.isCurrent(entry)) {
      entry.handoffCopy = copy;
      entry.handoff = {
        path: written.path,
        chars: document.chars,
        truncated: document.truncated,
        writtenAt: document.builtAt,
        ...(written.writeError !== undefined
          ? { writeError: written.writeError }
          : {}),
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

  private async buildHandoff(
    sessionId: string,
    entry: BudgetEntry | undefined,
  ): Promise<SessionHandoffDocument> {
    const budget = entry?.figure
      ? this.composeState(entry, entry.figure)
      : undefined;
    const workspacePath = this.sessionControl.getSessionWorkspace(sessionId);
    if (workspacePath === undefined) {
      this.warnOnce(
        entry,
        sessionId,
        'handoff-read',
        new Error(
          'session workspace unknown; handoff built without the transcript',
        ),
      );
      return assembleSessionHandoff([], {
        sessionId,
        builtAt: Date.now(),
        ...(budget ? { budget } : {}),
      });
    }
    const result = await this.handoffBuilder.build({
      sessionId,
      workspacePath,
      ...(budget ? { budget } : {}),
    });
    if (result.readError !== undefined) {
      this.warnOnce(
        entry,
        sessionId,
        'handoff-read',
        new Error(result.readError),
      );
    }
    return result.document;
  }

  // ---------------------------------------------------------------------------
  // User actions
  // ---------------------------------------------------------------------------

  private dismiss(entry: BudgetEntry | undefined): SessionBudgetActionResult {
    if (!entry?.figure) return this.noState();
    entry.dismissedStage = entry.figure.stage;
    return { success: true, state: this.composeState(entry, entry.figure) };
  }

  /** "Allow 20% more": at `limit` only; each extension adds 20% of the limit. */
  private extend(entry: BudgetEntry | undefined): SessionBudgetActionResult {
    if (!entry?.figure) return this.noState();
    if (entry.figure.stage !== 'limit') {
      return {
        success: false,
        state: this.composeState(entry, entry.figure),
        error: 'Allow 20% more is only available at the limit',
      };
    }
    entry.extensions += 1;
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
    if (window?.reason === 'failed') {
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
    const copy = await this.writeHandoff(sessionId, entry);
    return { success: true, ...this.stateField(entry), handoff: copy };
  }

  /** The latest handoff in memory, else one built now (not written). */
  private async previewHandoff(
    sessionId: string,
    entry: BudgetEntry | undefined,
  ): Promise<SessionBudgetActionResult> {
    const kept = entry?.handoffCopy;
    if (kept) {
      return { success: true, ...this.stateField(entry), handoff: kept };
    }
    const document = await this.buildHandoff(sessionId, entry);
    const built: HandoffCopy = {
      content: document.content,
      seed: document.seed,
      path: null,
    };
    return { success: true, ...this.stateField(entry), handoff: built };
  }

  // ---------------------------------------------------------------------------
  // State helpers
  // ---------------------------------------------------------------------------

  private entryFor(sessionId: string): BudgetEntry {
    let entry = this.entries.get(sessionId);
    if (!entry) {
      entry = {
        sessionId,
        snapshot: null,
        figure: null,
        configKey: null,
        compactions: 0,
        extensions: 0,
        actedRank: sessionBudgetStageRank('unknown'),
        handoffCopy: null,
        warned: new Set<string>(),
        actions: Promise.resolve(),
      };
      this.entries.set(sessionId, entry);
    }
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
      ...(entry.handoff ? { handoff: entry.handoff } : {}),
      ...(entry.dismissedStage ? { dismissedStage: entry.dismissedStage } : {}),
    };
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
    return { success: false, error: 'No budget state for this session' };
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
