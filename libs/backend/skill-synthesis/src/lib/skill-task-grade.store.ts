import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PERSISTENCE_TOKENS,
  type SqliteConnectionService,
  type SqliteDatabase,
} from '@ptah-extension/persistence-sqlite';
import type { SkillRegistryKind } from './skill-registry.store';

export interface SkillTaskGrade {
  readonly taskId: string;
  readonly subjectKind: SkillRegistryKind;
  readonly subjectSlug: string;
  readonly attributionKey: string;
  readonly runId: string | null;
  readonly verdict: 'pass' | 'fail';
  readonly sourceFile: string | null;
  readonly sourceDigest: string | null;
  readonly evidenceSource: string;
  readonly workspaceRoot: string | null;
  readonly gradedAt: number;
  readonly findingsRef: string | null;
}

export interface SkillTaskGradeAggregate {
  readonly graded: number;
  readonly passed: number;
  readonly successRate: number | null;
}

interface RawAggregate { graded: number; passed: number }
interface RawGrade {
  task_id: string;
  subject_kind: SkillRegistryKind;
  subject_slug: string;
  attribution_key: string;
  run_id: string | null;
  verdict: 'pass' | 'fail';
  source_file: string | null;
  source_digest: string | null;
  evidence_source: string;
  workspace_root: string | null;
  graded_at: number;
  findings_ref: string | null;
}

@injectable()
export class SkillTaskGradeStore {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
  ) {}

  private get db(): SqliteDatabase {
    return this.connection.db;
  }

  upsert(grade: SkillTaskGrade): void {
    this.db.prepare(`INSERT INTO skill_task_grades (
      task_id, subject_kind, subject_slug, attribution_key, run_id, verdict,
      source_file, source_digest, evidence_source, workspace_root, graded_at, findings_ref
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(task_id, subject_kind, subject_slug, attribution_key) DO UPDATE SET
      run_id = excluded.run_id,
      verdict = excluded.verdict,
      source_file = excluded.source_file,
      source_digest = excluded.source_digest,
      evidence_source = excluded.evidence_source,
      workspace_root = excluded.workspace_root,
      graded_at = excluded.graded_at,
      findings_ref = excluded.findings_ref`).run(
      grade.taskId, grade.subjectKind, grade.subjectSlug, grade.attributionKey,
      grade.runId, grade.verdict, grade.sourceFile, grade.sourceDigest,
      grade.evidenceSource, grade.workspaceRoot, grade.gradedAt, grade.findingsRef,
    );
  }

  getAggregates(kind: SkillRegistryKind, slugs: readonly string[]): Map<string, SkillTaskGradeAggregate> {
    const result = new Map<string, SkillTaskGradeAggregate>();
    const stmt = this.db.prepare(`SELECT COUNT(*) AS graded,
      COALESCE(SUM(CASE WHEN verdict = 'pass' THEN 1 ELSE 0 END), 0) AS passed
      FROM skill_task_grades INDEXED BY idx_skill_task_grades_subject
      WHERE subject_kind = ? AND subject_slug = ?`);
    for (const slug of slugs) {
      const row = stmt.get(kind, slug) as RawAggregate;
      result.set(slug, {
        graded: row.graded,
        passed: row.passed,
        successRate: row.graded > 0 ? row.passed / row.graded : null,
      });
    }
    return result;
  }

  listRecent(kind: SkillRegistryKind, slug: string, limit: number): SkillTaskGrade[] {
    const rows = this.db.prepare(`SELECT * FROM skill_task_grades
      INDEXED BY idx_skill_task_grades_subject
      WHERE subject_kind = ? AND subject_slug = ?
      ORDER BY graded_at DESC LIMIT ?`).all(kind, slug, limit) as RawGrade[];
    return rows.map((row) => ({
      taskId: row.task_id,
      subjectKind: row.subject_kind,
      subjectSlug: row.subject_slug,
      attributionKey: row.attribution_key,
      runId: row.run_id,
      verdict: row.verdict,
      sourceFile: row.source_file,
      sourceDigest: row.source_digest,
      evidenceSource: row.evidence_source,
      workspaceRoot: row.workspace_root,
      gradedAt: row.graded_at,
      findingsRef: row.findings_ref,
    }));
  }
}
