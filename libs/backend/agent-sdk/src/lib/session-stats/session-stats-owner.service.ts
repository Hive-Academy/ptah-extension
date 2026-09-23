/**
 * SessionStatsOwnerService — the single backend authority for one session's
 * lifetime accounting (TASK_2026_533).
 *
 * Per session it keeps, in memory only:
 * - a FIXED history prefix: the transcript aggregate read when the first query
 *   run of this owner is prepared (a known-empty prefix for a brand-new
 *   session). A history read alone never creates an owner;
 * - for each query run, keyed by the registry `SessionRecord.token` of the
 *   query that produced it, the LATEST cumulative SDK result. A newer result
 *   for the same run REPLACES the stored one; it is never added;
 * - the set of canonical subagent identities that belong to the session;
 * - a generation (owner identity), an epoch (latest prepared run) and a
 *   revision, all monotonic within this process.
 *
 * Snapshot = prefix + Σ over runs of the run's own spend. A run's own spend is
 * its latest cumulative figures minus the base it started from: the RAW
 * `cost-state` on disk when the run was prepared, if the run restored it
 * ({@link resolveRunBase}, decided once on the first accepted result;
 * {@link subtractRunBase} removes it).
 *
 * Inside one run the SDK's running total only grows. The one SDK reset,
 * `/clear`, never reaches the SDK: Ptah handles it natively
 * (`slash-command-interceptor.ts` `NATIVE_COMMANDS`), ending the query, and
 * the next message starts a NEW run whose base is detected like any other.
 * So a result is accepted only when it keeps every model the run already
 * reported and no counter of a shared model went down; anything else is
 * rejected atomically.
 *
 * Arithmetic is `aggregateSessionUsage`'s; this class owns identity and
 * lifecycle only. No disk state: after a restart the snapshot is rebuilt from
 * the transcript through the same aggregator. The class logs nothing — every
 * operation returns its outcome and the caller logs through its own logger.
 */

import { injectable } from 'tsyringe';
import { z } from 'zod';
import {
  calculateMessageCost,
  type ModelPricing,
  type SessionStatsEntry,
} from '@ptah-extension/shared';
import {
  aggregateSessionUsage,
  canonicalSubagentId,
  emptySessionStats,
  failedSessionStats,
  type SessionStatsReadEntry,
} from './session-usage-aggregator';

/**
 * Who is authoritative for a query run's dollars, frozen when the query is
 * created. `'reported'`: the provider's own `total_cost_usd` / `costUSD`
 * (including a reported zero). `'unreported'`: the route's dollar figures are
 * not authoritative, so every model is priced from the rate card by its own
 * id. Classifies cost authority, never a provider name.
 */
export type UsageCostSource = 'reported' | 'unreported';

/** One model's usage in the SDK's saved `cost-state` transcript entry. */
export interface SavedModelCost {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheCreation: number;
  readonly costUSD: number | null;
}

/**
 * The SDK's running totals as saved in the transcript (`type: 'cost-state'`,
 * written when a CLI process ends). A resumed process MAY continue from them.
 * Keys of `models` are the SDK's own model ids.
 */
export interface SavedCostState {
  readonly totalCostUSD: number | null;
  readonly hasUnknownModelCost: boolean;
  readonly models: Readonly<Record<string, SavedModelCost>>;
}

const Counter = z.number().finite().nonnegative();

/**
 * Boundary schema for a transcript `cost-state` entry. Written by an external
 * CLI, so every number is checked; one malformed field rejects the whole
 * entry, because a half-trusted base would corrupt every later figure.
 */
const SavedCostStateSchema = z.object({
  totalCostUSD: Counter,
  hasUnknownModelCost: z.boolean().optional(),
  modelUsage: z.record(
    z.string(),
    z.object({
      inputTokens: Counter,
      outputTokens: Counter,
      cacheReadInputTokens: Counter.optional(),
      cacheCreationInputTokens: Counter.optional(),
      costUSD: Counter.optional(),
    }),
  ),
});

