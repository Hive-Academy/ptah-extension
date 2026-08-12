/**
 * SkillBudgetStore — the daily token/cost ledger behind the drain's budget gate.
 *
 * One row per UTC day. The day key is derived from `Date#toISOString`, which is
 * UTC by definition, so the cap rolls over at 00:00 UTC regardless of the host
 * timezone. A local-date key would give a user in UTC+13 a fresh budget at
 * 11:00 UTC and a user in UTC-8 one at 08:00 UTC — the same nightly cron tier
 * would then see two different budgets on two machines draining one shared
 * `~/.ptah/state/ptah.sqlite`.
 *
 * `record` accumulates with the same INSERT-then-guarded-UPDATE shape the queue
 * store uses, rather than an UPSERT: the first write of a day inserts, every
 * later write adds onto the existing counters.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  isUniqueConstraintError,
  PERSISTENCE_TOKENS,
  type SqliteConnectionService,
  type SqliteDatabase,
} from '@ptah-extension/persistence-sqlite';

/** What one stage consumed. Every field is optional; absent means zero. */
export interface SkillBudgetUsage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

/** One day's accumulated spend. */
export interface SkillBudgetDay {
  /** `YYYY-MM-DD`, UTC. */
  dayKey: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  updatedAt: number;
}

interface RawBudgetRow {
  day_key: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  updated_at: number;
}

/** `YYYY-MM-DD` in UTC — the primary key of `skill_synthesis_budget`. */
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
   * Tokens consumed so far today — the number the drain compares against
   * `skillSynthesis.budget.maxTokensPerDay`. Input and output are summed
   * because the cap is a single figure; cost is tracked separately for
   * reporting and is not the gate.
   */
  spentToday(now: number = Date.now()): number {
    const day = this.usageForDay(utcDayKey(now));
    return day.inputTokens + day.outputTokens;
  }

  /** Today's full ledger row, zero-filled when nothing has been spent yet. */
  todayUsage(now: number = Date.now()): SkillBudgetDay {
    return this.usageForDay(utcDayKey(now));
  }

  usageForDay(dayKey: string): SkillBudgetDay {
    const raw = this.db
      .prepare(`SELECT * FROM skill_synthesis_budget WHERE day_key = ?`)
      .get(dayKey) as RawBudgetRow | undefined;
    if (!raw) {
      return {
        dayKey,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        updatedAt: 0,
      };
    }
    return {
      dayKey: raw.day_key,
      inputTokens: raw.input_tokens,
      outputTokens: raw.output_tokens,
      costUsd: raw.cost_usd,
      updatedAt: raw.updated_at,
    };
  }

  /** Add one stage's consumption onto today's row, creating it if needed. */
  record(usage: SkillBudgetUsage, now: number = Date.now()): void {
    const dayKey = utcDayKey(now);
    const inputTokens = usage.inputTokens ?? 0;
    const outputTokens = usage.outputTokens ?? 0;
    const costUsd = usage.costUsd ?? 0;
    let inserted = true;
    try {
      this.db
        .prepare(
          `INSERT INTO skill_synthesis_budget
             (day_key, input_tokens, output_tokens, cost_usd, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(dayKey, inputTokens, outputTokens, costUsd, now);
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
            WHERE day_key = ?`,
        )
        .run(inputTokens, outputTokens, costUsd, now, dayKey);
    }
    this.logger.debug('[skill-synthesis] budget recorded', {
      dayKey,
      inputTokens,
      outputTokens,
      costUsd,
    });
  }
}
