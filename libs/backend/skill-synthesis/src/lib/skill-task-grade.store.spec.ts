import 'reflect-metadata';
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

const grade: SkillTaskGrade = {
  taskId: 'TASK_2026_001', subjectKind: 'agent', subjectSlug: 'writer',
  attributionKey: 'run:1', runId: '1', verdict: 'pass', sourceFile: 'review.md',
  sourceDigest: 'digest-a', evidenceSource: 'spec:TASK_2026_001',
  workspaceRoot: '/workspace', gradedAt: 1, findingsRef: null,
};

maybe('SkillTaskGradeStore', () => {
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
});
