/**
 * SkillSuggestionStore — SQLite persistence layer for skill_suggestions.
 *
 * A suggestion is a cluster-level artifact: it is synthesized from a cluster
 * of similar candidate trajectories and surfaced to the Skills tab for human
 * approval. Accepting materializes a promoted skill; dismissing keeps the row
 * so the same cluster is not re-proposed. The store is intentionally dumb —
 * acceptance side effects (SKILL.md materialization, registry linkage) live in
 * the coordinator that drives it.
 *
 * Lineage (`0051`): a row may record the umbrella that absorbed it
 * (`merged_into`), the candidate its acceptance promoted
 * (`promoted_candidate_id`) and its reference documents (`references_json`).
 *
 * NO METHOD OPENS A TRANSACTION. Every write is a single plain prepared
 * statement, so callers may run them inside `inImmediateTransaction` and they
 * join that unit of work.
 */
import { inject, injectable } from 'tsyringe';
import { ulid } from 'ulid';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PERSISTENCE_TOKENS,
  type SqliteConnectionService,
  type SqliteDatabase,
} from '@ptah-extension/persistence-sqlite';
import type {
  NewSuggestionInput,
  SkillReference,
  SkillSuggestionRow,
  SkillSuggestionStatus,
} from './types';

interface RawSuggestionRow {
  id: string;
  name: string;
  description: string;
  body: string;
  member_session_ids: string;
  member_candidate_ids: string;
  cluster_size: number;
  technology_fingerprint: string;
  judge_score: number;
  status: SkillSuggestionStatus;
  created_at: number;
  decided_at: number | null;
  merged_into: string | null;
  promoted_candidate_id: string | null;
  references_json: string | null;
}

/** Statuses a new row may be written with. */
export type NewSuggestionStatus = Extract<
  SkillSuggestionStatus,
  'pending' | 'dismissed'
>;

