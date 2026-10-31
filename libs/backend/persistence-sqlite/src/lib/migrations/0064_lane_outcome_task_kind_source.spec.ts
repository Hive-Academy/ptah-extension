import 'reflect-metadata';
import { sql as laneOutcomeRecordsSql } from './0054_lane_outcome_records';
import { sql } from './0064_lane_outcome_task_kind_source';
import { MIGRATIONS } from './index';

interface DatabaseShape {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: (string | number | null)[]): unknown;
    get(...params: (string | number | null)[]): unknown;
  };
  close(): void;
}

describe('migration 0064_lane_outcome_task_kind_source', () => {
  let db: DatabaseShape;

  beforeEach(() => {
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (file: string) => DatabaseShape;
    };
    db = new DatabaseSync(':memory:');
    db.exec(laneOutcomeRecordsSql);
  });

  afterEach(() => db.close());

  it('registers 0064 immediately after 0063 as the latest migration', () => {
    const previousIndex = MIGRATIONS.findIndex((entry) => entry.version === 63);
    expect(previousIndex).toBeGreaterThanOrEqual(0);
    expect(MIGRATIONS[previousIndex + 1]).toEqual({
      version: 64,
      name: '0064_lane_outcome_task_kind_source',
      sql,
    });
    expect(MIGRATIONS[MIGRATIONS.length - 1]?.version).toBe(64);
  });

  it('keeps an existing outcome row without reconstructed provenance', () => {
    db.prepare(`INSERT INTO lane_outcome_records
      (run_id, executor_kind, lane_id, agent_id, model, verdict,
       ended_at, created_at, updated_at)
      VALUES (?, 'cli', 'lane-1', 'agent-1', 'model-1', 'completed', 1, 1, 1)`)
      .run('old-run');

    db.exec(sql);

    expect(
      db.prepare('SELECT task_kind_source FROM lane_outcome_records WHERE run_id = ?')
        .get('old-run'),
    ).toMatchObject({ task_kind_source: null });
  });

  it('stores each task-kind source on a new outcome row', () => {
    db.exec(sql);
    const insert = db.prepare(`INSERT INTO lane_outcome_records
      (run_id, executor_kind, lane_id, agent_id, model, verdict,
       ended_at, created_at, updated_at, task_kind_source)
      VALUES (?, 'cli', 'lane-1', 'agent-1', 'model-1', 'completed', 1, 1, 1, ?)`);
    const read = db.prepare(
      'SELECT task_kind_source FROM lane_outcome_records WHERE run_id = ?',
    );
    for (const source of ['explicit', 'mapped', 'classified', 'unclassified']) {
      const runId = 'run-' + source;
      insert.run(runId, source);
      expect(read.get(runId)).toMatchObject({ task_kind_source: source });
    }
  });
});
