/**
 * SessionVerdictStore — CRUD over `skill_session_verdicts` (migration `0034`).
 *
 * ONE VERDICT PER SESSION, and the table says so: `session_id` is the PRIMARY
 * KEY. Re-analysis of a grown session REPLACES the verdict rather than appending
 * a second one, so `save` is an UPDATE-then-INSERT inside `BEGIN IMMEDIATE` —
 * the same idiom `SkillQueueStore.markWorkspaceDrained` uses, and deliberately
 * NOT `INSERT OR REPLACE` / UPSERT. `INSERT OR REPLACE` deletes and re-inserts,
 * which would silently reset `created_at`; and the queue rule against UPSERT
 * (`run.store.ts:6-9`) exists because a swallowed collision hands the caller a
 * row it has no right to act on. Neither is worth the one saved statement.
 *
 * THE WRITE IS ONE FIXED STATEMENT NAMING EVERY COLUMN — never a dynamic
 * fragment. Same reasoning as `recordJudgeVerdict`: a partial write leaves the
 * previous pass's friction map sitting beside a new intent, which is a quietly
 * wrong verdict rather than a loud failure. A re-analysis states the WHOLE
 * verdict or it does not write.
 *
 * `recordDegraded` is a named method, not a `save` with a lot of nulls, because
 * the graceful-degradation row is a contract this phase must not get wrong:
 * "analyzed, no verdict, here is why". It exists so the drain does not
 * re-attempt indefinitely and so the UI can explain itself. Three states,
 * all distinct and all queryable:
 *
 *   `findBySession` → null            ⇒ never analyzed
 *   row, `degradedReason !== null`    ⇒ analyzed, no verdict, reason given
 *   row, `degradedReason === null`    ⇒ a real verdict
 *
 * Phase 3 falls back to `ExtractedTrajectory.canonicalText` on either of the
 * first two; phase 4 counts them as `unknown`. Both branches read
 * `degradedReason`, which is why `listDegraded` exists and why `0034` carries a
 * partial index for it.
 *
 * VALIDATION LIVES HERE BECAUSE THIS IS THE ONLY GATE. `evidenceClass` is
 * checked against the union before the database's `CHECK` can throw a less
 * legible error; `turnIndex` and `citations` must be non-negative integers,
 * because a fractional or negative index cites nothing and the whole point of
 * the friction map is that it is auditable. Do not add a second validation layer
 * above this store.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PERSISTENCE_TOKENS,
  type SqliteConnectionService,
  type SqliteDatabase,
} from '@ptah-extension/persistence-sqlite';
import {
  isEvidenceClass,
  type EvidenceClass,
  type FrictionEntry,
  type RoutineDraft,
  type SessionVerdict,
  type SessionVerdictInput,
} from './session-verdict.types';

interface RawVerdictRow {
  session_id: string;
  workspace_root: string;
  intent: string | null;
  outcome: string | null;
  evidence_class: string | null;
  friction_map: string;
  routine: string | null;
  turn_count: number;
  lane: string | null;
  model: string | null;
  passes: number;
  degraded_reason: string | null;
  created_at: number;
  updated_at: number;
}

/** Every column but `session_id` and `created_at` — a re-analysis restates all of them. */
const UPDATE_SQL = `UPDATE skill_session_verdicts
      SET workspace_root = ?, intent = ?, outcome = ?, evidence_class = ?,
          friction_map = ?, routine = ?, turn_count = ?, lane = ?, model = ?,
          passes = ?, degraded_reason = ?, updated_at = ?
    WHERE session_id = ?`;