/**
 * Validate the raw payload of a transcript `cost-state` entry. Returns `null`
 * when it is absent or malformed.
 */
export function parseSavedCostState(raw: {
  readonly totalCostUSD?: unknown;
  readonly modelUsage?: unknown;
  readonly hasUnknownModelCost?: unknown;
} | null | undefined): SavedCostState | null {
  if (!raw) return null;
  const parsed = SavedCostStateSchema.safeParse(raw);
  if (!parsed.success) return null;
  const models: Record<string, SavedModelCost> = {};
  for (const [model, usage] of Object.entries(parsed.data.modelUsage)) {
    models[model] = {
      input: usage.inputTokens,
      output: usage.outputTokens,
      cacheRead: usage.cacheReadInputTokens ?? 0,
      cacheCreation: usage.cacheCreationInputTokens ?? 0,
      costUSD: usage.costUSD ?? null,
    };
  }
  return {
    totalCostUSD: parsed.data.totalCostUSD,
    hasUnknownModelCost: parsed.data.hasUnknownModelCost ?? false,
    models,
  };
}

/** The transcript aggregate a session's owner starts from. */
export interface SessionStatsPrefix {
  /** Lifetime-scope aggregate of the transcript (`scope: 'session'`). */
  readonly stats: SessionStatsReadEntry;
  /** Subagent identities the transcript proves, any alias form. */
  readonly subagentIds: readonly string[];
  /** The main transcript's LAST `cost-state` entry, or `null`. */
  readonly savedCostState: SavedCostState | null;
}

/** One model's cumulative usage inside one SDK result. */
export interface RunModelUsage {
  /** The SDK's own model id (the `modelUsage` key). */
  readonly model: string;
  /** Uncached input tokens. */
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheRead: number;
  readonly cacheCreation: number;
  /** `null` when this model's price is unknown. */
  readonly costUSD: number | null;
  /**
   * The rate this row was priced with, present only for `'unreported'` runs.
   * Lets a base be subtracted in TOKENS and the difference repriced, since the
   * SDK's saved dollars are not authoritative on such a route.
   */
  readonly pricing?: ModelPricing | null;
}

/**
 * One SDK `result`, normalized: the cumulative per-model usage of the query
 * run so far and the run's authoritative cost, `null` when unknown.
 */
export interface RunUsageResult {
  readonly models: readonly RunModelUsage[];
  readonly totalCost: number | null;
  readonly costSource: UsageCostSource;
  /**
   * An SDK error/startup result (`subtype` other than `'success'`, or
   * `is_error`). Such a result with all-zero usage is a crash/startup
   * placeholder (sdk.d.ts: "may carry zeroed values") and is ignored.
   */
  readonly isErrorResult?: boolean;
}

/**
 * The base a query run's cumulative figures started from: the saved state
 * the SDK restored, or `null` for zero.
 *
 * Restored iff every model of `saved` is present in `first` (absent reads as
 * zero) with all four token classes at least as large; anything else is a
 * reset. Evidence from real transcripts: Claude sessions restore exactly
 * (next saved state = previous saved state + the usage between them), while
 * proxied sessions sometimes reset to zero, so this is detected per run and
 * never assumed. Cost is not compared: only token counters are.
 *
 * Known limit: a reset whose first result already exceeds a tiny saved state
 * in every class is read as restored, and the error is bounded by that saved
 * state.
 */
export function resolveRunBase(
  saved: SavedCostState | null,
  first: RunUsageResult,
): SavedCostState | null {
  if (saved === null) return null;
  const byModel = new Map(first.models.map((m) => [m.model, m]));
  for (const [model, base] of Object.entries(saved.models)) {
    const now = byModel.get(model);
    const restored =
      (now?.inputTokens ?? 0) >= base.input &&
      (now?.outputTokens ?? 0) >= base.output &&
      (now?.cacheRead ?? 0) >= base.cacheRead &&
      (now?.cacheCreation ?? 0) >= base.cacheCreation;
    if (!restored) return null;
  }
  return saved;
}

