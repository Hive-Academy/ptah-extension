import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PERSISTENCE_TOKENS,
  type SqliteConnectionService,
  type SqliteDatabase,
} from '@ptah-extension/persistence-sqlite';

export type SkillRegistryKind = 'skill' | 'agent' | 'command';
export type CloneStatus = 'clone' | 'authored' | 'synth' | 'diverged';

export interface SkillRegistryEntry {
  readonly slug: string;
  readonly kind: SkillRegistryKind;
  readonly userPath: string;
  readonly originPluginId: string | null;
  readonly originVersion: string | null;
  readonly sourceHash: string | null;
  readonly cloneStatus: CloneStatus;
  readonly diverged: boolean;
  readonly historyDir: string | null;
  readonly lastEnhancedAt: number | null;
  readonly candidateId: string | null;
  readonly pendingSourceHash: string | null;
}

export interface SkillRegistryRow extends SkillRegistryEntry {
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface RawRegistryRow {
  slug: string;
  kind: SkillRegistryKind;
  user_path: string;
  origin_plugin_id: string | null;
  origin_version: string | null;
  source_hash: string | null;
  clone_status: CloneStatus;
  diverged: number;
  history_dir: string | null;
  last_enhanced_at: number | null;
  candidate_id: string | null;
  pending_source_hash: string | null;
  created_at: number;
  updated_at: number;
}

@injectable()
export class SkillRegistryStore {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
  ) {}

  private get db(): SqliteDatabase {
    return this.connection.db;
  }

  upsert(entry: SkillRegistryEntry): void {
    const now = Date.now();
    const stmt = this.db.prepare(
      `INSERT INTO skill_registry (
         slug, kind, user_path, origin_plugin_id, origin_version, source_hash,
         clone_status, diverged, history_dir, last_enhanced_at, candidate_id,
         pending_source_hash, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(kind, slug) DO UPDATE SET
         user_path = excluded.user_path,
         origin_plugin_id = excluded.origin_plugin_id,
         origin_version = excluded.origin_version,
         source_hash = excluded.source_hash,
         clone_status = excluded.clone_status,
         diverged = excluded.diverged,
         history_dir = excluded.history_dir,
         last_enhanced_at = excluded.last_enhanced_at,
         candidate_id = excluded.candidate_id,
         pending_source_hash = excluded.pending_source_hash,
         updated_at = excluded.updated_at`,
    );
    stmt.run(
      entry.slug,
      entry.kind,
      entry.userPath,
      entry.originPluginId,
      entry.originVersion,
      entry.sourceHash,
      entry.cloneStatus,
      entry.diverged ? 1 : 0,
      entry.historyDir,
      entry.lastEnhancedAt,
      entry.candidateId,
      entry.pendingSourceHash,
      now,
      now,
    );
  }

  getBySlug(kind: SkillRegistryKind, slug: string): SkillRegistryRow | null {
    const stmt = this.db.prepare(
      `SELECT * FROM skill_registry WHERE kind = ? AND slug = ?`,
    );
    const raw = stmt.get(kind, slug) as RawRegistryRow | undefined;
    return raw ? this.toRow(raw) : null;
  }

  listAll(): SkillRegistryRow[] {
    const stmt = this.db.prepare(
      `SELECT * FROM skill_registry ORDER BY kind ASC, slug ASC`,
    );
    const rows = stmt.all() as RawRegistryRow[];
    return rows.map((r) => this.toRow(r));
  }

  setDiverged(kind: SkillRegistryKind, slug: string, diverged: boolean): void {
    const stmt = this.db.prepare(
      `UPDATE skill_registry
         SET diverged = ?,
             clone_status = CASE WHEN ? = 1 THEN 'diverged' ELSE clone_status END,
             updated_at = ?
       WHERE kind = ? AND slug = ?`,
    );
    stmt.run(diverged ? 1 : 0, diverged ? 1 : 0, Date.now(), kind, slug);
  }

  setPending(
    kind: SkillRegistryKind,
    slug: string,
    pendingSourceHash: string | null,
  ): void {
    const stmt = this.db.prepare(
      `UPDATE skill_registry
         SET pending_source_hash = ?, updated_at = ?
       WHERE kind = ? AND slug = ?`,
    );
    stmt.run(pendingSourceHash, Date.now(), kind, slug);
  }

  linkCandidate(
    kind: SkillRegistryKind,
    slug: string,
    candidateId: string,
  ): void {
    const stmt = this.db.prepare(
      `UPDATE skill_registry
         SET candidate_id = ?, clone_status = 'synth', updated_at = ?
       WHERE kind = ? AND slug = ?`,
    );
    stmt.run(candidateId, Date.now(), kind, slug);
  }

  private toRow(raw: RawRegistryRow): SkillRegistryRow {
    return {
      slug: raw.slug,
      kind: raw.kind,
      userPath: raw.user_path,
      originPluginId: raw.origin_plugin_id,
      originVersion: raw.origin_version,
      sourceHash: raw.source_hash,
      cloneStatus: raw.clone_status,
      diverged: raw.diverged === 1,
      historyDir: raw.history_dir,
      lastEnhancedAt: raw.last_enhanced_at,
      candidateId: raw.candidate_id,
      pendingSourceHash: raw.pending_source_hash,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
    };
  }
}
