import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { normalizeWorkspaceRoot } from '@ptah-extension/platform-core';
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

export interface GradeAttribution {
  readonly kind: SkillRegistryKind;
  readonly slug: string;
  readonly runId: string | null;
  readonly sessionId: string | null;
  readonly attributionKey: string;
  readonly finalReview: 'approved' | 'rejected' | null;
}

const KindSchema = z.enum(['skill', 'agent', 'command']);
const AttributionRowSchema = z.object({
  kind: KindSchema,
  slug: z.string(),
  run_id: z.string().nullable(),
  session_id: z.string().nullable(),
  attribution_key: z.string(),
  final_review: z.enum(['approved', 'rejected']).nullable(),
  workspace_root: z.string().nullable(),
});
type RawAttribution = z.infer<typeof AttributionRowSchema>;

export function groupGradeAttributions(rows: readonly RawAttribution[]): GradeAttribution[] {
  const grouped = new Map<string, RawAttribution | null>();
  for (const row of rows) {
    const key = `${row.kind}:${row.slug}:${row.attribution_key}`;
    if (!grouped.has(key)) grouped.set(key, row);
    else {
      const previous = grouped.get(key);
      if (!previous || !row.run_id || previous.session_id !== row.session_id) grouped.set(key, null);
    }
  }
  return [...grouped.values()].filter((row): row is RawAttribution => row !== null).map((row) => ({
    kind: row.kind, slug: row.slug, runId: row.run_id, sessionId: row.session_id,
    attributionKey: row.attribution_key, finalReview: row.final_review,
  }));
}