/**
 * The run's own spend: `result` minus `base`, per model and per token class.
 *
 * Dollars: on a `'reported'` run, `result − base` for the total and for each
 * row, `null` when either side is unknown (or the saved state flagged an
 * unknown model cost). On an `'unreported'` run each row's token difference is
 * repriced with the row's own rate and the total is their sum, `null` when any
 * row is unpriced.
 */
export function subtractRunBase(
  result: RunUsageResult,
  base: SavedCostState | null,
): RunUsageResult {
  if (base === null) return result;
  const models = result.models.map((row): RunModelUsage => {
    const was = base.models[row.model];
    if (!was) return row;
    const delta = {
      input: row.inputTokens - was.input,
      output: row.outputTokens - was.output,
      cacheRead: row.cacheRead - was.cacheRead,
      cacheCreation: row.cacheCreation - was.cacheCreation,
    };
    let costUSD: number | null;
    if (result.costSource === 'unreported') {
      costUSD =
        row.pricing === undefined || row.pricing === null
          ? null
          : calculateMessageCost(
              row.model,
              {
                input: delta.input,
                output: delta.output,
                cacheHit: delta.cacheRead,
                cacheCreation: delta.cacheCreation,
              },
              row.pricing,
            );
    } else {
      costUSD =
        row.costUSD === null || was.costUSD === null
          ? null
          : nonNegativeUsd(row.costUSD - was.costUSD);
    }
    return {
      model: row.model,
      inputTokens: delta.input,
      outputTokens: delta.output,
      cacheRead: delta.cacheRead,
      cacheCreation: delta.cacheCreation,
      costUSD,
      ...(row.pricing !== undefined && { pricing: row.pricing }),
    };
  });
  let totalCost: number | null;
  if (result.costSource === 'unreported') {
    totalCost = models.every((m) => m.costUSD !== null)
      ? nonNegativeUsd(models.reduce((sum, m) => sum + (m.costUSD ?? 0), 0))
      : null;
  } else {
    totalCost =
      result.totalCost === null ||
      base.totalCostUSD === null ||
      base.hasUnknownModelCost
        ? null
        : nonNegativeUsd(result.totalCost - base.totalCostUSD);
  }
  return { ...result, models, totalCost };
}

/** What the owner did with a result it was offered. */
export type RunResultOutcome =
  /** Stored as the run's latest cumulative value (first, or grown). */
  | 'accepted'
  /** Identical to the stored value; nothing changed. */
  | 'duplicate'
  /** A zeroed error/startup result; ignored. */
  | 'ignored-error'
  /** Malformed or empty; the accepted state is unchanged. */
  | 'rejected-invalid'
  /**
   * Not a continuation of the run's accepted running total: a previously
   * accepted model is missing, or a counter of a shared model decreased.
   * Rejected atomically; state unchanged.
   */
  | 'rejected-non-monotonic'
  /** The owner generation this result belongs to was released or replaced. */
  | 'stale-owner';

/**
 * Identity of one owner and of the latest run prepared on it.
 *
 * `generation` names the owner object: a released or replaced owner never
 * takes results or releases for a new one. `epoch` advances whenever a newer
 * run is prepared, so a teardown that captured an older epoch cannot release
 * an owner a replacement run is already using.
 */
export interface OwnerLease {
  readonly generation: number;
  readonly epoch: number;
}

/** A prepared run: the owner lease plus its restore candidate. */
export interface RunPreparation extends OwnerLease {
  /**
   * The transcript's last RAW SDK `cost-state` at the moment this run was
   * prepared — what the new process can restore from. Never a normalized or
   * rate-card figure, never another run's in-memory value.
   */
  readonly candidate: SavedCostState | null;
}

/** How {@link SessionStatsOwnerService.prepareRun} reads the transcript. */
export interface RunPreparationLoaders {
  /** The lifetime prefix plus its last `cost-state`; read once per owner. */
  readonly loadPrefix: () => Promise<SessionStatsPrefix | null>;
  /** Only the transcript's last `cost-state`, re-read for every later run. */
  readonly loadSavedCostState: () => Promise<SavedCostState | null>;
}