const INSERT_SQL = `INSERT INTO skill_session_verdicts (
         session_id, workspace_root, intent, outcome, evidence_class,
         friction_map, routine, turn_count, lane, model, passes,
         degraded_reason, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

@injectable()
export class SessionVerdictStore {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
  ) {}

  private get db(): SqliteDatabase {
    return this.connection.db;
  }

  /**
   * Write the verdict for `input.sessionId`, replacing any previous one.
   * Returns the persisted row so the caller reads back exactly what landed.
   *
   * `createdAt` is preserved across a re-analysis: the session was first
   * analyzed when it was first analyzed, and the workspace feed orders on it.
   */
  save(input: SessionVerdictInput, now: number = Date.now()): SessionVerdict {
    const evidenceClass = this.assertEvidenceClass(input.evidenceClass ?? null);
    const frictionMap = this.assertFrictionMap(input.frictionMap ?? []);
    const routine = this.assertRoutine(input.routine ?? null);

    return this.inImmediateTransaction<SessionVerdict>(() => {
      const params = [
        input.workspaceRoot ?? '',
        input.intent ?? null,
        input.outcome ?? null,
        evidenceClass,
        JSON.stringify(frictionMap),
        routine === null ? null : JSON.stringify(routine),
        input.turnCount ?? 0,
        input.lane ?? null,
        input.model ?? null,
        input.passes ?? 0,
        this.normalizeReason(input.degradedReason),
      ];

      const changes = Number(
        this.db.prepare(UPDATE_SQL).run(...params, now, input.sessionId)
          .changes,
      );
      if (changes === 0) {
        this.db.prepare(INSERT_SQL).run(input.sessionId, ...params, now, now);
      }

      const row = this.findBySession(input.sessionId);
      if (!row) {
        // Unreachable through the two statements above; a null here would mean
        // the row vanished inside our own transaction.
        throw new Error(
          `[skill-synthesis] session verdict disappeared after write: ${input.sessionId}`,
        );
      }
      return row;
    });
  }

  /**
   * Record that the session was analyzed and no verdict could be produced.
   *
   * This RESOLVES; it does not throw and it does not schedule a retry. That is
   * the whole contract: a host with no query path (CLI, e2e) must leave a row
   * behind, or the drain re-attempts the same session forever and the UI has
   * nothing to explain the silence with.
   *
   * Every verdict field is written NULL, including any left over from an earlier
   * successful analysis — a degraded re-analysis must not leave a stale intent
   * standing beside a fresh degradation reason.
   */
  recordDegraded(
    sessionId: string,
    reason: string,
    meta: Pick<
      SessionVerdictInput,
      'workspaceRoot' | 'turnCount' | 'lane' | 'model' | 'passes'
    > = {},
    now: number = Date.now(),
  ): SessionVerdict {
    const normalized = this.normalizeReason(reason);
    if (normalized === null) {
      // A degraded row whose reason is blank is worse than no row: it says
      // "analyzed, no verdict" and refuses to say why.
      throw new Error(
        '[skill-synthesis] recordDegraded requires a non-empty reason',
      );
    }
    return this.save(
      {
        sessionId,
        workspaceRoot: meta.workspaceRoot,
        intent: null,
        outcome: null,
        evidenceClass: null,
        frictionMap: [],
        routine: null,
        turnCount: meta.turnCount,
        lane: meta.lane,
        model: meta.model,
        passes: meta.passes,
        degradedReason: normalized,
      },
      now,
    );
  }

  /** `null` means NEVER ANALYZED — not "analyzed without a verdict". */
  findBySession(sessionId: string): SessionVerdict | null {
    const raw = this.db
      .prepare('SELECT * FROM skill_session_verdicts WHERE session_id = ?')
      .get(sessionId) as RawVerdictRow | undefined;
    return raw ? this.toRow(raw) : null;
  }

  /**
   * `true` when a usable verdict exists — a row that is present AND not
   * degraded. Phase 3's "prefer the verdict, else fall back to
   * `ExtractedTrajectory.canonicalText`" branch is exactly this predicate, so it
   * lives here once instead of being re-derived at each call site.
   */
  hasUsableVerdict(sessionId: string): boolean {
    const row = this.findBySession(sessionId);
    return row !== null && row.degradedReason === null;
  }

  /** The workspace feed, newest first. Served by `idx_ssv_ws`. */
  listByWorkspace(workspaceRoot: string, limit: number): SessionVerdict[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM skill_session_verdicts
          WHERE workspace_root = ?
          ORDER BY created_at DESC LIMIT ?`,
      )
      .all(workspaceRoot, limit) as RawVerdictRow[];
    return rows.map((r) => this.toRow(r));
  }

  /**
   * The degraded rows, newest first — "why is there no verdict for these?".
   * Served by `0034`'s PARTIAL `idx_ssv_degraded`, which is why this can stay a
   * cheap query even once the table is large.
   */
  listDegraded(limit: number): SessionVerdict[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM skill_session_verdicts
          WHERE degraded_reason IS NOT NULL
          ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(limit) as RawVerdictRow[];
    return rows.map((r) => this.toRow(r));
  }

  /**
   * `BEGIN IMMEDIATE` … `COMMIT` around `fn`, rolling back if it throws.
   *
   * IMMEDIATE because `save` reads-then-writes across two statements: a deferred
   * transaction takes its write lock late and two hosts analyzing the same
   * session could both see "no row" and both INSERT.
   */
  private inImmediateTransaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error: unknown) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private assertEvidenceClass(value: EvidenceClass | null): string | null {
    if (value === null) return null;
    if (!isEvidenceClass(value)) {
      // The database would reject this too, via `0034`'s CHECK — throwing here
      // just names the offending value instead of surfacing a constraint error.
      throw new Error(
        `[skill-synthesis] unknown evidence class: ${String(value)}`,
      );
    }
    return value;
  }

  private assertFrictionMap(entries: FrictionEntry[]): FrictionEntry[] {
    for (const entry of entries) {
      this.assertTurnIndex(entry.turnIndex, 'friction turnIndex');
    }
    return entries;
  }

  private assertRoutine(routine: RoutineDraft | null): RoutineDraft | null {
    if (routine === null) return null;
    if (routine.citations.length === 0) {
      // A routine nobody can trace back to a turn is a claim, not evidence.
      throw new Error(
        '[skill-synthesis] a routine must cite at least one turn index',
      );
    }
    for (const citation of routine.citations) {
      this.assertTurnIndex(citation, 'routine citation');
    }
    return routine;
  }

  private assertTurnIndex(value: number, label: string): void {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(
        `[skill-synthesis] ${label} must be a non-negative integer, got ${String(value)}`,
      );
    }
  }

  /** `undefined`, `null` and whitespace all mean "not degraded". */
  private normalizeReason(reason: string | null | undefined): string | null {
    const trimmed = (reason ?? '').trim();
    return trimmed === '' ? null : trimmed;
  }

  private toRow(raw: RawVerdictRow): SessionVerdict {
    return {
      sessionId: raw.session_id,
      workspaceRoot: raw.workspace_root,
      intent: raw.intent,
      outcome: raw.outcome,
      evidenceClass: this.toEvidenceClass(raw.evidence_class, raw.session_id),
      frictionMap: this.parseFrictionMap(raw.friction_map, raw.session_id),
      routine: this.parseRoutine(raw.routine, raw.session_id),
      turnCount: raw.turn_count,
      lane: raw.lane,
      model: raw.model,
      passes: raw.passes,
      degradedReason: raw.degraded_reason,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
    };
  }

  /**
   * An unrecognized stored value becomes `null` with a warn rather than being
   * cast into the union — `0034`'s CHECK means this can only happen if someone
   * wrote to the table outside this store, and lying to the type is worse than
   * losing one field.
   */
  private toEvidenceClass(
    value: string | null,
    sessionId: string,
  ): EvidenceClass | null {
    if (value === null || value === '') return null;
    if (isEvidenceClass(value)) return value;
    this.logger.warn('[skill-synthesis] unrecognized evidence class', {
      sessionId,
      value,
    });
    return null;
  }

  private parseFrictionMap(json: string, sessionId: string): FrictionEntry[] {
    try {
      const parsed = JSON.parse(json) as unknown;
      if (Array.isArray(parsed)) return parsed as FrictionEntry[];
    } catch {
      // Falls through to the warn below.
    }
    this.logger.warn('[skill-synthesis] unparseable friction map', {
      sessionId,
    });
    return [];
  }

  private parseRoutine(
    json: string | null,
    sessionId: string,
  ): RoutineDraft | null {
    if (json === null) return null;
    try {
      const parsed = JSON.parse(json) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as RoutineDraft;
      }
    } catch {
      // Falls through to the warn below.
    }
    this.logger.warn('[skill-synthesis] unparseable routine', { sessionId });
    return null;
  }
}
