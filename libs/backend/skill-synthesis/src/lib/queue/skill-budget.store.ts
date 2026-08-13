/**
 * SkillBudgetStore — the daily token/cost ledger behind the drain's budget gate,
 * split by the queue stage that spent it (migration `0035`).
 *
 * One row per `(UTC day, stage)`. The day key is derived from
 * `Date#toISOString`, which is UTC by definition, so the cap rolls over at 00:00
 * UTC regardless of the host timezone. A local-date key would give a user in
 * UTC+13 a fresh budget at 11:00 UTC and a user in UTC-8 one at 08:00 UTC — the
 * same nightly cron tier would then see two different budgets on two machines
 * draining one shared `~/.ptah/state/ptah.sqlite`.
 *
 * `record` accumulates with the same INSERT-then-guarded-UPDATE shape the queue
 * store uses, rather than an UPSERT: the first write of a `(day, stage)` pair
 * inserts, every later write adds onto the existing counters.
 *
 * ## `spentToday()` IS STILL THE DAY TOTAL, AND THAT IS A CONTRACT
 *
 * B0.4's budget gate (`SkillDrainService.isBudgetExhausted` /
 * `shouldOrderCheapFirst`) compares `spentToday()` against
 * `skillSynthesis.budget.maxTokensPerDay`. Splitting the ledger by stage must
 * not move the point at which that gate trips, so `spentToday` sums input AND
 * output across EVERY stage of the day — exactly the number the single-row
 * ledger returned. The per-stage split is an additional read
 * ({@link SkillBudgetStore.stageUsageForDay}), never a narrowing of the old one.
 *
 * ## HOW A SPEND LEARNS ITS STAGE
 *
 * The ledger write happens in `LaneRunnerService.recordUsage`, several frames
 * below the drain, and a lane id (`archaeologist|synthesis|judge|replay`) is a
 * DIFFERENT taxonomy from the eleven queue stages — mapping one onto the other
 * would be quietly wrong. Threading a `stage` parameter down through the judge,
 * the synthesizer, the curator and the namer would widen five public service
 * signatures for a field none of them has any use for.
 *
 * So the drain — the one place that knows the stage — opens an attribution
 * scope around the stage handler it dispatches ({@link withStage}), and a
 * `record` that is not given an explicit stage adopts it. The carrier is
 * `AsyncLocalStorage`, not a mutable field, because two cron tiers can be
 * mid-`await` at the same time and a field would cross-attribute their spend;
 * an async-context store follows each drain's own await chain and cannot.
 *
 * A `record` outside any scope — the foreground promotion gate's judge call —
 * lands on the `''` stage. `''` is a real member meaning "spend no queue stage
 * owned", not a placeholder: it keeps the per-stage rows summing to the day
 * total the gate reads, so the Activity strip can never show less than what the
 * cap is counting.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  isUniqueConstraintError,
  PERSISTENCE_TOKENS,
  type SqliteConnectionService,
  type SqliteDatabase,
} from '@ptah-extension/persistence-sqlite';
import { SKILL_QUEUE_STAGES, type SkillQueueStage } from './skill-queue.types';

/**
 * A queue stage, or `''` for spend that no queue stage owned.
 *
 * Migration `0035` deliberately puts NO `CHECK` on the column (widening one
 * costs a rebuild of a live table), so this union is the only enforcement there
 * is and this store is the gate on both edges: `record` rejects a non-member,
 * and reads narrow an unrecognised stored value back to `''`.
 */
export type SkillBudgetStage = SkillQueueStage | '';

/** The unattributed bucket. Spend that happened outside a drain stage. */
export const UNATTRIBUTED_STAGE = '' as const;

const KNOWN_STAGES: ReadonlySet<string> = new Set<string>(SKILL_QUEUE_STAGES);

/**
 * The drain's stage, visible to a `record` several frames below it.
 *
 * Module-level rather than instance-level so the scope survives whichever
 * instance of the store the container hands out; `AsyncLocalStorage` rather
 * than a plain field so overlapping drain ticks cannot read each other's stage.
 */