interface RunState {
  /** Restore candidate captured when the run was prepared. */
  readonly candidate: SavedCostState | null;
  /** `undefined` until the run's first accepted result decides it. */
  base: SavedCostState | null | undefined;
  /** The latest accepted cumulative value of the run. */
  current: RunUsageResult | null;
  /** The run is known to be under-counted until a complete result covers it. */
  incomplete: boolean;
  /** A non-monotonic rejection was already reported for this run. */
  rejectionReported: boolean;
}

interface OwnerState {
  readonly generation: number;
  epoch: number;
  /** Transcript prefix; `null` while unknown (not read yet, or unreadable). */
  prefix: SessionStatsReadEntry | null;
  /** The single in-flight prefix read, shared by concurrent launches. */
  pending: Promise<SessionStatsPrefix | null> | null;
  /** Runs in preparation order. */
  readonly runs: Map<string, RunState>;
  /** Canonical subagent ids. */
  readonly agentIds: Set<string>;
  revision: number;
  /** The immutable snapshot for `revision`, built on first request. */
  published: SessionStatsEntry | null;
}

@injectable()
export class SessionStatsOwnerService {
  private readonly states = new Map<string, OwnerState>();
  /** Process-wide counters, so a recreated owner never reuses an identity. */
  private revisionCounter = 0;
  private generationCounter = 0;
  private epochCounter = 0;

  /**
   * Begin a brand-new session under `sessionKey` (a provisional tab id until
   * {@link rebind}): known-empty prefix. Replaces any owner held under that
   * key, because a new session on that key is new.
   */
  startNew(sessionKey: string): OwnerLease {
    const state = this.createState(emptySessionStats(sessionKey));
    this.states.set(sessionKey, state);
    this.touch(state);
    return { generation: state.generation, epoch: state.epoch };
  }

  /**
   * Prepare a query run on an existing transcript, BEFORE the query launches.
   *
   * The first run of an owner reads the lifetime prefix (once; concurrent
   * launches share the read) and takes that read's last `cost-state` as its
   * restore candidate. Every later run re-reads ONLY the last `cost-state`, so
   * its candidate is what is on disk when the new process starts — the frozen
   * prefix is never rebuilt. A `null` or failed read leaves the prefix unknown
   * (partial coverage, no total) or the candidate absent (zero base).
   */
  async prepareRun(
    sessionId: string,
    loaders: RunPreparationLoaders,
  ): Promise<RunPreparation> {
    let state = this.states.get(sessionId);
    if (!state) {
      state = this.createState(null);
      this.states.set(sessionId, state);
      state.pending = this.loadPrefixOnce(state, loaders.loadPrefix);
    }
    // Synchronously, before any await: a teardown that captured the previous
    // epoch can no longer release this owner.
    state.epoch = ++this.epochCounter;
    const lease = { generation: state.generation, epoch: state.epoch };
    const candidate = state.pending
      ? ((await state.pending)?.savedCostState ?? null)
      : await readOrNull(loaders.loadSavedCostState);
    return { ...lease, candidate };
  }

  /**
   * Register a query run with the restore candidate captured when it was
   * prepared. Idempotent for a known run, so an active-reuse stream keeps the
   * run it already had. Returns `false` when the generation is not current.
   */
  beginRun(
    sessionKey: string,
    generation: number,
    runToken: string,
    candidate: SavedCostState | null,
  ): boolean {
    const state = this.currentState(sessionKey, generation);
    if (!state) return false;
    if (!state.runs.has(runToken)) {
      state.runs.set(runToken, createRun(candidate));
    }
    return true;
  }

  /**
   * Move a provisional key's owner to the canonical session id once the SDK
   * reports it. Moved, never cloned; only the named generation moves.
   */
  rebind(provisionalKey: string, canonicalId: string, generation: number): void {
    if (provisionalKey === canonicalId) return;
    const state = this.currentState(provisionalKey, generation);
    if (!state) return;
    this.states.delete(provisionalKey);
    this.states.set(canonicalId, state);
    this.touch(state);
  }

