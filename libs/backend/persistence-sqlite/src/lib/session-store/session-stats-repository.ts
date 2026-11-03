import { z } from 'zod';
import type { SqliteDatabase } from '../sqlite-connection.service';

const safeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const text = z.string().min(1);

export const sessionUsageContributionSchema = z.object({
  sessionId: text,
  producer: text,
  runId: text,
  turnId: text,
  eventKey: text,
  modelId: text,
  providerId: text,
  occurredAtMs: safeInteger,
  inputTokens: safeInteger,
  outputTokens: safeInteger,
  cacheReadTokens: safeInteger,
  cacheWriteTokens: safeInteger,
  knownCostMicroUsd: safeInteger.nullable(),
  costAuthority: z.enum(['provider-reported', 'model-priced', 'unpriced']),
  source: z.enum(['live', 'estimated']),
  pricingVersion: text.nullable(),
  revision: safeInteger,
  runCostSnapshot: z.boolean().optional(),
  workspaceKey: text.nullable().optional(),
  host: text.nullable().optional(),
});

export type SessionUsageContribution = z.infer<
  typeof sessionUsageContributionSchema
>;

const statsRowSchema = z.object({
  session_id: z.string(),
  host: z.string(),
  workspace_key: z.string().nullable(),
  provider_id: z.string(),
  started_at_ms: safeInteger,
  last_usage_at_ms: safeInteger,
  finalized_at_ms: safeInteger.nullable(),
  status: z.string(),
  input_tokens: safeInteger,
  output_tokens: safeInteger,
  cache_read_tokens: safeInteger,
  cache_write_tokens: safeInteger,
  known_cost_micro_usd: safeInteger.nullable(),
  has_unpriced: z.number().int().min(0).max(1),
  source: z.string(),
  pricing_version: z.string().nullable(),
  revision: safeInteger,
  updated_at_ms: safeInteger,
});
export type SessionStatsRow = z.infer<typeof statsRowSchema>;

const groupedRowSchema = z.object({
  day: z.string(),
  provider_id: z.string(),
  model_id: z.string(),
  source: z.string(),
  cost_authority: z.string(),
  input_tokens: safeInteger,
  output_tokens: safeInteger,
  cache_read_tokens: safeInteger,
  cache_write_tokens: safeInteger,
  known_cost_micro_usd: safeInteger.nullable(),
  has_unpriced: z.number().int().min(0).max(1),
  session_count: safeInteger,
});
export type SessionUsageGroup = z.infer<typeof groupedRowSchema>;

const topSessionSchema = z.object({
  session_id: z.string(),
  title: z.string(),
  provider_id: z.string(),
  model_id: z.string(),
  last_active_ms: safeInteger,
  message_count: safeInteger,
  known_cost_micro_usd: safeInteger.nullable(),
  has_unpriced: z.number().int().min(0).max(1),
  input_tokens: safeInteger,
  output_tokens: safeInteger,
  cache_read_tokens: safeInteger,
  cache_write_tokens: safeInteger,
});
export type TopUsageSession = z.infer<typeof topSessionSchema>;

const sessionModelRowSchema = z.object({
  model_id: z.string(),
  input_tokens: safeInteger,
  output_tokens: safeInteger,
  cache_read_tokens: safeInteger,
  cache_write_tokens: safeInteger,
  known_cost_micro_usd: safeInteger.nullable(),
  has_unpriced: z.number().int().min(0).max(1),
});
export type SessionModelUsageRow = z.infer<typeof sessionModelRowSchema>;

const coverageRowSchema = z.object({
  first_captured_at_ms: safeInteger,
  last_captured_at_ms: safeInteger,
});
export type SessionUsageCoverage = z.infer<typeof coverageRowSchema>;

/** One SQLite transaction per accepted contribution. Duplicate and older revisions are ignored. */
export class SessionStatsRepository {
  constructor(
    private readonly store: {
      ready(): Promise<Pick<SqliteDatabase, 'exec' | 'prepare'>>;
    },
  ) {}

  async recordUsage(value: SessionUsageContribution): Promise<void> {
    await this.recordEvent([value]);
  }