@injectable()
export class SkillSuggestionStore {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
  ) {}

  private get db(): SqliteDatabase {
    return this.connection.db;
  }

  /**
   * Insert a suggestion as `pending`, or as `dismissed` (a judge-rejected
   * umbrella, kept so it is not re-proposed). A dismissed row is written with
   * `decided_at = now`.
   */
  insert(
    input: NewSuggestionInput,
    status: NewSuggestionStatus,
  ): SkillSuggestionRow {
    const id = ulid();
    const createdAt = Date.now();
    const decidedAt = status === 'dismissed' ? createdAt : null;
    const referencesJson =
      input.references && input.references.length > 0
        ? JSON.stringify(
            input.references.map((r) => ({ name: r.name, body: r.body })),
          )
        : null;
    this.db
      .prepare(
        `INSERT INTO skill_suggestions (
           id, name, description, body,
           member_session_ids, member_candidate_ids,
           cluster_size, technology_fingerprint, judge_score,
           status, created_at, decided_at,
           merged_into, promoted_candidate_id, references_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
      )
      .run(
        id,
        input.name,
        input.description,
        input.body,
        JSON.stringify(input.memberSessionIds),
        JSON.stringify(input.memberCandidateIds),
        input.clusterSize,
        input.technologyFingerprint,
        input.judgeScore,
        status,
        createdAt,
        decidedAt,
        referencesJson,
      );
    const row = this.findById(id);
    if (!row) {
      throw new Error(
        `[skill-synthesis] insert suggestion: row ${id} could not be re-read`,
      );
    }
    return row;
  }

  findById(id: string): SkillSuggestionRow | null {
    const raw = this.db
      .prepare(`SELECT * FROM skill_suggestions WHERE id = ?`)
      .get(id) as RawSuggestionRow | undefined;
    return raw ? this.toRow(raw) : null;
  }

  listByStatus(status: SkillSuggestionStatus): SkillSuggestionRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM skill_suggestions
         WHERE status = ?
         ORDER BY created_at DESC`,
      )
      .all(status) as RawSuggestionRow[];
    return rows.map((r) => this.toRow(r));
  }

  /**
   * Edit the human-facing fields of a still-pending suggestion before it is
   * accepted. Only `name`, `description`, and `body` are editable, and only
   * while the suggestion is `pending` (an accepted/dismissed row is immutable).
   * Returns the updated row, or the unchanged row when no fields were supplied.
   */
  updatePending(
    id: string,
    fields: { name?: string; description?: string; body?: string },
  ): SkillSuggestionRow | null {
    const current = this.findById(id);
    if (!current) {
      this.logger.warn('[skill-synthesis] updatePending: not found', { id });
      return null;
    }
    if (current.status !== 'pending') {
      return current;
    }
    const next = {
      name: fields.name ?? current.name,
      description: fields.description ?? current.description,
      body: fields.body ?? current.body,
    };
    this.db
      .prepare(
        `UPDATE skill_suggestions
           SET name = ?, description = ?, body = ?
         WHERE id = ?`,
      )
      .run(next.name, next.description, next.body, id);
    return this.findById(id);
  }

  /**
   * `pending → accepted`, recording the candidate the acceptance promoted
   * (`null` when the caller has no candidate to link).
   */
  accept(
    id: string,
    promotedCandidateId: string | null,
  ): SkillSuggestionRow | null {
    return this.transition(id, 'accepted', promotedCandidateId);
  }

  dismiss(id: string): SkillSuggestionRow | null {
    return this.transition(id, 'dismissed', null);
  }

  /**
   * `pending → dismissed` for every id in `ids`, recording `umbrellaId` as the
   * row that absorbed it. Rows that are not `pending` are left untouched, and
   * `umbrellaId` itself is never merged into itself even when it appears in
   * `ids`. Returns the number of rows changed; callers compare it with the
   * count they expected.
   */
  markMerged(ids: readonly string[], umbrellaId: string): number {
    const unique = [...new Set(ids)].filter((id) => id !== umbrellaId);
    if (unique.length === 0) return 0;
    const placeholders = unique.map(() => '?').join(', ');
    const result = this.db
      .prepare(
        `UPDATE skill_suggestions
            SET status = 'dismissed', merged_into = ?, decided_at = ?
          WHERE status = 'pending' AND id IN (${placeholders})`,
      )
      .run(umbrellaId, Date.now(), ...unique);
    return Number(result.changes);
  }

  /**
   * Union of `member_candidate_ids` across suggestions. With no filter every
   * status is covered (pool exclusion); with `statuses` only rows in those
   * statuses count. An empty `statuses` list matches nothing.
   */
  listMemberCandidateIds(filter?: {
    statuses?: readonly SkillSuggestionStatus[];
  }): Set<string> {
    const statuses = filter?.statuses;
    let rows: Array<{ member_candidate_ids: string }>;
    if (statuses === undefined) {
      rows = this.db
        .prepare(`SELECT member_candidate_ids FROM skill_suggestions`)
        .all() as Array<{ member_candidate_ids: string }>;
    } else {
      const unique = [...new Set(statuses)];
      if (unique.length === 0) return new Set();
      const placeholders = unique.map(() => '?').join(', ');
      rows = this.db
        .prepare(
          `SELECT member_candidate_ids FROM skill_suggestions
            WHERE status IN (${placeholders})`,
        )
        .all(...unique) as Array<{ member_candidate_ids: string }>;
    }
    const ids = new Set<string>();
    for (const row of rows) {
      for (const id of this.parseStringArray(row.member_candidate_ids)) {
        ids.add(id);
      }
    }
    return ids;
  }

  /**
   * Accepted suggestions with no recorded promoted candidate — the rows the
   * startup reconcile links to the skill their acceptance materialized.
   */
  listAcceptedWithoutPromotedCandidate(): SkillSuggestionRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM skill_suggestions
          WHERE status = 'accepted' AND promoted_candidate_id IS NULL
          ORDER BY decided_at ASC, id ASC`,
      )
      .all() as RawSuggestionRow[];
    return rows.map((r) => this.toRow(r));
  }

  /**
   * Record the promoted candidate of an ALREADY accepted suggestion (the
   * startup reconcile; `accept` only moves a `pending` row). One guarded
   * UPDATE: only an `accepted` row with no link yet changes. Returns whether
   * that row changed; callers inside a transaction throw on `false`.
   */
  linkPromotedCandidate(id: string, candidateId: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE skill_suggestions
            SET promoted_candidate_id = ?
          WHERE id = ? AND status = 'accepted' AND promoted_candidate_id IS NULL`,
      )
      .run(candidateId, id);
    return Number(result.changes) === 1;
  }

  private transition(
    id: string,
    next: Exclude<SkillSuggestionStatus, 'pending'>,
    promotedCandidateId: string | null,
  ): SkillSuggestionRow | null {
    const current = this.findById(id);
    if (!current) {
      this.logger.warn('[skill-synthesis] suggestion transition: not found', {
        id,
        next,
      });
      return null;
    }
    if (current.status !== 'pending') {
      return current;
    }
    this.db
      .prepare(
        `UPDATE skill_suggestions
            SET status = ?, decided_at = ?, promoted_candidate_id = ?
          WHERE id = ? AND status = 'pending'`,
      )
      .run(next, Date.now(), promotedCandidateId, id);
    return this.findById(id);
  }

  private toRow(raw: RawSuggestionRow): SkillSuggestionRow {
    return {
      id: raw.id,
      name: raw.name,
      description: raw.description,
      body: raw.body,
      memberSessionIds: this.parseStringArray(raw.member_session_ids),
      memberCandidateIds: this.parseStringArray(raw.member_candidate_ids),
      clusterSize: raw.cluster_size,
      technologyFingerprint: raw.technology_fingerprint,
      judgeScore: raw.judge_score,
      status: raw.status,
      createdAt: raw.created_at,
      decidedAt: raw.decided_at,
      mergedInto: raw.merged_into ?? null,
      promotedCandidateId: raw.promoted_candidate_id ?? null,
      references: this.parseReferences(raw.id, raw.references_json ?? null),
    };
  }

  /**
   * `references_json` → `SkillReference[]`. NULL means "no references". A
   * value that is not JSON or not an array reads as `[]` after a warn, and
   * entries without a string `name` and `body` are dropped, so one corrupt
   * row never breaks a listing.
   */
  private parseReferences(id: string, json: string | null): SkillReference[] {
    if (json === null) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(json) as unknown;
    } catch (error: unknown) {
      // degradation-audit: reported - a corrupt references_json is warned
      // with the row id and read as no references; the row stays usable.
      this.logger.warn(
        '[skill-synthesis] suggestion references_json is not valid JSON; reading as []',
        { id, error: error instanceof Error ? error.message : String(error) },
      );
      return [];
    }
    if (!Array.isArray(parsed)) {
      this.logger.warn(
        '[skill-synthesis] suggestion references_json is not an array; reading as []',
        { id },
      );
      return [];
    }
    const references: SkillReference[] = [];
    for (const entry of parsed as unknown[]) {
      if (
        entry !== null &&
        typeof entry === 'object' &&
        typeof (entry as { name?: unknown }).name === 'string' &&
        typeof (entry as { body?: unknown }).body === 'string'
      ) {
        const { name, body } = entry as SkillReference;
        references.push({ name, body });
      }
    }
    if (references.length !== parsed.length) {
      this.logger.warn(
        '[skill-synthesis] suggestion references_json had malformed entries; dropped',
        { id, dropped: parsed.length - references.length },
      );
    }
    return references;
  }

  private parseStringArray(json: string): string[] {
    try {
      const parsed = JSON.parse(json) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((x): x is string => typeof x === 'string');
      }
    } catch {
      return [];
    }
    return [];
  }
}