  /**
   * Offer a run's latest cumulative result. Acts only on the named owner
   * generation and never creates an owner, so a late result from a released
   * owner cannot resurrect it. See {@link RunResultOutcome}.
   */
  replaceRun(
    sessionId: string,
    generation: number,
    runToken: string,
    result: RunUsageResult,
  ): {
    readonly outcome: RunResultOutcome;
    readonly snapshot: SessionStatsEntry | null;
    /**
     * `true` for the FIRST non-monotonic rejection of this run only, so the
     * caller logs it once per run rather than on every later result.
     */
    readonly firstRejection: boolean;
  } {
    const state = this.currentState(sessionId, generation);
    if (!state) {
      return { outcome: 'stale-owner', snapshot: null, firstRejection: false };
    }
    const run = runFor(state, runToken);
    const outcome = applyResult(run, result);
    let firstRejection = false;
    if (outcome === 'accepted') {
      this.touch(state);
    } else if (outcome === 'rejected-non-monotonic' && !run.rejectionReported) {
      run.rejectionReported = true;
      firstRejection = true;
    }
    return {
      outcome,
      snapshot: this.publish(sessionId, state),
      firstRejection,
    };
  }

  /**
   * A result arrived without per-model attribution: its per-turn usage is not
   * a cumulative run total, so nothing is counted, but the run is known to be
   * under-counted until a later complete cumulative result covers it.
   */
  markRunIncomplete(
    sessionId: string,
    generation: number,
    runToken: string,
  ): SessionStatsEntry | null {
    const state = this.currentState(sessionId, generation);
    if (!state) return null;
    const run = runFor(state, runToken);
    if (!run.incomplete) {
      run.incomplete = true;
      this.touch(state);
    }
    return this.publish(sessionId, state);
  }

  /**
   * Record a subagent identity for a session this owner tracks. Aliases
   * (`agent-<id>`, `<id>`) collapse to one; stop hooks and replays never
   * remove an identity. Returns whether the count changed.
   */
  recordAgent(sessionId: string, agentId: string): boolean {
    const state = this.states.get(sessionId);
    const id = canonicalSubagentId(agentId);
    if (!state || id === null || state.agentIds.has(id)) return false;
    state.agentIds.add(id);
    this.touch(state);
    return true;
  }

  /** The current immutable snapshot, or `null` when the session has no owner. */
  snapshot(sessionId: string): SessionStatsEntry | null {
    const state = this.states.get(sessionId);
    return state ? this.publish(sessionId, state) : null;
  }

  /** The owner's identity now, for a caller that may release it later. */
  leaseOf(sessionKey: string): OwnerLease | null {
    const state = this.states.get(sessionKey);
    return state ? { generation: state.generation, epoch: state.epoch } : null;
  }

  /**
   * Release an owner — only the exact owner and run epoch the caller
   * captured, wherever that owner is now keyed: a provisional tab key the
   * owner was rebound from since the capture still releases it under its
   * canonical id. Whatever owner occupies a key is never released by key
   * alone. A replacement owner, or a newer run prepared on the same owner
   * since the capture, survives an older teardown.
   */
  release(lease: OwnerLease): boolean {
    for (const [key, state] of this.states) {
      if (state.generation !== lease.generation) continue;
      if (state.epoch !== lease.epoch) return false;
      this.states.delete(key);
      return true;
    }
    return false;
  }

  /** Release every owner (backend disposal). */
  clearAll(): void {
    this.states.clear();
  }

  private currentState(key: string, generation: number): OwnerState | null {
    const state = this.states.get(key);
    return state && state.generation === generation ? state : null;
  }