  async recordEvent(
    values: readonly SessionUsageContribution[],
  ): Promise<void> {
    if (values.length === 0) return;
    const inputs = values.map((value) =>
      sessionUsageContributionSchema.parse(value),
    );
    const first = inputs[0];
    if (!first || inputs.some((input) => input.sessionId !== first.sessionId || input.producer !== first.producer || input.eventKey !== first.eventKey || input.revision !== first.revision || input.runCostSnapshot !== first.runCostSnapshot)) {
      throw new Error('Usage event rows must share one identity and revision');
    }
    if (new Set(inputs.map((input) => input.modelId)).size !== inputs.length) {
      throw new Error('Usage event contains duplicate model rows');
    }
    const db = await this.store.ready();
    db.exec('BEGIN IMMEDIATE');
    try {
      const prior = db.prepare(`SELECT MAX(revision) AS revision,
        MAX(cost_authority = 'provider-reported') AS reported
        FROM session_usage_turns WHERE session_id = ? AND producer = ? AND event_key = ?`)
        .get(first.sessionId, first.producer, first.eventKey) as { revision: number | null; reported: number | null };
      if (prior.revision !== null && (first.revision < prior.revision ||
        (first.revision === prior.revision && (prior.reported === 1 || !inputs.some((input) => input.costAuthority === 'provider-reported'))))) {
        db.exec('COMMIT');
        return;
      }
      db.prepare('DELETE FROM session_usage_turns WHERE session_id = ? AND producer = ? AND event_key = ?')
        .run(first.sessionId, first.producer, first.eventKey);
      if (first.runCostSnapshot) {
        if (first.producer !== 'sdk-owner') throw new Error('Only SDK owner can reprice a run');
        db.prepare(`UPDATE session_usage_turns SET known_cost_micro_usd = 0,
          cost_authority = 'model-priced'
          WHERE session_id = ? AND producer = ? AND run_id = ?`)
          .run(first.sessionId, first.producer, first.runId);
      }
      const statement = db.prepare(`INSERT INTO session_usage_turns (
        session_id, producer, run_id, turn_id, model_id, event_key, occurred_at_ms,
        provider_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
        known_cost_micro_usd, cost_authority, source, pricing_version, revision,
        workspace_key, host
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const input of inputs) {
        statement.run(
          input.sessionId,
          input.producer,
          input.runId,
          input.turnId,
          input.modelId,
          input.eventKey,
          input.occurredAtMs,
          input.providerId,
          input.inputTokens,
          input.outputTokens,
          input.cacheReadTokens,
          input.cacheWriteTokens,
          input.knownCostMicroUsd,
          input.costAuthority,
          input.source,
          input.pricingVersion,
          input.revision,
          input.workspaceKey ?? null,
          input.host ?? null,
        );
      }
      db.prepare(
        `INSERT INTO session_stats (
        session_id, host, workspace_key, provider_id, started_at_ms, last_usage_at_ms,
        finalized_at_ms, status, input_tokens, output_tokens, cache_read_tokens,
        cache_write_tokens, known_cost_micro_usd, has_unpriced, source,
        pricing_version, revision, updated_at_ms)
      SELECT ?, COALESCE(s.host, MAX(t.host), 'unknown'), COALESCE(s.workspace_key, MAX(t.workspace_key)), ?,
        MIN(t.occurred_at_ms), MAX(t.occurred_at_ms), NULL, 'active',
        SUM(t.input_tokens), SUM(t.output_tokens), SUM(t.cache_read_tokens),
        SUM(t.cache_write_tokens), SUM(t.known_cost_micro_usd),
        MAX(t.known_cost_micro_usd IS NULL),
        CASE WHEN MAX(t.source = 'live') = 1 THEN 'live' ELSE 'estimated' END,
        MAX(t.pricing_version), MAX(t.revision), ?
      FROM session_usage_turns t LEFT JOIN sessions s ON s.session_id = t.session_id
      WHERE t.session_id = ?
      ON CONFLICT (session_id) DO UPDATE SET
        host = excluded.host, workspace_key = excluded.workspace_key,
        provider_id = excluded.provider_id, started_at_ms = excluded.started_at_ms,
        last_usage_at_ms = excluded.last_usage_at_ms, finalized_at_ms = NULL,
        status = 'active', input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens, cache_read_tokens = excluded.cache_read_tokens,
        cache_write_tokens = excluded.cache_write_tokens,
        known_cost_micro_usd = excluded.known_cost_micro_usd,
        has_unpriced = excluded.has_unpriced, source = excluded.source,
        pricing_version = excluded.pricing_version, revision = excluded.revision,
        updated_at_ms = excluded.updated_at_ms`,
      ).run(first.sessionId, first.providerId, Date.now(), first.sessionId);
      statsRowSchema.parse(
        db
          .prepare('SELECT * FROM session_stats WHERE session_id = ?')
          .get(first.sessionId),
      );
      const workspaceKey = db.prepare(`SELECT COALESCE(s.workspace_key, MAX(t.workspace_key)) AS workspace_key
        FROM session_usage_turns t LEFT JOIN sessions s ON s.session_id = t.session_id
        WHERE t.session_id = ?`).get(first.sessionId) as { workspace_key: string | null };
      if (workspaceKey.workspace_key !== null) {
        const capturedAtMs = Date.now();
        db.prepare(`INSERT INTO session_usage_coverage (workspace_key, first_captured_at_ms, last_captured_at_ms)
          VALUES (?, ?, ?) ON CONFLICT (workspace_key) DO UPDATE SET
          first_captured_at_ms = MIN(first_captured_at_ms, excluded.first_captured_at_ms),
          last_captured_at_ms = MAX(last_captured_at_ms, excluded.last_captured_at_ms)`)
          .run(workspaceKey.workspace_key, capturedAtMs, capturedAtMs);
      }
      db.exec('COMMIT');
    } catch (error: unknown) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  async getSessionStats(sessionId: string, workspaceKey: string): Promise<SessionStatsRow | null> {
    const db = await this.store.ready();
    const row: unknown = db
      .prepare(`SELECT st.* FROM session_stats st
        LEFT JOIN sessions s ON s.session_id = st.session_id
        WHERE st.session_id = ? AND COALESCE(s.workspace_key, st.workspace_key) = ?`)
      .get(text.parse(sessionId), text.parse(workspaceKey));
    return row === undefined ? null : statsRowSchema.parse(row);
  }

  /** Used only to prevent a foreign ledger identity from falling through to legacy JSONL reads. */
  async hasSessionStats(sessionId: string): Promise<boolean> {
    const db = await this.store.ready();
    const row: unknown = db.prepare('SELECT 1 AS present FROM session_stats WHERE session_id = ?')
      .get(text.parse(sessionId));
    return row !== undefined;
  }

  /** Match Codex's native thread identity, which differs from the Ptah session id. */
  async hasWorkspaceCodexRun(workspaceKey: string, nativeThreadId: string, fromMs: number, untilMs: number): Promise<boolean> {
    const from = safeInteger.parse(fromMs);
    const until = safeInteger.parse(untilMs);
    if (until <= from) throw new Error('Usage range must be increasing');
    const db = await this.store.ready();
    const row: unknown = db.prepare(`SELECT 1 AS present FROM session_usage_turns t
      LEFT JOIN sessions s ON s.session_id = t.session_id
      WHERE COALESCE(s.workspace_key, t.workspace_key) = ?
        AND ((t.producer = 'codex-checkpoint' AND t.run_id = ?)
          OR (t.producer = 'cli-lane' AND t.provider_id IN ('codex', 'openai-codex') AND t.session_id = ?))
        AND t.occurred_at_ms >= ? AND t.occurred_at_ms < ? LIMIT 1`)
      .get(text.parse(workspaceKey), text.parse(nativeThreadId), text.parse(nativeThreadId), from, until);
    return row !== undefined;
  }

  async getSessionModelUsage(
    sessionId: string,
    workspaceKey: string,
    fromMs: number,
    untilMs: number,
  ): Promise<SessionModelUsageRow[]> {
    const id = text.parse(sessionId);
    const from = safeInteger.parse(fromMs);
    const until = safeInteger.parse(untilMs);
    if (until < from) throw new Error('Usage range must be increasing');
    const db = await this.store.ready();
    const rows: unknown[] = db.prepare(`SELECT model_id,
      SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
      SUM(cache_read_tokens) AS cache_read_tokens,
      SUM(cache_write_tokens) AS cache_write_tokens,
      SUM(known_cost_micro_usd) AS known_cost_micro_usd,
      MAX(known_cost_micro_usd IS NULL) AS has_unpriced
      FROM session_usage_turns t LEFT JOIN sessions s ON s.session_id = t.session_id
      WHERE t.session_id = ? AND COALESCE(s.workspace_key, t.workspace_key) = ? AND t.occurred_at_ms >= ? AND t.occurred_at_ms < ?
      GROUP BY t.model_id ORDER BY t.model_id`).all(id, text.parse(workspaceKey), from, until);
    return rows.map((row) => sessionModelRowSchema.parse(row));
  }

  async getSessionUsageEventCount(sessionId: string, workspaceKey: string, fromMs: number, untilMs: number): Promise<number> {
    const id = text.parse(sessionId);
    const from = safeInteger.parse(fromMs);
    const until = safeInteger.parse(untilMs);
    if (until < from) throw new Error('Usage range must be increasing');
    const db = await this.store.ready();
    const row: unknown = db.prepare(`SELECT COUNT(DISTINCT producer || ':' || event_key) AS event_count
      FROM session_usage_turns t LEFT JOIN sessions s ON s.session_id = t.session_id
      WHERE t.session_id = ? AND COALESCE(s.workspace_key, t.workspace_key) = ? AND t.occurred_at_ms >= ? AND t.occurred_at_ms < ?`).get(id, text.parse(workspaceKey), from, until);
    return z.object({ event_count: safeInteger }).parse(row).event_count;
  }

  async getWorkspaceUsageGroups(
    workspaceKey: string,
    fromMs: number,
    untilMs: number,
  ): Promise<SessionUsageGroup[]> {
    const scope = text.parse(workspaceKey);
    const from = safeInteger.parse(fromMs);
    const until = safeInteger.parse(untilMs);
    if (until <= from) throw new Error('Usage range must be increasing');
    const db = await this.store.ready();
    const rows: unknown[] = db
      .prepare(
        `SELECT
      strftime('%Y-%m-%d', t.occurred_at_ms / 1000, 'unixepoch') AS day,
      t.provider_id, t.model_id, t.source, t.cost_authority,
      SUM(t.input_tokens) AS input_tokens, SUM(t.output_tokens) AS output_tokens,
      SUM(t.cache_read_tokens) AS cache_read_tokens,
      SUM(t.cache_write_tokens) AS cache_write_tokens,
      SUM(t.known_cost_micro_usd) AS known_cost_micro_usd,
      MAX(t.known_cost_micro_usd IS NULL) AS has_unpriced,
      COUNT(DISTINCT t.session_id) AS session_count
      FROM session_usage_turns t LEFT JOIN sessions s ON s.session_id = t.session_id
      WHERE COALESCE(s.workspace_key, t.workspace_key) = ? AND t.occurred_at_ms >= ? AND t.occurred_at_ms < ?
      GROUP BY day, t.provider_id, t.model_id, t.source, t.cost_authority
      ORDER BY day, t.provider_id, t.model_id, t.source, t.cost_authority
      LIMIT 100001`,
      )
      .all(scope, from, until);
    return rows.map((row) => groupedRowSchema.parse(row));
  }

  /** Live capture alone cannot prove complete historical coverage. */
  async getWorkspaceCoverage(workspaceKey: string): Promise<SessionUsageCoverage | null> {
    const db = await this.store.ready();
    const row: unknown = db.prepare(`SELECT first_captured_at_ms, last_captured_at_ms
      FROM session_usage_coverage WHERE workspace_key = ?`).get(text.parse(workspaceKey));
    return row === undefined ? null : coverageRowSchema.parse(row);
  }

  async getWorkspaceTopSessions(
    workspaceKey: string,
    fromMs: number,
    untilMs: number,
  ): Promise<TopUsageSession[]> {
    const scope = text.parse(workspaceKey);
    const from = safeInteger.parse(fromMs);
    const until = safeInteger.parse(untilMs);
    if (until <= from) throw new Error('Usage range must be increasing');
    const db = await this.store.ready();
    const rows: unknown[] = db
      .prepare(
        `WITH eligible AS (
          SELECT t.*, COALESCE(s.name, t.session_id) AS name FROM session_usage_turns t
          LEFT JOIN sessions s ON s.session_id = t.session_id
          WHERE COALESCE(s.workspace_key, t.workspace_key) = ? AND t.occurred_at_ms >= ? AND t.occurred_at_ms < ?
        ), totals AS (
          SELECT session_id, MAX(name) AS title,
            MAX(occurred_at_ms) AS last_active_ms,
            COUNT(DISTINCT producer || ':' || event_key) AS message_count,
            SUM(known_cost_micro_usd) AS known_cost_micro_usd,
            MAX(known_cost_micro_usd IS NULL) AS has_unpriced,
            SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
            SUM(cache_read_tokens) AS cache_read_tokens,
            SUM(cache_write_tokens) AS cache_write_tokens
          FROM eligible GROUP BY session_id
        ), model_totals AS (
          SELECT session_id, provider_id, model_id,
            SUM(COALESCE(known_cost_micro_usd, 0)) AS known_cost,
            SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens) AS tokens
          FROM eligible GROUP BY session_id, provider_id, model_id
        ), ranked_models AS (
          SELECT session_id, provider_id, model_id,
            ROW_NUMBER() OVER (PARTITION BY session_id
              ORDER BY known_cost DESC, tokens DESC, model_id) AS rank
          FROM model_totals
        )
        SELECT totals.*, ranked_models.provider_id, ranked_models.model_id
        FROM totals JOIN ranked_models ON ranked_models.session_id = totals.session_id
          AND ranked_models.rank = 1
        ORDER BY totals.has_unpriced, totals.known_cost_micro_usd DESC,
          totals.input_tokens + totals.output_tokens + totals.cache_read_tokens + totals.cache_write_tokens DESC,
          totals.session_id
        LIMIT 5`,
      )
      .all(scope, from, until);
    return rows.map((row) => topSessionSchema.parse(row));
  }

  async getWorkspaceSessionCount(
    workspaceKey: string,
    fromMs: number,
    untilMs: number,
  ): Promise<number> {
    const scope = text.parse(workspaceKey);
    const from = safeInteger.parse(fromMs);
    const until = safeInteger.parse(untilMs);
    if (until <= from) throw new Error('Usage range must be increasing');
    const db = await this.store.ready();
    const row: unknown = db.prepare(`SELECT COUNT(DISTINCT t.session_id) AS session_count
      FROM session_usage_turns t LEFT JOIN sessions s ON s.session_id = t.session_id
      WHERE COALESCE(s.workspace_key, t.workspace_key) = ? AND t.occurred_at_ms >= ? AND t.occurred_at_ms < ?`).get(scope, from, until);
    return z.object({ session_count: safeInteger }).parse(row).session_count;
  }

  async getWorkspaceMessageCount(
    workspaceKey: string,
    fromMs: number,
    untilMs: number,
  ): Promise<number> {
    const scope = text.parse(workspaceKey);
    const from = safeInteger.parse(fromMs);
    const until = safeInteger.parse(untilMs);
    if (until <= from) throw new Error('Usage range must be increasing');
    const db = await this.store.ready();
    const row: unknown = db.prepare(`SELECT COUNT(DISTINCT t.session_id || ':' || t.producer || ':' || t.event_key) AS message_count
      FROM session_usage_turns t LEFT JOIN sessions s ON s.session_id = t.session_id
      WHERE COALESCE(s.workspace_key, t.workspace_key) = ? AND t.occurred_at_ms >= ? AND t.occurred_at_ms < ?`).get(scope, from, until);
    return z.object({ message_count: safeInteger }).parse(row).message_count;
  }
}