const AggregateRowSchema = z.object({ graded: z.number(), passed: z.number() });
const PruneRowSchema = z.object({
  subject_kind: KindSchema,
  subject_slug: z.string(),
  attribution_key: z.string(),
});
const GradeRowSchema = z.object({
  task_id: z.string(),
  subject_kind: KindSchema,
  subject_slug: z.string(),
  attribution_key: z.string(),
  run_id: z.string().nullable(),
  verdict: z.enum(['pass', 'fail']),
  source_file: z.string().nullable(),
  source_digest: z.string().nullable(),
  evidence_source: z.string(),
  workspace_root: z.string().nullable(),
  graded_at: z.number(),
  findings_ref: z.string().nullable(),
});

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

  private parseRow<T>(schema: z.ZodType<T>, row: unknown): T {
    const parsed = schema.safeParse(row);
    if (!parsed.success) {
      this.logger.warn('[skill-synthesis] invalid task grade row');
      throw new Error('Invalid task grade row');
    }
    return parsed.data;
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
      grade.evidenceSource, grade.workspaceRoot === null ? null : normalizeWorkspaceRoot(grade.workspaceRoot),
      grade.gradedAt, grade.findingsRef,
    );
  }

  /** Only exact task or uniquely linked session facts are eligible. */
  findAttributions(taskId: string, workspaceRoot: string): GradeAttribution[] {
    const normalizedRoot = normalizeWorkspaceRoot(workspaceRoot);
    const rows = this.db.prepare(`SELECT
      CASE WHEN e.source = 'subagent' THEN 'agent'
           WHEN e.source = 'slash-command' THEN 'command' ELSE 'skill' END AS kind,
      e.skill_slug AS slug, e.run_id, e.session_id,
      CASE WHEN e.run_id IS NOT NULL THEN 'run:' || e.run_id ELSE 'event:' || e.id END AS attribution_key,
      l.final_review, e.workspace_root
      FROM skill_invocation_events e
      LEFT JOIN lane_outcome_records l ON l.run_id = e.run_id
      WHERE e.source IN ('subagent', 'tool-use', 'slash-command')
        AND e.skill_slug <> ''
        AND EXISTS (SELECT 1 FROM skill_registry registry
          WHERE registry.slug = e.skill_slug AND registry.kind =
            CASE WHEN e.source = 'subagent' THEN 'agent'
              WHEN e.source = 'slash-command' THEN 'command' ELSE 'skill' END)
        AND (e.task_id = ? OR (e.task_id IS NULL AND EXISTS (
          SELECT 1 FROM session_task_links s
          WHERE s.workspace_root = e.workspace_root AND s.session_id = e.session_id AND s.task_id = ?
            AND NOT EXISTS (SELECT 1 FROM session_task_links other
              WHERE other.workspace_root = s.workspace_root AND other.session_id = s.session_id
                AND other.task_id <> s.task_id)
        )))`).all(taskId, taskId).map((row) => this.parseRow(AttributionRowSchema, row))
      .filter((row) => row.workspace_root !== null && normalizeWorkspaceRoot(row.workspace_root) === normalizedRoot);
    const laneRows = this.db.prepare(`SELECT 'agent' AS kind, role AS slug,
      run_id, subagent_session_id AS session_id, 'run:' || run_id AS attribution_key,
      final_review, workspace_root FROM lane_outcome_records
      WHERE task_id = ? AND role IS NOT NULL AND role <> ''
        AND EXISTS (SELECT 1 FROM skill_registry registry
          WHERE registry.slug = lane_outcome_records.role AND registry.kind = 'agent')
        AND executor_kind = 'subagent'`).all(taskId).map((row) => this.parseRow(AttributionRowSchema, row))
      .filter((row) => row.workspace_root !== null && normalizeWorkspaceRoot(row.workspace_root) === normalizedRoot);
    for (const row of laneRows) {
      if (!rows.some((event) => event.kind === row.kind && event.slug === row.slug && event.run_id === row.run_id)) rows.push(row);
    }
    return groupGradeAttributions(rows);
  }

  removeAbsent(taskId: string, workspaceRoot: string, keys: readonly string[]): void {
    // An empty keep-list means all current attributions were skipped; remove stale non-spec grades.
    const normalizedRoot = normalizeWorkspaceRoot(workspaceRoot);
    const rows = this.db.prepare(`SELECT subject_kind, subject_slug, attribution_key FROM skill_task_grades
      WHERE task_id = ? AND workspace_root = ? AND evidence_source NOT LIKE 'spec:%'`).all(taskId, normalizedRoot)
      .map((row) => this.parseRow(PruneRowSchema, row));
    const keep = new Set(keys);
    const remove = this.db.prepare(`DELETE FROM skill_task_grades
      WHERE task_id = ? AND workspace_root = ? AND subject_kind = ? AND subject_slug = ? AND attribution_key = ?
        AND evidence_source NOT LIKE 'spec:%'`);
    for (const row of rows) if (!keep.has(`${row.subject_kind}:${row.subject_slug}:${row.attribution_key}`))
      remove.run(taskId, normalizedRoot, row.subject_kind, row.subject_slug, row.attribution_key);
  }

  hasGradeForTask(taskId: string, slug: string, kind?: SkillRegistryKind): boolean {
    const row = this.db.prepare(`SELECT 1 FROM skill_task_grades
      WHERE task_id = ? AND subject_slug = ? AND (? IS NULL OR subject_kind = ?) LIMIT 1`)
      .get(taskId, slug, kind ?? null, kind ?? null);
    return row !== undefined;
  }

  getAggregates(kind: SkillRegistryKind, slugs: readonly string[], workspaceRoot: string | null): Map<string, SkillTaskGradeAggregate> {
    const result = new Map<string, SkillTaskGradeAggregate>();
    const normalizedRoot = workspaceRoot ? normalizeWorkspaceRoot(workspaceRoot) : null;
    const stmt = this.db.prepare(`SELECT COUNT(*) AS graded,
      COALESCE(SUM(CASE WHEN verdict = 'pass' THEN 1 ELSE 0 END), 0) AS passed
      FROM skill_task_grades INDEXED BY idx_skill_task_grades_subject
      WHERE subject_kind = ? AND subject_slug = ? AND workspace_root = ?`);
    for (const slug of slugs) {
      const row = this.parseRow(AggregateRowSchema, stmt.get(kind, slug, normalizedRoot));
      result.set(slug, {
        graded: row.graded,
        passed: row.passed,
        successRate: row.graded > 0 ? row.passed / row.graded : null,
      });
    }
    return result;
  }

  listRecent(kind: SkillRegistryKind, slug: string, limit: number, workspaceRoot: string | null): SkillTaskGrade[] {
    const normalizedRoot = workspaceRoot ? normalizeWorkspaceRoot(workspaceRoot) : null;
    const rows = this.db.prepare(`SELECT * FROM skill_task_grades
      INDEXED BY idx_skill_task_grades_subject
      WHERE subject_kind = ? AND subject_slug = ? AND workspace_root = ?
      ORDER BY graded_at DESC LIMIT ?`).all(kind, slug, normalizedRoot, limit)
      .map((row) => this.parseRow(GradeRowSchema, row));
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