  private loadPrefixOnce(
    state: OwnerState,
    loadPrefix: () => Promise<SessionStatsPrefix | null>,
  ): Promise<SessionStatsPrefix | null> {
    return (async () => {
      try {
        const loaded = await readOrNull(loadPrefix);
        if (loaded) {
          state.prefix = loaded.stats;
          for (const raw of loaded.subagentIds) {
            const id = canonicalSubagentId(raw);
            if (id !== null) state.agentIds.add(id);
          }
          this.touch(state);
        }
        return loaded;
      } finally {
        state.pending = null;
      }
    })();
  }

  private createState(prefix: SessionStatsReadEntry | null): OwnerState {
    return {
      generation: ++this.generationCounter,
      epoch: ++this.epochCounter,
      prefix,
      pending: null,
      runs: new Map(),
      agentIds: new Set(),
      revision: 0,
      published: null,
    };
  }

  private touch(state: OwnerState): void {
    state.revision = ++this.revisionCounter;
    state.published = null;
  }

  private publish(sessionId: string, state: OwnerState): SessionStatsEntry {
    if (state.published && state.published.sessionId === sessionId) {
      return state.published;
    }
    const contributions: SessionStatsReadEntry[] = [
      state.prefix === null
        ? failedSessionStats(sessionId)
        : { ...state.prefix, sessionId },
    ];
    let incomplete = false;
    for (const run of state.runs.values()) {
      incomplete ||= run.incomplete;
      if (run.current) {
        contributions.push(
          runContribution(
            sessionId,
            subtractRunBase(run.current, run.base ?? null),
          ),
        );
      }
    }
    const merged = aggregateSessionUsage({
      sessionId,
      contributions,
      subagentIds: [...state.agentIds],
    });
    const snapshot: SessionStatsEntry = Object.freeze({
      ...merged,
      // Known-missing usage: what IS priced survives only as the labeled
      // subtotal; a total would claim coverage the owner does not have.
      ...(incomplete && {
        totalCost: null,
        knownCost: merged.knownCost ?? null,
        coverage: 'partial' as const,
        pricingCoverage:
          merged.pricingCoverage === 'full'
            ? ('partial' as const)
            : merged.pricingCoverage,
      }),
      revision: state.revision,
    });
    state.published = snapshot;
    return snapshot;
  }
}

function createRun(candidate: SavedCostState | null): RunState {
  return {
    candidate,
    base: undefined,
    current: null,
    incomplete: false,
    rejectionReported: false,
  };
}

/**
 * The run a result belongs to. A token no one registered (no
 * {@link SessionStatsOwnerService.beginRun}) has no restore candidate, so its
 * base is zero.
 */
function runFor(state: OwnerState, runToken: string): RunState {
  let run = state.runs.get(runToken);
  if (!run) {
    run = createRun(null);
    state.runs.set(runToken, run);
  }
  return run;
}

function applyResult(run: RunState, result: RunUsageResult): RunResultOutcome {
  if (result.isErrorResult && isZeroUsage(result)) return 'ignored-error';
  if (!isValidResult(result)) return 'rejected-invalid';
  const current = run.current;
  if (current === null) {
    if (run.base === undefined) {
      run.base = resolveRunBase(run.candidate, result);
    }
  } else if (isSameUsage(current, result)) {
    return 'duplicate';
  } else if (!isGrown(current, result)) {
    return 'rejected-non-monotonic';
  }
  run.current = result;
  // A complete cumulative value covers everything the run spent so far.
  run.incomplete = false;
  return 'accepted';
}

/** Run a loader; a rejection reads as "nothing known". The loader logs. */
async function readOrNull<T>(load: () => Promise<T | null>): Promise<T | null> {
  try {
    return await load();
  } catch (error: unknown) {
    // Deliberately absorbed: an unreadable transcript must not stop a session
    // from launching. `null` makes the prefix unknown (partial coverage, no
    // total) or the restore candidate absent. The loader owns the logging.
    void error;
    return null;
  }
}