const STAGE_ATTRIBUTION = new AsyncLocalStorage<SkillBudgetStage>();

/** What one stage consumed. Every field is optional; absent means zero. */
export interface SkillBudgetUsage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

/** Where and when a spend is booked. Both fields have defaults. */
export interface SkillBudgetRecordOptions {
  /**
   * The stage that spent it. Defaults to the drain's ambient attribution scope
   * ({@link SkillBudgetStore.withStage}), and to `''` outside one.
   */
  stage?: SkillBudgetStage;
  /** Test seam for a deterministic clock. */
  now?: number;
}

/** One day's accumulated spend, summed across every stage. */
export interface SkillBudgetDay {
  /** `YYYY-MM-DD`, UTC. */
  dayKey: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  updatedAt: number;
}

/** One `(day, stage)` ledger row. */
export interface SkillBudgetStageDay extends SkillBudgetDay {
  stage: SkillBudgetStage;
  /** `inputTokens + outputTokens` — the figure the daily cap gates on. */
  totalTokens: number;
}

interface RawBudgetRow {
  stage: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  updated_at: number;
}

interface RawBudgetTotals {
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  updated_at: number | null;
}

/** `YYYY-MM-DD` in UTC — the leading half of `skill_synthesis_budget`'s key. */
export function utcDayKey(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

@injectable()
export class SkillBudgetStore {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
  ) {}

  private get db(): SqliteDatabase {
    return this.connection.db;
  }

  /**
   * Run `fn` with every unattributed {@link record} inside it booked to
   * `stage`. Returns whatever `fn` returns, including its promise — the scope
   * follows the await chain, so a stage handler that awaits an LLM call still
   * has its ledger write attributed when the call resolves.
   */
  withStage<T>(stage: SkillBudgetStage, fn: () => T): T {
    return STAGE_ATTRIBUTION.run(stage, fn);
  }

  /** The stage a `record` would be booked to right now. `''` outside a drain. */
  currentStage(): SkillBudgetStage {
    return STAGE_ATTRIBUTION.getStore() ?? UNATTRIBUTED_STAGE;
  }

  /**
   * Tokens consumed so far today, across EVERY stage — the number the drain
   * compares against `skillSynthesis.budget.maxTokensPerDay`. Input and output
   * are summed because the cap is a single figure; cost is tracked separately
   * for reporting and is not the gate.
   *
   * Migration `0035` split the ledger by stage. This stayed day-level on
   * purpose: it is B0.4's gate, and a narrower number would silently move the
   * point at which the drain stops spending.
   */
  spentToday(now: number = Date.now()): number {
    const day = this.usageForDay(utcDayKey(now));
    return day.inputTokens + day.outputTokens;
  }

  /** Today's full ledger row, zero-filled when nothing has been spent yet. */
  todayUsage(now: number = Date.now()): SkillBudgetDay {
    return this.usageForDay(utcDayKey(now));
  }

  /** One day's totals, summed across every stage. */
  usageForDay(dayKey: string): SkillBudgetDay {
    const raw = this.db
      .prepare(
        `SELECT SUM(input_tokens)  AS input_tokens,
                SUM(output_tokens) AS output_tokens,
                SUM(cost_usd)      AS cost_usd,
                MAX(updated_at)    AS updated_at
           FROM skill_synthesis_budget
          WHERE day_key = ?`,
      )
      .get(dayKey) as RawBudgetTotals | undefined;
    return {
      dayKey,
      inputTokens: raw?.input_tokens ?? 0,
      outputTokens: raw?.output_tokens ?? 0,
      costUsd: raw?.cost_usd ?? 0,
      updatedAt: raw?.updated_at ?? 0,
    };
  }

  /** Today's ledger, one entry per stage that spent anything. */
  todayStageUsage(now: number = Date.now()): readonly SkillBudgetStageDay[] {
    return this.stageUsageForDay(utcDayKey(now));
  }

  /**
   * One day's ledger, one entry per stage, heaviest first.
   *
   * A stored stage the current build does not recognise is folded into `''`
   * rather than surfaced or dropped: dropping it would make the per-stage
   * entries sum to less than {@link spentToday}, which is the one property that
   * lets the Activity strip be read against the daily cap.
   */
  stageUsageForDay(dayKey: string): readonly SkillBudgetStageDay[] {
    const raws = this.db
      .prepare(
        `SELECT stage, input_tokens, output_tokens, cost_usd, updated_at
           FROM skill_synthesis_budget
          WHERE day_key = ?`,
      )
      .all(dayKey) as RawBudgetRow[];

    const byStage = new Map<SkillBudgetStage, SkillBudgetStageDay>();
    for (const raw of raws) {
      const stage = this.narrowStage(raw.stage);
      const existing = byStage.get(stage);
      const merged: SkillBudgetStageDay = {
        dayKey,
        stage,
        inputTokens: (existing?.inputTokens ?? 0) + raw.input_tokens,
        outputTokens: (existing?.outputTokens ?? 0) + raw.output_tokens,
        costUsd: (existing?.costUsd ?? 0) + raw.cost_usd,
        updatedAt: Math.max(existing?.updatedAt ?? 0, raw.updated_at),
        totalTokens: 0,
      };
      byStage.set(stage, {
        ...merged,
        totalTokens: merged.inputTokens + merged.outputTokens,
      });
    }

    return Array.from(byStage.values()).sort(
      (a, b) => b.totalTokens - a.totalTokens || a.stage.localeCompare(b.stage),
    );
  }

  /**
   * Add one stage's consumption onto today's row for that stage, creating it if
   * needed. The stage defaults to the drain's ambient attribution scope.
   */
  record(usage: SkillBudgetUsage, opts: SkillBudgetRecordOptions = {}): void {
    const now = opts.now ?? Date.now();
    const stage = this.assertStage(opts.stage ?? this.currentStage());
    const dayKey = utcDayKey(now);
    const inputTokens = usage.inputTokens ?? 0;
    const outputTokens = usage.outputTokens ?? 0;
    const costUsd = usage.costUsd ?? 0;
    let inserted = true;
    try {
      this.db
        .prepare(
          `INSERT INTO skill_synthesis_budget
             (day_key, stage, input_tokens, output_tokens, cost_usd, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(dayKey, stage, inputTokens, outputTokens, costUsd, now);
    } catch (error: unknown) {
      if (!isUniqueConstraintError(error)) throw error;
      inserted = false;
    }
    if (!inserted) {
      this.db
        .prepare(
          `UPDATE skill_synthesis_budget
              SET input_tokens = input_tokens + ?,
                  output_tokens = output_tokens + ?,
                  cost_usd = cost_usd + ?,
                  updated_at = ?
            WHERE day_key = ? AND stage = ?`,
        )
        .run(inputTokens, outputTokens, costUsd, now, dayKey, stage);
    }
    this.logger.debug('[skill-synthesis] budget recorded', {
      dayKey,
      stage,
      inputTokens,
      outputTokens,
      costUsd,
    });
  }

  /**
   * The write edge of the union. A caller that invents a stage would put a key
   * in the ledger that no reader can name and that `0035`'s absent CHECK will
   * happily accept — so it is rejected here, where the mistake is one frame
   * from its cause.
   */
  private assertStage(stage: string): SkillBudgetStage {
    if (stage === UNATTRIBUTED_STAGE || KNOWN_STAGES.has(stage)) {
      return stage as SkillBudgetStage;
    }
    throw new Error(
      `[skill-synthesis] not a queue stage: ${JSON.stringify(stage)}`,
    );
  }

  /** The read edge. An unrecognised stored stage becomes unattributed spend. */
  private narrowStage(stage: string): SkillBudgetStage {
    if (stage === UNATTRIBUTED_STAGE || KNOWN_STAGES.has(stage)) {
      return stage as SkillBudgetStage;
    }
    this.logger.warn(
      '[skill-synthesis] budget row carries an unknown stage; counting it as unattributed',
      { stage },
    );
    return UNATTRIBUTED_STAGE;
  }
}
