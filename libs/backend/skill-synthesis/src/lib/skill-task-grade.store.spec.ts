import 'reflect-metadata';
import { join, sep } from 'node:path';
import { MIGRATIONS } from '@ptah-extension/persistence-sqlite';
import { resolveOpener, type TestDatabase } from './queue/queue-db.test-support';
import { SkillTaskGradeStore, type SkillTaskGrade } from './skill-task-grade.store';

const opener = resolveOpener();
const maybe = opener ? describe : describe.skip;
const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

function setup(): { db: TestDatabase; store: SkillTaskGradeStore } {
  if (!opener) throw new Error('SQLite unavailable');
  const db = opener(':memory:');
  const sql = MIGRATIONS.find((migration) => migration.version === 56)?.sql;
  const schema = sql?.match(/CREATE TABLE skill_task_grades \([\s\S]*?CREATE INDEX idx_skill_task_grades_run ON skill_task_grades\(run_id\);/)?.[0];
  if (!schema) throw new Error('Migration 0056 grade schema unavailable');
  db.exec(schema);
  return { db, store: new SkillTaskGradeStore(logger as never, { db, isOpen: true } as never) };
}

function setupAttributionTables(db: TestDatabase): void {
  db.exec(`CREATE TABLE skill_invocation_events (
    id TEXT, source TEXT, skill_slug TEXT, run_id TEXT, session_id TEXT,
    workspace_root TEXT, task_id TEXT
  );
  CREATE TABLE skill_registry (slug TEXT, kind TEXT);
  CREATE TABLE session_task_links (workspace_root TEXT, session_id TEXT, task_id TEXT);
  CREATE TABLE lane_outcome_records (
    run_id TEXT, subagent_session_id TEXT, final_review TEXT, task_id TEXT,
    workspace_root TEXT, role TEXT, executor_kind TEXT
  );`);
  db.prepare('INSERT INTO skill_registry (slug, kind) VALUES (?, ?)').run('writer', 'agent');
}

const grade: SkillTaskGrade = {
  taskId: 'TASK_2026_001', subjectKind: 'agent', subjectSlug: 'writer',
  attributionKey: 'run:1', runId: '1', verdict: 'pass', sourceFile: 'review.md',
  sourceDigest: 'digest-a', evidenceSource: 'spec:TASK_2026_001',
  workspaceRoot: '/workspace', gradedAt: 1, findingsRef: null,
};

maybe('SkillTaskGradeStore', () => {
  it('matches trailing-separator roots and excludes a different workspace', () => {
    const { db, store } = setup();
    try {
      setupAttributionTables(db);
      const root = join(process.cwd(), 'proj');
      db.prepare(`INSERT INTO skill_invocation_events
        (id, source, skill_slug, run_id, session_id, workspace_root, task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run('event-1', 'subagent', 'writer', 'run-1', 'session-1', `${root}${sep}`, grade.taskId);
      expect(store.findAttributions(grade.taskId, root)).toEqual([
        expect.objectContaining({ kind: 'agent', slug: 'writer', attributionKey: 'run:run-1' }),
      ]);
      expect(store.findAttributions(grade.taskId, join(process.cwd(), 'other'))).toEqual([]);
    } finally { db.close(); }
  });

  (process.platform === 'win32' ? it : it.skip)('matches uppercase drive-letter event roots', () => {
    const { db, store } = setup();
    try {
      setupAttributionTables(db);
      db.prepare(`INSERT INTO skill_invocation_events
        (id, source, skill_slug, run_id, session_id, workspace_root, task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run('event-1', 'subagent', 'writer', 'run-1', 'session-1', 'D:\\proj\\', grade.taskId);
      expect(store.findAttributions(grade.taskId, 'd:\\proj')).toHaveLength(1);
    } finally { db.close(); }
  });

  it('keeps agent, skill and command grades distinct and returns null for no grade', () => {
    const { db, store } = setup();
    try {
      store.upsert(grade);
      store.upsert({ ...grade, subjectKind: 'skill' });
      store.upsert({ ...grade, subjectKind: 'command', verdict: 'fail' });
      expect(store.getAggregates('agent', ['writer', 'missing']).get('writer')).toEqual({ graded: 1, passed: 1, successRate: 1 });
      expect(store.getAggregates('skill', ['writer']).get('writer')?.successRate).toBe(1);
      expect(store.getAggregates('command', ['writer']).get('writer')?.successRate).toBe(0);
      expect(store.getAggregates('agent', ['missing']).get('missing')).toEqual({ graded: 0, passed: 0, successRate: null });
    } finally { db.close(); }
  });

  it('replaces a corrected review without adding a denominator', () => {
    const { db, store } = setup();
    try {
      store.upsert(grade);
      store.upsert({ ...grade, verdict: 'fail', sourceDigest: 'digest-b', gradedAt: 2 });
      expect(store.getAggregates('agent', ['writer']).get('writer')).toEqual({ graded: 1, passed: 0, successRate: 0 });
      expect(store.listRecent('agent', 'writer', 5)).toMatchObject([{ verdict: 'fail', sourceDigest: 'digest-b', gradedAt: 2 }]);
    } finally { db.close(); }
  });

  it('preserves spec backfill and skips pruning when no attributions were found', () => {
    const { db, store } = setup();
    try {
      store.upsert(grade);
      store.upsert({ ...grade, subjectSlug: 'manual', attributionKey: 'event:2', evidenceSource: 'review' });
      store.removeAbsent(grade.taskId, '/workspace', []);
      expect(store.listRecent('agent', 'manual', 5)).toHaveLength(1);
      store.removeAbsent(grade.taskId, '/workspace', ['agent:other:event:3']);
      expect(store.listRecent('agent', 'writer', 5)).toHaveLength(1);
      expect(store.listRecent('agent', 'manual', 5)).toHaveLength(0);
    } finally { db.close(); }
  });

  it('rejects an invalid persisted grade row with a bounded warning', () => {
    const { db, store } = setup();
    try {
      store.upsert(grade);
      db.prepare('UPDATE skill_task_grades SET verdict = ? WHERE task_id = ?').run('invalid-verdict', grade.taskId);
      expect(() => store.listRecent('agent', 'writer', 5)).toThrow('Invalid task grade row');
      expect(logger.warn).toHaveBeenCalledWith('[skill-synthesis] invalid task grade row');
    } finally { db.close(); }
  });
});