/** One run's own spend as an aggregator contribution. */
function runContribution(
  sessionId: string,
  result: RunUsageResult,
): SessionStatsReadEntry {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  let knownRows = 0;
  let knownRowCost = 0;
  let unknownRows = 0;
  for (const m of result.models) {
    tokens.input += m.inputTokens;
    tokens.output += m.outputTokens;
    tokens.cacheRead += m.cacheRead;
    tokens.cacheCreation += m.cacheCreation;
    if (m.costUSD === null) {
      unknownRows++;
    } else {
      knownRows++;
      knownRowCost += m.costUSD;
    }
  }
  const tokenCount =
    tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreation;
  const known = result.totalCost !== null;
  return {
    sessionId,
    model: result.models[0]?.model ?? null,
    totalCost: result.totalCost,
    knownCost: known ? result.totalCost : knownRows > 0 ? knownRowCost : null,
    tokens,
    tokenCount,
    messageCount: 0,
    modelUsageList: result.models.map((m) => ({
      model: m.model,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      cacheRead: m.cacheRead,
      cacheCreation: m.cacheCreation,
      costUSD: m.costUSD,
    })),
    status: tokenCount > 0 || (result.totalCost ?? 0) > 0 ? 'ok' : 'empty',
    // A known aggregate with unattributed rows keeps its total, but the row
    // breakdown is incomplete.
    coverage: known && unknownRows > 0 ? 'partial' : 'complete',
    untimestampedCount: 0,
    pricingCoverage: known ? 'full' : knownRows > 0 ? 'partial' : 'none',
  };
}

function nonNegativeUsd(value: number): number {
  return Math.max(0, Math.round(value * 1e6) / 1e6);
}

function isFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function isValidResult(result: RunUsageResult): boolean {
  if (result.models.length === 0) return false;
  if (result.totalCost !== null && !isFiniteNonNegative(result.totalCost)) {
    return false;
  }
  return result.models.every(
    (m) =>
      typeof m.model === 'string' &&
      m.model.trim().length > 0 &&
      isFiniteNonNegative(m.inputTokens) &&
      isFiniteNonNegative(m.outputTokens) &&
      isFiniteNonNegative(m.cacheRead) &&
      isFiniteNonNegative(m.cacheCreation) &&
      (m.costUSD === null || isFiniteNonNegative(m.costUSD)),
  );
}

function isZeroUsage(result: RunUsageResult): boolean {
  return (
    (result.totalCost ?? 0) === 0 &&
    result.models.every(
      (m) =>
        m.inputTokens === 0 &&
        m.outputTokens === 0 &&
        m.cacheRead === 0 &&
        m.cacheCreation === 0 &&
        (m.costUSD ?? 0) === 0,
    )
  );
}

function isSameUsage(a: RunUsageResult, b: RunUsageResult): boolean {
  if (a.totalCost !== b.totalCost || a.models.length !== b.models.length) {
    return false;
  }
  const byModel = new Map(a.models.map((m) => [m.model, m]));
  return b.models.every((m) => {
    const prev = byModel.get(m.model);
    return (
      prev !== undefined &&
      prev.inputTokens === m.inputTokens &&
      prev.outputTokens === m.outputTokens &&
      prev.cacheRead === m.cacheRead &&
      prev.cacheCreation === m.cacheCreation &&
      prev.costUSD === m.costUSD
    );
  });
}

/**
 * `next` continues `prev`'s running total: every model `prev` reported is
 * still present and no counter (nor a known cost) went down. Models new in
 * `next` are allowed.
 */
function isGrown(prev: RunUsageResult, next: RunUsageResult): boolean {
  if (
    prev.totalCost !== null &&
    next.totalCost !== null &&
    next.totalCost < prev.totalCost
  ) {
    return false;
  }
  const byModel = new Map(next.models.map((m) => [m.model, m]));
  return prev.models.every((m) => {
    const grown = byModel.get(m.model);
    return (
      grown !== undefined &&
      grown.inputTokens >= m.inputTokens &&
      grown.outputTokens >= m.outputTokens &&
      grown.cacheRead >= m.cacheRead &&
      grown.cacheCreation >= m.cacheCreation &&
      (m.costUSD === null ||
        grown.costUSD === null ||
        grown.costUSD >= m.costUSD)
    );
  });
}
