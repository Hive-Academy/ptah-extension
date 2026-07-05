/**
 * SkillSuggestionStore — SQLite persistence layer for skill_suggestions.
 *
 * A suggestion is a cluster-level artifact: it is synthesized from a cluster
 * of similar candidate trajectories and surfaced to the Skills tab for human
 * approval. Accepting materializes a promoted skill; dismissing keeps the row
 * so the same cluster is not re-proposed. The store is intentionally dumb —
 * acceptance side effects (SKILL.md materialization, registry linkage) live in
 * the coordinator that drives it.
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
}

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

  insertPending(input: NewSuggestionInput): SkillSuggestionRow {
    const id = ulid();
    const createdAt = Date.now();
    const stmt = this.db.prepare(
      `INSERT INTO skill_suggestions (
         id, name, description, body,
         member_session_ids, member_candidate_ids,
         cluster_size, technology_fingerprint, judge_score,
         status, created_at, decided_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL)`,
    );
    stmt.run(
      id,
      input.name,
      input.description,
      input.body,
      JSON.stringify(input.memberSessionIds),
      JSON.stringify(input.memberCandidateIds),
      input.clusterSize,
      input.technologyFingerprint,
      input.judgeScore,
      createdAt,
    );
    const row = this.findById(id);
    if (!row) {
      throw new Error(
        `[skill-synthesis] insertPending: row ${id} could not be re-read`,
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

  accept(id: string): SkillSuggestionRow | null {
    return this.transition(id, 'accepted');
  }

  dismiss(id: string): SkillSuggestionRow | null {
    return this.transition(id, 'dismissed');
  }

  /**
   * Whether the cluster represented by `fingerprint` + `candidateIds` already
   * has a pending or accepted suggestion. Dismissed rows also block re-proposal
   * (kept for dedup). Match on identical fingerprint OR any member-candidate
   * overlap so a re-clustered superset/subset does not re-surface.
   */
  hasExistingForCluster(
    fingerprint: string,
    candidateIds: readonly string[],
  ): boolean {
    const rows = this.db
      .prepare(
        `SELECT technology_fingerprint, member_candidate_ids
         FROM skill_suggestions`,
      )
      .all() as Array<{
      technology_fingerprint: string;
      member_candidate_ids: string;
    }>;
    const probe = new Set(candidateIds);
    for (const row of rows) {
      if (row.technology_fingerprint === fingerprint) return true;
      const members = this.parseStringArray(row.member_candidate_ids);
      for (const m of members) {
        if (probe.has(m)) return true;
      }
    }
    return false;
  }

  private transition(
    id: string,
    next: Exclude<SkillSuggestionStatus, 'pending'>,
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
        `UPDATE skill_suggestions SET status = ?, decided_at = ? WHERE id = ?`,
      )
      .run(next, Date.now(), id);
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
    };
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
